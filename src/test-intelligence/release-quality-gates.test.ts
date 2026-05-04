import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_RELEASE_QUALITY_GATE_IDS,
  RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME,
  RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION,
  RELEASE_QUALITY_GATES_THRESHOLDS,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ReleaseQualityGateId,
  type ReleaseQualityGatesInput,
} from "../contracts/index.js";
import {
  evaluateReleaseQualityGates,
  isReleaseQualityGatesInput,
  parseReleaseQualityGatesReport,
  serializeReleaseQualityGatesReport,
  writeReleaseQualityGatesReport,
} from "./release-quality-gates.js";

const buildPassingInput = (): ReleaseQualityGatesInput => ({
  schemaVersion: RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  releaseId: "release-1801-test",
  mutation: {
    fixtures: [
      {
        fixtureId: "fix-a",
        mutationCount: 10,
        killedMutations: 9,
        mutationKillRate: 0.9,
        survivingMutationsForRepair: ["mut-a-1"],
      },
      {
        fixtureId: "fix-b",
        mutationCount: 10,
        killedMutations: 9,
        mutationKillRate: 0.9,
        survivingMutationsForRepair: ["mut-b-1"],
      },
    ],
  },
  promptCache: {
    roles: [
      {
        roleId: "test-designer",
        iterationsCounted: 4,
        cacheHits: 3,
        cacheMisses: 1,
        promptCacheHitRate: 0.75,
      },
    ],
  },
  tamper: {
    samples: [
      {
        sampleId: "release-job-1",
        merkleChainVerified: true,
        headOfChainHashVerified: true,
        mlBomHashVerified: true,
      },
    ],
  },
  cacheBreak: {
    samples: [
      {
        querySource: "figma-only",
        responseCount: 100,
        breakCount: 2,
        diffArtifactBasenames: ["cb-1.json", "cb-2.json"],
      },
    ],
  },
});

const findVerdict = (
  report: ReturnType<typeof evaluateReleaseQualityGates>,
  gateId: ReleaseQualityGateId,
) => {
  const verdict = report.verdicts.find((entry) => entry.gateId === gateId);
  assert.ok(verdict, `verdict for ${gateId} missing`);
  return verdict;
};

test("evaluateReleaseQualityGates: passes when all four metrics meet thresholds", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());

  assert.equal(report.passed, true);
  assert.equal(report.tamperDetectionPassed, true);
  assert.ok(
    report.mutationKillRate >=
      RELEASE_QUALITY_GATES_THRESHOLDS.minMutationKillRate,
  );
  assert.ok(
    report.promptCacheHitRate >=
      RELEASE_QUALITY_GATES_THRESHOLDS.minPromptCacheHitRate,
  );
  assert.ok(
    report.cacheBreakRate <=
      RELEASE_QUALITY_GATES_THRESHOLDS.maxCacheBreakRate,
  );
  assert.deepEqual(
    report.verdicts.map((verdict) => verdict.gateId),
    [...ALLOWED_RELEASE_QUALITY_GATE_IDS],
  );
  for (const verdict of report.verdicts) {
    assert.equal(verdict.passed, true);
    assert.deepEqual(verdict.attribution, []);
  }
});

