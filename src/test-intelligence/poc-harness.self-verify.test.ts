/**
 * Wave 1 POC harness golden test for the self-verify rubric pass
 * (Issue #1379).
 *
 * Pins three load-bearing invariants of the rubric-enabled run:
 *
 *   1. The persisted `<runDir>/testcases/self-verify-rubric.json`
 *      bytes are byte-identical across two replays of the same
 *      fixture (deterministic mock client, deterministic cache key).
 *   2. The evidence manifest digest is byte-identical across two
 *      replays. This is what an in-toto verifier checks — a
 *      regression here would silently break the Wave 1 attestation.
 *   3. The rubric artifact is registered on the manifest with
 *      category `self_verify_rubric` and a non-empty SHA-256 digest.
 *
 * The test runs against every shipped Wave 1 POC fixture so a future
 * fixture addition is automatically covered. No fixture file is
 * checked in for the rubric report — the byte-stability invariant is
 * enforced via cross-run comparison (which is strictly stronger than
 * a checked-in golden because it also catches non-determinism in
 * downstream randomness, e.g. `randomUUID()` in atomic temp filenames
 * leaking into persisted artifacts).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY,
  SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
  WAVE1_POC_FIXTURE_IDS,
  type SelfVerifyRubricReport,
  type Wave1PocFixtureId,
} from "../contracts/index.js";
import { computeWave1PocEvidenceManifestDigest } from "./evidence-manifest.js";
import { runWave1Poc } from "./poc-harness.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const newRunDir = async (label: string): Promise<string> =>
  mkdtemp(join(tmpdir(), `wave1-poc-rubric-${label}-`));

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RUBRIC_ARTIFACT_PATH = `${SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY}/${SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME}`;

for (const fixtureId of WAVE1_POC_FIXTURE_IDS) {
  test(`poc-harness rubric: ${fixtureId} replay is byte-stable`, async () => {
    const runA = await newRunDir(`${fixtureId}-a`);
    const runB = await newRunDir(`${fixtureId}-b`);
    try {
      const a = await runWave1Poc({
        fixtureId: fixtureId as Wave1PocFixtureId,
        jobId: `job-${fixtureId}-rubric`,
        generatedAt: GENERATED_AT,
        runDir: runA,
        selfVerifyRubric: { enabled: true },
      });
      const b = await runWave1Poc({
        fixtureId: fixtureId as Wave1PocFixtureId,
        jobId: `job-${fixtureId}-rubric`,
        generatedAt: GENERATED_AT,
        runDir: runB,
        selfVerifyRubric: { enabled: true },
      });

      // (1) Rubric artifact bytes are byte-identical across replays.
      const aBytes = await readFile(
        a.selfVerifyRubricArtifactPath ?? "",
        "utf8",
      );
      const bBytes = await readFile(
        b.selfVerifyRubricArtifactPath ?? "",
        "utf8",
      );
      assert.equal(aBytes, bBytes, "rubric artifact must be byte-stable");

      // (2) Manifest digest is byte-identical (the in-toto attestation root).
      const aDigest = computeWave1PocEvidenceManifestDigest(a.manifest);
      const bDigest = computeWave1PocEvidenceManifestDigest(b.manifest);
      assert.equal(aDigest, bDigest, "manifest digest must be byte-stable");

      // (3) Rubric artifact is registered on the manifest with the
      //     correct category and a non-empty SHA-256 digest.
      const rubricEntry = a.manifest.artifacts.find(
        (artifact) => artifact.filename === RUBRIC_ARTIFACT_PATH,
      );
      assert.ok(rubricEntry, "manifest must attest the rubric artifact");
      assert.equal(rubricEntry?.category, "self_verify_rubric");
      assert.match(rubricEntry?.sha256 ?? "", SHA256_HEX);
      assert.ok((rubricEntry?.bytes ?? 0) > 0);

      // Result-shape sanity: report has no refusal, every test case
      // received a perfect score, job-level aggregate is 1, schema
      // version stamp matches the contract.
      const report = a.selfVerifyRubric;
      assert.ok(report);
      assert.equal(
        report?.schemaVersion,
        SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
      );
      assert.equal(report?.refusal, undefined);
      assert.equal(
        report?.aggregate.jobLevelRubricScore,
        1,
        "synth client returns perfect scores",
      );
      const evaluations = report?.caseEvaluations ?? [];
      assert.equal(evaluations.length, a.generatedList.testCases.length);
      for (const evaluation of evaluations) {
        assert.equal(evaluation.rubricScore, 1);
        assert.equal(
          evaluation.dimensions.length,
          ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
        );
      }

      // Coverage report's rubricScore mirrors the job-level aggregate.
      assert.equal(a.validation.coverage.rubricScore, 1);

      // The on-disk rubric report parses back to a valid
      // SelfVerifyRubricReport — JSON shape sanity in addition to byte
      // stability. The persisted bytes are canonicalJson, so parsing
      // must not throw.
      const parsed = JSON.parse(aBytes) as SelfVerifyRubricReport;
      assert.equal(
        parsed.schemaVersion,
        SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
      );
      assert.equal(parsed.cacheHit, false);
      assert.match(parsed.cacheKeyDigest, SHA256_HEX);
    } finally {
      await rm(runA, { recursive: true, force: true });
      await rm(runB, { recursive: true, force: true });
    }
  });
}

test("poc-harness rubric: disabled run produces no rubric artifact (byte-stable disabled path)", async () => {
  const runA = await newRunDir("disabled-a");
  const runB = await newRunDir("disabled-b");
  try {
    const commonInput = {
      fixtureId: WAVE1_POC_FIXTURE_IDS[0] as Wave1PocFixtureId,
      jobId: "job-rubric-disabled",
      generatedAt: GENERATED_AT,
    };
    const result = await runWave1Poc({ ...commonInput, runDir: runA });
    const baseline = await runWave1Poc({ ...commonInput, runDir: runB });

    assert.equal(result.selfVerifyRubric, undefined);
    assert.equal(result.selfVerifyRubricArtifactPath, undefined);
    const rubricEntry = result.manifest.artifacts.find(
      (artifact) => artifact.filename === RUBRIC_ARTIFACT_PATH,
    );
    assert.equal(
      rubricEntry,
      undefined,
      "manifest must NOT attest the rubric artifact when self-verify is disabled",
    );
    assert.equal(result.validation.rubric, undefined);
    assert.equal(result.validation.coverage.rubricScore, undefined);
    assert.equal(
      computeWave1PocEvidenceManifestDigest(result.manifest),
      computeWave1PocEvidenceManifestDigest(baseline.manifest),
    );
    assert.deepEqual(
      result.manifest.artifacts.map((artifact) => artifact.filename).sort(),
      baseline.manifest.artifacts.map((artifact) => artifact.filename).sort(),
    );
    for (const artifact of result.manifest.artifacts) {
      const left = await readFile(join(runA, artifact.filename));
      const right = await readFile(join(runB, artifact.filename));
      assert.deepEqual(
        left,
        right,
        `${artifact.filename} must stay byte-stable`,
      );
    }
  } finally {
    await rm(runA, { recursive: true, force: true });
    await rm(runB, { recursive: true, force: true });
  }
});
