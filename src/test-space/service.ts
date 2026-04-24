import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceFigmaSourceMode,
  WorkspaceTestSpaceCase,
  WorkspaceTestSpaceCoverageFinding,
  WorkspaceTestSpaceMarkdownArtifact,
  WorkspaceTestSpaceQcMappingDraft,
  WorkspaceTestSpaceRun,
  WorkspaceTestSpaceRunRequest,
  WorkspaceTestSpaceRunRequestSummary,
} from "../contracts/index.js";
import { MAX_SUBMIT_BODY_BYTES } from "../server/constants.js";
import { DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT } from "./constants.js";
import { renderWorkspaceTestSpaceMarkdown } from "./markdown.js";
import {
  createDisabledWorkspaceTestSpaceQcConnector,
  type WorkspaceTestSpaceQcConnector,
} from "./qc.js";
import { hasSymlinkInPath, isWithinRoot } from "../job-engine/preview.js";
import {
  TestSpaceLlmOutputSchema,
  TestSpaceRunRequestSchema,
  formatTestSpaceValidationError,
} from "./validation.js";

type AuditLevel = "debug" | "info" | "warn" | "error";

interface WorkspaceTestSpaceAuditEvent {
  at: string;
  level: AuditLevel;
  event: string;
  message: string;
  runId: string;
}

interface WorkspaceTestSpaceFigmaSummary extends Record<string, unknown> {
  sourceMode: WorkspaceFigmaSourceMode;
  sourceKind: "payload" | "file";
  sourceLocator: {
    figmaFileKey?: string;
    figmaNodeId?: string;
    figmaJsonPathPresent: boolean;
    figmaJsonPathBasename?: string;
    hasFigmaAccessToken: boolean;
  };
  nodeCount: number;
  frameCount: number;
  textNodeCount: number;
  componentCount: number;
  screenCount: number;
  maxDepth: number;
  topLevelNames: string[];
  sampleNodeNames: string[];
  sampleText: string[];
}

interface StoredInputArtifact {
  runId: string;
  createdAt: string;
  modelDeployment: string;
  request: WorkspaceTestSpaceRunRequestSummary;
}

interface StoredGeneratedArtifact {
  runId: string;
  createdAt: string;
  updatedAt: string;
  modelDeployment: string;
  figmaSummary: WorkspaceTestSpaceFigmaSummary;
  testCases: WorkspaceTestSpaceCase[];
  coverageFindings: WorkspaceTestSpaceCoverageFinding[];
  qcMappingDraft: WorkspaceTestSpaceQcMappingDraft;
}

export interface WorkspaceTestSpaceLlmClient {
  generateStructuredOutput({
    modelDeployment,
    prompt,
    request,
    figmaSummary,
  }: {
    modelDeployment: string;
    prompt: string;
    request: WorkspaceTestSpaceRunRequestSummary;
    figmaSummary: WorkspaceTestSpaceFigmaSummary;
  }): Promise<unknown>;
}

export interface WorkspaceTestSpaceService {
  createRun(request: WorkspaceTestSpaceRunRequest): Promise<WorkspaceTestSpaceRun>;
  getRun(runId: string): Promise<WorkspaceTestSpaceRun | undefined>;
  getRunTestCases(
    runId: string,
  ): Promise<
    | {
        runId: string;
        createdAt: string;
        updatedAt: string;
        modelDeployment: string;
        testCases: WorkspaceTestSpaceCase[];
        coverageFindings: WorkspaceTestSpaceCoverageFinding[];
        qcMappingDraft: WorkspaceTestSpaceQcMappingDraft;
      }
    | undefined
  >;
  getRunMarkdown(runId: string): Promise<string | undefined>;
}