test("evaluateReleaseQualityGates: breach attribution names the offending mutation fixture", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    mutation: {
      fixtures: [
        {
          fixtureId: "fix-bad",
          mutationCount: 10,
          killedMutations: 5,
          mutationKillRate: 0.5,
          survivingMutationsForRepair: [
            "mut-bad-1",
            "mut-bad-2",
            "mut-bad-3",
            "mut-bad-4",
            "mut-bad-5",
          ],
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "mutation_kill_rate");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.deepEqual(verdict.attribution, ["fix-bad"]);
});

test("evaluateReleaseQualityGates: prompt-cache breach attributes to the offending role and excludes zero-iteration roles", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    promptCache: {
      roles: [
        {
          roleId: "test-designer",
          iterationsCounted: 4,
          cacheHits: 1,
          cacheMisses: 3,
          promptCacheHitRate: 0.25,
        },
        {
          roleId: "self-verifier",
          iterationsCounted: 0,
          cacheHits: 0,
          cacheMisses: 0,
          promptCacheHitRate: 0,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "prompt_cache_hit_rate");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.deepEqual(verdict.attribution, ["test-designer"]);
});

test("evaluateReleaseQualityGates: tamper round-trip fails on any failed verification", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    tamper: {
      samples: [
        {
          sampleId: "release-job-1",
          merkleChainVerified: true,
          headOfChainHashVerified: true,
          mlBomHashVerified: true,
        },
        {
          sampleId: "release-job-2",
          merkleChainVerified: true,
          headOfChainHashVerified: false,
          mlBomHashVerified: true,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "tamper_detection_round_trip");
  assert.equal(report.tamperDetectionPassed, false);
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.deepEqual(verdict.attribution, ["release-job-2"]);
});

test("evaluateReleaseQualityGates: tamper gate fails when zero release samples are provided", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    tamper: { samples: [] },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "tamper_detection_round_trip");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["no_release_jobs_sampled"]);
});

test("evaluateReleaseQualityGates: cache-break spike attributes to the offending querySource", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    cacheBreak: {
      samples: [
        {
          querySource: "figma-only",
          responseCount: 100,
          breakCount: 2,
          diffArtifactBasenames: ["cb-quiet-1.json"],
        },
        {
          querySource: "figma-plus-jira",
          responseCount: 100,
          breakCount: 12,
          diffArtifactBasenames: [
            "cb-spike-1.json",
            "cb-spike-2.json",
          ],
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "cache_break_rate");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.deepEqual(verdict.attribution, ["figma-plus-jira"]);
});

test("evaluateReleaseQualityGates: empty mutation fixture set fails the gate", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    mutation: { fixtures: [] },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "mutation_kill_rate");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["no_curated_fixtures"]);
});

test("evaluateReleaseQualityGates: cache-break gate fails when zero samples are provided", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    cacheBreak: { samples: [] },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "cache_break_rate");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.deepEqual(verdict.attribution, ["no_cache_break_samples"]);
});

