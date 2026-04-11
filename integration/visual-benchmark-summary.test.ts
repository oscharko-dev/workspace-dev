import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

test("buildVisualBenchmarkSummary renders markdown and check payload with threshold annotations", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-"),
  );

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

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /Overall Average:\*\* 75/);
    assert.match(summary.markdown, /Warned Views:\*\* 1/);
    assert.match(summary.markdown, /Failed Views:\*\* 0/);
    assert.equal(summary.check.annotations.length, 1);
    assert.equal(summary.check.annotations[0]?.annotation_level, "warning");
    assert.match(summary.check.text, /Artifacts: /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("print-visual-benchmark-summary writes check output and degrades gracefully on malformed reports", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-cli-"),
  );

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

    const malformedOutputPath = path.join(
      artifactRoot,
      "check-output-malformed.json",
    );
    const malformedCommand = `node scripts/print-visual-benchmark-summary.mjs ${JSON.stringify(path.join(artifactRoot, "last-run.json"))} --check-output ${JSON.stringify(malformedOutputPath)}`;
    await execFileAsync("zsh", ["-lc", malformedCommand], {
      cwd: process.cwd(),
    });

    const malformedCheckOutput = JSON.parse(
      await readFile(malformedOutputPath, "utf8"),
    ) as {
      title: string;
      summary: string;
      text: string;
    };
    assert.equal(malformedCheckOutput.title, "Visual benchmark: unavailable");
    assert.match(malformedCheckOutput.summary, /Status:\*\* unavailable/);
    assert.match(malformedCheckOutput.text, /Visual benchmark unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary returns unavailable payload when last-run artifact is missing", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-missing-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    await mkdir(artifactRoot, { recursive: true });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.equal(summary.check.title, "Visual benchmark: unavailable");
    assert.match(summary.markdown, /Status:\*\* unavailable/);
    assert.match(summary.check.text, /Visual benchmark unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary includes composite quality scores, weights, and lighthouse metrics when the composite report is present", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-composite-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-12T10:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 92 }],
      overallCurrent: 92,
    });
    await writeJson(path.join(artifactRoot, "composite-quality-report.json"), {
      version: 1,
      generatedAt: "2026-04-12T10:05:00.000Z",
      weights: {
        visual: 0.6,
        performance: 0.4,
      },
      visual: {
        score: 92,
        ranAt: "2026-04-12T10:00:00.000Z",
        source: "artifacts/visual-benchmark/last-run.json",
      },
      performance: {
        score: 81.5,
        sampleCount: 2,
        aggregateMetrics: {
          fcp_ms: 1200,
          lcp_ms: 1800,
          cls: 0.03,
          tbt_ms: 90,
          speed_index_ms: 1450,
        },
        samples: [],
        warnings: [],
      },
      composite: {
        score: 87.8,
        includedDimensions: ["visual", "performance"],
        explanation: "0.6 * 92 + 0.4 * 81.5 = 87.8",
      },
      warnings: [],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 92,
      ranAt: "2026-04-12T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: {
        score: 92,
        verdict: "pass",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 92,
      diffImagePath: "visual-quality/diff.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /### Combined Visual \+ Performance Quality/);
    assert.match(summary.markdown, /\*\*Visual Score:\*\* 92 \/ 100/);
    assert.match(summary.markdown, /\*\*Performance Score:\*\* 81.5 \/ 100/);
    assert.match(summary.markdown, /\*\*Composite Score:\*\* 87.8 \/ 100/);
    assert.match(summary.markdown, /\*\*Weights:\*\* visual 60%, performance 40%/);
    assert.match(
      summary.markdown,
      /\*\*Lighthouse Metrics:\*\* FCP 1200 ms, LCP 1800 ms, CLS 0\.0, TBT 90 ms, Speed Index 1450 ms/,
    );
    assert.match(summary.check.text, /Composite quality:/);
    assert.match(summary.check.text, /Composite score: 87.8 \/ 100/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary tolerates visual-only composite reports", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-visual-only-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-12T10:00:00.000Z",
      scores: [{ fixtureId: "simple-form", score: 92 }],
      overallCurrent: 92,
    });
    await writeJson(path.join(artifactRoot, "composite-quality-report.json"), {
      version: 1,
      generatedAt: "2026-04-12T10:05:00.000Z",
      weights: {
        visual: 0.6,
        performance: 0.4,
      },
      visual: {
        score: 92,
        ranAt: "2026-04-12T10:00:00.000Z",
        source: "artifacts/visual-benchmark/last-run.json",
      },
      performance: null,
      composite: {
        score: 92,
        includedDimensions: ["visual"],
        explanation: "visual-only fallback: 92",
      },
      warnings: ["performance breakdown missing"],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId: "simple-form",
      score: 92,
      ranAt: "2026-04-12T10:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: {
        score: 92,
        verdict: "pass",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 92,
      diffImagePath: "visual-quality/diff.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /### Combined Visual \+ Performance Quality/);
    assert.match(summary.markdown, /\*\*Performance Score:\*\* unavailable/);
    assert.match(summary.markdown, /\*\*Composite Warnings:\*\* performance breakdown missing/);
    assert.doesNotMatch(summary.markdown, /\*\*Lighthouse Metrics:\*\*/);
    assert.doesNotMatch(summary.check.text, /Visual benchmark unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary renders browser-aware aggregates and artifact details from v2 manifests", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-browsers-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureDir = path.join(artifactRoot, "last-run", "simple-form");
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
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
      diffImagePath: "visual-quality/diff.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(
      summary.markdown,
      /Per-Browser Averages:\*\* chromium: 96, firefox: 94, webkit: 92/,
    );
    assert.match(
      summary.markdown,
      /Cross-Browser Consistency:\*\* 93 \/ 100/,
    );
    assert.match(summary.markdown, /### Cross-Browser Details/);
    assert.match(
      summary.markdown,
      /Simple Form: scores chromium: 96, firefox: 94, webkit: 92; consistency 93 \/ 100;/,
    );
    assert.match(
      summary.markdown,
      /pairwise chromium\/firefox: 6% \(last-run\/simple-form\/pairwise\/chromium-vs-firefox\.png\)/,
    );
    assert.match(
      summary.markdown,
      /artifacts chromium: 96 \(last-run\/simple-form\/browsers\/chromium\/diff\.png\), firefox: 94 \(last-run\/simple-form\/browsers\/firefox\/diff\.png\)/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary escapes markdown-sensitive fixture names and annotation messages (M2 fix)", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-escape-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureId = "pipe-|evil|-fixture";
    const fixtureDir = path.join(artifactRoot, "last-run", fixtureId);
    await mkdir(fixtureDir, { recursive: true });
    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-09T20:00:00.000Z",
      scores: [{ fixtureId, score: 70 }],
    });
    await writeJson(path.join(fixtureDir, "manifest.json"), {
      version: 1,
      fixtureId,
      score: 70,
      ranAt: "2026-04-09T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      thresholdResult: {
        score: 70,
        verdict: "warn",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(fixtureDir, "report.json"), {
      status: "completed",
      overallScore: 70,
      diffImagePath: "visual-quality/diff.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    // Display name is derived from fixtureId — pipes must be escaped in markdown
    // tables to avoid breaking row structure
    assert.ok(
      summary.markdown.includes("Pipe \\|evil\\| Fixture") ||
        summary.markdown.includes("pipe-\\|evil\\|-fixture"),
      `expected markdown to contain escaped pipes, got:\n${summary.markdown}`,
    );
    // Bare pipes inside a table cell would break the row — assert the escaped
    // version is present and no raw '| evil |' pattern appears in a cell.
    assert.doesNotMatch(summary.markdown, /\| Pipe \|evil\| Fixture \|/);

    // Annotation messages referencing the fixture id must also be escaped.
    for (const annotation of summary.check.annotations) {
      assert.doesNotMatch(
        annotation.message,
        /[^\\]\|evil\|/,
        "annotation message must not contain unescaped pipes",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary renders multi-screen rows and screen-specific artifact paths", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-multiscreen-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureRoot = path.join(artifactRoot, "last-run", "multi-form");
    const homeDir = path.join(fixtureRoot, "screens", "custom-home-token");
    const settingsDir = path.join(fixtureRoot, "screens", "custom-settings-token");
    await mkdir(homeDir, { recursive: true });
    await mkdir(settingsDir, { recursive: true });

    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-10T20:00:00.000Z",
      scores: [
        {
          fixtureId: "multi-form",
          screenId: "2:10001",
          screenName: "Home",
          score: 91,
        },
        {
          fixtureId: "multi-form",
          screenId: "2:10002",
          screenName: "Settings",
          score: 79,
        },
      ],
    });
    await writeJson(path.join(homeDir, "manifest.json"), {
      version: 1,
      fixtureId: "multi-form",
      screenId: "2:10001",
      screenName: "Home",
      score: 91,
      ranAt: "2026-04-10T20:00:00.000Z",
      viewport: { width: 1280, height: 720 },
    });
    await writeJson(path.join(settingsDir, "manifest.json"), {
      version: 1,
      fixtureId: "multi-form",
      screenId: "2:10002",
      screenName: "Settings",
      score: 79,
      ranAt: "2026-04-10T20:00:00.000Z",
      viewport: { width: 1440, height: 900 },
      thresholdResult: {
        score: 79,
        verdict: "warn",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(homeDir, "report.json"), {
      status: "completed",
      overallScore: 91,
      diffImagePath: "diff.png",
    });
    await writeJson(path.join(settingsDir, "report.json"), {
      status: "completed",
      overallScore: 79,
      diffImagePath: "nested/ignored-name.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /\| View \| Score \| Threshold \| Viewport \|/);
    assert.match(summary.markdown, /\| Multi Form \/ Home \| ✅ 91 \| — \| 1280×720 \|/);
    assert.match(
      summary.markdown,
      /\| Multi Form \/ Settings \| ⚠️ 79 \| warn \(warn 80, fail disabled\) \| 1440×900 \|/,
    );
    assert.match(
      summary.check.text,
      /report=.*last-run\/multi-form\/screens\/custom-home-token\/report\.json/,
    );
    assert.match(
      summary.check.text,
      /diff=.*last-run\/multi-form\/screens\/custom-settings-token\/ignored-name\.png/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary renders same-screen viewport rows and viewport-specific artifact paths", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-multiviewport-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureRoot = path.join(artifactRoot, "last-run", "multi-form");
    const desktopDir = path.join(
      fixtureRoot,
      "screens",
      "custom-home-token",
      "desktop",
    );
    const mobileDir = path.join(
      fixtureRoot,
      "screens",
      "custom-home-token",
      "mobile",
    );
    await mkdir(desktopDir, { recursive: true });
    await mkdir(mobileDir, { recursive: true });

    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-10T21:00:00.000Z",
      scores: [
        {
          fixtureId: "multi-form",
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          viewportLabel: "Desktop",
          score: 94,
        },
        {
          fixtureId: "multi-form",
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          viewportLabel: "Mobile",
          score: 76,
        },
      ],
    });
    await writeJson(path.join(desktopDir, "manifest.json"), {
      version: 1,
      fixtureId: "multi-form",
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "desktop",
      viewportLabel: "Desktop",
      score: 94,
      ranAt: "2026-04-10T21:00:00.000Z",
      viewport: { width: 1280, height: 800 },
    });
    await writeJson(path.join(mobileDir, "manifest.json"), {
      version: 1,
      fixtureId: "multi-form",
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "mobile",
      viewportLabel: "Mobile",
      score: 76,
      ranAt: "2026-04-10T21:00:00.000Z",
      viewport: { width: 390, height: 844 },
      thresholdResult: {
        score: 76,
        verdict: "warn",
        thresholds: { warn: 80 },
      },
    });
    await writeJson(path.join(desktopDir, "report.json"), {
      status: "completed",
      overallScore: 94,
      diffImagePath: "desktop-diff.png",
    });
    await writeJson(path.join(mobileDir, "report.json"), {
      status: "completed",
      overallScore: 76,
      diffImagePath: "nested/mobile-diff.png",
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(
      summary.markdown,
      /\| Multi Form \/ Home \/ Desktop \| ✅ 94 \| — \| 1280×800 \|/,
    );
    assert.match(
      summary.markdown,
      /\| Multi Form \/ Home \/ Mobile \| ⚠️ 76 \| warn \(warn 80, fail disabled\) \| 390×844 \|/,
    );
    assert.match(
      summary.check.text,
      /report=.*last-run\/multi-form\/screens\/custom-home-token\/desktop\/report\.json/,
    );
    assert.match(
      summary.check.text,
      /diff=.*last-run\/multi-form\/screens\/custom-home-token\/mobile\/mobile-diff\.png/,
    );
    assert.equal(summary.check.annotations.length, 1);
    assert.match(
      summary.check.annotations[0]?.title ?? "",
      /Visual benchmark warning: Multi Form \/ Home \/ Mobile/,
    );
    assert.match(
      summary.check.annotations[0]?.message ?? "",
      /Multi Form \/ Home \/ Mobile scored 76 and is below warn threshold/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary computes headline average from per-screen aggregates", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-screen-aggregate-"),
  );

  try {
    const artifactRoot = path.join(root, "artifacts", "visual-benchmark");
    const fixtureRoot = path.join(artifactRoot, "last-run", "aggregate-fixture");
    const homeDesktopDir = path.join(
      fixtureRoot,
      "screens",
      "screen-a-token",
      "desktop",
    );
    const homeMobileDir = path.join(
      fixtureRoot,
      "screens",
      "screen-a-token",
      "mobile",
    );
    const settingsDesktopDir = path.join(
      fixtureRoot,
      "screens",
      "screen-b-token",
      "desktop",
    );
    await mkdir(homeDesktopDir, { recursive: true });
    await mkdir(homeMobileDir, { recursive: true });
    await mkdir(settingsDesktopDir, { recursive: true });

    await writeJson(path.join(artifactRoot, "last-run.json"), {
      version: 1,
      ranAt: "2026-04-10T22:00:00.000Z",
      scores: [
        {
          fixtureId: "aggregate-fixture",
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "desktop",
          score: 90,
        },
        {
          fixtureId: "aggregate-fixture",
          screenId: "2:10001",
          screenName: "Home",
          viewportId: "mobile",
          score: 70,
        },
        {
          fixtureId: "aggregate-fixture",
          screenId: "2:10002",
          screenName: "Settings",
          viewportId: "desktop",
          score: 60,
        },
      ],
    });

    await writeJson(path.join(homeDesktopDir, "manifest.json"), {
      version: 1,
      fixtureId: "aggregate-fixture",
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "desktop",
      score: 90,
      ranAt: "2026-04-10T22:00:00.000Z",
      viewport: { width: 1280, height: 800 },
    });
    await writeJson(path.join(homeMobileDir, "manifest.json"), {
      version: 1,
      fixtureId: "aggregate-fixture",
      screenId: "2:10001",
      screenName: "Home",
      viewportId: "mobile",
      score: 70,
      ranAt: "2026-04-10T22:00:00.000Z",
      viewport: { width: 390, height: 844 },
    });
    await writeJson(path.join(settingsDesktopDir, "manifest.json"), {
      version: 1,
      fixtureId: "aggregate-fixture",
      screenId: "2:10002",
      screenName: "Settings",
      viewportId: "desktop",
      score: 60,
      ranAt: "2026-04-10T22:00:00.000Z",
      viewport: { width: 1280, height: 800 },
    });
    await writeJson(path.join(homeDesktopDir, "report.json"), {
      status: "completed",
      overallScore: 90,
    });
    await writeJson(path.join(homeMobileDir, "report.json"), {
      status: "completed",
      overallScore: 70,
    });
    await writeJson(path.join(settingsDesktopDir, "report.json"), {
      status: "completed",
      overallScore: 60,
    });

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /Overall Average:\*\* 70/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildVisualBenchmarkSummary renders component coverage, rows, and blended headline score", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-summary-components-"),
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
    await writeJson(path.join(artifactRoot, "last-run.json"), {
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

    const { buildVisualBenchmarkSummary } =
      await import("../scripts/visual-benchmark-summary.mjs");
    const summary = await buildVisualBenchmarkSummary(
      path.join(artifactRoot, "last-run.json"),
    );

    assert.match(summary.markdown, /Overall Average:\*\* 83/);
    assert.match(summary.markdown, /Full-Page Average:\*\* 80/);
    assert.match(summary.markdown, /Component Aggregate:\*\* 90/);
    assert.doesNotMatch(summary.markdown, /\| Component Board \|/);
    assert.match(
      summary.markdown,
      /Component Coverage:\*\* 2 compared, 1 skipped \(66\.7%\)/,
    );
    assert.match(summary.markdown, /Skipped By Reason:\*\* ambiguous: 1/);
    assert.match(summary.markdown, /### Component Results/);
    assert.match(summary.markdown, /\| Primary Button \| compared \| ✅ 92 \| button--primary \| — \|/);
    assert.match(
      summary.markdown,
      /\| Input Docs \| skipped \| — \| — \| docs_only \\| requires authoritative story \|/,
    );
    assert.match(summary.check.text, /Component aggregate: 90/);
    assert.match(summary.check.text, /Component coverage: 2 compared, 1 skipped \(66\.7%\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