export interface WorkspaceTestSpaceError extends Error {
  statusCode: number;
  payload: {
    error: string;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

export function isWorkspaceTestSpaceError(
  error: unknown,
): error is WorkspaceTestSpaceError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as Partial<WorkspaceTestSpaceError>;
  return (
    typeof candidate.statusCode === "number" &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null &&
    typeof candidate.payload.error === "string" &&
    typeof candidate.payload.message === "string"
  );
}

function createWorkspaceTestSpaceError({
  statusCode,
  payload,
}: {
  statusCode: number;
  payload: WorkspaceTestSpaceError["payload"];
}): WorkspaceTestSpaceError {
  return Object.assign(new Error(payload.message), {
    statusCode,
    payload,
  });
}

function ensureAbsoluteRoot(rootPath: string): string {
  return path.resolve(rootPath);
}

function ensureRunId(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) {
    throw createWorkspaceTestSpaceError({
      statusCode: 400,
      payload: {
        error: "INVALID_RUN_ID",
        message: `Invalid Test Space run ID '${runId}'.`,
      },
    });
  }
  return runId;
}

function isJsonObjectOrArray(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === "object" || Array.isArray(value))
  );
}

function createInternalWorkspaceTestSpaceError(): WorkspaceTestSpaceError {
  return createWorkspaceTestSpaceError({
    statusCode: 500,
    payload: {
      error: "INTERNAL_ERROR",
      message: "Test Space run failed.",
    },
  });
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAtomicTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function writeAtomicJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeAtomicTextFile(filePath, stableJson(value));
}

function resolveRunArtifacts({
  absoluteOutputRoot,
  runId,
}: {
  absoluteOutputRoot: string;
  runId: string;
}): {
  root: string;
  inputJson: string;
  figmaSummaryJson: string;
  llmRequestRedactedJson: string;
  llmResponseRawJson: string;
  testCasesJson: string;
  testCasesMarkdown: string;
  auditLogJsonl: string;
} {
  const resolvedRoot = ensureAbsoluteRoot(absoluteOutputRoot);
  const normalizedRunId = ensureRunId(runId);
  const root = path.join(resolvedRoot, "test-space", "runs", normalizedRunId);
  if (!isWithinRoot({ candidatePath: root, rootPath: resolvedRoot })) {
    throw createWorkspaceTestSpaceError({
      statusCode: 400,
      payload: {
        error: "INVALID_RUN_PATH",
        message: "Resolved Test Space run path escaped the output root.",
      },
    });
  }

  return {
    root,
    inputJson: path.join(root, "input.json"),
    figmaSummaryJson: path.join(root, "figma-summary.json"),
    llmRequestRedactedJson: path.join(root, "llm-request.redacted.json"),
    llmResponseRawJson: path.join(root, "llm-response.raw.json"),
    testCasesJson: path.join(root, "test-cases.generated.json"),
    testCasesMarkdown: path.join(root, "test-cases.md"),
    auditLogJsonl: path.join(root, "audit-log.jsonl"),
  };
}

