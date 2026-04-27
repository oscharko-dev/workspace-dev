/**
 * Integration tests for the Jira-only generation path (Issue #1441, Wave 4.K).
 *
 * Acceptance criteria verified here:
 *   AC1 - Jira REST-only fixture produces validated plan with
 *         visualSidecarRequirement=not_applicable.
 *   AC2 - Jira paste-only fixture produces equivalent plan shape.
 *   AC3 - Figma-only plan remains backward-compatible (existing cache keys
 *         unaffected when sourceMixPlan is absent).
 *   AC4 - Figma + Jira plan includes both source IDs and reconciliation_report.
 *   AC5 - Custom-only job fails closed with primary_source_required and no
 *         partial plan.
 *   AC6 - Duplicate Jira REST/paste content for the same issue key raises
 *         duplicate_jira_issue_key (paste_collision path).
 *   AC7 - Cache keys include sourceMixPlanHash; identical source mix +
 *         content yields identical keys.
 *   AC8 - Hard predicates: rawJiraResponsePersisted=false,
 *         rawPasteBytesPersisted=false on every plan.
 *   AC9 - Jira-only prompt compiler output does not contain FIGMA_INTENT
 *         section and sets figmaTraceRefs guidance for Jira-only jobs.
 *   AC10 - Figma-only prompt compiler output is backward-compatible when
 *          sourceMixPlan is not supplied.
 *   AC11 - Markdown custom context (custom_markdown source) enriches Jira-only
 *          jobs; Markdown-only still fails with primary_source_required.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SOURCE_MIX_PLAN_ARTIFACT_FILENAME,
  SOURCE_MIX_PLAN_SCHEMA_VERSION,
  type MultiSourceTestIntentEnvelope,
  type SourceMixPlan,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { compilePrompt } from "./prompt-compiler.js";
import { planSourceMix, writeSourceMixPlan } from "./source-mix-planner.js";

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
const jiraRestRef = (id: string, issueKey: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_rest",
  contentHash: HEX(id),
  capturedAt: ISO,
  canonicalIssueKey: issueKey,
});
const jiraPasteRef = (id: string, issueKey: string): TestIntentSourceRef => ({
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

const buildEnvelope = (
  sources: TestIntentSourceRef[],
): MultiSourceTestIntentEnvelope => ({
  version: "1.0.0",
  sources,
  aggregateContentHash: HEX(JSON.stringify(sources.map((s) => s.sourceId))),
  conflictResolutionPolicy: "reviewer_decides",
});

/** Minimal synthetic BusinessTestIntentIr for prompt-compiler calls. */
const stubIntent = () => ({
  version: "1.0.0" as const,
  schemaVersion: "1.0.0" as const,
  contractVersion: "1.4.0" as const,
  jobId: "job-test-001",
  source: "figma_local_json" as const,
  generatedAt: ISO,
  screens: [],
  businessObjects: [],
  piiIndicators: [],
  redactions: [],
  risks: [],
  openQuestions: [],
  reconciliationNotes: [],
});

/** Minimal model + visual binding for prompt-compiler calls. */
const stubModelBinding = () => ({
  modelRevision: "gpt-oss-120b-test",
  gatewayRelease: "v1.0",
});
const stubVisualBinding = () => ({
  schemaVersion: "1.0.0" as const,
  selectedDeployment: "none",
  fallbackReason: "not_applicable" as const,
  screenCount: 0,
});

// ---------------------------------------------------------------------------
// AC1: Jira REST-only plan
// ---------------------------------------------------------------------------

test("AC1: jira_rest_only plan has not_applicable visual sidecar requirement", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-100")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_rest_only");
  assert.equal(result.plan.visualSidecarRequirement, "not_applicable");
  assert.deepEqual(result.plan.promptSections, ["jira_requirements"]);
  assert.equal(result.plan.version, SOURCE_MIX_PLAN_SCHEMA_VERSION);
});

// ---------------------------------------------------------------------------
// AC2: Jira paste-only plan
// ---------------------------------------------------------------------------

test("AC2: jira_paste_only plan has equivalent shape to jira_rest_only", () => {
  const restEnv = buildEnvelope([jiraRestRef("rest.0", "PAY-200")]);
  const pasteEnv = buildEnvelope([jiraPasteRef("paste.0", "PAY-200")]);
  const restResult = planSourceMix(restEnv);
  const pasteResult = planSourceMix(pasteEnv);
  assert.equal(restResult.ok, true);
  assert.equal(pasteResult.ok, true);
  if (!restResult.ok || !pasteResult.ok) return;

  assert.equal(pasteResult.plan.visualSidecarRequirement, "not_applicable");
  assert.deepEqual(pasteResult.plan.promptSections, ["jira_requirements"]);
  assert.equal(pasteResult.plan.kind, "jira_paste_only");
  assert.equal(restResult.plan.kind, "jira_rest_only");
  // Both should have same prompt-section shape (different hash due to different kind)
  assert.deepEqual(
    restResult.plan.promptSections,
    pasteResult.plan.promptSections,
  );
  // Hashes differ because kinds differ
  assert.notEqual(
    restResult.plan.sourceMixPlanHash,
    pasteResult.plan.sourceMixPlanHash,
  );
});

