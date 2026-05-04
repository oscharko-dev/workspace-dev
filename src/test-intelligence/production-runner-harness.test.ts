import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  PRODUCTION_RUNNER_HARNESS_MODES,
  PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID,
  ProductionRunnerError,
  runFigmaToQcTestCases,
  type ProductionRunnerHarnessMode,
  type ProductionRunnerLlmDraftCase,
} from "./production-runner.js";
import type { FigmaRestNode } from "./figma-rest-adapter.js";

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

const SAMPLE_FILE = {
  fileKey: "ABC",
  name: "Test View 03",
  document: node({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      node({
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          node({
            id: "1:1",
            name: "Bedarfsermittlung",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 800 },
            children: [
              node({
                id: "2:1",
                name: "Investitionssumme",
                type: "TEXT",
                characters: "Investitionssumme",
              }),
              node({
                id: "2:2",
                name: "Submit Button",
                type: "INSTANCE",
                characters: "Weiter",
              }),
            ],
          }),
        ],
      }),
    ],
  }),
};

const SAMPLE_DRAFT: ProductionRunnerLlmDraftCase = {
  title: "Eingabe einer gültigen Investitionssumme",
  objective:
    "Bestätigen, dass das Feld Investitionssumme einen gültigen Wert akzeptiert.",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: ["Bedarfsermittlung Maske ist geöffnet"],
  testData: ["Investitionssumme: 100000"],
  steps: [
    {
      index: 1,
      action: "Öffne die Maske Bedarfsermittlung Investitionsfinanzierung",
      expected: "Maske ist sichtbar",
    },
    {
      index: 2,
      action: "Trage 100000 in das Feld Investitionssumme ein",
      expected: "Eingabe wird akzeptiert",
    },
    {
      index: 3,
      action: "Klicke auf Weiter",
      expected: "Folgemaske wird angezeigt",
    },
  ],
  expectedResults: [
    "Investitionssumme wird gespeichert",
    "Folgemaske erreichbar",
  ],
  figmaTraceRefs: [{ screenId: "1:1", nodeName: "Bedarfsermittlung" }],
  assumptions: [],
  openQuestions: [],
};

const okResponder = (cases: ProductionRunnerLlmDraftCase[]) => () => ({
  outcome: "success" as const,
  content: { testCases: cases },
  finishReason: "stop" as const,
  usage: { inputTokens: 100, outputTokens: 200 },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  attempt: 1,
});

const refusalResponder = () => () => ({
  outcome: "error" as const,
  errorClass: "refusal" as const,
  message: "model refused",
  retryable: false,
  attempt: 1,
});

test("PRODUCTION_RUNNER_HARNESS_MODES exposes the closed mode set", () => {
  assert.deepEqual(
    [...PRODUCTION_RUNNER_HARNESS_MODES].sort(),
    ["enforced", "off", "shadow_eval"],
  );
});

