import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  PRODUCTION_RUNNER_FAILURE_CLASSES,
  ProductionRunnerError,
  runFigmaToQcTestCases,
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
  message: "model refused to respond",
  retryable: false,
  attempt: 1,
});

const schemaInvalidResponder = () => () => ({
  outcome: "success" as const,
  // Wrong shape: testCases must be an array of objects
  content: { testCases: "not an array" },
  finishReason: "stop" as const,
  usage: { inputTokens: 10, outputTokens: 10 },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  attempt: 1,
});

test("runFigmaToQcTestCases happy path persists artifacts and renders customer Markdown", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-123",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    assert.equal(result.jobId, "job-123");
    assert.equal(result.generatedTestCases.testCases.length, 1);
    const stamped = result.generatedTestCases.testCases[0];
    assert.ok(stamped);
    assert.equal(stamped.sourceJobId, "job-123");
    assert.equal(stamped.id.startsWith("tc-"), true);
    // Persisted artifact exists.
    const generatedJson = await readFile(
      result.artifactPaths.generatedTestCases,
      "utf8",
    );
    assert.match(generatedJson, /tc-/u);
    // Customer markdown was written.
    assert.ok(result.customerMarkdownPaths.combined.endsWith("testfaelle.md"));
    const md = await readFile(result.customerMarkdownPaths.combined, "utf8");
    assert.match(md, /Testfälle/u);
    assert.match(md, /Investitionssumme/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases returns EMPTY_FIGMA_INPUT when the document has no screens", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-empty",
          generatedAt: "2026-05-02T10:00:00Z",
          source: {
            kind: "figma_paste_normalized",
            file: {
              fileKey: "ABC",
              name: "Empty",
              document: node({ id: "0:0", type: "DOCUMENT", children: [] }),
            },
          },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "EMPTY_FIGMA_INPUT",
    );
    // Failure must not have called the LLM client.
    assert.equal(client.callCount(), 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases surfaces LLM_REFUSAL when the gateway returns a refusal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: refusalResponder(),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-refusal",
          generatedAt: "2026-05-02T10:00:00Z",
          source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "LLM_REFUSAL",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases surfaces LLM_RESPONSE_INVALID when the structured output is malformed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: schemaInvalidResponder(),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-bad",
          generatedAt: "2026-05-02T10:00:00Z",
          source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "LLM_RESPONSE_INVALID",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases stamped output validates against the strict GeneratedTestCaseList schema", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-validate",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    // Re-import the validator to assert independence of the runner.
    const { validateGeneratedTestCaseList } =
      await import("./generated-test-case-schema.js");
    const validation = validateGeneratedTestCaseList(result.generatedTestCases);
    assert.equal(
      validation.valid,
      true,
      `validation errors: ${JSON.stringify(validation.errors)}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases rejects an SSRF-flavoured Figma URL with FIGMA_URL_REJECTED", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-ssrf",
          generatedAt: "2026-05-02T10:00:00Z",
          source: {
            kind: "figma_url",
            figmaUrl: "https://evil.example.com/design/ABC/X",
            accessToken: "figd_test",
          },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "FIGMA_URL_REJECTED",
    );
    assert.equal(client.callCount(), 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("PRODUCTION_RUNNER_FAILURE_CLASSES is the closed set used by the runner", () => {
  // Sanity: make sure callers can branch on a stable enum.
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("EMPTY_FIGMA_INPUT"));
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("LLM_REFUSAL"));
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("LLM_RESPONSE_INVALID"));
});
