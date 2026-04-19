import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SCENARIOS,
  assertP80RatioThreshold,
  calculatePercentile,
  parseBenchmarkCliArgs,
  runPasteDeltaBenchmark,
  summarizeDurations,
} from "./paste-delta-benchmark.js";

const createTempDir = async (prefix: string): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
};

const createTinyTemplateRoot = async (): Promise<string> => {
  const root = await createTempDir("workspace-dev-paste-delta-template-");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "paste-delta-template", private: true }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "index.tsx"),
    "export default function App() { return null; }\n",
    "utf8",
  );
  return root;
};

test("calculatePercentile and summarizeDurations compute deterministic summary values", () => {
  const samples = [10, 20, 30, 40, 50];
  assert.equal(calculatePercentile(samples, 0.5), 30);
  assert.equal(calculatePercentile(samples, 0.8), 40);
  assert.deepEqual(summarizeDurations(samples), {
    min: 10,
    max: 50,
    mean: 30,
    p50: 30,
    p80: 40,
  });
});

test("parseBenchmarkCliArgs defaults to the exact artifact path and accepts the blocking check flag", () => {
  const resolution = parseBenchmarkCliArgs([]);
  assert.equal(
    resolution.outputPath,
    path.resolve(process.cwd(), "artifacts/testing/paste-delta-benchmark.json"),
  );
  const checked = parseBenchmarkCliArgs([
    "--iterations",
    "2",
    "--warmup-iterations",
    "0",
    "--max-p80-ratio",
    "0.55",
    "--check",
  ]);
  assert.equal(checked.iterations, 2);
  assert.equal(checked.warmupIterations, 0);
  assert.equal(checked.maxP80Ratio, 0.55);
  assert.equal(checked.check, true);
});

test("assertP80RatioThreshold fails when the 80th percentile ratio exceeds the configured limit", () => {
  assert.doesNotThrow(() =>
    assertP80RatioThreshold({
      report: {
        artifact: "paste.delta.benchmark",
        artifactVersion: 1,
        generatedAt: "2026-04-19T00:00:00.000Z",
        config: {
          iterations: 1,
          warmupIterations: 0,
          maxP80Ratio: 0.7,
          measuredStages: [
            "figma.source",
            "ir.derive",
            "template.prepare",
            "codegen.generate",
          ],
          templateRoot: ".",
        },
        summary: {
          scenarioCount: 1,
          sampleCount: 1,
          fullMs: { min: 10, max: 10, mean: 10, p50: 10, p80: 10 },
          deltaMs: { min: 6, max: 6, mean: 6, p50: 6, p80: 6 },
          ratio: { min: 0.6, max: 0.6, mean: 0.6, p50: 0.6, p80: 0.6 },
        },
        threshold: {
          metric: "ratio.p80",
          maxP80Ratio: 0.7,
          actualP80Ratio: 0.6,
          passed: true,
        },
        scenarios: [],
      },
    }),
  );
  assert.throws(
    () =>
      assertP80RatioThreshold({
        report: {
          artifact: "paste.delta.benchmark",
          artifactVersion: 1,
          generatedAt: "2026-04-19T00:00:00.000Z",
          config: {
            iterations: 1,
            warmupIterations: 0,
            maxP80Ratio: 0.7,
            measuredStages: [
              "figma.source",
              "ir.derive",
              "template.prepare",
              "codegen.generate",
            ],
            templateRoot: ".",
          },
          summary: {
            scenarioCount: 1,
            sampleCount: 1,
            fullMs: { min: 10, max: 10, mean: 10, p50: 10, p80: 10 },
            deltaMs: { min: 8, max: 8, mean: 8, p50: 8, p80: 8 },
            ratio: { min: 0.8, max: 0.8, mean: 0.8, p50: 0.8, p80: 0.8 },
          },
          threshold: {
            metric: "ratio.p80",
            maxP80Ratio: 0.7,
            actualP80Ratio: 0.8,
            passed: false,
          },
          scenarios: [],
        },
      }),
    /exceeds max 0\.700/,
  );
});

test("runPasteDeltaBenchmark writes a structured artifact for a tiny smoke scenario", async () => {
  const workspaceRoot = await createTempDir("workspace-dev-paste-delta-workspace-");
  const outputPath = path.join(
    workspaceRoot,
    "artifacts",
    "testing",
    "paste-delta-benchmark.json",
  );
  const templateRoot = await createTinyTemplateRoot();

  try {
    const artifact = await runPasteDeltaBenchmark({
      iterations: 1,
      warmupIterations: 0,
      outputPath,
      templateRoot,
      scenarios: [DEFAULT_SCENARIOS[0]!],
      maxP80Ratio: 0.7,
    });

    const parsed = JSON.parse(await readFile(outputPath, "utf8")) as typeof artifact;
    assert.equal(parsed.artifact, "paste.delta.benchmark");
    assert.equal(parsed.artifactVersion, 1);
    assert.equal(parsed.config.iterations, 1);
    assert.equal(parsed.config.warmupIterations, 0);
    assert.equal(parsed.config.maxP80Ratio, 0.7);
    assert.equal(parsed.config.templateRoot, templateRoot);
    assert.equal(parsed.summary.scenarioCount, 1);
    assert.equal(parsed.summary.sampleCount, 1);
    assert.equal(parsed.scenarios.length, 1);
    assert.equal(parsed.scenarios[0]?.sampleCount, 1);
    assert.equal(parsed.threshold.metric, "ratio.p80");
    assert.ok(Number.isFinite(parsed.threshold.actualP80Ratio));
    assert.equal(parsed.threshold.passed, parsed.threshold.actualP80Ratio <= 0.7);
    assert.equal(parsed.scenarios[0]?.samples[0]?.deltaSummaryStrategy, "delta");
    assert.ok(
      (parsed.scenarios[0]?.samples[0]?.deltaSummaryMode ?? "").length > 0,
    );
    assert.match(
      parsed.scenarios[0]?.samples[0]?.order.join("->") ?? "",
      /full->delta|delta->full/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(templateRoot, { recursive: true, force: true });
  }
});

test("paste-delta benchmark docs and workflow wire the command and artifact path", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["benchmark:paste-delta"],
    "tsx integration/paste-delta-benchmark.ts",
  );

  const workflow = await readFile(
    path.join(process.cwd(), ".github", "workflows", "visual-benchmark.yml"),
    "utf8",
  );
  assert.match(workflow, /src\/job-engine\.ts/);
  assert.match(workflow, /src\/server\/request-handler\.ts/);
  assert.match(workflow, /integration\/paste-delta-benchmark\*/);
  assert.match(workflow, /integration\/paste-delta-benchmark\.test\.ts/);
  assert.match(workflow, /pnpm run benchmark:paste-delta -- --check/);

  const contributing = await readFile(
    path.join(process.cwd(), "CONTRIBUTING.md"),
    "utf8",
  );
  assert.match(contributing, /pnpm benchmark:paste-delta/);
  assert.match(contributing, /artifacts\/testing\/paste-delta-benchmark\.json/);
});

test("baseline scenario list keeps the benchmark representative", () => {
  assert.equal(DEFAULT_SCENARIOS.length, 3);
  assert.ok(DEFAULT_SCENARIOS.every((scenario) => scenario.textNodesPerScreen > 0));
});
