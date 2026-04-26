import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_CONFLICT_RESOLUTION_POLICIES,
  ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES,
  ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES,
  ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS,
  ALLOWED_TEST_INTENT_SOURCE_KINDS,
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
  SUPPORTING_TEST_INTENT_SOURCE_KINDS,
  TEST_INTELLIGENCE_MULTISOURCE_ENV,
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceKind,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import {
  buildMultiSourceTestIntentEnvelope,
  canonicalizeMultiSourceEnvelope,
  computeAggregateContentHash,
  enforceMultiSourceModeGate,
  evaluateMultiSourceModeGate,
  isMultiSourceEnvelopeRefusalCode,
  isMultiSourceModeGateRefusalCode,
  isPrimaryTestIntentSourceKind,
  isSupportingTestIntentSourceKind,
  legacySourceFromMultiSourceEnvelope,
  MultiSourceModeGateError,
  resolveTestIntelligenceMultiSourceEnvEnabled,
  validateMultiSourceTestIntentEnvelope,
} from "./multi-source-envelope.js";

const HEX = (seed: string): string => sha256Hex({ seed });
const ISO = "2026-04-26T12:34:56.000Z";

const figmaRef = (id: string, seed = id): TestIntentSourceRef => ({
  sourceId: id,
  kind: "figma_local_json",
  contentHash: HEX(seed),
  capturedAt: ISO,
});
const jiraRestRef = (id: string, seed = id): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_rest",
  contentHash: HEX(seed),
  capturedAt: ISO,
});
const jiraPasteRef = (id: string, seed = id): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_paste",
  contentHash: HEX(seed),
  capturedAt: ISO,
});
const customMarkdownRef = (id: string, seed = id): TestIntentSourceRef => ({
  sourceId: id,
  kind: "custom_text",
  contentHash: HEX(seed),
  capturedAt: ISO,
  inputFormat: "markdown",
  noteEntryId: `note.${id}`,
  markdownSectionPath: "# Risks > ## PII",
});
const customTextRef = (id: string, seed = id): TestIntentSourceRef => ({
  sourceId: id,
  kind: "custom_text",
  contentHash: HEX(seed),
  capturedAt: ISO,
  inputFormat: "plain_text",
});

test("ALLOWED_TEST_INTENT_SOURCE_KINDS covers all seven Wave 4 kinds", () => {
  assert.deepEqual([...ALLOWED_TEST_INTENT_SOURCE_KINDS].sort(), [
    "custom_structured",
    "custom_text",
    "figma_local_json",
    "figma_plugin",
    "figma_rest",
    "jira_paste",
    "jira_rest",
  ]);
});

test("primary and supporting source-kind sets partition the universe", () => {
  const all = new Set<string>(ALLOWED_TEST_INTENT_SOURCE_KINDS);
  for (const k of PRIMARY_TEST_INTENT_SOURCE_KINDS) {
    assert.ok(all.has(k));
    assert.ok(isPrimaryTestIntentSourceKind(k));
    assert.ok(!isSupportingTestIntentSourceKind(k));
  }
  for (const k of SUPPORTING_TEST_INTENT_SOURCE_KINDS) {
    assert.ok(all.has(k));
    assert.ok(isSupportingTestIntentSourceKind(k));
    assert.ok(!isPrimaryTestIntentSourceKind(k));
  }
  const merged = new Set<string>([
    ...PRIMARY_TEST_INTENT_SOURCE_KINDS,
    ...SUPPORTING_TEST_INTENT_SOURCE_KINDS,
  ]);
  assert.equal(merged.size, ALLOWED_TEST_INTENT_SOURCE_KINDS.length);
});

test("ALLOWED_CONFLICT_RESOLUTION_POLICIES has the three contract values", () => {
  assert.deepEqual([...ALLOWED_CONFLICT_RESOLUTION_POLICIES].sort(), [
    "keep_both",
    "priority",
    "reviewer_decides",
  ]);
});

test("ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS exposes the three formats", () => {
  assert.deepEqual([...ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS].sort(), [
    "markdown",
    "plain_text",
    "structured_json",
  ]);
});

test("MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION is 1.0.0", () => {
  assert.equal(MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION, "1.0.0");
});

test("buildMultiSourceTestIntentEnvelope produces a stable schema version", () => {
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0", "a")],
    conflictResolutionPolicy: "keep_both",
  });
  assert.equal(envelope.version, "1.0.0");
  assert.equal(envelope.conflictResolutionPolicy, "keep_both");
  assert.equal(envelope.sources.length, 1);
});

