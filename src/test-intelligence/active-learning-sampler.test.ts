import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  ACTIVE_LEARNING_DEFAULT_CAPACITY,
  ACTIVE_LEARNING_DEFAULT_WEIGHTS,
  ACTIVE_LEARNING_GROWTH_LOG_ARTIFACT_FILENAME,
  ACTIVE_LEARNING_HIGH_CONFIDENCE_VETO_THRESHOLD,
  ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR,
  ACTIVE_LEARNING_QUEUE_ARTIFACT_FILENAME,
  ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION,
  ACTIVE_LEARNING_SELECTION_REASONS,
  buildActiveLearningGrowthLog,
  buildActiveLearningQueueArtifact,
  computeDisagreementScore,
  computeDriftScore,
  computeUncertaintyScore,
  evaluateActiveLearningKappaGate,
  evaluateActiveLearningQuarterlyGate,
  runActiveLearningSampler,
  summariseActiveLearningQuarterlyGrowth,
  writeActiveLearningGrowthLog,
  writeActiveLearningQueueArtifact,
  type ActiveLearningCandidateCase,
  type ActiveLearningGrowthRecord,
  type ActiveLearningPanelEntry,
  type ActiveLearningWeights,
} from "./active-learning-sampler.js";
import type { CalibrationPairedRating } from "./inter-rater-agreement.js";

const FIXTURE_GENERATED_AT = "2026-05-10T12:00:00.000Z";

const buildPanel = (
  rows: ReadonlyArray<{
    readonly judgeId: string;
    readonly verdict: "accept" | "repair" | "reject";
    readonly confidence?: number;
  }>,
): ActiveLearningPanelEntry[] =>
  rows.map((row) => ({
    judgeId: row.judgeId,
    verdict: row.verdict,
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
  }));

const candidate = (
  override: Partial<ActiveLearningCandidateCase> & { readonly caseId: string },
): ActiveLearningCandidateCase => ({
  caseId: override.caseId,
  judge: override.judge ?? "logic",
  scenarioKind: override.scenarioKind ?? "happy",
  riskCategory: override.riskCategory ?? "low",
  observedAt: override.observedAt ?? "2026-05-09T00:00:00.000Z",
  panel:
    override.panel ??
    buildPanel([
      { judgeId: "logic-primary", verdict: "accept", confidence: 0.9 },
      { judgeId: "faithfulness-primary", verdict: "accept", confidence: 0.9 },
    ]),
  agreementShape: override.agreementShape ?? "unanimous",
  drift: override.drift ?? { flagged: false },
  ...(override.vetoBy !== undefined ? { vetoBy: override.vetoBy } : {}),
});

test("computeUncertaintyScore plateaus inside the half-band and tapers outside", () => {
  assert.equal(
    computeUncertaintyScore(
      buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
    ),
    1,
  );
  assert.equal(
    computeUncertaintyScore(
      buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.55 }]),
    ),
    1,
  );
  assert.equal(
    computeUncertaintyScore(
      buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.7 }]),
    ),
    0.6,
  );
  assert.equal(
    computeUncertaintyScore(
      buildPanel([{ judgeId: "j", verdict: "accept", confidence: 1 }]),
    ),
    0,
  );
});

test("computeUncertaintyScore takes the panel max and ignores entries without confidence", () => {
  const score = computeUncertaintyScore(
    buildPanel([
      { judgeId: "j1", verdict: "accept", confidence: 0.95 },
      { judgeId: "j2", verdict: "reject" },
      { judgeId: "j3", verdict: "repair", confidence: 0.7 },
    ]),
  );
  assert.equal(score, 0.6);
});

test("computeDisagreementScore: agreement-shape table maps to canonical values", () => {
  for (const shape of ["unanimous", "majority", "split", "vetoed"] as const) {
    const score = computeDisagreementScore(
      candidate({ caseId: `c-${shape}`, agreementShape: shape }),
    );
    const expected = { unanimous: 0, majority: 0.5, split: 1, vetoed: 1 }[shape];
    assert.equal(score, expected, `agreementShape=${shape}`);
  }
});

test("computeDisagreementScore returns 1 when vetoBy is set, regardless of shape", () => {
  const score = computeDisagreementScore(
    candidate({
      caseId: "c-veto",
      agreementShape: "majority",
      vetoBy: {
        judgeId: "logic-primary",
        verdict: "reject",
        findingCodes: ["RR1"],
      },
    }),
  );
  assert.equal(score, 1);
});

