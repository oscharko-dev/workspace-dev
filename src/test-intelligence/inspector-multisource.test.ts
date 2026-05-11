import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type MultiSourceReconciliationReport,
} from "../contracts/index.js";
import {
  listInspectorSourceRecords,
  markInspectorSourceRemoved,
  readInspectorSourceEnvelope,
  projectInspectorConflictStates,
  readInspectorConflictDecisions,
  readInspectorReconciliationReport,
  resolveInspectorConflict,
} from "./inspector-multisource.js";
import { buildMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";

const ASSEMBLED_AT = "2026-04-27T12:00:00.000Z";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, JSON.stringify(value), "utf8");
};

const writeConflictReport = async (dir: string): Promise<void> => {
  const report: MultiSourceReconciliationReport = {
    version: MULTI_SOURCE_RECONCILIATION_REPORT_SCHEMA_VERSION,
    envelopeHash: "a".repeat(64),
    conflicts: [
      {
        conflictId: "conflict-1",
        kind: "field_label_mismatch",
        participatingSourceIds: ["figma-primary", "jira-primary"],
        normalizedValues: ["Login", "Sign in"],
        resolution: "deferred_to_reviewer",
        affectedScreenIds: ["screen-login"],
      },
    ],
    unmatchedSources: [],
    contributingSourcesPerCase: [],
    policyApplied: "reviewer_decides",
    transcript: [],
  };
  await writeJson(join(dir, "multi-source-conflicts.json"), report);
};

test("inspector-multisource: resolveInspectorConflict appends to the file-backed log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspector-multisource-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeConflictReport(dir);

    const result = await resolveInspectorConflict({
      runDir: dir,
      jobId: "job-1",
      conflictId: "conflict-1",
      actor: "alice",
      at: ASSEMBLED_AT,
      action: "approve",
      selectedSourceId: "jira-primary",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.snapshot.state, "approved");
    assert.equal(result.snapshot.actor, "alice");

    const report = await readInspectorReconciliationReport(dir);
    const decisions = await readInspectorConflictDecisions({
      runDir: dir,
      jobId: "job-1",
    });
    const projection = projectInspectorConflictStates({
      report,
      decisions: decisions.byConflictId,
    });

    assert.equal(decisions.events.length, 1);
    assert.equal(decisions.byConflictId["conflict-1"]?.state, "approved");
    assert.equal(projection.conflicts[0]?.effectiveState, "resolved");
    assert.equal(projection.conflicts[0]?.resolvedBy, "alice");
    assert.equal(projection.conflicts[0]?.resolvedAt, ASSEMBLED_AT);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inspector-multisource: approve without a selection fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "inspector-multisource-invalid-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeConflictReport(dir);

    const result = await resolveInspectorConflict({
      runDir: dir,
      jobId: "job-1",
      conflictId: "conflict-1",
      actor: "alice",
      at: ASSEMBLED_AT,
      action: "approve",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "conflict_resolution_invalid");
    }
    const decisions = await readInspectorConflictDecisions({
      runDir: dir,
      jobId: "job-1",
    });
    assert.equal(decisions.events.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "inspector-multisource: removed sources stay excluded from sourceEnvelope and source records",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "inspector-multisource-removed-"));
    try {
      const sourceEnvelope = buildMultiSourceTestIntentEnvelope({
        conflictResolutionPolicy: "keep_both",
        sources: [
          {
            sourceId: "figma-primary-1",
            kind: "figma_local_json",
            contentHash: "a".repeat(64),
            capturedAt: ASSEMBLED_AT,
          },
          {
            sourceId: "jira-paste-1",
            kind: "jira_paste",
            contentHash: "b".repeat(64),
            capturedAt: ASSEMBLED_AT,
          },
        ],
      });
      const intent: BusinessTestIntentIr = {
        version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
        source: { kind: "figma_local_json", contentHash: "a".repeat(64) },
        screens: [],
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
        sourceEnvelope,
      };
      await writeFile(
        join(dir, "business-intent-ir.json"),
        JSON.stringify(intent),
        "utf8",
      );
      await mkdir(join(dir, "sources", "jira-paste-1"), { recursive: true });
      await writeFile(
        join(dir, "sources", "jira-paste-1", "jira-issue-ir.json"),
        JSON.stringify({
          contentHash: "b".repeat(64),
          issueKey: "PAY-1437",
        }),
        "utf8",
      );

      await markInspectorSourceRemoved({
        runDir: dir,
        jobId: "job-1",
        sourceId: "jira-paste-1",
        removedBy: "alice",
        removedAt: ASSEMBLED_AT,
      });

      const envelope = await readInspectorSourceEnvelope(dir);
      assert.ok(envelope);
      assert.deepEqual(
        envelope?.sources.map((source) => source.sourceId),
        ["figma-primary-1"],
      );

      const records = await listInspectorSourceRecords(dir);
      assert.deepEqual(
        records.map((record) => record.sourceId),
        ["figma-primary-1"],
      );

      const tombstone = JSON.parse(
        await readFile(join(dir, "removed-sources.json"), "utf8"),
      ) as {
        jobId: string;
        removedSources: Array<{ sourceId: string; removedBy?: string }>;
      };
      assert.equal(tombstone.jobId, "job-1");
      assert.equal(tombstone.removedSources[0]?.sourceId, "jira-paste-1");
      assert.equal(tombstone.removedSources[0]?.removedBy, "alice");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
