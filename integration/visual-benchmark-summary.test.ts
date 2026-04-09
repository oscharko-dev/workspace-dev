import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

test("buildVisualBenchmarkSummary renders markdown and check payload with threshold annotations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-summary-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 75 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 75,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: {
        score: 75,
        verdict: "warn",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 75,
      diffImagePath: "visual-quality/diff.png",
    });

    const { buildVisualBenchmarkSummary } = await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(path.join(artifactRoot, "last-run.json"));

    assert.match(summary.markdown, /Overall Average:\*\* 75/);
    assert.match(summary.markdown, /Warned Fixtures:\*\* 1/);
    assert.match(summary.markdown, /Failed Fixtures:\*\* 0/);
    assert.equal(summary.check.annotations.length, 1);
    assert.equal(summary.check.annotations[0]?.annotation_level, "warning");
    assert.match(summary.check.text, /Artifacts: /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("print-visual-benchmark-summary writes check output and fails on malformed reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-summary-cli-"));

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 95 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 95,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: {
        score: 95,
        verdict: "pass",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 95,
      diffImagePath: "visual-quality/diff.png",
    });

    const outputPath = path.join(artifactRoot, "check-output.json");
    const summaryPath = path.join(root, "step-summary.md");
    const command = `GITHUB_STEP_SUMMARY=${JSON.stringify(summaryPath)} node scripts/print-visual-benchmark-summary.mjs ${JSON.stringify(path.join(artifactRoot, "last-run.json"))} --check-output ${JSON.stringify(outputPath)}`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    await execFileAsync("zsh", ["-lc", command], {
      cwd: process.cwd(),
    });

    const writtenSummary = await readFile(summaryPath, "utf8");
    const checkOutput = JSON.parse(await readFile(outputPath, "utf8")) as {
      title: string;
      summary: string;
    };
    assert.match(writtenSummary, /Visual Quality Benchmark/);
    assert.match(checkOutput.title, /Visual benchmark:/);

    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "failed",
    });

    await assert.rejects(
      () =>
        execFileAsync(
          "zsh",
          [
            "-lc",
            `node scripts/print-visual-benchmark-summary.mjs ${JSON.stringify(path.join(artifactRoot, "last-run.json"))}`,
          ],
          { cwd: process.cwd() },
        ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
