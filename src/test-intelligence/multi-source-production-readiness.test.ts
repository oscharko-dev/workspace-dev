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
import { access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

import type {
  FinOpsBudgetEnvelope,
  MultiSourceTestIntentEnvelope,
} from "../contracts/index.js";
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
  assert.equal(result.expectedSourceCount, fixture.envelope.sources.length);
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

test("runWave4ProductionReadiness: fails fast when the Jira API quota cap is zero", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-rest-only",
  );
  const runDir = await tmpRunDir();
  const tightEnvelope: FinOpsBudgetEnvelope = {
    budgetId: "tight-jira-api",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: 0,
      maxJiraPasteBytesPerJob: 524288,
      maxCustomContextBytesPerJob: 262144,
    },
  };
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "jira_rest_only",
    envelope: fixture.envelope,
    jiraRestResponse: fixture.jiraRestResponse,
    runDir,
    finopsBudget: tightEnvelope,
  });
  assert.equal(result.ok, false);
  assert.equal(result.quotasPassed, false);
  assert.equal(result.quotaBreachReason, "jira_api_quota_exceeded");
  assert.equal(result.expectedSourceCount, fixture.envelope.sources.length);
});

test("runWave4ProductionReadiness: air-gap paste fixture makes no fetch calls", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-paste-only-airgap",
  );
  const runDir = await tmpRunDir();
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("air-gap test forbids fetch");
  }) as typeof fetch;
  try {
    const result = await runWave4ProductionReadiness({
      fixtureId: fixture.fixtureId,
      mixId: "jira_paste_only",
      envelope: fixture.envelope,
      jiraPasteText: fixture.jiraPasteText,
      runDir,
      finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
    });
    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
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

test("runWave4ProductionReadiness: concurrent runs to separate runDirs do not interfere", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  const [dirA, dirB] = await Promise.all([tmpRunDir(), tmpRunDir()]);
  const opts = {
    fixtureId: fixture.fixtureId,
    mixId: "figma_plus_jira_plus_custom" as const,
    envelope: fixture.envelope,
    figmaJson: fixture.figmaJson,
    visualDescriptions: Array.isArray(fixture.visualJson)
      ? (fixture.visualJson as unknown[])
      : undefined,
    jiraRestResponse: fixture.jiraRestResponse,
    customContextInput: fixture.customContextJson,
    finopsBudget: EU_BANKING_DEFAULT_FINOPS_BUDGET,
  };
  const [resultA, resultB] = await Promise.all([
    runWave4ProductionReadiness({ ...opts, runDir: dirA }),
    runWave4ProductionReadiness({ ...opts, runDir: dirB }),
  ]);
  assert.equal(resultA.ok, true, "run A should succeed");
  assert.equal(resultB.ok, true, "run B should succeed");
  assert.notEqual(resultA.runDir, resultB.runDir, "run dirs must be distinct");
  assert.equal(resultA.rawScreenshotsIncluded, false);
  assert.equal(resultB.rawScreenshotsIncluded, false);
});

test("runWave4ProductionReadiness: envelope with zero sources returns ok=true with empty summaries", async () => {
  const emptyEnvelope: MultiSourceTestIntentEnvelope = {
    version: "1.0.0",
    sources: [],
    aggregateContentHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
    conflictResolutionPolicy: "reviewer_decides",
  };
  const runDir = await tmpRunDir();
  const result = await runWave4ProductionReadiness({
    fixtureId: "release-multisource-onboarding",
    mixId: "figma_only",
    envelope: emptyEnvelope,
    runDir,
  });
  assert.equal(result.quotasPassed, true, "no sources means no quota breach");
  assert.equal(result.sourceProvenanceSummaries.length, 0);
  assert.equal(result.rawJiraResponsePersisted, false);
  assert.equal(result.rawPasteBytesPersisted, false);
});

test("runWave4ProductionReadiness: artifact files are written and accessible after run", async () => {
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
  for (const summary of result.sourceProvenanceSummaries) {
    await assert.doesNotReject(
      access(summary.irArtifactPath),
      `artifact at ${summary.irArtifactPath} must exist`,
    );
  }
});

test("runWave4ProductionReadiness: custom-context-quota breach — zero cap against markdown fixture", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-custom-markdown-adversarial",
  );
  const runDir = await tmpRunDir();
  const tightEnvelope: FinOpsBudgetEnvelope = {
    budgetId: "tight-custom",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: 20,
      maxJiraPasteBytesPerJob: 524288,
      maxCustomContextBytesPerJob: 0,
    },
  };
  const result = await runWave4ProductionReadiness({
    fixtureId: fixture.fixtureId,
    mixId: "custom_markdown_only",
    envelope: fixture.envelope,
    customContextMarkdown: fixture.customContextMarkdown,
    runDir,
    finopsBudget: tightEnvelope,
  });
  assert.equal(result.ok, false);
  assert.equal(result.quotasPassed, false);
  assert.equal(result.quotaBreachReason, "custom_context_quota_exceeded");
  assert.equal(result.rawPasteBytesPersisted, false);
});
