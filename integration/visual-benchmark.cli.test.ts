import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVisualBenchmarkCliResolution,
  runVisualBenchmarkCli,
} from "./visual-benchmark.cli.js";

// ---------------------------------------------------------------------------
// --viewport <id> — Issue #838 Wave 3
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkCliResolution accepts --viewport with allowed id", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--viewport",
    "desktop",
  ]);
  assert.equal(resolution.action, "benchmark");
  assert.equal(resolution.viewportId, "desktop");
});

test("resolveVisualBenchmarkCliResolution rejects --viewport with invalid characters", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--viewport", "invalid@chars"]),
    /invalid characters/i,
  );
});

test("resolveVisualBenchmarkCliResolution rejects --viewport without a value", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--viewport"]),
    /requires a value/i,
  );
});

test("runVisualBenchmarkCli forwards viewport selection to benchmark execution", async () => {
  let receivedInput:
    | {
        qualityThreshold?: number;
        viewportId?: string;
      }
    | undefined;

  const status = await runVisualBenchmarkCli(
    ["--viewport", "mobile", "--quality-threshold", "92"],
    {
      runBenchmark: async (input) => {
        receivedInput = input;
        return {
          deltas: [],
          overallBaseline: null,
          overallCurrent: 100,
          overallDelta: null,
          alerts: [],
          trendSummaries: [],
        };
      },
    },
  );

  assert.equal(status, 0);
  assert.deepEqual(receivedInput, {
    qualityThreshold: 92,
    viewportId: "mobile",
  });
});
