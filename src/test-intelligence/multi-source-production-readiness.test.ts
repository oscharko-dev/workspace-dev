/**
 * Integration tests for the Wave 4.I production-readiness harness
 * (`runWave4ProductionReadiness`) — Issue #1439.
 *
 * Each test loads a real fixture, runs the harness end-to-end against a
 * temporary directory, and asserts the result invariants and quota-gate
 * behavior.
 */

import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import type { FinOpsBudgetEnvelope } from "../contracts/index.js";
import { EU_BANKING_DEFAULT_FINOPS_BUDGET } from "./finops-budget.js";
import { loadWave4ProductionReadinessFixture } from "./multi-source-fixtures.js";
import { runWave4ProductionReadiness } from "./multi-source-production-readiness.js";

const tmpRunDir = (): Promise<string> =>
  mkdtemp(join(os.tmpdir(), "wave4-pr-"));

test("runWave4ProductionReadiness: onboarding fixture runs OK and emits provenance summaries", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "figma_plus_jira_plus_custom",
    envelope: fixture.envelope,
    figmaJson: fixture.figmaJson,
    visualDescriptions: Array.isArray(fixture.visualJson)
      ? (fixture.visualJson as unknown[])
      : undefined,
    jiraRestResponse: fixture.jiraRestResponse,
    customContextInput: fixture.customContextJson,
    runDir,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  });
  assert.equal(result.ok, true);
  assert.equal(result.quotasPassed, true);
  assert.ok(result.sourceProvenanceSummaries.length > 0);
});

test("runWave4ProductionReadiness: hard invariants always hold on a successful run", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "figma_plus_jira_plus_custom",
    envelope: fixture.envelope,
    figmaJson: fixture.figmaJson,
    visualDescriptions: Array.isArray(fixture.visualJson)
      ? (fixture.visualJson as unknown[])
      : undefined,
    jiraRestResponse: fixture.jiraRestResponse,
    customContextInput: fixture.customContextJson,
    runDir,
  });
  assert.equal(result.rawScreenshotsIncluded, false);
  assert.equal(result.secretsIncluded, false);
  assert.equal(result.rawJiraResponsePersisted, false);
  assert.equal(result.rawPasteBytesPersisted, false);
});

test("runWave4ProductionReadiness: paste-only air-gap fixture runs OK against the EU-banking budget", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-paste-only-airgap",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "jira_paste_only",
    envelope: fixture.envelope,
    jiraPasteText: fixture.jiraPasteText,
    customContextInput: fixture.customContextJson,
    runDir,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  });
  assert.equal(result.ok, true);
  assert.equal(result.quotasPassed, true);
});

test("runWave4ProductionReadiness: fails fast when the paste-quota cap is zero", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-paste-only-airgap",
  );
  const runDir = await tmpRunDir();
  const tightEnvelope: FinOpsBudgetEnvelope = {
    budgetId: "tight-test",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: 20,
      maxJiraPasteBytesPerJob: 0,
      maxCustomContextBytesPerJob: 262144,
    },
  };
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "jira_paste_only",
    envelope: fixture.envelope,
    jiraPasteText: "x",
    runDir,
    finopsBudget: tightEnvelope,
  });
  assert.equal(result.ok, false);
  assert.equal(result.quotasPassed, false);
  assert.equal(result.quotaBreachReason, "jira_paste_quota_exceeded");
});

test("runWave4ProductionReadiness: throws TypeError when runDir is missing/empty", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  await assert.rejects(
    () =>
      runWave4ProductionReadiness({
        fixtureId: fixture.fixtureId,
        mixId: "figma_plus_jira_plus_custom",
        envelope: fixture.envelope,
        runDir: "",
      }),
    (err) => err instanceof TypeError,
  );
});

test("runWave4ProductionReadiness: jira-rest-only fixture runs OK", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-rest-only",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "jira_rest_only",
    envelope: fixture.envelope,
    jiraRestResponse: fixture.jiraRestResponse,
    runDir,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  });
  assert.equal(result.ok, true);
  assert.equal(result.quotasPassed, true);
});

test("runWave4ProductionReadiness: figma-only regression fixture runs OK", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-figma-only-regression",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "figma_only",
    envelope: fixture.envelope,
    figmaJson: fixture.figmaJson,
    visualDescriptions: Array.isArray(fixture.visualJson)
      ? (fixture.visualJson as unknown[])
      : undefined,
    runDir,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  });
  assert.equal(result.ok, true);
  assert.equal(result.quotasPassed, true);
});

test("runWave4ProductionReadiness: all-sources-with-conflict fixture returns ok=true (conflicts logged not fatal)", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-all-sources-with-conflict",
  );
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "all_sources_with_conflict",
    envelope: fixture.envelope,
    figmaJson: fixture.figmaJson,
    visualDescriptions: Array.isArray(fixture.visualJson)
      ? (fixture.visualJson as unknown[])
      : undefined,
    jiraRestResponse: fixture.jiraRestResponse,
    jiraPasteText: fixture.jiraPasteText,
    customContextInput: fixture.customContextJson,
    runDir,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  });
  assert.equal(result.ok, true);
});