test("aggregate hash is invariant under source reordering for non-priority policy", () => {
  const a = figmaRef("src.0", "alpha");
  const b = jiraRestRef("src.1", "beta");
  const ab = computeAggregateContentHash({
    sources: [a, b],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const ba = computeAggregateContentHash({
    sources: [b, a],
    conflictResolutionPolicy: "reviewer_decides",
  });
  assert.equal(ab, ba);
});

test("aggregate hash differs when priority order differs", () => {
  const a = figmaRef("src.0", "alpha");
  const b = jiraRestRef("src.1", "beta");
  const order1: TestIntentSourceKind[] = ["figma_local_json", "jira_rest"];
  const order2: TestIntentSourceKind[] = ["jira_rest", "figma_local_json"];
  const h1 = computeAggregateContentHash({
    sources: [a, b],
    conflictResolutionPolicy: "priority",
    priorityOrder: order1,
  });
  const h2 = computeAggregateContentHash({
    sources: [a, b],
    conflictResolutionPolicy: "priority",
    priorityOrder: order2,
  });
  assert.notEqual(h1, h2);
});

test("aggregate hash changes when source content changes", () => {
  const a = figmaRef("src.0", "alpha");
  const aPrime = figmaRef("src.0", "alpha-changed");
  const before = computeAggregateContentHash({
    sources: [a],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const after = computeAggregateContentHash({
    sources: [aPrime],
    conflictResolutionPolicy: "reviewer_decides",
  });
  assert.notEqual(before, after);
});

test("validator accepts a Figma-only envelope", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0")],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, true);
});

test("validator accepts Jira REST + Jira paste + custom_text combination", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [
      jiraRestRef("src.0", "rest"),
      jiraPasteRef("src.1", "paste"),
      customMarkdownRef("src.2", "ctx"),
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, true);
});

test("validator rejects a custom-only envelope with primary_source_required", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [customTextRef("src.0"), customMarkdownRef("src.1", "md")],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "primary_source_required"));
  }
});

test("validator rejects empty source list with sources_empty", () => {
  const result = validateMultiSourceTestIntentEnvelope({
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "sources_empty"));
  }
});

test("validator rejects unknown source kind", () => {
  const result = validateMultiSourceTestIntentEnvelope({
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [
      {
        sourceId: "src.0",
        kind: "telegram_paste",
        contentHash: HEX("x"),
        capturedAt: ISO,
      },
    ],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "invalid_source_kind"));
  }
});

test("validator rejects malformed content hash and bad capturedAt", () => {
  const result = validateMultiSourceTestIntentEnvelope({
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [
      {
        sourceId: "src.0",
        kind: "figma_local_json",
        contentHash: "not-hex",
        capturedAt: "yesterday",
      },
    ],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "invalid_content_hash"));
    assert.ok(result.issues.some((i) => i.code === "invalid_captured_at"));
  }
});

test("validator rejects duplicate source IDs", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("dup.id", "a"), jiraRestRef("dup.id", "b")],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "duplicate_source_id"));
  }
});

test("validator detects duplicate Jira paste-collision content hashes", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [jiraRestRef("src.0", "same"), jiraPasteRef("src.1", "same")],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "duplicate_jira_paste_collision"),
    );
  }
});

test("validator requires custom inputFormat for custom_text", () => {
  const result = validateMultiSourceTestIntentEnvelope({
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [
      figmaRef("src.0"),
      {
        sourceId: "src.1",
        kind: "custom_text",
        contentHash: HEX("c"),
        capturedAt: ISO,
      },
    ],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "custom_input_format_required"),
    );
  }
});

test("validator rejects inputFormat on primary source", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "src.0",
        kind: "figma_local_json",
        contentHash: HEX("a"),
        capturedAt: ISO,
        inputFormat: "plain_text",
      },
    ],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (i) => i.code === "primary_source_input_format_invalid",
      ),
    );
  }
});

test("validator rejects markdown metadata on non-markdown custom source", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [
      figmaRef("src.0"),
      {
        sourceId: "src.1",
        kind: "custom_text",
        contentHash: HEX("c"),
        capturedAt: ISO,
        inputFormat: "plain_text",
        markdownSectionPath: "# nope",
      },
    ],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "markdown_metadata_only_for_custom"),
    );
  }
});

test("validator accepts markdown metadata on markdown custom source", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0"), customMarkdownRef("src.1", "md")],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, true);
});

test("validator catches aggregate hash mismatch", () => {
  const env: MultiSourceTestIntentEnvelope = {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [figmaRef("src.0", "x")],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  };
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "aggregate_hash_mismatch"));
  }
});

test("validator requires priorityOrder under priority policy", () => {
  const env: MultiSourceTestIntentEnvelope = {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
    aggregateContentHash: computeAggregateContentHash({
      sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
      conflictResolutionPolicy: "priority",
    }),
    conflictResolutionPolicy: "priority",
  };
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "priority_order_required"));
  }
});

