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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A valid hex64 hash for test fixtures. */
const HASH_A =
  "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
const HASH_B =
  "bbccddeeff00112233445566778899aabbccddeeff00112233445566778899aa";
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
  releaseId: "release-1802-test",
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
  perSourceCostPlausibility: {
    samples: [
      {
        sampleId: "cost-sample-1",
        attestedBySourceHash: HASH_A,
        observedBySourceHash: HASH_A,
        sealed: true,
      },
    ],
  },
  memdirManifestConsistency: {
    pathValidator: { coveredCases: 5, totalCases: 5 },
    lessons: [
      {
        lessonId: "lesson-banking-1",
        profile: "banking",
        // 1 day old — well within the 90-day limit
        mtimeMs: Date.now() - 24 * 60 * 60 * 1000,
        nowMs: Date.now(),
      },
      {
        lessonId: "lesson-default-1",
        profile: "default",
        // 200 days old — but default profile is not gated
        mtimeMs: Date.now() - 200 * 24 * 60 * 60 * 1000,
        nowMs: Date.now(),
      },
    ],
  },
  libraryCoverageStatusCompleteness: {
    primitives: [
      {
        primitiveId: "langgraph/StateGraph.add_node",
        status: "COVERED",
        justification: "Fully implemented in src/test-intelligence/harness.",
        moduleImplemented: true,
      },
      {
        primitiveId: "SomeOtherLib.helper",
        status: "NICHT-UEBERNOMMEN",
        justification: "Out of scope for current release; no harness path.",
        moduleImplemented: false,
      },
    ],
  },
  architectureFitSelfTest: {
    scannedFileCount: 42,
    violations: [],
  },
  contextBudgetRegression: {
    baseline: { meanInputTokens: 10000, sampleCount: 10 },
    harness: { meanInputTokens: 11000, sampleCount: 10 },
    qualityDeltaScore: 0.0,
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

test("evaluateReleaseQualityGates: passes when all nine metrics meet thresholds", () => {
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
    assert.equal(verdict.passed, true, `Gate ${verdict.gateId} should pass`);
    // memdir_manifest_consistency always includes a pathValidatorCoverageRate
    // note in attribution for visibility even on PASS; all other gates are empty.
    if (verdict.gateId === "memdir_manifest_consistency") {
      assert.ok(
        verdict.attribution.some((a) => a.startsWith("pathValidatorCoverageRate:")),
        "memdir gate should include coverage rate note",
      );
    } else {
      assert.deepEqual(
        verdict.attribution,
        [],
        `Gate ${verdict.gateId} should have empty attribution on PASS`,
      );
    }
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

// ── Gate 5: per-source cost plausibility ─────────────────────────────────────

test("gate 5 perSourceCostPlausibility: PASS when all samples sealed and hashes match", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const verdict = findVerdict(report, "per_source_cost_plausibility");
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.attribution, []);
});

test("gate 5 perSourceCostPlausibility: FAIL on hash mismatch and surfaces bySource_hash_mismatch", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    perSourceCostPlausibility: {
      samples: [
        {
          sampleId: "cost-sample-bad",
          attestedBySourceHash: HASH_A,
          observedBySourceHash: HASH_B,
          sealed: true,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "per_source_cost_plausibility");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("bySource_hash_mismatch")),
    `Expected bySource_hash_mismatch in attribution: ${verdict.attribution.join(", ")}`,
  );
  assert.ok(
    verdict.attribution.some((a) => a.includes("cost-sample-bad")),
  );
});

test("gate 5 perSourceCostPlausibility: FAIL on unsealed sample", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    perSourceCostPlausibility: {
      samples: [
        {
          sampleId: "cost-sample-unsealed",
          attestedBySourceHash: HASH_A,
          observedBySourceHash: HASH_A,
          sealed: false,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "per_source_cost_plausibility");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["cost-sample-unsealed"]);
});

test("gate 5 perSourceCostPlausibility: FAIL when no samples provided", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    perSourceCostPlausibility: { samples: [] },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "per_source_cost_plausibility");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["no_cost_samples"]);
});

