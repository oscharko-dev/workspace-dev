import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  JUDGE_PANEL_AGREEMENT_LABELS,
  JUDGE_PANEL_ESCALATION_ROUTES,
  JUDGE_PANEL_JUDGE_IDS,
  JUDGE_PANEL_PER_JUDGE_VERDICTS,
  JUDGE_PANEL_REASON_MAX_CHARS,
  JUDGE_PANEL_RESOLVED_SEVERITIES,
  JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME,
  JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
  type JudgePanelVerdict,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  JUDGE_BOTH_FAIL_SEVERITY,
  JUDGE_BOTH_PASS_SEVERITY,
  JUDGE_DISAGREE_SEVERITY,
  JUDGE_FAIL_THRESHOLD,
  JUDGE_PASS_THRESHOLD,
  assertJudgePanelVerdictInvariants,
  buildJudgePanelVerdicts,
  isJudgeId,
  isJudgePanelAgreement,
  isJudgePanelEscalationRoute,
  isJudgePanelPerJudgeVerdict,
  isJudgePanelResolvedSeverity,
  serializeJudgePanelVerdicts,
  writeJudgePanelVerdicts,
  type JudgePanelRawSample,
} from "./semantic-judge-panel.js";

const PRIMARY_MODEL = "gpt-oss-120b";
const SECONDARY_MODEL = "phi-4-multimodal-poc";

const sample = (
  overrides: Partial<JudgePanelRawSample> = {},
): JudgePanelRawSample => ({
  testCaseId: "TC-001",
  criterion: "covers_business_rule",
  judgeId: "judge_primary",
  modelBinding: PRIMARY_MODEL,
  score: 0.9,
  reason: "default-reason",
  ...overrides,
});

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(join(tmpdir(), "judge-panel-"));
  try {
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

test("judge-panel vocabularies are closed and alphabetical", () => {
  assert.deepEqual([...JUDGE_PANEL_JUDGE_IDS], [
    "judge_primary",
    "judge_secondary",
  ]);
  assert.deepEqual([...JUDGE_PANEL_PER_JUDGE_VERDICTS], [
    "fail",
    "pass",
    "uncertain",
  ]);
  assert.deepEqual([...JUDGE_PANEL_AGREEMENT_LABELS], [
    "both_fail",
    "both_pass",
    "disagree",
  ]);
  assert.deepEqual([...JUDGE_PANEL_RESOLVED_SEVERITIES], [
    "critical",
    "downgraded_disagreement",
    "major",
    "minor",
  ]);
  assert.deepEqual([...JUDGE_PANEL_ESCALATION_ROUTES], [
    "accept",
    "downgrade",
    "needs_review",
  ]);
  assert.equal(JUDGE_PANEL_REASON_MAX_CHARS, 240);
  assert.equal(JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME, "judge-panel-verdicts.json");
  assert.equal(JUDGE_PANEL_VERDICT_SCHEMA_VERSION, "1.0.0");
});

test("type guards round-trip the closed vocabularies", () => {
  for (const id of JUDGE_PANEL_JUDGE_IDS) assert.equal(isJudgeId(id), true);
  assert.equal(isJudgeId("judge_third"), false);
  assert.equal(isJudgeId(undefined), false);

  for (const v of JUDGE_PANEL_PER_JUDGE_VERDICTS) {
    assert.equal(isJudgePanelPerJudgeVerdict(v), true);
  }
  assert.equal(isJudgePanelPerJudgeVerdict("nope"), false);

  for (const a of JUDGE_PANEL_AGREEMENT_LABELS) {
    assert.equal(isJudgePanelAgreement(a), true);
  }
  for (const s of JUDGE_PANEL_RESOLVED_SEVERITIES) {
    assert.equal(isJudgePanelResolvedSeverity(s), true);
  }
  for (const r of JUDGE_PANEL_ESCALATION_ROUTES) {
    assert.equal(isJudgePanelEscalationRoute(r), true);
  }
});

// ---------------------------------------------------------------------------
// Fixture: both-pass deterministic
// ---------------------------------------------------------------------------

test("both-pass verdict is deterministic and routes to accept/minor", () => {
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", score: 0.95, reason: "primary high" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.92,
        reason: "secondary high",
      }),
    ],
  });
  assert.equal(verdicts.length, 1);
  const v = verdicts[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  assert.equal(v.schemaVersion, JUDGE_PANEL_VERDICT_SCHEMA_VERSION);
  assert.equal(v.testCaseId, "TC-001");
  assert.equal(v.criterion, "covers_business_rule");
  assert.equal(v.agreement, "both_pass");
  assert.equal(v.resolvedSeverity, JUDGE_BOTH_PASS_SEVERITY);
  assert.equal(v.escalationRoute, "accept");
  assert.equal(v.perJudge.length, 2);
  // Sorted alphabetically by judgeId.
  assert.equal(v.perJudge[0]?.judgeId, "judge_primary");
  assert.equal(v.perJudge[1]?.judgeId, "judge_secondary");
  // With fewer than 2 observations per judge the calibration is
  // degenerate, so the panel falls back to the raw score.
  assert.equal(v.perJudge[0]?.calibratedScore, 0.95);
  assert.equal(v.perJudge[1]?.calibratedScore, 0.92);
  for (const r of v.perJudge) {
    assert.equal(r.verdict, "pass");
  }
});

