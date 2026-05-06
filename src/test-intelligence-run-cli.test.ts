/**
 * Unit tests for the `workspace-dev test-intelligence run` flag parser
 * and dispatcher (Issue #1736). The CLI's actual `runTestIntelligenceCommand`
 * orchestration is covered by injection-seam tests below; the live
 * production-runner end-to-end path is exercised by the official
 * `pnpm exec workspace-dev start --enable-test-intelligence` route in
 * `cli.contract.test.ts` and the live PR verification.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTestIntelligenceRunArgs,
  runTestIntelligenceCommand,
  TestIntelligenceRunOperatorError,
  type TestIntelligenceRunOptions,
  type TestIntelligenceRunSink,
} from "./test-intelligence-run-cli.js";
import type { RunFigmaToQcTestCasesResult } from "./test-intelligence/index.js";

const collectingSink = (): {
  sink: TestIntelligenceRunSink;
  stdout: string[];
  stderr: string[];
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    sink: {
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
    },
    stdout,
    stderr,
  };
};

const GATE_ON: NodeJS.ProcessEnv = {
  FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "1",
};

const baseOptions = (): TestIntelligenceRunOptions => ({
  figmaUrl: "https://figma.com/design/abc/Foo?node-id=1-2",
  figmaJsonFile: undefined,
  output: "/tmp/dry-run-output",
  modelEndpoint: undefined,
  modelDeployment: "gpt-oss-120b",
  logicJudgeDeployment: undefined,
  coveragePlannerDeployment: undefined,
  modelApiKey: undefined,
  figmaToken: "figd_xxx",
  policyProfile: undefined,
  mode: "dry_run",
  enableVisualSidecar: false,
  noVisualSidecar: false,
  finopsBudgetPath: undefined,
  harnessMode: "off",
  harnessTestDepth: "standard",
  harnessRoleStepId: undefined,
  harnessMaxRepairIterations: undefined,
  customContextMarkdownPath: undefined,
  diversityPasses: 1,
});

// ---------------------------------------------------------------------------
// parseTestIntelligenceRunArgs
// ---------------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: requires exactly one source", () => {
  assert.throws(
    () => parseTestIntelligenceRunArgs(["--output", "/tmp/x"], {}),
    TestIntelligenceRunOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://x",
          "--figma-json-file",
          "/tmp/y.json",
          "--output",
          "/tmp/x",
        ],
        {},
      ),
    TestIntelligenceRunOperatorError,
  );
});

test("parseTestIntelligenceRunArgs: output is optional — no error when absent", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo?node-id=1-2"],
    {},
  );
  assert.equal(opts.output, undefined);
});

test("parseTestIntelligenceRunArgs: env defaults flow into options when flags absent", () => {
  const options = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://aoai.example/openai/v1",
      WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
      WORKSPACE_TEST_SPACE_MODEL_API_KEY: "k-key",
      FIGMA_ACCESS_TOKEN: "figd_xxx",
    },
  );
  assert.equal(options.modelEndpoint, "https://aoai.example/openai/v1");
  assert.equal(options.modelDeployment, "gpt-oss-120b");
  assert.equal(options.modelApiKey, "k-key");
  assert.equal(options.figmaToken, "figd_xxx");
  assert.equal(options.mode, "dry_run");
  assert.equal(options.noVisualSidecar, false);
  assert.equal(options.finopsBudgetPath, undefined);
});

test("parseTestIntelligenceRunArgs: --mode default is dry_run", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {},
  );
  assert.equal(opts.mode, "dry_run");
});

test("parseTestIntelligenceRunArgs: rejects unknown flags", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--bogus",
          "1",
        ],
        {},
      ),
    /Unknown flag/u,
  );
});

test("parseTestIntelligenceRunArgs: rejects unknown --mode value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--mode",
          "unknown_mode",
        ],
        {},
      ),
    /--mode must be one of/u,
  );
});

test("parseTestIntelligenceRunArgs: empty value for required string flags fails", () => {
  for (const flag of [
    "--figma-url",
    "--output",
    "--model-endpoint",
    "--model-deployment",
    "--policy-profile",
    "--finops-budget",
  ]) {
    assert.throws(
      () => parseTestIntelligenceRunArgs([flag, "   "], {}),
      TestIntelligenceRunOperatorError,
    );
  }
});

test("parseTestIntelligenceRunArgs: --no-visual-sidecar sets noVisualSidecar", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--no-visual-sidecar",
    ],
    {},
  );
  assert.equal(opts.noVisualSidecar, true);
});

test("parseTestIntelligenceRunArgs: --enable-visual-sidecar sets enableVisualSidecar", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--enable-visual-sidecar",
    ],
    {},
  );
  assert.equal(opts.enableVisualSidecar, true);
  assert.equal(opts.noVisualSidecar, false);
});

test("parseTestIntelligenceRunArgs: env override enables visual sidecar", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    { FIGMAPIPE_WORKSPACE_TI_ENABLE_VISUAL_SIDECAR: "1" },
  );
  assert.equal(opts.enableVisualSidecar, true);
  assert.equal(opts.noVisualSidecar, false);
});

test("parseTestIntelligenceRunArgs: --enable-visual-sidecar conflicts with --no-visual-sidecar", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--enable-visual-sidecar",
          "--no-visual-sidecar",
        ],
        {},
      ),
    /--enable-visual-sidecar and --no-visual-sidecar are mutually exclusive/u,
  );
});

test("parseTestIntelligenceRunArgs: --logic-judge-deployment captures the cross-model judge deployment (Issue #1932)", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--logic-judge-deployment",
      "gpt-oss-120b",
    ],
    {},
  );
  assert.equal(opts.logicJudgeDeployment, "gpt-oss-120b");
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT env var hydrates the option (Issue #1932)", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "mistral-large-3",
      WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT: "gpt-oss-120b",
    },
  );
  assert.equal(opts.modelDeployment, "mistral-large-3");
  assert.equal(opts.logicJudgeDeployment, "gpt-oss-120b");
});

test("parseTestIntelligenceRunArgs: --logic-judge-deployment overrides the env default (Issue #1932)", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--logic-judge-deployment",
      "gpt-oss-120b",
    ],
    {
      WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT: "phi-4",
    },
  );
  assert.equal(opts.logicJudgeDeployment, "gpt-oss-120b");
});

test("parseTestIntelligenceRunArgs: --logic-judge-deployment rejects empty value (Issue #1932)", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--logic-judge-deployment",
          "   ",
        ],
        {},
      ),
    /--logic-judge-deployment requires a non-empty deployment name/u,
  );
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT env var hydrates the option (Issue #1934)", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT: "phi-4-mini-instruct",
    },
  );
  assert.equal(opts.coveragePlannerDeployment, "phi-4-mini-instruct");
});

test("parseTestIntelligenceRunArgs: --coverage-planner-deployment overrides the env default (Issue #1934)", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--coverage-planner-deployment",
      "phi-4-mini-instruct",
    ],
    {
      WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT: "gpt-oss-120b",
    },
  );
  assert.equal(opts.coveragePlannerDeployment, "phi-4-mini-instruct");
});

test("parseTestIntelligenceRunArgs: --finops-budget captures path", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--finops-budget",
      "/tmp/budget.json",
    ],
    {},
  );
  assert.equal(opts.finopsBudgetPath, "/tmp/budget.json");
});

// ---------------------------------------------------------------------------
// parseTestIntelligenceRunArgs — multi-agent harness flags (Issue #1791)
// ---------------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: harness defaults are off/standard/undefined", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    {},
  );
  assert.equal(opts.harnessMode, "off");
  assert.equal(opts.harnessTestDepth, "standard");
  assert.equal(opts.harnessRoleStepId, undefined);
});

test("parseTestIntelligenceRunArgs: --harness-mode accepts shadow_eval and enforced", () => {
  for (const mode of ["off", "shadow_eval", "enforced"] as const) {
    const opts = parseTestIntelligenceRunArgs(
      [
        "--figma-url",
        "https://figma.com/design/abc",
        "--output",
        "/tmp/x",
        "--harness-mode",
        mode,
      ],
      {},
    );
    assert.equal(opts.harnessMode, mode);
  }
});

test("parseTestIntelligenceRunArgs: --harness-mode rejects unknown value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--harness-mode",
          "yolo",
        ],
        {},
      ),
    /--harness-mode must be one of/u,
  );
});

test("parseTestIntelligenceRunArgs: --harness-test-depth accepts standard and exhaustive", () => {
  for (const depth of ["standard", "exhaustive"] as const) {
    const opts = parseTestIntelligenceRunArgs(
      [
        "--figma-url",
        "https://figma.com/design/abc",
        "--output",
        "/tmp/x",
        "--harness-test-depth",
        depth,
      ],
      {},
    );
    assert.equal(opts.harnessTestDepth, depth);
  }
});

test("parseTestIntelligenceRunArgs: --harness-test-depth rejects unknown value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--harness-test-depth",
          "shallow",
        ],
        {},
      ),
    /--harness-test-depth must be one of/u,
  );
});

test("parseTestIntelligenceRunArgs: --harness-role-step-id captures non-empty id", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--harness-role-step-id",
      "test_generation_alt",
    ],
    {},
  );
  assert.equal(opts.harnessRoleStepId, "test_generation_alt");
});

test("parseTestIntelligenceRunArgs: --harness-role-step-id rejects empty/whitespace", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/x",
          "--harness-role-step-id",
          "   ",
        ],
        {},
      ),
    TestIntelligenceRunOperatorError,
  );
});

test("parseTestIntelligenceRunArgs: --harness-max-repair-iterations captures a non-negative integer", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--harness-max-repair-iterations",
      "2",
    ],
    {},
  );
  assert.equal(opts.harnessMaxRepairIterations, 2);
});

test("parseTestIntelligenceRunArgs: --harness-max-repair-iterations rejects non-integers and negatives", () => {
  for (const value of ["-1", "1.5", "abc", "  "]) {
    assert.throws(
      () =>
        parseTestIntelligenceRunArgs(
          [
            "--figma-url",
            "https://figma.com/design/abc",
            "--output",
            "/tmp/x",
            "--harness-max-repair-iterations",
            value,
          ],
          {},
        ),
      TestIntelligenceRunOperatorError,
      `value ${value} should have been rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — feature gate
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: missing FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE gate → exit 1", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(baseOptions(), sink, {
    env: {},
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE/u);
  assert.equal(stdout.join(""), "");
});

test("runTestIntelligenceCommand: gate set to '0' is still off → exit 1", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(baseOptions(), sink, {
    env: { FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE: "0" },
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — dry_run
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: dry_run skips runner and exits 0", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(baseOptions(), sink, {
    env: GATE_ON,
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(stdout.join(""), /dry_run/u);
});

test("runTestIntelligenceCommand: dry_run output includes visual sidecar note", async () => {
  const { sink, stdout } = collectingSink();
  await runTestIntelligenceCommand(
    { ...baseOptions(), noVisualSidecar: true },
    sink,
    { env: GATE_ON, now: () => 1700000000000 },
  );
  assert.match(stdout.join(""), /--no-visual-sidecar/u);
});

test("runTestIntelligenceCommand: dry_run output includes finops budget note when path given", async () => {
  const { sink, stdout } = collectingSink();
  await runTestIntelligenceCommand(
    { ...baseOptions(), finopsBudgetPath: "/tmp/budget.json" },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadJsonFile: async () => ({
        budgetId: "test",
        budgetVersion: "1.0.0",
        roles: {},
      }),
    },
  );
  assert.match(stdout.join(""), /\/tmp\/budget\.json/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — offline_eval
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: offline_eval not implemented yet -> exit 1", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    { ...baseOptions(), mode: "offline_eval" },
    sink,
    { env: GATE_ON, now: () => 1700000000000 },
  );
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /offline_eval/u);
  assert.equal(stdout.join(""), "");
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — finops-budget validation
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: invalid finops-budget file → exit 1 with validation error", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    { ...baseOptions(), finopsBudgetPath: "/tmp/bad-budget.json" },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadJsonFile: async () => ({ notAValidEnvelope: true }),
    },
  );
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /invalid/u);
});

test("runTestIntelligenceCommand: finops-budget file read error → exit 1", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    { ...baseOptions(), finopsBudgetPath: "/tmp/missing.json" },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadJsonFile: async () => {
        throw new Error("ENOENT: no such file or directory");
      },
    },
  );
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /finops-budget/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — deterministic_llm with injected runner
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: deterministic_llm with injected runner returns 0 and writes Markdown via injected copier", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/det-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelDeployment: "gpt-oss-120b",
    logicJudgeDeployment: undefined,
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    enableVisualSidecar: false,
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
    harnessMode: "off",
    harnessTestDepth: "standard",
    harnessRoleStepId: undefined,
    harnessMaxRepairIterations: undefined,
    customContextMarkdownPath: undefined,
  };

  const runner = async (): Promise<RunFigmaToQcTestCasesResult> => ({
    jobId: "ti-cli-1",
    generatedAt: "2026-05-02T12:00:00.000Z",
    fileKey: "abc",
    generatedTestCases: {
      caseListVersion: "1.0.0" as never,
      generatedAt: "2026-05-02T12:00:00.000Z",
      jobId: "ti-cli-1",
      sourceTrace: { fileKey: "abc", screens: [] },
      testCases: [],
    } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
    intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
    validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
    policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
    coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
    blocked: false,
    finopsBudget: {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
    artifactDir:
      "/tmp/det-output/_runner-output/jobs/ti-cli-1/test-intelligence",
    artifactPaths: {
      intent: "/tmp/intent.json",
      compiledPrompt: "/tmp/compiled-prompt.json",
      untrustedContentNormalizationReport: "/tmp/ucnr.json",
      evidenceSeal: "/tmp/evidence-seal.json",
      agentRoleRun: "/tmp/agent-role-run.json",
      genealogy: "/tmp/genealogy.json",
      generatedTestCases: "/tmp/generated.json",
      validationReport: "/tmp/validation.json",
      policyReport: "/tmp/policy.json",
      coverageReport: "/tmp/coverage.json",
      finopsReport: "/tmp/finops.json",
    },
    customerMarkdownPaths: {
      combined: "/tmp/customer-markdown/testfaelle.md",
      perCase: ["/tmp/customer-markdown/case-1.md"],
    },
  });

  let copyCalls = 0;
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async (p: string) => {
      if (p.includes("finops")) {
        return {
          totals: {
            inputTokens: 1234,
            outputTokens: 567,
            estimatedCost: 0.042,
          },
        };
      }
      if (p.includes("evidence")) {
        return {
          predicate: {
            manifestSha256:
              "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
        };
      }
      return {};
    },
    copyArtifactsToOutput: async () => {
      copyCalls += 1;
      return 2;
    },
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(copyCalls, 1);
  const out = stdout.join("");
  assert.match(out, /completed/u);
  assert.match(out, /finops tokens in\/out/u);
  assert.match(out, /evidence manifest digest/u);
});

test("runTestIntelligenceCommand: deterministic_llm blocked → exit 3", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/blocked-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelDeployment: "gpt-oss-120b",
    logicJudgeDeployment: undefined,
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    enableVisualSidecar: false,
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
    harnessMode: "off",
    harnessTestDepth: "standard",
    harnessRoleStepId: undefined,
    harnessMaxRepairIterations: undefined,
    customContextMarkdownPath: undefined,
  };

  const runner = async (): Promise<RunFigmaToQcTestCasesResult> => ({
    jobId: "ti-cli-blocked",
    generatedAt: "2026-05-02T12:00:00.000Z",
    fileKey: "abc",
    generatedTestCases: {
      testCases: [],
    } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
    intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
    validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
    policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
    coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
    blocked: true,
    finopsBudget: {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
    artifactDir: "/tmp/blocked-output/_runner-output/jobs/ti-cli-blocked",
    artifactPaths: {
      intent: "/tmp/intent.json",
      compiledPrompt: "/tmp/compiled-prompt.json",
      untrustedContentNormalizationReport: "/tmp/ucnr.json",
      evidenceSeal: "/tmp/evidence-seal.json",
      agentRoleRun: "/tmp/agent-role-run.json",
      genealogy: "/tmp/genealogy.json",
      generatedTestCases: "/tmp/generated.json",
      validationReport: "/tmp/validation.json",
      policyReport: "/tmp/policy-report.json",
      coverageReport: "/tmp/coverage.json",
      finopsReport: "/tmp/finops.json",
    },
    customerMarkdownPaths: {
      combined: "/tmp/customer-markdown/testfaelle.md",
      perCase: [],
    },
  });

  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    now: () => 1700000000000,
  });

  assert.equal(exitCode, 3);
  assert.match(stderr.join(""), /blocked by policy/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — default output path
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: computes default output from job id when --output omitted", async () => {
  const { sink, stdout } = collectingSink();
  const opts = { ...baseOptions(), output: undefined };
  await runTestIntelligenceCommand(opts, sink, {
    env: GATE_ON,
    now: () => 1700000000000,
  });
  assert.match(stdout.join(""), /jobs\/ti-cli-1700000000000/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — multi-agent harness wiring (Issue #1791)
// ---------------------------------------------------------------------------

test("runTestIntelligenceCommand: dry_run + harness-mode != off → exit 1 cross-flag error", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    { ...baseOptions(), harnessMode: "enforced" },
    sink,
    { env: GATE_ON, now: () => 1700000000000 },
  );
  assert.equal(exitCode, 1);
  assert.match(
    stderr.join(""),
    /--harness-mode enforced requires --mode deterministic_llm/u,
  );
});

test("runTestIntelligenceCommand: deterministic_llm + harness-mode shadow_eval forwards harness config to runner and surfaces summary", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/harness-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelDeployment: "gpt-oss-120b",
    logicJudgeDeployment: undefined,
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    enableVisualSidecar: false,
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
    harnessMode: "shadow_eval",
    harnessTestDepth: "exhaustive",
    harnessRoleStepId: "test_generation_alt",
    harnessMaxRepairIterations: undefined,
    customContextMarkdownPath: undefined,
  };

  let capturedHarness: unknown;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedHarness = (input as unknown as { harness?: unknown }).harness;
    return {
      jobId: "ti-cli-2",
      generatedAt: "2026-05-02T12:00:00.000Z",
      fileKey: "abc",
      generatedTestCases: {
        testCases: [],
      } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
      intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
      validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
      policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
      coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
      blocked: false,
      finopsBudget:
        {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
      artifactDir: "/tmp/harness-output/_runner-output",
      artifactPaths: {
        intent: "/tmp/intent.json",
        compiledPrompt: "/tmp/compiled-prompt.json",
        untrustedContentNormalizationReport: "/tmp/ucnr.json",
        evidenceSeal: "/tmp/evidence-seal.json",
        agentRoleRun: "/tmp/agent-role-run.json",
        genealogy: "/tmp/genealogy.json",
        generatedTestCases: "/tmp/generated.json",
        validationReport: "/tmp/validation.json",
        policyReport: "/tmp/policy.json",
        coverageReport: "/tmp/coverage.json",
        finopsReport: "/tmp/finops.json",
        harnessStep: "/tmp/harness-step.json",
      },
      customerMarkdownPaths: {
        combined: "/tmp/customer-markdown/testfaelle.md",
        perCase: [],
      },
      harness: {
        mode: "shadow_eval",
        outcome: "accepted",
        mappedJobStatus: "succeeded",
        errorClass: "none",
        attemptsConsumed: 1,
        maxAttemptsAllowed: 3,
        artifactPath: "/tmp/harness-step.json",
      },
    } as unknown as RunFigmaToQcTestCasesResult;
  };

  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    now: () => 1700000000000,
  });

  assert.equal(exitCode, 0, stderr.join(""));
  assert.deepEqual(capturedHarness, {
    mode: "shadow_eval",
    testDepth: "exhaustive",
    roleStepId: "test_generation_alt",
  });
  const out = stdout.join("");
  assert.match(out, /multi-agent harness/u);
  assert.match(out, /mode=shadow_eval/u);
  assert.match(out, /outcome=accepted/u);
  assert.match(out, /attempts=1\/3/u);
  assert.match(out, /\/tmp\/harness-step\.json/u);
});

test("runTestIntelligenceCommand: deterministic_llm + harness-mode off omits harness key from runner input", async () => {
  const { sink } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    figmaToken: undefined,
    modelEndpoint: "https://aoai.example/openai/v1",
    modelApiKey: "k-key",
    mode: "deterministic_llm",
    enableVisualSidecar: false,
    harnessMode: "off",
  };

  let capturedHarness: unknown = "untouched";
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedHarness = (input as unknown as { harness?: unknown }).harness;
    return {
      jobId: "ti-cli-3",
      generatedAt: "2026-05-02T12:00:00.000Z",
      fileKey: "abc",
      generatedTestCases: {
        testCases: [],
      } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
      intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
      validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
      policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
      coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
      blocked: false,
      finopsBudget:
        {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
      artifactDir: "/tmp/off-output/_runner-output",
      artifactPaths: {
        intent: "/tmp/intent.json",
        compiledPrompt: "/tmp/compiled-prompt.json",
        untrustedContentNormalizationReport: "/tmp/ucnr.json",
        evidenceSeal: "/tmp/evidence-seal.json",
        agentRoleRun: "/tmp/agent-role-run.json",
        genealogy: "/tmp/genealogy.json",
        generatedTestCases: "/tmp/generated.json",
        validationReport: "/tmp/validation.json",
        policyReport: "/tmp/policy.json",
        coverageReport: "/tmp/coverage.json",
        finopsReport: "/tmp/finops.json",
      },
      customerMarkdownPaths: {
        combined: "/tmp/customer-markdown/testfaelle.md",
        perCase: [],
      },
    } as unknown as RunFigmaToQcTestCasesResult;
  };

  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    now: () => 1700000000000,
  });

  assert.equal(exitCode, 0);
  assert.equal(capturedHarness, undefined);
});

test("runTestIntelligenceCommand: enable-visual-sidecar builds and forwards runner bundle", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    figmaToken: undefined,
    modelEndpoint: "https://aoai.example/openai/v1",
    modelApiKey: "k-key",
    mode: "deterministic_llm",
    enableVisualSidecar: true,
    harnessMode: "off",
  };

  const bundle = {
    testGeneration: { kind: "test-generation-client" },
    visualPrimary: { kind: "visual-primary-client" },
    visualFallback: { kind: "visual-fallback-client" },
  };

  let buildBundleCalls = 0;
  let capturedBundle: unknown;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedBundle = (input as unknown as { llm: { bundle?: unknown } }).llm
      .bundle;
    return {
      jobId: "ti-cli-visual",
      generatedAt: "2026-05-02T12:00:00.000Z",
      fileKey: "abc",
      generatedTestCases: {
        testCases: [],
      } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
      intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
      validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
      policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
      coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
      blocked: false,
      finopsBudget:
        {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
      artifactDir: "/tmp/visual-output/_runner-output",
      artifactPaths: {
        intent: "/tmp/intent.json",
        compiledPrompt: "/tmp/compiled-prompt.json",
        untrustedContentNormalizationReport: "/tmp/ucnr.json",
        evidenceSeal: "/tmp/evidence-seal.json",
        agentRoleRun: "/tmp/agent-role-run.json",
        genealogy: "/tmp/genealogy.json",
        generatedTestCases: "/tmp/generated.json",
        validationReport: "/tmp/validation.json",
        policyReport: "/tmp/policy.json",
        coverageReport: "/tmp/coverage.json",
        finopsReport: "/tmp/finops.json",
      },
      customerMarkdownPaths: {
        combined: "/tmp/customer-markdown/testfaelle.md",
        perCase: [],
      },
    } as unknown as RunFigmaToQcTestCasesResult;
  };

  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: {
      ...GATE_ON,
      WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT:
        "https://aoai.example/openai/vision",
      WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT: "llama-4-maverick-vision",
      WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT: "phi-4-multimodal-poc",
    },
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    buildLlmBundle: () => {
      buildBundleCalls += 1;
      return bundle as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmBundle"]
      >;
    },
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    now: () => 1700000000000,
  });

  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(buildBundleCalls, 1);
  assert.strictEqual(capturedBundle, bundle);
});

test("runTestIntelligenceCommand: enable-visual-sidecar fails closed when visual envs are missing", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      figmaToken: undefined,
      modelEndpoint: "https://aoai.example/openai/v1",
      modelApiKey: "k-key",
      mode: "deterministic_llm",
      enableVisualSidecar: true,
      harnessMode: "off",
    },
    sink,
    {
      env: GATE_ON,
      buildLlmClient: () =>
        ({}) as unknown as ReturnType<
          Required<
            Parameters<typeof runTestIntelligenceCommand>[2]
          >["buildLlmClient"]
        >,
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 1);
  assert.match(
    stderr.join(""),
    /requires WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT, WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT, WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT/u,
  );
});

test("runTestIntelligenceCommand: dry_run output mentions harness mode line", async () => {
  const { sink, stdout } = collectingSink();
  await runTestIntelligenceCommand(baseOptions(), sink, {
    env: GATE_ON,
    now: () => 1700000000000,
  });
  assert.match(stdout.join(""), /harness mode/u);
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCommand — --custom-context-markdown wiring (Issue #1894)
// ---------------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: --custom-context-markdown captures path", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc/foo",
      "--custom-context-markdown",
      "./demo-context.md",
    ],
    {},
  );
  assert.equal(opts.customContextMarkdownPath, "./demo-context.md");
});

test("parseTestIntelligenceRunArgs: --custom-context-markdown rejects empty value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc/foo",
          "--custom-context-markdown",
          "   ",
        ],
        {},
      ),
    TestIntelligenceRunOperatorError,
  );
});

test("parseTestIntelligenceRunArgs: --custom-context-markdown rejects duplicate flag", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc/foo",
          "--custom-context-markdown",
          "./a.md",
          "--custom-context-markdown",
          "./b.md",
        ],
        {},
      ),
    TestIntelligenceRunOperatorError,
  );
});

test("parseTestIntelligenceRunArgs: --diversity-passes accepts 1 and 2", () => {
  for (const value of ["1", "2"] as const) {
    const opts = parseTestIntelligenceRunArgs(
      [
        "--figma-url",
        "https://figma.com/design/abc/foo",
        "--custom-context-markdown",
        "./demo-context.md",
        "--diversity-passes",
        value,
      ],
      {},
    );
    assert.equal(opts.diversityPasses, Number(value));
  }
});

test("parseTestIntelligenceRunArgs: --diversity-passes rejects unsupported values", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc/foo",
          "--diversity-passes",
          "3",
        ],
        {},
      ),
    /--diversity-passes must be 1 or 2/u,
  );
});

test("runTestIntelligenceCommand: dry_run with --custom-context-markdown reports loaded byte count", async () => {
  const { sink, stdout, stderr } = collectingSink();
  let observedPath: string | undefined;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      customContextMarkdownPath: "/operator/context.md",
    },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadCustomContextMarkdownFile: async (path) => {
        observedPath = path;
        return "# Demo\nNon-PII supporting evidence.";
      },
    },
  );
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(observedPath ?? "", /context\.md$/u);
  assert.match(stdout.join(""), /custom md ctx\s*: loaded \(\d+ bytes\)/u);
});

test("runTestIntelligenceCommand: --custom-context-markdown loader failure surfaces operator error and exits 1", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      customContextMarkdownPath: "/missing/context.md",
    },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadCustomContextMarkdownFile: async () => {
        throw new TestIntelligenceRunOperatorError(
          "--custom-context-markdown file not found: /missing/context.md",
        );
      },
    },
  );
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /file not found/u);
});

test("runTestIntelligenceCommand: --custom-context-markdown unexpected loader failure exits 1 with sanitised message", async () => {
  const { sink, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      customContextMarkdownPath: "/locked/context.md",
    },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadCustomContextMarkdownFile: async () => {
        throw new Error("EACCES: permission denied");
      },
    },
  );
  assert.equal(exitCode, 1);
  assert.match(
    stderr.join(""),
    /failed to read --custom-context-markdown file/u,
  );
});

test("runTestIntelligenceCommand: deterministic_llm forwards customContextMarkdown to runner input", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/cli-md-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelDeployment: "gpt-oss-120b",
    logicJudgeDeployment: undefined,
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
    harnessMode: "off",
    harnessTestDepth: "standard",
    harnessRoleStepId: undefined,
    harnessMaxRepairIterations: undefined,
    customContextMarkdownPath: "/operator/forwarded.md",
  };
  let capturedMarkdown: string | undefined;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedMarkdown = (input as unknown as { customContextMarkdown?: string })
      .customContextMarkdown;
    return {
      jobId: "ti-cli-md",
      generatedAt: "2026-05-05T12:00:00.000Z",
      fileKey: "abc",
      generatedTestCases: {
        testCases: [],
      } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
      intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
      validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
      policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
      coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
      blocked: false,
      finopsBudget:
        {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
      artifactDir:
        "/tmp/cli-md-output/_runner-output/jobs/ti-cli-md/test-intelligence",
      artifactPaths: {
        intent: "/tmp/intent.json",
        compiledPrompt: "/tmp/compiled-prompt.json",
        untrustedContentNormalizationReport: "/tmp/ucnr.json",
        evidenceSeal: "/tmp/evidence-seal.json",
        agentRoleRun: "/tmp/agent-role-run.json",
        genealogy: "/tmp/genealogy.json",
        generatedTestCases: "/tmp/generated.json",
        validationReport: "/tmp/validation.json",
        policyReport: "/tmp/policy.json",
        coverageReport: "/tmp/coverage.json",
        finopsReport: "/tmp/finops.json",
      },
      customerMarkdownPaths: {
        combined: "/tmp/customer-markdown/testfaelle.md",
        perCase: [],
      },
    };
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    loadCustomContextMarkdownFile: async () =>
      "# Risk Profile\n- Limit: 10000 EUR.",
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(capturedMarkdown, "# Risk Profile\n- Limit: 10000 EUR.");
});

test("runTestIntelligenceCommand: deterministic_llm forwards diversityPasses to runner input", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/cli-diversity-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelApiKey: "k-key",
    mode: "deterministic_llm",
    diversityPasses: 2,
  };
  let capturedDiversityPasses: number | undefined;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedDiversityPasses = (
      input as unknown as {
        generation?: { diversityPasses?: number };
      }
    ).generation?.diversityPasses;
    return {
      jobId: "ti-cli-diversity",
      generatedAt: "2026-05-06T12:00:00.000Z",
      fileKey: "abc",
      generatedTestCases: {
        testCases: [],
      } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
      intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
      validation: {} as unknown as RunFigmaToQcTestCasesResult["validation"],
      policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
      coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
      blocked: false,
      finopsBudget:
        {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
      artifactDir:
        "/tmp/cli-diversity-output/_runner-output/jobs/ti-cli-diversity/test-intelligence",
      artifactPaths: {
        intent: "/tmp/intent.json",
        compiledPrompt: "/tmp/compiled-prompt.json",
        untrustedContentNormalizationReport: "/tmp/ucnr.json",
        evidenceSeal: "/tmp/evidence-seal.json",
        agentRoleRun: "/tmp/agent-role-run.json",
        genealogy: "/tmp/genealogy.json",
        generatedTestCases: "/tmp/generated.json",
        validationReport: "/tmp/validation.json",
        policyReport: "/tmp/policy.json",
        coverageReport: "/tmp/coverage.json",
        finopsReport: "/tmp/finops.json",
      },
      customerMarkdownPaths: {
        combined: "/tmp/customer-markdown/testfaelle.md",
        perCase: [],
      },
    };
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    runner,
    buildLlmClient: () =>
      ({}) as unknown as ReturnType<
        Required<
          Parameters<typeof runTestIntelligenceCommand>[2]
        >["buildLlmClient"]
      >,
    loadFigmaJsonFile: async () => ({
      fileKey: "abc",
      name: "Foo",
      document: { id: "0:0", type: "DOCUMENT" },
    }),
    loadJsonFile: async () => ({}),
    copyArtifactsToOutput: async () => 0,
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(capturedDiversityPasses, 2);
});