test("evaluateReleaseQualityGates: aggregate passes even when a single fixture breaches per-item threshold", () => {
  // Aggregate rate of 0.9 passes the 0.85 threshold even though one fixture (0.8) breaches.
  // Attribution is informational; passed is based on the aggregate.
  const input = buildPassingInput();
  const mixed: ReleaseQualityGatesInput = {
    ...input,
    mutation: {
      fixtures: [
        {
          fixtureId: "fix-strong",
          mutationCount: 10,
          killedMutations: 10,
          mutationKillRate: 1.0,
          survivingMutationsForRepair: [],
        },
        {
          fixtureId: "fix-weak",
          mutationCount: 10,
          killedMutations: 8,
          mutationKillRate: 0.8,
          survivingMutationsForRepair: ["mut-w-1", "mut-w-2"],
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(mixed);
  const verdict = findVerdict(report, "mutation_kill_rate");
  // Aggregated: 18/20 = 0.9 >= 0.85 → passes
  assert.equal(verdict.passed, true);
  // fix-weak is below per-fixture threshold → attributed for visibility
  assert.deepEqual(verdict.attribution, ["fix-weak"]);
});

test("evaluateReleaseQualityGates: rejects malformed input", () => {
  assert.throws(() => evaluateReleaseQualityGates({} as never));
  assert.throws(() =>
    evaluateReleaseQualityGates({
      ...buildPassingInput(),
      releaseId: "",
    } as never),
  );
});

test("isReleaseQualityGatesInput: rejects negative cache misses", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    promptCache: {
      roles: [
        {
          roleId: "test-designer",
          iterationsCounted: 4,
          cacheHits: 3,
          cacheMisses: -1,
          promptCacheHitRate: 0.75,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("isReleaseQualityGatesInput: rejects breakCount > responseCount", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    cacheBreak: {
      samples: [
        {
          querySource: "figma-only",
          responseCount: 5,
          breakCount: 10,
          diffArtifactBasenames: [],
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("serializeReleaseQualityGatesReport produces canonical (sorted-key) JSON", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const serialized = serializeReleaseQualityGatesReport(report);
  assert.ok(serialized.endsWith("\n"));
  // Re-running should produce byte-identical output.
  const second = serializeReleaseQualityGatesReport(report);
  assert.equal(serialized, second);
  // Top-level keys come out in alphabetical order so byte-equality holds
  // across machines that key-iterate differently.
  const reparsed = JSON.parse(serialized.trimEnd());
  const observedKeys = Object.keys(reparsed);
  const sortedKeys = [...observedKeys].sort();
  assert.deepEqual(observedKeys, sortedKeys);
});

test("parseReleaseQualityGatesReport: round-trips a passing report", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const serialized = serializeReleaseQualityGatesReport(report);
  const parsed = parseReleaseQualityGatesReport(serialized);
  assert.deepEqual(parsed, report);
});

test("parseReleaseQualityGatesReport: rejects payload missing trailing newline", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const serialized = serializeReleaseQualityGatesReport(report);
  const noNewline = serialized.slice(0, -1);
  assert.equal(parseReleaseQualityGatesReport(noNewline), undefined);
});

test("parseReleaseQualityGatesReport: rejects unknown gateId in verdicts", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const tampered = {
    ...report,
    verdicts: report.verdicts.map((verdict, index) =>
      index === 0 ? { ...verdict, gateId: "unknown_gate" } : verdict,
    ),
  };
  const payload = `${JSON.stringify(tampered)}\n`;
  assert.equal(parseReleaseQualityGatesReport(payload), undefined);
});

test("parseReleaseQualityGatesReport: rejects NaN in verdict observed", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const tampered = {
    ...report,
    verdicts: report.verdicts.map((verdict, index) =>
      index === 0 ? { ...verdict, observed: NaN } : verdict,
    ),
  };
  const payload = `${JSON.stringify(tampered)}\n`;
  assert.equal(parseReleaseQualityGatesReport(payload), undefined);
});

test("parseReleaseQualityGatesReport: rejects inconsistent verdict passed flag", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  // Flip one verdict's passed flag so it disagrees with the comparator result.
  const tampered = {
    ...report,
    passed: false,
    verdicts: report.verdicts.map((verdict, index) =>
      index === 0 ? { ...verdict, passed: false } : verdict,
    ),
  };
  const payload = `${JSON.stringify(tampered)}\n`;
  assert.equal(parseReleaseQualityGatesReport(payload), undefined);
});

test("parseReleaseQualityGatesReport: rejects mismatched top-level passed flag", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  // Top-level passed disagrees with verdicts (all pass but top-level says false).
  const tampered = { ...report, passed: false };
  const payload = `${JSON.stringify(tampered)}\n`;
  assert.equal(parseReleaseQualityGatesReport(payload), undefined);
});

test("writeReleaseQualityGatesReport: atomic write produces a parseable artifact", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "release-quality-gates-"));
  try {
    const report = evaluateReleaseQualityGates(buildPassingInput());
    const result = await writeReleaseQualityGatesReport({ report, runDir });
    assert.equal(
      result.artifactPath,
      join(runDir, RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(result.artifactPath, "utf8");
    assert.equal(onDisk, result.serialized);
    const reparsed = parseReleaseQualityGatesReport(onDisk);
    assert.deepEqual(reparsed, report);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("writeReleaseQualityGatesReport: rejects empty runDir", async () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  await assert.rejects(() =>
    writeReleaseQualityGatesReport({ report, runDir: "" }),
  );
});