function collectFigmaSummary({
  request,
  parsedJson,
  sourceKind,
}: {
  request: WorkspaceTestSpaceRunRequest;
  parsedJson: unknown;
  sourceKind: "payload" | "file";
}): WorkspaceTestSpaceFigmaSummary {
  const topLevelNames: string[] = [];
  const sampleNodeNames: string[] = [];
  const sampleText: string[] = [];
  let nodeCount = 0;
  let frameCount = 0;
  let textNodeCount = 0;
  let componentCount = 0;
  let screenCount = 0;
  let maxDepth = 0;

  const visit = (value: unknown, depth: number, isTopLevel: boolean): void => {
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    maxDepth = Math.max(maxDepth, depth);

    const type = typeof record.type === "string" ? record.type.trim() : "";
    const name =
      typeof record.name === "string"
        ? redactWorkspaceTestSpaceSampleText(record.name)
        : "";
    const characters =
      typeof record.characters === "string"
        ? redactWorkspaceTestSpaceSampleText(record.characters)
        : "";

    if (type.length > 0) {
      nodeCount += 1;
      if (sampleNodeNames.length < 8 && name.length > 0) {
        sampleNodeNames.push(name);
      }
      if (type.toLowerCase() === "text") {
        textNodeCount += 1;
        if (sampleText.length < 4 && characters.length > 0) {
          sampleText.push(characters.slice(0, 120));
        }
      }
      if (
        type.toLowerCase() === "frame" ||
        type.toLowerCase() === "component" ||
        type.toLowerCase() === "section"
      ) {
        frameCount += 1;
      }
      if (
        type.toLowerCase() === "component" ||
        type.toLowerCase() === "componentset" ||
        type.toLowerCase() === "instance" ||
        typeof record.componentId === "string"
      ) {
        componentCount += 1;
      }
      if (isTopLevel && name.length > 0) {
        topLevelNames.push(name);
      }
    }

    if (Array.isArray(record.children)) {
      if (isTopLevel && record.children.length > 0) {
        screenCount += 1;
      }
      for (const child of record.children) {
        visit(child, depth + 1, false);
      }
    }
  };

  visit(parsedJson, 1, true);

  return {
    sourceMode: request.figmaSourceMode,
    sourceKind,
    sourceLocator: {
      ...(request.figmaFileKey !== undefined ? { figmaFileKey: request.figmaFileKey } : {}),
      ...(request.figmaNodeId !== undefined ? { figmaNodeId: request.figmaNodeId } : {}),
      figmaJsonPathPresent: request.figmaJsonPath !== undefined,
      ...(request.figmaJsonPath !== undefined
        ? { figmaJsonPathBasename: path.basename(request.figmaJsonPath) }
        : {}),
      hasFigmaAccessToken: request.figmaAccessToken !== undefined,
    },
    nodeCount,
    frameCount,
    textNodeCount,
    componentCount,
    screenCount,
    maxDepth,
    topLevelNames: topLevelNames.slice(0, 8),
    sampleNodeNames,
    sampleText,
  };
}

function buildLocalTestCases({
  request,
  figmaSummary,
}: {
  request: WorkspaceTestSpaceRunRequestSummary;
  figmaSummary: WorkspaceTestSpaceFigmaSummary;
}): {
  testCases: WorkspaceTestSpaceCase[];
  coverageFindings: WorkspaceTestSpaceCoverageFinding[];
} {
  const subject =
    figmaSummary.topLevelNames[0] ??
    request.businessContext.productName ??
    request.businessContext.summary;
  const primaryLabel = subject.length > 0 ? subject : "the business flow";
  const goals = request.businessContext.goals ?? [];
  const goal = goals[0] ?? request.businessContext.summary;
  const screenCountLabel =
    figmaSummary.screenCount > 0
      ? `${figmaSummary.screenCount} screen(s)`
      : "no explicit screens";

  const testCases: WorkspaceTestSpaceCase[] = [
    {
      id: "TC-001",
      title: `Happy path for ${primaryLabel}`,
      priority: "P0",
      type: "happy_path",
      preconditions: [
        `Business goal: ${goal}`,
        `Figma source: ${request.figmaSourceMode}`,
      ],
      steps: [
        {
          order: 1,
          action: `Open the primary ${primaryLabel} entry point.`,
          expectedResult: "The user sees the expected starting state.",
        },
        {
          order: 2,
          action: "Complete the primary business action end-to-end.",
          expectedResult: "The workflow advances without blocking errors.",
        },
        {
          order: 3,
          action: "Confirm the success state, confirmation, or next step.",
          expectedResult: "The user reaches the intended business outcome.",
        },
      ],
      expectedResult: "The primary business journey completes successfully.",
      coverageTags: ["happy-path", "business-flow", "smoke"],
    },
    {
      id: "TC-002",
      title: `Validation and guardrails for ${primaryLabel}`,
      priority: "P1",
      type: "validation",
      preconditions: ["The flow is available to a standard user."],
      steps: [
        {
          order: 1,
          action: "Submit an empty or incomplete input set.",
          expectedResult: "Validation feedback prevents the invalid action.",
        },
        {
          order: 2,
          action: "Correct the input and resubmit.",
          expectedResult: "The workflow accepts the corrected request.",
        },
      ],
      expectedResult: "Invalid inputs are rejected and corrected inputs proceed.",
      coverageTags: ["validation", "negative", "error-handling"],
    },
    {
      id: "TC-003",
      title: `Regression coverage across ${screenCountLabel}`,
      priority: "P1",
      type: "regression",
      preconditions: [
        "The core UI states from the provided Figma summary are available.",
      ],
      steps: [
        {
          order: 1,
          action: "Navigate through the main screens or frames.",
          expectedResult: "Each screen preserves its intended structure and labels.",
        },
        {
          order: 2,
          action: "Repeat the journey after a refresh or back navigation.",
          expectedResult: "The flow remains stable and deterministic.",
        },
      ],
      expectedResult:
        "The core journey remains stable across the summarized screens.",
      coverageTags: ["regression", "navigation", "consistency"],
    },
  ];

  const coverageFindings: WorkspaceTestSpaceCoverageFinding[] = [
    {
      id: "CF-001",
      severity: figmaSummary.screenCount > 0 ? "low" : "medium",
      message:
        figmaSummary.screenCount > 0
          ? `The summary exposes ${figmaSummary.screenCount} screen(s); make sure each receives both happy-path and negative coverage.`
          : "No explicit screen metadata was derived from the supplied Figma input.",
      recommendation:
        figmaSummary.screenCount > 0
          ? "Map each summarized screen to at least one positive and one negative test case."
          : "Provide a local Figma JSON payload or path with frame/screen names so coverage can be anchored to concrete UI states.",
      relatedCaseIds: ["TC-001", "TC-002"],
    },
    {
      id: "CF-002",
      severity: figmaSummary.componentCount > 0 ? "low" : "medium",
      message:
        figmaSummary.componentCount > 0
          ? `Detected ${figmaSummary.componentCount} component-like node(s) in the summary.`
          : "No component-like nodes were detected in the supplied input.",
      recommendation:
        figmaSummary.componentCount > 0
          ? "Review component-state permutations, copy variations, and error states for the summarized UI."
          : "Add component-level metadata to the local Figma input so UI-state permutations can be derived automatically.",
      relatedCaseIds: ["TC-003"],
    },
  ];

  return {
    testCases,
    coverageFindings,
  };
}

