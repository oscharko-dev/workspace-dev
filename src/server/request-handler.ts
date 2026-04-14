import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CONTRACT_VERSION,
  type WorkspaceFigmaSourceMode,
  type WorkspacePasteDeltaSummary,
  type WorkspaceStatus,
} from "../contracts/index.js";
import {
  isClipboardEnvelope,
  looksLikeClipboardEnvelope,
  normalizeEnvelopeToFigmaFile,
  validateClipboardEnvelope,
  summarizeEnvelopeValidationIssues,
} from "../clipboard-envelope.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import type { JobEngine } from "../job-engine.js";
import { STAGE_ARTIFACT_KEYS } from "../job-engine/pipeline/artifact-keys.js";
import { StageArtifactStore } from "../job-engine/pipeline/artifact-store.js";
import { LocalSyncError } from "../job-engine/local-sync.js";
import {
  computePasteIdentityKey,
  createPasteFingerprintStore,
  type PasteFingerprintManifest,
} from "../job-engine/paste-fingerprint-store.js";
import {
  diffFigmaPaste,
  type DiffableFigmaNode,
} from "../job-engine/paste-tree-diff.js";
import type {
  WorkspaceRuntimeLogLevel,
  WorkspaceRuntimeLogger,
} from "../logging.js";
import { enforceModeLock, getAllowedFigmaSourceModes } from "../mode-lock.js";
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
import { validateWriteRequest } from "./request-security.js";
import {
  createIpRateLimiter,
  resolveRateLimitClientKey,
} from "./rate-limit.js";
import {
  sendBuffer,
  sendJson,
  sendText,
  readJsonBody,
} from "./http-helpers.js";
import {
  MAX_SUBMIT_BODY_BYTES,
  WORKSPACE_UI_CONTENT_SECURITY_POLICY,
} from "./constants.js";
import { ErrorCode } from "./error-codes.js";
import { INVALID_PATH_ENCODING, safeDecode } from "./route-params.js";
import {
  isWorkspaceProjectRoute,
  parseJobFilesRoute,
  parseJobRoute,
  parseReproRoute,
  resolveUiAssetPath,
  shouldFallbackToUiEntrypoint,
  validateSourceFilePath,
} from "./routes.js";
import { loadInspectorPolicy } from "./inspector-policy.js";
import { getUiAsset, getUiAssets } from "./ui-assets.js";

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

function readScreenshotUrlFromEnrichment(
  enrichment: FigmaMcpEnrichment | undefined,
): string | undefined {
  const screenshot = enrichment?.screenshots?.find(
    (entry) => typeof entry.url === "string" && entry.url.trim().length > 0,
  );
  return screenshot?.url;
}

type WorkspaceAuditEvent =
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
  | "workspace.token_decisions.persisted";

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

interface ProtectedWriteRoute {
  parsedJobRoute?: ReturnType<typeof parseJobRoute>;
}