// ---------------------------------------------------------------------------
// Fixture: both-fail deterministic
// ---------------------------------------------------------------------------

test("both-fail verdict is deterministic and routes to needs_review/critical", () => {
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", score: 0.05, reason: "primary low" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.1,
        reason: "secondary low",
      }),
    ],
  });
  const v = verdicts[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  assert.equal(v.agreement, "both_fail");
  assert.equal(v.resolvedSeverity, JUDGE_BOTH_FAIL_SEVERITY);
  assert.equal(v.escalationRoute, "needs_review");
  for (const r of v.perJudge) {
    assert.equal(r.verdict, "fail");
  }
});

// ---------------------------------------------------------------------------
// Fixture: AT-022 — disagreement is auditable + downgraded
// ---------------------------------------------------------------------------

test("AT-022: disagree downgrades severity by default and is auditable", () => {
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      // Primary is the high-scorer, secondary is low — opposing verdicts.
      sample({ judgeId: "judge_primary", score: 0.99, reason: "primary high" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.05,
        reason: "secondary low",
      }),
    ],
  });
  const v = verdicts[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  assert.equal(v.agreement, "disagree");
  assert.equal(v.resolvedSeverity, JUDGE_DISAGREE_SEVERITY);
  assert.equal(v.resolvedSeverity, "downgraded_disagreement");
  assert.equal(v.escalationRoute, "downgrade");
  // Per-judge raw verdicts persisted unchanged for AT-022 audit.
  const primary = v.perJudge.find((r) => r.judgeId === "judge_primary");
  const secondary = v.perJudge.find((r) => r.judgeId === "judge_secondary");
  assert.equal(primary?.verdict, "pass");
  assert.equal(secondary?.verdict, "fail");
  assert.equal(primary?.reason, "primary high");
  assert.equal(secondary?.reason, "secondary low");
  // Raw scores echoed alongside calibrated scores.
  assert.equal(primary?.score, 0.99);
  assert.equal(secondary?.score, 0.05);
});

test("AT-022: disagreementRoute=needs_review escalates instead of downgrading", () => {
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", score: 0.95, reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.1,
        reason: "s",
      }),
    ],
    policy: { disagreementRoute: "needs_review" },
  });
  const v = verdicts[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  assert.equal(v.agreement, "disagree");
  assert.equal(v.resolvedSeverity, "downgraded_disagreement");
  assert.equal(v.escalationRoute, "needs_review");
});

