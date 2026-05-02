import { createHash, randomUUID } from "node:crypto";
import {
  opendir,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  TEST_INTELLIGENCE_ENV,
  JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY,
  type JiraFetchRequest,
  type TestIntelligenceReviewPrincipal,
  type WorkspaceFigmaSourceMode,
  type WorkspaceImportSessionEvent,
  type WorkspaceImportSessionEventKind,
  type WorkspaceImportSessionSourceMode,
  type WorkspaceJobType,
  type WorkspacePasteDeltaSummary,
  type WorkspaceStatus,
} from "../contracts/index.js";
import {
  isClipboardEnvelope,
  looksLikeClipboardEnvelope,
  normalizeEnvelopeToFigmaFile,
  validateClipboardEnvelope,
  validateClipboardEnvelopeComplexity,
  summarizeEnvelopeValidationIssues,
} from "../clipboard-envelope.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import { validateFigmaPayloadComplexity } from "../figma-payload-validation.js";
import type { ValidatedFigmaNode } from "../figma-payload-validation.js";
import type { JobEngine } from "../job-engine.js";
import type { SubmissionJobInput } from "../job-engine/types.js";
import { STAGE_ARTIFACT_KEYS } from "../job-engine/pipeline/artifact-keys.js";
import { StageArtifactStore } from "../job-engine/pipeline/artifact-store.js";
import {
  getDefaultPipelineRegistry,
  selectPipelineDefinition,
} from "../job-engine/pipeline/pipeline-selection.js";
import { isPipelineRequestError } from "../job-engine/pipeline/pipeline-errors.js";
import { LocalSyncError } from "../job-engine/local-sync.js";
import {
  getContentType,
  hasSymlinkInPath,
  isWithinRoot,
  normalizePathPart,
  readFileWithFinalComponentNoFollow,
} from "../job-engine/preview.js";
import {
  computePasteIdentityKey,
  createPasteFingerprintStore,
} from "../job-engine/paste-fingerprint-store.js";
import { diffFigmaPaste } from "../job-engine/paste-tree-diff.js";
import {
  resolvePasteDeltaSummary,
  type PasteDeltaSeedCandidate,
} from "../job-engine/paste-delta-execution.js";
import { extractDiffablePasteRootsFromJson } from "../job-engine/paste-delta-roots.js";
import type {
  WorkspaceRuntimeLogLevel,
  WorkspaceRuntimeLogger,
} from "../logging.js";
import {
  enforceModeLock,
  getAllowedFigmaSourceModes,
  validateModeLock,
} from "../mode-lock.js";
import { buildScreenArtifactIdentities } from "../parity/generator-artifacts.js";
import type { FigmaMcpEnrichment } from "../parity/types.js";
import type { ScreenIR } from "../parity/types-ir.js";
import {
  CreatePrRequestSchema,
  RegenerationRequestSchema,
  RetryRequestSchema,
  SubmitRequestSchema,
  SyncRequestSchema,
  formatZodError,
} from "../schemas.js";
import {
  validateImportSessionEventWriteAuth,
  validateWriteRequest,
} from "./request-security.js";
import {
  createIpRateLimiter,
  resolveRateLimitClientKey,
} from "./rate-limit.js";
import { createFileBackedRateLimitStore } from "./rate-limit-store.js";
import {
  sendBuffer,
  sendJson,
  sendText,
  readStreamingJsonBody,
  readJsonBody,
} from "./http-helpers.js";
import {
  MAX_SUBMIT_BODY_BYTES,
  WORKSPACE_UI_CONTENT_SECURITY_POLICY,
  resolveTestIntelligenceEnabled,
  resolveTestIntelligenceMultiSourceEnvEnabled,
} from "./constants.js";
import { ErrorCode } from "./error-codes.js";
import { INVALID_PATH_ENCODING, safeDecode } from "./route-params.js";
import {
  isWorkspaceProjectRoute,
  parseImportSessionRoute,
  parseJobFilesRoute,
  parseJobPreviewRoute,
  parseJobRoute,
  parseReproRoute,
  isForbiddenUiAssetPath,
  resolveUiAssetPath,
  shouldFallbackToUiEntrypoint,
  validateSourceFilePath,
} from "./routes.js";
import { loadInspectorPolicy } from "./inspector-policy.js";
import { getUiAsset, getUiAssets } from "./ui-assets.js";
import { parseInspectorTestIntelligenceRoute } from "../test-intelligence/inspector-route.js";
import type { ReviewRequestEnvelope } from "../test-intelligence/review-handler.js";
import {
  listInspectorTestIntelligenceJobs,
  readInspectorTestIntelligenceBundle,
} from "../test-intelligence/inspector-bundle.js";
import {
  listInspectorSourceRecords,
  markInspectorSourceRemoved,
  resolveInspectorConflict,
} from "../test-intelligence/inspector-multisource.js";
import type { JiraGatewayClient } from "../test-intelligence/jira-gateway-client.js";
import {
  createUnconfiguredJiraWriteClient,
  runJiraSubtaskWrite,
  type JiraWriteClient,
} from "../test-intelligence/jira-write-adapter.js";
import { parseEvidenceVerifyRoute } from "../test-intelligence/evidence-verify-route.js";
import { verifyJobEvidence } from "../test-intelligence/evidence-verify.js";
import {
  ProductionRunnerError,
  type ProductionRunnerSource,
  type RunFigmaToQcTestCasesResult,
} from "../test-intelligence/production-runner.js";
import type {
  FigmaRestFileSnapshot,
  FigmaRestNode,
} from "../test-intelligence/figma-rest-adapter.js";
import {
  createFileSystemReviewStore,
  type ReviewStore,
} from "../test-intelligence/review-store.js";
import { handleReviewRequest } from "../test-intelligence/review-handler.js";
import {
  buildJiraPasteOnlyEnvelope,
  ingestAndPersistJiraPaste,
  MAX_JIRA_PASTE_INPUT_BYTES,
  type JiraPasteDeclaredFormat,
} from "../test-intelligence/jira-paste-ingest.js";
import { validateCustomContextInput } from "../test-intelligence/custom-context-input.js";
import { persistCustomContext } from "../test-intelligence/custom-context-store.js";
import {
  buildCustomerMarkdownAttachmentName,
  readCustomerMarkdownArtifact,
} from "../test-intelligence/customer-markdown-reader.js";

/**
 * Decode a URI component safely, sending a 400 response on malformed input.
 * Returns the decoded string or `null` (after sending the response).
 */
function safeDecodeParam(
  value: string,
  paramLabel: string,
  response: ServerResponse,
): string | null {
  const decoded = safeDecode(value);
  if (decoded === INVALID_PATH_ENCODING) {
    sendJson({
      response,
      statusCode: 400,
      payload: {
        error: "INVALID_PATH_ENCODING",
        message: `Malformed percent-encoding in ${paramLabel}.`,
      },
    });
    return null;
  }
  return decoded;
}

async function resolveGeneratedPreviewAsset({
  generatedProjectDir,
  previewPath,
}: {
  generatedProjectDir: string;
  previewPath: string;
}): Promise<{ content: Buffer; contentType: string } | undefined> {
  const normalizedPart = normalizePathPart(previewPath || "index.html");
  if (normalizedPart === undefined) {
    return undefined;
  }

  const fallbackPath =
    normalizedPart.length > 0 ? normalizedPart : "index.html";
  const previewRoot = path.resolve(generatedProjectDir, "dist");
  const candidatePath = path.resolve(previewRoot, fallbackPath);

  if (!isWithinRoot({ candidatePath, rootPath: previewRoot })) {
    return undefined;
  }
  if (await hasSymlinkInPath({ candidatePath, rootPath: previewRoot })) {
    return undefined;
  }

  try {
    const content = await readFileWithFinalComponentNoFollow(candidatePath);
    return {
      content,
      contentType: getContentType(candidatePath),
    };
  } catch {
    if (fallbackPath !== "index.html") {
      const indexPath = path.resolve(previewRoot, "index.html");
      if (
        await hasSymlinkInPath({
          candidatePath: indexPath,
          rootPath: previewRoot,
        })
      ) {
        return undefined;
      }
      try {
        const content = await readFileWithFinalComponentNoFollow(indexPath);
        return {
          content,
          contentType: "text/html; charset=utf-8",
        };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function buildPhase2PreviewPendingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="1" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Building preview…</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #111111;
        color: rgba(255, 255, 255, 0.72);
        font: 500 14px/1.4 ui-sans-serif, system-ui, sans-serif;
      }
      .badge {
        border: 1px solid rgba(78, 186, 135, 0.35);
        background: rgba(78, 186, 135, 0.08);
        color: #4eba87;
        border-radius: 999px;
        padding: 6px 10px;
        margin-bottom: 12px;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      main {
        max-width: 280px;
        padding: 24px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="badge">Phase 2 preview</div>
      <div>Building the generated preview…</div>
    </main>
  </body>
</html>`;
}

interface FigmaUrlSubmitPayload {
  figmaFileKey: string;
  nodeId: string | null;
}

type FigmaUrlNormalizationResult =
  | { ok: true; value: unknown }
  | { ok: false; statusCode: number; payload: Record<string, unknown> };

function isFigmaUrlSubmitPayload(
  value: unknown,
): value is FigmaUrlSubmitPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.figmaFileKey === "string" &&
    candidate.figmaFileKey.trim().length > 0 &&
    (typeof candidate.nodeId === "string" ||
      candidate.nodeId === null ||
      candidate.nodeId === undefined)
  );
}

function normalizeOptionalFigmaNodeId(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.replace(/-/g, ":");
}

function normalizeFigmaUrlSubmitInput(
  input: unknown,
): FigmaUrlNormalizationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: true, value: input };
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.figmaSourceMode !== "figma_url") {
    return { ok: true, value: input };
  }

  if (
    typeof candidate.figmaJsonPayload !== "string" ||
    candidate.figmaJsonPayload.trim().length === 0
  ) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "INVALID_PAYLOAD",
        message: "figmaJsonPayload is required when figmaSourceMode=figma_url.",
      },
    };
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(candidate.figmaJsonPayload);
  } catch {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "SCHEMA_MISMATCH",
        message:
          "figmaJsonPayload must be valid JSON when figmaSourceMode=figma_url.",
      },
    };
  }

  if (!isFigmaUrlSubmitPayload(parsedPayload)) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "SCHEMA_MISMATCH",
        message:
          "figmaJsonPayload for figma_url must include a non-empty figmaFileKey and an optional nodeId.",
      },
    };
  }

  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  if (!figmaAccessToken) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "MISSING_FIGMA_ACCESS_TOKEN",
        message:
          "figma_url imports require FIGMA_ACCESS_TOKEN in the workspace-dev environment.",
      },
    };
  }

  const { figmaJsonPayload: _discardPayload, ...rest } = candidate;
  void _discardPayload;
  const figmaNodeId = normalizeOptionalFigmaNodeId(parsedPayload.nodeId);

  return {
    ok: true,
    value: {
      ...rest,
      figmaSourceMode: "hybrid",
      figmaFileKey: parsedPayload.figmaFileKey.trim(),
      ...(figmaNodeId !== undefined ? { figmaNodeId } : {}),
      figmaAccessToken,
    },
  };
}

const TEST_INTELLIGENCE_JOB_TYPE =
  "figma_to_qc_test_cases" satisfies WorkspaceJobType;

function resolveRawSubmitJobType(input: unknown): WorkspaceJobType | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.jobType !== "string") {
    return undefined;
  }

  const normalized = candidate.jobType.trim().toLowerCase();
  return normalized === TEST_INTELLIGENCE_JOB_TYPE
    ? TEST_INTELLIGENCE_JOB_TYPE
    : undefined;
}

type ProductionRunnerSourceResolution =
  | { ok: true; value: ProductionRunnerSource }
  | {
      ok: false;
      statusCode: number;
      payload: { error: string; message: string };
    };

/**
 * Translate the schema-validated submit payload into a `ProductionRunnerSource`.
 *
 * The submit pipeline upstream collapses `figma_url` into the `hybrid` mode
 * (file key + access token, optionally a node id), so the cases we accept
 * here are:
 *   - `hybrid`         → `kind: "figma_url"` (URL synthesised from file key
 *                        + optional node id; access token forwarded).
 *   - `figma_paste` /
 *     `figma_plugin`   → `kind: "figma_paste_normalized"` after parsing the
 *                        clipboard payload as a Figma file.
 *
 * `rest` and `local_json` are not supported on the test-intelligence path
 * today; they fail closed with a 400 so the caller sees a clear contract.
 */
function buildProductionRunnerSource(
  data: SubmissionJobInput,
): ProductionRunnerSourceResolution {
  const figmaSourceMode = data.figmaSourceMode;
  if (figmaSourceMode === "hybrid") {
    const figmaFileKey = data.figmaFileKey;
    const figmaAccessToken = data.figmaAccessToken;
    if (
      typeof figmaFileKey !== "string" ||
      figmaFileKey.length === 0 ||
      typeof figmaAccessToken !== "string" ||
      figmaAccessToken.length === 0
    ) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: "INVALID_PAYLOAD",
          message:
            "figma_url submissions require figmaFileKey and an accessible FIGMA_ACCESS_TOKEN.",
        },
      };
    }
    const figmaNodeId = data.figmaNodeId;
    const params = new URLSearchParams();
    if (typeof figmaNodeId === "string" && figmaNodeId.length > 0) {
      params.set("node-id", figmaNodeId.replace(/:/gu, "-"));
    }
    const query = params.toString();
    const figmaUrl = `https://www.figma.com/design/${encodeURIComponent(figmaFileKey)}${query.length > 0 ? `?${query}` : ""}`;
    return {
      ok: true,
      value: {
        kind: "figma_url",
        figmaUrl,
        accessToken: figmaAccessToken,
      },
    };
  }
  if (figmaSourceMode === "figma_paste" || figmaSourceMode === "figma_plugin") {
    const payload = data.figmaJsonPayload;
    if (typeof payload !== "string" || payload.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: "INVALID_PAYLOAD",
          message:
            "figmaJsonPayload is required when figmaSourceMode=figma_paste or figma_plugin.",
        },
      };
    }
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: "SCHEMA_MISMATCH",
          message:
            "figmaJsonPayload must be valid JSON when figmaSourceMode=figma_paste or figma_plugin.",
        },
      };
    }
    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: "SCHEMA_MISMATCH",
          message:
            "figmaJsonPayload must decode to a Figma file object with a document field.",
        },
      };
    }
    const record = parsedPayload as Record<string, unknown>;
    const documentField = record.document;
    if (
      typeof documentField !== "object" ||
      documentField === null ||
      Array.isArray(documentField)
    ) {
      return {
        ok: false,
        statusCode: 400,
        payload: {
          error: "SCHEMA_MISMATCH",
          message: "figmaJsonPayload must include a top-level document object.",
        },
      };
    }
    const documentRecord = documentField as Record<string, unknown>;
    const documentId =
      typeof documentRecord.id === "string" && documentRecord.id.length > 0
        ? documentRecord.id
        : "0:0";
    const documentType =
      typeof documentRecord.type === "string" && documentRecord.type.length > 0
        ? documentRecord.type
        : "DOCUMENT";
    const safeDocument: FigmaRestNode = {
      ...documentRecord,
      id: documentId,
      type: documentType,
    } as unknown as FigmaRestNode;
    const fileKeyField = record.fileKey;
    const fileKey =
      typeof fileKeyField === "string" && fileKeyField.length > 0
        ? fileKeyField
        : `paste-${createHash("sha256").update(payload).digest("hex").slice(0, 12)}`;
    const nameField = record.name;
    const fileName =
      typeof nameField === "string" && nameField.length > 0
        ? nameField
        : "Pasted Figma File";
    const lastModifiedField = record.lastModified;
    const file: FigmaRestFileSnapshot = {
      fileKey,
      name: fileName,
      document: safeDocument,
      ...(typeof lastModifiedField === "string" && lastModifiedField.length > 0
        ? { lastModified: lastModifiedField }
        : {}),
    };
    return {
      ok: true,
      value: { kind: "figma_paste_normalized", file },
    };
  }
  return {
    ok: false,
    statusCode: 400,
    payload: {
      error: "UNSUPPORTED_FIGMA_SOURCE_MODE",
      message: `figmaSourceMode=${String(figmaSourceMode)} is not supported by the test-intelligence production runner; use figma_url, figma_paste, or figma_plugin.`,
    },
  };
}

/**
 * Map a {@link ProductionRunnerError} to a wire-shaped error envelope. Every
 * failure class is enumerated explicitly so a future addition forces a
 * compile-time decision rather than silently falling through to a 500.
 */
function mapProductionRunnerError(error: unknown): {
  statusCode: number;
  payload: { error: string; message: string };
} {
  if (error instanceof ProductionRunnerError) {
    const sanitizedMessage = sanitizeErrorMessage({
      error,
      fallback: "Test intelligence production runner failed.",
    });
    switch (error.failureClass) {
      case "EMPTY_FIGMA_INPUT":
      case "FIGMA_URL_REJECTED":
        return {
          statusCode: 400,
          payload: { error: error.failureClass, message: sanitizedMessage },
        };
      case "LLM_REFUSAL":
        return {
          statusCode: 422,
          payload: { error: error.failureClass, message: sanitizedMessage },
        };
      case "FIGMA_FETCH_FAILED":
        return {
          statusCode: 502,
          payload: { error: error.failureClass, message: sanitizedMessage },
        };
      case "LLM_GATEWAY_FAILED":
      case "LLM_RESPONSE_INVALID":
      case "PERSIST_FAILED":
        return {
          statusCode: 500,
          payload: { error: error.failureClass, message: sanitizedMessage },
        };
    }
  }
  return {
    statusCode: 500,
    payload: {
      error: "INTERNAL_ERROR",
      message: sanitizeErrorMessage({
        error,
        fallback: "Test intelligence production runner failed.",
      }),
    },
  };
}

function resolveBlockedModeViolation(input: unknown): {
  figmaSourceMode?: string;
  llmCodegenMode?: string;
  message: string;
} | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const candidate = input as {
    figmaSourceMode?: unknown;
    llmCodegenMode?: unknown;
  };
  const figmaSourceMode =
    typeof candidate.figmaSourceMode === "string"
      ? candidate.figmaSourceMode
      : undefined;

  const modeLock = validateModeLock({
    ...(figmaSourceMode !== undefined ? { figmaSourceMode } : {}),
  });
  const blockedMessage = modeLock.errors.find((message) =>
    message.includes("not available in workspace-dev"),
  );
  if (!blockedMessage) {
    return null;
  }

  return {
    ...(figmaSourceMode !== undefined ? { figmaSourceMode } : {}),
    message: blockedMessage,
  };
}

function readScreenshotUrlFromEnrichment(
  enrichment: FigmaMcpEnrichment | undefined,
): string | undefined {
  const screenshot = enrichment?.screenshots?.find(
    (entry) => typeof entry.url === "string" && entry.url.trim().length > 0,
  );
  return screenshot?.url;
}

type WorkspaceAuditEvent =
  | "security.request.unauthorized"
  | "security.request.rejected_origin"
  | "security.request.unsupported_media_type"
  | "security.request.rate_limited"
  | "workspace.inspector_policy.invalid"
  | "workspace.request.validation_failed"
  | "workspace.request.failed"
  | "workspace.submit.accepted"
  | "workspace.cancel.accepted"
  | "workspace.sync.previewed"
  | "workspace.sync.applied"
  | "workspace.regenerate.accepted"
  | "workspace.retry.accepted"
  | "workspace.create_pr.completed"
  | "workspace.stale_check.completed"
  | "workspace.remap_suggest.completed"
  | "workspace.token_decisions.persisted"
  | "workspace.evidence.verify.completed"
  | "workspace.jira_rest_source.ingested"
  | "workspace.jira_paste_source.ingested"
  | "workspace.custom_context_source.ingested"
  | "workspace.test_intelligence_source.removed"
  | "workspace.jira_write.run_completed";

const REQUEST_ID_HEADER = "x-request-id";
const DEFAULT_REQUEST_FAILURE_MESSAGE = "Unexpected request failure.";
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID_PATTERN = /^[\w.:\-/]+$/;

const getHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find((candidate) => typeof candidate === "string");
  }
  return undefined;
};

const resolveRequestId = (value: string | string[] | undefined): string => {
  const requestId = getHeaderValue(value)?.trim();
  if (
    requestId &&
    requestId.length > 0 &&
    requestId.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID_PATTERN.test(requestId)
  ) {
    return requestId;
  }
  return randomUUID();
};

const resolveAuditMessage = ({
  payload,
  fallback,
}: {
  payload: unknown;
  fallback: string;
}): string => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return fallback;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : fallback;
};

const PROTECTED_POST_ACTIONS = new Set([
  "cancel",
  "sync",
  "regenerate",
  "retry-stage",
  "create-pr",
  "stale-check",
  "remap-suggest",
  "token-decisions",
]);

const TOKEN_DECISIONS_FILE_NAME = "token-decisions.json";
const JIRA_PASTE_REQUEST_ENVELOPE_OVERHEAD_BYTES = 4096;
const MAX_JIRA_PASTE_REQUEST_BODY_BYTES =
  MAX_JIRA_PASTE_INPUT_BYTES + JIRA_PASTE_REQUEST_ENVELOPE_OVERHEAD_BYTES;
const MAX_JIRA_FETCH_REQUEST_BODY_BYTES = 16 * 1024;
const ALLOWED_JIRA_PASTE_REQUEST_FIELDS = new Set([
  "format",
  "body",
  "paste",
  "authorHandle",
]);
const CUSTOM_CONTEXT_REQUEST_ENVELOPE_OVERHEAD_BYTES = 4096;
const MAX_CUSTOM_CONTEXT_REQUEST_BODY_BYTES =
  32 * 1024 + CUSTOM_CONTEXT_REQUEST_ENVELOPE_OVERHEAD_BYTES;
