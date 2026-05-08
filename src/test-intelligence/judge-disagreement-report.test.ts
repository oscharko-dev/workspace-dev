/**
 * Judge disagreement report tests (Issue #2038).
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertJudgeDisagreementReportInvariants,
  buildJudgeDisagreementReport,
  serializeJudgeDisagreementReport,
  writeJudgeDisagreementReport,
} from "./judge-disagreement-report.js";
import type { JudgeFamilyBinding } from "./cross-family-judge-policy.js";
import type { JudgeModelFamily } from "../contracts/index.js";

const baseBinding = (
  judgeId: string,
  family: JudgeModelFamily,
  verdict: JudgeFamilyBinding["verdict"],
): JudgeFamilyBinding => ({
  judgeId,
  family,
  modelId: `${family}-test-model`,
  promptVersion: `${judgeId}.v1`,
  region: "eu",
  verdict,
});

test("buildJudgeDisagreementReport produces a sorted, frozen, valid report", () => {
  const report = buildJudgeDisagreementReport({
    jobId: "job-2038",
    generatedAt: "2026-05-08T12:00:00Z",
    bindings: [
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "repair"),
      baseBinding("a11y_judge", "google", "reject"),
    ],
  });
  assert.equal(report.decision, "split_decision");
  assert.equal(report.escalation, "human_review_required");
  assert.equal(report.rawPromptsIncluded, false);
  // Judges sorted alphabetically by judgeId.
  assert.deepEqual(report.judges.map((j) => j.judgeId), [
    "a11y_judge",
    "faithfulness_judge",
    "logic_judge",
  ]);
  // perFamilyAgreement and costByFamily are sorted by family.
  assert.deepEqual(
    report.perFamilyAgreement.map((c) => c.family),
    ["anthropic", "google", "openai"],
  );
  assert.deepEqual(report.costByFamily.map((c) => c.family), [
    "anthropic",
    "google",
    "openai",
  ]);
  assert.doesNotThrow(() => assertJudgeDisagreementReportInvariants(report));
});

test("buildJudgeDisagreementReport surfaces zero rates on a unanimous panel", () => {
  const report = buildJudgeDisagreementReport({
    jobId: "job-unanimous",
    generatedAt: "2026-05-08T12:00:00Z",
    bindings: [
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "accept"),
      baseBinding("a11y_judge", "google", "accept"),
    ],
  });
  assert.equal(report.decision, "unanimous_accept");
  assert.equal(report.escalation, "none");
  assert.equal(report.disagreementRate, 0);
  assert.equal(report.escalationRate, 0);
});

test("buildJudgeDisagreementReport normalises a per-family cost rollup", () => {
  const report = buildJudgeDisagreementReport({
    jobId: "job-cost",
    generatedAt: "2026-05-08T12:00:00Z",
    bindings: [
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "accept"),
    ],
    costByFamily: new Map([
      ["anthropic", { totalTokens: 1500, costMicrounits: 50 }],
    ]),
  });
  assert.deepEqual(report.costByFamily, [
    { family: "anthropic", totalTokens: 1500, costMicrounits: 50 },
    { family: "openai", totalTokens: 0, costMicrounits: 0 },
  ]);
});

test("serializeJudgeDisagreementReport is byte-stable across runs", () => {
  const input = {
    jobId: "job-stable",
    generatedAt: "2026-05-08T12:00:00Z",
    bindings: [
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "accept"),
    ],
  };
  const a = serializeJudgeDisagreementReport(buildJudgeDisagreementReport(input));
  const b = serializeJudgeDisagreementReport(buildJudgeDisagreementReport(input));
  assert.equal(a, b);
});

test("writeJudgeDisagreementReport persists the canonical artifact atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "judge-disagreement-"));
  try {
    const report = buildJudgeDisagreementReport({
      jobId: "job-write",
      generatedAt: "2026-05-08T12:00:00Z",
      bindings: [
        baseBinding("logic_judge", "anthropic", "accept"),
        baseBinding("faithfulness_judge", "openai", "accept"),
      ],
    });
    const result = await writeJudgeDisagreementReport({ runDir: dir, report });
    assert.equal(
      result.artifactPath,
      join(dir, "judge-disagreement-report.json"),
    );
    const fileContents = await readFile(result.artifactPath, "utf8");
    assert.equal(fileContents, result.serialised);
    const reloaded = JSON.parse(fileContents);
    assert.equal(reloaded.jobId, "job-write");
    assert.equal(reloaded.rawPromptsIncluded, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildJudgeDisagreementReport refuses an unknown family", () => {
  assert.throws(
    () =>
      buildJudgeDisagreementReport({
        jobId: "job-bad-family",
        generatedAt: "2026-05-08T12:00:00Z",
        bindings: [
          {
            judgeId: "logic_judge",
            family: "unknown" as JudgeModelFamily,
            modelId: "x",
            promptVersion: "logic-judge.v1",
            region: "eu",
            verdict: "accept",
          },
        ],
      }),
    /not a known JudgeModelFamily/u,
  );
});