test("disagree never maps to severity outside downgraded_disagreement", () => {
  // If the panel agreement is disagree, the resolvedSeverity is
  // unconditionally `downgraded_disagreement`. Vary the sample shape
  // across uncertain x pass and fail x uncertain.
  const cases: ReadonlyArray<readonly [number, number]> = [
    [0.99, 0.5],
    [0.5, 0.05],
    [0.99, 0.05],
    [0.55, 0.99],
  ];
  for (const [primary, secondary] of cases) {
    const verdicts = buildJudgePanelVerdicts({
      samples: [
        sample({ judgeId: "judge_primary", score: primary, reason: "p" }),
        sample({
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: secondary,
          reason: "s",
        }),
      ],
    });
    const v = verdicts[0];
    assert.ok(v !== undefined);
    if (v === undefined) continue;
    if (v.agreement === "disagree") {
      assert.equal(v.resolvedSeverity, "downgraded_disagreement");
      assert.notEqual(v.escalationRoute, "accept");
    }
  }
});

// ---------------------------------------------------------------------------
// CalibraEval-style empirical-CDF calibration
// ---------------------------------------------------------------------------

test("calibration is per-judge empirical CDF (monotonic, distribution-aware)", () => {
  // Primary judge has a strong upward bias: scores cluster near 1.
  // Secondary judge has a wider distribution. Calibration should pull
  // primary's median observation down to ~0.5, breaking the verdict.
  const samples: readonly JudgePanelRawSample[] = [
    sample({
      testCaseId: "TC-A",
      judgeId: "judge_primary",
      score: 0.95,
      reason: "a-p",
    }),
    sample({
      testCaseId: "TC-A",
      judgeId: "judge_secondary",
      modelBinding: SECONDARY_MODEL,
      score: 0.9,
      reason: "a-s",
    }),
    sample({
      testCaseId: "TC-B",
      judgeId: "judge_primary",
      score: 0.96,
      reason: "b-p",
    }),
    sample({
      testCaseId: "TC-B",
      judgeId: "judge_secondary",
      modelBinding: SECONDARY_MODEL,
      score: 0.5,
      reason: "b-s",
    }),
    sample({
      testCaseId: "TC-C",
      judgeId: "judge_primary",
      score: 0.97,
      reason: "c-p",
    }),
    sample({
      testCaseId: "TC-C",
      judgeId: "judge_secondary",
      modelBinding: SECONDARY_MODEL,
      score: 0.1,
      reason: "c-s",
    }),
  ];
  const verdicts = buildJudgePanelVerdicts({ samples });
  // Sorted by (testCaseId, criterion).
  assert.deepEqual(
    verdicts.map((v) => v.testCaseId),
    ["TC-A", "TC-B", "TC-C"],
  );

  const tcA = verdicts[0];
  const tcB = verdicts[1];
  const tcC = verdicts[2];
  assert.ok(tcA && tcB && tcC);
  if (!tcA || !tcB || !tcC) return;

  const aPrimary = tcA.perJudge.find((r) => r.judgeId === "judge_primary");
  const bPrimary = tcB.perJudge.find((r) => r.judgeId === "judge_primary");
  const cPrimary = tcC.perJudge.find((r) => r.judgeId === "judge_primary");
  assert.ok(aPrimary && bPrimary && cPrimary);
  if (!aPrimary || !bPrimary || !cPrimary) return;

  // Primary's three raw scores [0.95, 0.96, 0.97] map via empirical
  // CDF to {1/3, 2/3, 3/3}. So primary on TC-A is BELOW the pass
  // threshold despite scoring 0.95 raw.
  assert.equal(aPrimary.calibratedScore, 1 / 3);
  assert.equal(bPrimary.calibratedScore, 2 / 3);
  assert.equal(cPrimary.calibratedScore, 1);

  // Monotonicity: higher raw score -> not lower calibrated score.
  assert.ok(aPrimary.calibratedScore <= bPrimary.calibratedScore);
  assert.ok(bPrimary.calibratedScore <= cPrimary.calibratedScore);

  // Verdict mapping is via fixed thresholds against calibrated score.
  assert.ok(aPrimary.calibratedScore <= JUDGE_FAIL_THRESHOLD);
  assert.equal(aPrimary.verdict, "fail");
  // 2/3 sits in the uncertain band (FAIL_THRESHOLD, PASS_THRESHOLD).
  assert.ok(bPrimary.calibratedScore > JUDGE_FAIL_THRESHOLD);
  assert.ok(bPrimary.calibratedScore < JUDGE_PASS_THRESHOLD);
  assert.equal(bPrimary.verdict, "uncertain");
  assert.ok(cPrimary.calibratedScore >= JUDGE_PASS_THRESHOLD);
  assert.equal(cPrimary.verdict, "pass");
});

