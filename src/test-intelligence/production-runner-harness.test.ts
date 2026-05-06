import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { LlmGatewayCapabilities } from "../contracts/index.js";
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
  figmaTraceRefs: [
    { screenId: "1:1", nodeId: "2:1", nodeName: "Bedarfsermittlung" },
  ],
  assumptions: [],
  openQuestions: [],
  // Issue #1901 — populated coverage signals so the logic-judge
  // coverage hard-gate stays green and the harness tests can
  // assert on the LLM verdict rather than on hard-gate findings.
  qualitySignals: {
    coveredFieldIds: ["1:1::field::2:1"],
    coveredActionIds: ["1:1::action::2:2"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
};

const SAMPLE_ACCESSIBILITY_DRAFT: ProductionRunnerLlmDraftCase = {
  ...SAMPLE_DRAFT,
  title: "Formular ist per Tastatur bedienbar",
  objective:
    "Bestätigen, dass die Bedarfsermittlung ohne Maus vollständig bedienbar ist.",
  type: "accessibility",
  technique: "exploratory",
  testData: [],
  steps: [
    {
      index: 1,
      action: "Navigiere ausschließlich per Tastatur durch die Maske",
      expected: "Alle interaktiven Elemente erhalten einen sichtbaren Fokus",
    },
    {
      index: 2,
      action: "Aktiviere die Schaltfläche Weiter per Tastatur",
      expected: "Die Folgemaske wird ohne Maus geöffnet",
    },
  ],
  expectedResults: [
    "Die Formularfelder sind in sinnvoller Reihenfolge erreichbar",
    "Weiter ist per Tastatur auslösbar",
  ],
};

const SEEDED_TEST_GENERATION_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const okResponder =
  (cases: ProductionRunnerLlmDraftCase[]) =>
  (request: { responseSchemaName?: string }, attempt: number) => {
    if (request.responseSchemaName === "workspace-dev-logic-judge-v1") {
      return {
        outcome: "success" as const,
        content: {
          verdict: "accept",
          findings: [],
          repairInstructions: [],
        },
        finishReason: "stop" as const,
        usage: { inputTokens: 20, outputTokens: 10 },
        modelDeployment: "gpt-oss-120b-mock",
        modelRevision: "mock-1",
        gatewayRelease: "mock",
        attempt,
      };
    }
    return {
      outcome: "success" as const,
      content: { testCases: cases },
      finishReason: "stop" as const,
      usage: { inputTokens: 100, outputTokens: 200 },
      modelDeployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      attempt,
    };
  };

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
      // This test focuses on shadow_eval harness routing for the
      // generator-only path. Logic-Judge integration is exercised in
      // logic-judge.test.ts; opt out here to keep the assertions
      // narrow.
      logicJudge: { enabled: false },
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
      // Generator-only happy-path test. Logic-Judge default-on
      // semantics covered separately in logic-judge.test.ts.
      logicJudge: { enabled: false },
    });
    assert.ok(result.harness);
    assert.equal(result.harness.mode, "enforced");
    assert.equal(result.harness.outcome, "accepted");
    assert.ok(result.artifactPaths.harnessStep);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode shadow_eval persists an accepted step artifact for dual-pass generation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      declaredCapabilities: SEEDED_TEST_GENERATION_CAPS,
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-shadow-dual-pass",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "shadow_eval" },
      generation: { diversityPasses: 2 },
      logicJudge: { enabled: false },
    });
    assert.ok(result.harness, "expected harness summary in result");
    assert.equal(result.harness.mode, "shadow_eval");
    assert.equal(result.harness.outcome, "accepted");
    assert.equal(result.harness.mappedJobStatus, "completed");
    assert.equal(result.harness.errorClass, "none");
    assert.ok(result.artifactPaths.harnessStep);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases harness mode enforced blocks when the logic judge rejects the generated cases", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-harness-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      // Issue #1928: a Logic-Judge `reject` triggers the bounded
      // repair loop. Issue #1939: when the post-repair logic-judge
      // verdict signature is identical to the initial pass, the loop
      // aborts early with `convergence_stalled` (instead of running
      // out the iteration cap) and the harness records that
      // explicitly via the new `convergence_stalled` errorClass. The
      // mock here returns a `reject` envelope whose finding refers to
      // a `tc-1` id that the production-runner never stamps, so the
      // logic-judge schema validator deterministically falls back to
      // a schema-repair `repair` verdict on every pass — yielding
      // identical signatures across iterations and exercising the
      // stall path end-to-end.
      responder: (request, attempt) => {
        if (request.responseSchemaName === "workspace-dev-logic-judge-v1") {
          return {
            outcome: "success" as const,
            content: {
              verdict: "reject",
              findings: [
                {
                  testCaseId: "tc-1",
                  code: "traceability_missing",
                  severity: "error",
                  message:
                    "The generated cases do not cover the expected path.",
                },
              ],
              repairInstructions: [],
            },
            finishReason: "stop" as const,
            usage: { inputTokens: 12, outputTokens: 6 },
            modelDeployment: "gpt-oss-120b-mock",
            modelRevision: "mock-1",
            gatewayRelease: "mock",
            attempt,
          };
        }
        return okResponder([SAMPLE_DRAFT])(request, attempt);
      },
    });
    let capturedError: unknown;
    try {
      await runFigmaToQcTestCases({
        jobId: "job-enforced-judge-reject",
        generatedAt: "2026-05-05T10:00:00Z",
        source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
        outputRoot: tempRoot,
        llm: { client },
        harness: { mode: "enforced" },
      });
    } catch (err) {
      capturedError = err;
    }
    assert.ok(capturedError instanceof ProductionRunnerError);
    assert.equal(capturedError.failureClass, "LLM_GATEWAY_FAILED");
    const expected = path.join(
      tempRoot,
      "jobs",
      "job-enforced-judge-reject",
      "test-intelligence",
      "agent-role-runs",
      `${PRODUCTION_RUNNER_HARNESS_ROLE_STEP_ID}.json`,
    );
    const onDisk = await readFile(expected, "utf8");
    const parsed = JSON.parse(onDisk);
    assert.equal(parsed.outcome, "failed_permanent");
    // Issue #1939: identical signatures across iterations now surface
    // as `convergence_stalled` instead of the generic
    // `judge_rejection`.
    assert.equal(parsed.errorClass, "convergence_stalled");
    assert.equal(parsed.attempts.length, 1);

    // Issue #1939: a stall must produce a top-level
    // `repair-loop-trace.json` artifact for operator audit.
    const tracePath = path.join(
      tempRoot,
      "jobs",
      "job-enforced-judge-reject",
      "test-intelligence",
      "repair-loop-trace.json",
    );
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as {
      outcome: string;
      stallDetectedAtIteration: number;
      iterations: ReadonlyArray<{
        readonly iteration: number;
        readonly verdictSignature: string;
      }>;
    };
    assert.equal(trace.outcome, "convergence_stalled");
    assert.equal(trace.stallDetectedAtIteration, 1);
    assert.equal(
      trace.iterations[0]!.verdictSignature,
      trace.iterations[1]!.verdictSignature,
    );
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
    assert.equal(parsed.outcome, "failed_permanent");
    assert.equal(parsed.errorClass, "policy_refusal");
    assert.equal(parsed.mappedJobStatus, "failed");
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
    assert.equal(parsed.outcome, "failed_permanent");
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