const MAX_CONFLICT_RESOLUTION_REQUEST_BODY_BYTES = 16 * 1024;
const LEGACY_TEST_INTELLIGENCE_REVIEW_PRINCIPAL_ID = "legacy-review-bearer";

const validateJiraWriteMarkdownPath = (
  value: string,
): { ok: true; value: string } | { ok: false; message: string } => {
  const trimmed = value.trim();
  if (trimmed.includes("\0")) {
    return {
      ok: false,
      message: "outputPathMarkdown must not contain null bytes.",
    };
  }
  if (!path.isAbsolute(trimmed)) {
    return {
      ok: false,
      message: "outputPathMarkdown must be an absolute path.",
    };
  }
  if (trimmed.split(/[\\/]+/u).includes("..")) {
    return {
      ok: false,
      message: "outputPathMarkdown must not contain '..' path segments.",
    };
  }
  return { ok: true, value: trimmed };
};

const preflightJiraWriteMarkdownDir = async (
  outputDir: string,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  try {
    await mkdir(outputDir, { recursive: true });
    const probeBase = path.join(
      outputDir,
      `.jira-write-preflight-${process.pid}-${randomUUID()}`,
    );
    const tmpPath = `${probeBase}.tmp`;
    const finalPath = `${probeBase}.ok`;
    await writeFile(tmpPath, "ok\n", "utf8");
    await rename(tmpPath, finalPath);
    await unlink(finalPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: sanitizeErrorMessage({
        error,
        fallback: "Markdown output path is not writable.",
      }),
    };
  }
};

interface PersistedTokenDecisions {
  jobId: string;
  updatedAt: string;
  acceptedTokenNames: string[];
  rejectedTokenNames: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function sanitizeTokenNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 256) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

const IMPORT_SESSION_EVENT_KINDS: ReadonlySet<WorkspaceImportSessionEventKind> =
  new Set<WorkspaceImportSessionEventKind>([
    "imported",
    "review_started",
    "approved",
    "applied",
    "rejected",
    "apply_blocked",
    "note",
  ]);

function isImportSessionEventKind(
  value: unknown,
): value is WorkspaceImportSessionEventKind {
  return (
    typeof value === "string" &&
    (IMPORT_SESSION_EVENT_KINDS as ReadonlySet<string>).has(value)
  );
}