test("calibration is byte-stable for byte-identical inputs", () => {
  const inputA: readonly JudgePanelRawSample[] = [
    sample({ testCaseId: "TC-1", judgeId: "judge_primary", score: 0.8, reason: "1p" }),
    sample({
      testCaseId: "TC-1",
      judgeId: "judge_secondary",
      modelBinding: SECONDARY_MODEL,
      score: 0.85,
      reason: "1s",
    }),
    sample({ testCaseId: "TC-2", judgeId: "judge_primary", score: 0.7, reason: "2p" }),
    sample({
      testCaseId: "TC-2",
      judgeId: "judge_secondary",
      modelBinding: SECONDARY_MODEL,
      score: 0.75,
      reason: "2s",
    }),
  ];
  // Reorder samples — calibration is set-valued per judge, so byte
  // output is unchanged.
  const inputB: readonly JudgePanelRawSample[] = [
    inputA[3]!,
    inputA[1]!,
    inputA[2]!,
    inputA[0]!,
  ];
  const a = buildJudgePanelVerdicts({ samples: inputA });
  const b = buildJudgePanelVerdicts({ samples: inputB });
  assert.equal(canonicalJson(a), canonicalJson(b));
});

// ---------------------------------------------------------------------------
// Bias controls
// ---------------------------------------------------------------------------

test("no length normalisation: short and long reasons score identically given equal raw score", () => {
  // Two cases — one with a 1-char reason, one with a 200-char reason.
  // Raw scores are identical, calibration is identical, calibrated
  // scores must be identical (verbosity-bias inversion 2025).
  const longReason = "x".repeat(200);
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({
        testCaseId: "TC-short",
        judgeId: "judge_primary",
        score: 0.8,
        reason: "x",
      }),
      sample({
        testCaseId: "TC-short",
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.8,
        reason: "y",
      }),
      sample({
        testCaseId: "TC-long",
        judgeId: "judge_primary",
        score: 0.8,
        reason: longReason,
      }),
      sample({
        testCaseId: "TC-long",
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.8,
        reason: longReason,
      }),
    ],
  });
  const shortV = verdicts.find((v) => v.testCaseId === "TC-short");
  const longV = verdicts.find((v) => v.testCaseId === "TC-long");
  assert.ok(shortV && longV);
  if (!shortV || !longV) return;
  for (const judgeId of JUDGE_PANEL_JUDGE_IDS) {
    const shortJudge = shortV.perJudge.find((r) => r.judgeId === judgeId);
    const longJudge = longV.perJudge.find((r) => r.judgeId === judgeId);
    assert.equal(shortJudge?.calibratedScore, longJudge?.calibratedScore);
    assert.equal(shortJudge?.verdict, longJudge?.verdict);
  }
});

test("rejects reasons containing line-separator codepoints (U+000A/U+000D/U+2028/U+2029)", () => {
  for (const ch of ["\n", "\r", "\u2028", "\u2029"]) {
    assert.throws(
      () =>
        buildJudgePanelVerdicts({
          samples: [
            sample({ judgeId: "judge_primary", reason: `before${ch}after` }),
            sample({
              judgeId: "judge_secondary",
              modelBinding: SECONDARY_MODEL,
              reason: "ok",
            }),
          ],
        }),
      /forbidden control \/ line-separator/u,
    );
  }
});

test("rejects over-long reasons", () => {
  const tooLong = "x".repeat(JUDGE_PANEL_REASON_MAX_CHARS + 1);
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", reason: tooLong }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "ok",
          }),
        ],
      }),
    /JUDGE_PANEL_REASON_MAX_CHARS/u,
  );
});

test("accepts a reason exactly at the JUDGE_PANEL_REASON_MAX_CHARS boundary", () => {
  const atBoundary = "x".repeat(JUDGE_PANEL_REASON_MAX_CHARS);
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", reason: atBoundary }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        reason: atBoundary,
      }),
    ],
  });
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0]?.perJudge[0]?.reason.length, JUDGE_PANEL_REASON_MAX_CHARS);
});

