import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  AGENT_ONLINE_EVAL_REPORT_FILENAME,
  AGENT_ONLINE_EVAL_REPORT_SCHEMA_VERSION,
  ALLOWED_AGENT_ONLINE_EVAL_VERDICTS,
  buildAgentOnlineEvalReport,
  computeTraceSamplingScore,
  defaultAgentOnlineEvaluator,
  redactProductionTrace,
  runAgentOnlineEvalSampler,
  shouldSampleAgentTrace,
  writeAgentOnlineEvalReport,
  type AgentOnlineEvaluator,
  type AgentProductionTrace,
} from "./agent-eval-online-sampler.js";
import { TEST_INTELLIGENCE_CONTRACT_VERSION } from "../contracts/index.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const TRACES_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "agent-online-eval-traces.json",
);
const FIXTURE_GENERATED_AT = "2026-05-04T00:00:00.000Z";

interface FixtureDocument {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly traces: readonly AgentProductionTrace[];
}

const loadTraceFixture = async (): Promise<FixtureDocument> => {
  const raw = await readFile(TRACES_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as FixtureDocument;
};

const synthTraces = (count: number): AgentProductionTrace[] =>
  Array.from({ length: count }, (_unused, idx) => ({
    traceId: `synth-${idx.toString().padStart(6, "0")}`,
    runId: "run-synthetic",
    prompt: `prompt ${idx}`,
    response: "Test: assert that the recorded trace renders without errors.",
  }));

test("computeTraceSamplingScore yields a stable value in [0, 1)", () => {
  const score = computeTraceSamplingScore("seed-A", "trace-1");
  assert.ok(score >= 0 && score < 1);
  assert.equal(
    score,
    computeTraceSamplingScore("seed-A", "trace-1"),
    "deterministic for identical inputs",
  );
  assert.notEqual(
    score,
    computeTraceSamplingScore("seed-B", "trace-1"),
    "varies with seed",
  );
  assert.notEqual(
    score,
    computeTraceSamplingScore("seed-A", "trace-2"),
    "varies with traceId",
  );
});

test("shouldSampleAgentTrace honours rate=0 and rate=1 boundaries", () => {
  assert.equal(
    shouldSampleAgentTrace({ traceId: "x", seed: "s", sampleRate: 0 }),
    false,
  );
  assert.equal(
    shouldSampleAgentTrace({ traceId: "x", seed: "s", sampleRate: 1 }),
    true,
  );
});

test("shouldSampleAgentTrace rejects invalid sample rates", () => {
  for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() =>
      shouldSampleAgentTrace({ traceId: "x", seed: "s", sampleRate: bad }),
    );
  }
});

test("sampling is deterministic for identical seed + sampleRate", () => {
  const traces = synthTraces(500);
  const first = traces.filter((trace) =>
    shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: "deterministic-seed",
      sampleRate: 0.1,
    }),
  );
  const second = traces.filter((trace) =>
    shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: "deterministic-seed",
      sampleRate: 0.1,
    }),
  );
  assert.deepEqual(
    first.map((trace) => trace.traceId),
    second.map((trace) => trace.traceId),
  );
});

test("sampling rate is approximately respected over a large population", () => {
  const traces = synthTraces(10_000);
  const sampled = traces.filter((trace) =>
    shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: "stat-seed",
      sampleRate: 0.05,
    }),
  );
  const observed = sampled.length / traces.length;
  // 95% CI on a binomial proportion at n=10k, p=0.05 is roughly p ± 0.005.
  // Allow ±0.012 to keep this assertion robust to seed variance without
  // being toothless.
  assert.ok(
    Math.abs(observed - 0.05) <= 0.012,
    `observed sample rate ${observed} too far from 0.05`,
  );
});

test("different seeds select different subsets at the same rate", () => {
  const traces = synthTraces(500);
  const seedA = traces.filter((trace) =>
    shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: "seed-A",
      sampleRate: 0.1,
    }),
  );
  const seedB = traces.filter((trace) =>
    shouldSampleAgentTrace({
      traceId: trace.traceId,
      seed: "seed-B",
      sampleRate: 0.1,
    }),
  );
  assert.notDeepEqual(
    seedA.map((trace) => trace.traceId),
    seedB.map((trace) => trace.traceId),
  );
});

