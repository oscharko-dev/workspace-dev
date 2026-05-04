import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_ITERATIONS_ARTIFACT_FILENAME,
  AGENT_ITERATIONS_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type AgentIterationRecord,
} from "../contracts/index.js";
import {
  buildAgentIterationsArtifact,
  isAgentIterationsArtifact,
  writeAgentIterationsArtifact,
} from "./agent-iterations.js";
import { canonicalJson } from "./content-hash.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const baseRecord = (
  overrides: Partial<AgentIterationRecord> = {},
): AgentIterationRecord => ({
  iteration: 0,
  roleStepId: "test_repair",
  startedAt: "2026-05-04T08:00:00.000Z",
  completedAt: "2026-05-04T08:01:00.000Z",
  outcome: "needs_repair",
  findingsCount: 3,
  parentHash: HASH_A,
  ...overrides,
});

test("buildAgentIterationsArtifact sorts deterministically and dedupes", () => {
  const artifact = buildAgentIterationsArtifact({
    jobId: "job-1",
    generatedAt: "2026-05-04T08:05:00.000Z",
    iterations: [
      baseRecord({ iteration: 2, parentHash: HASH_C, outcome: "passed" }),
      baseRecord({ iteration: 0, parentHash: HASH_A }),
      baseRecord({ iteration: 1, parentHash: HASH_B, repairPlanId: "rp-7" }),
      baseRecord({ iteration: 0, parentHash: HASH_A }),
    ],
  });
  assert.equal(artifact.schemaVersion, AGENT_ITERATIONS_SCHEMA_VERSION);
  assert.equal(artifact.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(artifact.iterations.length, 3);
  assert.deepEqual(
    artifact.iterations.map((entry) => entry.iteration),
    [0, 1, 2],
  );
  assert.equal(artifact.iterations[1]?.repairPlanId, "rp-7");
});

test("buildAgentIterationsArtifact rejects malformed records", () => {
  assert.throws(
    () =>
      buildAgentIterationsArtifact({
        jobId: "job-1",
        generatedAt: "2026-05-04T08:05:00.000Z",
        iterations: [baseRecord({ iteration: -1 })],
      }),
    /invalid AgentIterationRecord/,
  );
  assert.throws(
    () =>
      buildAgentIterationsArtifact({
        jobId: "job-1",
        generatedAt: "2026-05-04T08:05:00.000Z",
        iterations: [
          baseRecord({ parentHash: "deadbeef" }),
        ],
      }),
    /invalid AgentIterationRecord/,
  );
  assert.throws(
    () =>
      buildAgentIterationsArtifact({
        jobId: "",
        generatedAt: "2026-05-04T08:05:00.000Z",
        iterations: [],
      }),
    /jobId/,
  );
  assert.throws(
    () =>
      buildAgentIterationsArtifact({
        jobId: "job-1",
        generatedAt: "not-iso",
        iterations: [],
      }),
    /generatedAt/,
  );
});

test("isAgentIterationsArtifact validates schema and rejects drift", () => {
  const ok = buildAgentIterationsArtifact({
    jobId: "job-1",
    generatedAt: "2026-05-04T08:05:00.000Z",
    iterations: [baseRecord()],
  });
  assert.equal(isAgentIterationsArtifact(ok), true);
  assert.equal(
    isAgentIterationsArtifact({ ...ok, schemaVersion: "0.0.1" }),
    false,
  );
  assert.equal(
    isAgentIterationsArtifact({ ...ok, contractVersion: "0.0.0" }),
    false,
  );
  assert.equal(
    isAgentIterationsArtifact({ ...ok, iterations: [{ iteration: 0 }] }),
    false,
  );
  assert.equal(isAgentIterationsArtifact(null), false);
  assert.equal(isAgentIterationsArtifact("not-an-object"), false);
});

test("writeAgentIterationsArtifact persists canonical-JSON byte-stably", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-agent-iter-"));
  try {
    const inputs = {
      jobId: "job-1",
      generatedAt: "2026-05-04T08:05:00.000Z",
      iterations: [
        baseRecord({ iteration: 1, parentHash: HASH_B, outcome: "passed" }),
        baseRecord({ iteration: 0, parentHash: HASH_A }),
      ],
    } as const;
    const first = await writeAgentIterationsArtifact({ runDir, ...inputs });
    const second = await writeAgentIterationsArtifact({ runDir, ...inputs });
    assert.equal(first.serialized, second.serialized);
    assert.ok(first.artifactPath.endsWith(AGENT_ITERATIONS_ARTIFACT_FILENAME));
    const onDisk = await readFile(first.artifactPath, "utf8");
    assert.equal(onDisk, `${canonicalJson(first.artifact)}\n`);
    assert.equal(isAgentIterationsArtifact(JSON.parse(onDisk)), true);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("agent-iterations: golden byte-identity for the canonical example", () => {
  const artifact = buildAgentIterationsArtifact({
    jobId: "job-golden",
    generatedAt: "2026-05-04T08:05:00.000Z",
    iterations: [
      baseRecord({
        iteration: 0,
        parentHash: HASH_A,
        outcome: "needs_repair",
        findingsCount: 3,
      }),
      baseRecord({
        iteration: 1,
        parentHash: HASH_B,
        outcome: "passed",
        findingsCount: 0,
        repairPlanId: "rp-1",
      }),
    ],
  });
  const golden =
    '{"contractVersion":"1.6.0","generatedAt":"2026-05-04T08:05:00.000Z","iterations":[' +
    '{"completedAt":"2026-05-04T08:01:00.000Z","findingsCount":3,"iteration":0,"outcome":"needs_repair","parentHash":"' +
    HASH_A +
    '","roleStepId":"test_repair","startedAt":"2026-05-04T08:00:00.000Z"},' +
    '{"completedAt":"2026-05-04T08:01:00.000Z","findingsCount":0,"iteration":1,"outcome":"passed","parentHash":"' +
    HASH_B +
    '","repairPlanId":"rp-1","roleStepId":"test_repair","startedAt":"2026-05-04T08:00:00.000Z"}' +
    '],"jobId":"job-golden","schemaVersion":"1.0.0"}';
  assert.equal(canonicalJson(artifact), golden);
});