// ---------------------------------------------------------------------------
// Validation refusals
// ---------------------------------------------------------------------------

test("rejects empty samples array", () => {
  assert.throws(
    () => buildJudgePanelVerdicts({ samples: [] }),
    /non-empty array/u,
  );
});

test("rejects an unknown judgeId", () => {
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({
            judgeId: "judge_third" as unknown as "judge_primary",
            reason: "p",
          }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
      }),
    /unknown judgeId/u,
  );
});

test("rejects a duplicate (testCaseId, criterion, judgeId) triple", () => {
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", reason: "p1" }),
          sample({ judgeId: "judge_primary", reason: "p2" }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
      }),
    /duplicate samples/u,
  );
});

test("rejects an incomplete panel (missing judge for a case)", () => {
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [sample({ judgeId: "judge_primary", reason: "p" })],
      }),
    /incomplete panel/u,
  );
});

test("rejects an out-of-range raw score", () => {
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", score: 1.5, reason: "p" }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
      }),
    /score must be a finite number in \[0, 1\]/u,
  );
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", score: -0.1, reason: "p" }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
      }),
    /score must be a finite number in \[0, 1\]/u,
  );
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", score: Number.NaN, reason: "p" }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
      }),
    /score must be a finite number in \[0, 1\]/u,
  );
});

test("rejects unknown disagreementRoute policy", () => {
  assert.throws(
    () =>
      buildJudgePanelVerdicts({
        samples: [
          sample({ judgeId: "judge_primary", reason: "p" }),
          sample({
            judgeId: "judge_secondary",
            modelBinding: SECONDARY_MODEL,
            reason: "s",
          }),
        ],
        policy: { disagreementRoute: "ignore" as unknown as "downgrade" },
      }),
    /unknown policy.disagreementRoute/u,
  );
});

// ---------------------------------------------------------------------------
// assertJudgePanelVerdictInvariants — boundary check
// ---------------------------------------------------------------------------

test("assertJudgePanelVerdictInvariants accepts a builder-produced verdict", () => {
  const v = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        reason: "s",
      }),
    ],
  })[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  assertJudgePanelVerdictInvariants(v);
});

test("assertJudgePanelVerdictInvariants refuses agreement/severity inconsistency", () => {
  const v = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", score: 0.99, reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.05,
        reason: "s",
      }),
    ],
  })[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  // Manually craft a tampered copy that claims both_pass.
  const tampered: JudgePanelVerdict = {
    ...v,
    agreement: "both_pass",
  };
  assert.throws(
    () => assertJudgePanelVerdictInvariants(tampered),
    /inconsistent with perJudge verdicts/u,
  );
});

test("assertJudgePanelVerdictInvariants refuses unsorted perJudge entries", () => {
  const v = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        reason: "s",
      }),
    ],
  })[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  const reversed: JudgePanelVerdict = {
    ...v,
    perJudge: [v.perJudge[1]!, v.perJudge[0]!],
  };
  assert.throws(
    () => assertJudgePanelVerdictInvariants(reversed),
    /sorted alphabetically by judgeId/u,
  );
});