test("computeDisagreementScore: high-confidence reject overrides a unanimous shape", () => {
  const score = computeDisagreementScore(
    candidate({
      caseId: "c-reject",
      agreementShape: "unanimous",
      panel: buildPanel([
        { judgeId: "j1", verdict: "accept", confidence: 0.9 },
        {
          judgeId: "j2",
          verdict: "reject",
          confidence: ACTIVE_LEARNING_HIGH_CONFIDENCE_VETO_THRESHOLD,
        },
      ]),
    }),
  );
  assert.equal(score, 1);
});

test("computeDriftScore is binary on the flagged signal", () => {
  assert.equal(computeDriftScore({ flagged: false }), 0);
  assert.equal(computeDriftScore({ flagged: true }), 1);
});

test("buildActiveLearningQueueArtifact selects top-N by composite score with deterministic tie-break", () => {
  const candidates: ActiveLearningCandidateCase[] = [
    candidate({
      caseId: "case-low",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.95 }]),
    }),
    candidate({
      caseId: "case-uncertain",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
    }),
    candidate({
      caseId: "case-disagree",
      agreementShape: "split",
      panel: buildPanel([
        { judgeId: "j1", verdict: "accept", confidence: 0.85 },
        { judgeId: "j2", verdict: "reject", confidence: 0.85 },
      ]),
    }),
    candidate({
      caseId: "case-drift",
      drift: { flagged: true, findingKinds: ["metric_shift"] },
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.95 }]),
    }),
  ];
  const artifact = buildActiveLearningQueueArtifact({
    cycleId: "cycle-2026Q2-01",
    generatedAt: FIXTURE_GENERATED_AT,
    candidates,
    capacity: 2,
  });
  assert.equal(artifact.aggregate.populationSize, 4);
  assert.equal(artifact.aggregate.selectedCount, 2);
  assert.deepEqual(
    artifact.items.map((item) => item.caseId),
    ["case-uncertain", "case-disagree"],
  );
});

test("buildActiveLearningQueueArtifact prioritises mandatory-risk cases regardless of composite score", () => {
  const candidates: ActiveLearningCandidateCase[] = [
    candidate({
      caseId: "case-uncertain",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
    }),
    candidate({
      caseId: "case-financial-flat",
      riskCategory: "financial_transaction",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.95 }]),
    }),
    candidate({
      caseId: "case-regulated-flat",
      riskCategory: "regulated_data",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.95 }]),
    }),
  ];
  const artifact = buildActiveLearningQueueArtifact({
    cycleId: "cycle-mandatory",
    generatedAt: FIXTURE_GENERATED_AT,
    candidates,
    capacity: 2,
  });
  assert.deepEqual(
    artifact.items.map((item) => item.caseId),
    ["case-financial-flat", "case-regulated-flat"],
  );
  assert.equal(artifact.aggregate.mandatoryOverrideCount, 2);
});

test("buildActiveLearningQueueArtifact aggregate counts every selection reason", () => {
  const artifact = buildActiveLearningQueueArtifact({
    cycleId: "cycle-reasons",
    generatedAt: FIXTURE_GENERATED_AT,
    candidates: [
      candidate({
        caseId: "case-uncertain",
        panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
      }),
      candidate({
        caseId: "case-split",
        agreementShape: "split",
      }),
      candidate({
        caseId: "case-vetoed",
        agreementShape: "vetoed",
        vetoBy: {
          judgeId: "logic-primary",
          verdict: "reject",
          findingCodes: ["X1"],
        },
      }),
      candidate({
        caseId: "case-drift",
        drift: { flagged: true, findingKinds: ["provider_fingerprint_changed"] },
      }),
      candidate({
        caseId: "case-mandatory",
        riskCategory: "financial_transaction",
      }),
    ],
    capacity: 5,
  });
  for (const reason of ACTIVE_LEARNING_SELECTION_REASONS) {
    assert.ok(
      artifact.aggregate.perReasonCounts[reason] >= 1,
      `expected at least one queue item for reason "${reason}"`,
    );
  }
});

test("buildActiveLearningQueueArtifact rejects duplicate caseIds", () => {
  assert.throws(
    () =>
      buildActiveLearningQueueArtifact({
        cycleId: "cycle-dupe",
        generatedAt: FIXTURE_GENERATED_AT,
        candidates: [
          candidate({ caseId: "dupe" }),
          candidate({ caseId: "dupe" }),
        ],
      }),
    /duplicate caseId/,
  );
});