// ---------------------------------------------------------------------------
// Issue #1900: production-runner repair-loop wiring
// ---------------------------------------------------------------------------

test("runFigmaToQcTestCases drives the repair loop when the logic-judge initially asks for repair", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-repair-"));
  try {
    let logicCallIndex = 0;
    let generatorCallIndex = 0;
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: (request, attempt) => {
        if (request.responseSchemaName === "workspace-dev-logic-judge-v1") {
          logicCallIndex += 1;
          // First logic-judge call (initial pass) → repair.
          // Subsequent calls (repair iterations) → accept.
          if (logicCallIndex === 1) {
            return {
              outcome: "success" as const,
              content: {
                verdict: "repair",
                findings: [
                  {
                    testCaseId: "$job",
                    code: "coverage_gap",
                    severity: "warning",
                    message: "coveredFieldIds is empty",
                  },
                ],
                repairInstructions: [
                  {
                    testCaseId: "$job",
                    path: "qualitySignals.coveredFieldIds",
                    instruction: "Populate coveredFieldIds with cited IR ids.",
                  },
                ],
              },
              finishReason: "stop" as const,
              usage: { inputTokens: 20, outputTokens: 10 },
              modelDeployment: "gpt-oss-120b-mock",
              modelRevision: "mock-1",
              gatewayRelease: "mock",
              attempt,
            };
          }
          return {
            outcome: "success" as const,
            content: {
              verdict: "accept",
              findings: [],
              repairInstructions: [],
            },
            finishReason: "stop" as const,
            usage: { inputTokens: 20, outputTokens: 10 },
            modelDeployment: "gpt-oss-120b-mock",
            modelRevision: "mock-1",
            gatewayRelease: "mock",
            attempt,
          };
        }
        generatorCallIndex += 1;
        return {
          outcome: "success" as const,
          content: {
            testCases: [SAMPLE_DRAFT, SAMPLE_ACCESSIBILITY_DRAFT],
          },
          finishReason: "stop" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          modelDeployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          attempt,
        };
      },
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-repair-loop",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "shadow_eval", maxRepairIterations: 2 },
    });
    assert.ok(result.repairLoop, "expected repair-loop summary");
    assert.equal(result.repairLoop.outcome, "accepted");
    assert.equal(result.repairLoop.repairIterationCount, 1);
    assert.equal(result.repairLoop.iterations.length, 2);
    assert.equal(generatorCallIndex, 2, "expected generator to run twice");
    const plannerArtifact = path.join(
      result.artifactDir,
      "agent-role-runs",
      "repair_planner_iter_1.json",
    );
    const generatorArtifact = path.join(
      result.artifactDir,
      "agent-role-runs",
      "test_generation_repair_iter_1.json",
    );
    const plannerPayload = JSON.parse(await readFile(plannerArtifact, "utf8"));
    const generatorPayload = JSON.parse(
      await readFile(generatorArtifact, "utf8"),
    );
    assert.equal(plannerPayload.iteration, 1);
    assert.equal(plannerPayload.outputs.repairInstructionCount, 1);
    assert.equal(generatorPayload.iteration, 1);
    assert.equal(generatorPayload.llmGateway.outcome, "success");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases skips the repair loop entirely on a clean accept verdict", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-repair-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT, SAMPLE_ACCESSIBILITY_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-no-repair",
      generatedAt: "2026-05-04T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "shadow_eval" },
    });
    assert.equal(result.repairLoop, undefined);
    await assert.rejects(
      stat(
        path.join(
          result.artifactDir,
          "agent-role-runs",
          "repair_planner_iter_1.json",
        ),
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Issue #1928: Logic-Judge `reject` must drive the repair loop instead of
// short-circuiting the runner. Live runs showed `reject` is the dominant
// verdict on recoverable structured-output schema violations; gating the
// loop on `repair`-only verdicts silently disabled recovery.
// ---------------------------------------------------------------------------

test("runFigmaToQcTestCases drives the repair loop when the initial Logic-Judge verdict is repair and recovers post-repair (Issue #1928)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-repair-"));
  try {
    // Issue #1905 form-screen a11y hard-gate requires an accessibility
    // case anchored to every form screen; include one so the post-LLM
    // hard-gate does not upgrade the LLM `accept` verdict back to
    // `repair` and confound the assertion that the runner converges.
    const SAMPLE_A11Y_DRAFT: ProductionRunnerLlmDraftCase = {
      ...SAMPLE_DRAFT,
      title: "Bedarfsermittlung — Tastatur- und Screenreader-A11y",
      objective:
        "Bestätigen, dass die Maske Bedarfsermittlung Tastatur- und Screenreader-Zugriff unterstützt.",
      type: "accessibility",
    };
    let logicCallIndex = 0;
    let generatorCallIndex = 0;
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: (request, attempt) => {
        if (request.responseSchemaName === "workspace-dev-logic-judge-v1") {
          logicCallIndex += 1;
          // Initial pass → repair (e.g. recoverable schema violation).
          // Repair iteration → accept once the regenerator re-runs.
          if (logicCallIndex === 1) {
            return {
              outcome: "success" as const,
              content: {
                verdict: "repair",
                findings: [
                  {
                    testCaseId: "$job",
                    code: "schema_violation",
                    severity: "error",
                    message:
                      "qualitySignals.coveredFieldIds emitted as object instead of array.",
                  },
                ],
                repairInstructions: [
                  {
                    testCaseId: "$job",
                    path: "$.qualitySignals.coveredFieldIds",
                    instruction:
                      "Emit coveredFieldIds as an array of cited IR ids.",
                  },
                ],
              },
              finishReason: "stop" as const,
              usage: { inputTokens: 20, outputTokens: 10 },
              modelDeployment: "gpt-oss-120b-mock",
              modelRevision: "mock-1",
              gatewayRelease: "mock",
              attempt,
            };
          }
          return {
            outcome: "success" as const,
            content: {
              verdict: "accept",
              findings: [],
              repairInstructions: [],
            },
            finishReason: "stop" as const,
            usage: { inputTokens: 20, outputTokens: 10 },
            modelDeployment: "gpt-oss-120b-mock",
            modelRevision: "mock-1",
            gatewayRelease: "mock",
            attempt,
          };
        }
        generatorCallIndex += 1;
        return {
          outcome: "success" as const,
          content: { testCases: [SAMPLE_DRAFT, SAMPLE_A11Y_DRAFT] },
          finishReason: "stop" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          modelDeployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          attempt,
        };
      },
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-repair-loop-on-repair",
      generatedAt: "2026-05-06T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      harness: { mode: "shadow_eval", maxRepairIterations: 2 },
    });
    assert.ok(
      result.repairLoop,
      "expected repair-loop summary even when initial verdict was repair",
    );
    assert.equal(result.repairLoop.outcome, "accepted");
    assert.equal(result.repairLoop.repairIterationCount, 1);
    assert.equal(result.repairLoop.iterations.length, 2);
    assert.equal(result.repairLoop.iterations[0]!.logicVerdict, "repair");
    assert.equal(result.repairLoop.iterations[1]!.logicVerdict, "accept");
    assert.equal(
      result.logicJudge.verdict.verdict,
      "accept",
      "final logicJudge verdict must reflect post-repair state",
    );
    assert.equal(
      generatorCallIndex,
      2,
      "expected the regenerator to run once after the initial repair verdict",
    );
    assert.equal(logicCallIndex, 2);
    assert.equal(result.blocked, false);
    const plannerArtifact = path.join(
      result.artifactDir,
      "agent-role-runs",
      "repair_planner_iter_1.json",
    );
    const generatorArtifact = path.join(
      result.artifactDir,
      "agent-role-runs",
      "test_generation_repair_iter_1.json",
    );
    const plannerPayload = JSON.parse(await readFile(plannerArtifact, "utf8"));
    assert.equal(plannerPayload.iteration, 1);
    assert.equal(plannerPayload.outputs.repairInstructionCount, 1);
    const generatorPayload = JSON.parse(
      await readFile(generatorArtifact, "utf8"),
    );
    assert.equal(generatorPayload.iteration, 1);
    assert.equal(generatorPayload.llmGateway.outcome, "success");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