test("assertJudgePanelVerdictInvariants refuses bad schemaVersion", () => {
  const v = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        reason: "s",
      }),
    ],
  })[0];
  assert.ok(v !== undefined);
  if (v === undefined) return;
  const bad: JudgePanelVerdict = {
    ...v,
    schemaVersion: "0.0.0" as unknown as typeof JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
  };
  assert.throws(() => assertJudgePanelVerdictInvariants(bad), /schemaVersion/u);
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test("writeJudgePanelVerdicts persists canonical JSON to <runDir>/judge-panel-verdicts.json", async () => {
  await withRunDir(async (runDir) => {
    const verdicts = buildJudgePanelVerdicts({
      samples: [
        sample({
          testCaseId: "TC-2",
          judgeId: "judge_primary",
          score: 0.9,
          reason: "p2",
        }),
        sample({
          testCaseId: "TC-2",
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.91,
          reason: "s2",
        }),
        sample({
          testCaseId: "TC-1",
          judgeId: "judge_primary",
          score: 0.05,
          reason: "p1",
        }),
        sample({
          testCaseId: "TC-1",
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.06,
          reason: "s1",
        }),
      ],
    });
    const result = await writeJudgePanelVerdicts({ runDir, verdicts });
    assert.equal(
      result.artifactPath,
      join(runDir, JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(result.artifactPath, "utf8");
    assert.equal(onDisk, result.serialised);
    assert.ok(onDisk.endsWith("\n"));

    // Parse and re-validate.
    const parsed: readonly JudgePanelVerdict[] = JSON.parse(onDisk);
    assert.equal(parsed.length, 2);
    // Sorted by testCaseId.
    assert.equal(parsed[0]?.testCaseId, "TC-1");
    assert.equal(parsed[1]?.testCaseId, "TC-2");
    for (const v of parsed) {
      assertJudgePanelVerdictInvariants(v);
    }

    // Canonical-JSON byte-stability across rebuilds.
    assert.equal(serializeJudgePanelVerdicts(parsed), result.serialised);
  });
});

test("writeJudgePanelVerdicts refuses an empty verdict array", async () => {
  await withRunDir(async (runDir) => {
    await assert.rejects(
      writeJudgePanelVerdicts({ runDir, verdicts: [] }),
      /non-empty array/u,
    );
  });
});

test("writeJudgePanelVerdicts refuses unsorted verdict input", async () => {
  await withRunDir(async (runDir) => {
    const verdicts = buildJudgePanelVerdicts({
      samples: [
        sample({
          testCaseId: "TC-A",
          judgeId: "judge_primary",
          score: 0.1,
          reason: "ap",
        }),
        sample({
          testCaseId: "TC-A",
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.1,
          reason: "as",
        }),
        sample({
          testCaseId: "TC-B",
          judgeId: "judge_primary",
          score: 0.1,
          reason: "bp",
        }),
        sample({
          testCaseId: "TC-B",
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.1,
          reason: "bs",
        }),
      ],
    });
    // Reverse order — must be refused.
    const reversed: readonly JudgePanelVerdict[] = [verdicts[1]!, verdicts[0]!];
    await assert.rejects(
      writeJudgePanelVerdicts({ runDir, verdicts: reversed }),
      /sorted by \(testCaseId, criterion\)/u,
    );
  });
});

test("writeJudgePanelVerdicts atomically replaces an existing artifact", async () => {
  await withRunDir(async (runDir) => {
    const v1 = buildJudgePanelVerdicts({
      samples: [
        sample({ judgeId: "judge_primary", score: 0.9, reason: "v1p" }),
        sample({
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.9,
          reason: "v1s",
        }),
      ],
    });
    await writeJudgePanelVerdicts({ runDir, verdicts: v1 });

    const v2 = buildJudgePanelVerdicts({
      samples: [
        sample({ judgeId: "judge_primary", score: 0.05, reason: "v2p" }),
        sample({
          judgeId: "judge_secondary",
          modelBinding: SECONDARY_MODEL,
          score: 0.05,
          reason: "v2s",
        }),
      ],
    });
    const result = await writeJudgePanelVerdicts({ runDir, verdicts: v2 });
    const onDisk = await readFile(result.artifactPath, "utf8");
    assert.ok(onDisk.includes("\"v2p\""));
    assert.ok(!onDisk.includes("\"v1p\""));
  });
});

test("serializeJudgePanelVerdicts preserves canonical-JSON ordering", () => {
  const verdicts = buildJudgePanelVerdicts({
    samples: [
      sample({ judgeId: "judge_primary", score: 0.9, reason: "p" }),
      sample({
        judgeId: "judge_secondary",
        modelBinding: SECONDARY_MODEL,
        score: 0.9,
        reason: "s",
      }),
    ],
  });
  const serialised = serializeJudgePanelVerdicts(verdicts);
  assert.ok(serialised.endsWith("\n"));
  const parsed = JSON.parse(serialised);
  assert.equal(serializeJudgePanelVerdicts(parsed), serialised);
});