test("buildActiveLearningQueueArtifact rejects weights that do not sum to 1", () => {
  const weights: ActiveLearningWeights = {
    uncertainty: 0.5,
    disagreement: 0.5,
    drift: 0.5,
  };
  assert.throws(
    () =>
      buildActiveLearningQueueArtifact({
        cycleId: "cycle-weights",
        generatedAt: FIXTURE_GENERATED_AT,
        candidates: [],
        weights,
      }),
    /weights must sum to 1/,
  );
});

test("buildActiveLearningQueueArtifact rejects out-of-range confidence", () => {
  assert.throws(
    () =>
      buildActiveLearningQueueArtifact({
        cycleId: "cycle-conf",
        generatedAt: FIXTURE_GENERATED_AT,
        candidates: [
          candidate({
            caseId: "bad-conf",
            panel: buildPanel([
              { judgeId: "j", verdict: "accept", confidence: 1.2 },
            ]),
          }),
        ],
      }),
    /confidence must be a finite number in \[0, 1\]/,
  );
});

test("runActiveLearningSampler writes a canonical, byte-stable artifact", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "active-learning-"));
  try {
    const candidates: ActiveLearningCandidateCase[] = [
      candidate({
        caseId: "case-uncertain",
        panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
      }),
      candidate({
        caseId: "case-split",
        agreementShape: "split",
      }),
    ];
    const { artifact, outputPath } = await runActiveLearningSampler({
      cycleId: "cycle-bytes",
      generatedAt: FIXTURE_GENERATED_AT,
      candidates,
      capacity: ACTIVE_LEARNING_DEFAULT_CAPACITY,
      runDir: tmp,
    });
    assert.equal(
      outputPath,
      join(tmp, ACTIVE_LEARNING_QUEUE_ARTIFACT_FILENAME),
    );
    const raw = await readFile(outputPath, "utf8");
    assert.equal(raw, canonicalJson(artifact));
    assert.equal(
      artifact.schemaVersion,
      ACTIVE_LEARNING_SAMPLER_SCHEMA_VERSION,
    );
    assert.equal(
      artifact.contractVersion,
      TEST_INTELLIGENCE_CONTRACT_VERSION,
    );
    assert.deepEqual(artifact.weights, ACTIVE_LEARNING_DEFAULT_WEIGHTS);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runActiveLearningSampler is deterministic across two builds with identical inputs", async () => {
  const candidates: ActiveLearningCandidateCase[] = [
    candidate({
      caseId: "case-A",
      panel: buildPanel([{ judgeId: "j", verdict: "accept", confidence: 0.5 }]),
    }),
    candidate({
      caseId: "case-B",
      agreementShape: "split",
    }),
    candidate({
      caseId: "case-C",
      drift: { flagged: true, findingKinds: ["metric_shift"] },
    }),
  ];
  const first = buildActiveLearningQueueArtifact({
    cycleId: "cycle-determinism",
    generatedAt: FIXTURE_GENERATED_AT,
    candidates,
    capacity: 3,
  });
  const second = buildActiveLearningQueueArtifact({
    cycleId: "cycle-determinism",
    generatedAt: FIXTURE_GENERATED_AT,
    candidates,
    capacity: 3,
  });
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test("buildActiveLearningGrowthLog sorts records by addedAt then cycleId, and dedupes case ids", () => {
  const log = buildActiveLearningGrowthLog({
    recordedAt: FIXTURE_GENERATED_AT,
    records: [
      {
        cycleId: "cycle-2",
        addedAt: "2026-04-15T00:00:00.000Z",
        addedCaseIds: ["case-z", "case-a"],
      },
      {
        cycleId: "cycle-1",
        addedAt: "2026-04-01T00:00:00.000Z",
        addedCaseIds: ["case-b", "case-c"],
      },
    ],
  });
  assert.deepEqual(log.records.map((record) => record.cycleId), [
    "cycle-1",
    "cycle-2",
  ]);
  assert.deepEqual(log.records[1]!.addedCaseIds, ["case-a", "case-z"]);
});

test("buildActiveLearningGrowthLog rejects duplicate cycleIds", () => {
  assert.throws(
    () =>
      buildActiveLearningGrowthLog({
        recordedAt: FIXTURE_GENERATED_AT,
        records: [
          {
            cycleId: "cycle-dup",
            addedAt: "2026-04-01T00:00:00.000Z",
            addedCaseIds: [],
          },
          {
            cycleId: "cycle-dup",
            addedAt: "2026-04-02T00:00:00.000Z",
            addedCaseIds: [],
          },
        ],
      }),
    /duplicate growth-log cycleId/,
  );
});

test("writeActiveLearningGrowthLog persists the canonical document", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "active-learning-growth-"));
  try {
    const log = buildActiveLearningGrowthLog({
      recordedAt: FIXTURE_GENERATED_AT,
      records: [
        {
          cycleId: "cycle-A",
          addedAt: "2026-04-01T00:00:00.000Z",
          addedCaseIds: ["c1"],
        },
      ],
    });
    const path = await writeActiveLearningGrowthLog({ log, runDir: tmp });
    assert.equal(path, join(tmp, ACTIVE_LEARNING_GROWTH_LOG_ARTIFACT_FILENAME));
    const raw = await readFile(path, "utf8");
    assert.equal(raw, canonicalJson(log));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("summariseActiveLearningQuarterlyGrowth counts unique cases inside the as-of quarter", () => {
  const log = buildActiveLearningGrowthLog({
    recordedAt: FIXTURE_GENERATED_AT,
    records: [
      {
        cycleId: "cycle-Q1",
        addedAt: "2026-02-15T00:00:00.000Z",
        addedCaseIds: ["c1", "c2", "c3"],
      },
      {
        cycleId: "cycle-Q2-a",
        addedAt: "2026-04-01T00:00:00.000Z",
        addedCaseIds: ["c10", "c11", "c12", "c13", "c14"],
      },
      {
        cycleId: "cycle-Q2-b",
        addedAt: "2026-05-09T00:00:00.000Z",
        addedCaseIds: ["c14", "c15", "c16"],
      },
      {
        cycleId: "cycle-Q3",
        addedAt: "2026-07-01T00:00:00.000Z",
        addedCaseIds: ["c20"],
      },
    ],
  });
  const summary = summariseActiveLearningQuarterlyGrowth({
    log,
    asOfIsoTimestamp: "2026-05-10T00:00:00.000Z",
  });
  assert.equal(summary.quarterKey, "2026-Q2");
  assert.equal(summary.quarterStart, "2026-04-01T00:00:00.000Z");
  assert.equal(summary.quarterEnd, "2026-07-01T00:00:00.000Z");
  assert.equal(summary.addedCases, 7); // c10..c14 ∪ c14,c15,c16
  assert.equal(summary.threshold, ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR);
});

test("evaluateActiveLearningQuarterlyGate throws on quarterly deficit", () => {
  const log = buildActiveLearningGrowthLog({
    recordedAt: FIXTURE_GENERATED_AT,
    records: [
      {
        cycleId: "cycle-Q2",
        addedAt: "2026-04-15T00:00:00.000Z",
        addedCaseIds: ["c1", "c2"],
      },
    ],
  });
  assert.throws(
    () =>
      evaluateActiveLearningQuarterlyGate({
        log,
        asOfIsoTimestamp: "2026-05-10T00:00:00.000Z",
      }),
    /quarterly growth gate failed — 2\/20 cases added in 2026-Q2 \(deficit 18\)/,
  );
});

test("evaluateActiveLearningQuarterlyGate passes when threshold is met", () => {
  const addedCaseIds = Array.from(
    { length: ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR },
    (_unused, index) => `case-${index.toString().padStart(3, "0")}`,
  );
  const log = buildActiveLearningGrowthLog({
    recordedAt: FIXTURE_GENERATED_AT,
    records: [
      {
        cycleId: "cycle-Q2",
        addedAt: "2026-04-15T00:00:00.000Z",
        addedCaseIds,
      },
    ],
  });
  const summary = evaluateActiveLearningQuarterlyGate({
    log,
    asOfIsoTimestamp: "2026-05-10T00:00:00.000Z",
  });
  assert.equal(summary.passed, true);
  assert.equal(summary.deficit, 0);
});

test("evaluateActiveLearningKappaGate routes new paired ratings through the inter-rater contract", () => {
  const ratings: CalibrationPairedRating[] = [];
  // 8 paired ratings, all unanimous-accept → κ = 1.
  for (let index = 0; index < 8; index++) {
    ratings.push({
      fixtureId: `al-cycle-1/case-${index.toString().padStart(2, "0")}`,
      judge: "logic",
      scenarioKind: "happy",
      reviewerA: "did:reviewer:A",
      verdictA: "accept",
      reviewerB: "did:reviewer:B",
      verdictB: "accept",
      adjudicated: false,
    });
  }
  // 8 paired ratings on the faithfulness axis.
  for (let index = 0; index < 8; index++) {
    ratings.push({
      fixtureId: `al-cycle-1/faithful-${index.toString().padStart(2, "0")}`,
      judge: "faithfulness",
      scenarioKind: "edge",
      reviewerA: "did:reviewer:C",
      verdictA: "repair",
      reviewerB: "did:reviewer:D",
      verdictB: "repair",
      adjudicated: false,
    });
  }
  const result = evaluateActiveLearningKappaGate({
    newPairedRatings: ratings,
    arbiters: [],
  });
  assert.equal(result.passed, true);
  assert.equal(result.report.failures.length, 0);
  assert.equal(result.report.perJudge.logic.metrics.cohensKappa, 1);
  assert.equal(result.report.perJudge.faithfulness.metrics.cohensKappa, 1);
});

test("evaluateActiveLearningKappaGate fails when κ drops below the hard floor", () => {
  const ratings: CalibrationPairedRating[] = [];
  // 10 paired ratings on logic with mostly-disagreement → κ < 0.7.
  const verdicts: ReadonlyArray<{
    readonly a: "accept" | "repair" | "reject";
    readonly b: "accept" | "repair" | "reject";
  }> = [
    { a: "accept", b: "reject" },
    { a: "accept", b: "reject" },
    { a: "reject", b: "accept" },
    { a: "repair", b: "accept" },
    { a: "accept", b: "repair" },
    { a: "reject", b: "repair" },
    { a: "accept", b: "reject" },
    { a: "repair", b: "reject" },
    { a: "accept", b: "accept" },
    { a: "reject", b: "reject" },
  ];
  verdicts.forEach((entry, index) => {
    ratings.push({
      fixtureId: `al/case-${index.toString().padStart(2, "0")}`,
      judge: "logic",
      scenarioKind: "happy",
      reviewerA: "did:reviewer:A",
      verdictA: entry.a,
      reviewerB: "did:reviewer:B",
      verdictB: entry.b,
      adjudicated: false,
    });
  });
  // Faithfulness axis still solid so the failure is scoped to logic.
  for (let index = 0; index < 8; index++) {
    ratings.push({
      fixtureId: `al/f-${index.toString().padStart(2, "0")}`,
      judge: "faithfulness",
      scenarioKind: "edge",
      reviewerA: "did:reviewer:C",
      verdictA: "accept",
      reviewerB: "did:reviewer:D",
      verdictB: "accept",
      adjudicated: false,
    });
  }
  const result = evaluateActiveLearningKappaGate({
    newPairedRatings: ratings,
    arbiters: [],
  });
  assert.equal(result.passed, false);
  const logicFailures = result.report.failures.filter(
    (failure) => failure.judge === "logic",
  );
  assert.ok(
    logicFailures.length > 0,
    "expected at least one logic-judge κ failure",
  );
});

test("writeActiveLearningQueueArtifact uses the canonical filename and atomic-write pattern", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "active-learning-write-"));
  try {
    const artifact = buildActiveLearningQueueArtifact({
      cycleId: "cycle-write",
      generatedAt: FIXTURE_GENERATED_AT,
      candidates: [],
      capacity: 0,
    });
    const path = await writeActiveLearningQueueArtifact({
      artifact,
      runDir: tmp,
    });
    assert.equal(path, join(tmp, ACTIVE_LEARNING_QUEUE_ARTIFACT_FILENAME));
    const raw = await readFile(path, "utf8");
    assert.equal(raw, canonicalJson(artifact));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("growth-log records flagged as adjudicated still count for quarterly growth", () => {
  const records: ActiveLearningGrowthRecord[] = [
    {
      cycleId: "cycle-2026Q2-A",
      addedAt: "2026-04-04T12:00:00.000Z",
      addedCaseIds: Array.from(
        { length: 21 },
        (_unused, index) => `case-${index}`,
      ),
    },
  ];
  const log = buildActiveLearningGrowthLog({
    recordedAt: FIXTURE_GENERATED_AT,
    records,
  });
  const summary = evaluateActiveLearningQuarterlyGate({
    log,
    asOfIsoTimestamp: "2026-04-30T00:00:00.000Z",
  });
  assert.equal(summary.passed, true);
  assert.equal(summary.addedCases, 21);
  assert.equal(summary.deficit, 0);
});