test("validator rejects priorityOrder on non-priority policy", () => {
  const env: MultiSourceTestIntentEnvelope = {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: [figmaRef("src.0")],
    aggregateContentHash: computeAggregateContentHash({
      sources: [figmaRef("src.0")],
      conflictResolutionPolicy: "keep_both",
    }),
    conflictResolutionPolicy: "keep_both",
    priorityOrder: ["figma_local_json"],
  };
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (i) =>
          i.code === "priority_order_required" &&
          i.detail === "only_for_priority_policy",
      ),
    );
  }
});

test("validator rejects priorityOrder containing kinds not in sources", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
    conflictResolutionPolicy: "priority",
    priorityOrder: ["figma_local_json", "jira_rest", "jira_paste"],
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "priority_order_invalid_kind"),
    );
  }
});

test("validator rejects priorityOrder with missing kinds", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
    conflictResolutionPolicy: "priority",
    priorityOrder: ["figma_local_json"],
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "priority_order_incomplete"),
    );
  }
});

test("validator accepts a complete priority envelope round-trip", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
    conflictResolutionPolicy: "priority",
    priorityOrder: ["figma_local_json", "jira_rest"],
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, true);
});

test("validator returns envelope_missing for non-objects", () => {
  for (const candidate of [null, undefined, 42, "string", true, []]) {
    const result = validateMultiSourceTestIntentEnvelope(candidate);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.length > 0);
    }
  }
});

test("validator returns envelope_version_mismatch on unknown version", () => {
  const env = {
    version: "9.9.9",
    sources: [figmaRef("src.0")],
    aggregateContentHash: "0".repeat(64),
    conflictResolutionPolicy: "keep_both",
  };
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some((i) => i.code === "envelope_version_mismatch"),
    );
  }
});

test("validator rejects malformed authorHandle", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        ...jiraPasteRef("src.0", "a"),
        authorHandle: "not a handle with spaces and !!",
      },
    ],
    conflictResolutionPolicy: "keep_both",
  });
  const result = validateMultiSourceTestIntentEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "invalid_author_handle"));
  }
});

test("legacySourceFromMultiSourceEnvelope prefers Figma when present", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [
      jiraRestRef("src.0", "j"),
      figmaRef("src.1", "f"),
      customMarkdownRef("src.2", "m"),
    ],
    conflictResolutionPolicy: "keep_both",
  });
  const legacy = legacySourceFromMultiSourceEnvelope(env);
  assert.ok(legacy);
  assert.equal(legacy?.kind, "figma_local_json");
  assert.equal(legacy?.contentHash, env.sources[1]?.contentHash);
});

test("legacySourceFromMultiSourceEnvelope collapses non-Figma to hybrid", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [jiraRestRef("src.0", "j")],
    conflictResolutionPolicy: "keep_both",
  });
  const legacy = legacySourceFromMultiSourceEnvelope(env);
  assert.equal(legacy?.kind, "hybrid");
});

test("canonicalizeMultiSourceEnvelope is deterministic", () => {
  const env = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef("src.0"), jiraRestRef("src.1", "j")],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const a = canonicalizeMultiSourceEnvelope(env);
  const b = canonicalizeMultiSourceEnvelope(env);
  assert.equal(a, b);
});

test("isMultiSourceEnvelopeRefusalCode and ...ModeGateRefusalCode guards", () => {
  for (const code of ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES) {
    assert.ok(isMultiSourceEnvelopeRefusalCode(code));
  }
  assert.equal(isMultiSourceEnvelopeRefusalCode("nope"), false);
  for (const code of ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES) {
    assert.ok(isMultiSourceModeGateRefusalCode(code));
  }
  assert.equal(isMultiSourceModeGateRefusalCode("nope"), false);
});

test("evaluateMultiSourceModeGate allows when all four gates green", () => {
  const decision = evaluateMultiSourceModeGate({
    testIntelligenceEnvEnabled: true,
    testIntelligenceStartupEnabled: true,
    multiSourceEnvEnabled: true,
    multiSourceStartupEnabled: true,
    llmCodegenMode: "deterministic",
  });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.refusals, []);
});

test("evaluateMultiSourceModeGate refuses when test-intelligence parent disabled", () => {
  const decision = evaluateMultiSourceModeGate({
    testIntelligenceEnvEnabled: false,
    testIntelligenceStartupEnabled: true,
    multiSourceEnvEnabled: true,
    multiSourceStartupEnabled: true,
    llmCodegenMode: "deterministic",
  });
  assert.equal(decision.allowed, false);
  assert.ok(
    decision.refusals.some((r) => r.code === "test_intelligence_disabled"),
  );
});

