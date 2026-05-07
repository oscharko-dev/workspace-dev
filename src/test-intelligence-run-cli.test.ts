/**
 * Unit tests for the `workspace-dev test-intelligence run` flag parser
 * and dispatcher (Issue #1736). The CLI's actual `runTestIntelligenceCommand`
 * orchestration is covered by injection-seam tests below; the live
 * production-runner end-to-end path is exercised by the official
 * `pnpm exec workspace-dev start --enable-test-intelligence` route in
 * `cli.contract.test.ts` and the live PR verification.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseTestIntelligenceDoctorArgs,
  parseTestIntelligenceRunArgs,
  runTestIntelligenceDoctorCommand,
  runTestIntelligenceCommand,
  TestIntelligenceRunOperatorError,
  type TestIntelligenceDoctorOptions,
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
  customerProfilePath: undefined,
  diversityPasses: 1,
});

const baseDoctorOptions = (): TestIntelligenceDoctorOptions => ({
  modelDeployment: "mistral-large-3",
  logicJudgeDeployment: "gpt-oss-120b",
  coveragePlannerDeployment: "phi-4-mini-instruct",
  riskRankerDeployment: "phi-4",
  topologyInputSources: {
    modelDeployment: "env",
    logicJudgeDeployment: "env",
    coveragePlannerDeployment: "env",
    riskRankerDeployment: "env",
  },
});

type Issue1993TopologyRunOptions = TestIntelligenceRunOptions & {
  requireMultiAgentTopology?: boolean;
  riskRankerDeployment?: string | undefined;
  topologyReportPath?: string | undefined;
};

const parseIssue1993TopologyRunArgs = (
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = {},
): Issue1993TopologyRunOptions =>
  parseTestIntelligenceRunArgs(args, env) as Issue1993TopologyRunOptions;

const issue1993TopologyPreflightSupported = (() => {
  try {
    const opts = parseIssue1993TopologyRunArgs(
      [
        "--figma-url",
        "https://figma.com/design/abc/foo",
        "--output",
        "/tmp/x",
        "--require-multi-agent-topology",
      ],
      {
        WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY: "1",
      },
    );
    return opts.requireMultiAgentTopology === true;
  } catch {
    return false;
  }
})();

const issue1993RiskRankerPlumbingSupported = (() => {
  try {
    const opts = parseIssue1993TopologyRunArgs(
      [
        "--figma-url",
        "https://figma.com/design/abc/foo",
        "--output",
        "/tmp/x",
        "--risk-ranker-deployment",
        "phi-4-mini-instruct",
      ],
      {
        WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT: "mistral-large-3",
      },
    );
    return opts.riskRankerDeployment === "phi-4-mini-instruct";
  } catch {
    return false;
  }
})();

const buildIssue1993RunResult = (
  artifactDir: string,
  artifactPaths: Record<string, string> = {},
  extras: Partial<RunFigmaToQcTestCasesResult> = {},
): RunFigmaToQcTestCasesResult =>
  ({
    jobId: "ti-cli-topology",
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
    finopsBudget: {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
    artifactDir,
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
      ...artifactPaths,
    } as RunFigmaToQcTestCasesResult["artifactPaths"],
    customerMarkdownPaths: {
      combined: "/tmp/customer-markdown/testfaelle.md",
      perCase: [],
    },
    ...extras,
  }) as RunFigmaToQcTestCasesResult;

const emptyRunnerResult = (input: {
  jobId: string;
  outputRoot: string;
}): RunFigmaToQcTestCasesResult => ({
  jobId: input.jobId,
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
  finopsBudget: {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
  artifactDir: `${input.outputRoot}/jobs/${input.jobId}/test-intelligence`,
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
  assert.equal(options.mode, "deterministic_llm");
  assert.equal(options.noVisualSidecar, false);
  assert.equal(options.finopsBudgetPath, undefined);
});

test("parseTestIntelligenceRunArgs: allow-policy-blocked defaults to true", () => {
  const options = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {},
  );
  assert.equal(options.allowPolicyBlocked, true);
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED enables policy bypass", () => {
  const options = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED: "1",
    },
  );
  assert.equal(options.allowPolicyBlocked, true);
});

test("parseTestIntelligenceRunArgs: --allow-policy-blocked sets allowPolicyBlocked", () => {
  const options = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc/foo",
      "--output",
      "/tmp/x",
      "--allow-policy-blocked",
    ],
    {},
  );
  assert.equal(options.allowPolicyBlocked, true);
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED can disable the bypass", () => {
  const options = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED: "0",
    },
  );
  assert.equal(options.allowPolicyBlocked, false);
});

test("parseTestIntelligenceRunArgs: --mode default is deterministic_llm", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo", "--output", "/tmp/x"],
    {},
  );
  assert.equal(opts.mode, "deterministic_llm");
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

// ---------------------------------------------------------------------------
// parseTestIntelligenceRunArgs — topology preflight wiring (Issue #1993)
// ---------------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: --require-multi-agent-topology and env WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY=1 hydrate strict mode (Issue #1993)", (t) => {
  if (!issue1993TopologyPreflightSupported) {
    t.skip("Issue #1993 topology strict-mode support is not present in this CLI");
    return;
  }

  const fromEnv = parseIssue1993TopologyRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_REQUIRE_MULTI_AGENT_TOPOLOGY: "1",
    },
  );
  assert.equal(fromEnv.requireMultiAgentTopology, true);

  const fromFlag = parseIssue1993TopologyRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--require-multi-agent-topology",
    ],
    {},
  );
  assert.equal(fromFlag.requireMultiAgentTopology, true);
});

test("parseTestIntelligenceRunArgs: risk-ranker env and flag hydrate topology planning when present (Issue #1993)", (t) => {
  if (!issue1993RiskRankerPlumbingSupported) {
    t.skip("Issue #1993 risk-ranker plumbing is not present in this CLI");
    return;
  }

  const fromEnv = parseIssue1993TopologyRunArgs(
    ["--figma-url", "https://figma.com/design/abc", "--output", "/tmp/x"],
    {
      WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT: "phi-4",
    },
  );
  assert.equal(fromEnv.riskRankerDeployment, "phi-4");

  const fromFlag = parseIssue1993TopologyRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--risk-ranker-deployment",
      "phi-4-mini-instruct",
    ],
    {
      WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT: "gpt-oss-120b",
    },
  );
  assert.equal(fromFlag.riskRankerDeployment, "phi-4-mini-instruct");
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
// parseTestIntelligenceDoctorArgs / runTestIntelligenceDoctorCommand
// ---------------------------------------------------------------------------

test("parseTestIntelligenceDoctorArgs: env defaults flow into doctor options", () => {
  const options = parseTestIntelligenceDoctorArgs([], {
    WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "mistral-large-3",
    WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT: "gpt-oss-120b",
    WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT: "phi-4-mini-instruct",
    WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT: "phi-4",
  });
  assert.equal(options.modelDeployment, "mistral-large-3");
  assert.equal(options.logicJudgeDeployment, "gpt-oss-120b");
  assert.equal(options.coveragePlannerDeployment, "phi-4-mini-instruct");
  assert.equal(options.riskRankerDeployment, "phi-4");
  assert.equal(options.topologyInputSources.modelDeployment, "env");
});

test("parseTestIntelligenceDoctorArgs: CLI overrides doctor deployment defaults", () => {
  const options = parseTestIntelligenceDoctorArgs(
    [
      "--model-deployment",
      "mistral-large-3",
      "--logic-judge-deployment",
      "gpt-oss-120b",
      "--coverage-planner-deployment",
      "phi-4-mini-instruct",
      "--risk-ranker-deployment",
      "phi-4",
    ],
    {
      WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
      WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT: "phi-4",
      WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT: "gpt-oss-120b",
      WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT: "gpt-oss-120b",
    },
  );
  assert.equal(options.modelDeployment, "mistral-large-3");
  assert.equal(options.logicJudgeDeployment, "gpt-oss-120b");
  assert.equal(options.coveragePlannerDeployment, "phi-4-mini-instruct");
  assert.equal(options.riskRankerDeployment, "phi-4");
  assert.equal(options.topologyInputSources.modelDeployment, "cli");
  assert.equal(options.topologyInputSources.logicJudgeDeployment, "cli");
});

test("runTestIntelligenceDoctorCommand: intended topology exits 0 with only ok statuses", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceDoctorCommand(baseDoctorOptions(), sink, {
    env: {
      WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT:
        "llama-4-maverick-vision",
      WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT:
        "phi-4-multimodal-instruct",
      WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT:
        "phi-4-multimodal-instruct",
      WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://aoai.example/openai/v1",
      WORKSPACE_TEST_SPACE_MODEL_API_KEY: "secret-key",
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /overall status: ok/u);
  assert.doesNotMatch(stdout.join(""), /https:\/\/aoai\.example/u);
  assert.doesNotMatch(stdout.join(""), /secret-key/u);
});

test("runTestIntelligenceDoctorCommand: bad topology flags all affected roles and exits non-zero on invalid contracts", async () => {
  const { sink, stdout } = collectingSink();
  const exitCode = await runTestIntelligenceDoctorCommand(
    {
      modelDeployment: "gpt-oss-120b",
      logicJudgeDeployment: undefined,
      coveragePlannerDeployment: undefined,
      riskRankerDeployment: undefined,
      topologyInputSources: {
        modelDeployment: "env",
        logicJudgeDeployment: "default",
        coveragePlannerDeployment: "default",
        riskRankerDeployment: "default",
      },
    },
    sink,
    {
      env: {
        WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT:
          "mistral-document-ai-2512",
        WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT:
          "llama-4-maverick-vision",
      },
    },
  );

  const output = stdout.join("");
  assert.equal(exitCode, 1);
  assert.match(output, /overall status: error/u);
  for (const role of [
    "generator",
    "logic-judge",
    "visual-primary",
    "visual-fallback",
    "coverage-planner",
    "risk-ranker",
    "a11y-judge",
  ]) {
    assert.match(output, new RegExp(`${role}:`, "u"));
  }
  assert.match(output, /visual-primary: error/u);
  assert.match(
    output,
    /WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT=llama-4-maverick-vision/u,
  );
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

test("runTestIntelligenceCommand: offline_eval routes to deterministic_llm", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const exitCode = await runTestIntelligenceCommand(
    { ...baseOptions(), mode: "offline_eval" },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      runner: async () => ({
        jobId: "ti-cli-offline",
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
        artifactDir: "/tmp/offline-output/_runner-output/jobs/ti-cli-offline",
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
      }),
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
    },
  );
  assert.equal(exitCode, 0);
  assert.match(stderr.join(""), /offline_eval/);
  assert.match(stdout.join(""), /completed/u);
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
    customerProfilePath: undefined,
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

test("runTestIntelligenceCommand: deterministic_llm blocked + allowPolicyBlocked=false → exit 3", async () => {
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
    customerProfilePath: undefined,
    allowPolicyBlocked: false,
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

test("runTestIntelligenceCommand: deterministic_llm blocked + --allow-policy-blocked → exit 0", async () => {
  const { sink, stdout, stderr } = collectingSink();
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
    customerProfilePath: undefined,
    allowPolicyBlocked: true,
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

  assert.equal(exitCode, 0);
  assert.match(stderr.join(""), /blocked by policy/u);
  const out = stdout.join("");
  assert.match(out, /policy status\s*:\s*blocked/u);
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
    customerProfilePath: undefined,
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

test("runTestIntelligenceCommand: strict preflight fails before runner when logic judge would reuse generator (Issue #1993)", async () => {
  const { sink, stderr, stdout } = collectingSink();
  let runnerCalled = false;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      mode: "deterministic_llm",
      modelEndpoint: "https://aoai.example/openai/v1",
      modelApiKey: "k-key",
      modelDeployment: "mistral-large-3",
      requireMultiAgentTopology: true,
    },
    sink,
    {
      env: GATE_ON,
      runner: async () => {
        runnerCalled = true;
        throw new Error("runner should not be reached");
      },
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(runnerCalled, false);
  assert.match(
    stderr.join(""),
    /logic-judge deployment must be configured and differ from the generator/u,
  );
  assert.doesNotMatch(stdout.join(""), /topology preflight passed/u);
});

test("runTestIntelligenceCommand: strict preflight rejects mistral-document-ai-2512 for visual primary (Issue #1993)", async () => {
  const { sink, stderr } = collectingSink();
  let runnerCalled = false;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      mode: "deterministic_llm",
      modelEndpoint: "https://aoai.example/openai/v1",
      modelApiKey: "k-key",
      enableVisualSidecar: true,
      requireMultiAgentTopology: true,
      logicJudgeDeployment: "gpt-oss-120b",
    },
    sink,
    {
      env: {
        ...GATE_ON,
        WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT:
          "https://aoai.example/openai/vision",
        WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT:
          "mistral-document-ai-2512",
        WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT:
          "phi-4-multimodal-instruct",
      },
      runner: async () => {
        runnerCalled = true;
        throw new Error("runner should not be reached");
      },
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(runnerCalled, false);
  assert.match(
    stderr.join(""),
    /visual-primary deployment "mistral-document-ai-2512" is incompatible/u,
  );
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

test("runTestIntelligenceCommand: legacy behavior stays unchanged when strict topology mode is absent (Issue #1993)", async () => {
  const { sink, stdout, stderr } = collectingSink();
  let runnerInput: unknown;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      figmaToken: undefined,
      modelEndpoint: "https://aoai.example/openai/v1",
      modelDeployment: "mistral-large-3",
      modelApiKey: "k-key",
      mode: "deterministic_llm",
      requireMultiAgentTopology: false,
      logicJudgeDeployment: undefined,
      enableVisualSidecar: false,
    } as Issue1993TopologyRunOptions,
    sink,
    {
      env: GATE_ON,
      runner: async (input) => {
        runnerInput = input;
        return buildIssue1993RunResult("/tmp/legacy-output/_runner-output");
      },
      buildLlmClient: () =>
        ({}) as unknown as ReturnType<
          Required<Parameters<typeof runTestIntelligenceCommand>[2]>["buildLlmClient"]
        >,
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      loadJsonFile: async () => ({}),
      copyArtifactsToOutput: async () => 0,
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 0, stderr.join(""));
  assert.ok(runnerInput);
  assert.equal(
    (runnerInput as { topology?: unknown; topologyReport?: unknown }).topology,
    undefined,
  );
  assert.equal(
    (runnerInput as { topology?: unknown; topologyReport?: unknown })
      .topologyReport,
    undefined,
  );
  assert.match(stdout.join(""), /completed/u);
  assert.doesNotMatch(stdout.join(""), /topology report/u);
});

test("runTestIntelligenceCommand: dry_run output mentions harness mode line", async () => {
  const { sink, stdout } = collectingSink();
  await runTestIntelligenceCommand(baseOptions(), sink, {
    env: GATE_ON,
    now: () => 1700000000000,
  });
  assert.match(stdout.join(""), /harness mode/u);
});

test("runTestIntelligenceCommand: strict preflight writes sanitized topology report and forwards risk ranker (Issue #1993)", async () => {
  const tmpDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-ti-topology-"),
  );
  const { sink, stderr, stdout } = collectingSink();
  let capturedRiskRanker: unknown;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      output: tmpDir,
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      mode: "deterministic_llm",
      modelEndpoint: "https://aoai.example/openai/v1",
      modelApiKey: "k-key",
      modelDeployment: "mistral-large-3",
      logicJudgeDeployment: "gpt-oss-120b",
      riskRankerDeployment: "phi-4",
      requireMultiAgentTopology: true,
      topologyInputSources: {
        modelDeployment: "cli",
        logicJudgeDeployment: "cli",
        coveragePlannerDeployment: "default",
        riskRankerDeployment: "cli",
      },
    },
    sink,
    {
      env: GATE_ON,
      runner: async (input) => {
        capturedRiskRanker = (
          input as unknown as { llm: { riskRanker?: unknown } }
        ).llm.riskRanker;
        return {
          jobId: "ti-cli-topology",
          generatedAt: "2026-05-07T12:00:00.000Z",
          fileKey: "abc",
          generatedTestCases: {
            testCases: [],
          } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
          intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
          validation:
            {} as unknown as RunFigmaToQcTestCasesResult["validation"],
          policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
          coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
          blocked: false,
          finopsBudget:
            {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
          artifactDir: "/tmp/ti-cli-topology",
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
      },
      buildLlmClient: () => ({}) as never,
      buildLogicJudgeClient: () => ({ kind: "judge" }) as never,
      buildRiskRankerClient: () => ({ kind: "ranker" }) as never,
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      loadJsonFile: async () => ({}),
      copyArtifactsToOutput: async () => 0,
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 0, stderr.join(""));
  assert.deepEqual(capturedRiskRanker, { kind: "ranker" });
  assert.match(stdout.join(""), /topology preflight passed/u);

  const reportPath = path.join(tmpDir, "topology-preflight-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    roles: Array<{
      role: string;
      deployment?: string;
      source: string;
      status: string;
      skipReason?: string;
    }>;
  };
  assert.ok(Array.isArray(report.roles));
  assert.ok(
    report.roles.some(
      (role) =>
        role.role === "generator" &&
        role.deployment === "mistral-large-3" &&
        role.source === "cli" &&
        role.status === "configured",
    ),
  );
  assert.ok(
    report.roles.some(
      (role) =>
        role.role === "logic_judge" &&
        role.deployment === "gpt-oss-120b" &&
        role.source === "cli" &&
        role.status === "configured",
    ),
  );
  assert.ok(
    report.roles.some(
      (role) =>
        role.role === "coverage_planner" &&
        role.status === "disabled" &&
        /deterministic-only coverage planning/u.test(role.skipReason ?? ""),
    ),
  );
  assert.ok(
    report.roles.some(
      (role) =>
        role.role === "visual_primary" &&
        role.status === "skipped" &&
        role.skipReason === "visual sidecar disabled",
    ),
  );
  assert.equal(JSON.stringify(report).includes("https://aoai.example"), false);
  assert.equal(JSON.stringify(report).includes("k-key"), false);
});

test("runTestIntelligenceCommand: legacy topology remains allowed when strict mode is absent", async () => {
  const { sink, stderr } = collectingSink();
  let runnerCalled = false;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      figmaUrl: undefined,
      figmaJsonFile: "/tmp/figma.json",
      mode: "deterministic_llm",
      modelEndpoint: "https://aoai.example/openai/v1",
      modelApiKey: "k-key",
      modelDeployment: "mistral-large-3",
    },
    sink,
    {
      env: GATE_ON,
      runner: async () => {
        runnerCalled = true;
        return {
          jobId: "ti-cli-legacy",
          generatedAt: "2026-05-07T12:00:00.000Z",
          fileKey: "abc",
          generatedTestCases: {
            testCases: [],
          } as unknown as RunFigmaToQcTestCasesResult["generatedTestCases"],
          intent: {} as unknown as RunFigmaToQcTestCasesResult["intent"],
          validation:
            {} as unknown as RunFigmaToQcTestCasesResult["validation"],
          policy: {} as unknown as RunFigmaToQcTestCasesResult["policy"],
          coverage: {} as unknown as RunFigmaToQcTestCasesResult["coverage"],
          blocked: false,
          finopsBudget:
            {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
          artifactDir: "/tmp/ti-cli-legacy",
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
      },
      buildLlmClient: () => ({}) as never,
      loadFigmaJsonFile: async () => ({
        fileKey: "abc",
        name: "Foo",
        document: { id: "0:0", type: "DOCUMENT" },
      }),
      loadJsonFile: async () => ({}),
      copyArtifactsToOutput: async () => 0,
      now: () => 1700000000000,
    },
  );

  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(runnerCalled, true);
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

test("parseTestIntelligenceRunArgs: captures customer eval, ICT ref, and timestamp output subdir", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc/foo",
      "--customer-eval-markdown",
      "./eval.md",
      "--ict-register-ref",
      "workspace-dev-local-test-intelligence",
      "--output-run-subdir",
      "timestamp",
    ],
    {},
  );
  assert.equal(opts.customerEvalMarkdownPath, "./eval.md");
  assert.equal(opts.ictRegisterRef, "workspace-dev-local-test-intelligence");
  assert.equal(opts.outputRunSubdir, "timestamp");
});

test("parseTestIntelligenceRunArgs: customer eval and output subdir reject invalid values", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc/foo",
          "--customer-eval-markdown",
          "",
        ],
        {},
      ),
    /--customer-eval-markdown requires a non-empty file path/u,
  );
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc/foo",
          "--output-run-subdir",
          "none",
        ],
        {},
      ),
    /--output-run-subdir must be "timestamp" or "job-id"/u,
  );
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_ICT_REGISTER_REF hydrates default", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-url", "https://figma.com/design/abc/foo"],
    { WORKSPACE_TEST_SPACE_ICT_REGISTER_REF: " env-ref " },
  );
  assert.equal(opts.ictRegisterRef, "env-ref");
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

test("runTestIntelligenceCommand: dry_run with --customer-eval-markdown reports loaded byte count", async () => {
  const { sink, stdout, stderr } = collectingSink();
  let observedPath: string | undefined;
  const exitCode = await runTestIntelligenceCommand(
    {
      ...baseOptions(),
      customerEvalMarkdownPath: "/operator/eval.md",
      ictRegisterRef: "workspace-dev-local-test-intelligence",
      outputRunSubdir: "job-id",
    },
    sink,
    {
      env: GATE_ON,
      now: () => 1700000000000,
      loadCustomerEvalMarkdownFile: async (path) => {
        observedPath = path;
        return "# Testfall eines Anwendungstests\n- Schritte fortlaufend.";
      },
    },
  );
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(observedPath ?? "", /eval\.md$/u);
  const out = stdout.join("");
  assert.match(out, /customer eval\s*: loaded \(\d+ bytes\)/u);
  assert.match(out, /ict ref\s*: workspace-dev-local-test-intelligence/u);
  assert.match(out, /output subdir\s*: job-id/u);
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
    customerProfilePath: undefined,
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

test("runTestIntelligenceCommand: forwards customerEvalMarkdown and writes explicit output into timestamp run subdir", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/cli-eval-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelApiKey: "k-key",
    mode: "deterministic_llm",
    customerEvalMarkdownPath: "/operator/eval.md",
  };
  let capturedEval: string | undefined;
  let capturedOutputRoot: string | undefined;
  let copiedOutputDir: string | undefined;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedEval = (input as unknown as { customerEvalMarkdown?: string })
      .customerEvalMarkdown;
    capturedOutputRoot = input.outputRoot;
    return emptyRunnerResult({
      jobId: input.jobId,
      outputRoot: input.outputRoot,
    });
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
    copyArtifactsToOutput: async (_from, to) => {
      copiedOutputDir = to;
      return 1;
    },
    loadCustomerEvalMarkdownFile: async () => "# Kunden-Eval\n- Format.",
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(capturedEval, "# Kunden-Eval\n- Format.");
  const expectedRunDir = "/tmp/cli-eval-output/2023-11-14T22-13-20-000Z";
  assert.equal(capturedOutputRoot, expectedRunDir);
  assert.equal(copiedOutputDir, expectedRunDir);
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

// ---------------------------------------------------------------------------
// parseTestIntelligenceRunArgs — --customer-profile flag (Issue #1946)
// ---------------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: --customer-profile captures path", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/x",
      "--customer-profile",
      "./profile.json",
    ],
    {},
  );
  assert.equal(opts.customerProfilePath, "./profile.json");
});

test("parseTestIntelligenceRunArgs: --customer-profile rejects empty value", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--customer-profile",
          "",
        ],
        {},
      ),
    /--customer-profile requires a non-empty file path/u,
  );
});

test("parseTestIntelligenceRunArgs: --customer-profile rejects duplicate flag", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--customer-profile",
          "a.json",
          "--customer-profile",
          "b.json",
        ],
        {},
      ),
    /--customer-profile may be specified at most once/u,
  );
});

test("runTestIntelligenceCommand: dry_run with --customer-profile reports loaded byte count", async () => {
  const { sink, stdout } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    customerProfilePath: "/operator/profile.json",
  };
  const profileJson = JSON.stringify({ ictRegisterRef: "ICT-REF-99" });
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    loadCustomerProfileFile: async () => profileJson,
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0);
  const out = stdout.join("");
  assert.match(out, /customer prof\s*:.*loaded/u);
  assert.match(out, new RegExp(String(Buffer.byteLength(profileJson, "utf8"))));
});

test("runTestIntelligenceCommand: --customer-profile loader failure surfaces operator error and exits 1", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    customerProfilePath: "/missing/profile.json",
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    loadCustomerProfileFile: async () => {
      throw new TestIntelligenceRunOperatorError(
        "--customer-profile file not found: /missing/profile.json",
      );
    },
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(
    stderr.join(""),
    /--customer-profile file not found: \/missing\/profile\.json/u,
  );
});

test("runTestIntelligenceCommand: --customer-profile oversize file is rejected with exit 1", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    customerProfilePath: "/big/profile.json",
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    loadCustomerProfileFile: async () => {
      throw new TestIntelligenceRunOperatorError(
        `--customer-profile file exceeds ${256 * 1024} bytes (got ${300000}); shrink the file`,
      );
    },
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /exceeds.*bytes/u);
});

test("runTestIntelligenceCommand: --customer-profile schema error surfaces all issues and exits 1", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    customerProfilePath: "/bad/profile.json",
  };
  const invalidJson = JSON.stringify({ ictRegisterRef: 999 }); // number not string
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    env: GATE_ON,
    loadCustomerProfileFile: async () => invalidJson,
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /--customer-profile file is invalid/u);
  assert.match(stderr.join(""), /ictRegisterRef/u);
});

test("runTestIntelligenceCommand: deterministic_llm forwards customerProfile to runner input", async () => {
  const { sink, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    ...baseOptions(),
    figmaUrl: undefined,
    figmaJsonFile: "/tmp/figma.json",
    output: "/tmp/cli-profile-output",
    modelEndpoint: "https://aoai.example/openai/v1",
    modelApiKey: "k-key",
    mode: "deterministic_llm",
    customerProfilePath: "/operator/profile.json",
  };
  const profileJson = JSON.stringify({
    ictRegisterRef: "ICT-CLI-FWDED-01",
    glossary: [{ term: "IBAN", definition: "Bank account number" }],
  });
  let capturedProfile: unknown;
  const runner = async (
    input: Parameters<
      Required<Parameters<typeof runTestIntelligenceCommand>[2]>["runner"]
    >[0],
  ): Promise<RunFigmaToQcTestCasesResult> => {
    capturedProfile = (input as unknown as { customerProfile?: unknown })
      .customerProfile;
    return {
      jobId: "ti-cli-profile",
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
        "/tmp/cli-profile-output/_runner-output/jobs/ti-cli-profile/test-intelligence",
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
    loadCustomerProfileFile: async () => profileJson,
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.ok(
    capturedProfile !== undefined,
    "customerProfile must be forwarded to runner",
  );
  const profile = capturedProfile as { ictRegisterRef?: string };
  assert.equal(profile.ictRegisterRef, "ICT-CLI-FWDED-01");
});

// -----------------------------------------------------------------------
// Issue #1950 — coverage-baseline drift CLI flags
// -----------------------------------------------------------------------

test("parseTestIntelligenceRunArgs: coverageBaseline defaults to mode=check, undefined archetype, tenantId=default", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-json-file", "/tmp/x.json"],
    {},
  );
  assert.equal(opts.coverageBaseline.archetype, undefined);
  assert.equal(opts.coverageBaseline.tenantId, "default");
  assert.equal(opts.coverageBaseline.runtimeRoot, undefined);
  assert.equal(opts.coverageBaseline.mode, "check");
});

test("parseTestIntelligenceRunArgs: --coverage-baseline-archetype + tenant + runtime-root capture all knobs", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-json-file",
      "/tmp/x.json",
      "--coverage-baseline-archetype",
      "customer-self-service",
      "--coverage-baseline-tenant",
      "tenant-acme",
      "--coverage-baseline-runtime-root",
      "/var/lib/workspace-dev",
    ],
    {},
  );
  assert.equal(opts.coverageBaseline.archetype, "customer-self-service");
  assert.equal(opts.coverageBaseline.tenantId, "tenant-acme");
  assert.equal(opts.coverageBaseline.runtimeRoot, "/var/lib/workspace-dev");
  assert.equal(opts.coverageBaseline.mode, "check");
});

test("parseTestIntelligenceRunArgs: --coverage-baseline-update flips mode to update", () => {
  const opts = parseTestIntelligenceRunArgs(
    [
      "--figma-json-file",
      "/tmp/x.json",
      "--coverage-baseline-archetype",
      "customer-self-service",
      "--coverage-baseline-update",
    ],
    {},
  );
  assert.equal(opts.coverageBaseline.mode, "update");
  assert.equal(opts.coverageBaseline.archetype, "customer-self-service");
});

test("parseTestIntelligenceRunArgs: --coverage-baseline-update without --coverage-baseline-archetype is rejected", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-json-file",
          "/tmp/x.json",
          "--coverage-baseline-update",
        ],
        {},
      ),
    /requires --coverage-baseline-archetype/,
  );
});

test("parseTestIntelligenceRunArgs: --coverage-baseline-archetype rejects path-traversal segments", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        [
          "--figma-json-file",
          "/tmp/x.json",
          "--coverage-baseline-archetype",
          "../escape",
        ],
        {},
      ),
    /must match/,
  );
});

test("parseTestIntelligenceRunArgs: WORKSPACE_TEST_SPACE_TENANT_ID env hydrates the default tenant", () => {
  const opts = parseTestIntelligenceRunArgs(
    ["--figma-json-file", "/tmp/x.json"],
    { WORKSPACE_TEST_SPACE_TENANT_ID: "tenant-from-env" },
  );
  assert.equal(opts.coverageBaseline.tenantId, "tenant-from-env");
});
