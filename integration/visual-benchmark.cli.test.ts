import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVisualBenchmarkCliResolution,
  runVisualBenchmarkCli,
} from "./visual-benchmark.cli.js";
import type { BenchmarkBrowserName } from "./visual-benchmark.execution.js";

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
        ci?: boolean;
        viewportId?: string;
        componentVisualCatalogFile?: string;
        storybookStaticDir?: string;
        browsers?: BenchmarkBrowserName[];
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
    componentVisualCatalogFile: undefined,
    ci: undefined,
    qualityThreshold: 92,
    storybookStaticDir: undefined,
    viewportId: "mobile",
    browsers: undefined,
  });
});

// ---------------------------------------------------------------------------
// --browsers <names> — Issue #848
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkCliResolution accepts --browsers with a single browser", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--browsers",
    "chromium",
  ]);
  assert.equal(resolution.action, "benchmark");
  assert.deepEqual(resolution.browsers, ["chromium"]);
});

test("resolveVisualBenchmarkCliResolution accepts --browsers with full matrix", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--browsers",
    "chromium,firefox,webkit",
  ]);
  assert.deepEqual(resolution.browsers, ["chromium", "firefox", "webkit"]);
});

test("resolveVisualBenchmarkCliResolution deduplicates repeated browser names", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--browsers",
    "chromium,chromium,firefox",
  ]);
  assert.deepEqual(resolution.browsers, ["chromium", "firefox"]);
});

test("resolveVisualBenchmarkCliResolution rejects unknown browser name", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--browsers", "chromium,opera"]),
    /Unknown browser/i,
  );
});

test("resolveVisualBenchmarkCliResolution rejects --browsers without a value", () => {
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--browsers"]),
    /requires a value/i,
  );
});

test("resolveVisualBenchmarkCliResolution defaults browsers to undefined when flag omitted", () => {
  const resolution = resolveVisualBenchmarkCliResolution([]);
  assert.equal(resolution.browsers, undefined);
});

test("runVisualBenchmarkCli forwards browsers to benchmark execution", async () => {
  let receivedInput:
    | {
        browsers?: BenchmarkBrowserName[];
      }
    | undefined;

  await runVisualBenchmarkCli(["--browsers", "chromium,firefox"], {
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
  });

  assert.deepEqual(receivedInput?.browsers, ["chromium", "firefox"]);
});

// ---------------------------------------------------------------------------
// --enforce-thresholds + all-fixtures-failed — guard against silent pass (#826)
// ---------------------------------------------------------------------------

test("runVisualBenchmarkCli returns 1 with --enforce-thresholds when every fixture failed", async () => {
  const status = await runVisualBenchmarkCli(["--enforce-thresholds"], {
    runBenchmark: async () => {
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 0,
        overallDelta: null,
        alerts: [],
        trendSummaries: [],
        failedFixtures: [
          {
            fixtureId: "simple-form",
            error: {
              code: "E_VISUAL_DIFF_REFERENCE_MISSING",
              message: "Reference image not found",
            },
          },
        ],
      };
    },
  });

  assert.equal(status, 1);
});

test("runVisualBenchmarkCli returns 0 without --enforce-thresholds even when every fixture failed", async () => {
  const status = await runVisualBenchmarkCli([], {
    runBenchmark: async () => {
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 0,
        overallDelta: null,
        alerts: [],
        trendSummaries: [],
        failedFixtures: [
          {
            fixtureId: "simple-form",
            error: {
              code: "E_VISUAL_DIFF_REFERENCE_MISSING",
              message: "Reference image not found",
            },
          },
        ],
      };
    },
  });

  assert.equal(status, 0);
});

test("runVisualBenchmarkCli returns 1 with --enforce-thresholds when overfitting risk alert is present", async () => {
  const status = await runVisualBenchmarkCli(["--enforce-thresholds"], {
    runBenchmark: async () => {
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 88,
        overallDelta: 2,
        alerts: [
          {
            code: "ALERT_VISUAL_QUALITY_OVERFITTING_RISK",
            severity: "warn",
            message: "Potential overfitting detected",
            value: -2,
            threshold: -1,
          },
        ],
        trendSummaries: [],
      };
    },
  });

  assert.equal(status, 1);
});

test("runVisualBenchmarkCli returns 1 with --enforce-thresholds when canonical diff alert is present", async () => {
  const status = await runVisualBenchmarkCli(["--enforce-thresholds"], {
    runBenchmark: async () => {
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 91,
        overallDelta: 1,
        alerts: [
          {
            code: "ALERT_VISUAL_QUALITY_CANONICAL_DIFF_EXCEEDED",
            severity: "warn",
            message: "Canonical pixel diff exceeded threshold",
            value: 0.5,
            threshold: 0.1,
          },
        ],
        trendSummaries: [],
      };
    },
  });

  assert.equal(status, 1);
});

test("runVisualBenchmarkCli returns 1 with --enforce-thresholds when canonical reference alert is present", async () => {
  const status = await runVisualBenchmarkCli(["--enforce-thresholds"], {
    runBenchmark: async () => {
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 91,
        overallDelta: 1,
        alerts: [
          {
            code: "ALERT_VISUAL_QUALITY_CANONICAL_REFERENCE_MISSING",
            severity: "warn",
            message: "Canonical reference missing",
            value: 0,
            threshold: 0.1,
          },
        ],
        trendSummaries: [],
      };
    },
  });

  assert.equal(status, 1);
});