test("evaluateMultiSourceModeGate fails closed on llmCodegenMode != deterministic", () => {
  const decision = evaluateMultiSourceModeGate({
    testIntelligenceEnvEnabled: true,
    testIntelligenceStartupEnabled: true,
    multiSourceEnvEnabled: true,
    multiSourceStartupEnabled: true,
    llmCodegenMode: "llm_strict",
  });
  assert.equal(decision.allowed, false);
  assert.ok(
    decision.refusals.some((r) => r.code === "llm_codegen_mode_locked"),
  );
});

test("enforceMultiSourceModeGate throws MultiSourceModeGateError on refusal", () => {
  assert.throws(
    () =>
      enforceMultiSourceModeGate({
        testIntelligenceEnvEnabled: false,
        testIntelligenceStartupEnabled: false,
        multiSourceEnvEnabled: false,
        multiSourceStartupEnabled: false,
        llmCodegenMode: "hybrid",
      }),
    (err: unknown) => {
      assert.ok(err instanceof MultiSourceModeGateError);
      assert.ok(err.refusals.length >= 1);
      return true;
    },
  );
});

test("enforceMultiSourceModeGate is silent when allowed", () => {
  enforceMultiSourceModeGate({
    testIntelligenceEnvEnabled: true,
    testIntelligenceStartupEnabled: true,
    multiSourceEnvEnabled: true,
    multiSourceStartupEnabled: true,
    llmCodegenMode: "deterministic",
  });
});

test("resolveTestIntelligenceMultiSourceEnvEnabled accepts known truthy values", () => {
  const env = TEST_INTELLIGENCE_MULTISOURCE_ENV;
  for (const truthy of ["1", "true", "TRUE", "yes", "ON"]) {
    assert.equal(
      resolveTestIntelligenceMultiSourceEnvEnabled({ [env]: truthy }),
      true,
    );
  }
  for (const falsy of ["", "0", "false", "no", "off"]) {
    assert.equal(
      resolveTestIntelligenceMultiSourceEnvEnabled({ [env]: falsy }),
      false,
    );
  }
  assert.equal(resolveTestIntelligenceMultiSourceEnvEnabled({}), false);
});

test("ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES includes primary_source_required", () => {
  assert.ok(
    (ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES as readonly string[]).includes(
      "primary_source_required",
    ),
  );
  assert.ok(
    (ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES as readonly string[]).includes(
      "duplicate_jira_paste_collision",
    ),
  );
  assert.ok(
    (ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES as readonly string[]).includes(
      "aggregate_hash_mismatch",
    ),
  );
});

test("source-mix matrix coverage: every documented combination", () => {
  const fixtures: Array<{
    label: string;
    sources: TestIntentSourceRef[];
    expect: "ok" | "primary_source_required";
  }> = [
    {
      label: "figma-only",
      sources: [figmaRef("s.0", "f")],
      expect: "ok",
    },
    {
      label: "jira_rest-only",
      sources: [jiraRestRef("s.0", "jr")],
      expect: "ok",
    },
    {
      label: "jira_paste-only",
      sources: [jiraPasteRef("s.0", "jp")],
      expect: "ok",
    },
    {
      label: "figma + jira_rest",
      sources: [figmaRef("s.0", "f"), jiraRestRef("s.1", "jr")],
      expect: "ok",
    },
    {
      label: "figma + jira_paste",
      sources: [figmaRef("s.0", "f"), jiraPasteRef("s.1", "jp")],
      expect: "ok",
    },
    {
      label: "jira_rest + jira_paste",
      sources: [jiraRestRef("s.0", "jr"), jiraPasteRef("s.1", "jp")],
      expect: "ok",
    },
    {
      label: "figma + custom_text(plain_text)",
      sources: [figmaRef("s.0", "f"), customTextRef("s.1", "ct")],
      expect: "ok",
    },
    {
      label: "figma + custom_text(markdown)",
      sources: [figmaRef("s.0", "f"), customMarkdownRef("s.1", "ctm")],
      expect: "ok",
    },
    {
      label: "custom-only refused",
      sources: [customTextRef("s.0", "x"), customMarkdownRef("s.1", "y")],
      expect: "primary_source_required",
    },
  ];
  for (const fixture of fixtures) {
    const env = buildMultiSourceTestIntentEnvelope({
      sources: fixture.sources,
      conflictResolutionPolicy: "reviewer_decides",
    });
    const result = validateMultiSourceTestIntentEnvelope(env);
    if (fixture.expect === "ok") {
      assert.equal(result.ok, true, `expected ${fixture.label} to validate`);
    } else {
      assert.equal(result.ok, false, `expected ${fixture.label} to refuse`);
      if (!result.ok) {
        assert.ok(
          result.issues.some((i) => i.code === fixture.expect),
          `expected ${fixture.label} refusal code ${fixture.expect}`,
        );
      }
    }
  }
});