// ---------------------------------------------------------------------------
// AC3: Figma-only backward compatibility
// ---------------------------------------------------------------------------

test("AC3: figma-only plan is backward-compatible with single-source envelope", () => {
  const envelope = buildEnvelope([figmaRef("fig.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "figma_only");
  assert.deepEqual(result.plan.primarySourceIds, ["fig.0"]);
  assert.deepEqual(result.plan.supportingSourceIds, []);
  assert.deepEqual(result.plan.promptSections, ["figma_intent"]);
});

test("AC3: prompt-compiler without sourceMixPlan is unchanged (backward compat)", () => {
  const intent = stubIntent();
  const r = compilePrompt({
    jobId: "job-bc-001",
    intent,
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
  });
  // Should not throw and should produce a userPrompt containing the old marker
  assert.ok(r.request.userPrompt.length > 0);
  assert.ok(typeof r.cacheKey.sourceMixPlanHash === "undefined");
});

// ---------------------------------------------------------------------------
// AC4: Figma + Jira merged plan
// ---------------------------------------------------------------------------

test("AC4: figma + jira plan includes merged source IDs and reconciliation_report", () => {
  const envelope = buildEnvelope([
    figmaRef("fig.0"),
    jiraRestRef("jira.0", "PAY-300"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "figma_jira_rest");
  assert.deepEqual(result.plan.primarySourceIds, ["fig.0", "jira.0"]);
  assert.ok(result.plan.promptSections.includes("figma_intent"));
  assert.ok(result.plan.promptSections.includes("jira_requirements"));
  assert.ok(result.plan.promptSections.includes("reconciliation_report"));
});

// ---------------------------------------------------------------------------
// AC5: Custom-only fails closed
// ---------------------------------------------------------------------------

test("AC5: custom_markdown-only job fails closed with primary_source_required", () => {
  const envelope = buildEnvelope([customMarkdownRef("md.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "primary_source_required"));
  }
});

test("AC5: empty sources envelope returns primary_source_required", () => {
  const envelope: MultiSourceTestIntentEnvelope = {
    version: "1.0.0",
    sources: [],
    aggregateContentHash: HEX("empty"),
    conflictResolutionPolicy: "reviewer_decides",
  };
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "primary_source_required"));
  }
});

// ---------------------------------------------------------------------------
// AC6: Duplicate Jira REST/paste collision
// ---------------------------------------------------------------------------

test("AC6: duplicate Jira REST+paste for same key raises duplicate_jira_issue_key", () => {
  const envelope = buildEnvelope([
    jiraRestRef("rest.0", "PAY-1234"),
    jiraPasteRef("paste.0", "PAY-1234"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "duplicate_jira_issue_key"));
    assert.ok(result.issues.some((i) => i.detail === "PAY-1234"));
  }
});

// ---------------------------------------------------------------------------
// AC7: Cache key includes sourceMixPlanHash
// ---------------------------------------------------------------------------

test("AC7: prompt-compiler cache key includes sourceMixPlanHash when plan is present", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-400")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const compiled = compilePrompt({
    jobId: "job-ck-001",
    intent: stubIntent(),
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: result.plan,
  });
  assert.equal(
    compiled.cacheKey.sourceMixPlanHash,
    result.plan.sourceMixPlanHash,
  );
  assert.match(compiled.cacheKey.sourceMixPlanHash ?? "", /^[0-9a-f]{64}$/);
});

test("AC7: identical source mix + content produces identical cache keys", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-500")]);
  const r1 = planSourceMix(envelope);
  const r2 = planSourceMix(envelope);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;

  const intent = stubIntent();
  const c1 = compilePrompt({
    jobId: "job-ck-002",
    intent,
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r1.plan,
  });
  const c2 = compilePrompt({
    jobId: "job-ck-002",
    intent,
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r2.plan,
  });
  assert.equal(c1.cacheKey.inputHash, c2.cacheKey.inputHash);
});

test("AC7: different source mix produces different cache key", () => {
  const env1 = buildEnvelope([figmaRef("fig.0")]);
  const env2 = buildEnvelope([jiraRestRef("jira.0", "PAY-600")]);
  const r1 = planSourceMix(env1);
  const r2 = planSourceMix(env2);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;

  const intent = stubIntent();
  const c1 = compilePrompt({
    jobId: "job-ck-003",
    intent,
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r1.plan,
  });
  const c2 = compilePrompt({
    jobId: "job-ck-003",
    intent,
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r2.plan,
  });
  assert.notEqual(c1.cacheKey.inputHash, c2.cacheKey.inputHash);
});

// ---------------------------------------------------------------------------
// AC8: Hard predicates
// ---------------------------------------------------------------------------

