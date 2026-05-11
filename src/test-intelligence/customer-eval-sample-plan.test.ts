import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..", "..");

const readRepoFile = async (relativePath: string) =>
  await readFile(path.join(REPO_ROOT, relativePath), "utf8");

test("customer-eval sample plan documents the required governance fields", async () => {
  const samplePlan = await readRepoFile(
    "fixtures/test-intelligence/customer-evals/SAMPLE-PLAN.md",
  );

  assert.match(samplePlan, /^# Customer-Eval Rubric Sample Plan/mu);
  assert.match(samplePlan, /\*\*Last reviewed:\*\* 2026-05-10/u);
  assert.match(samplePlan, /## 4\. Domain Stratification/u);
  assert.match(samplePlan, /## 5\. Sampling Method/u);
  assert.match(samplePlan, /## 6\. Inter-Rater Protocol/u);
  assert.match(samplePlan, /## 7\. Coverage Statement/u);
  assert.match(samplePlan, /## 8\. Refresh Cadence/u);
  assert.match(samplePlan, /stratified purposive/u);
  assert.match(samplePlan, /Cohen's kappa/u);
  assert.match(samplePlan, /Rubric-only changes MUST either update this file/u);
});

test("customer-eval sample plan traces both rubrics back to explicit source families", async () => {
  const samplePlan = await readRepoFile(
    "fixtures/test-intelligence/customer-evals/SAMPLE-PLAN.md",
  );

  assert.match(samplePlan, /### 9\.1 `Testfall-eines-Anwendungstests\.md`/u);
  assert.match(samplePlan, /### 9\.2 `Eingabemasken-Testfallrubrik\.md`/u);
  assert.match(samplePlan, /Section 10 `Grounding Stand 2026`/u);
  assert.match(samplePlan, /Section 3 `Pflicht-Techniken`/u);
  assert.match(samplePlan, /Regulation \/ standards/u);
  assert.match(samplePlan, /Fixture evidence/u);
  assert.match(samplePlan, /Audit finding \/ calibration evidence/u);
});

test("customer-eval sample-plan non-update note defines the explicit override path", async () => {
  const nonUpdate = await readRepoFile(
    "fixtures/test-intelligence/customer-evals/SAMPLE-PLAN-NON-UPDATE.md",
  );

  assert.match(nonUpdate, /^# Customer-Eval Sample Plan Non-Update Note/mu);
  assert.match(nonUpdate, /Append a short entry with:/u);
  assert.match(nonUpdate, /Rubric files changed:/u);
  assert.match(nonUpdate, /Non-update rationale:/u);
});

test("EU AI Act transparency summary points reviewers to the sample-plan artifact and its limits", async () => {
  const transparency = await readRepoFile("docs/eu-ai-act/transparency.md");

  assert.match(transparency, /^# EU AI Act — Transparency Summary/mu);
  assert.match(transparency, /Article 13/u);
  assert.match(
    transparency,
    /fixtures\/test-intelligence\/customer-evals\/SAMPLE-PLAN\.md/u,
  );
  assert.match(transparency, /Known limits disclosed to reviewers/u);
  assert.match(transparency, /Rubric-only changes must update the sample plan/u);
});
