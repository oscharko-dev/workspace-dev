import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

test("buildVisualBenchmarkPrComment renders markdown with score, delta, trend, and dimension breakdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pr-comment-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 85 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 85,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 85, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 85,
      dimensions: [
        { name: "Layout Accuracy", weight: 0.30, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.20, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.10, score: 78 },
      ],
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 2,
      scores: [{ fixtureId: "simple-form", score: 80 }],
    });

    const { buildVisualBenchmarkPrComment } = await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
      artifactUrl: "https://github.com/test/repo/actions/runs/123",
    });

    assert.equal(result.marker, "<!-- workspace-dev-visual-benchmark -->");
    assert.ok(result.body.startsWith(result.marker));
    assert.match(result.body, /Overall Score:\*\* 85/);
    assert.match(result.body, /\+5/);
    assert.match(result.body, /\u2191 improved/);
    assert.match(result.body, /Layout Accuracy/);
    assert.match(result.body, /<details>/);
    assert.match(result.body, /Diff Images/);
    assert.match(result.body, /Download artifacts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment handles missing baseline gracefully", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pr-comment-no-baseline-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 85 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 85,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 85, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 85,
      dimensions: [
        { name: "Layout Accuracy", weight: 0.30, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.20, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.10, score: 78 },
      ],
    });

    const { buildVisualBenchmarkPrComment } = await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath: path.join(root, "nonexistent-baseline.json"),
    });

    assert.match(result.body, /no baseline/);
    assert.match(result.body, /\u2014/);
    assert.match(result.body, /\u2192 stable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment handles missing report.json gracefully", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pr-comment-missing-report-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const simpleFormDir = path.join(artifactRoot, "last-run", "simple-form");
    const dataTableDir = path.join(artifactRoot, "last-run", "data-table");
    await mkdir(simpleFormDir, { recursive: true });
    await mkdir(dataTableDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [
        { fixtureId: "simple-form", score: 90 },
        { fixtureId: "data-table", score: 75 },
      ],
    });

    await writeJson(path.join(simpleFormDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 90,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 90, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(simpleFormDir, "report.json"), {
      status: "completed",
      overallScore: 90,
      dimensions: [
        { name: "Layout Accuracy", weight: 0.30, score: 92 },
        { name: "Color Fidelity", weight: 0.25, score: 91 },
        { name: "Typography", weight: 0.20, score: 88 },
        { name: "Component Structure", weight: 0.15, score: 87 },
        { name: "Spacing & Alignment", weight: 0.10, score: 85 },
      ],
    });

    await writeJson(path.join(dataTableDir, "manifest.json"), {
      version: 1,
      fixtureId: "data-table",
      score: 75,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 75, verdict: "warn", thresholds: { warn: 80 } },
    });
    // No report.json for data-table — intentionally omitted

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 2,
      scores: [
        { fixtureId: "simple-form", score: 85 },
        { fixtureId: "data-table", score: 70 },
      ],
    });

    const { buildVisualBenchmarkPrComment } = await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, { baselinePath });

    assert.match(result.body, /Simple Form/);
    assert.match(result.body, /Data Table/);
    assert.match(result.body, /Layout Accuracy/);
    assert.match(result.body, /#### Simple Form/);
    assert.doesNotMatch(result.body, /#### Data Table/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("print-visual-benchmark-pr-comment CLI writes JSON payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pr-comment-cli-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 85 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 85,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 85, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 85,
      dimensions: [
        { name: "Layout Accuracy", weight: 0.30, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.20, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.10, score: 78 },
      ],
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 2,
      scores: [{ fixtureId: "simple-form", score: 80 }],
    });

    const outputPath = path.join(root, "output.json");
    const summaryPath = path.join(root, "step-summary.md");
    await writeFile(summaryPath, "", "utf8");

    const command = `GITHUB_STEP_SUMMARY=${JSON.stringify(summaryPath)} node scripts/print-visual-benchmark-pr-comment.mjs ${JSON.stringify(reportPath)} --output ${JSON.stringify(outputPath)} --baseline-path ${JSON.stringify(baselinePath)} --artifact-url https://example.com/artifacts`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    await execFileAsync("zsh", ["-lc", command], {
      cwd: process.cwd(),
    });

    const outputRaw = await readFile(outputPath, "utf8");
    const output = JSON.parse(outputRaw) as { marker: string; body: string };
    assert.equal(output.marker, "<!-- workspace-dev-visual-benchmark -->");
    assert.match(output.body, /Visual Quality Benchmark/);

    const summaryContent = await readFile(summaryPath, "utf8");
    assert.match(summaryContent, /Visual Quality Benchmark/);

    // Running without --output should fail
    await assert.rejects(
      () =>
        execFileAsync(
          "zsh",
          [
            "-lc",
            `node scripts/print-visual-benchmark-pr-comment.mjs ${JSON.stringify(reportPath)}`,
          ],
          { cwd: process.cwd() },
        ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
