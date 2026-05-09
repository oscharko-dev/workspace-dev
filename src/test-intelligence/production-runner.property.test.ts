import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import type { LlmGatewayCapabilities } from "../contracts/index.js";
import { cloneEuBankingDefaultFinOpsBudget } from "./finops-budget.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  runFigmaToQcTestCases,
  type ProductionRunnerLlmDraftCase,
} from "./production-runner.js";
import type { FigmaRestNode } from "./figma-rest-adapter.js";

const TEST_GENERATION_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

const semanticTokenArb = fc.constantFrom(
  "Account",
  "Alert",
  "Balance",
  "Card",
  "Consent",
  "Details",
  "Form",
  "Invoice",
  "Login",
  "Payment",
  "Profile",
  "Review",
  "Summary",
  "Transfer",
  "Verify",
);

const semanticNameArb = fc
  .array(semanticTokenArb, { minLength: 1, maxLength: 3 })
  .map((tokens) => tokens.join(" "));

const hexStringArb = fc
  .array(fc.constantFrom("a", "b", "c", "d", "e", "f", "0", "1", "2", "3"), {
    minLength: 3,
    maxLength: 8,
  })
  .map((chars) => chars.join(""));

const fileModelArb = fc.record({
  fileKey: hexStringArb,
  fileName: semanticNameArb,
  screens: fc.array(
    fc.record({
      screenName: semanticNameArb,
      labels: fc.array(semanticNameArb, { minLength: 1, maxLength: 4 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

interface FileModel {
  fileKey: string;
  fileName: string;
  screens: Array<{ screenName: string; labels: string[] }>;
}

const buildFile = (model: FileModel) => ({
  fileKey: model.fileKey,
  name: model.fileName,
  document: node({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      node({
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        children: model.screens.map((screen, screenIndex) =>
          node({
            id: `1:${screenIndex + 1}`,
            name: screen.screenName,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 800 },
            children: screen.labels.map((label, labelIndex) =>
              node({
                id: `${screenIndex + 2}:${labelIndex + 1}`,
                name: label,
                type: labelIndex % 2 === 0 ? "TEXT" : "INSTANCE",
                characters: label,
              }),
            ),
          }),
        ),
      }),
    ],
  }),
});

const buildDraft = (
  screenId: string,
  screenName: string,
): ProductionRunnerLlmDraftCase => ({
  title: `Smoke ${screenName}`,
  objective: `Verify ${screenName} accepts valid operator input.`,
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [`${screenName} is visible`],
  testData: ["operator input"],
  steps: [
    {
      index: 1,
      action: `Open ${screenName}`,
      expected: `${screenName} is visible`,
    },
    {
      index: 2,
      action: "Submit valid input",
      expected: "Submission is accepted",
    },
  ],
  expectedResults: ["Request is accepted"],
  figmaTraceRefs: [{ screenId, nodeName: screenName }],
  assumptions: [],
  openQuestions: [],
});

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

test(
  "production runner property: random valid Figma payloads finish within the FinOps wall-clock cap",
  { concurrency: false },
  async () => {
  await fc.assert(
    fc.asyncProperty(fileModelArb, async (model) => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-prop-"));
      try {
        const firstScreen = model.screens[0]!;
        const client = createMockLlmGatewayClient({
          role: "test_generation",
          deployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          responder: () => ({
            outcome: "success" as const,
            content: {
              testCases: [buildDraft("1:1", firstScreen.screenName)],
            },
            finishReason: "stop" as const,
            usage: { inputTokens: 50, outputTokens: 75 },
            modelDeployment: "gpt-oss-120b-mock",
            modelRevision: "mock-1",
            gatewayRelease: "mock",
            attempt: 1,
          }),
        });
        const finopsBudget = cloneEuBankingDefaultFinOpsBudget();
        finopsBudget.maxJobWallClockMs = 5_000;

        const startedAt = Date.now();
        const result = await runFigmaToQcTestCases({
          jobId: "job-property-wall-clock",
          generatedAt: "2026-05-04T10:00:00Z",
          source: { kind: "figma_rest_file", file: buildFile(model) },
          outputRoot: tempRoot,
          llm: { client },
          finopsBudget,
        });
        const elapsedMs = Date.now() - startedAt;

        assert.equal(result.generatedTestCases.testCases.length, 1);
        assert.ok(
          elapsedMs <= finopsBudget.maxJobWallClockMs,
          `elapsed ${elapsedMs}ms exceeds cap ${finopsBudget.maxJobWallClockMs}ms`,
        );
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }),
    { numRuns: 12 },
  );
  },
);

test(
  "production runner property: replay hits produce byte-identical artifact hashes for the same input and cache state",
  { concurrency: false },
  async () => {
  await fc.assert(
    fc.asyncProperty(fileModelArb, async (model) => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-prop-"));
      try {
        const firstScreen = model.screens[0]!;
        const client = createMockLlmGatewayClient({
          role: "test_generation",
          deployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          responder: () => ({
            outcome: "success" as const,
            content: {
              testCases: [buildDraft("1:1", firstScreen.screenName)],
            },
            finishReason: "stop" as const,
            usage: { inputTokens: 50, outputTokens: 75 },
            modelDeployment: "gpt-oss-120b-mock",
            modelRevision: "mock-1",
            gatewayRelease: "mock",
            attempt: 1,
          }),
        });
        const run = async () =>
          await runFigmaToQcTestCases({
            jobId: "job-property-replay",
            generatedAt: "2026-05-04T10:00:00Z",
            source: { kind: "figma_rest_file", file: buildFile(model) },
            outputRoot: tempRoot,
            llm: { client },
          });

        await run();
        const second = await run();
        const secondHashes = {
          compiledPrompt: await sha256File(second.artifactPaths.compiledPrompt),
          generatedTestCases: await sha256File(
            second.artifactPaths.generatedTestCases,
          ),
          validationReport: await sha256File(
            second.artifactPaths.validationReport,
          ),
          policyReport: await sha256File(second.artifactPaths.policyReport),
          coverageReport: await sha256File(second.artifactPaths.coverageReport),
        };
        const third = await run();
        const thirdHashes = {
          compiledPrompt: await sha256File(third.artifactPaths.compiledPrompt),
          generatedTestCases: await sha256File(
            third.artifactPaths.generatedTestCases,
          ),
          validationReport: await sha256File(
            third.artifactPaths.validationReport,
          ),
          policyReport: await sha256File(third.artifactPaths.policyReport),
          coverageReport: await sha256File(third.artifactPaths.coverageReport),
        };

        if (JSON.stringify(secondHashes) !== JSON.stringify(thirdHashes)) {
          throw new Error(
            `replay artifact hashes diverged: ${JSON.stringify({ secondHashes, thirdHashes })}`,
          );
        }
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }),
    { numRuns: 10 },
  );
  },
);