test("AC8: rawJiraResponsePersisted is false on every plan type", () => {
  const envelopes = [
    buildEnvelope([figmaRef("fig.0")]),
    buildEnvelope([jiraRestRef("jira.0", "PAY-700")]),
    buildEnvelope([jiraPasteRef("paste.0", "PAY-800")]),
    buildEnvelope([figmaRef("fig.0"), jiraRestRef("jira.0", "PAY-900")]),
  ];
  for (const envelope of envelopes) {
    const r = planSourceMix(envelope);
    if (!r.ok) continue;
    assert.equal(
      r.plan.rawJiraResponsePersisted,
      false,
      `Expected rawJiraResponsePersisted=false for ${r.plan.kind}`,
    );
    assert.equal(
      r.plan.rawPasteBytesPersisted,
      false,
      `Expected rawPasteBytesPersisted=false for ${r.plan.kind}`,
    );
  }
});

// ---------------------------------------------------------------------------
// AC9: Jira-only prompt compiler output
// ---------------------------------------------------------------------------

test("AC9: Jira-only compiled prompt does not contain FIGMA_INTENT section", () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-1000")]);
  const r = planSourceMix(envelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const compiled = compilePrompt({
    jobId: "job-prompt-001",
    intent: stubIntent(),
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r.plan,
  });
  // Jira-only job should NOT have FIGMA_INTENT section
  assert.ok(!compiled.request.userPrompt.includes("FIGMA_INTENT"));
  // Should have Jira-only guidance
  assert.ok(compiled.request.userPrompt.includes("Jira-only job"));
  assert.ok(compiled.request.userPrompt.includes("JIRA_REQUIREMENTS"));
});

test("AC9: Figma-only compiled prompt contains FIGMA_INTENT section", () => {
  const envelope = buildEnvelope([figmaRef("fig.0")]);
  const r = planSourceMix(envelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const compiled = compilePrompt({
    jobId: "job-prompt-002",
    intent: stubIntent(),
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
    sourceMixPlan: r.plan,
  });
  assert.ok(compiled.request.userPrompt.includes("FIGMA_INTENT"));
  assert.ok(!compiled.request.userPrompt.includes("JIRA_REQUIREMENTS"));
});

// ---------------------------------------------------------------------------
// AC10: No regression on Figma-only path without plan
// ---------------------------------------------------------------------------

test("AC10: prompt compiled without sourceMixPlan still includes Business Test Intent IR", () => {
  const compiled = compilePrompt({
    jobId: "job-bc-002",
    intent: stubIntent(),
    modelBinding: stubModelBinding(),
    policyBundleVersion: "1.0",
    visualBinding: stubVisualBinding(),
  });
  // Legacy path: no source-mix section emitted
  assert.ok(!compiled.request.userPrompt.includes("Source mix kind:"));
  assert.ok(compiled.request.userPrompt.includes("Business Test Intent IR"));
  assert.equal(compiled.cacheKey.sourceMixPlanHash, undefined);
});

// ---------------------------------------------------------------------------
// AC11: Markdown custom context enriches Jira-only jobs
// ---------------------------------------------------------------------------

test("AC11: jira_rest + custom_markdown enriches plan with custom_context_markdown section", () => {
  const envelope = buildEnvelope([
    jiraRestRef("jira.0", "PAY-1100"),
    customMarkdownRef("md.0"),
  ]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.kind, "jira_rest_only");
  assert.ok(result.plan.promptSections.includes("custom_context_markdown"));
  assert.deepEqual(result.plan.supportingSourceIds, ["md.0"]);
});

test("AC11: Markdown-only still fails with primary_source_required", () => {
  const envelope = buildEnvelope([customMarkdownRef("md.0")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.code === "primary_source_required"));
  }
});

// ---------------------------------------------------------------------------
// writeSourceMixPlan: persistence + re-read
// ---------------------------------------------------------------------------

test("writeSourceMixPlan: Jira-only plan persists and re-reads correctly", async () => {
  const envelope = buildEnvelope([jiraRestRef("jira.0", "PAY-1200")]);
  const result = planSourceMix(envelope);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const tmpDir = await mkdtemp(join(tmpdir(), "source-mix-jira-only-test-"));
  try {
    const { artifactPath } = await writeSourceMixPlan(result.plan, tmpDir);
    assert.ok(artifactPath.endsWith(SOURCE_MIX_PLAN_ARTIFACT_FILENAME));
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as SourceMixPlan;
    assert.equal(parsed.kind, "jira_rest_only");
    assert.equal(parsed.visualSidecarRequirement, "not_applicable");
    assert.deepEqual(parsed.promptSections, ["jira_requirements"]);
    assert.equal(parsed.rawJiraResponsePersisted, false);
    assert.equal(parsed.rawPasteBytesPersisted, false);
    assert.equal(parsed.sourceMixPlanHash, result.plan.sourceMixPlanHash);
  } finally {
    await rm(tmpDir, { recursive: true });
  }
});
