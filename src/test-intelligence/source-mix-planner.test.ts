/**
 * Unit tests for source-mix-planner.ts (Issue #1441, Wave 4.K).
 *
 * Coverage:
 *   - Source-mix matrix: all seven supported mix kinds
 *   - Duplicate source rejection (duplicate Jira REST/paste issue key)
 *   - custom_markdown validation (hashes required, inputFormat forbidden)
 *   - Source-mix hash determinism
 *   - primary_source_required fail-closed path
 *   - Jira-only visualSidecarRequirement=not_applicable
 *   - Figma-only backward-compatible plan
 *   - promptSections derivation per mix kind
 *   - writeSourceMixPlan atomic write + re-read
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES,
  ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS,
  SOURCE_MIX_PLAN_ARTIFACT_FILENAME,
  SOURCE_MIX_PLAN_SCHEMA_VERSION,
  type MultiSourceTestIntentEnvelope,
  type SourceMixPlan,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import {
  computeSourceMixPlanHash,
  isSourceMixPlannerRefusalCode,
  planSourceMix,
  writeSourceMixPlan,
} from "./source-mix-planner.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEX = (seed: string): string => sha256Hex({ seed });
const ISO = "2026-04-26T12:34:56.000Z";

const figmaRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "figma_local_json",
  contentHash: HEX(id),
  capturedAt: ISO,
});

const jiraRestRef = (
  id: string,
  issueKey = "PAY-1234",
): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_rest",
  contentHash: HEX(id),
  capturedAt: ISO,
  canonicalIssueKey: issueKey,
});

const jiraPasteRef = (
  id: string,
  issueKey = "PAY-1234",
): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_paste",
  contentHash: HEX(id),
  capturedAt: ISO,
  canonicalIssueKey: issueKey,
});

const customMarkdownRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "custom_markdown",
  contentHash: HEX(id),
  capturedAt: ISO,
  redactedMarkdownHash: HEX(`${id}:md`),
  plainTextDerivativeHash: HEX(`${id}:plain`),
});

const customTextRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "custom_text",
  contentHash: HEX(id),
  capturedAt: ISO,
  inputFormat: "plain_text",
});

const buildEnvelope = (
  sources: TestIntentSourceRef[],
): MultiSourceTestIntentEnvelope => ({
  version: "1.0.0",
  sources,
  aggregateContentHash: HEX(JSON.stringify(sources.map((s) => s.sourceId))),
  conflictResolutionPolicy: "reviewer_decides",
});

// ---------------------------------------------------------------------------
// Contract surface
// ---------------------------------------------------------------------------

test("ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS covers all seven mix kinds", () => {
  assert.deepEqual([...ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS].sort(), [
    "figma_jira_mixed",
    "figma_jira_paste",
    "figma_jira_rest",
    "figma_only",
    "jira_mixed",
    "jira_paste_only",
    "jira_rest_only",
  ]);
});

test("ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES covers all eight codes", () => {
  assert.equal(ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES.length, 8);
  const sorted = [...ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES].sort();
  assert.ok(sorted.includes("primary_source_required"));
  assert.ok(sorted.includes("unsupported_source_mix"));
  assert.ok(sorted.includes("duplicate_jira_issue_key"));
  assert.ok(sorted.includes("custom_markdown_hash_required"));
});

test("isSourceMixPlannerRefusalCode rejects unknown strings", () => {
  assert.equal(isSourceMixPlannerRefusalCode("not_a_code"), false);
  assert.equal(isSourceMixPlannerRefusalCode(null), false);
  assert.equal(isSourceMixPlannerRefusalCode("primary_source_required"), true);
  assert.equal(isSourceMixPlannerRefusalCode("duplicate_jira_issue_key"), true);
});

// ---------------------------------------------------------------------------
// Fail-closed: primary_source_required
// ---------------------------------------------------------------------------

test("planSourceMix rejects custom-only envelope with primary_source_required", () => {
  const envelope = buildEnvelope([customTextRef("ctx.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.issues.map((i) => i.code);
    assert.ok(codes.includes("primary_source_required"));
  }
});

test("planSourceMix rejects custom_markdown-only envelope with primary_source_required", () => {
  const envelope = buildEnvelope([customMarkdownRef("md.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "primary_source_required"));
  }
});

// ---------------------------------------------------------------------------
// Source-mix matrix: figma_only
// ---------------------------------------------------------------------------

test("planSourceMix: figma_only plan has correct shape", () => {
  const envelope = buildEnvelope([figmaRef("fig.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { plan } = result;
  assert.equal(plan.version, SOURCE_MIX_PLAN_SCHEMA_VERSION);
  assert.equal(plan.kind, "figma_only");
  assert.deepEqual(plan.primarySourceIds, ["fig.0"]);
  assert.deepEqual(plan.supportingSourceIds, []);
  assert.equal(plan.visualSidecarRequirement, "optional");
  assert.deepEqual(plan.promptSections, ["figma_intent"]);
  assert.equal(plan.rawJiraResponsePersisted, false);
  assert.equal(plan.rawPasteBytesPersisted, false);
  assert.match(plan.sourceMixPlanHash, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Source-mix matrix: jira_rest_only
// ---------------------------------------------------------------------------

test("planSourceMix: jira_rest_only has visualSidecarRequirement=not_applicable", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-100")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_rest_only");
  assert.equal(result.plan.visualSidecarRequirement, "not_applicable");
  assert.deepEqual(result.plan.promptSections, ["jira_requirements"]);
});

test("planSourceMix: jira_rest_only primarySourceIds contains jira source id", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-100")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plan.primarySourceIds, ["jira.0"]);
  assert.deepEqual(result.plan.supportingSourceIds, []);
});

// ---------------------------------------------------------------------------
// Source-mix matrix: jira_paste_only
// ---------------------------------------------------------------------------

test("planSourceMix: jira_paste_only maps correctly", () => {
  const envelope = buildEnvelope([jiraPasteRef("paste.0", "PAY-200")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_paste_only");
  assert.equal(result.plan.visualSidecarRequirement, "not_applicable");
  assert.deepEqual(result.plan.promptSections, ["jira_requirements"]);
});

// ---------------------------------------------------------------------------
// Source-mix matrix: figma_jira_rest
// ---------------------------------------------------------------------------

test("planSourceMix: figma_jira_rest includes reconciliation_report", () => {
  const envelope = buildEnvelope([
    figmaRef("fig.0"),
    jiraRestRef("jira.0", "PAY-300"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "figma_jira_rest");
  assert.ok(result.plan.promptSections.includes("figma_intent"));
  assert.ok(result.plan.promptSections.includes("jira_requirements"));
  assert.ok(result.plan.promptSections.includes("reconciliation_report"));
  assert.equal(result.plan.visualSidecarRequirement, "optional");
});

// ---------------------------------------------------------------------------
// Source-mix matrix: figma_jira_paste
// ---------------------------------------------------------------------------

test("planSourceMix: figma_jira_paste maps correctly", () => {
  const envelope = buildEnvelope([
    figmaRef("fig.0"),
    jiraPasteRef("paste.0", "PAY-400"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "figma_jira_paste");
  assert.ok(result.plan.promptSections.includes("reconciliation_report"));
});

// ---------------------------------------------------------------------------
// Source-mix matrix: figma_jira_mixed
// ---------------------------------------------------------------------------

test("planSourceMix: figma_jira_mixed with different issue keys succeeds", () => {
  const envelope = buildEnvelope([
    figmaRef("fig.0"),
    jiraRestRef("rest.0", "PAY-500"),
    jiraPasteRef("paste.0", "PAY-501"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "figma_jira_mixed");
});

// ---------------------------------------------------------------------------
// Source-mix matrix: jira_mixed
// ---------------------------------------------------------------------------

test("planSourceMix: jira_mixed (no figma) with different keys succeeds", () => {
  const envelope = buildEnvelope([
    jiraRestRef("rest.0", "PAY-600"),
    jiraPasteRef("paste.0", "PAY-601"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_mixed");
  assert.equal(result.plan.visualSidecarRequirement, "not_applicable");
});

// ---------------------------------------------------------------------------
// custom_markdown supporting source
// ---------------------------------------------------------------------------

test("planSourceMix: figma + custom_markdown includes custom_context_markdown section", () => {
  const envelope = buildEnvelope([
    figmaRef("fig.0"),
    customMarkdownRef("md.0"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.plan.promptSections.includes("custom_context_markdown"));
  assert.deepEqual(result.plan.supportingSourceIds, ["md.0"]);
  assert.equal(result.plan.kind, "figma_only");
});

test("planSourceMix: jira_rest + custom_markdown includes both sections", () => {
  const envelope = buildEnvelope([
    jiraRestRef("rest.0", "PAY-700"),
    customMarkdownRef("md.0"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.plan.promptSections.includes("jira_requirements"));
  assert.ok(result.plan.promptSections.includes("custom_context_markdown"));
  assert.equal(result.plan.kind, "jira_rest_only");
});

test("planSourceMix: custom_markdown without hashes raises custom_markdown_hash_required", () => {
  const bad: TestIntentSourceRef = {
    sourceId: "md.bad",
    kind: "custom_markdown",
    contentHash: HEX("md.bad"),
    capturedAt: ISO,
  };
  const envelope = buildEnvelope([figmaRef("fig.0"), bad]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.issues.map((i) => i.code);
    assert.ok(codes.includes("custom_markdown_hash_required"));
  }
});

test("planSourceMix: custom_markdown with inputFormat raises custom_markdown_input_format_invalid", () => {
  const bad: TestIntentSourceRef = {
    sourceId: "md.bad",
    kind: "custom_markdown",
    contentHash: HEX("md.bad"),
    capturedAt: ISO,
    inputFormat: "markdown",
    redactedMarkdownHash: HEX("md.bad:rmd"),
    plainTextDerivativeHash: HEX("md.bad:plain"),
  };
  const envelope = buildEnvelope([figmaRef("fig.0"), bad]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (i) => i.code === "custom_markdown_input_format_invalid",
      ),
    );
  }
});

// ---------------------------------------------------------------------------
// Duplicate Jira issue key detection
// ---------------------------------------------------------------------------

test("planSourceMix: REST + paste with same issue key raises duplicate_jira_issue_key", () => {
  const envelope = buildEnvelope([
    jiraRestRef("rest.0", "PAY-1234"),
    jiraPasteRef("paste.0", "PAY-1234"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "duplicate_jira_issue_key"));
  }
});

test("planSourceMix: two paste sources with same key do not raise duplicate_jira_issue_key", () => {
  const paste1: TestIntentSourceRef = {
    sourceId: "paste.0",
    kind: "jira_paste",
    contentHash: HEX("paste.0"),
    capturedAt: ISO,
    canonicalIssueKey: "PAY-1234",
  };
  const paste2: TestIntentSourceRef = {
    sourceId: "paste.1",
    kind: "jira_paste",
    contentHash: HEX("paste.1"),
    capturedAt: ISO,
    canonicalIssueKey: "PAY-1234",
  };
  const envelope = buildEnvelope([figmaRef("fig.0"), paste1, paste2]);
  const result = planSourceMix(envelope);
  // Two paste sources for same key is allowed (not a REST+paste collision)
  if (!result.ok) {
    const codes = result.issues.map((i) => i.code);
    assert.ok(!codes.includes("duplicate_jira_issue_key"));
  }
});

test("planSourceMix: REST + paste with different keys succeeds", () => {
  const envelope = buildEnvelope([
    jiraRestRef("rest.0", "PAY-1111"),
    jiraPasteRef("paste.0", "PAY-2222"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_mixed");
});

// ---------------------------------------------------------------------------
// Hash determinism
// ---------------------------------------------------------------------------

test("computeSourceMixPlanHash: identical inputs produce identical hashes", () => {
  const input = {
    kind: "figma_jira_rest" as const,
    primarySourceIds: ["fig.0", "jira.0"],
    supportingSourceIds: [] as string[],
    visualSidecarRequirement: "optional" as const,
    promptSections: [
      "figma_intent",
      "jira_requirements",
      "reconciliation_report",
    ] as const,
  };
  const h1 = computeSourceMixPlanHash(input);
  const h2 = computeSourceMixPlanHash(input);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("computeSourceMixPlanHash: different mix kind produces different hash", () => {
  const base = {
    primarySourceIds: ["fig.0"],
    supportingSourceIds: [] as string[],
    visualSidecarRequirement: "optional" as const,
    promptSections: ["figma_intent"] as const,
  };
  const h1 = computeSourceMixPlanHash({ ...base, kind: "figma_only" as const });
  const h2 = computeSourceMixPlanHash({
    ...base,
    kind: "figma_jira_rest" as const,
  });
  assert.notEqual(h1, h2);
});

test("computeSourceMixPlanHash: source ID order is normalized (sorted)", () => {
  const base = {
    kind: "figma_only" as const,
    supportingSourceIds: [] as string[],
    visualSidecarRequirement: "optional" as const,
    promptSections: ["figma_intent"] as const,
  };
  const h1 = computeSourceMixPlanHash({
    ...base,
    primarySourceIds: ["fig.0", "fig.1"],
  });
  const h2 = computeSourceMixPlanHash({
    ...base,
    primarySourceIds: ["fig.1", "fig.0"],
  });
  assert.equal(h1, h2);
});

test("planSourceMix: identical envelopes produce identical plan hashes", () => {
  const envelope1 = buildEnvelope([figmaRef("fig.0")]);
  const envelope2 = buildEnvelope([figmaRef("fig.0")]);
  const r1 = planSourceMix(envelope1);
  const r2 = planSourceMix(envelope2);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.plan.sourceMixPlanHash, r2.plan.sourceMixPlanHash);
});

test("planSourceMix: different mix kind changes plan hash", () => {
  const r1 = planSourceMix(buildEnvelope([figmaRef("fig.0")]));
  const r2 = planSourceMix(buildEnvelope([jiraRestRef("jira.0", "PAY-100")]));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.notEqual(r1.plan.sourceMixPlanHash, r2.plan.sourceMixPlanHash);
});

// ---------------------------------------------------------------------------
// Hard invariants
// ---------------------------------------------------------------------------

test("planSourceMix: rawJiraResponsePersisted is always false", () => {
  const r = planSourceMix(buildEnvelope([jiraRestRef("jira.0", "PAY-100")]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.rawJiraResponsePersisted, false);
});

test("planSourceMix: rawPasteBytesPersisted is always false", () => {
  const r = planSourceMix(buildEnvelope([jiraPasteRef("paste.0", "PAY-200")]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.rawPasteBytesPersisted, false);
});

// ---------------------------------------------------------------------------
// writeSourceMixPlan
// ---------------------------------------------------------------------------

test("writeSourceMixPlan: writes artifact and content is valid JSON", async () => {
  const envelope = buildEnvelope([figmaRef("fig.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const tmpDir = await mkdtemp(join(tmpdir(), "source-mix-planner-test-"));
  try {
    const { artifactPath } = await writeSourceMixPlan(result.plan, tmpDir);
    assert.ok(artifactPath.endsWith(SOURCE_MIX_PLAN_ARTIFACT_FILENAME));
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as SourceMixPlan;
    assert.equal(parsed.version, SOURCE_MIX_PLAN_SCHEMA_VERSION);
    assert.equal(parsed.kind, "figma_only");
    assert.equal(parsed.sourceMixPlanHash, result.plan.sourceMixPlanHash);
    assert.equal(parsed.rawJiraResponsePersisted, false);
    assert.equal(parsed.rawPasteBytesPersisted, false);
  } finally {
    await rm(tmpDir, { recursive: true });
  }
});

test("writeSourceMixPlan: rejects empty runDir", async () => {
  const envelope = buildEnvelope([figmaRef("fig.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  await assert.rejects(
    () => writeSourceMixPlan(result.plan, ""),
    /runDir must be a non-empty string/,
  );
});

// ---------------------------------------------------------------------------
// Prompt sections correctness
// ---------------------------------------------------------------------------

test("planSourceMix: figma_only has only figma_intent section", () => {
  const r = planSourceMix(buildEnvelope([figmaRef("fig.0")]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.promptSections, ["figma_intent"]);
});

test("planSourceMix: jira_rest_only has only jira_requirements section", () => {
  const r = planSourceMix(buildEnvelope([jiraRestRef("jira.0", "PAY-100")]));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.promptSections, ["jira_requirements"]);
});

test("planSourceMix: figma + legacy custom_text includes custom_context section", () => {
  const r = planSourceMix(
    buildEnvelope([figmaRef("fig.0"), customTextRef("ctx.0")]),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.plan.promptSections.includes("custom_context"));
  assert.ok(!r.plan.promptSections.includes("reconciliation_report"));
});

test("planSourceMix: figma + jira + markdown includes all four sections", () => {
  const r = planSourceMix(
    buildEnvelope([
      figmaRef("fig.0"),
      jiraRestRef("jira.0", "PAY-800"),
      customMarkdownRef("md.0"),
    ]),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.plan.promptSections.includes("figma_intent"));
  assert.ok(r.plan.promptSections.includes("jira_requirements"));
  assert.ok(r.plan.promptSections.includes("custom_context_markdown"));
  assert.ok(r.plan.promptSections.includes("reconciliation_report"));
});