test("redactProductionTrace masks PII in prompt, response, and metadata", () => {
  const redacted = redactProductionTrace({
    traceId: "t-1",
    runId: "r-1",
    archetypeId: "baseline-simple-form",
    prompt: "User reported issue with IBAN DE89 3704 0044 0532 0130 00.",
    response: "Send the receipt to user@example.com after submission.",
    metadata: {
      reporter: "Jane Doe",
      attachment: "screenshot.png",
    },
  });
  assert.match(redacted.redactedPrompt, /\[REDACTED:IBAN\]/u);
  assert.match(redacted.redactedResponse, /\[REDACTED:EMAIL\]/u);
  assert.ok(redacted.redactedMetadata);
  if (redacted.redactedMetadata !== undefined) {
    assert.match(
      redacted.redactedMetadata["reporter"] ?? "",
      /\[REDACTED:FULL_NAME\]/u,
    );
    assert.equal(redacted.redactedMetadata["attachment"], "screenshot.png");
  }
  assert.ok(redacted.redactionsApplied.includes("iban"));
  assert.ok(redacted.redactionsApplied.includes("email"));
  assert.ok(redacted.redactionsApplied.includes("full_name"));
});

test("redactProductionTrace passes clean strings through unchanged", () => {
  const redacted = redactProductionTrace({
    traceId: "t-clean",
    runId: "r-clean",
    prompt: "Render the dashboard above the fold.",
    response: "Test: Assert the dashboard renders within 2 seconds.",
  });
  assert.equal(redacted.redactedPrompt, "Render the dashboard above the fold.");
  assert.equal(
    redacted.redactedResponse,
    "Test: Assert the dashboard renders within 2 seconds.",
  );
  assert.deepEqual(redacted.redactionsApplied, []);
});

test("defaultAgentOnlineEvaluator classifies refusal, fail, and pass", () => {
  const refusal = defaultAgentOnlineEvaluator({
    traceId: "t",
    runId: "r",
    redactedPrompt: "p",
    redactedResponse: "I cannot help with that.",
    redactionsApplied: [],
  });
  assert.equal(refusal.verdict, "refusal");
  assert.equal(refusal.score, 0);

  const tooShort = defaultAgentOnlineEvaluator({
    traceId: "t",
    runId: "r",
    redactedPrompt: "p",
    redactedResponse: "ok",
    redactionsApplied: [],
  });
  assert.equal(tooShort.verdict, "fail");

  const passing = defaultAgentOnlineEvaluator({
    traceId: "t",
    runId: "r",
    redactedPrompt: "p",
    redactedResponse: "Test: Assert the dashboard renders successfully.",
    redactionsApplied: [],
  });
  assert.equal(passing.verdict, "pass");
  assert.equal(passing.score, 1);
});

test("defaultAgentOnlineEvaluator down-scores verbose responses", () => {
  const verbose = defaultAgentOnlineEvaluator({
    traceId: "t",
    runId: "r",
    redactedPrompt: "p",
    redactedResponse: "x".repeat(6_000),
    redactionsApplied: [],
  });
  assert.ok(verbose.score < 1);
  assert.equal(verbose.verdict, "pass");
});

test("buildAgentOnlineEvalReport rejects an empty seed", () => {
  assert.throws(() =>
    buildAgentOnlineEvalReport({
      traces: synthTraces(1),
      seed: "",
      generatedAt: FIXTURE_GENERATED_AT,
    }),
  );
});

test("buildAgentOnlineEvalReport rejects duplicate traceIds", () => {
  const trace: AgentProductionTrace = {
    traceId: "dup-1",
    runId: "r",
    prompt: "p",
    response: "r",
  };
  assert.throws(() =>
    buildAgentOnlineEvalReport({
      traces: [trace, trace],
      seed: "seed",
      sampleRate: 1,
      generatedAt: FIXTURE_GENERATED_AT,
    }),
  );
});

test("buildAgentOnlineEvalReport is deterministic and canonical", async () => {
  const fixture = await loadTraceFixture();
  const reportA = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    sampleRate: 1,
    generatedAt: FIXTURE_GENERATED_AT,
  });
  const reportB = buildAgentOnlineEvalReport({
    traces: [...fixture.traces].reverse(),
    seed: "fixture-seed",
    sampleRate: 1,
    generatedAt: FIXTURE_GENERATED_AT,
  });
  assert.deepEqual(reportA, reportB, "trace input order must not affect output");
  assert.equal(canonicalJson(reportA), canonicalJson(reportB));

  assert.equal(reportA.schemaVersion, AGENT_ONLINE_EVAL_REPORT_SCHEMA_VERSION);
  assert.equal(reportA.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(reportA.population.totalTraces, fixture.traces.length);
  assert.equal(reportA.population.sampledCount, fixture.traces.length);
  for (const sample of reportA.samples) {
    assert.ok(ALLOWED_AGENT_ONLINE_EVAL_VERDICTS.includes(sample.verdict));
  }
});