function buildLlmPrompt({
  request,
  figmaSummary,
}: {
  request: WorkspaceTestSpaceRunRequestSummary;
  figmaSummary: WorkspaceTestSpaceFigmaSummary;
}): string {
  return [
    "You generate deterministic business test cases from a Figma summary and business context.",
    "Return valid JSON with keys testCases and coverageFindings only.",
    "Use priorities P0, P1, or P2.",
    "Use test case types happy_path, validation, edge_case, or regression.",
    `Business context: ${request.businessContext.summary}`,
    `Figma source mode: ${request.figmaSourceMode}`,
    `Top-level names: ${figmaSummary.topLevelNames.length > 0 ? figmaSummary.topLevelNames.join(", ") : "none"}`,
    `Screen count: ${figmaSummary.screenCount}`,
  ].join("\n");
}

function createWorkspaceTestSpaceRequestSummary(
  request: WorkspaceTestSpaceRunRequest,
): WorkspaceTestSpaceRunRequestSummary {
  return {
    figmaSourceMode: request.figmaSourceMode,
    ...(request.figmaFileKey !== undefined
      ? { figmaFileKey: request.figmaFileKey }
      : {}),
    ...(request.figmaNodeId !== undefined
      ? { figmaNodeId: request.figmaNodeId }
      : {}),
    figmaJsonPayloadPresent: request.figmaJsonPayload !== undefined,
    ...(request.figmaJsonPayload !== undefined
      ? {
          figmaJsonPayloadSha256: createHash("sha256")
            .update(request.figmaJsonPayload)
            .digest("hex"),
        }
      : {}),
    figmaJsonPathPresent: request.figmaJsonPath !== undefined,
    ...(request.figmaJsonPath !== undefined
      ? { figmaJsonPathBasename: path.basename(request.figmaJsonPath) }
      : {}),
    ...(request.testSuiteName !== undefined
      ? { testSuiteName: request.testSuiteName }
      : {}),
    businessContext: request.businessContext,
  };
}

