import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

test("buildVisualBenchmarkPrComment renders markdown with score, delta, trend, and dimension breakdown", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-"),
  );

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
        { name: "Layout Accuracy", weight: 0.3, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.2, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.1, score: 78 },
      ],
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 2,
      scores: [{ fixtureId: "simple-form", score: 80 }],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
      artifactUrl: "https://github.com/test/repo/actions/runs/123",
    });

    assert.equal(result.marker, "<!-- workspace-dev-visual-benchmark -->");
    assert.ok(result.body.startsWith(result.marker));
    assert.match(result.body, /Overall Score:\*\* 85/);
    assert.match(result.body, /\+5 vs baseline 80 across 1 comparable fixture/);
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
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-no-baseline-"),
  );

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
        { name: "Layout Accuracy", weight: 0.3, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.2, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.1, score: 78 },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath: path.join(root, "nonexistent-baseline.json"),
    });

    assert.match(result.body, /no comparable baseline/);
    assert.match(result.body, /\u2014/);
    assert.match(result.body, /\u2014 no baseline/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment handles missing report.json gracefully", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-missing-report-"),
  );

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
        { name: "Layout Accuracy", weight: 0.3, score: 92 },
        { name: "Color Fidelity", weight: 0.25, score: 91 },
        { name: "Typography", weight: 0.2, score: 88 },
        { name: "Component Structure", weight: 0.15, score: 87 },
        { name: "Spacing & Alignment", weight: 0.1, score: 85 },
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

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
    });

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
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-cli-"),
  );

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
        { name: "Layout Accuracy", weight: 0.3, score: 88 },
        { name: "Color Fidelity", weight: 0.25, score: 90 },
        { name: "Typography", weight: 0.2, score: 82 },
        { name: "Component Structure", weight: 0.15, score: 80 },
        { name: "Spacing & Alignment", weight: 0.1, score: 78 },
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
    await assert.rejects(() =>
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

test("buildVisualBenchmarkPrComment computes header delta from matched fixtures only", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-partial-baseline-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureA = path.join(artifactRoot, "last-run", "fixture-a");
    const fixtureB = path.join(artifactRoot, "last-run", "fixture-b");
    await mkdir(fixtureA, { recursive: true });
    await mkdir(fixtureB, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [
        { fixtureId: "fixture-a", score: 100 },
        { fixtureId: "fixture-b", score: 50 },
      ],
    });

    for (const [fixtureId, fixtureDir, score] of [
      ["fixture-a", fixtureA, 100],
      ["fixture-b", fixtureB, 50],
    ] as const) {
      await writeJson(path.join(fixtureDir, "manifest.json"), {
        version: 1,
        fixtureId,
        score,
        ranAt: "2026-04-10T10:00:00.000Z",
        viewport: { width: 1280, height: 720 },
      });
    }

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 2,
      scores: [{ fixtureId: "fixture-a", score: 80 }],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
    });

    assert.match(result.body, /Overall Score:\*\* 75 \/ 100/);
    assert.match(
      result.body,
      /\+20 vs baseline 80 across 1 comparable fixture; 1 fixture excluded \(no baseline\)/,
    );
    assert.match(
      result.body,
      /\| Fixture B \| ❌ 50 \| — \| — \| — no baseline \|/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment escapes markdown-sensitive fixture and dimension values", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-escape-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "pipe-|fixture|-name";
    const fixtureDir = path.join(artifactRoot, "last-run", fixtureId);
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [{ fixtureId, score: 88 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId,
      score: 88,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 88,
      dimensions: [
        { name: "Spacing | Alignment", weight: 0.5, score: 89 },
        { name: "<Unsafe>", weight: 0.5, score: 87 },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {});

    assert.match(result.body, /\| Pipe \\|fixture\\| Name \|/);
    assert.match(result.body, /\| Spacing \\| Alignment \|/);
    assert.match(result.body, /\| &lt;Unsafe&gt; \|/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment ignores malformed dimension rows gracefully", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-dimension-validation-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 83 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 83,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 83,
      dimensions: [
        { name: "Valid Dimension", weight: 0.5, score: 84 },
        { name: "Bad Weight", weight: "0.2", score: 81 },
        { name: "Bad Score", weight: 0.3, score: "81" },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {});

    assert.match(result.body, /\| Valid Dimension \| 50% \| 84 \|/);
    assert.doesNotMatch(result.body, /Bad Weight/);
    assert.doesNotMatch(result.body, /Bad Score/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment looks up baseline with composite key for multi-screen fixtures (H4 fix)", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-composite-key-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "multi";
    const homeDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "2_10001",
    );
    const settingsDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "2_10002",
    );
    await mkdir(homeDir, { recursive: true });
    await mkdir(settingsDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    // Two entries with same fixtureId but different screenIds — if the
    // baseline map is keyed by fixtureId alone, the second overwrites the first
    // and the delta computation collapses the two screens.
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          score: 90,
        },
        {
          fixtureId,
          screenId: "2:10002",
          screenName: "Settings",
          score: 70,
        },
      ],
    });
    await writeJson(path.join(homeDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10001",
      screenName: "Home",
      score: 90,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(settingsDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10002",
      screenName: "Settings",
      score: 70,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 3,
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          score: 80,
        },
        {
          fixtureId,
          screenId: "2:10002",
          screenName: "Settings",
          score: 60,
        },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
    });

    // Both screens must have their own delta — Home +10, Settings +10.
    // If the composite key lookup is broken the second write clobbers the first
    // and we lose the Home baseline or get a wrong delta for one of them.
    assert.match(
      result.body,
      /\+10 vs baseline 70 across 2 comparable fixtures/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("print-visual-benchmark-pr-comment CLI writes fallback payload when report cannot be built", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-cli-fallback-"),
  );

  try {
    const outputPath = path.join(root, "output.json");
    const summaryPath = path.join(root, "step-summary.md");
    await writeFile(summaryPath, "", "utf8");

    const missingReportPath = path.join(root, "missing-last-run.json");
    const command = `GITHUB_STEP_SUMMARY=${JSON.stringify(summaryPath)} node scripts/print-visual-benchmark-pr-comment.mjs ${JSON.stringify(missingReportPath)} --output ${JSON.stringify(outputPath)}`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    await execFileAsync("zsh", ["-lc", command], {
      cwd: process.cwd(),
    });

    const outputRaw = await readFile(outputPath, "utf8");
    const output = JSON.parse(outputRaw) as { marker: string; body: string };
    assert.equal(output.marker, "<!-- workspace-dev-visual-benchmark -->");
    assert.match(output.body, /skipped due to missing or malformed artifacts/);

    const summaryContent = await readFile(summaryPath, "utf8");
    assert.match(
      summaryContent,
      /skipped due to missing or malformed artifacts/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