function isFlatEventMetadata(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

interface BuildReviewEnvelopeInput {
  body: unknown;
  method: "POST";
  action: string;
  jobId: string;
  testCaseId?: string;
  bearerToken: string | undefined;
  reviewPrincipals: readonly TestIntelligenceReviewPrincipal[] | undefined;
  authorizationHeader: string | undefined;
}

type BuildReviewEnvelopeResult =
  | {
      ok: true;
      envelope: ReviewRequestEnvelope;
    }
  | { ok: false; error: string; message: string };

/**
 * Translate a JSON request body into a `ReviewRequestEnvelope` consumed by
 * the in-process review handler. The body shape mirrors the import-session
 * event API (`{ at, actor?, note?, metadata? }`) so reviewers and operators
 * use a single mental model across surfaces.
 */
function buildReviewEnvelopeFromBody(
  input: BuildReviewEnvelopeInput,
): BuildReviewEnvelopeResult {
  if (input.body === null || input.body === undefined) {
    return {
      ok: false,
      error: "INVALID_BODY",
      message: "Request body must be a JSON object.",
    };
  }
  if (typeof input.body !== "object" || Array.isArray(input.body)) {
    return {
      ok: false,
      error: "INVALID_BODY",
      message: "Request body must be a JSON object.",
    };
  }
  const candidate = input.body as Record<string, unknown>;
  const at = candidate["at"];
  if (typeof at !== "string" || at.length === 0) {
    return {
      ok: false,
      error: "INVALID_BODY",
      message: "Field 'at' must be a non-empty ISO-8601 string.",
    };
  }
  if (Number.isNaN(Date.parse(at))) {
    return {
      ok: false,
      error: "INVALID_BODY",
      message: "Field 'at' must be a parseable ISO-8601 timestamp.",
    };
  }

  let actor: string | undefined;
  if (candidate["actor"] !== undefined) {
    if (typeof candidate["actor"] !== "string") {
      return {
        ok: false,
        error: "INVALID_BODY",
        message: "Field 'actor' must be a string when present.",
      };
    }
    actor = candidate["actor"];
  }

  let note: string | undefined;
  if (candidate["note"] !== undefined) {
    if (typeof candidate["note"] !== "string") {
      return {
        ok: false,
        error: "INVALID_BODY",
        message: "Field 'note' must be a string when present.",
      };
    }
    note = candidate["note"];
  }

  let metadata: Record<string, string | number | boolean | null> | undefined;
  if (candidate["metadata"] !== undefined) {
    if (!isFlatEventMetadata(candidate["metadata"])) {
      return {
        ok: false,
        error: "INVALID_BODY",
        message:
          "Field 'metadata' must be a flat object of string/number/boolean/null values.",
      };
    }
    metadata = candidate["metadata"];
  }

  return {
    ok: true,
    envelope: {
      bearerToken: input.bearerToken,
      ...(input.reviewPrincipals !== undefined
        ? { reviewPrincipals: input.reviewPrincipals }
        : {}),
      authorizationHeader: input.authorizationHeader,
      method: input.method,
      action: input.action,
      jobId: input.jobId,
      ...(input.testCaseId !== undefined
        ? { testCaseId: input.testCaseId }
        : {}),
      at,
      ...(actor !== undefined ? { actor } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}

interface JiraPasteRequestBody {
  format?: unknown;
  body?: unknown;
  paste?: unknown;
  authorHandle?: unknown;
}

interface JiraFetchSourceRequestBody {
  issueKey?: unknown;
  issueKeys?: unknown;
  jql?: unknown;
  maxResults?: unknown;
  replayMode?: unknown;
}

type ParsedJiraFetchSourceRequest =
  | { ok: true; request: JiraFetchRequest }
  | { ok: false; message: string };

function parseJiraFetchSourceRequest(
  body: JiraFetchSourceRequestBody,
): ParsedJiraFetchSourceRequest {
  const jql = typeof body.jql === "string" ? body.jql.trim() : "";
  const hasJql = jql.length > 0;
  const issueKeys =
    typeof body.issueKey === "string" && body.issueKey.trim().length > 0
      ? [body.issueKey.trim()]
      : Array.isArray(body.issueKeys)
        ? body.issueKeys
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : [];
  if (hasJql && issueKeys.length > 0) {
    return {
      ok: false,
      message:
        "Jira REST request must provide either jql or issueKeys, not both.",
    };
  }
  if (!hasJql && issueKeys.length === 0) {
    return {
      ok: false,
      message: "Jira REST request requires jql:string or issueKeys:string[].",
    };
  }
  const replayMode =
    body.replayMode === undefined ? undefined : body.replayMode === true;
  const withCommonFields = (request: JiraFetchRequest): JiraFetchRequest => ({
    ...request,
    expand: ["renderedFields", "names", "schema"],
    ...(replayMode !== undefined ? { replayMode } : {}),
  });
  if (hasJql) {
    const maxResults =
      typeof body.maxResults === "number" &&
      Number.isInteger(body.maxResults) &&
      body.maxResults >= 1 &&
      body.maxResults <= 50
        ? body.maxResults
        : 10;
    return {
      ok: true,
      request: withCommonFields({ query: { kind: "jql", jql, maxResults } }),
    };
  }
  return {
    ok: true,
    request: withCommonFields({
      query: { kind: "issueKeys", issueKeys: [...new Set(issueKeys)].sort() },
    }),
  };
}

type TestIntelligenceSourceAuthResult =
  | { ok: true; authorHandle: string }
  | {
      ok: false;
      statusCode: 401 | 503;
      payload: {
        error: "UNAUTHORIZED" | "AUTHENTICATION_UNAVAILABLE";
        message: string;
      };
      wwwAuthenticate?: string;
    };

function validateTestIntelligenceSourceAuth({
  request,
  bearerToken,
  reviewPrincipals,
  routeLabel,
}: {
  request: IncomingMessage;
  bearerToken?: string;
  reviewPrincipals?: readonly TestIntelligenceReviewPrincipal[];
  routeLabel: string;
}): TestIntelligenceSourceAuthResult {
  const principals = reviewPrincipals ?? [];
  for (const principal of principals) {
    const auth = validateImportSessionEventWriteAuth({
      request,
      bearerToken: principal.bearerToken,
      routeLabel,
    });
    if (auth.ok) {
      return { ok: true, authorHandle: principal.principalId };
    }
  }

  if (bearerToken !== undefined) {
    const auth = validateImportSessionEventWriteAuth({
      request,
      bearerToken,
      routeLabel,
    });
    if (auth.ok) {
      return {
        ok: true,
        authorHandle: LEGACY_TEST_INTELLIGENCE_REVIEW_PRINCIPAL_ID,
      };
    }
    return auth;
  }

  if (principals.length > 0) {
    const firstPrincipal = principals[0];
    if (firstPrincipal === undefined) {
      const auth = validateImportSessionEventWriteAuth({ request, routeLabel });
      return auth.ok
        ? {
            ok: true,
            authorHandle: LEGACY_TEST_INTELLIGENCE_REVIEW_PRINCIPAL_ID,
          }
        : auth;
    }
    const auth = validateImportSessionEventWriteAuth({
      request,
      bearerToken: firstPrincipal.bearerToken,
      routeLabel,
    });
    return auth.ok
      ? { ok: true, authorHandle: firstPrincipal.principalId }
      : auth;
  }

  const auth = validateImportSessionEventWriteAuth({ request, routeLabel });
  return auth.ok
    ? {
        ok: true,
        authorHandle: LEGACY_TEST_INTELLIGENCE_REVIEW_PRINCIPAL_ID,
      }
    : auth;
}

interface ProtectedWriteRoute {
  parsedJobRoute?: ReturnType<typeof parseJobRoute>;
  parsedImportSessionRoute?: ReturnType<typeof parseImportSessionRoute>;
}

function resolveProtectedWriteRoute(
  pathname: string,
  method: string,
): ProtectedWriteRoute | null {
  if (pathname === "/workspace/submit") {
    return {};
  }
  if (
    method === "POST" &&
    /^\/workspace\/test-intelligence\/sources\/[A-Za-z0-9_.-]{1,128}\/(?:jira-paste|custom-context)$/u.test(
      pathname,
    )
  ) {
    return {};
  }
  if (
    (method === "POST" || method === "DELETE") &&
    /^\/workspace\/test-intelligence\/jobs\/[A-Za-z0-9_.-]{1,128}\/sources\/[A-Za-z0-9_.-]{1,128}$/u.test(
      pathname,
    )
  ) {
    return {};
  }
  if (
    (method === "PUT" || method === "POST") &&
    pathname === "/workspace/test-intelligence/write/config"
  ) {
    return {};
  }
  if (
    method === "POST" &&
    /^\/workspace\/test-intelligence\/write\/[A-Za-z0-9_.-]{1,128}\/jira-subtasks$/u.test(
      pathname,
    )
  ) {
    return {};
  }

  const parsedJobRoute = parseJobRoute(pathname);
  if (parsedJobRoute && PROTECTED_POST_ACTIONS.has(parsedJobRoute.action)) {
    return { parsedJobRoute };
  }

  const parsedImportSessionRoute = parseImportSessionRoute(pathname);
  if (
    parsedImportSessionRoute &&
    ((method === "POST" && parsedImportSessionRoute.action === "reimport") ||
      (method === "POST" && parsedImportSessionRoute.action === "approve") ||
      (method === "POST" && parsedImportSessionRoute.action === "events") ||
      (method === "DELETE" && parsedImportSessionRoute.action === "detail"))
  ) {
    return { parsedImportSessionRoute };
  }

  return null;
}

/**
 * Factory invoked once per `figma_to_qc_test_cases` submission to obtain a
 * concrete production-runner invocation. Returning `undefined` signals the
 * factory has not been wired (handler responds with 503
 * `LLM_GATEWAY_UNCONFIGURED`). Returning a callable lets the handler call
 * it with the already-normalised input.
 *
 * The factory is responsible for building (or reusing) the LLM gateway
 * client. Tests inject a mock-LLM-backed runner directly so the wire-format
 * 200 path is exercised without live network calls.
 */
export type TestIntelligenceProductionRunnerFactory = (
  input: TestIntelligenceProductionRunnerFactoryInput,
) => Promise<RunFigmaToQcTestCasesResult> | RunFigmaToQcTestCasesResult;

export interface TestIntelligenceProductionRunnerFactoryInput {
  jobId: string;
  generatedAt: string;
  source: ProductionRunnerSource;
  outputRoot: string;
  /**
   * Optional event sink (Issue #1738). When supplied the factory should
   * forward this to the underlying `runFigmaToQcTestCases` call so the
   * SSE route can stream phase progress.
   */
  events?: import("../test-intelligence/production-runner-events.js").ProductionRunnerEventSink;
}

interface CreateWorkspaceRequestHandlerInput {
  host: string;
  getResolvedPort: () => number;
  startedAt: number;
  absoluteOutputRoot: string;
  workspaceRoot: string;
  defaults: {
    figmaSourceMode: "rest";
    llmCodegenMode: "deterministic";
  };
  runtime: {
    previewEnabled: boolean;
    rateLimitPerMinute?: number;
    importSessionEventBearerToken?: string;
    /**
     * Opt-in startup feature gate for the Figma-to-QC test-intelligence
     * surface. Combined with the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1`
     * environment variable; both must be true for a
     * `jobType="figma_to_qc_test_cases"` submission to be accepted.
     * Default (when omitted): false.
     */
    testIntelligenceEnabled?: boolean;
    /**
     * Startup feature gate for Wave 4 multi-source ingestion. Combined with
     * the parent test-intelligence env/startup gates and the
     * `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` env var.
     * Default (when omitted): false.
     */
    testIntelligenceMultiSourceEnabled?: boolean;
    /**
     * Bearer token accepted for `POST /workspace/test-intelligence/review/...`
     * write actions. When omitted, review-gate writes fail closed with `503`.
     * Reads (`GET /workspace/test-intelligence/...`) never require this token.
     */
    testIntelligenceReviewBearerToken?: string;
    /**
     * Optional configured Jira REST gateway for Inspector source ingestion.
     * When omitted, Jira REST writes fail closed and Jira paste remains the
     * supported air-gapped ingestion path.
     */
    testIntelligenceJiraGatewayClient?: JiraGatewayClient;
    /**
     * Optional Jira write client injected by the operator for the write
     * pipeline (#1482). When omitted, `createUnconfiguredJiraWriteClient`
     * is used (fail-closed: all calls return `provider_not_implemented`).
     */
    testIntelligenceJiraWriteClient?: JiraWriteClient;
    /**
     * Bearer token accepted by the Jira sub-task write pipeline (#1482).
     * When omitted or blank, write attempts fail closed with `bearer_token_missing`.
     */
    testIntelligenceJiraWriteBearerToken?: string;
    /**
     * Admin/startup gate for the Jira sub-task write pipeline (#1482).
     * When `false` (or omitted), every write attempt fails closed with
     * `admin_gate_disabled`. Maps to the `allowJiraWrite` option in the
     * public `WorkspaceStartOptions.testIntelligence` shape.
     */
    testIntelligenceAllowJiraWrite?: boolean;
    /**
     * Principal-bound review credentials. When configured, the matching
     * bearer token determines the persisted review actor.
     */
    testIntelligenceReviewPrincipals?: readonly TestIntelligenceReviewPrincipal[];
    /**
     * Absolute path of the directory under which per-job test-intelligence
     * artifacts are stored and surfaced by the Inspector UI. The handler
     * never writes here — emitters (validation pipeline, review store,
     * export pipeline) write per existing conventions, the Inspector route
     * only reads.
     */
    testIntelligenceArtifactRoot?: string;
    /**
     * Production-runner factory for `figma_to_qc_test_cases` (#1733).
     * When configured, `POST /workspace/submit` with that job type calls
     * the supplied factory to obtain a runner + LLM client and executes
     * the full Figma → IR → LLM → validation → persist pipeline inline.
     * When omitted, the route fails closed with `503 LLM_GATEWAY_UNCONFIGURED`
     * so production deployments must opt in by injecting an Azure-bound
     * client at startup. Tests inject a mock-LLM-backed runner so the
     * 200 path is exercised without live network calls.
     */
    testIntelligenceProductionRunner?: TestIntelligenceProductionRunnerFactory;
    logger?: WorkspaceRuntimeLogger;
  };
  getServerLifecycleState?: () => "starting" | "ready" | "draining" | "stopped";
  jobEngine: JobEngine;
  moduleDir: string;
}

export function createWorkspaceRequestHandler({
  host,
  getResolvedPort,
  startedAt,
  absoluteOutputRoot,
  workspaceRoot,
  defaults,
  runtime,
  getServerLifecycleState,
  jobEngine,
  moduleDir,
}: CreateWorkspaceRequestHandlerInput): (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> {
  const rateLimiterOptions =
    runtime.rateLimitPerMinute === undefined
      ? {}
      : { limitPerWindow: runtime.rateLimitPerMinute };
  const writeRateLimiter = createIpRateLimiter(rateLimiterOptions);
  const importSessionEventRateLimiter = createIpRateLimiter({
    ...rateLimiterOptions,
    store: createFileBackedRateLimitStore({
      filePath: path.join(
        absoluteOutputRoot,
        "rate-limits",
        "import-session-writes.json",
      ),
    }),
  });
  const testIntelligenceWriteRateLimiter = createIpRateLimiter({
    ...rateLimiterOptions,
    store: createFileBackedRateLimitStore({
      filePath: path.join(
        absoluteOutputRoot,
        "rate-limits",
        "test-intelligence-review-writes.json",
      ),
    }),
  });
  const testIntelligenceSourceWriteRateLimiter = createIpRateLimiter({
    ...rateLimiterOptions,
    store: createFileBackedRateLimitStore({
      filePath: path.join(
        absoluteOutputRoot,
        "rate-limits",
        "test-intelligence-source-writes.json",
      ),
    }),
  });
  const evidenceVerifyReadRateLimiter = createIpRateLimiter({
    ...rateLimiterOptions,
    store: createFileBackedRateLimitStore({
      filePath: path.join(
        absoluteOutputRoot,
        "rate-limits",
        "evidence-verify-reads.json",
      ),
    }),
  });
  const testIntelligenceArtifactRoot =
    runtime.testIntelligenceArtifactRoot ??
    path.join(absoluteOutputRoot, "test-intelligence");
  let cachedReviewStore: ReviewStore | undefined;
  const getReviewStore = (): ReviewStore => {
    if (!cachedReviewStore) {
      cachedReviewStore = createFileSystemReviewStore({
        destinationDir: testIntelligenceArtifactRoot,
      });
    }
    return cachedReviewStore;
  };
  const resolveLifecycleState = ():
    | "starting"
    | "ready"
    | "draining"
    | "stopped" => getServerLifecycleState?.() ?? "ready";
  const buildHealthPayload = (): {
    status: "ok" | "starting" | "draining";
    uptime: number;
  } => {
    const lifecycleState = resolveLifecycleState();
    const uptimeSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    if (lifecycleState === "starting") {
      return { status: "starting", uptime: uptimeSeconds };
    }
    if (lifecycleState === "draining") {
      return { status: "draining", uptime: uptimeSeconds };
    }
    return { status: "ok", uptime: uptimeSeconds };
  };

  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    response.setHeader(REQUEST_ID_HEADER, requestId);
    const requestLogger = runtime.logger ?? {
      log: () => {},
    };

    const method = request.method ?? "GET";
    const rawPathname = (request.url ?? "/").split("?", 1)[0] ?? "/";
    const requestUrl = new URL(
      request.url ?? "/",
      "http://workspace-dev.local",
    );
    const pathname = requestUrl.pathname;
    const protectedWriteRoute = resolveProtectedWriteRoute(pathname, method);
    const logAuditEvent = ({
      event,
      message,
      level = "info",
      jobId,
      statusCode,
    }: {
      event: WorkspaceAuditEvent;
      message: string;
      level?: WorkspaceRuntimeLogLevel;
      jobId?: string;
      statusCode?: number;
    }): void => {
      requestLogger.log({
        level,
        message,
        requestId,
        event,
        method,
        path: pathname,
        ...(jobId ? { jobId } : {}),
        ...(statusCode !== undefined ? { statusCode } : {}),
      });
    };
    const sendAuditedError = ({
      statusCode,
      payload,
      event,
      level,
      jobId,
      fallbackMessage,
    }: {
      statusCode: number;
      payload: unknown;
      event: WorkspaceAuditEvent;
      level?: WorkspaceRuntimeLogLevel;
      jobId?: string;
      fallbackMessage: string;
    }): void => {
      logAuditEvent({
        event,
        statusCode,
        message: resolveAuditMessage({ payload, fallback: fallbackMessage }),
        ...(level ? { level } : {}),
        ...(jobId ? { jobId } : {}),
      });
      sendJson({ response, statusCode, payload });
    };
    const sendValidationError = ({
      statusCode = 400,
      payload,
      jobId,
      fallbackMessage = "Request validation failed.",
    }: {
      statusCode?: number;
      payload: unknown;
      jobId?: string;
      fallbackMessage?: string;
    }): void => {
      sendAuditedError({
        statusCode,
        payload,
        event: "workspace.request.validation_failed",
        level: "warn",
        fallbackMessage,
        ...(jobId ? { jobId } : {}),
      });
    };
    const sendRequestFailure = ({
      statusCode,
      payload,
      jobId,
      fallbackMessage = "Request failed.",
    }: {
      statusCode: number;
      payload: unknown;
      jobId?: string;
      fallbackMessage?: string;
    }): void => {
      sendAuditedError({
        statusCode,
        payload,
        event: "workspace.request.failed",
        level: statusCode >= 500 ? "error" : "warn",
        fallbackMessage,
        ...(jobId ? { jobId } : {}),
      });
    };
    const sendRateLimitExceeded = ({
      retryAfterSeconds,
      message,
    }: {
      retryAfterSeconds: number;
      message: string;
    }): void => {
      response.setHeader("retry-after", String(retryAfterSeconds));
      sendAuditedError({
        statusCode: 429,
        payload: {
          error: "RATE_LIMIT_EXCEEDED",
          message,
        },
        event: "security.request.rate_limited",
        level: "warn",
        fallbackMessage: "Write request rate limited.",
      });
    };

    try {
      if (method === "GET" && pathname === "/healthz") {
        sendJson({
          response,
          statusCode: 200,
          payload: buildHealthPayload(),
        });
        return;
      }

      if (method === "GET" && pathname === "/readyz") {
        const lifecycleState = resolveLifecycleState();
        sendJson({
          response,
          statusCode: lifecycleState === "ready" ? 200 : 503,
          payload: buildHealthPayload(),
        });
        return;
      }

      if (
        resolveLifecycleState() === "draining" &&
        protectedWriteRoute !== null
      ) {
        sendJson({
          response,
          statusCode: 503,
          payload: {
            error: "SERVER_DRAINING",
            message: "Server is draining and not accepting new requests.",
          },
        });
        return;
      }

      if (method === "GET" && pathname === "/workspace") {
        const resolvedPort = getResolvedPort();
        const testIntelligenceEnabled =
          resolveTestIntelligenceEnabled() &&
          runtime.testIntelligenceEnabled === true;
        const testIntelligenceMultiSourceEnabled =
          testIntelligenceEnabled &&
          resolveTestIntelligenceMultiSourceEnvEnabled() &&
          runtime.testIntelligenceMultiSourceEnabled === true;
        const status: WorkspaceStatus = {
          availablePipelines: getDefaultPipelineRegistry().listDescriptors(),
          defaultPipelineId: selectPipelineDefinition({
            sourceMode: defaults.figmaSourceMode,
            scope: "board",
          }).id,
          running: true,
          url: `http://${host}:${resolvedPort}`,
          host,
          port: resolvedPort,
          figmaSourceMode: defaults.figmaSourceMode,
          llmCodegenMode: defaults.llmCodegenMode,
          uptimeMs: Date.now() - startedAt,
          outputRoot: absoluteOutputRoot,
          previewEnabled: runtime.previewEnabled,
          testIntelligenceEnabled,
          testIntelligenceMultiSourceEnabled,
          testIntelligenceJiraGatewayConfigured:
            runtime.testIntelligenceJiraGatewayClient !== undefined,
        };
        sendJson({ response, statusCode: 200, payload: status });
        return;
      }

      if (pathname.startsWith("/workspace/test-intelligence")) {
        const testIntelligenceGatesEnabled =
          resolveTestIntelligenceEnabled() &&
          runtime.testIntelligenceEnabled === true;
        if (!testIntelligenceGatesEnabled) {
          sendJson({
            response,
            statusCode: 503,
            payload: {
              error: ErrorCode.FEATURE_DISABLED,
              message: `Test intelligence is disabled. Enable WorkspaceStartOptions.testIntelligence.enabled and set ${TEST_INTELLIGENCE_ENV}=1.`,
            },
          });
          return;
        }

        const parsed = parseInspectorTestIntelligenceRoute(pathname);
        if (!parsed.ok) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "NOT_FOUND",
              message: `Unknown route: ${method} ${pathname}`,
            },
          });
          return;
        }
        const route = parsed.route;

        if (route.kind === "jira_fetch_source") {
          response.setHeader("allow", "POST");
          if (method !== "POST") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for Jira REST source ingestion on '${pathname}'.`,
              },
            });
            return;
          }
          const multiSourceEnabled =
            resolveTestIntelligenceMultiSourceEnvEnabled() &&
            runtime.testIntelligenceMultiSourceEnabled === true;
          if (!multiSourceEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message:
                  "Jira REST source ingestion requires the multi-source test-intelligence gate.",
              },
              jobId: route.jobId,
              fallbackMessage: "Jira REST source ingestion disabled.",
            });
            return;
          }
          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Jira REST write request rejected.",
            });
            return;
          }
          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceReviewBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceReviewBearerToken }
              : {}),
            ...(runtime.testIntelligenceReviewPrincipals !== undefined
              ? { reviewPrincipals: runtime.testIntelligenceReviewPrincipals }
              : {}),
            routeLabel: "Jira REST source ingestion",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Jira REST source ingestion rejected.",
            });
            return;
          }

          const gateway = runtime.testIntelligenceJiraGatewayClient;
          if (gateway === undefined) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: "JIRA_FETCH_UNAVAILABLE",
                message:
                  "Jira REST source ingestion is not configured for this workspace. Use Jira paste as the air-gapped path.",
              },
              jobId: route.jobId,
              fallbackMessage: "Jira REST source ingestion unavailable.",
            });
            return;
          }

          const rateLimitResult =
            await testIntelligenceSourceWriteRateLimiter.consume(
              resolveRateLimitClientKey(request),
              route.jobId,
            );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many test-intelligence source writes from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }

          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_JIRA_FETCH_REQUEST_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid Jira REST request body.",
            });
            return;
          }
          if (
            typeof bodyResult.value !== "object" ||
            bodyResult.value === null ||
            Array.isArray(bodyResult.value)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: "Jira REST request body must be a JSON object.",
              },
              jobId: route.jobId,
              fallbackMessage: "Jira REST request validation failed.",
            });
            return;
          }

          const parsedFetch = parseJiraFetchSourceRequest(
            bodyResult.value as JiraFetchSourceRequestBody,
          );
          if (!parsedFetch.ok) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: parsedFetch.message,
              },
              jobId: route.jobId,
              fallbackMessage: "Jira REST request validation failed.",
            });
            return;
          }

          const sourceId = `jira-rest-${createHash("sha256")
            .update(JSON.stringify(parsedFetch.request.query))
            .digest("hex")
            .slice(0, 16)}`;
          const runDir = path.join(testIntelligenceArtifactRoot, route.jobId);
          const result = await gateway.fetchIssues({
            ...parsedFetch.request,
            runDir,
            sourceId,
            capturedAt: new Date().toISOString(),
          });
          if (result.diagnostic !== undefined) {
            sendRequestFailure({
              statusCode: result.retryable ? 503 : 502,
              payload: {
                error: "JIRA_FETCH_FAILED",
                message: result.diagnostic.message,
                diagnostic: result.diagnostic,
              },
              jobId: route.jobId,
              fallbackMessage: "Jira REST source ingestion failed.",
            });
            return;
          }

          const sources = await listInspectorSourceRecords(runDir);
          logAuditEvent({
            event: "workspace.jira_rest_source.ingested",
            statusCode: 200,
            jobId: route.jobId,
            message: `Jira REST source '${sourceId}' ingested for job '${route.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: {
              ok: true,
              jobId: route.jobId,
              sourceId,
              issueCount: result.issues.length,
              responseHash: result.responseHash,
              cacheHit: result.cacheHit === true,
              attempts: result.attempts,
              capability: result.capability,
              sources,
              artifacts: {
                issueIrList: `sources/${sourceId}/jira-issue-ir-list.json`,
                singleIssueIr:
                  result.issues.length === 1
                    ? `sources/${sourceId}/jira-issue-ir.json`
                    : null,
              },
            },
          });
          return;
        }

        if (route.kind === "remove_source") {
          response.setHeader("allow", "DELETE");
          if (method !== "DELETE") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use DELETE for source removal on '${pathname}'.`,
              },
            });
            return;
          }
          const multiSourceEnabled =
            resolveTestIntelligenceMultiSourceEnvEnabled() &&
            runtime.testIntelligenceMultiSourceEnabled === true;
          if (!multiSourceEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message:
                  "Source removal requires the multi-source test-intelligence gate.",
              },
              jobId: route.jobId,
              fallbackMessage: "Source removal disabled.",
            });
            return;
          }
          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Source removal write request rejected.",
            });
            return;
          }
          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceReviewBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceReviewBearerToken }
              : {}),
            ...(runtime.testIntelligenceReviewPrincipals !== undefined
              ? { reviewPrincipals: runtime.testIntelligenceReviewPrincipals }
              : {}),
            routeLabel: "Source removal",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Source removal rejected.",
            });
            return;
          }
          const runDir = path.join(testIntelligenceArtifactRoot, route.jobId);
          const sourceDir = path.join(runDir, "sources", route.sourceId);
          const sourceRecords = await listInspectorSourceRecords(runDir);
          const sourceExists = sourceRecords.some(
            (source) => source.sourceId === route.sourceId,
          );
          let sourceDirExists = false;
          try {
            const stats = await lstat(sourceDir);
            sourceDirExists = stats.isDirectory();
          } catch {
            sourceDirExists = false;
          }
          if (!sourceExists && !sourceDirExists) {
            sendRequestFailure({
              statusCode: 404,
              payload: {
                error: "SOURCE_NOT_FOUND",
                message: `Source '${route.sourceId}' does not exist for job '${route.jobId}'.`,
              },
              jobId: route.jobId,
              fallbackMessage: "Source removal target was not found.",
            });
            return;
          }
          if (sourceDirExists) {
            try {
              await rm(sourceDir, { recursive: true, force: false });
            } catch (err) {
              const code =
                err && typeof err === "object" && "code" in err
                  ? (err as { code?: unknown }).code
                  : undefined;
              if (code !== "ENOENT") {
                throw err;
              }
            }
          }
          await markInspectorSourceRemoved({
            runDir,
            jobId: route.jobId,
            sourceId: route.sourceId,
            removedBy: auth.authorHandle,
            removedAt: new Date().toISOString(),
          });
          logAuditEvent({
            event: "workspace.test_intelligence_source.removed",
            statusCode: 200,
            jobId: route.jobId,
            message: `Source '${route.sourceId}' removed from job '${route.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: {
              ok: true,
              jobId: route.jobId,
              sourceId: route.sourceId,
            },
          });
          return;
        }

        if (route.kind === "resolve_conflict") {
          response.setHeader("allow", "POST");
          if (method !== "POST") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for conflict resolution on '${pathname}'.`,
              },
            });
            return;
          }
          const multiSourceEnabled =
            resolveTestIntelligenceMultiSourceEnvEnabled() &&
            runtime.testIntelligenceMultiSourceEnabled === true;
          if (!multiSourceEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message:
                  "Conflict resolution requires the multi-source test-intelligence gate.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution disabled.",
            });
            return;
          }
          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution write request rejected.",
            });
            return;
          }
          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceReviewBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceReviewBearerToken }
              : {}),
            ...(runtime.testIntelligenceReviewPrincipals !== undefined
              ? { reviewPrincipals: runtime.testIntelligenceReviewPrincipals }
              : {}),
            routeLabel: "Conflict resolution",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution rejected.",
            });
            return;
          }
          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_CONFLICT_RESOLUTION_REQUEST_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid conflict resolution request body.",
            });
            return;
          }
          if (
            !bodyResult.value ||
            typeof bodyResult.value !== "object" ||
            Array.isArray(bodyResult.value)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message:
                  "Conflict resolution request body must be a JSON object.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution request validation failed.",
            });
            return;
          }
          const body = bodyResult.value as {
            action?: unknown;
            selectedSourceId?: unknown;
            selectedNormalizedValue?: unknown;
            note?: unknown;
          };
          if (body.action !== "approve" && body.action !== "reject") {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: "Conflict resolution requires action: approve|reject.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution request validation failed.",
            });
            return;
          }
          if (
            body.selectedSourceId !== undefined &&
            typeof body.selectedSourceId !== "string"
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: "selectedSourceId must be a string when provided.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution request validation failed.",
            });
            return;
          }
          if (
            body.selectedNormalizedValue !== undefined &&
            typeof body.selectedNormalizedValue !== "string"
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message:
                  "selectedNormalizedValue must be a string when provided.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution request validation failed.",
            });
            return;
          }
          if (body.note !== undefined && typeof body.note !== "string") {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: "note must be a string when provided.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution request validation failed.",
            });
            return;
          }

          const resolution = await resolveInspectorConflict({
            runDir: path.join(testIntelligenceArtifactRoot, route.jobId),
            jobId: route.jobId,
            conflictId: route.conflictId,
            actor: auth.authorHandle,
            at: new Date().toISOString(),
            action: body.action,
            ...(typeof body.selectedSourceId === "string"
              ? { selectedSourceId: body.selectedSourceId }
              : {}),
            ...(typeof body.selectedNormalizedValue === "string"
              ? { selectedNormalizedValue: body.selectedNormalizedValue }
              : {}),
            ...(typeof body.note === "string" && body.note.trim().length > 0
              ? { note: body.note.trim() }
              : {}),
          });
          if (!resolution.ok) {
            sendValidationError({
              statusCode: resolution.code === "conflict_not_found" ? 404 : 409,
              payload: {
                error: resolution.code,
                message:
                  resolution.code === "conflict_not_found"
                    ? `No multi-source conflict '${route.conflictId}' exists for job '${route.jobId}'.`
                    : "Conflict resolution request was invalid for the targeted conflict.",
              },
              jobId: route.jobId,
              fallbackMessage: "Conflict resolution failed.",
            });
            return;
          }
          const refreshResult = await readInspectorTestIntelligenceBundle({
            rootDir: testIntelligenceArtifactRoot,
            jobId: route.jobId,
            assembledAt: new Date().toISOString(),
          });
          if (refreshResult.ok && refreshResult.bundle.policyReport) {
            await getReviewStore().refreshPolicyDecisions({
              jobId: route.jobId,
              policy: refreshResult.bundle.policyReport,
              at: new Date().toISOString(),
            });
          }
          sendJson({
            response,
            statusCode: 200,
            payload: {
              ok: true,
              event: resolution.event,
              snapshot: resolution.snapshot,
            },
          });
          return;
        }

        if (route.kind === "jira_paste_source") {
          response.setHeader("allow", "POST");
          if (method !== "POST") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for Jira paste source ingestion on '${pathname}'.`,
              },
            });
            return;
          }

          const multiSourceEnabled =
            resolveTestIntelligenceMultiSourceEnvEnabled() &&
            runtime.testIntelligenceMultiSourceEnabled === true;
          if (!multiSourceEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message:
                  "Jira paste source ingestion requires the multi-source test-intelligence gate.",
                refusals: [
                  ...(!resolveTestIntelligenceMultiSourceEnvEnabled()
                    ? ["multi_source_env_disabled"]
                    : []),
                  ...(runtime.testIntelligenceMultiSourceEnabled === true
                    ? []
                    : ["multi_source_startup_option_disabled"]),
                ],
              },
              jobId: route.jobId,
              fallbackMessage: "Jira paste source ingestion disabled.",
            });
            return;
          }

          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Jira paste write request rejected.",
            });
            return;
          }

          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceReviewBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceReviewBearerToken }
              : {}),
            ...(runtime.testIntelligenceReviewPrincipals !== undefined
              ? { reviewPrincipals: runtime.testIntelligenceReviewPrincipals }
              : {}),
            routeLabel: "Jira paste source ingestion",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Jira paste source ingestion rejected.",
            });
            return;
          }

          const rateLimitResult =
            await testIntelligenceSourceWriteRateLimiter.consume(
              resolveRateLimitClientKey(request),
              route.jobId,
            );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many test-intelligence source writes from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }

          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_JIRA_PASTE_REQUEST_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid Jira paste request body.",
            });
            return;
          }

          if (
            typeof bodyResult.value !== "object" ||
            bodyResult.value === null ||
            Array.isArray(bodyResult.value)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message: "Jira paste request body must be a JSON object.",
              },
              jobId: route.jobId,
              fallbackMessage: "Jira paste request validation failed.",
            });
            return;
          }
          const body = bodyResult.value as JiraPasteRequestBody;
          const unknownFields = Object.keys(body).filter(
            (key) => !ALLOWED_JIRA_PASTE_REQUEST_FIELDS.has(key),
          );
          if (unknownFields.length > 0) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message:
                  "Jira paste request contains unsupported top-level fields.",
                issues: unknownFields.map((field) => ({
                  path: field,
                  message: "Unsupported field.",
                })),
              },
              jobId: route.jobId,
              fallbackMessage: "Jira paste request validation failed.",
            });
            return;
          }
          const pasteBody = body.body ?? body.paste;
          const format = body.format ?? "auto";
          if (
            typeof pasteBody !== "string" ||
            typeof format !== "string" ||
            !["auto", "adf_json", "plain_text", "markdown"].includes(format)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_BODY",
                message:
                  "Jira paste request requires body:string and format:auto|adf_json|plain_text|markdown.",
              },
              jobId: route.jobId,
              fallbackMessage: "Jira paste request validation failed.",
            });
            return;
          }

          const runDir = path.join(testIntelligenceArtifactRoot, route.jobId);
          const ingest = await ingestAndPersistJiraPaste({
            runDir,
            authorHandle: auth.authorHandle,
            request: {
              jobId: route.jobId,
              body: pasteBody,
              format: format as JiraPasteDeclaredFormat,
            },
          });
          if (!ingest.ok) {
            const payload: Record<string, unknown> = {
              error: ingest.code,
              message: ingest.message,
            };
            if (ingest.detail !== undefined) payload.detail = ingest.detail;
            if (ingest.statusCode >= 500) {
              sendRequestFailure({
                statusCode: ingest.statusCode,
                payload,
                jobId: route.jobId,
                fallbackMessage: "Jira paste source ingestion failed.",
              });
            } else {
              sendValidationError({
                statusCode: ingest.statusCode,
                payload,
                jobId: route.jobId,
                fallbackMessage: "Jira paste request validation failed.",
              });
            }
            return;
          }

          const sourceEnvelope = buildJiraPasteOnlyEnvelope(
            ingest.result.sourceRef,
          );
          logAuditEvent({
            event: "workspace.jira_paste_source.ingested",
            statusCode: 200,
            jobId: route.jobId,
            message: `Jira paste source '${ingest.result.sourceId}' ingested for job '${route.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: {
              ok: true,
              jobId: route.jobId,
              sourceId: ingest.result.sourceId,
              jiraIssueIr: ingest.result.jiraIssueIr,
              provenance: ingest.result.provenance,
              sourceRef: ingest.result.sourceRef,
              sourceEnvelope,
              sourceMixHint: ingest.result.sourceMixHint,
              artifacts: {
                jiraIssueIr: `sources/${ingest.result.sourceId}/jira-issue-ir.json`,
                pasteProvenance: `sources/${ingest.result.sourceId}/paste-provenance.json`,
                rawPastePersisted: false,
              },
            },
          });
          return;
        }

        if (route.kind === "custom_context_source") {
          response.setHeader("allow", "POST");
          if (method !== "POST") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for custom context source ingestion on '${pathname}'.`,
              },
            });
            return;
          }

          const multiSourceEnabled =
            resolveTestIntelligenceMultiSourceEnvEnabled() &&
            runtime.testIntelligenceMultiSourceEnabled === true;
          if (!multiSourceEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message:
                  "Custom context source ingestion requires the multi-source test-intelligence gate.",
                refusals: [
                  ...(!resolveTestIntelligenceMultiSourceEnvEnabled()
                    ? ["multi_source_env_disabled"]
                    : []),
                  ...(runtime.testIntelligenceMultiSourceEnabled === true
                    ? []
                    : ["multi_source_startup_option_disabled"]),
                ],
              },
              jobId: route.jobId,
              fallbackMessage: "Custom context source ingestion disabled.",
            });
            return;
          }

          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Custom context write request rejected.",
            });
            return;
          }

          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceReviewBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceReviewBearerToken }
              : {}),
            ...(runtime.testIntelligenceReviewPrincipals !== undefined
              ? { reviewPrincipals: runtime.testIntelligenceReviewPrincipals }
              : {}),
            routeLabel: "Custom context source ingestion",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Custom context source ingestion rejected.",
            });
            return;
          }

          const rateLimitResult =
            await testIntelligenceSourceWriteRateLimiter.consume(
              resolveRateLimitClientKey(request),
              route.jobId,
            );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many test-intelligence source writes from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }

          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_CUSTOM_CONTEXT_REQUEST_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid custom context request body.",
            });
            return;
          }

          const validated = validateCustomContextInput(bodyResult.value);
          if (!validated.ok) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "INVALID_BODY",
                message: "Custom context request failed validation.",
                issues: validated.issues,
              },
              jobId: route.jobId,
              fallbackMessage: "Custom context request validation failed.",
            });
            return;
          }

          const runDir = path.join(testIntelligenceArtifactRoot, route.jobId);
          const persisted = await persistCustomContext({
            runDir,
            authorHandle: auth.authorHandle,
            ...(validated.value.markdown !== undefined
              ? { markdown: validated.value.markdown }
              : {}),
            ...(validated.value.attributes !== undefined
              ? { attributes: validated.value.attributes }
              : {}),
          });
          if (!persisted.ok) {
            const payload: Record<string, unknown> = {
              error: persisted.code,
              message: persisted.message,
            };
            if (persisted.issues !== undefined) {
              payload.issues = persisted.issues;
            }
            if (persisted.statusCode >= 500) {
              sendRequestFailure({
                statusCode: persisted.statusCode,
                payload,
                jobId: route.jobId,
                fallbackMessage: "Custom context source ingestion failed.",
              });
            } else {
              sendValidationError({
                statusCode: persisted.statusCode,
                payload,
                jobId: route.jobId,
                fallbackMessage: "Custom context request validation failed.",
              });
            }
            return;
          }

          logAuditEvent({
            event: "workspace.custom_context_source.ingested",
            statusCode: 200,
            jobId: route.jobId,
            message: `Custom context source ingested for job '${route.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: {
              ok: true,
              jobId: route.jobId,
              sourceRefs: persisted.result.sourceRefs,
              sourceEnvelope: persisted.result.sourceEnvelope,
              customContext: persisted.result.customContext,
              policySignals: persisted.result.policySignals,
              artifacts: {
                customContext: persisted.result.artifactPaths.map(
                  (artifactPath) =>
                    path
                      .relative(runDir, artifactPath)
                      .replaceAll(path.sep, "/"),
                ),
                rawMarkdownPersisted: false,
                unsanitizedInputPersisted: false,
              },
            },
          });
          return;
        }

        if (route.kind === "jira_write_config") {
          if (method !== "GET" && method !== "PUT" && method !== "POST") {
            response.setHeader("allow", "GET, PUT, POST");
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use GET to read or PUT/POST to update Jira write config on '${pathname}'.`,
              },
            });
            return;
          }

          const configPath = path.join(
            testIntelligenceArtifactRoot,
            ".jira-write-config.json",
          );

          if (method === "GET") {
            const config: {
              outputPathMarkdown?: string;
              useDefaultOutputPath?: boolean;
            } = {};
            try {
              const raw = await readFile(configPath, "utf8");
              const parsed: unknown = JSON.parse(raw);
              if (
                typeof parsed === "object" &&
                parsed !== null &&
                !Array.isArray(parsed)
              ) {
                const record = parsed as Record<string, unknown>;
                if (typeof record.outputPathMarkdown === "string") {
                  config.outputPathMarkdown = record.outputPathMarkdown;
                }
                if (typeof record.useDefaultOutputPath === "boolean") {
                  config.useDefaultOutputPath = record.useDefaultOutputPath;
                }
              }
            } catch {
              // file absent or unreadable — return defaults
            }
            sendJson({
              response,
              statusCode: 200,
              payload: { ok: true, config },
            });
            return;
          }

          // method === "PUT" || method === "POST" — write config
          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              fallbackMessage: "Jira write config request rejected.",
            });
            return;
          }

          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceJiraWriteBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceJiraWriteBearerToken }
              : {}),
            routeLabel: "Jira write config",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              fallbackMessage: "Jira write config rejected.",
            });
            return;
          }

          const bodyResult = await readJsonBody(request, { maxBytes: 4096 });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              fallbackMessage: "Invalid Jira write config body.",
            });
            return;
          }

          const update: {
            outputPathMarkdown?: string;
            useDefaultOutputPath?: boolean;
          } = {};
          const body = bodyResult.value;
          if (
            typeof body === "object" &&
            body !== null &&
            !Array.isArray(body)
          ) {
            const record = body as Record<string, unknown>;
            if (typeof record.outputPathMarkdown === "string") {
              const pathValidation = validateJiraWriteMarkdownPath(
                record.outputPathMarkdown,
              );
              if (!pathValidation.ok) {
                sendValidationError({
                  payload: {
                    error: "INVALID_PATH",
                    message: pathValidation.message,
                  },
                  fallbackMessage: "Invalid Jira write config path.",
                });
                return;
              }
              update.outputPathMarkdown = pathValidation.value;
            }
            if (typeof record.useDefaultOutputPath === "boolean") {
              update.useDefaultOutputPath = record.useDefaultOutputPath;
            }
          }
          if (
            update.useDefaultOutputPath === false &&
            (update.outputPathMarkdown === undefined ||
              update.outputPathMarkdown.length === 0)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_PATH",
                message:
                  "outputPathMarkdown is required when useDefaultOutputPath is false.",
              },
              fallbackMessage: "Invalid Jira write config path.",
            });
            return;
          }

          try {
            await mkdir(path.dirname(configPath), { recursive: true });
            const tmp = `${configPath}.${String(process.pid)}.${randomUUID()}.tmp`;
            await writeFile(tmp, JSON.stringify(update, null, 2), "utf8");
            await rename(tmp, configPath);
          } catch (err) {
            const message = sanitizeErrorMessage({
              error: err,
              fallback: "Jira write config persistence failed.",
            });
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "CONFIG_WRITE_FAILED",
                message,
              },
              fallbackMessage: "Jira write config persistence failed.",
            });
            return;
          }

          sendJson({
            response,
            statusCode: 200,
            payload: { ok: true, config: update },
          });
          return;
        }

        if (route.kind === "jira_write_start") {
          response.setHeader("allow", "POST");
          if (method !== "POST") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST to start Jira sub-task writes on '${pathname}'.`,
              },
            });
            return;
          }

          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              jobId: route.jobId,
              fallbackMessage: "Jira write request rejected.",
            });
            return;
          }

          const auth = validateTestIntelligenceSourceAuth({
            request,
            ...(runtime.testIntelligenceJiraWriteBearerToken !== undefined
              ? { bearerToken: runtime.testIntelligenceJiraWriteBearerToken }
              : {}),
            routeLabel: "Jira sub-task write",
          });
          if (!auth.ok) {
            if (auth.wwwAuthenticate) {
              response.setHeader("www-authenticate", auth.wwwAuthenticate);
            }
            sendAuditedError({
              statusCode: auth.statusCode,
              payload: auth.payload,
              event:
                auth.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: auth.statusCode === 401 ? "warn" : "error",
              jobId: route.jobId,
              fallbackMessage: "Jira sub-task write rejected.",
            });
            return;
          }

          const rateLimitResult =
            await testIntelligenceWriteRateLimiter.consume(
              resolveRateLimitClientKey(request),
              route.jobId,
            );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many Jira write requests from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }

          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_SUBMIT_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid Jira write request body.",
            });
            return;
          }

          const body = bodyResult.value;
          const isObjectBody =
            typeof body === "object" && body !== null && !Array.isArray(body);
          const record = isObjectBody
            ? (body as Record<string, unknown>)
            : undefined;
          const parentIssueKey =
            record !== undefined && typeof record.parentIssueKey === "string"
              ? record.parentIssueKey.trim()
              : "";
          const dryRun =
            record !== undefined && record.dryRun === false ? false : true;
          const outputPathMarkdown =
            record !== undefined &&
            typeof record.outputPathMarkdown === "string"
              ? record.outputPathMarkdown.trim()
              : undefined;
          const useDefaultOutputPath =
            record !== undefined &&
            typeof record.useDefaultOutputPath === "boolean"
              ? record.useDefaultOutputPath
              : undefined;
          if (
            useDefaultOutputPath === false &&
            (outputPathMarkdown === undefined ||
              outputPathMarkdown.length === 0)
          ) {
            sendValidationError({
              payload: {
                error: "INVALID_PATH",
                message:
                  "outputPathMarkdown is required when useDefaultOutputPath is false.",
              },
              jobId: route.jobId,
              fallbackMessage: "Invalid Jira write output path.",
            });
            return;
          }
          if (outputPathMarkdown !== undefined) {
            const pathValidation =
              validateJiraWriteMarkdownPath(outputPathMarkdown);
            if (!pathValidation.ok) {
              sendValidationError({
                payload: {
                  error: "INVALID_PATH",
                  message: pathValidation.message,
                },
                jobId: route.jobId,
                fallbackMessage: "Invalid Jira write output path.",
              });
              return;
            }
          }

          const bundleResult = await readInspectorTestIntelligenceBundle({
            rootDir: testIntelligenceArtifactRoot,
            jobId: route.jobId,
            assembledAt: new Date().toISOString(),
          });
          if (!bundleResult.ok) {
            sendRequestFailure({
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `No test-intelligence artifacts for job '${route.jobId}'.`,
              },
              jobId: route.jobId,
              fallbackMessage: "Job artifacts not found.",
            });
            return;
          }

          const bundle = bundleResult.bundle;
          if (
            !bundle.generatedTestCases ||
            !bundle.policyReport ||
            !bundle.validationReport ||
            !bundle.reviewSnapshot
          ) {
            sendRequestFailure({
              statusCode: 422,
              payload: {
                error: "ARTIFACTS_INCOMPLETE",
                message:
                  "Required job artifacts missing (generated test cases, policy report, validation report, review snapshot). Run validation and review pipeline first.",
              },
              jobId: route.jobId,
              fallbackMessage: "Job artifacts incomplete.",
            });
            return;
          }

          const adminEnabled = runtime.testIntelligenceAllowJiraWrite === true;
          const writeClient =
            runtime.testIntelligenceJiraWriteClient ??
            createUnconfiguredJiraWriteClient();
          const runDir = path.join(testIntelligenceArtifactRoot, route.jobId);
          const markdownOutputDir =
            useDefaultOutputPath === true || outputPathMarkdown === undefined
              ? path.join(runDir, JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY)
              : outputPathMarkdown;
          const outputPreflight =
            await preflightJiraWriteMarkdownDir(markdownOutputDir);
          if (!outputPreflight.ok) {
            sendValidationError({
              payload: {
                error: "INVALID_PATH",
                message: outputPreflight.message,
              },
              jobId: route.jobId,
              fallbackMessage: "Jira write output path is not writable.",
            });
            return;
          }

          const result = await runJiraSubtaskWrite(
            {
              jobId: route.jobId,
              parentIssueKey,
              mode: "jira_subtasks",
              dryRun,
              ...(outputPathMarkdown !== undefined
                ? { outputPathMarkdown }
                : {}),
              ...(useDefaultOutputPath !== undefined
                ? { useDefaultOutputPath }
                : {}),
              approvedTestCases: bundle.generatedTestCases,
              policyReport: bundle.policyReport,
              validationReport: bundle.validationReport,
              ...(bundle.visualSidecarReport !== undefined
                ? { visualSidecarValidation: bundle.visualSidecarReport }
                : {}),
              reviewGateSnapshot: bundle.reviewSnapshot,
              runDir,
              ...(runtime.testIntelligenceJiraWriteBearerToken !== undefined
                ? {
                    bearerToken: runtime.testIntelligenceJiraWriteBearerToken,
                  }
                : {}),
              featureEnabled: resolveTestIntelligenceEnabled(),
              adminEnabled,
              clock: { now: () => new Date().toISOString() },
              ...(auth.authorHandle.length > 0
                ? { actor: auth.authorHandle }
                : {}),
            },
            writeClient,
          );

          logAuditEvent({
            event: "workspace.jira_write.run_completed",
            statusCode: result.refused ? 422 : 200,
            jobId: route.jobId,
            message: result.refused
              ? `Jira write refused for job '${route.jobId}': ${result.refusalCodes.join(",")}.`
              : `Jira write completed for job '${route.jobId}': created=${String(result.createdCount)} skipped=${String(result.skippedDuplicateCount)} failed=${String(result.failedCount)} dryRun=${String(result.dryRunCount)}.`,
            level: result.refused ? "warn" : "info",
          });

          sendJson({
            response,
            statusCode: result.refused ? 422 : 200,
            payload: {
              ok: !result.refused,
              jobId: route.jobId,
              refused: result.refused,
              refusalCodes: result.refusalCodes,
              dryRun: result.dryRun,
              totalCases: result.totalCases,
              createdCount: result.createdCount,
              skippedDuplicateCount: result.skippedDuplicateCount,
              failedCount: result.failedCount,
              dryRunCount: result.dryRunCount,
              markdownOutputPath: result.markdownOutputPath,
              subtaskOutcomes: result.subtaskOutcomes,
            },
          });
          return;
        }

        if (method === "GET") {
          if (route.kind === "list_jobs") {
            const summaries = await listInspectorTestIntelligenceJobs(
              testIntelligenceArtifactRoot,
            );
            sendJson({
              response,
              statusCode: 200,
              payload: { jobs: summaries },
            });
            return;
          }
          if (route.kind === "list_sources") {
            const multiSourceEnabled =
              resolveTestIntelligenceMultiSourceEnvEnabled() &&
              runtime.testIntelligenceMultiSourceEnabled === true;
            if (!multiSourceEnabled) {
              sendRequestFailure({
                statusCode: 503,
                payload: {
                  error: ErrorCode.FEATURE_DISABLED,
                  message:
                    "Source listing requires the multi-source test-intelligence gate.",
                },
                jobId: route.jobId,
                fallbackMessage: "Source listing disabled.",
              });
              return;
            }
            const sources = await listInspectorSourceRecords(
              path.join(testIntelligenceArtifactRoot, route.jobId),
            );
            sendJson({
              response,
              statusCode: 200,
              payload: { jobId: route.jobId, sources },
            });
            return;
          }
          if (route.kind === "read_bundle") {
            const result = await readInspectorTestIntelligenceBundle({
              rootDir: testIntelligenceArtifactRoot,
              jobId: route.jobId,
              assembledAt: new Date().toISOString(),
            });
            if (!result.ok) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `No test-intelligence artifacts for job '${route.jobId}'.`,
                },
              });
              return;
            }
            sendJson({
              response,
              statusCode: 200,
              payload: result.bundle,
            });
            return;
          }
          if (route.kind === "customer_markdown_export") {
            const exportResult = await readCustomerMarkdownArtifact({
              artifactRoot: testIntelligenceArtifactRoot,
              jobId: route.jobId,
            });
            if (!exportResult.ok) {
              const statusCode =
                exportResult.reason === "path_outside_root" ? 400 : 404;
              const errorCode =
                exportResult.reason === "path_outside_root"
                  ? "INVALID_PATH"
                  : "JOB_NOT_FOUND";
              const message =
                exportResult.reason === "path_outside_root"
                  ? "Job id resolves outside the test-intelligence artifact root."
                  : `No customer Markdown artifact for job '${route.jobId}'.`;
              sendJson({
                response,
                statusCode,
                payload: { error: errorCode, message },
              });
              return;
            }
            const attachmentName = buildCustomerMarkdownAttachmentName(
              route.jobId,
            );
            response.setHeader(
              "content-disposition",
              `attachment; filename="${attachmentName}"`,
            );
            sendText({
              response,
              statusCode: 200,
              contentType: "text/markdown; charset=utf-8",
              payload: exportResult.combinedMarkdown,
            });
            return;
          }
          if (route.kind === "review_state") {
            const reviewResponse = await handleReviewRequest(
              {
                bearerToken: runtime.testIntelligenceReviewBearerToken,
                ...(runtime.testIntelligenceReviewPrincipals !== undefined
                  ? {
                      reviewPrincipals:
                        runtime.testIntelligenceReviewPrincipals,
                    }
                  : {}),
                authorizationHeader:
                  typeof request.headers.authorization === "string"
                    ? request.headers.authorization
                    : undefined,
                method: "GET",
                action: "state",
                jobId: route.jobId,
                at: new Date().toISOString(),
              },
              getReviewStore(),
            );
            if (reviewResponse.wwwAuthenticate) {
              response.setHeader(
                "www-authenticate",
                reviewResponse.wwwAuthenticate,
              );
            }
            sendJson({
              response,
              statusCode: reviewResponse.statusCode,
              payload: reviewResponse.body,
            });
            return;
          }
          // review_action under GET is method-not-allowed.
          response.setHeader("allow", "POST");
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for review actions on '${pathname}'.`,
            },
          });
          return;
        }

        if (method === "POST") {
          if (route.kind !== "review_action") {
            response.setHeader("allow", "GET");
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `POST is not allowed on '${pathname}'.`,
              },
            });
            return;
          }

          const writeRequestValidation = validateWriteRequest({
            request,
            host,
            port: getResolvedPort(),
          });
          if (!writeRequestValidation.ok) {
            sendAuditedError({
              statusCode: writeRequestValidation.statusCode,
              payload: writeRequestValidation.payload,
              event:
                writeRequestValidation.payload.error ===
                "UNSUPPORTED_MEDIA_TYPE"
                  ? "security.request.unsupported_media_type"
                  : "security.request.rejected_origin",
              level: "warn",
              fallbackMessage: "Write request rejected.",
            });
            return;
          }

          const rateLimitResult =
            await testIntelligenceWriteRateLimiter.consume(
              resolveRateLimitClientKey(request),
              route.jobId,
            );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many test-intelligence review writes from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }

          const bodyResult = await readJsonBody(request, {
            maxBytes: MAX_SUBMIT_BODY_BYTES,
          });
          if (!bodyResult.ok) {
            sendRequestFailure({
              statusCode: bodyResult.reason === "OVERSIZE" ? 413 : 400,
              payload: {
                error:
                  bodyResult.reason === "OVERSIZE"
                    ? "REQUEST_TOO_LARGE"
                    : "INVALID_BODY",
                message: bodyResult.error,
              },
              fallbackMessage: "Invalid review request body.",
            });
            return;
          }

          const envelope = buildReviewEnvelopeFromBody({
            body: bodyResult.value,
            method: "POST",
            action: route.action,
            jobId: route.jobId,
            ...(route.testCaseId !== undefined
              ? { testCaseId: route.testCaseId }
              : {}),
            bearerToken: runtime.testIntelligenceReviewBearerToken,
            reviewPrincipals: runtime.testIntelligenceReviewPrincipals,
            authorizationHeader:
              typeof request.headers.authorization === "string"
                ? request.headers.authorization
                : undefined,
          });
          if (!envelope.ok) {
            sendValidationError({
              payload: {
                error: envelope.error,
                message: envelope.message,
              },
              fallbackMessage: "Review request validation failed.",
            });
            return;
          }

          const reviewResponse = await handleReviewRequest(
            envelope.envelope,
            getReviewStore(),
          );
          if (reviewResponse.wwwAuthenticate) {
            response.setHeader(
              "www-authenticate",
              reviewResponse.wwwAuthenticate,
            );
          }
          sendJson({
            response,
            statusCode: reviewResponse.statusCode,
            payload: reviewResponse.body,
          });
          return;
        }

        if (method === "OPTIONS") {
          response.setHeader(
            "allow",
            route.kind === "review_action" ? "POST" : "GET",
          );
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Test-intelligence route '${pathname}' does not support cross-origin browser preflight requests.`,
            },
          });
          return;
        }

        response.setHeader(
          "allow",
          route.kind === "review_action" ? "POST" : "GET",
        );
        sendJson({
          response,
          statusCode: 405,
          payload: {
            error: "METHOD_NOT_ALLOWED",
            message: `Method ${method} is not allowed on '${pathname}'.`,
          },
        });
        return;
      }

      // Issue #1380: GET /workspace/jobs/:jobId/evidence/verify — read-only
      // governance audit endpoint that wraps the local Wave 1 POC evidence
      // verifier (#1366) and (when present) the in-toto attestation
      // verifier (#1377). Bearer-protected per the existing governance
      // convention; per-IP rate limited; feature-gated identically to
      // /workspace/test-intelligence/... since the underlying capability
      // is test-intelligence-only.
      if (
        pathname.startsWith("/workspace/jobs/") &&
        (pathname.endsWith("/evidence/verify") ||
          pathname.endsWith("/evidence/verify/"))
      ) {
        const testIntelligenceGatesEnabled =
          resolveTestIntelligenceEnabled() &&
          runtime.testIntelligenceEnabled === true;
        if (!testIntelligenceGatesEnabled) {
          sendJson({
            response,
            statusCode: 503,
            payload: {
              error: ErrorCode.FEATURE_DISABLED,
              message: `Test intelligence is disabled. Enable WorkspaceStartOptions.testIntelligence.enabled and set ${TEST_INTELLIGENCE_ENV}=1.`,
            },
          });
          return;
        }

        const parsed = parseEvidenceVerifyRoute(pathname);
        if (!parsed.ok) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "NOT_FOUND",
              message: `Unknown route: ${method} ${pathname}`,
            },
          });
          return;
        }
        const route = parsed.route;

        if (method !== "GET") {
          response.setHeader("allow", "GET");
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use GET for evidence verification on '${pathname}'.`,
            },
          });
          return;
        }

        const routeLabel = "Workspace evidence verification";
        const configuredBearerToken = runtime.testIntelligenceReviewBearerToken;
        const trimmedBearerToken =
          typeof configuredBearerToken === "string"
            ? configuredBearerToken.trim()
            : "";
        if (trimmedBearerToken.length === 0) {
          sendAuditedError({
            statusCode: 503,
            payload: {
              error: "AUTHENTICATION_UNAVAILABLE",
              message: `${routeLabel} reads are disabled until server bearer authentication is configured.`,
            },
            event: "workspace.request.failed",
            level: "error",
            jobId: route.jobId,
            fallbackMessage: `${routeLabel} read rejected.`,
          });
          return;
        }
        const bearerAuth = validateImportSessionEventWriteAuth({
          request,
          bearerToken: trimmedBearerToken,
          routeLabel,
        });
        if (!bearerAuth.ok) {
          if (bearerAuth.wwwAuthenticate) {
            response.setHeader("www-authenticate", bearerAuth.wwwAuthenticate);
          }
          const auditMessage =
            bearerAuth.payload.error === "UNAUTHORIZED"
              ? `${routeLabel} reads require a valid Bearer token.`
              : bearerAuth.payload.message;
          sendAuditedError({
            statusCode: bearerAuth.statusCode,
            payload: {
              error: bearerAuth.payload.error,
              message: auditMessage,
            },
            event:
              bearerAuth.payload.error === "UNAUTHORIZED"
                ? "security.request.unauthorized"
                : "workspace.request.failed",
            level: bearerAuth.statusCode === 401 ? "warn" : "error",
            jobId: route.jobId,
            fallbackMessage: `${routeLabel} read rejected.`,
          });
          return;
        }

        const rateLimitResult = await evidenceVerifyReadRateLimiter.consume(
          resolveRateLimitClientKey(request),
          route.jobId,
        );
        if (!rateLimitResult.allowed) {
          sendRateLimitExceeded({
            retryAfterSeconds: rateLimitResult.retryAfterSeconds,
            message: `Too many evidence verification requests from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
          });
          return;
        }

        const verifyResult = await verifyJobEvidence({
          artifactsRoot: testIntelligenceArtifactRoot,
          jobId: route.jobId,
          verifiedAt: new Date().toISOString(),
        });
        if (verifyResult.status === "job_not_found") {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "JOB_NOT_FOUND",
              message: `No evidence for job '${route.jobId}'.`,
            },
          });
          return;
        }
        if (verifyResult.status === "no_evidence") {
          sendJson({
            response,
            statusCode: 409,
            payload: {
              error: "EVIDENCE_NOT_AVAILABLE",
              message: `Evidence has not been written for job '${route.jobId}'.`,
            },
          });
          return;
        }
        logAuditEvent({
          event: "workspace.evidence.verify.completed",
          message: `Evidence verification ${verifyResult.body.ok ? "passed" : "FAILED"} for job '${route.jobId}' (${verifyResult.body.failures.length} failure(s), ${verifyResult.body.checks.length} check(s)).`,
          jobId: route.jobId,
          statusCode: 200,
          level: verifyResult.body.ok ? "info" : "warn",
        });
        sendJson({
          response,
          statusCode: 200,
          payload: verifyResult.body,
        });
        return;
      }

      if (method === "GET" && pathname === "/workspace/inspector-policy") {
        const result = await loadInspectorPolicy({ workspaceRoot });
        if (result.warning) {
          logAuditEvent({
            event: "workspace.inspector_policy.invalid",
            level: result.validation.state === "rejected" ? "error" : "warn",
            statusCode: 200,
            message: result.warning,
          });
        }
        sendJson({
          response,
          statusCode: 200,
          payload: {
            policy: result.policy,
            validation: result.validation,
            ...(result.warning ? { warning: result.warning } : {}),
          },
        });
        return;
      }

      if (method === "GET" && pathname === "/workspace/import-sessions") {
        const sessions = await jobEngine.listImportSessions();
        sendJson({
          response,
          statusCode: 200,
          payload: { sessions },
        });
        return;
      }

      if (method === "GET") {
        const parsedJobRoute = parseJobRoute(pathname);
        if (parsedJobRoute) {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          if (parsedJobRoute.action === "result") {
            const jobResult = jobEngine.getJobResult(jobId);
            if (!jobResult) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }
            sendJson({ response, statusCode: 200, payload: jobResult });
            return;
          }

          if (parsedJobRoute.action === "cancel") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for cancellation route '/workspace/jobs/${jobId}/cancel'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "regenerate") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for regeneration route '/workspace/jobs/${jobId}/regenerate'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "retry-stage") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for retry route '/workspace/jobs/${jobId}/retry-stage'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "sync") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for local sync route '/workspace/jobs/${jobId}/sync'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "create-pr") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for PR creation route '/workspace/jobs/${jobId}/create-pr'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "stale-check") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for stale-check route '/workspace/jobs/${jobId}/stale-check'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "remap-suggest") {
            sendJson({
              response,
              statusCode: 405,
              payload: {
                error: "METHOD_NOT_ALLOWED",
                message: `Use POST for remap-suggest route '/workspace/jobs/${jobId}/remap-suggest'.`,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "token-decisions") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const decisionsPath = path.join(
              record.artifacts.jobDir,
              TOKEN_DECISIONS_FILE_NAME,
            );
            try {
              const raw = await readFile(decisionsPath, "utf8");
              const parsed = JSON.parse(raw) as unknown;
              if (
                parsed !== null &&
                typeof parsed === "object" &&
                isStringArray(
                  (parsed as { acceptedTokenNames?: unknown })
                    .acceptedTokenNames,
                ) &&
                isStringArray(
                  (parsed as { rejectedTokenNames?: unknown })
                    .rejectedTokenNames,
                )
              ) {
                const typed = parsed as PersistedTokenDecisions;
                sendJson({
                  response,
                  statusCode: 200,
                  payload: {
                    jobId,
                    updatedAt:
                      typeof typed.updatedAt === "string"
                        ? typed.updatedAt
                        : null,
                    acceptedTokenNames: typed.acceptedTokenNames,
                    rejectedTokenNames: typed.rejectedTokenNames,
                  },
                });
                return;
              }
            } catch {
              // Fall through to the empty-state response so callers can treat
              // "never persisted" and "persisted empty" identically.
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                updatedAt: null,
                acceptedTokenNames: [],
                rejectedTokenNames: [],
              },
            });
            return;
          }

          if (parsedJobRoute.action === "design-ir") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const isPending =
              record.status === "queued" || record.status === "running";

            const designIrPath = record.artifacts.designIrFile;
            if (!designIrPath) {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "DESIGN_IR_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — design IR is not available yet.`
                    : `Design IR artifact not available for job '${jobId}'.`,
                },
              });
              return;
            }

            let rawIr: unknown;
            try {
              const content = await readFile(designIrPath, "utf8");
              rawIr = JSON.parse(content) as unknown;
            } catch {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "DESIGN_IR_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — design IR is not available yet.`
                    : `Design IR file not found on disk for job '${jobId}'.`,
                },
              });
              return;
            }

            const irData = rawIr as {
              sourceName?: string;
              screens?: ScreenIR[];
              tokens?: unknown;
            };

            const screens: ScreenIR[] = Array.isArray(irData.screens)
              ? irData.screens
              : [];
            const identities = buildScreenArtifactIdentities(screens);

            const enrichedScreens = screens.map((screen) => {
              const identity = identities.get(screen.id);
              return {
                ...screen,
                ...(identity ? { generatedFile: identity.filePath } : {}),
              };
            });

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                sourceName: irData.sourceName ?? null,
                screens: enrichedScreens,
                tokens: irData.tokens ?? null,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "figma-analysis") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const isPending =
              record.status === "queued" || record.status === "running";

            const figmaAnalysisPath = record.artifacts.figmaAnalysisFile;
            if (!figmaAnalysisPath) {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "FIGMA_ANALYSIS_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — figma analysis is not ready yet.`
                    : `Figma analysis artifact not available for job '${jobId}'.`,
                },
              });
              return;
            }

            let figmaAnalysis: unknown;
            try {
              figmaAnalysis = JSON.parse(
                await readFile(figmaAnalysisPath, "utf8"),
              ) as unknown;
            } catch {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "FIGMA_ANALYSIS_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — figma analysis is not ready yet.`
                    : `Figma analysis file not found on disk for job '${jobId}'.`,
                },
              });
              return;
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                ...(figmaAnalysis && typeof figmaAnalysis === "object"
                  ? (figmaAnalysis as Record<string, unknown>)
                  : {}),
                jobId,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "component-manifest") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const isPending =
              record.status === "queued" || record.status === "running";

            const manifestPath = record.artifacts.componentManifestFile;
            if (!manifestPath) {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "COMPONENT_MANIFEST_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — component manifest is not available yet.`
                    : `Component manifest artifact not available for job '${jobId}'.`,
                },
              });
              return;
            }

            let manifestContent: string;
            try {
              manifestContent = await readFile(manifestPath, "utf8");
            } catch {
              sendJson({
                response,
                statusCode: isPending ? 409 : 404,
                payload: {
                  error: isPending
                    ? "JOB_NOT_COMPLETED"
                    : "COMPONENT_MANIFEST_NOT_FOUND",
                  message: isPending
                    ? `Job '${jobId}' has status '${record.status}' — component manifest is not available yet.`
                    : `Component manifest file not found on disk for job '${jobId}'.`,
                },
              });
              return;
            }

            let manifest: unknown;
            try {
              manifest = JSON.parse(manifestContent) as unknown;
            } catch {
              sendJson({
                response,
                statusCode: 500,
                payload: {
                  error: "INTERNAL_ERROR",
                  message: `Failed to parse component manifest for job '${jobId}'.`,
                },
              });
              return;
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                ...(manifest as Record<string, unknown>),
              },
            });
            return;
          }

          if (parsedJobRoute.action === "screenshot") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const artifactStore = new StageArtifactStore({
              jobDir: record.artifacts.jobDir,
            });
            const enrichment = await artifactStore.getValue<FigmaMcpEnrichment>(
              STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
            );
            const screenshotUrl = readScreenshotUrlFromEnrichment(enrichment);
            if (!screenshotUrl) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "SCREENSHOT_NOT_FOUND",
                  message: `Screenshot artifact not available for job '${jobId}'.`,
                },
              });
              return;
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                screenshotUrl,
                url: screenshotUrl,
              },
            });
            return;
          }

          if (parsedJobRoute.action === "token-intelligence") {
            const record = jobEngine.getJobRecord(jobId);
            if (!record) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Unknown job '${jobId}'.`,
                },
              });
              return;
            }

            const isPending =
              record.status === "queued" || record.status === "running";

            const artifactStore = new StageArtifactStore({
              jobDir: record.artifacts.jobDir,
            });
            const enrichment = await artifactStore.getValue<FigmaMcpEnrichment>(
              STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
            );

            if (!enrichment) {
              sendJson({
                response,
                statusCode: isPending ? 409 : 200,
                payload: isPending
                  ? {
                      error: "JOB_NOT_COMPLETED",
                      message: `Job '${jobId}' has status '${record.status}' — token intelligence is not available yet.`,
                    }
                  : {
                      jobId,
                      conflicts: [],
                      unmappedVariables: [],
                      libraryKeys: [],
                      cssCustomProperties: null,
                      codeConnectMappings: [],
                      designSystemMappings: [],
                      heuristicComponentMappings: [],
                    },
              });
              return;
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                conflicts: enrichment.conflicts ?? [],
                unmappedVariables: enrichment.unmappedVariables ?? [],
                libraryKeys: enrichment.libraryKeys ?? [],
                cssCustomProperties: enrichment.cssCustomProperties ?? null,
                codeConnectMappings: enrichment.codeConnectMappings ?? [],
                designSystemMappings: enrichment.designSystemMappings ?? [],
                heuristicComponentMappings:
                  enrichment.heuristicComponentMappings ?? [],
              },
            });
            return;
          }

          const job = jobEngine.getJob(jobId);
          if (!job) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`,
              },
            });
            return;
          }

          sendJson({ response, statusCode: 200, payload: job });
          return;
        }

        const parsedImportSessionRoute = parseImportSessionRoute(pathname);
        if (parsedImportSessionRoute?.action === "reimport") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for re-import route '${pathname}'.`,
            },
          });
          return;
        }

        if (parsedImportSessionRoute?.action === "approve") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for approve route '${pathname}'.`,
            },
          });
          return;
        }

        if (parsedImportSessionRoute?.action === "events") {
          const sessionId = safeDecodeParam(
            parsedImportSessionRoute.sessionId,
            "import session ID",
            response,
          );
          if (sessionId === null) return;

          const sessions = await jobEngine.listImportSessions();
          const sessionExists = sessions.some(
            (entry) => entry.id === sessionId,
          );
          if (!sessionExists) {
            sendRequestFailure({
              statusCode: 404,
              payload: {
                error: "E_IMPORT_SESSION_NOT_FOUND",
                message: `Import session '${sessionId}' not found.`,
              },
              fallbackMessage: "Import session events lookup failed.",
            });
            return;
          }

          try {
            const events = await jobEngine.listImportSessionEvents({
              sessionId,
            });
            sendJson({
              response,
              statusCode: 200,
              payload: { events },
            });
          } catch (error) {
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not list import session events.",
                }),
              },
              fallbackMessage: "Import session events lookup failed.",
            });
          }
          return;
        }

        const parsedFilesRoute = parseJobFilesRoute(pathname);
        if (parsedFilesRoute) {
          const jobId = safeDecodeParam(
            parsedFilesRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const record = jobEngine.getJobRecord(jobId);

          if (!record) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`,
              },
            });
            return;
          }

          if (record.status === "queued") {
            sendJson({
              response,
              statusCode: 409,
              payload: {
                error: "JOB_NOT_COMPLETED",
                message: `Job '${jobId}' has status '${record.status}' — files are only available after generation starts.`,
              },
            });
            return;
          }

          const projectDir = record.artifacts.generatedProjectDir;
          if (!projectDir) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "FILES_NOT_FOUND",
                message: `Generated project directory not available for job '${jobId}'.`,
              },
            });
            return;
          }

          // Directory listing
          if (parsedFilesRoute.filePath === undefined) {
            const dirFilterParam = requestUrl.searchParams.get("dir");
            let dirFilter: string | undefined =
              dirFilterParam !== null ? dirFilterParam : undefined;

            if (dirFilter !== undefined) {
              const dirValidation = validateSourceFilePath(
                `${dirFilter}/placeholder.ts`,
              );
              if (!dirValidation.valid) {
                sendJson({
                  response,
                  statusCode: 403,
                  payload: {
                    error: "FORBIDDEN_PATH",
                    message: dirValidation.reason,
                  },
                });
                return;
              }
              dirFilter = path.posix.dirname(dirValidation.normalizedPath);
            }

            const rawLimit = requestUrl.searchParams.get("limit");
            const parsedLimit =
              rawLimit !== null ? Number.parseInt(rawLimit, 10) : Number.NaN;
            const limit = Number.isFinite(parsedLimit)
              ? Math.min(1000, Math.max(1, parsedLimit))
              : 500;

            const cursorParam = requestUrl.searchParams.get("cursor");

            let listing: CollectSourceFilesResult;
            try {
              listing = await collectSourceFiles(projectDir, dirFilter, {
                limit,
                ...(cursorParam !== null ? { cursor: cursorParam } : {}),
              });
            } catch {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "FILES_NOT_FOUND",
                  message: `Generated project directory not found on disk for job '${jobId}'.`,
                },
              });
              return;
            }

            sendJson({
              response,
              statusCode: 200,
              payload: {
                jobId,
                files: listing.files,
                ...(listing.nextCursor !== undefined
                  ? { nextCursor: listing.nextCursor }
                  : {}),
              },
            });
            return;
          }

          // Single file content
          const filePath = safeDecodeParam(
            parsedFilesRoute.filePath,
            "file path",
            response,
          );
          if (filePath === null) return;
          const validation = validateSourceFilePath(filePath);
          if (!validation.valid) {
            sendJson({
              response,
              statusCode: 403,
              payload: {
                error: "FORBIDDEN_PATH",
                message: validation.reason,
              },
            });
            return;
          }

          const safeFilePath = validation.normalizedPath;
          const absolutePath = path.join(projectDir, safeFilePath);

          // Ensure resolved path stays within projectDir (belt-and-suspenders)
          const resolved = path.resolve(absolutePath);
          const resolvedProjectDir = path.resolve(projectDir);
          if (!resolved.startsWith(`${resolvedProjectDir}/`)) {
            sendJson({
              response,
              statusCode: 403,
              payload: {
                error: "FORBIDDEN_PATH",
                message: "Path escapes project directory.",
              },
            });
            return;
          }

          // Reject symlinks
          try {
            const lstats = await lstat(absolutePath);
            if (lstats.isSymbolicLink()) {
              sendJson({
                response,
                statusCode: 403,
                payload: {
                  error: "FORBIDDEN_PATH",
                  message: "Symbolic links are not allowed.",
                },
              });
              return;
            }
          } catch {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "FILE_NOT_FOUND",
                message: `File '${safeFilePath}' not found in job '${jobId}'.`,
              },
            });
            return;
          }

          let content: string;
          try {
            content = await readFile(absolutePath, "utf8");
          } catch {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "FILE_NOT_FOUND",
                message: `File '${safeFilePath}' not found in job '${jobId}'.`,
              },
            });
            return;
          }

          sendText({
            response,
            statusCode: 200,
            contentType: "text/plain; charset=utf-8",
            payload: content,
          });
          return;
        }

        const parsedJobPreviewRoute = parseJobPreviewRoute(pathname);
        if (parsedJobPreviewRoute) {
          const previewJobId = safeDecodeParam(
            parsedJobPreviewRoute.jobId,
            "preview job ID",
            response,
          );
          if (previewJobId === null) return;
          const previewPath = safeDecodeParam(
            parsedJobPreviewRoute.previewPath,
            "job preview path",
            response,
          );
          if (previewPath === null) return;

          const record = jobEngine.getJobRecord(previewJobId);
          if (!record) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${previewJobId}'.`,
              },
            });
            return;
          }

          const generatedProjectDir = record.artifacts.generatedProjectDir;
          const previewAsset =
            generatedProjectDir === undefined
              ? undefined
              : await resolveGeneratedPreviewAsset({
                  generatedProjectDir,
                  previewPath,
                });

          if (!previewAsset) {
            if (previewPath === "index.html") {
              sendText({
                response,
                statusCode: 202,
                contentType: "text/html; charset=utf-8",
                payload: buildPhase2PreviewPendingHtml(),
                cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
                allowFrameEmbedding: true,
              });
              return;
            }

            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "PREVIEW_NOT_FOUND",
                message: `No phase-2 preview artifact found for '${parsedJobPreviewRoute.jobId}'.`,
              },
            });
            return;
          }

          if (previewAsset.contentType.startsWith("text/html")) {
            const html = previewAsset.content.toString("utf8");
            const injectedHtml = injectInspectBridgeScript(html);
            sendBuffer({
              response,
              statusCode: 200,
              contentType: previewAsset.contentType,
              payload: Buffer.from(injectedHtml, "utf8"),
              cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
              allowFrameEmbedding: true,
            });
            return;
          }

          sendBuffer({
            response,
            statusCode: 200,
            contentType: previewAsset.contentType,
            payload: previewAsset.content,
            cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
            allowFrameEmbedding: true,
          });
          return;
        }

        const parsedReproRoute = parseReproRoute(pathname);
        if (parsedReproRoute) {
          const reproJobId = safeDecodeParam(
            parsedReproRoute.jobId,
            "repro job ID",
            response,
          );
          if (reproJobId === null) return;
          const reproPreviewPath = safeDecodeParam(
            parsedReproRoute.previewPath,
            "repro preview path",
            response,
          );
          if (reproPreviewPath === null) return;
          const previewAsset = await jobEngine.resolvePreviewAsset(
            reproJobId,
            reproPreviewPath,
          );

          if (!previewAsset) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "PREVIEW_NOT_FOUND",
                message: `No preview artifact found for '${parsedReproRoute.jobId}'.`,
              },
            });
            return;
          }

          // Inject inspect-bridge script into HTML responses served from the preview
          if (previewAsset.contentType.startsWith("text/html")) {
            const html = previewAsset.content.toString("utf8");
            const injectedHtml = injectInspectBridgeScript(html);
            sendBuffer({
              response,
              statusCode: 200,
              contentType: previewAsset.contentType,
              payload: Buffer.from(injectedHtml, "utf8"),
              cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
              allowFrameEmbedding: true,
            });
            return;
          }

          sendBuffer({
            response,
            statusCode: 200,
            contentType: previewAsset.contentType,
            payload: previewAsset.content,
            cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
            allowFrameEmbedding: true,
          });
          return;
        }

        if (isForbiddenUiAssetPath(rawPathname)) {
          sendJson({
            response,
            statusCode: 403,
            payload: {
              error: "FORBIDDEN_PATH",
              message: "Path traversal is not allowed for workspace UI assets.",
            },
          });
          return;
        }

        const uiAssetPath = resolveUiAssetPath(rawPathname);
        const shouldServeWorkspaceAlias = isWorkspaceProjectRoute(pathname);
        if (uiAssetPath || shouldServeWorkspaceAlias) {
          try {
            const uiAssets = await getUiAssets(moduleDir);
            const requestedUiAsset = getUiAsset({
              assets: uiAssets,
              assetPath: uiAssetPath ?? "index.html",
            });
            const shouldServeUiEntrypoint =
              shouldServeWorkspaceAlias ||
              uiAssetPath === "index.html" ||
              (requestedUiAsset === undefined &&
                shouldFallbackToUiEntrypoint(rawPathname));
            const uiAsset = shouldServeUiEntrypoint
              ? getUiAsset({
                  assets: uiAssets,
                  assetPath: "index.html",
                })
              : requestedUiAsset;

            if (!uiAsset) {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "NOT_FOUND",
                  message: `Unknown route: ${method} ${pathname}`,
                },
              });
              return;
            }

            const isUiDocumentResponse =
              uiAsset.contentType.startsWith("text/html") &&
              shouldServeUiEntrypoint;
            sendBuffer({
              response,
              statusCode: 200,
              contentType: uiAsset.contentType,
              payload: uiAsset.content,
              cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
              ...(isUiDocumentResponse
                ? {
                    contentSecurityPolicy: WORKSPACE_UI_CONTENT_SECURITY_POLICY,
                  }
                : {}),
            });
            return;
          } catch {
            sendJson({
              response,
              statusCode: 503,
              payload: {
                error: "UI_ASSETS_UNAVAILABLE",
                message:
                  "workspace-dev UI assets are not available in this runtime.",
              },
            });
            return;
          }
        }
      }

      if (method === "OPTIONS") {
        if (!protectedWriteRoute) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "NOT_FOUND",
              message: `Unknown route: ${method} ${pathname}`,
            },
          });
          return;
        }

        const importSessionAction =
          protectedWriteRoute.parsedImportSessionRoute?.action;
        const allowedMethods =
          importSessionAction === "detail"
            ? "DELETE"
            : importSessionAction === "events"
              ? "GET, POST"
              : importSessionAction === "approve"
                ? "POST"
                : "POST";
        response.setHeader("allow", allowedMethods);
        sendJson({
          response,
          statusCode: 405,
          payload: {
            error: "METHOD_NOT_ALLOWED",
            message: `Write route '${pathname}' only supports ${allowedMethods} and does not support cross-origin browser preflight requests.`,
          },
        });
        return;
      }

      if (method === "POST" || method === "DELETE") {
        const parsedJobRoute = protectedWriteRoute?.parsedJobRoute;
        const parsedImportSessionRoute =
          protectedWriteRoute?.parsedImportSessionRoute;

        if (!protectedWriteRoute) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "NOT_FOUND",
              message: `Unknown route: ${method} ${pathname}`,
            },
          });
          return;
        }

        const isImportSessionEventWriteRoute =
          method === "POST" && parsedImportSessionRoute?.action === "events";
        const isImportSessionApproveWriteRoute =
          method === "POST" && parsedImportSessionRoute?.action === "approve";
        const isImportSessionReimportWriteRoute =
          method === "POST" && parsedImportSessionRoute?.action === "reimport";
        const isImportSessionBearerProtectedWriteRoute =
          isImportSessionEventWriteRoute ||
          isImportSessionApproveWriteRoute ||
          isImportSessionReimportWriteRoute;
        if (isImportSessionBearerProtectedWriteRoute) {
          const routeLabel = isImportSessionApproveWriteRoute
            ? "Import session approval"
            : isImportSessionReimportWriteRoute
              ? "Import session re-import"
              : "Import session event";
          const authValidation = validateImportSessionEventWriteAuth({
            request,
            ...(runtime.importSessionEventBearerToken !== undefined
              ? { bearerToken: runtime.importSessionEventBearerToken }
              : {}),
            routeLabel,
          });
          if (!authValidation.ok) {
            if (authValidation.wwwAuthenticate) {
              response.setHeader(
                "www-authenticate",
                authValidation.wwwAuthenticate,
              );
            }
            sendAuditedError({
              statusCode: authValidation.statusCode,
              payload: authValidation.payload,
              event:
                authValidation.payload.error === "UNAUTHORIZED"
                  ? "security.request.unauthorized"
                  : "workspace.request.failed",
              level: authValidation.statusCode === 401 ? "warn" : "error",
              fallbackMessage: `${routeLabel} write rejected.`,
            });
            return;
          }
        }

        const writeRequestValidation = validateWriteRequest({
          request,
          host,
          port: getResolvedPort(),
        });
        if (!writeRequestValidation.ok) {
          sendAuditedError({
            statusCode: writeRequestValidation.statusCode,
            payload: writeRequestValidation.payload,
            event:
              writeRequestValidation.payload.error === "UNSUPPORTED_MEDIA_TYPE"
                ? "security.request.unsupported_media_type"
                : "security.request.rejected_origin",
            level: "warn",
            fallbackMessage: "Write request rejected.",
          });
          return;
        }

        const decodedImportSessionRateLimitSessionId =
          isImportSessionBearerProtectedWriteRoute
            ? safeDecodeParam(
                parsedImportSessionRoute.sessionId,
                "import session ID",
                response,
              )
            : undefined;
        if (decodedImportSessionRateLimitSessionId === null) {
          return;
        }

        const isRateLimitedWriteRoute =
          pathname === "/workspace/submit" ||
          parsedJobRoute?.action === "regenerate" ||
          parsedJobRoute?.action === "retry-stage";
        if (isRateLimitedWriteRoute) {
          const rateLimitResult = await writeRateLimiter.consume(
            resolveRateLimitClientKey(request),
          );
          if (!rateLimitResult.allowed) {
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many job submissions from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }
        }

        if (isImportSessionBearerProtectedWriteRoute) {
          const rateLimitResult = await importSessionEventRateLimiter.consume(
            resolveRateLimitClientKey(request),
            decodedImportSessionRateLimitSessionId,
          );
          if (!rateLimitResult.allowed) {
            const actionLabel = isImportSessionApproveWriteRoute
              ? "import session approval"
              : isImportSessionReimportWriteRoute
                ? "import session re-import"
                : "import session event";
            sendRateLimitExceeded({
              retryAfterSeconds: rateLimitResult.retryAfterSeconds,
              message: `Too many ${actionLabel} writes from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
            });
            return;
          }
        }

        if (
          method === "POST" &&
          parsedImportSessionRoute?.action === "reimport"
        ) {
          const sessionId =
            decodedImportSessionRateLimitSessionId ??
            safeDecodeParam(
              parsedImportSessionRoute.sessionId,
              "import session ID",
              response,
            );
          if (sessionId === null) return;

          try {
            const accepted = await jobEngine.reimportImportSession({
              sessionId,
            });
            sendJson({
              response,
              statusCode: 202,
              payload: accepted,
            });
          } catch (error) {
            const code =
              error instanceof Error && "code" in error
                ? (error as { code?: string }).code
                : undefined;
            sendRequestFailure({
              statusCode:
                code === "E_IMPORT_SESSION_NOT_FOUND"
                  ? 404
                  : code === "E_IMPORT_SESSION_NOT_REPLAYABLE"
                    ? 409
                    : code === "E_IMPORT_SESSION_INVALID_LOCATOR" ||
                        code === "E_IMPORT_SESSION_MISSING_FIGMA_ACCESS_TOKEN"
                      ? 400
                      : 500,
              payload: {
                error: code ?? "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not re-import import session.",
                }),
              },
              fallbackMessage: "Re-import request failed.",
            });
          }
          return;
        }

        if (
          method === "POST" &&
          parsedImportSessionRoute?.action === "approve"
        ) {
          const sessionId =
            decodedImportSessionRateLimitSessionId ??
            safeDecodeParam(
              parsedImportSessionRoute.sessionId,
              "import session ID",
              response,
            );
          if (sessionId === null) return;

          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              fallbackMessage: "Import session approval validation failed.",
            });
            return;
          }

          if (
            rawBody.value !== undefined &&
            (typeof rawBody.value !== "object" ||
              rawBody.value === null ||
              Array.isArray(rawBody.value))
          ) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [
                  {
                    path: "(root)",
                    message:
                      "Approval payload must be an object when provided.",
                  },
                ],
              },
              fallbackMessage: "Import session approval validation failed.",
            });
            return;
          }

          try {
            const approved = await jobEngine.approveImportSession({
              sessionId,
            });
            sendJson({
              response,
              statusCode: 200,
              payload: approved,
            });
          } catch (error) {
            const code =
              error instanceof Error && "code" in error
                ? (error as { code?: string }).code
                : undefined;
            sendRequestFailure({
              statusCode:
                code === "E_IMPORT_SESSION_NOT_FOUND"
                  ? 404
                  : code === "E_IMPORT_SESSION_INVALID_TRANSITION"
                    ? 409
                    : 500,
              payload: {
                error: code ?? "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not approve import session.",
                }),
              },
              fallbackMessage: "Import session approval failed.",
            });
          }
          return;
        }

        if (
          method === "POST" &&
          parsedImportSessionRoute?.action === "events"
        ) {
          const sessionId =
            decodedImportSessionRateLimitSessionId ??
            safeDecodeParam(
              parsedImportSessionRoute.sessionId,
              "import session ID",
              response,
            );
          if (sessionId === null) return;

          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              fallbackMessage: "Import session event validation failed.",
            });
            return;
          }

          if (
            typeof rawBody.value !== "object" ||
            rawBody.value === null ||
            Array.isArray(rawBody.value)
          ) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [
                  {
                    path: "(root)",
                    message: "Event payload must be an object.",
                  },
                ],
              },
              fallbackMessage: "Import session event validation failed.",
            });
            return;
          }

          const body = rawBody.value as Record<string, unknown>;

          if (!isImportSessionEventKind(body.kind)) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [
                  {
                    path: "kind",
                    message:
                      "kind is required and must be a known WorkspaceImportSessionEventKind.",
                  },
                ],
              },
              fallbackMessage: "Import session event validation failed.",
            });
            return;
          }

          if (body.note !== undefined && typeof body.note !== "string") {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [
                  {
                    path: "note",
                    message: "note must be a string when provided.",
                  },
                ],
              },
              fallbackMessage: "Import session event validation failed.",
            });
            return;
          }

          if (
            body.metadata !== undefined &&
            !isFlatEventMetadata(body.metadata)
          ) {
            sendValidationError({
              statusCode: 422,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [
                  {
                    path: "metadata",
                    message:
                      "metadata must be a flat record of string, number, boolean, or null values.",
                  },
                ],
              },
              fallbackMessage: "Import session event validation failed.",
            });
            return;
          }

          const incoming: WorkspaceImportSessionEvent = {
            id: typeof body.id === "string" ? body.id : "",
            sessionId,
            kind: body.kind,
            at: "",
            ...(typeof body.note === "string" ? { note: body.note } : {}),
            ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          };

          try {
            const stored = await jobEngine.appendImportSessionEvent({
              event: incoming,
            });
            sendJson({
              response,
              statusCode: 201,
              payload: stored,
            });
          } catch (error) {
            const code =
              error instanceof Error && "code" in error
                ? (error as { code?: string }).code
                : undefined;
            sendRequestFailure({
              statusCode:
                code === "E_IMPORT_SESSION_NOT_FOUND"
                  ? 404
                  : code === "E_IMPORT_SESSION_INVALID_TRANSITION"
                    ? 409
                    : 500,
              payload: {
                error: code ?? "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not append import session event.",
                }),
              },
              fallbackMessage: "Import session event append failed.",
            });
          }
          return;
        }

        if (
          method === "DELETE" &&
          parsedImportSessionRoute?.action === "detail"
        ) {
          const sessionId = safeDecodeParam(
            parsedImportSessionRoute.sessionId,
            "import session ID",
            response,
          );
          if (sessionId === null) return;

          try {
            const deleted = await jobEngine.deleteImportSession({ sessionId });
            sendJson({
              response,
              statusCode: 200,
              payload: deleted,
            });
          } catch (error) {
            const code =
              error instanceof Error && "code" in error
                ? (error as { code?: string }).code
                : undefined;
            sendRequestFailure({
              statusCode: code === "E_IMPORT_SESSION_NOT_FOUND" ? 404 : 500,
              payload: {
                error: code ?? "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not delete import session.",
                }),
              },
              fallbackMessage: "Delete import session failed.",
            });
          }
          return;
        }

        if (parsedJobRoute?.action === "cancel") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Cancel request validation failed.",
            });
            return;
          }

          let reason: string | undefined;
          if (rawBody.value !== undefined) {
            if (
              typeof rawBody.value !== "object" ||
              rawBody.value === null ||
              Array.isArray(rawBody.value)
            ) {
              sendValidationError({
                payload: {
                  error: "VALIDATION_ERROR",
                  message: "Request validation failed.",
                  issues: [
                    {
                      path: "(root)",
                      message:
                        "Cancel request must be an object when body is provided.",
                    },
                  ],
                },
                jobId,
                fallbackMessage: "Cancel request validation failed.",
              });
              return;
            }

            const payload = rawBody.value as Record<string, unknown>;
            const allowedKeys = new Set(["reason"]);
            const unknownKey = Object.keys(payload).find(
              (key) => !allowedKeys.has(key),
            );
            if (unknownKey) {
              sendValidationError({
                payload: {
                  error: "VALIDATION_ERROR",
                  message: "Request validation failed.",
                  issues: [
                    {
                      path: unknownKey,
                      message: `Unexpected property '${unknownKey}'.`,
                    },
                  ],
                },
                jobId,
                fallbackMessage: "Cancel request validation failed.",
              });
              return;
            }

            if (payload.reason !== undefined) {
              if (
                typeof payload.reason !== "string" ||
                payload.reason.trim().length === 0
              ) {
                sendValidationError({
                  payload: {
                    error: "VALIDATION_ERROR",
                    message: "Request validation failed.",
                    issues: [
                      {
                        path: "reason",
                        message:
                          "reason must be a non-empty string when provided.",
                      },
                    ],
                  },
                  jobId,
                  fallbackMessage: "Cancel request validation failed.",
                });
                return;
              }
              reason = payload.reason.trim();
            }
          }

          const canceledJob = jobEngine.cancelJob({
            jobId,
            ...(reason ? { reason } : {}),
          });
          if (!canceledJob) {
            sendRequestFailure({
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`,
              },
              jobId,
              fallbackMessage: `Cancel request failed for job '${jobId}'.`,
            });
            return;
          }
          logAuditEvent({
            event: "workspace.cancel.accepted",
            statusCode: 202,
            jobId,
            message: `Cancellation accepted for job '${jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 202,
            payload: canceledJob,
          });
          return;
        }

        if (parsedJobRoute?.action === "sync") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Sync request validation failed.",
            });
            return;
          }

          const parsed = SyncRequestSchema.safeParse(rawBody.value);
          if (!parsed.success) {
            sendValidationError({
              payload: formatZodError(parsed.error),
              jobId,
              fallbackMessage: "Sync request validation failed.",
            });
            return;
          }

          try {
            if (parsed.data.mode === "dry_run") {
              const preview = await jobEngine.previewLocalSync({
                jobId,
                ...(parsed.data.targetPath
                  ? { targetPath: parsed.data.targetPath }
                  : {}),
              });
              logAuditEvent({
                event: "workspace.sync.previewed",
                statusCode: 200,
                jobId,
                message: `Local sync preview completed for job '${jobId}'.`,
              });
              sendJson({
                response,
                statusCode: 200,
                payload: preview,
              });
              return;
            }

            const applied = await jobEngine.applyLocalSync({
              jobId,
              confirmationToken: parsed.data.confirmationToken,
              confirmOverwrite: parsed.data.confirmOverwrite,
              fileDecisions: parsed.data.fileDecisions,
              ...(parsed.data.reviewerNote !== undefined
                ? { reviewerNote: parsed.data.reviewerNote }
                : {}),
            });
            logAuditEvent({
              event: "workspace.sync.applied",
              statusCode: 200,
              jobId,
              message: `Local sync applied for job '${jobId}'.`,
            });
            sendJson({
              response,
              statusCode: 200,
              payload: applied,
            });
            return;
          } catch (error) {
            if (error instanceof Error && "code" in error) {
              const code = (error as { code?: string }).code;
              if (code === "E_SYNC_JOB_NOT_FOUND") {
                sendRequestFailure({
                  statusCode: 404,
                  payload: {
                    error: "JOB_NOT_FOUND",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: `Unknown job '${jobId}'.`,
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_SYNC_JOB_NOT_COMPLETED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SYNC_JOB_NOT_COMPLETED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "Local sync is only available for completed jobs.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_SYNC_REGEN_REQUIRED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SYNC_REGEN_REQUIRED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "Local sync is only available for regeneration jobs.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_SYNC_CONFIRMATION_REQUIRED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SYNC_CONFIRMATION_REQUIRED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "Local sync apply requires explicit confirmation.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (
                code === "E_SYNC_CONFIRMATION_INVALID" ||
                code === "E_SYNC_CONFIRMATION_EXPIRED"
              ) {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error:
                      code === "E_SYNC_CONFIRMATION_EXPIRED"
                        ? "SYNC_CONFIRMATION_EXPIRED"
                        : "SYNC_CONFIRMATION_INVALID",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Local sync confirmation token is invalid.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_SYNC_PREVIEW_STALE") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SYNC_PREVIEW_STALE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "Local sync preview is stale. Request a new dry-run preview.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_SYNC_IMPORT_REVIEW_REQUIRED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SYNC_IMPORT_REVIEW_REQUIRED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "The source import session must be approved before applying local sync.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
            }

            if (error instanceof LocalSyncError) {
              if (error.code === "E_SYNC_TARGET_PATH_INVALID") {
                sendValidationError({
                  payload: {
                    error: "INVALID_TARGET_PATH",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "targetPath is invalid.",
                    }),
                  },
                  jobId,
                  fallbackMessage: "Sync request validation failed.",
                });
                return;
              }
              if (error.code === "E_SYNC_GENERATED_DIR_MISSING") {
                sendRequestFailure({
                  statusCode: 404,
                  payload: {
                    error: "SYNC_GENERATED_OUTPUT_NOT_FOUND",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Generated output was not found.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Sync request failed for job '${jobId}'.`,
                });
                return;
              }
              if (
                error.code === "E_SYNC_DESTINATION_UNSAFE" ||
                error.code === "E_SYNC_DESTINATION_SYMLINK" ||
                error.code === "E_SYNC_DESTINATION_CONFLICT" ||
                error.code === "E_SYNC_SOURCE_SYMLINK"
              ) {
                sendValidationError({
                  payload: {
                    error: "SYNC_DESTINATION_UNSAFE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Sync destination is not safe for writes.",
                    }),
                  },
                  jobId,
                  fallbackMessage: "Sync request validation failed.",
                });
                return;
              }
              if (error.code === "E_SYNC_FILE_DECISIONS_INVALID") {
                sendValidationError({
                  payload: {
                    error: "SYNC_FILE_DECISIONS_INVALID",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Local sync file decisions are invalid.",
                    }),
                  },
                  jobId,
                  fallbackMessage: "Sync request validation failed.",
                });
                return;
              }
            }

            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not perform local sync.",
                }),
              },
              jobId,
              fallbackMessage: `Sync request failed for job '${jobId}'.`,
            });
            return;
          }
        }

        if (parsedJobRoute?.action === "regenerate") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Regeneration request validation failed.",
            });
            return;
          }

          const parsed = RegenerationRequestSchema.safeParse(rawBody.value);
          if (!parsed.success) {
            sendValidationError({
              payload: formatZodError(parsed.error),
              jobId,
              fallbackMessage: "Regeneration request validation failed.",
            });
            return;
          }

          let accepted: ReturnType<JobEngine["submitRegeneration"]>;
          try {
            accepted = jobEngine.submitRegeneration({
              sourceJobId: jobId,
              ...(parsed.data.pipelineId
                ? { pipelineId: parsed.data.pipelineId }
                : {}),
              overrides: parsed.data.overrides,
              ...(parsed.data.draftId ? { draftId: parsed.data.draftId } : {}),
              ...(parsed.data.baseFingerprint
                ? { baseFingerprint: parsed.data.baseFingerprint }
                : {}),
              ...(parsed.data.customerBrandId
                ? { customerBrandId: parsed.data.customerBrandId }
                : {}),
              ...(parsed.data.componentMappings
                ? { componentMappings: parsed.data.componentMappings }
                : {}),
            });
          } catch (error) {
            if (error instanceof Error && "code" in error) {
              const code = (error as { code?: string }).code;
              if (code === "E_JOB_QUEUE_FULL") {
                const queueValue = (error as { queue?: unknown }).queue;
                sendAuditedError({
                  statusCode: 429,
                  payload: {
                    error: "QUEUE_BACKPRESSURE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Job queue limit reached.",
                    }),
                    queue:
                      typeof queueValue === "object" && queueValue !== null
                        ? queueValue
                        : undefined,
                  },
                  event: "security.request.rate_limited",
                  level: "warn",
                  jobId,
                  fallbackMessage: `Regeneration request rate limited for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_REGEN_SOURCE_NOT_FOUND") {
                sendRequestFailure({
                  statusCode: 404,
                  payload: {
                    error: "SOURCE_JOB_NOT_FOUND",
                    message: `Source job '${jobId}' not found.`,
                  },
                  jobId,
                  fallbackMessage: `Regeneration request failed for source job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_REGEN_SOURCE_NOT_COMPLETED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SOURCE_JOB_NOT_COMPLETED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Source job is not completed.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Regeneration request failed for source job '${jobId}'.`,
                });
                return;
              }
              if (isPipelineRequestError(error)) {
                sendValidationError({
                  payload: {
                    error: error.code,
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Invalid pipeline request.",
                    }),
                    ...(error.pipelineId
                      ? { pipelineId: error.pipelineId }
                      : {}),
                    issues: [
                      {
                        path: "pipelineId",
                        message: sanitizeErrorMessage({
                          error,
                          fallback: "Invalid pipeline request.",
                        }),
                      },
                    ],
                  },
                  jobId,
                  fallbackMessage: "Regeneration request validation failed.",
                });
                return;
              }
            }
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not submit regeneration job.",
                }),
              },
              jobId,
              fallbackMessage: `Regeneration request failed for source job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.regenerate.accepted",
            statusCode: 202,
            jobId: accepted.jobId,
            message: `Regeneration accepted for source job '${jobId}' as job '${accepted.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 202,
            payload: accepted,
          });
          return;
        }

        if (parsedJobRoute?.action === "retry-stage") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Retry request validation failed.",
            });
            return;
          }

          const parsed = RetryRequestSchema.safeParse(rawBody.value);
          if (!parsed.success) {
            sendValidationError({
              payload: formatZodError(parsed.error),
              jobId,
              fallbackMessage: "Retry request validation failed.",
            });
            return;
          }

          let accepted: ReturnType<JobEngine["submitRetry"]>;
          try {
            accepted = jobEngine.submitRetry({
              sourceJobId: jobId,
              retryStage: parsed.data.retryStage,
              ...(parsed.data.retryTargets
                ? { retryTargets: parsed.data.retryTargets }
                : {}),
            });
          } catch (error) {
            if (error instanceof Error && "code" in error) {
              const code = (error as { code?: string }).code;
              if (code === "E_JOB_QUEUE_FULL") {
                const queueValue = (error as { queue?: unknown }).queue;
                sendAuditedError({
                  statusCode: 429,
                  payload: {
                    error: "QUEUE_BACKPRESSURE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Job queue limit reached.",
                    }),
                    queue:
                      typeof queueValue === "object" && queueValue !== null
                        ? queueValue
                        : undefined,
                  },
                  event: "security.request.rate_limited",
                  level: "warn",
                  jobId,
                  fallbackMessage: `Retry request rate limited for source job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_RETRY_SOURCE_NOT_FOUND") {
                sendRequestFailure({
                  statusCode: 404,
                  payload: {
                    error: "SOURCE_JOB_NOT_FOUND",
                    message: `Source job '${jobId}' not found.`,
                  },
                  jobId,
                  fallbackMessage: `Retry request failed for source job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_RETRY_SOURCE_NOT_FAILED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "SOURCE_JOB_NOT_RETRYABLE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "Source job must be failed or partial before retrying.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Retry request failed for source job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_RETRY_STAGE_INVALID") {
                sendValidationError({
                  payload: {
                    error: "INVALID_RETRY_STAGE",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "retryStage is not supported.",
                    }),
                  },
                  jobId,
                  fallbackMessage: "Retry request validation failed.",
                });
                return;
              }
              if (code === "E_RETRY_TARGETS_INVALID") {
                sendValidationError({
                  payload: {
                    error: "INVALID_RETRY_TARGETS",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "retryTargets are only supported for code generation retries.",
                    }),
                  },
                  jobId,
                  fallbackMessage: "Retry request validation failed.",
                });
                return;
              }
            }

            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not submit retry job.",
                }),
              },
              jobId,
              fallbackMessage: `Retry request failed for source job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.retry.accepted",
            statusCode: 202,
            jobId: accepted.jobId,
            message:
              `Retry accepted for source job '${jobId}' at stage '${accepted.retryStage}' ` +
              `as job '${accepted.jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 202,
            payload: accepted,
          });
          return;
        }

        if (parsedJobRoute?.action === "create-pr") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Create PR request validation failed.",
            });
            return;
          }

          const parsed = CreatePrRequestSchema.safeParse(rawBody.value);
          if (!parsed.success) {
            sendValidationError({
              payload: formatZodError(parsed.error),
              jobId,
              fallbackMessage: "Create PR request validation failed.",
            });
            return;
          }

          let result: Awaited<ReturnType<JobEngine["createPrFromJob"]>>;
          try {
            result = await jobEngine.createPrFromJob({
              jobId,
              prInput: parsed.data,
            });
          } catch (error) {
            if (error instanceof Error && "code" in error) {
              const code = (error as { code?: string }).code;
              if (code === "E_PR_JOB_NOT_FOUND") {
                sendRequestFailure({
                  statusCode: 404,
                  payload: {
                    error: "JOB_NOT_FOUND",
                    message: `Job '${jobId}' not found.`,
                  },
                  jobId,
                  fallbackMessage: `Create PR request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_PR_JOB_NOT_COMPLETED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "JOB_NOT_COMPLETED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Job is not completed.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Create PR request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_PR_NOT_REGENERATION_JOB") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "NOT_REGENERATION_JOB",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Only regeneration jobs support PR creation.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Create PR request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_PR_NO_GENERATED_PROJECT") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "NO_GENERATED_PROJECT",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Job has no generated project.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Create PR request failed for job '${jobId}'.`,
                });
                return;
              }
              if (code === "E_PR_IMPORT_REVIEW_REQUIRED") {
                sendRequestFailure({
                  statusCode: 409,
                  payload: {
                    error: "IMPORT_REVIEW_REQUIRED",
                    message: sanitizeErrorMessage({
                      error,
                      fallback:
                        "The source import session must be approved before creating a PR.",
                    }),
                  },
                  jobId,
                  fallbackMessage: `Create PR request failed for job '${jobId}'.`,
                });
                return;
              }
            }
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not create PR.",
                }),
              },
              jobId,
              fallbackMessage: `Create PR request failed for job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.create_pr.completed",
            statusCode: 200,
            jobId,
            message: `Create PR completed for job '${jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: result,
          });
          return;
        }

        if (parsedJobRoute?.action === "stale-check") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Stale-check request validation failed.",
            });
            return;
          }

          const body = rawBody.value as { draftNodeIds?: unknown };
          const draftNodeIds: string[] = Array.isArray(body.draftNodeIds)
            ? body.draftNodeIds.filter(
                (v): v is string => typeof v === "string",
              )
            : [];

          let checkResult: Awaited<ReturnType<JobEngine["checkStaleDraft"]>>;
          try {
            checkResult = await jobEngine.checkStaleDraft({
              jobId,
              draftNodeIds,
            });
          } catch (error) {
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not check draft staleness.",
                }),
              },
              jobId,
              fallbackMessage: `Stale-check request failed for job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.stale_check.completed",
            statusCode: 200,
            jobId,
            message: `Stale-check completed for job '${jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: checkResult,
          });
          return;
        }

        if (parsedJobRoute?.action === "remap-suggest") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage: "Remap-suggest request validation failed.",
            });
            return;
          }

          const body = rawBody.value as {
            sourceJobId?: unknown;
            latestJobId?: unknown;
            unmappedNodeIds?: unknown;
          };

          const sourceJobId =
            typeof body.sourceJobId === "string" ? body.sourceJobId : jobId;
          const latestJobId =
            typeof body.latestJobId === "string" ? body.latestJobId : "";
          const unmappedNodeIds: string[] = Array.isArray(body.unmappedNodeIds)
            ? body.unmappedNodeIds.filter(
                (v): v is string => typeof v === "string",
              )
            : [];

          if (!latestJobId) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "latestJobId is required.",
              },
              jobId,
              fallbackMessage: "Remap-suggest request validation failed.",
            });
            return;
          }

          let remapResult: Awaited<ReturnType<JobEngine["suggestRemaps"]>>;
          try {
            remapResult = await jobEngine.suggestRemaps({
              sourceJobId,
              latestJobId,
              unmappedNodeIds,
            });
          } catch (error) {
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not generate remap suggestions.",
                }),
              },
              jobId,
              fallbackMessage: `Remap-suggest request failed for job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.remap_suggest.completed",
            statusCode: 200,
            jobId,
            message: `Remap suggestions completed for job '${jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: remapResult,
          });
          return;
        }

        if (parsedJobRoute?.action === "token-decisions") {
          const jobId = safeDecodeParam(
            parsedJobRoute.jobId,
            "job ID",
            response,
          );
          if (jobId === null) return;
          const record = jobEngine.getJobRecord(jobId);
          if (!record) {
            sendRequestFailure({
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`,
              },
              jobId,
              fallbackMessage: `Token-decisions request failed for unknown job '${jobId}'.`,
            });
            return;
          }

          const rawBody = await readJsonBody(request);
          if (!rawBody.ok) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: rawBody.error }],
              },
              jobId,
              fallbackMessage:
                "Token-decisions request body validation failed.",
            });
            return;
          }

          const body = rawBody.value as {
            acceptedTokenNames?: unknown;
            rejectedTokenNames?: unknown;
          };
          if (
            !isStringArray(body.acceptedTokenNames) ||
            !isStringArray(body.rejectedTokenNames)
          ) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message:
                  "acceptedTokenNames and rejectedTokenNames must be string arrays.",
              },
              jobId,
              fallbackMessage:
                "Token-decisions request body validation failed.",
            });
            return;
          }

          const accepted = sanitizeTokenNames(body.acceptedTokenNames);
          const rejected = sanitizeTokenNames(body.rejectedTokenNames);
          const overlap = accepted.filter((name) => rejected.includes(name));
          if (overlap.length > 0) {
            sendValidationError({
              payload: {
                error: "VALIDATION_ERROR",
                message:
                  "A token cannot appear in both acceptedTokenNames and rejectedTokenNames.",
                issues: overlap.map((name) => ({
                  path: name,
                  message: "Conflicting decision.",
                })),
              },
              jobId,
              fallbackMessage:
                "Token-decisions request body validation failed.",
            });
            return;
          }

          const persisted: PersistedTokenDecisions = {
            jobId,
            updatedAt: new Date().toISOString(),
            acceptedTokenNames: accepted,
            rejectedTokenNames: rejected,
          };
          const decisionsPath = path.join(
            record.artifacts.jobDir,
            TOKEN_DECISIONS_FILE_NAME,
          );
          try {
            await mkdir(record.artifacts.jobDir, { recursive: true });
            await writeFile(
              decisionsPath,
              JSON.stringify(persisted, null, 2),
              "utf8",
            );
          } catch (error) {
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not persist token decisions.",
                }),
              },
              jobId,
              fallbackMessage: `Token-decisions persistence failed for job '${jobId}'.`,
            });
            return;
          }

          logAuditEvent({
            event: "workspace.token_decisions.persisted",
            statusCode: 200,
            jobId,
            message: `Persisted ${String(accepted.length)} accepted and ${String(rejected.length)} rejected token decisions for job '${jobId}'.`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: persisted,
          });
          return;
        }
      }

      if (method === "POST" && pathname === "/workspace/submit") {
        const rawBody = await readStreamingJsonBody(request, {
          maxBytes: MAX_SUBMIT_BODY_BYTES,
        });
        if (!rawBody.ok) {
          if (rawBody.reason === "OVERSIZE") {
            sendRequestFailure({
              statusCode: 413,
              payload: {
                error: ErrorCode.TOO_LARGE,
                message: rawBody.error,
                maxBytes: rawBody.maxBytes,
              },
              fallbackMessage: "Submit request body too large.",
            });
          } else {
            sendValidationError({
              payload: {
                error: ErrorCode.INVALID_PAYLOAD,
                message: rawBody.error,
              },
              fallbackMessage: "Submit request validation failed.",
            });
          }
          return;
        }

        const rawJobType = resolveRawSubmitJobType(rawBody.value);
        const testIntelligenceGatesEnabled =
          resolveTestIntelligenceEnabled() &&
          runtime.testIntelligenceEnabled === true;
        if (
          rawJobType === TEST_INTELLIGENCE_JOB_TYPE &&
          !testIntelligenceGatesEnabled
        ) {
          sendRequestFailure({
            statusCode: 503,
            payload: {
              error: ErrorCode.FEATURE_DISABLED,
              message: `Test intelligence is disabled. Enable WorkspaceStartOptions.testIntelligence.enabled and set ${TEST_INTELLIGENCE_ENV}=1 to use ${rawJobType}.`,
            },
            fallbackMessage: "Test intelligence feature disabled.",
          });
          return;
        }

        const requestSourceMode = (() => {
          if (
            typeof rawBody.value !== "object" ||
            rawBody.value === null ||
            Array.isArray(rawBody.value)
          ) {
            return undefined;
          }
          const candidate = rawBody.value as { figmaSourceMode?: unknown };
          return typeof candidate.figmaSourceMode === "string"
            ? (candidate.figmaSourceMode
                .trim()
                .toLowerCase() as WorkspaceImportSessionSourceMode)
            : undefined;
        })();

        const normalizedSubmitInput = normalizeFigmaUrlSubmitInput(
          rawBody.value,
        );
        if (!normalizedSubmitInput.ok) {
          sendValidationError({
            statusCode: normalizedSubmitInput.statusCode,
            payload: normalizedSubmitInput.payload,
            fallbackMessage: "Submit request validation failed.",
          });
          return;
        }

        const blockedModeViolation = resolveBlockedModeViolation(
          normalizedSubmitInput.value,
        );
        if (blockedModeViolation) {
          sendValidationError({
            payload: {
              error: "MODE_LOCK_VIOLATION",
              message: blockedModeViolation.message,
              allowedModes: {
                figmaSourceMode: defaults.figmaSourceMode,
                figmaSourceModes: [...getAllowedFigmaSourceModes()],
                llmCodegenMode: defaults.llmCodegenMode,
              },
            },
            fallbackMessage: "Submit request validation failed.",
          });
          return;
        }

        const parsed = SubmitRequestSchema.safeParse(
          normalizedSubmitInput.value,
        );
        if (!parsed.success) {
          const figmaPasteErrorPrefixes = [
            "INVALID_PAYLOAD:",
            "TOO_LARGE:",
            "SCHEMA_MISMATCH:",
            "UNSUPPORTED_FORMAT:",
            "UNSUPPORTED_CLIPBOARD_KIND:",
          ] as const;
          type FigmaPasteErrorCode =
            | "INVALID_PAYLOAD"
            | "TOO_LARGE"
            | "SCHEMA_MISMATCH"
            | "UNSUPPORTED_FORMAT"
            | "UNSUPPORTED_CLIPBOARD_KIND";
          const pasteIssue = parsed.error.issues.find((issue) =>
            figmaPasteErrorPrefixes.some((prefix) =>
              issue.message.startsWith(prefix),
            ),
          );
          if (pasteIssue) {
            const errorCode = pasteIssue.message.split(
              ":",
            )[0] as FigmaPasteErrorCode;
            const detail = pasteIssue.message
              .slice(errorCode.length + 1)
              .trim();
            sendValidationError({
              payload: { error: errorCode, message: detail },
              fallbackMessage: "Submit request validation failed.",
            });
            return;
          }
          sendValidationError({
            payload: formatZodError(parsed.error),
            fallbackMessage: "Submit request validation failed.",
          });
          return;
        }

        if (parsed.data.jobType === TEST_INTELLIGENCE_JOB_TYPE) {
          if (!testIntelligenceGatesEnabled) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: ErrorCode.FEATURE_DISABLED,
                message: `Test intelligence is disabled. Enable WorkspaceStartOptions.testIntelligence.enabled and set ${TEST_INTELLIGENCE_ENV}=1 to use ${parsed.data.jobType}.`,
              },
              fallbackMessage: "Test intelligence feature disabled.",
            });
            return;
          }

          const productionRunner = runtime.testIntelligenceProductionRunner;
          if (productionRunner === undefined) {
            sendRequestFailure({
              statusCode: 503,
              payload: {
                error: "LLM_GATEWAY_UNCONFIGURED",
                message:
                  "production runner not configured at startup; inject testIntelligenceProductionRunner",
              },
              fallbackMessage:
                "Test intelligence production runner not configured.",
            });
            return;
          }

          const sourceResolution = buildProductionRunnerSource(parsed.data);
          if (!sourceResolution.ok) {
            sendValidationError({
              statusCode: sourceResolution.statusCode,
              payload: sourceResolution.payload,
              fallbackMessage: "Submit request validation failed.",
            });
            return;
          }

          const tiJobId = `ti-${randomUUID()}`;
          const tiGeneratedAt = new Date().toISOString();
          let runnerResult: RunFigmaToQcTestCasesResult;
          try {
            runnerResult = await productionRunner({
              jobId: tiJobId,
              generatedAt: tiGeneratedAt,
              source: sourceResolution.value,
              outputRoot: testIntelligenceArtifactRoot,
            });
          } catch (error) {
            const mapped = mapProductionRunnerError(error);
            sendRequestFailure({
              statusCode: mapped.statusCode,
              payload: mapped.payload,
              jobId: tiJobId,
              fallbackMessage: "Test intelligence production runner failed.",
            });
            return;
          }

          logAuditEvent({
            event: "workspace.submit.accepted",
            statusCode: 200,
            jobId: runnerResult.jobId,
            message: `Test intelligence run '${runnerResult.jobId}' completed: cases=${String(runnerResult.generatedTestCases.testCases.length)} blocked=${String(runnerResult.blocked)}`,
          });
          sendJson({
            response,
            statusCode: 200,
            payload: {
              jobId: runnerResult.jobId,
              summary: {
                generatedAt: runnerResult.generatedAt,
                fileKey: runnerResult.fileKey,
                testCaseCount: runnerResult.generatedTestCases.testCases.length,
                blocked: runnerResult.blocked,
                artifactDir: runnerResult.artifactDir,
                customerMarkdown: {
                  combined: runnerResult.customerMarkdownPaths.combined,
                  perCaseCount:
                    runnerResult.customerMarkdownPaths.perCase.length,
                },
              },
            },
          });
          return;
        }

        const { figmaSourceMode, llmCodegenMode } = parsed.data;
        const resolvedFigmaSourceMode =
          (figmaSourceMode?.trim().toLowerCase() as
            | WorkspaceFigmaSourceMode
            | undefined) ?? defaults.figmaSourceMode;
        const resolvedLlmCodegenMode =
          llmCodegenMode ?? defaults.llmCodegenMode;
        const modeLockInput = {
          figmaSourceMode: resolvedFigmaSourceMode,
          llmCodegenMode: resolvedLlmCodegenMode,
        };

        try {
          enforceModeLock(modeLockInput);
        } catch (error) {
          sendValidationError({
            payload: {
              error: "MODE_LOCK_VIOLATION",
              message: sanitizeErrorMessage({
                error,
                fallback: "Mode validation failed",
              }),
              allowedModes: {
                figmaSourceMode: defaults.figmaSourceMode,
                figmaSourceModes: [...getAllowedFigmaSourceModes()],
                llmCodegenMode: defaults.llmCodegenMode,
              },
            },
            fallbackMessage: "Submit request validation failed.",
          });
          return;
        }

        let submitInput: SubmissionJobInput = {
          ...parsed.data,
          figmaSourceMode: resolvedFigmaSourceMode,
          llmCodegenMode: defaults.llmCodegenMode,
          ...(requestSourceMode !== undefined ? { requestSourceMode } : {}),
        };
        let pasteTempPathToCleanup: string | undefined;
        const cleanupPendingPasteTempFile = async (): Promise<void> => {
          if (pasteTempPathToCleanup === undefined) {
            return;
          }
          const filePath = pasteTempPathToCleanup;
          pasteTempPathToCleanup = undefined;
          try {
            await unlink(filePath);
          } catch {
            /* best-effort cleanup; ignore ENOENT and other filesystem errors */
          }
        };

        let ingressMetrics:
          | {
              payloadBytes: number;
              nodeCount: number;
              normalizationMs: number;
              payloadSha256: string;
            }
          | undefined;
        let pasteDeltaSummary: WorkspacePasteDeltaSummary | undefined;
        let pasteDeltaSeed: PasteDeltaSeedCandidate | undefined;

        if (
          resolvedFigmaSourceMode === "figma_paste" ||
          resolvedFigmaSourceMode === "figma_plugin"
        ) {
          const ingressStartMs = Date.now();
          // Schema has already asserted figmaJsonPayload is a non-empty string
          // for figma_paste and figma_plugin. Crash fast if that contract is
          // ever relaxed without this branch being updated.
          const pastePayload = parsed.data.figmaJsonPayload;
          if (typeof pastePayload !== "string" || pastePayload.length === 0) {
            sendValidationError({
              payload: {
                error: "INVALID_PAYLOAD",
                message:
                  "figmaJsonPayload is required when figmaSourceMode=figma_paste or figma_plugin.",
              },
              fallbackMessage: "Submit request validation failed.",
            });
            return;
          }

          // Normalize clipboard envelope to pipeline-compatible Figma file JSON.
          let normalizedPayload = pastePayload;
          try {
            const parsedPayload = JSON.parse(pastePayload) as unknown;
            if (looksLikeClipboardEnvelope(parsedPayload)) {
              const envelopeResult = validateClipboardEnvelope(parsedPayload);
              if (!envelopeResult.valid) {
                const errorCode = isClipboardEnvelope(parsedPayload)
                  ? "SCHEMA_MISMATCH"
                  : resolvedFigmaSourceMode === "figma_plugin"
                    ? "UNSUPPORTED_FORMAT"
                    : "UNSUPPORTED_CLIPBOARD_KIND";
                sendValidationError({
                  payload: {
                    error: errorCode,
                    message: `Clipboard envelope validation failed: ${summarizeEnvelopeValidationIssues(envelopeResult.issues)}`,
                  },
                  fallbackMessage: "Submit request validation failed.",
                });
                return;
              }
              const complexityResult = validateClipboardEnvelopeComplexity(
                envelopeResult.envelope,
              );
              if (!complexityResult.ok) {
                sendValidationError({
                  payload: {
                    error: "TOO_LARGE",
                    message: complexityResult.message,
                  },
                  fallbackMessage: "Submit request validation failed.",
                });
                return;
              }
              const normalized = normalizeEnvelopeToFigmaFile(
                envelopeResult.envelope,
              );
              normalizedPayload = JSON.stringify(normalized);
            } else if (
              typeof parsedPayload === "object" &&
              parsedPayload !== null &&
              "document" in parsedPayload &&
              typeof parsedPayload.document === "object" &&
              parsedPayload.document !== null
            ) {
              const complexityResult = validateFigmaPayloadComplexity({
                document: parsedPayload.document as ValidatedFigmaNode,
              });
              if (!complexityResult.ok) {
                sendValidationError({
                  payload: {
                    error: "TOO_LARGE",
                    message: complexityResult.message,
                  },
                  fallbackMessage: "Submit request validation failed.",
                });
                return;
              }
            }
          } catch {
            // JSON parse already validated in schema — fall through with raw payload.
          }

          const payloadChecksum = createHash("sha256")
            .update(normalizedPayload, "utf8")
            .digest("hex");

          const pasteUUID = randomUUID();
          const pasteTempDir = path.join(absoluteOutputRoot, "tmp-figma-paste");
          const pasteTempPath = path.join(pasteTempDir, `${pasteUUID}.json`);
          try {
            await mkdir(pasteTempDir, { recursive: true });
            await writeFile(pasteTempPath, normalizedPayload, "utf8");
            pasteTempPathToCleanup = pasteTempPath;
          } catch (error) {
            sendRequestFailure({
              statusCode: 500,
              payload: {
                error: "INTERNAL_ERROR",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Could not write figma_paste payload to disk.",
                }),
              },
              fallbackMessage: "Submit request failed.",
            });
            return;
          }
          ingressMetrics = {
            payloadBytes: Buffer.byteLength(pastePayload, "utf8"),
            nodeCount: countFigmaNodes(normalizedPayload),
            normalizationMs: Date.now() - ingressStartMs,
            payloadSha256: payloadChecksum,
          };

          // Delta-import optimization: compute fingerprint diff against prior
          // manifest. Any failure here is non-fatal — paste proceeds as full
          // build with no pasteDeltaSummary on the accepted response.
          try {
            const extractedRoots =
              extractDiffablePasteRootsFromJson(normalizedPayload);
            if (extractedRoots.length > 0) {
              const topLevelIds = extractedRoots.map((root) => root.id);
              const figmaFileKey = parsed.data.figmaFileKey;
              const identityKey = computePasteIdentityKey({
                ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
                rootNodeIds: topLevelIds,
              });
              const store = createPasteFingerprintStore({
                rootDir: path.join(absoluteOutputRoot, "paste-fingerprints"),
              });
              const priorManifest =
                typeof figmaFileKey === "string" &&
                figmaFileKey.trim().length > 0
                  ? await store.load(identityKey)
                  : undefined;
              const plan = diffFigmaPaste({
                priorManifest,
                currentRoots: extractedRoots,
              });

              const requestedImportMode = parsed.data.importMode ?? "auto";
              const reusableSourceJobId = priorManifest?.sourceJobId?.trim();
              const canAttemptReuse =
                typeof figmaFileKey === "string" &&
                figmaFileKey.trim().length > 0 &&
                typeof reusableSourceJobId === "string" &&
                reusableSourceJobId.length > 0;
              const resolvedSummary = resolvePasteDeltaSummary({
                allowReuse: canAttemptReuse,
                plan,
                requestedMode: requestedImportMode,
              });

              pasteDeltaSummary = {
                ...resolvedSummary,
                pasteIdentityKey: identityKey,
                priorManifestMissing: priorManifest === undefined,
              };
              pasteDeltaSeed = {
                pasteIdentityKey: identityKey,
                requestedMode: requestedImportMode,
                provisionalSummary: pasteDeltaSummary,
                ...(canAttemptReuse
                  ? { sourceJobId: reusableSourceJobId }
                  : {}),
                ...(priorManifest?.execution?.compatibilityFingerprint
                  ? {
                      compatibilityFingerprint:
                        priorManifest.execution.compatibilityFingerprint,
                    }
                  : {}),
                ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
              };
            }
          } catch (error) {
            pasteDeltaSummary = undefined;
            pasteDeltaSeed = undefined;
            logAuditEvent({
              event: "workspace.request.failed",
              level: "warn",
              message: `Paste delta computation failed: ${sanitizeErrorMessage({
                error,
                fallback: "unknown error",
              })}`,
            });
          }

          const { figmaJsonPayload: _discardPayload, ...restSubmitInput } =
            submitInput;
          void _discardPayload;
          submitInput = {
            ...restSubmitInput,
            figmaSourceMode: "local_json",
            figmaJsonPath: pasteTempPath,
            ...(pasteDeltaSeed !== undefined ? { pasteDeltaSeed } : {}),
          };
        }

        let accepted: ReturnType<JobEngine["submitJob"]>;
        try {
          accepted = jobEngine.submitJob(submitInput);
        } catch (error) {
          await cleanupPendingPasteTempFile();
          if (isPipelineRequestError(error)) {
            sendValidationError({
              payload: {
                error: error.code,
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Invalid pipeline request.",
                }),
                ...(error.pipelineId ? { pipelineId: error.pipelineId } : {}),
                issues: [
                  {
                    path: "pipelineId",
                    message: sanitizeErrorMessage({
                      error,
                      fallback: "Invalid pipeline request.",
                    }),
                  },
                ],
              },
              fallbackMessage: "Submit request validation failed.",
            });
            return;
          }
          if (
            error instanceof Error &&
            "code" in error &&
            (error as { code?: string }).code === "E_JOB_QUEUE_FULL"
          ) {
            const queueValue = (error as { queue?: unknown }).queue;
            sendAuditedError({
              statusCode: 429,
              payload: {
                error: "QUEUE_BACKPRESSURE",
                message: sanitizeErrorMessage({
                  error,
                  fallback: "Job queue limit reached.",
                }),
                queue:
                  typeof queueValue === "object" && queueValue !== null
                    ? queueValue
                    : undefined,
              },
              event: "security.request.rate_limited",
              level: "warn",
              fallbackMessage: "Submit request rate limited.",
            });
            return;
          }
          sendRequestFailure({
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({
                error,
                fallback: "Could not submit job.",
              }),
            },
            fallbackMessage: "Submit request failed.",
          });
          return;
        }

        logAuditEvent({
          event: "workspace.submit.accepted",
          statusCode: 202,
          jobId: accepted.jobId,
          message: `Submission accepted as job '${accepted.jobId}'.${submitInput.importIntent !== undefined ? ` importIntent=${submitInput.importIntent}` : ""}${submitInput.originalIntent !== undefined ? ` originalIntent=${submitInput.originalIntent}` : ""}${submitInput.intentCorrected ? " (user-corrected)" : ""}${ingressMetrics !== undefined ? ` payload_size=${ingressMetrics.payloadBytes} node_count=${ingressMetrics.nodeCount} runtime_ms=${ingressMetrics.normalizationMs} payload_sha256=${ingressMetrics.payloadSha256} ingressPayloadBytes=${ingressMetrics.payloadBytes} ingressNodeCount=${ingressMetrics.nodeCount} ingressNormalizationMs=${ingressMetrics.normalizationMs} ingressPayloadSha256=${ingressMetrics.payloadSha256}` : ""}`,
        });
        sendJson({
          response,
          statusCode: 202,
          payload:
            pasteDeltaSummary !== undefined
              ? { ...accepted, pasteDeltaSummary }
              : accepted,
        });
        if (pasteTempPathToCleanup !== undefined) {
          scheduleFigmaPasteTempCleanup({
            jobEngine,
            jobId: accepted.jobId,
            filePath: pasteTempPathToCleanup,
          });
        }
        return;
      }

      sendJson({
        response,
        statusCode: 404,
        payload: {
          error: "NOT_FOUND",
          message: `Unknown route: ${method} ${pathname}`,
        },
      });
    } catch (error) {
      const sanitizedMessage = sanitizeErrorMessage({
        error,
        fallback: DEFAULT_REQUEST_FAILURE_MESSAGE,
      });
      logAuditEvent({
        event: "workspace.request.failed",
        level: "error",
        statusCode: 500,
        message: sanitizedMessage,
      });
      if (!response.writableEnded) {
        sendJson({
          response,
          statusCode: 500,
          payload: {
            error: "INTERNAL_ERROR",
            message: sanitizedMessage,
          },
        });
      }
    }
  };
}

/** Allowed extensions for directory listing (matches validateSourceFilePath). */
const LISTING_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".json",
  ".css",
  ".html",
  ".svg",
]);
const LISTING_BLOCKED_DIRS = new Set(["node_modules", "dist"]);

const FIGMA_PASTE_CLEANUP_POLL_MS = 1_000;
const FIGMA_PASTE_CLEANUP_MAX_WAIT_MS = 10 * 60 * 1_000;

function scheduleFigmaPasteTempCleanup(args: {
  jobEngine: JobEngine;
  jobId: string;
  filePath: string;
}): void {
  const { jobEngine, jobId, filePath } = args;
  const deadline = Date.now() + FIGMA_PASTE_CLEANUP_MAX_WAIT_MS;
  const removeFile = (): void => {
    void unlink(filePath).catch(() => {
      /* best-effort cleanup; ignore ENOENT and other filesystem errors */
    });
  };
  const poll = (): void => {
    const job = jobEngine.getJob(jobId);
    if (
      !job ||
      job.status === "completed" ||
      job.status === "partial" ||
      job.status === "failed" ||
      job.status === "canceled"
    ) {
      removeFile();
      return;
    }
    if (Date.now() >= deadline) {
      removeFile();
      return;
    }
    setTimeout(poll, FIGMA_PASTE_CLEANUP_POLL_MS).unref();
  };
  setTimeout(poll, FIGMA_PASTE_CLEANUP_POLL_MS).unref();
}

function countFigmaNodes(jsonString: string): number {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    if (typeof parsed !== "object" || parsed === null) return 0;
    let count = 0;
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const rec = node as Record<string, unknown>;
      if (typeof rec.type === "string") count++;
      if (Array.isArray(rec.children)) {
        for (const child of rec.children) walk(child);
      }
    };
    walk(parsed);
    return count;
  } catch {
    return 0;
  }
}

interface CollectSourceFilesOptions {
  /** Already-clamped page size (callers must constrain to 1..1000). */
  limit: number;
  /** Opaque cursor equal to the last returned `path` from a prior page. */
  cursor?: string;
}

interface CollectSourceFilesResult {
  files: Array<{ path: string; sizeBytes: number }>;
  /** Present only when more pages exist. */
  nextCursor?: string;
}

function compareOrdinaryStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface SourceFileListingEntry {
  path: string;
  sizeBytes: number;
}

class SourceFileSelectionHeap {
  private readonly entries: SourceFileListingEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: SourceFileListingEntry): void {
    this.entries.push(entry);
    this.bubbleUp(this.entries.length - 1);
  }

  pushBounded(entry: SourceFileListingEntry, capacity: number): void {
    if (capacity <= 0) {
      return;
    }
    if (this.entries.length < capacity) {
      this.push(entry);
      return;
    }
    const currentWorst = this.entries[0];
    if (
      currentWorst === undefined ||
      compareOrdinaryStrings(entry.path, currentWorst.path) >= 0
    ) {
      return;
    }
    this.entries[0] = entry;
    this.bubbleDown(0);
  }

  pop(): SourceFileListingEntry | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }

    const first = this.entries[0]!;
    const last = this.entries.pop();
    if (this.entries.length > 0 && last !== undefined) {
      this.entries[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >>> 1;
      if (this.compare(this.entries[current]!, this.entries[parent]!) <= 0) {
        return;
      }
      [this.entries[current], this.entries[parent]] = [
        this.entries[parent]!,
        this.entries[current]!,
      ];
      current = parent;
    }
  }

  private bubbleDown(index: number): void {
    let current = index;
    while (current < this.entries.length) {
      const left = current * 2 + 1;
      const right = left + 1;
      let largest = current;

      if (
        left < this.entries.length &&
        this.compare(this.entries[left]!, this.entries[largest]!) > 0
      ) {
        largest = left;
      }

      if (
        right < this.entries.length &&
        this.compare(this.entries[right]!, this.entries[largest]!) > 0
      ) {
        largest = right;
      }

      if (largest === current) {
        return;
      }

      [this.entries[current], this.entries[largest]] = [
        this.entries[largest]!,
        this.entries[current]!,
      ];
      current = largest;
    }
  }

  private compare(
    left: SourceFileListingEntry,
    right: SourceFileListingEntry,
  ): number {
    return compareOrdinaryStrings(left.path, right.path);
  }
}

async function collectSourceFiles(
  projectDir: string,
  dirFilter: string | undefined,
  options: CollectSourceFilesOptions,
): Promise<CollectSourceFilesResult> {
  const resolvedProjectDir = path.resolve(projectDir);
  const baseDir =
    dirFilter !== undefined
      ? path.join(resolvedProjectDir, dirFilter)
      : resolvedProjectDir;
  const resolvedBaseDir = path.resolve(baseDir);
  if (
    resolvedBaseDir !== resolvedProjectDir &&
    !resolvedBaseDir.startsWith(`${resolvedProjectDir}${path.sep}`)
  ) {
    // Should never happen after upstream validateSourceFilePath, but guard defensively.
    return { files: [] };
  }
  const { limit, cursor } = options;
  const capacity = limit + 1;
  const selected = new SourceFileSelectionHeap();

  const shouldPruneSubtree = (relativeDir: string): boolean => {
    if (cursor === undefined) {
      return false;
    }
    const subtreePrefix = `${relativeDir}/`;
    return (
      !cursor.startsWith(subtreePrefix) &&
      compareOrdinaryStrings(subtreePrefix, cursor) <= 0
    );
  };

  const scanDirectory = async (directory: string): Promise<void> => {
    let handle: Awaited<ReturnType<typeof opendir>> | undefined;
    try {
      handle = await opendir(directory);
    } catch {
      return;
    }

    try {
      for await (const entry of handle) {
        if (shouldSkipDirectoryEntry(entry.name)) {
          continue;
        }

        const fullPath = path.join(directory, entry.name);
        const relativePath = path.relative(projectDir, fullPath);

        if (entry.isDirectory()) {
          if (!shouldPruneSubtree(relativePath)) {
            await scanDirectory(fullPath);
          }
          continue;
        }

        if (entry.isFile()) {
          const dotIndex = entry.name.lastIndexOf(".");
          if (dotIndex === -1) {
            continue;
          }
          const ext = entry.name.slice(dotIndex);
          if (!LISTING_EXTENSIONS.has(ext)) {
            continue;
          }
          if (
            cursor !== undefined &&
            compareOrdinaryStrings(relativePath, cursor) <= 0
          ) {
            continue;
          }

          let fileStat: Awaited<ReturnType<typeof lstat>>;
          try {
            fileStat = await lstat(fullPath);
          } catch {
            continue;
          }

          if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
            continue;
          }

          selected.pushBounded(
            { path: relativePath, sizeBytes: fileStat.size },
            capacity,
          );
          continue;
        }

        let fileStat: Awaited<ReturnType<typeof lstat>>;
        try {
          fileStat = await lstat(fullPath);
        } catch {
          continue;
        }

        if (fileStat.isDirectory()) {
          if (!shouldPruneSubtree(relativePath)) {
            await scanDirectory(fullPath);
          }
          continue;
        }

        if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
          continue;
        }

        const dotIndex = entry.name.lastIndexOf(".");
        if (dotIndex === -1) {
          continue;
        }
        const ext = entry.name.slice(dotIndex);
        if (!LISTING_EXTENSIONS.has(ext)) {
          continue;
        }
        if (
          cursor !== undefined &&
          compareOrdinaryStrings(relativePath, cursor) <= 0
        ) {
          continue;
        }

        selected.pushBounded(
          { path: relativePath, sizeBytes: fileStat.size },
          capacity,
        );
      }
    } finally {
      await handle.close().catch(() => {});
    }
  };

  const shouldSkipDirectoryEntry = (name: string): boolean =>
    LISTING_BLOCKED_DIRS.has(name) || name.startsWith(".");

  await scanDirectory(baseDir);

  const files = Array.from(
    { length: selected.size },
    () => selected.pop()!,
  ).sort((left, right) => compareOrdinaryStrings(left.path, right.path));

  if (files.length > limit) {
    const page = files.slice(0, limit);
    return { files: page, nextCursor: page[page.length - 1]!.path };
  }

  return { files };
}

/**
 * Inspect-bridge script injected into preview HTML when served via the
 * workspace-dev server. This script is NOT baked into the generated code —
 * it's injected at serve-time only. It enables the click-to-inspect overlay
 * by communicating element boundaries to the parent frame via postMessage.
 *
 * < 2 KB minified.
 */
const INSPECT_BRIDGE_SCRIPT = `<script data-workspace-dev-inspect>
(function(){
  var enabled=false,overlay=null,tooltip=null,scopeSpotlight=null,activeSessionToken=null,allowedParentOrigin=null,activeScopeNodeId=null,activeScopeRoot=null;
  function findElementByIrId(nodeId){
    if(typeof nodeId!=="string"||nodeId.length===0)return null;
    var nodes=document.querySelectorAll("[data-ir-id]");
    for(var i=0;i<nodes.length;i++){
      var node=nodes[i];
      if(node&&node.dataset&&node.dataset.irId===nodeId)return node;
    }
    return null;
  }
  function ensureOverlay(){
    if(!overlay){
      overlay=document.createElement("div");
      overlay.setAttribute("data-workspace-dev-inspect-hover","");
      overlay.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid rgba(59,130,246,0.8);background:rgba(59,130,246,0.15);transition:all 80ms ease;display:none;";
      document.body.appendChild(overlay);
    }
    if(!tooltip){
      tooltip=document.createElement("div");
      tooltip.setAttribute("data-workspace-dev-inspect-tooltip","");
      tooltip.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;background:#1e293b;color:#f8fafc;font:11px/1.3 system-ui,sans-serif;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;";
      document.body.appendChild(tooltip);
    }
  }
  function ensureScopeSpotlight(){
    if(!scopeSpotlight){
      scopeSpotlight=document.createElement("div");
      scopeSpotlight.setAttribute("data-workspace-dev-inspect-scope","");
      scopeSpotlight.style.cssText="position:fixed;pointer-events:none;z-index:2147483646;border:1px solid rgba(16,185,129,0.65);background:rgba(16,185,129,0.08);box-shadow:0 0 0 99999px rgba(15,23,42,0.45);display:none;transition:all 80ms ease;";
      document.body.appendChild(scopeSpotlight);
    }
  }
  function showOverlay(target){
    ensureOverlay();
    var r=target.getBoundingClientRect();
    overlay.style.left=r.left+"px";overlay.style.top=r.top+"px";
    overlay.style.width=r.width+"px";overlay.style.height=r.height+"px";
    overlay.style.display="block";
    var name=target.dataset.irId||"";
    tooltip.textContent=target.dataset.irName||name;
    tooltip.style.left=r.left+"px";
    tooltip.style.top=Math.max(0,r.top-20)+"px";
    tooltip.style.display="block";
  }
  function showScopeSpotlight(target){
    ensureScopeSpotlight();
    var r=target.getBoundingClientRect();
    scopeSpotlight.style.left=r.left+"px";scopeSpotlight.style.top=r.top+"px";
    scopeSpotlight.style.width=r.width+"px";scopeSpotlight.style.height=r.height+"px";
    scopeSpotlight.style.display="block";
  }
  function hideOverlay(){
    if(overlay)overlay.style.display="none";
    if(tooltip)tooltip.style.display="none";
  }
  function hideScopeSpotlight(){
    if(scopeSpotlight)scopeSpotlight.style.display="none";
  }
  function postToParent(payload){
    if(!allowedParentOrigin)return;
    window.parent.postMessage(payload,allowedParentOrigin);
  }
  function isWithinScope(target){
    if(!activeScopeRoot)return true;
    var cur=target;
    while(cur&&cur!==document.body){
      if(cur===activeScopeRoot)return true;
      cur=cur.parentElement;
    }
    return false;
  }
  function getIrTarget(el){
    var cur=el;
    while(cur&&cur!==document.body){
      if(cur.dataset&&cur.dataset.irId){
        if(!isWithinScope(cur))return null;
        return cur;
      }
      cur=cur.parentElement;
    }
    return null;
  }
  function syncScopeRoot(){
    if(!activeScopeNodeId){
      activeScopeRoot=null;
      hideScopeSpotlight();
      return null;
    }
    var resolved=findElementByIrId(activeScopeNodeId);
    if(!resolved){
      activeScopeNodeId=null;
      activeScopeRoot=null;
      hideScopeSpotlight();
      return null;
    }
    activeScopeRoot=resolved;
    showScopeSpotlight(resolved);
    return resolved;
  }
  function onMouseMove(e){
    if(!enabled||!activeSessionToken)return;
    if(activeScopeNodeId)syncScopeRoot();
    var t=getIrTarget(e.target);
    if(t){
      showOverlay(t);
      var r=t.getBoundingClientRect();
      postToParent({type:"inspect:hover",sessionToken:activeSessionToken,irNodeId:t.dataset.irId,irNodeName:t.dataset.irName||"",rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
    }else{
      hideOverlay();
    }
  }
  function onClick(e){
    if(!enabled||!activeSessionToken)return;
    if(activeScopeNodeId)syncScopeRoot();
    var t=getIrTarget(e.target);
    if(t){
      e.preventDefault();e.stopPropagation();
      postToParent({type:"inspect:select",sessionToken:activeSessionToken,irNodeId:t.dataset.irId,irNodeName:t.dataset.irName||""});
    }
  }
  window.addEventListener("message",function(e){
    var data=e.data;
    if(!data||typeof data.type!=="string")return;
    if(e.source!==window.parent)return;
    if(data.type==="inspect:enable"){
      if(typeof data.sessionToken!=="string"||data.sessionToken.length===0)return;
      enabled=true;
      activeSessionToken=data.sessionToken;
      allowedParentOrigin=e.origin;
      document.body.style.cursor="crosshair";
      ensureOverlay();
      return;
    }
    if(data.type==="inspect:disable"){
      if(!enabled||typeof data.sessionToken!=="string")return;
      if(e.origin!==allowedParentOrigin)return;
      if(data.sessionToken!==activeSessionToken)return;
      enabled=false;
      activeSessionToken=null;
      allowedParentOrigin=null;
      activeScopeNodeId=null;
      activeScopeRoot=null;
      document.body.style.cursor="";
      hideOverlay();
      hideScopeSpotlight();
      return;
    }
    if(data.type==="inspect:scope:set"){
      if(!enabled||typeof data.sessionToken!=="string"||typeof data.irNodeId!=="string"||data.irNodeId.length===0)return;
      if(e.origin!==allowedParentOrigin)return;
      if(data.sessionToken!==activeSessionToken)return;
      activeScopeNodeId=data.irNodeId;
      syncScopeRoot();
      return;
    }
    if(data.type==="inspect:scope:clear"){
      if(!enabled||typeof data.sessionToken!=="string")return;
      if(e.origin!==allowedParentOrigin)return;
      if(data.sessionToken!==activeSessionToken)return;
      activeScopeNodeId=null;
      activeScopeRoot=null;
      hideScopeSpotlight();
    }
  });
  document.addEventListener("mousemove",onMouseMove,true);
  document.addEventListener("click",onClick,true);
})();
</script>`;

function injectInspectBridgeScript(html: string): string {
  // Inject right before </body> if it exists, otherwise before </html>,
  // otherwise append at the end.
  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return `${html.slice(0, bodyClose)}${INSPECT_BRIDGE_SCRIPT}\n${html.slice(bodyClose)}`;
  }
  const htmlClose = html.lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return `${html.slice(0, htmlClose)}${INSPECT_BRIDGE_SCRIPT}\n${html.slice(htmlClose)}`;
  }
  return `${html}\n${INSPECT_BRIDGE_SCRIPT}`;
}
