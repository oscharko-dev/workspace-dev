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
    assert.match(result.body, /\+5 vs baseline 80 across 1 comparable view/);
    assert.match(result.body, /\u2191 improved/);
    assert.match(
      result.body,
      /\| Simple Form \| ⚠️ 85 \| 80 \| \+5 \| ↑ improved \| pass \(warn 80, fail disabled\) \| 1280×720 \|/,
    );
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

test("buildVisualBenchmarkPrComment folds composite quality into the existing benchmark comment channel", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-composite-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-12T10:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 90 }],
      overallCurrent: 90,
    });
    await writeJson(path.join(artifactRoot, "composite-quality-report.json"), {
      version: 1,
      generatedAt: "2026-04-12T10:05:00.000Z",
      weights: {
        visual: 0.6,
        performance: 0.4,
      },
      visual: {
        score: 90,
        ranAt: "2026-04-12T10:00:00.000Z",
        source: "artifacts/visual-benchmark/last-run.json",
      },
      performance: {
        score: 84,
        sampleCount: 2,
        aggregateMetrics: {
          fcp_ms: 1250,
          lcp_ms: 1750,
          cls: 0.04,
          tbt_ms: 110,
          speed_index_ms: 1500,
        },
        samples: [],
        warnings: [],
      },
      composite: {
        score: 87.6,
        includedDimensions: ["visual", "performance"],
        explanation: "0.6 * 90 + 0.4 * 84 = 87.6",
      },
      warnings: [],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 90,
      ranAt: "2026-04-12T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: { score: 90, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 90,
      dimensions: [{ name: "Layout Accuracy", weight: 1, score: 90 }],
    });

    const { buildVisualBenchmarkPrComment, VISUAL_BENCHMARK_PR_COMMENT_MARKER } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      artifactUrl: "https://github.com/test/repo/actions/runs/123",
    });

    assert.equal(result.marker, VISUAL_BENCHMARK_PR_COMMENT_MARKER);
    assert.ok(result.body.startsWith(VISUAL_BENCHMARK_PR_COMMENT_MARKER));
    assert.doesNotMatch(result.body, /workspace-dev-composite-quality/);
    assert.match(result.body, /### Combined Visual \+ Performance Quality/);
    assert.match(result.body, /\*\*Visual Score:\*\* 90 \/ 100/);
    assert.match(result.body, /\*\*Performance Score:\*\* 84 \/ 100/);
    assert.match(result.body, /\*\*Composite Score:\*\* 87.6 \/ 100/);
    assert.match(result.body, /\*\*Weights:\*\* visual 60%, performance 40%/);
    assert.match(
      result.body,
      /\*\*Lighthouse Metrics:\*\* FCP 1250 ms, LCP 1750 ms, CLS 0\.0, TBT 110 ms, Speed Index 1500 ms/,
    );
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

test("buildVisualBenchmarkPrComment renders browser-aware aggregates and artifact links from v2 manifests", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-browsers-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 2,
      ranAt: "2026-04-11T20:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 94 }],
      browserBreakdown: {
        chromium: 96,
        firefox: 94,
        webkit: 92,
      },
      crossBrowserConsistency: {
        browsers: ["chromium", "firefox", "webkit"],
        consistencyScore: 93,
        warnings: ["firefox differs from chromium by 6%."],
        pairwiseDiffs: [
          {
            browserA: "chromium",
            browserB: "firefox",
            diffPercent: 6,
            diffImagePath:
              "last-run/simple-form/pairwise/chromium-vs-firefox.png",
          },
        ],
      },
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 2,
      fixtureId: "simple-form",
      score: 94,
      ranAt: "2026-04-11T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      browserBreakdown: {
        chromium: 96,
        firefox: 94,
        webkit: 92,
      },
      crossBrowserConsistency: {
        browsers: ["chromium", "firefox", "webkit"],
        consistencyScore: 93,
        warnings: ["firefox differs from chromium by 6%."],
        pairwiseDiffs: [
          {
            browserA: "chromium",
            browserB: "firefox",
            diffPercent: 6,
            diffImagePath:
              "last-run/simple-form/pairwise/chromium-vs-firefox.png",
          },
        ],
      },
      perBrowser: [
        {
          browser: "chromium",
          overallScore: 96,
          actualImagePath: "last-run/simple-form/browsers/chromium/actual.png",
          diffImagePath: "last-run/simple-form/browsers/chromium/diff.png",
          reportPath: "last-run/simple-form/browsers/chromium/report.json",
        },
        {
          browser: "firefox",
          overallScore: 94,
          actualImagePath: "last-run/simple-form/browsers/firefox/actual.png",
          diffImagePath: "last-run/simple-form/browsers/firefox/diff.png",
          reportPath: "last-run/simple-form/browsers/firefox/report.json",
          warnings: ["minor anti-aliasing drift"],
        },
      ],
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 94,
      dimensions: [{ name: "Layout Accuracy", weight: 1, score: 94 }],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      artifactUrl: "https://example.com/artifacts",
    });

    assert.match(
      result.body,
      /Per-Browser Averages:\*\* chromium: 96, firefox: 94, webkit: 92/,
    );
    assert.match(
      result.body,
      /Cross-Browser Consistency:\*\* 93 \/ 100/,
    );
    assert.match(result.body, /### Cross-Browser Details/);
    assert.match(
      result.body,
      /Simple Form: scores chromium: 96, firefox: 94, webkit: 92; consistency 93 \/ 100;/,
    );
    assert.match(
      result.body,
      /warnings firefox differs from chromium by 6%\./,
    );
    assert.match(
      result.body,
      /chromium\/firefox: 6% \(\[View pair diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/simple-form\/pairwise\/chromium-vs-firefox\.png`\)/,
    );
    assert.match(
      result.body,
      /\[actual\]\(https:\/\/example\.com\/artifacts\) `last-run\/simple-form\/browsers\/chromium\/actual\.png`/,
    );
    assert.match(
      result.body,
      /\[diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/simple-form\/browsers\/firefox\/diff\.png`/,
    );
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
      /\+20 vs baseline 80 across 1 comparable view; 1 view excluded \(no baseline\)/,
    );
    assert.match(
      result.body,
      /\| Fixture B \| ❌ 50 \| — \| — \| — no baseline \| — \| 1280×720 \|/,
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
      /\+10 vs baseline 70 across 2 comparable views/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment renders per-screen labels and diff paths for multi-screen artifacts", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-multiscreen-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "multi-form";
    const homeDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "custom-home-token",
    );
    const settingsDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "custom-settings-token",
    );
    await mkdir(homeDir, { recursive: true });
    await mkdir(settingsDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          score: 92,
        },
        {
          fixtureId,
          screenId: "2:10002",
          screenName: "Settings",
          score: 78,
        },
      ],
    });
    await writeJson(path.join(homeDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10001",
      screenName: "Home",
      score: 92,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(settingsDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10002",
      screenName: "Settings",
      score: 78,
      ranAt: "2026-04-10T10:00:00.000Z",
      viewport: { width: 1440, height: 900 },
    });
    await writeJson(path.join(homeDir, "report.json"), {
      status: "completed",
      overallScore: 92,
      dimensions: [{ name: "Layout", weight: 1, score: 92 }],
    });
    await writeJson(path.join(settingsDir, "report.json"), {
      status: "completed",
      overallScore: 78,
      dimensions: [{ name: "Layout", weight: 1, score: 78 }],
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 3,
      scores: [
        { fixtureId, screenId: "2:10001", screenName: "Home", score: 88 },
        { fixtureId, screenId: "2:10002", screenName: "Settings", score: 80 },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
      artifactUrl: "https://example.com/artifacts",
    });

    assert.match(
      result.body,
      /\| View \| Score \| Baseline \| Delta \| Trend \| Threshold \| Viewport \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Home \| ✅ 92 \| 88 \| \+4 \| ↑ improved \| — \| 1280×720 \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Settings \| ⚠️ 78 \| 80 \| -2 \| ↓ regressed \| — \| 1440×900 \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Home \| \[View diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/multi-form\/screens\/custom-home-token\/diff\.png` \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Settings \| \[View diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/multi-form\/screens\/custom-settings-token\/diff\.png` \|/,
    );
    assert.match(result.body, /#### Multi Form \/ Home \(score: 92\)/);
    assert.match(result.body, /#### Multi Form \/ Settings \(score: 78\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment renders same-screen viewport rows with viewport-specific baseline and diff paths", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-multiviewport-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "multi-form";
    const desktopDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "custom-home-token",
      "desktop",
    );
    const mobileDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "custom-home-token",
      "mobile",
    );
    await mkdir(desktopDir, { recursive: true });
    await mkdir(mobileDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T11:00:00.000Z",
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          viewportLabel: "Desktop",
          score: 93,
        },
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          viewportLabel: "Mobile",
          score: 74,
        },
      ],
    });
    await writeJson(path.join(desktopDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "desktop",
      viewportLabel: "Desktop",
      score: 93,
      ranAt: "2026-04-10T11:00:00.000Z",
      viewport: { width: 1280, height: 800 },
      thresholdResult: { score: 93, verdict: "pass", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(mobileDir, "manifest.json"), {
      version: 1,
      fixtureId,
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "mobile",
      viewportLabel: "Mobile",
      score: 74,
      ranAt: "2026-04-10T11:00:00.000Z",
      viewport: { width: 390, height: 844 },
      thresholdResult: { score: 74, verdict: "warn", thresholds: { warn: 80 } },
    });
    await writeJson(path.join(desktopDir, "report.json"), {
      status: "completed",
      overallScore: 93,
      diffImagePath: "desktop-diff.png",
      dimensions: [{ name: "Layout", weight: 1, score: 93 }],
    });
    await writeJson(path.join(mobileDir, "report.json"), {
      status: "completed",
      overallScore: 74,
      diffImagePath: "nested/mobile-diff.png",
      dimensions: [{ name: "Layout", weight: 1, score: 74 }],
    });

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 3,
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          viewportLabel: "Desktop",
          score: 90,
        },
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          viewportLabel: "Mobile",
          score: 78,
        },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
      artifactUrl: "https://example.com/artifacts",
    });

    assert.match(
      result.body,
      /\| Multi Form \/ Home \/ Desktop \| ✅ 93 \| 90 \| \+3 \| ↑ improved \| pass \(warn 80, fail disabled\) \| 1280×800 \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Home \/ Mobile \| ⚠️ 74 \| 78 \| -4 \| ↓ regressed \| warn \(warn 80, fail disabled\) \| 390×844 \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Home \/ Desktop \| \[View diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/multi-form\/screens\/custom-home-token\/desktop\/desktop-diff\.png` \|/,
    );
    assert.match(
      result.body,
      /\| Multi Form \/ Home \/ Mobile \| \[View diff\]\(https:\/\/example\.com\/artifacts\) `last-run\/multi-form\/screens\/custom-home-token\/mobile\/mobile-diff\.png` \|/,
    );
    assert.match(result.body, /#### Multi Form \/ Home \/ Desktop \(score: 93\)/);
    assert.match(result.body, /#### Multi Form \/ Home \/ Mobile \(score: 74\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment computes headline score from per-screen aggregates", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-screen-aggregate-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "aggregate-fixture";
    const homeDesktopDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "screen-a-token",
      "desktop",
    );
    const homeMobileDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "screen-a-token",
      "mobile",
    );
    const settingsDesktopDir = path.join(
      artifactRoot,
      "last-run",
      fixtureId,
      "screens",
      "screen-b-token",
      "desktop",
    );
    await mkdir(homeDesktopDir, { recursive: true });
    await mkdir(homeMobileDir, { recursive: true });
    await mkdir(settingsDesktopDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T11:00:00.000Z",
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          score: 90,
        },
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          score: 70,
        },
        {
          fixtureId,
          screenId: "2:10002",
          screenName: "Settings",
          viewportId: "desktop",
          score: 60,
        },
      ],
    });

    for (const [dir, screenId, screenName, viewportId, score, width, height] of [
      [homeDesktopDir, "2:10001", "Home", "desktop", 90, 1280, 800],
      [homeMobileDir, "2:10001", "Home", "mobile", 70, 390, 844],
      [settingsDesktopDir, "2:10002", "Settings", "desktop", 60, 1280, 800],
    ] as const) {
      await writeJson(path.join(dir, "manifest.json"), {
        version: 1,
        fixtureId,
        screenId,
        screenName,
        viewportId,
        score,
        ranAt: "2026-04-10T11:00:00.000Z",
        viewport: { width, height },
      });
      await writeJson(path.join(dir, "report.json"), {
        status: "completed",
        overallScore: score,
        dimensions: [{ name: "Layout", weight: 1, score }],
      });
    }

    const baselinePath = path.join(root, "baseline.json");
    await writeJson(baselinePath, {
      version: 3,
      scores: [
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          score: 80,
        },
        {
          fixtureId,
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          score: 60,
        },
        {
          fixtureId,
          screenId: "2:10002",
          screenName: "Settings",
          viewportId: "desktop",
          score: 50,
        },
      ],
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      baselinePath,
    });

    assert.match(result.body, /Overall Score:\*\* 70 \/ 100/);
    assert.match(
      result.body,
      /\+10 vs baseline 60 across 2 comparable views/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkPrComment truncates oversized detail sections without breaking markdown structure", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-truncate-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const lastRunDir = path.join(artifactRoot, "last-run");
    const scores = [];

    for (let index = 0; index < 160; index++) {
      const fixtureId = `fixture-${String(index).padStart(3, "0")}`;
      const fixtureDir = path.join(lastRunDir, fixtureId);
      await mkdir(fixtureDir, { recursive: true });
      scores.push({ fixtureId, score: 80 + (index % 10) });
      await writeJson(path.join(fixtureDir, "manifest.json"), {
        version: 1,
        fixtureId,
        score: 80 + (index % 10),
        ranAt: "2026-04-10T10:00:00.000Z",
        viewport: { width: 1280, height: 720 },
      });
      await writeJson(path.join(fixtureDir, "report.json"), {
        status: "completed",
        overallScore: 80 + (index % 10),
        dimensions: Array.from({ length: 12 }, (_, dimIndex) => ({
          name: `Dimension ${dimIndex} ${"x".repeat(120)}`,
          weight: 1 / 12,
          score: 80 + (dimIndex % 10),
        })),
      });
    }

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-10T10:00:00.000Z",
      scores,
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {
      artifactUrl: "https://example.com/artifacts",
    });

    assert.ok(result.body.length <= 60_000, `body length ${result.body.length}`);
    assert.match(
      result.body,
      /Additional benchmark details were omitted to keep this comment under 60,000 characters\./,
    );
    assert.ok(result.body.startsWith("<!-- workspace-dev-visual-benchmark -->"));
    assert.match(result.body, /_Benchmark ran at 2026-04-10T10:00:00.000Z/);
    const detailsOpenCount = (result.body.match(/<details>/g) ?? []).length;
    const detailsCloseCount = (result.body.match(/<\/details>/g) ?? []).length;
    assert.equal(detailsOpenCount, detailsCloseCount);
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

test("buildVisualBenchmarkPrComment renders component coverage, rows, and blended headline score", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pr-comment-components-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const screenFixtureDir = path.join(artifactRoot, "last-run", "screen-board");
    const componentFixtureDir = path.join(
      artifactRoot,
      "last-run",
      "component-board",
      "screens",
      "button__button--primary",
    );
    await mkdir(screenFixtureDir, { recursive: true });
    await mkdir(componentFixtureDir, { recursive: true });

    const reportPath = path.join(artifactRoot, "last-run.json");
    await writeJson(reportPath, {
      version: 1,
      ranAt: "2026-04-11T10:00:00.000Z",
      screenAggregateScore: 80,
      scores: [
        { fixtureId: "screen-board", score: 80 },
        {
          fixtureId: "component-board",
          screenId: "button::button--primary",
          score: 70,
        },
      ],
      componentAggregateScore: 90,
      componentCoverage: {
        comparedCount: 2,
        skippedCount: 1,
        coveragePercent: 66.7,
        bySkipReason: {
          ambiguous: 1,
        },
      },
      components: [
        {
          componentId: "button::button--primary",
          componentName: "Primary Button",
          status: "compared",
          score: 92,
          storyEntryId: "button--primary",
        },
        {
          componentId: "input::input--docs",
          componentName: "Input Docs",
          status: "skipped",
          skipReason: "docs_only",
          warnings: ["requires authoritative story"],
        },
      ],
    });
    await writeJson(path.join(screenFixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "screen-board",
      score: 80,
      ranAt: "2026-04-11T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(screenFixtureDir, "report.json"), {
      status: "completed",
      overallScore: 80,
    });
    await writeJson(path.join(componentFixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "component-board",
      screenId: "button::button--primary",
      score: 70,
      ranAt: "2026-04-11T10:00:00.000Z",
      mode: "storybook_component",
      viewport: { width: 240, height: 120 },
    });
    await writeJson(path.join(componentFixtureDir, "report.json"), {
      status: "completed",
      overallScore: 70,
    });

    const { buildVisualBenchmarkPrComment } =
      await import("../scripts/visual-benchmark-pr-comment.mjs");
    const result = await buildVisualBenchmarkPrComment(reportPath, {});

    assert.match(result.body, /Overall Score:\*\* 83 \/ 100 \(no comparable baseline\)/);
    assert.match(result.body, /Full-Page Average:\*\* 80 \/ 100/);
    assert.match(result.body, /Component Aggregate:\*\* 90 \/ 100/);
    assert.doesNotMatch(result.body, /\| Component Board \|/);
    assert.match(
      result.body,
      /Component Coverage:\*\* 2 compared, 1 skipped \(66\.7%\)/,
    );
    assert.match(result.body, /Skipped By Reason:\*\* ambiguous: 1/);
    assert.match(result.body, /### Component Results/);
    assert.match(
      result.body,
      /\| Primary Button \| compared \| ✅ 92 \| button--primary \| — \|/,
    );
    assert.match(
      result.body,
      /\| Input Docs \| skipped \| — \| — \| docs_only \\?\| requires authoritative story \|/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