function resolveProtectedWriteRoute(
  pathname: string,
): ProtectedWriteRoute | null {
  if (pathname === "/workspace/submit") {
    return {};
  }

  const parsedJobRoute = parseJobRoute(pathname);
  if (parsedJobRoute && PROTECTED_POST_ACTIONS.has(parsedJobRoute.action)) {
    return { parsedJobRoute };
  }

  return null;
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
    logger?: WorkspaceRuntimeLogger;
  };
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
  jobEngine,
  moduleDir,
}: CreateWorkspaceRequestHandlerInput): (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> {
  const rateLimiter = createIpRateLimiter(
    runtime.rateLimitPerMinute === undefined
      ? {}
      : { limitPerWindow: runtime.rateLimitPerMinute },
  );

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
    const requestUrl = new URL(
      request.url ?? "/",
      "http://workspace-dev.local",
    );
    const pathname = requestUrl.pathname;
    const protectedWriteRoute = resolveProtectedWriteRoute(pathname);
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

    try {
      if (method === "GET" && pathname === "/workspace") {
        const resolvedPort = getResolvedPort();
        const status: WorkspaceStatus = {
          running: true,
          url: `http://${host}:${resolvedPort}`,
          host,
          port: resolvedPort,
          figmaSourceMode: defaults.figmaSourceMode,
          llmCodegenMode: defaults.llmCodegenMode,
          uptimeMs: Date.now() - startedAt,
          outputRoot: absoluteOutputRoot,
          previewEnabled: runtime.previewEnabled,
        };
        sendJson({ response, statusCode: 200, payload: status });
        return;
      }

      if (method === "GET" && pathname === "/healthz") {
        sendJson({
          response,
          statusCode: 200,
          payload: { ok: true, service: "workspace-dev" },
        });
        return;
      }

      if (method === "GET" && pathname === "/workspace/inspector-policy") {
        const result = await loadInspectorPolicy({ workspaceRoot });
        if (result.warning) {
          logAuditEvent({
            event: "workspace.inspector_policy.invalid",
            level: "warn",
            statusCode: 200,
            message: result.warning,
          });
        }
        sendJson({
          response,
          statusCode: 200,
          payload: { policy: result.policy },
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

            let fileEntries: Array<{ path: string; sizeBytes: number }>;
            try {
              fileEntries = await collectSourceFiles(projectDir, dirFilter);
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
                files: fileEntries,
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

        const uiAssetPath = resolveUiAssetPath(pathname);
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
                shouldFallbackToUiEntrypoint(pathname));
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

        response.setHeader("allow", "POST");
        sendJson({
          response,
          statusCode: 405,
          payload: {
            error: "METHOD_NOT_ALLOWED",
            message: `Write route '${pathname}' only supports POST and does not support cross-origin browser preflight requests.`,
          },
        });
        return;
      }

      if (method === "POST") {
        const parsedJobRoute = protectedWriteRoute?.parsedJobRoute;

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

        const isRateLimitedWriteRoute =
          pathname === "/workspace/submit" ||
          parsedJobRoute?.action === "regenerate" ||
          parsedJobRoute?.action === "retry-stage";
        if (isRateLimitedWriteRoute) {
          const rateLimitResult = rateLimiter.consume(
            resolveRateLimitClientKey(request),
          );
          if (!rateLimitResult.allowed) {
            response.setHeader(
              "retry-after",
              String(rateLimitResult.retryAfterSeconds),
            );
            sendAuditedError({
              statusCode: 429,
              payload: {
                error: "RATE_LIMIT_EXCEEDED",
                message: `Too many job submissions from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`,
              },
              event: "security.request.rate_limited",
              level: "warn",
              fallbackMessage: "Write request rate limited.",
            });
            return;
          }
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
        const rawBody = await readJsonBody(request, {
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

        let submitInput = {
          ...parsed.data,
          figmaSourceMode: resolvedFigmaSourceMode,
          llmCodegenMode: defaults.llmCodegenMode,
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
              const normalized = normalizeEnvelopeToFigmaFile(
                envelopeResult.envelope,
              );
              normalizedPayload = JSON.stringify(normalized);
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
            const extractedRoots = extractPasteRoots(normalizedPayload);
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
              const priorManifest = await store.load(identityKey);
              const plan = diffFigmaPaste({
                priorManifest,
                currentRoots: extractedRoots,
              });

              const requestedImportMode = parsed.data.importMode;
              let effectiveMode: WorkspacePasteDeltaSummary["mode"];
              if (requestedImportMode === "full") {
                effectiveMode = "full";
              } else if (requestedImportMode === "delta") {
                effectiveMode =
                  plan.strategy === "structural_break" ? "full" : "delta";
              } else {
                if (
                  plan.strategy === "structural_break" ||
                  plan.strategy === "baseline_created"
                ) {
                  effectiveMode = "auto_resolved_to_full";
                } else {
                  effectiveMode = "auto_resolved_to_delta";
                }
              }

              const newManifest: PasteFingerprintManifest = {
                contractVersion: CONTRACT_VERSION,
                pasteIdentityKey: identityKey,
                createdAt: new Date().toISOString(),
                rootNodeIds: plan.rootNodeIds,
                nodes: plan.currentFingerprintNodes,
                ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
              };
              try {
                await store.save(newManifest);
              } catch (error) {
                logAuditEvent({
                  event: "workspace.request.failed",
                  level: "warn",
                  message: `Paste fingerprint save failed: ${sanitizeErrorMessage({
                    error,
                    fallback: "unknown error",
                  })}`,
                });
              }

              pasteDeltaSummary = {
                mode: effectiveMode,
                strategy: plan.strategy,
                totalNodes: plan.totalNodes,
                nodesReused: plan.reusedNodes,
                nodesReprocessed: plan.reprocessedNodes,
                structuralChangeRatio: plan.structuralChangeRatio,
                pasteIdentityKey: identityKey,
                priorManifestMissing: priorManifest === undefined,
              };
            }
          } catch (error) {
            pasteDeltaSummary = undefined;
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
          };
        }

        let accepted: ReturnType<JobEngine["submitJob"]>;
        try {
          accepted = jobEngine.submitJob(submitInput);
        } catch (error) {
          await cleanupPendingPasteTempFile();
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

const ROOT_NODE_TYPES = new Set<string>([
  "CANVAS",
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
]);

function asDiffableFigmaNode(value: unknown): DiffableFigmaNode | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || typeof rec.type !== "string") {
    return undefined;
  }
  return rec as unknown as DiffableFigmaNode;
}

function extractPasteRoots(jsonString: string): DiffableFigmaNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const rec = parsed as Record<string, unknown>;

  const document = rec.document;
  if (document !== undefined) {
    const docRec =
      typeof document === "object" && document !== null
        ? (document as Record<string, unknown>)
        : undefined;
    if (docRec !== undefined && Array.isArray(docRec.children)) {
      const roots: DiffableFigmaNode[] = [];
      for (const child of docRec.children) {
        const node = asDiffableFigmaNode(child);
        if (node !== undefined && ROOT_NODE_TYPES.has(node.type)) {
          roots.push(node);
        }
      }
      return roots;
    }
  }

  if (typeof rec.nodes === "object" && rec.nodes !== null) {
    const roots: DiffableFigmaNode[] = [];
    for (const entry of Object.values(rec.nodes as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const inner = (entry as Record<string, unknown>).document;
      const node = asDiffableFigmaNode(inner);
      if (node !== undefined) {
        roots.push(node);
      }
    }
    return roots;
  }

  return [];
}

async function collectSourceFiles(
  projectDir: string,
  dirFilter?: string,
): Promise<Array<{ path: string; sizeBytes: number }>> {
  const results: Array<{ path: string; sizeBytes: number }> = [];
  const baseDir =
    dirFilter !== undefined ? path.join(projectDir, dirFilter) : projectDir;

  const walk = async (dir: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }

    for (const name of names) {
      if (LISTING_BLOCKED_DIRS.has(name)) {
        continue;
      }
      if (name.startsWith(".")) {
        continue;
      }

      const fullPath = path.join(dir, name);

      let fileStat: Awaited<ReturnType<typeof lstat>>;
      try {
        fileStat = await lstat(fullPath);
      } catch {
        continue;
      }

      if (fileStat.isSymbolicLink()) {
        continue;
      }

      if (fileStat.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!fileStat.isFile()) {
        continue;
      }

      const dotIndex = name.lastIndexOf(".");
      if (dotIndex === -1) {
        continue;
      }
      const ext = name.slice(dotIndex);
      if (!LISTING_EXTENSIONS.has(ext)) {
        continue;
      }

      const relativePath = path.relative(projectDir, fullPath);
      results.push({ path: relativePath, sizeBytes: fileStat.size });
    }
  };

  await walk(baseDir);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
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