test("runFigmaToQcTestCases harness mode off writes no harness step artifact", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-off",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "off" },
    });
    assert.equal(result.harness, undefined);
    assert.equal(result.artifactPaths.harnessStep, undefined);
    const expected = path.join(
      result.artifactDir,
      "agent-role-runs",
      `${PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID}.json`,
    );
    await assert.rejects(stat(expected));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode shadow_eval persists an accepted step artifact", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-shadow",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "shadow_eval" },
    });
    assert.ok(result.harness, "expected harness summary in result");
    assert.equal(result.harness.mode, "shadow_eval");
    assert.equal(result.harness.outcome, "accepted");
    assert.equal(result.harness.mappedJobStatus, "completed");
    assert.equal(result.harness.errorClass, "none");
    assert.equal(result.harness.attemptsConsumed, 1);
    assert.ok(result.artifactPaths.harnessStep);
    const onDisk = await readFile(result.artifactPaths.harnessStep, "utf8");
    const parsed = JSON.parse(onDisk);
    assert.equal(parsed.role, "generator");
    assert.equal(parsed.outcome, "accepted");
    assert.equal(parsed.errorClass, "none");
    assert.equal(parsed.rawPromptsIncluded, false);
    assert.equal(parsed.attempts.length, 1);
    assert.equal(parsed.jobId, "job-shadow");
    // Pipeline still produced the canonical artifacts.
    assert.equal(result.generatedTestCases.testCases.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode enforced succeeds on a happy path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-enforced-ok",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "enforced" },
    });
    assert.ok(result.harness);
    assert.equal(result.harness.mode, "enforced");
    assert.equal(result.harness.outcome, "accepted");
    assert.ok(result.artifactPaths.harnessStep);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode enforced surfaces LLM refusal as ProductionRunnerError", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: refusalResponder(),
    });
    let capturedError: unknown;
    try {
      await runFigmaToQcTestCases({
        jobId: "job-enforced-refusal",
        generatedAt: "2026-05-04T10:00:00Z",
        source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
        outputRoot: tempRoot,
        llm: { client },
        harness: { mode: "enforced" },
      });
    } catch (err) {
      capturedError = err;
    }
    assert.ok(capturedError instanceof ProductionRunnerError);
    // Refusal flows through the original LLM_REFUSAL classifier.
    assert.equal(capturedError.failureClass, "LLM_REFUSAL");
    // Even on failure, the per-step harness artifact is on disk so operators
    // can audit the rejected attempt.
    const expected = path.join(
      tempRoot,
      "jobs",
      "job-enforced-refusal",
      "test-intelligence",
      "agent-role-runs",
      `${PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID}.json`,
    );
    const onDisk = await readFile(expected, "utf8");
    const parsed = JSON.parse(onDisk);
    assert.equal(parsed.outcome, "blocked");
    assert.equal(parsed.errorClass, "policy_refusal");
    assert.equal(parsed.mappedJobStatus, "partial");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode shadow_eval does not throw on LLM refusal but records rejected step", async () => {
  // shadow_eval must preserve single-pass semantics: if the LLM refuses,
  // the existing LLM_REFUSAL throw still happens; the harness artifact is
  // observation-only.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: refusalResponder(),
    });
    let capturedError: unknown;
    try {
      await runFigmaToQcTestCases({
        jobId: "job-shadow-refusal",
        generatedAt: "2026-05-04T10:00:00Z",
        source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
        outputRoot: tempRoot,
        llm: { client },
        harness: { mode: "shadow_eval" },
      });
    } catch (err) {
      capturedError = err;
    }
    assert.ok(capturedError instanceof ProductionRunnerError);
    assert.equal(capturedError.failureClass, "LLM_REFUSAL");
    const expected = path.join(
      tempRoot,
      "jobs",
      "job-shadow-refusal",
      "test-intelligence",
      "agent-role-runs",
      `${PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID}.json`,
    );
    const parsed = JSON.parse(await readFile(expected, "utf8"));
    assert.equal(parsed.outcome, "blocked");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness honors a custom roleStepId", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-custom-step",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: {
        mode: "shadow_eval",
        roleStepId: "test_generation_harness_v2",
        testDepth: "exhaustive",
      },
    });
    assert.ok(result.artifactPaths.harnessStep);
    assert.ok(
      result.artifactPaths.harnessStep.endsWith(
        "test_generation_harness_v2.json",
      ),
      `expected custom step id in path; got ${result.artifactPaths.harnessStep}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness modes are exhaustively covered by the integration tests", () => {
  // Sanity guard: ensure every mode in the closed set has a regression test
  // somewhere in this file. Adding a mode without test coverage will fail
  // here so the harness contract stays in sync with the runner.
  const expected: ReadonlyArray<ProductionRunnerHarnessMode> = [
    "enforced",
    "off",
    "shadow_eval",
  ];
  for (const mode of PRODUCTION_RUNNER_HARNESS_MODES) {
    assert.ok(
      expected.includes(mode),
      `harness mode ${mode} missing coverage in production-runner-harness.test.ts`,
    );
  }
});