test("gate 5 perSourceCostPlausibility: rejects invalid hex hash (not 64 chars)", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    perSourceCostPlausibility: {
      samples: [
        {
          sampleId: "cost-sample-1",
          attestedBySourceHash: "tooshort",
          observedBySourceHash: HASH_A,
          sealed: true,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("gate 5 perSourceCostPlausibility: rejects uppercase hex hash", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    perSourceCostPlausibility: {
      samples: [
        {
          sampleId: "cost-sample-1",
          attestedBySourceHash: HASH_A.toUpperCase(),
          observedBySourceHash: HASH_A,
          sealed: true,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

// ── Gate 6: memdir manifest consistency ──────────────────────────────────────

test("gate 6 memdirManifestConsistency: PASS when banking lessons fresh and path validator at 100%", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, true);
});

test("gate 6 memdirManifestConsistency: FAIL on stale banking lesson", () => {
  const input = buildPassingInput();
  const now = Date.now();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    memdirManifestConsistency: {
      pathValidator: { coveredCases: 5, totalCases: 5 },
      lessons: [
        {
          lessonId: "lesson-banking-stale",
          profile: "banking",
          // 100 days old — exceeds 90-day limit
          mtimeMs: now - 100 * 24 * 60 * 60 * 1000,
          nowMs: now,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("lesson-banking-stale")),
    `Expected stale lesson in attribution: ${verdict.attribution.join(", ")}`,
  );
});

test("gate 6 memdirManifestConsistency: non-banking stale lesson does not fail gate", () => {
  const input = buildPassingInput();
  const now = Date.now();
  const nonBankingStale: ReleaseQualityGatesInput = {
    ...input,
    memdirManifestConsistency: {
      pathValidator: { coveredCases: 3, totalCases: 3 },
      lessons: [
        {
          lessonId: "lesson-default-stale",
          profile: "default",
          mtimeMs: now - 200 * 24 * 60 * 60 * 1000,
          nowMs: now,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(nonBankingStale);
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, true);
});

test("gate 6 memdirManifestConsistency: FAIL when pathValidator coverage < 100%", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    memdirManifestConsistency: {
      pathValidator: { coveredCases: 4, totalCases: 5 },
      lessons: [],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("pathValidator_coverage_incomplete")),
  );
});

test("gate 6 memdirManifestConsistency: FAIL when totalCases is zero", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    memdirManifestConsistency: {
      pathValidator: { coveredCases: 0, totalCases: 0 },
      lessons: [],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, false);
});

test("gate 6 memdirManifestConsistency: lastRefreshAtMs extends effective freshness window", () => {
  const input = buildPassingInput();
  const now = Date.now();
  // mtimeMs is 100 days ago (would fail), but lastRefreshAtMs is 1 day ago (should pass)
  const refreshed: ReleaseQualityGatesInput = {
    ...input,
    memdirManifestConsistency: {
      pathValidator: { coveredCases: 2, totalCases: 2 },
      lessons: [
        {
          lessonId: "lesson-banking-refreshed",
          profile: "banking",
          mtimeMs: now - 100 * 24 * 60 * 60 * 1000,
          lastRefreshAtMs: now - 24 * 60 * 60 * 1000,
          nowMs: now,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(refreshed);
  const verdict = findVerdict(report, "memdir_manifest_consistency");
  assert.equal(verdict.passed, true);
});

// ── Gate 7: library coverage status completeness ──────────────────────────────

test("gate 7 libraryCoverageStatusCompleteness: PASS for all valid primitives", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const verdict = findVerdict(report, "library_coverage_status_completeness");
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.attribution, []);
});

test("gate 7 libraryCoverageStatusCompleteness: FAIL on COVERED+moduleImplemented=false", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    libraryCoverageStatusCompleteness: {
      primitives: [
        {
          primitiveId: "MyLib.doSomething",
          status: "COVERED",
          justification: "Marked covered but module not yet implemented.",
          moduleImplemented: false,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "library_coverage_status_completeness");
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("covered_unimplemented")),
    `Expected covered_unimplemented in attribution: ${verdict.attribution.join(", ")}`,
  );
  assert.ok(
    verdict.attribution.some((a) => a.includes("MyLib.doSomething")),
  );
});

test("gate 7 libraryCoverageStatusCompleteness: FAIL when no primitives in report", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    libraryCoverageStatusCompleteness: { primitives: [] },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "library_coverage_status_completeness");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["no_primitives_in_release_report"]);
});

test("gate 7 libraryCoverageStatusCompleteness: rejects invalid status string", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    libraryCoverageStatusCompleteness: {
      primitives: [
        {
          primitiveId: "MyLib.foo",
          status: "INVALID_STATUS",
          justification: "Some reason.",
          moduleImplemented: true,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("gate 7 libraryCoverageStatusCompleteness: rejects empty justification", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    libraryCoverageStatusCompleteness: {
      primitives: [
        {
          primitiveId: "MyLib.foo",
          status: "COVERED",
          justification: "",
          moduleImplemented: true,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("gate 7 libraryCoverageStatusCompleteness: accepts langgraph-style path primitiveId", () => {
  const input = buildPassingInput();
  const withPath: ReleaseQualityGatesInput = {
    ...input,
    libraryCoverageStatusCompleteness: {
      primitives: [
        {
          primitiveId: "langgraph/StateGraph.add_node",
          status: "PARITY-PATH",
          justification: "Mapped to workspace-dev harness path equivalent.",
          moduleImplemented: true,
        },
      ],
    },
  };
  assert.equal(isReleaseQualityGatesInput(withPath), true);
  const report = evaluateReleaseQualityGates(withPath);
  const verdict = findVerdict(report, "library_coverage_status_completeness");
  assert.equal(verdict.passed, true);
});

// ── Gate 8: architecture fit self-test ───────────────────────────────────────

test("gate 8 architectureFitSelfTest: PASS when zero violations and scannedFileCount >= 1", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const verdict = findVerdict(report, "architecture_fit_self_test");
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.attribution, []);
});

test("gate 8 architectureFitSelfTest: FAIL on any violation and surfaces it", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    architectureFitSelfTest: {
      scannedFileCount: 10,
      violations: [
        {
          file: "src/test-intelligence/rogue-module.ts",
          type: "role-module-import",
          line: 42,
        },
      ],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "architecture_fit_self_test");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("rogue-module.ts")),
    `Expected rogue-module.ts in attribution: ${verdict.attribution.join(", ")}`,
  );
});

test("gate 8 architectureFitSelfTest: FAIL when scannedFileCount is 0", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    architectureFitSelfTest: {
      scannedFileCount: 0,
      violations: [],
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "architecture_fit_self_test");
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.attribution, ["no_files_scanned"]);
});

// ── Gate 9: context budget regression ────────────────────────────────────────

test("gate 9 contextBudgetRegression: PASS when bloat within default 1.20 ratio", () => {
  const report = evaluateReleaseQualityGates(buildPassingInput());
  const verdict = findVerdict(report, "context_budget_regression");
  // buildPassingInput has 11000/10000 = 1.10 ratio <= 1.20
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.attribution, []);
});

test("gate 9 contextBudgetRegression: FAIL when bloat exceeds ratio and quality delta is insufficient", () => {
  const input = buildPassingInput();
  const breaching: ReleaseQualityGatesInput = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 10 },
      harness: { meanInputTokens: 13000, sampleCount: 10 },
      qualityDeltaScore: 0.0,
    },
  };
  const report = evaluateReleaseQualityGates(breaching);
  const verdict = findVerdict(report, "context_budget_regression");
  assert.equal(verdict.passed, false);
  assert.equal(report.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("bloat_ratio")),
    `Expected bloat_ratio in attribution: ${verdict.attribution.join(", ")}`,
  );
});

test("gate 9 contextBudgetRegression: PASS when bloat exceeds ratio but quality delta >= 0.05 (material win)", () => {
  // Bloat is fine if quality wins materially (>= 0.05 delta score).
  const input = buildPassingInput();
  const qualityWin: ReleaseQualityGatesInput = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 10 },
      harness: { meanInputTokens: 15000, sampleCount: 10 },
      // 1.50 ratio exceeds 1.20 default but quality delta >= 0.05 overrides.
      qualityDeltaScore: 0.1,
    },
  };
  const report = evaluateReleaseQualityGates(qualityWin);
  const verdict = findVerdict(report, "context_budget_regression");
  assert.equal(verdict.passed, true);
});

