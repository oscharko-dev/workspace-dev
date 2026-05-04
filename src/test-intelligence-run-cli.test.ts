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
  modelApiKey: undefined,
  figmaToken: "figd_xxx",
  policyProfile: undefined,
  mode: "dry_run",
  noVisualSidecar: false,
  finopsBudgetPath: undefined,
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
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
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
    finopsBudget:
      {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
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
          predicate: { manifestSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" },
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
    modelApiKey: "k-key",
    figmaToken: undefined,
    policyProfile: undefined,
    mode: "deterministic_llm",
    noVisualSidecar: false,
    finopsBudgetPath: undefined,
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
    finopsBudget:
      {} as unknown as RunFigmaToQcTestCasesResult["finopsBudget"],
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