function redactWorkspaceTestSpaceSampleText(value: string): string {
  const trimmed = value.trim().replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (trimmed.length === 0) {
    return "";
  }
  if (
    /<\s*script\b/i.test(trimmed) ||
    /[<>]/.test(trimmed) ||
    /\b(?:secret|token|password|api[_-]?key|bearer)\b/i.test(trimmed)
  ) {
    return "[redacted]";
  }
  return trimmed.slice(0, 120);
}

function countLines(value: string): number {
  return value.split(/\r?\n/).length;
}

function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  return readFile(filePath, "utf8")
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined);
}

export function createWorkspaceTestSpaceService({
  absoluteOutputRoot,
  workspaceRoot = process.cwd(),
  llmClient,
  qcConnector = createDisabledWorkspaceTestSpaceQcConnector(),
  modelDeployment = DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT,
  now = () => new Date().toISOString(),
}: {
  absoluteOutputRoot: string;
  workspaceRoot?: string;
  llmClient?: WorkspaceTestSpaceLlmClient;
  qcConnector?: WorkspaceTestSpaceQcConnector;
  modelDeployment?: string;
  now?: () => string;
}): WorkspaceTestSpaceService {
  const resolvedOutputRoot = ensureAbsoluteRoot(absoluteOutputRoot);
  const resolvedWorkspaceRoot = ensureAbsoluteRoot(workspaceRoot);

  const resolveLocalSourcePath = (sourcePath: string): string => {
    const candidatePath = path.isAbsolute(sourcePath)
      ? path.normalize(sourcePath)
      : path.resolve(resolvedWorkspaceRoot, sourcePath);
    if (!isWithinRoot({ candidatePath, rootPath: resolvedWorkspaceRoot })) {
      throw createWorkspaceTestSpaceError({
        statusCode: 403,
        payload: {
          error: "FORBIDDEN_PATH",
          message: "Test Space source files must stay within the workspace root.",
        },
      });
    }
    return candidatePath;
  };

  const loadSourceJson = async (
    request: WorkspaceTestSpaceRunRequest,
  ): Promise<{ sourceKind: "payload" | "file"; parsedJson: unknown }> => {
    if (request.figmaJsonPayload !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(request.figmaJsonPayload) as unknown;
      } catch {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "figmaJsonPayload must contain valid JSON.",
          },
        });
      }
      if (!isJsonObjectOrArray(parsed)) {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "figmaJsonPayload must contain a JSON object or array.",
          },
        });
      }
      return { sourceKind: "payload", parsedJson: parsed };
    }

    if (request.figmaJsonPath !== undefined) {
      const absolutePath = resolveLocalSourcePath(request.figmaJsonPath);
      if (
        await hasSymlinkInPath({
          candidatePath: absolutePath,
          rootPath: resolvedWorkspaceRoot,
        })
      ) {
        throw createWorkspaceTestSpaceError({
          statusCode: 403,
          payload: {
            error: "FORBIDDEN_PATH",
            message:
              "Test Space source files must stay within the workspace root.",
          },
        });
      }

      let sourceStat: Awaited<ReturnType<typeof stat>>;
      try {
        sourceStat = await stat(absolutePath);
      } catch {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "Could not read local Figma JSON.",
          },
        });
      }

      if (sourceStat.size > MAX_SUBMIT_BODY_BYTES) {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "Local Figma JSON exceeds the maximum allowed size.",
          },
        });
      }

      let content: string;
      try {
        content = await readFile(absolutePath, "utf8");
      } catch {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "Could not read local Figma JSON.",
          },
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "Could not parse local Figma JSON.",
          },
        });
      }
      if (!isJsonObjectOrArray(parsed)) {
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: {
            error: "INVALID_FIGMA_JSON",
            message: "Local Figma JSON must be an object or array.",
          },
        });
      }
      return { sourceKind: "file", parsedJson: parsed };
    }

    throw createWorkspaceTestSpaceError({
      statusCode: 422,
      payload: {
        error: "MISSING_FIGMA_JSON_SOURCE",
        message: "figmaJsonPayload or figmaJsonPath is required for Test Space runs.",
      },
    });
  };

  const createRunRecord = async (
    request: WorkspaceTestSpaceRunRequest,
  ): Promise<WorkspaceTestSpaceRun> => {
    const parsedRequest = TestSpaceRunRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw createWorkspaceTestSpaceError({
        statusCode: 422,
        payload: formatTestSpaceValidationError(parsedRequest.error),
      });
    }

    const runId = randomUUID();
    const createdAt = now();
    const updatedAt = createdAt;
    const artifacts = resolveRunArtifacts({
      absoluteOutputRoot: resolvedOutputRoot,
      runId,
    });

    const sourceJson = await loadSourceJson(parsedRequest.data);
    const requestSummary = createWorkspaceTestSpaceRequestSummary(
      parsedRequest.data,
    );
    const figmaSummary = collectFigmaSummary({
      request: parsedRequest.data,
      parsedJson: sourceJson.parsedJson,
      sourceKind: sourceJson.sourceKind,
    });

    const inputArtifact: StoredInputArtifact = {
      runId,
      createdAt,
      modelDeployment,
      request: requestSummary,
    };
    await mkdir(artifacts.root, { recursive: true });
    await writeAtomicJsonFile(artifacts.inputJson, inputArtifact);
    await writeAtomicJsonFile(artifacts.figmaSummaryJson, figmaSummary);

    const llmRequest = {
      modelDeployment,
      prompt: buildLlmPrompt({
        request: requestSummary,
        figmaSummary,
      }),
      request: requestSummary,
      figmaSummary,
    };
    await writeAtomicJsonFile(artifacts.llmRequestRedactedJson, llmRequest);

    let llmRawResponse: unknown;
    let generatedOutput: {
      testCases: WorkspaceTestSpaceCase[];
      coverageFindings: WorkspaceTestSpaceCoverageFinding[];
    };
    if (llmClient) {
      llmRawResponse = await llmClient.generateStructuredOutput(llmRequest);
      const parsedOutput = TestSpaceLlmOutputSchema.safeParse(llmRawResponse);
      if (!parsedOutput.success) {
        await writeAtomicJsonFile(artifacts.llmResponseRawJson, {
          source: "llm",
          modelDeployment,
          response: llmRawResponse,
          receivedAt: now(),
        });
        throw createWorkspaceTestSpaceError({
          statusCode: 422,
          payload: formatTestSpaceValidationError(parsedOutput.error),
        });
      }
      generatedOutput = parsedOutput.data;
    } else {
      generatedOutput = buildLocalTestCases({
        request: requestSummary,
        figmaSummary,
      });
      llmRawResponse = {
        source: "deterministic-local-generator",
        modelDeployment,
        response: generatedOutput,
      };
    }

    const qcDraft = await qcConnector.buildDraft({
      runId,
      request: requestSummary,
      figmaSummary,
      testCases: generatedOutput.testCases,
    });

    const generatedArtifact: StoredGeneratedArtifact = {
      runId,
      createdAt,
      updatedAt,
      modelDeployment,
      figmaSummary,
      testCases: generatedOutput.testCases,
      coverageFindings: generatedOutput.coverageFindings,
      qcMappingDraft: qcDraft,
    };

    const runForMarkdown: WorkspaceTestSpaceRun = {
      runId,
      status: "completed",
      modelDeployment,
      createdAt,
      updatedAt,
      request: requestSummary,
      figmaSummary,
      testCases: generatedOutput.testCases,
      coverageFindings: generatedOutput.coverageFindings,
      markdownArtifact: {
        path: artifacts.testCasesMarkdown,
        title: `Test Space Run ${runId}`,
        contentType: "text/markdown; charset=utf-8",
        bytes: 0,
        lineCount: 0,
      },
      qcMappingDraft: qcDraft,
      artifacts,
    };

    const markdown = renderWorkspaceTestSpaceMarkdown(runForMarkdown);
    const markdownArtifact: WorkspaceTestSpaceMarkdownArtifact = {
      path: artifacts.testCasesMarkdown,
      title: `Test Space Run ${runId}`,
      contentType: "text/markdown; charset=utf-8",
      bytes: Buffer.byteLength(markdown, "utf8"),
      lineCount: countLines(markdown),
    };

    const finalRun: WorkspaceTestSpaceRun = {
      ...runForMarkdown,
      markdownArtifact,
    };

    await writeAtomicJsonFile(artifacts.llmResponseRawJson, {
      source: llmClient ? "llm" : "deterministic-local-generator",
      modelDeployment,
      response: llmRawResponse,
      receivedAt: now(),
    });
    await writeAtomicJsonFile(artifacts.testCasesJson, generatedArtifact);
    await writeAtomicTextFile(artifacts.testCasesMarkdown, markdown);
    await writeAtomicTextFile(
      artifacts.auditLogJsonl,
      [
        {
          at: createdAt,
          level: "info",
          event: "test-space.run.created",
          message: `Created Test Space run '${runId}'.`,
          runId,
        } satisfies WorkspaceTestSpaceAuditEvent,
        {
          at: updatedAt,
          level: "info",
          event: llmClient
            ? "test-space.llm.response.validated"
            : "test-space.generator.local",
          message: llmClient
            ? "Validated structured LLM output."
            : "Used deterministic local test-case generation.",
          runId,
        } satisfies WorkspaceTestSpaceAuditEvent,
        {
          at: now(),
          level: "info",
          event: "test-space.artifacts.written",
          message: "Persisted Test Space artifacts.",
          runId,
        } satisfies WorkspaceTestSpaceAuditEvent,
      ]
        .map((entry) => stableJson(entry).trimEnd())
        .join("\n") + "\n",
    );

    return finalRun;
  };

  const loadStoredRun = async (
    runId: string,
  ): Promise<WorkspaceTestSpaceRun | undefined> => {
    const normalizedRunId = ensureRunId(runId);
    const artifacts = resolveRunArtifacts({
      absoluteOutputRoot: resolvedOutputRoot,
      runId: normalizedRunId,
    });

    const [storedInput, storedGenerated, markdown] = await Promise.all([
      readJsonFile<StoredInputArtifact>(artifacts.inputJson),
      readJsonFile<StoredGeneratedArtifact>(artifacts.testCasesJson),
      readFile(artifacts.testCasesMarkdown, "utf8").catch(() => ""),
    ]);
    if (!storedInput || !storedGenerated) {
      return undefined;
    }

    const markdownArtifact: WorkspaceTestSpaceMarkdownArtifact = {
      path: artifacts.testCasesMarkdown,
      title: `Test Space Run ${normalizedRunId}`,
      contentType: "text/markdown; charset=utf-8",
      bytes: Buffer.byteLength(markdown, "utf8"),
      lineCount: countLines(markdown),
    };

    return {
      runId: normalizedRunId,
      status: "completed",
      modelDeployment: storedGenerated.modelDeployment,
      createdAt: storedInput.createdAt,
      updatedAt: storedGenerated.updatedAt,
      request: storedInput.request,
      figmaSummary: storedGenerated.figmaSummary,
      testCases: storedGenerated.testCases,
      coverageFindings: storedGenerated.coverageFindings,
      markdownArtifact,
      qcMappingDraft: storedGenerated.qcMappingDraft,
      artifacts,
    };
  };

  return {
    async createRun(request: WorkspaceTestSpaceRunRequest): Promise<WorkspaceTestSpaceRun> {
      try {
        return await createRunRecord(request);
      } catch (error) {
        if (isWorkspaceTestSpaceError(error)) {
          throw error;
        }
        throw createInternalWorkspaceTestSpaceError();
      }
    },
    getRun: loadStoredRun,
    async getRunTestCases(runId: string) {
      const run = await loadStoredRun(runId);
      if (!run) {
        return undefined;
      }
      return {
        runId: run.runId,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        modelDeployment: run.modelDeployment,
        testCases: run.testCases,
        coverageFindings: run.coverageFindings,
        qcMappingDraft: run.qcMappingDraft,
      };
    },
    async getRunMarkdown(runId: string) {
      const normalizedRunId = ensureRunId(runId);
      const artifacts = resolveRunArtifacts({
        absoluteOutputRoot: resolvedOutputRoot,
        runId: normalizedRunId,
      });
      return readFile(artifacts.testCasesMarkdown, "utf8").catch(() => undefined);
    },
  };
}