test("gate 9 contextBudgetRegression: FAIL when sampleCount below minimum threshold", () => {
  const input = buildPassingInput();
  const lowSamples: ReleaseQualityGatesInput = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 3 },
      harness: { meanInputTokens: 10000, sampleCount: 10 },
      qualityDeltaScore: 0.0,
    },
  };
  const report = evaluateReleaseQualityGates(lowSamples);
  const verdict = findVerdict(report, "context_budget_regression");
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.attribution.some((a) => a.includes("baseline_sample_count_too_low")),
  );
});

test("gate 9 contextBudgetRegression: custom maxBloatRatio overrides default", () => {
  const input = buildPassingInput();
  // 11000/10000 = 1.10. With a custom limit of 1.05 it should fail.
  const tightLimit: ReleaseQualityGatesInput = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 10 },
      harness: { meanInputTokens: 11000, sampleCount: 10 },
      qualityDeltaScore: 0.0,
      maxBloatRatio: 1.05,
    },
  };
  const report = evaluateReleaseQualityGates(tightLimit);
  const verdict = findVerdict(report, "context_budget_regression");
  assert.equal(verdict.passed, false);
});

test("gate 9 contextBudgetRegression: rejects NaN qualityDeltaScore", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 10 },
      harness: { meanInputTokens: 10000, sampleCount: 10 },
      qualityDeltaScore: NaN,
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});

test("gate 9 contextBudgetRegression: rejects qualityDeltaScore outside [-1, 1]", () => {
  const input = buildPassingInput();
  const malformed = {
    ...input,
    contextBudgetRegression: {
      baseline: { meanInputTokens: 10000, sampleCount: 10 },
      harness: { meanInputTokens: 10000, sampleCount: 10 },
      qualityDeltaScore: 1.5,
    },
  };
  assert.equal(isReleaseQualityGatesInput(malformed), false);
});
