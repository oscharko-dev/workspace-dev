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

test("parseTestIntelligenceRunArgs: requires --output", () => {
  assert.throws(
    () =>
      parseTestIntelligenceRunArgs(
        ["--figma-url", "https://figma.com/design/abc/foo?node-id=1-2"],
        {},
      ),
    TestIntelligenceRunOperatorError,
  );
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
  ]) {
    assert.throws(
      () => parseTestIntelligenceRunArgs([flag, "   "], {}),
      TestIntelligenceRunOperatorError,
    );
  }
});

test("runTestIntelligenceCommand: dry_run skips runner and exits 0", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: "https://figma.com/design/abc/Foo?node-id=1-2",
    figmaJsonFile: undefined,
    output: "/tmp/dry-run-output",
    modelEndpoint: undefined,
    modelDeployment: "gpt-oss-120b",
    modelApiKey: undefined,
    figmaToken: "figd_xxx",
    policyProfile: undefined,
    mode: "dry_run",
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(stdout.join(""), /dry_run/u);
});

test("runTestIntelligenceCommand: offline_eval not implemented yet -> exit 1", async () => {
  const { sink, stdout, stderr } = collectingSink();
  const options: TestIntelligenceRunOptions = {
    figmaUrl: "https://figma.com/design/abc/Foo",
    figmaJsonFile: undefined,
    output: "/tmp/offline-eval-output",
    modelEndpoint: undefined,
    modelDeployment: "gpt-oss-120b",
    modelApiKey: undefined,
    figmaToken: "figd_xxx",
    policyProfile: undefined,
    mode: "offline_eval",
  };
  const exitCode = await runTestIntelligenceCommand(options, sink, {
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /offline_eval/u);
  assert.equal(stdout.join(""), "");
});

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
    artifactDir:
      "/tmp/det-output/_runner-output/jobs/ti-cli-1/test-intelligence",
    artifactPaths: {
      intent: "/tmp/intent.json",
      compiledPrompt: "/tmp/compiled-prompt.json",
      generatedTestCases: "/tmp/generated.json",
      validationReport: "/tmp/validation.json",
      policyReport: "/tmp/policy.json",
      coverageReport: "/tmp/coverage.json",
    },
    customerMarkdownPaths: {
      combined: "/tmp/customer-markdown/testfaelle.md",
      perCase: ["/tmp/customer-markdown/case-1.md"],
    },
  });

  let copyCalls = 0;
  const exitCode = await runTestIntelligenceCommand(options, sink, {
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
    copyArtifactsToOutput: async () => {
      copyCalls += 1;
      return 2;
    },
    now: () => 1700000000000,
  });
  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(copyCalls, 1);
  assert.match(stdout.join(""), /completed/u);
});
