import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  AGENT_LESSONS_EVAL_REPORT_ARTIFACT_FILENAME,
  AGENT_LESSONS_EVAL_REPORT_SCHEMA_VERSION,
} from "../contracts/index.js";
import {
  agentLessonsEvalInputFixturePath,
  buildAgentLessonsEvalReport,
  readAgentLessonsEvalReport,
  writeAgentLessonsEvalReport,
} from "./agent-lessons-eval.js";

const GENERATED_AT = "2026-05-04T00:00:00.000Z";

test("agent-lessons-eval: checked-in report matches the deterministic builder", async () => {
  const built = await buildAgentLessonsEvalReport({ generatedAt: GENERATED_AT });
  const persisted = await readAgentLessonsEvalReport();
  assert.deepEqual(persisted, built);
});

test("agent-lessons-eval: every approved lesson passes its referenced fixture", async () => {
  const report = await buildAgentLessonsEvalReport({ generatedAt: GENERATED_AT });
  assert.equal(report.schemaVersion, AGENT_LESSONS_EVAL_REPORT_SCHEMA_VERSION);
  assert.equal(report.passed, true);
  assert.ok(report.lessons.length > 0);
  for (const lesson of report.lessons) {
    assert.equal(lesson.selected, true, lesson.lessonId);
    assert.equal(lesson.pass, true, lesson.lessonId);
    assert.equal(lesson.candidateCoverageRate, 1, lesson.lessonId);
    assert.ok(lesson.deltaVsBaseline >= 0, lesson.lessonId);
    assert.equal(lesson.promptHashChanged, true, lesson.lessonId);
  }
});

test("agent-lessons-eval: checked-in report is canonical JSON", async () => {
  const report = await readAgentLessonsEvalReport();
  const raw = await readFile(
    join(
      new URL(".", import.meta.url).pathname,
      "fixtures",
      AGENT_LESSONS_EVAL_REPORT_ARTIFACT_FILENAME,
    ),
    "utf8",
  );
  assert.equal(raw, canonicalJson(report));
});

test("agent-lessons-eval: write helper is byte-stable on repeated writes", async () => {
  const report = await buildAgentLessonsEvalReport({ generatedAt: GENERATED_AT });
  const tempDir = await mkdtemp(join(tmpdir(), "agent-lessons-eval-"));
  try {
    const outputPath = join(tempDir, AGENT_LESSONS_EVAL_REPORT_ARTIFACT_FILENAME);
    await writeAgentLessonsEvalReport({ report, outputPath });
    const first = await readFile(outputPath, "utf8");
    await writeAgentLessonsEvalReport({ report, outputPath });
    const second = await readFile(outputPath, "utf8");
    assert.equal(first, second);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("agent-lessons-eval: input fixture path is stable and repo-local", () => {
  assert.match(
    agentLessonsEvalInputFixturePath(),
    /src\/test-intelligence\/fixtures\/agent-lessons-eval-input\.json$/u,
  );
});