test("buildAgentOnlineEvalReport redacts PII before evaluation", async () => {
  const fixture = await loadTraceFixture();
  const report = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    sampleRate: 1,
    generatedAt: FIXTURE_GENERATED_AT,
  });

  for (const sample of report.samples) {
    assert.doesNotMatch(
      sample.redactedPrompt,
      /\bDE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/u,
      `IBAN leaked into ${sample.traceId} prompt`,
    );
    assert.doesNotMatch(
      sample.redactedResponse,
      /[\w.+-]+@[\w-]+\.[\w.-]+/u,
      `email leaked into ${sample.traceId} response`,
    );
    assert.doesNotMatch(
      sample.redactedResponse,
      /\b\+\d{1,3}\s\d{2,4}\s\d{3,8}\b/u,
      `phone leaked into ${sample.traceId} response`,
    );
  }

  assert.ok(report.aggregate.redactionCount > 0);
});

test("buildAgentOnlineEvalReport supports a custom evaluator", async () => {
  const fixture = await loadTraceFixture();
  const passEverything: AgentOnlineEvaluator = () => ({
    score: 0.42,
    verdict: "pass",
    notes: "synthetic",
  });
  const report = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    sampleRate: 1,
    generatedAt: FIXTURE_GENERATED_AT,
    evaluator: passEverything,
  });
  assert.equal(report.aggregate.passCount, fixture.traces.length);
  assert.equal(report.aggregate.failCount, 0);
  assert.equal(report.aggregate.refusalCount, 0);
  assert.equal(report.aggregate.meanScore, 0.42);
  for (const sample of report.samples) {
    assert.equal(sample.score, 0.42);
    assert.equal(sample.notes, "synthetic");
  }
});

test("buildAgentOnlineEvalReport rejects an out-of-range evaluator score", () => {
  const trace: AgentProductionTrace = {
    traceId: "t",
    runId: "r",
    prompt: "p",
    response: "Test: assert successful behaviour.",
  };
  assert.throws(() =>
    buildAgentOnlineEvalReport({
      traces: [trace],
      seed: "seed",
      sampleRate: 1,
      generatedAt: FIXTURE_GENERATED_AT,
      evaluator: () => ({ score: 1.5, verdict: "pass" }),
    }),
  );
});

test("buildAgentOnlineEvalReport population block reports sample rate honestly", async () => {
  const fixture = await loadTraceFixture();
  const report = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    sampleRate: 0.5,
    generatedAt: FIXTURE_GENERATED_AT,
  });
  assert.equal(report.population.totalTraces, fixture.traces.length);
  assert.equal(
    report.population.observedSampleRate,
    Math.round((report.population.sampledCount / fixture.traces.length) * 1e6) /
      1e6,
  );
});

test("writeAgentOnlineEvalReport produces canonical, byte-stable output", async () => {
  const fixture = await loadTraceFixture();
  const report = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    sampleRate: 1,
    generatedAt: FIXTURE_GENERATED_AT,
  });
  const tempDir = await mkdtemp(join(tmpdir(), "agent-online-eval-"));
  try {
    const outPath = await writeAgentOnlineEvalReport({
      report,
      runDir: tempDir,
    });
    assert.equal(outPath, join(tempDir, AGENT_ONLINE_EVAL_REPORT_FILENAME));
    const first = await readFile(outPath, "utf8");
    assert.equal(first, canonicalJson(report));
    await writeAgentOnlineEvalReport({ report, runDir: tempDir });
    const second = await readFile(outPath, "utf8");
    assert.equal(first, second);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runAgentOnlineEvalSampler builds + persists in one call", async () => {
  const fixture = await loadTraceFixture();
  const tempDir = await mkdtemp(join(tmpdir(), "agent-online-eval-"));
  try {
    const { report, outputPath } = await runAgentOnlineEvalSampler({
      traces: fixture.traces,
      runDir: tempDir,
      seed: "fixture-seed",
      sampleRate: 0.5,
      generatedAt: FIXTURE_GENERATED_AT,
    });
    assert.equal(outputPath, join(tempDir, AGENT_ONLINE_EVAL_REPORT_FILENAME));
    const persisted = await readFile(outputPath, "utf8");
    assert.equal(persisted, canonicalJson(report));
    assert.equal(report.sampleRate, 0.5);
    assert.equal(report.population.totalTraces, fixture.traces.length);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("default sample rate is 1% when none is supplied", async () => {
  const fixture = await loadTraceFixture();
  const report = buildAgentOnlineEvalReport({
    traces: fixture.traces,
    seed: "fixture-seed",
    generatedAt: FIXTURE_GENERATED_AT,
  });
  assert.equal(report.sampleRate, 0.01);
});
