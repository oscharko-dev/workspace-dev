import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceFigmaSourceMode, WorkspaceStatus } from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import type { JobEngine } from "../job-engine.js";
import { LocalSyncError } from "../job-engine/local-sync.js";
import { enforceModeLock, getAllowedFigmaSourceModes } from "../mode-lock.js";
import { buildScreenArtifactIdentities } from "../parity/generator-artifacts.js";
import type { ScreenIR } from "../parity/types-ir.js";
import { CreatePrRequestSchema, RegenerationRequestSchema, SubmitRequestSchema, SyncRequestSchema, formatZodError } from "../schemas.js";
import { validateWriteRequest } from "./request-security.js";
import { createIpRateLimiter, resolveRateLimitClientKey } from "./rate-limit.js";
import { sendBuffer, sendJson, sendText, readJsonBody } from "./http-helpers.js";
import { isWorkspaceProjectRoute, parseJobFilesRoute, parseJobRoute, parseReproRoute, resolveUiAssetPath, validateSourceFilePath } from "./routes.js";
import { getUiAsset, getUiAssets } from "./ui-assets.js";

const PROTECTED_POST_ACTIONS = new Set([
  "cancel",
  "sync",
  "regenerate",
  "create-pr",
  "stale-check",
  "remap-suggest"
]);

interface ProtectedWriteRoute {
  parsedJobRoute?: ReturnType<typeof parseJobRoute>;
}

function resolveProtectedWriteRoute(pathname: string): ProtectedWriteRoute | null {
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
  defaults: {
    figmaSourceMode: "rest";
    llmCodegenMode: "deterministic";
  };
  runtime: {
    previewEnabled: boolean;
    rateLimitPerMinute?: number;
  };
  jobEngine: JobEngine;
  moduleDir: string;
}

export function createWorkspaceRequestHandler({
  host,
  getResolvedPort,
  startedAt,
  absoluteOutputRoot,
  defaults,
  runtime,
  jobEngine,
  moduleDir
}: CreateWorkspaceRequestHandlerInput): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const rateLimiter = createIpRateLimiter(
    runtime.rateLimitPerMinute === undefined ? {} : { limitPerWindow: runtime.rateLimitPerMinute }
  );

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", "http://workspace-dev.local");
    const pathname = requestUrl.pathname;
    const protectedWriteRoute = resolveProtectedWriteRoute(pathname);

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
        previewEnabled: runtime.previewEnabled
      };
      sendJson({ response, statusCode: 200, payload: status });
      return;
    }

    if (method === "GET" && pathname === "/healthz") {
      sendJson({ response, statusCode: 200, payload: { ok: true, service: "workspace-dev" } });
      return;
    }

    if (method === "GET") {
      const parsedJobRoute = parseJobRoute(pathname);
      if (parsedJobRoute) {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        if (parsedJobRoute.action === "result") {
          const jobResult = jobEngine.getJobResult(jobId);
          if (!jobResult) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "JOB_NOT_FOUND",
                message: `Unknown job '${jobId}'.`
              }
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
              message: `Use POST for cancellation route '/workspace/jobs/${jobId}/cancel'.`
            }
          });
          return;
        }

        if (parsedJobRoute.action === "regenerate") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for regeneration route '/workspace/jobs/${jobId}/regenerate'.`
            }
          });
          return;
        }

        if (parsedJobRoute.action === "sync") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for local sync route '/workspace/jobs/${jobId}/sync'.`
            }
          });
          return;
        }

        if (parsedJobRoute.action === "create-pr") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for PR creation route '/workspace/jobs/${jobId}/create-pr'.`
            }
          });
          return;
        }

        if (parsedJobRoute.action === "stale-check") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for stale-check route '/workspace/jobs/${jobId}/stale-check'.`
            }
          });
          return;
        }

        if (parsedJobRoute.action === "remap-suggest") {
          sendJson({
            response,
            statusCode: 405,
            payload: {
              error: "METHOD_NOT_ALLOWED",
              message: `Use POST for remap-suggest route '/workspace/jobs/${jobId}/remap-suggest'.`
            }
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
                message: `Unknown job '${jobId}'.`
              }
            });
            return;
          }

          if (record.status === "queued" || record.status === "running") {
            sendJson({
              response,
              statusCode: 409,
              payload: {
                error: "JOB_NOT_COMPLETED",
                message: `Job '${jobId}' has status '${record.status}' — design IR is only available after the job finishes.`
              }
            });
            return;
          }

          const designIrPath = record.artifacts.designIrFile;
          if (!designIrPath) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "DESIGN_IR_NOT_FOUND",
                message: `Design IR artifact not available for job '${jobId}'.`
              }
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
              statusCode: 404,
              payload: {
                error: "DESIGN_IR_NOT_FOUND",
                message: `Design IR file not found on disk for job '${jobId}'.`
              }
            });
            return;
          }

          const irData = rawIr as {
            sourceName?: string;
            screens?: ScreenIR[];
            tokens?: unknown;
          };

          const screens: ScreenIR[] = Array.isArray(irData.screens) ? irData.screens : [];
          const identities = buildScreenArtifactIdentities(screens);

          const enrichedScreens = screens.map((screen) => {
            const identity = identities.get(screen.id);
            return {
              ...screen,
              ...(identity ? { generatedFile: identity.filePath } : {})
            };
          });

          sendJson({
            response,
            statusCode: 200,
            payload: {
              jobId,
              sourceName: irData.sourceName ?? null,
              screens: enrichedScreens,
              tokens: irData.tokens ?? null
            }
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
                message: `Unknown job '${jobId}'.`
              }
            });
            return;
          }

          if (record.status === "queued" || record.status === "running") {
            sendJson({
              response,
              statusCode: 409,
              payload: {
                error: "JOB_NOT_COMPLETED",
                message: `Job '${jobId}' has status '${record.status}' — component manifest is only available after the job finishes.`
              }
            });
            return;
          }

          const manifestPath = record.artifacts.componentManifestFile;
          if (!manifestPath) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "COMPONENT_MANIFEST_NOT_FOUND",
                message: `Component manifest artifact not available for job '${jobId}'.`
              }
            });
            return;
          }

          let manifestContent: string;
          try {
            manifestContent = await readFile(manifestPath, "utf8");
          } catch {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "COMPONENT_MANIFEST_NOT_FOUND",
                message: `Component manifest file not found on disk for job '${jobId}'.`
              }
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
                message: `Failed to parse component manifest for job '${jobId}'.`
              }
            });
            return;
          }

          sendJson({
            response,
            statusCode: 200,
            payload: {
              jobId,
              ...(manifest as Record<string, unknown>)
            }
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
              message: `Unknown job '${jobId}'.`
            }
          });
          return;
        }

        sendJson({ response, statusCode: 200, payload: job });
        return;
      }

      const parsedFilesRoute = parseJobFilesRoute(pathname);
      if (parsedFilesRoute) {
        const jobId = decodeURIComponent(parsedFilesRoute.jobId);
        const record = jobEngine.getJobRecord(jobId);

        if (!record) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "JOB_NOT_FOUND",
              message: `Unknown job '${jobId}'.`
            }
          });
          return;
        }

        if (record.status === "queued" || record.status === "running") {
          sendJson({
            response,
            statusCode: 409,
            payload: {
              error: "JOB_NOT_COMPLETED",
              message: `Job '${jobId}' has status '${record.status}' — files are only available after the job finishes.`
            }
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
              message: `Generated project directory not available for job '${jobId}'.`
            }
          });
          return;
        }

        // Directory listing
        if (parsedFilesRoute.filePath === undefined) {
          const dirFilterParam = requestUrl.searchParams.get("dir");
          const dirFilter: string | undefined = dirFilterParam !== null ? dirFilterParam : undefined;

          if (dirFilter !== undefined) {
            const dirValidation = validateSourceFilePath(`${dirFilter}/placeholder.ts`);
            if (!dirValidation.valid) {
              sendJson({
                response,
                statusCode: 403,
                payload: {
                  error: "FORBIDDEN_PATH",
                  message: dirValidation.reason
                }
              });
              return;
            }
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
                message: `Generated project directory not found on disk for job '${jobId}'.`
              }
            });
            return;
          }

          sendJson({
            response,
            statusCode: 200,
            payload: {
              jobId,
              files: fileEntries
            }
          });
          return;
        }

        // Single file content
        const filePath = decodeURIComponent(parsedFilesRoute.filePath);
        const validation = validateSourceFilePath(filePath);
        if (!validation.valid) {
          sendJson({
            response,
            statusCode: 403,
            payload: {
              error: "FORBIDDEN_PATH",
              message: validation.reason
            }
          });
          return;
        }

        const absolutePath = path.join(projectDir, filePath);

        // Ensure resolved path stays within projectDir (belt-and-suspenders)
        const resolved = path.resolve(absolutePath);
        const resolvedProjectDir = path.resolve(projectDir);
        if (!resolved.startsWith(`${resolvedProjectDir}/`)) {
          sendJson({
            response,
            statusCode: 403,
            payload: {
              error: "FORBIDDEN_PATH",
              message: "Path escapes project directory."
            }
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
                message: "Symbolic links are not allowed."
              }
            });
            return;
          }
        } catch {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "FILE_NOT_FOUND",
              message: `File '${filePath}' not found in job '${jobId}'.`
            }
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
              message: `File '${filePath}' not found in job '${jobId}'.`
            }
          });
          return;
        }

        sendText({
          response,
          statusCode: 200,
          contentType: "text/plain; charset=utf-8",
          payload: content
        });
        return;
      }

      const parsedReproRoute = parseReproRoute(pathname);
      if (parsedReproRoute) {
        const previewAsset = await jobEngine.resolvePreviewAsset(
          decodeURIComponent(parsedReproRoute.jobId),
          decodeURIComponent(parsedReproRoute.previewPath)
        );

        if (!previewAsset) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "PREVIEW_NOT_FOUND",
              message: `No preview artifact found for '${parsedReproRoute.jobId}'.`
            }
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
            allowFrameEmbedding: true
          });
          return;
        }

        sendBuffer({
          response,
          statusCode: 200,
          contentType: previewAsset.contentType,
          payload: previewAsset.content,
          cacheControl: "no-store, no-cache, must-revalidate, max-age=0",
          allowFrameEmbedding: true
        });
        return;
      }

      const uiAssetPath = resolveUiAssetPath(pathname);
      const shouldServeWorkspaceAlias = isWorkspaceProjectRoute(pathname);
      if (uiAssetPath || shouldServeWorkspaceAlias) {
        try {
          const uiAssets = await getUiAssets(moduleDir);
          const uiAsset = getUiAsset({
            assets: uiAssets,
            assetPath: uiAssetPath ?? "index.html"
          });
          if (!uiAsset) {
            sendJson({
              response,
              statusCode: 404,
              payload: {
                error: "NOT_FOUND",
                message: `Unknown route: ${method} ${pathname}`
              }
            });
            return;
          }

          sendBuffer({
            response,
            statusCode: 200,
            contentType: uiAsset.contentType,
            payload: uiAsset.content,
            cacheControl: "no-store, no-cache, must-revalidate, max-age=0"
          });
          return;
        } catch {
          sendJson({
            response,
            statusCode: 503,
            payload: {
              error: "UI_ASSETS_UNAVAILABLE",
              message: "workspace-dev UI assets are not available in this runtime."
            }
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
            message: `Unknown route: ${method} ${pathname}`
          }
        });
        return;
      }

      response.setHeader("allow", "POST");
      sendJson({
        response,
        statusCode: 405,
        payload: {
          error: "METHOD_NOT_ALLOWED",
          message: `Write route '${pathname}' only supports POST and does not support cross-origin browser preflight requests.`
        }
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
            message: `Unknown route: ${method} ${pathname}`
          }
        });
        return;
      }

      const writeRequestValidation = validateWriteRequest({
        request,
        host,
        port: getResolvedPort()
      });
      if (!writeRequestValidation.ok) {
        sendJson({
          response,
          statusCode: writeRequestValidation.statusCode,
          payload: writeRequestValidation.payload
        });
        return;
      }

      const isRateLimitedWriteRoute =
        pathname === "/workspace/submit" || parsedJobRoute?.action === "regenerate";
      if (isRateLimitedWriteRoute) {
        const rateLimitResult = rateLimiter.consume(resolveRateLimitClientKey(request));
        if (!rateLimitResult.allowed) {
          response.setHeader("retry-after", String(rateLimitResult.retryAfterSeconds));
          sendJson({
            response,
            statusCode: 429,
            payload: {
              error: "RATE_LIMIT_EXCEEDED",
              message: `Too many job submissions from this client. Retry after ${rateLimitResult.retryAfterSeconds} seconds.`
            }
          });
          return;
        }
      }

      if (parsedJobRoute?.action === "cancel") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
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
            sendJson({
              response,
              statusCode: 400,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: "(root)", message: "Cancel request must be an object when body is provided." }]
              }
            });
            return;
          }

          const payload = rawBody.value as Record<string, unknown>;
          const allowedKeys = new Set(["reason"]);
          const unknownKey = Object.keys(payload).find((key) => !allowedKeys.has(key));
          if (unknownKey) {
            sendJson({
              response,
              statusCode: 400,
              payload: {
                error: "VALIDATION_ERROR",
                message: "Request validation failed.",
                issues: [{ path: unknownKey, message: `Unexpected property '${unknownKey}'.` }]
              }
            });
            return;
          }

          if (payload.reason !== undefined) {
            if (typeof payload.reason !== "string" || payload.reason.trim().length === 0) {
              sendJson({
                response,
                statusCode: 400,
                payload: {
                  error: "VALIDATION_ERROR",
                  message: "Request validation failed.",
                  issues: [{ path: "reason", message: "reason must be a non-empty string when provided." }]
                }
              });
              return;
            }
            reason = payload.reason.trim();
          }
        }

        const canceledJob = jobEngine.cancelJob({ jobId, ...(reason ? { reason } : {}) });
        if (!canceledJob) {
          sendJson({
            response,
            statusCode: 404,
            payload: {
              error: "JOB_NOT_FOUND",
              message: `Unknown job '${jobId}'.`
            }
          });
          return;
        }
        sendJson({
          response,
          statusCode: 202,
          payload: canceledJob
        });
        return;
      }

      if (parsedJobRoute?.action === "sync") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
          });
          return;
        }

        const parsed = SyncRequestSchema.safeParse(rawBody.value);
        if (!parsed.success) {
          sendJson({ response, statusCode: 400, payload: formatZodError(parsed.error) });
          return;
        }

        try {
          if (parsed.data.mode === "dry_run") {
            const preview = await jobEngine.previewLocalSync({
              jobId,
              ...(parsed.data.targetPath ? { targetPath: parsed.data.targetPath } : {})
            });
            sendJson({
              response,
              statusCode: 200,
              payload: preview
            });
            return;
          }

          const applied = await jobEngine.applyLocalSync({
            jobId,
            confirmationToken: parsed.data.confirmationToken,
            confirmOverwrite: parsed.data.confirmOverwrite,
            fileDecisions: parsed.data.fileDecisions
          });
          sendJson({
            response,
            statusCode: 200,
            payload: applied
          });
          return;
        } catch (error) {
          if (error instanceof Error && "code" in error) {
            const code = (error as { code?: string }).code;
            if (code === "E_SYNC_JOB_NOT_FOUND") {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: sanitizeErrorMessage({ error, fallback: `Unknown job '${jobId}'.` })
                }
              });
              return;
            }
            if (code === "E_SYNC_JOB_NOT_COMPLETED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "SYNC_JOB_NOT_COMPLETED",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync is only available for completed jobs." })
                }
              });
              return;
            }
            if (code === "E_SYNC_REGEN_REQUIRED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "SYNC_REGEN_REQUIRED",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync is only available for regeneration jobs." })
                }
              });
              return;
            }
            if (code === "E_SYNC_CONFIRMATION_REQUIRED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "SYNC_CONFIRMATION_REQUIRED",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync apply requires explicit confirmation." })
                }
              });
              return;
            }
            if (code === "E_SYNC_CONFIRMATION_INVALID" || code === "E_SYNC_CONFIRMATION_EXPIRED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: code === "E_SYNC_CONFIRMATION_EXPIRED" ? "SYNC_CONFIRMATION_EXPIRED" : "SYNC_CONFIRMATION_INVALID",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync confirmation token is invalid." })
                }
              });
              return;
            }
            if (code === "E_SYNC_PREVIEW_STALE") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "SYNC_PREVIEW_STALE",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync preview is stale. Request a new dry-run preview." })
                }
              });
              return;
            }
          }

          if (error instanceof LocalSyncError) {
            if (error.code === "E_SYNC_TARGET_PATH_INVALID") {
              sendJson({
                response,
                statusCode: 400,
                payload: {
                  error: "INVALID_TARGET_PATH",
                  message: sanitizeErrorMessage({ error, fallback: "targetPath is invalid." })
                }
              });
              return;
            }
            if (error.code === "E_SYNC_GENERATED_DIR_MISSING") {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "SYNC_GENERATED_OUTPUT_NOT_FOUND",
                  message: sanitizeErrorMessage({ error, fallback: "Generated output was not found." })
                }
              });
              return;
            }
            if (
              error.code === "E_SYNC_DESTINATION_UNSAFE" ||
              error.code === "E_SYNC_DESTINATION_SYMLINK" ||
              error.code === "E_SYNC_DESTINATION_CONFLICT" ||
              error.code === "E_SYNC_SOURCE_SYMLINK"
            ) {
              sendJson({
                response,
                statusCode: 400,
                payload: {
                  error: "SYNC_DESTINATION_UNSAFE",
                  message: sanitizeErrorMessage({ error, fallback: "Sync destination is not safe for writes." })
                }
              });
              return;
            }
            if (error.code === "E_SYNC_FILE_DECISIONS_INVALID") {
              sendJson({
                response,
                statusCode: 400,
                payload: {
                  error: "SYNC_FILE_DECISIONS_INVALID",
                  message: sanitizeErrorMessage({ error, fallback: "Local sync file decisions are invalid." })
                }
              });
              return;
            }
          }

          sendJson({
            response,
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({ error, fallback: "Could not perform local sync." })
            }
          });
          return;
        }
      }

      if (parsedJobRoute?.action === "regenerate") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
          });
          return;
        }

        const parsed = RegenerationRequestSchema.safeParse(rawBody.value);
        if (!parsed.success) {
          sendJson({ response, statusCode: 400, payload: formatZodError(parsed.error) });
          return;
        }

        let accepted: ReturnType<JobEngine["submitRegeneration"]>;
        try {
          accepted = jobEngine.submitRegeneration({
            sourceJobId: jobId,
            overrides: parsed.data.overrides,
            ...(parsed.data.draftId ? { draftId: parsed.data.draftId } : {}),
            ...(parsed.data.baseFingerprint ? { baseFingerprint: parsed.data.baseFingerprint } : {})
          });
        } catch (error) {
          if (error instanceof Error && "code" in error) {
            const code = (error as { code?: string }).code;
            if (code === "E_JOB_QUEUE_FULL") {
              const queueValue = (error as { queue?: unknown }).queue;
              sendJson({
                response,
                statusCode: 429,
                payload: {
                  error: "QUEUE_BACKPRESSURE",
                  message: sanitizeErrorMessage({ error, fallback: "Job queue limit reached." }),
                  queue: typeof queueValue === "object" && queueValue !== null ? queueValue : undefined
                }
              });
              return;
            }
            if (code === "E_REGEN_SOURCE_NOT_FOUND") {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "SOURCE_JOB_NOT_FOUND",
                  message: `Source job '${jobId}' not found.`
                }
              });
              return;
            }
            if (code === "E_REGEN_SOURCE_NOT_COMPLETED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "SOURCE_JOB_NOT_COMPLETED",
                  message: sanitizeErrorMessage({ error, fallback: "Source job is not completed." })
                }
              });
              return;
            }
          }
          sendJson({
            response,
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({ error, fallback: "Could not submit regeneration job." })
            }
          });
          return;
        }

        sendJson({
          response,
          statusCode: 202,
          payload: accepted
        });
        return;
      }

      if (parsedJobRoute?.action === "create-pr") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
          });
          return;
        }

        const parsed = CreatePrRequestSchema.safeParse(rawBody.value);
        if (!parsed.success) {
          sendJson({ response, statusCode: 400, payload: formatZodError(parsed.error) });
          return;
        }

        let result: Awaited<ReturnType<JobEngine["createPrFromJob"]>>;
        try {
          result = await jobEngine.createPrFromJob({
            jobId,
            prInput: parsed.data
          });
        } catch (error) {
          if (error instanceof Error && "code" in error) {
            const code = (error as { code?: string }).code;
            if (code === "E_PR_JOB_NOT_FOUND") {
              sendJson({
                response,
                statusCode: 404,
                payload: {
                  error: "JOB_NOT_FOUND",
                  message: `Job '${jobId}' not found.`
                }
              });
              return;
            }
            if (code === "E_PR_JOB_NOT_COMPLETED") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "JOB_NOT_COMPLETED",
                  message: sanitizeErrorMessage({ error, fallback: "Job is not completed." })
                }
              });
              return;
            }
            if (code === "E_PR_NOT_REGENERATION_JOB") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "NOT_REGENERATION_JOB",
                  message: sanitizeErrorMessage({ error, fallback: "Only regeneration jobs support PR creation." })
                }
              });
              return;
            }
            if (code === "E_PR_NO_GENERATED_PROJECT") {
              sendJson({
                response,
                statusCode: 409,
                payload: {
                  error: "NO_GENERATED_PROJECT",
                  message: sanitizeErrorMessage({ error, fallback: "Job has no generated project." })
                }
              });
              return;
            }
          }
          sendJson({
            response,
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({ error, fallback: "Could not create PR." })
            }
          });
          return;
        }

        sendJson({
          response,
          statusCode: 200,
          payload: result
        });
        return;
      }

      if (parsedJobRoute?.action === "stale-check") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
          });
          return;
        }

        const body = rawBody.value as { draftNodeIds?: unknown };
        const draftNodeIds: string[] = Array.isArray(body.draftNodeIds)
          ? body.draftNodeIds.filter((v): v is string => typeof v === "string")
          : [];

        let checkResult: Awaited<ReturnType<JobEngine["checkStaleDraft"]>>;
        try {
          checkResult = await jobEngine.checkStaleDraft({ jobId, draftNodeIds });
        } catch (error) {
          sendJson({
            response,
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({ error, fallback: "Could not check draft staleness." })
            }
          });
          return;
        }

        sendJson({
          response,
          statusCode: 200,
          payload: checkResult
        });
        return;
      }

      if (parsedJobRoute?.action === "remap-suggest") {
        const jobId = decodeURIComponent(parsedJobRoute.jobId);
        const rawBody = await readJsonBody(request);
        if (!rawBody.ok) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "Request validation failed.",
              issues: [{ path: "(root)", message: rawBody.error }]
            }
          });
          return;
        }

        const body = rawBody.value as {
          sourceJobId?: unknown;
          latestJobId?: unknown;
          unmappedNodeIds?: unknown;
        };

        const sourceJobId = typeof body.sourceJobId === "string" ? body.sourceJobId : jobId;
        const latestJobId = typeof body.latestJobId === "string" ? body.latestJobId : "";
        const unmappedNodeIds: string[] = Array.isArray(body.unmappedNodeIds)
          ? body.unmappedNodeIds.filter((v): v is string => typeof v === "string")
          : [];

        if (!latestJobId) {
          sendJson({
            response,
            statusCode: 400,
            payload: {
              error: "VALIDATION_ERROR",
              message: "latestJobId is required."
            }
          });
          return;
        }

        let remapResult: Awaited<ReturnType<JobEngine["suggestRemaps"]>>;
        try {
          remapResult = await jobEngine.suggestRemaps({
            sourceJobId,
            latestJobId,
            unmappedNodeIds
          });
        } catch (error) {
          sendJson({
            response,
            statusCode: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: sanitizeErrorMessage({ error, fallback: "Could not generate remap suggestions." })
            }
          });
          return;
        }

        sendJson({
          response,
          statusCode: 200,
          payload: remapResult
        });
        return;
      }
    }

    if (method === "POST" && pathname === "/workspace/submit") {
      const rawBody = await readJsonBody(request);
      if (!rawBody.ok) {
        sendJson({
          response,
          statusCode: 400,
          payload: {
            error: "VALIDATION_ERROR",
            message: "Request validation failed.",
            issues: [{ path: "(root)", message: rawBody.error }]
          }
        });
        return;
      }

      const parsed = SubmitRequestSchema.safeParse(rawBody.value);
      if (!parsed.success) {
        sendJson({ response, statusCode: 400, payload: formatZodError(parsed.error) });
        return;
      }

      const { figmaSourceMode, llmCodegenMode } = parsed.data;
      const resolvedFigmaSourceMode =
        (figmaSourceMode?.trim().toLowerCase() as WorkspaceFigmaSourceMode | undefined) ?? defaults.figmaSourceMode;
      const resolvedLlmCodegenMode = llmCodegenMode ?? defaults.llmCodegenMode;
      const modeLockInput = {
        figmaSourceMode: resolvedFigmaSourceMode,
        llmCodegenMode: resolvedLlmCodegenMode
      };

      try {
        enforceModeLock(modeLockInput);
      } catch (error) {
        sendJson({
          response,
          statusCode: 400,
          payload: {
            error: "MODE_LOCK_VIOLATION",
            message: sanitizeErrorMessage({
              error,
              fallback: "Mode validation failed"
            }),
            allowedModes: {
              figmaSourceMode: defaults.figmaSourceMode,
              figmaSourceModes: [...getAllowedFigmaSourceModes()],
              llmCodegenMode: defaults.llmCodegenMode
            }
          }
        });
        return;
      }

      let accepted: ReturnType<JobEngine["submitJob"]>;
      try {
        accepted = jobEngine.submitJob({
          ...parsed.data,
          figmaSourceMode: resolvedFigmaSourceMode,
          llmCodegenMode: defaults.llmCodegenMode
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "E_JOB_QUEUE_FULL"
        ) {
          const queueValue = (error as { queue?: unknown }).queue;
          sendJson({
            response,
            statusCode: 429,
            payload: {
              error: "QUEUE_BACKPRESSURE",
              message: sanitizeErrorMessage({
                error,
                fallback: "Job queue limit reached."
              }),
              queue:
                typeof queueValue === "object" &&
                queueValue !== null
                  ? queueValue
                  : undefined
            }
          });
          return;
        }
        sendJson({
          response,
          statusCode: 500,
          payload: {
            error: "INTERNAL_ERROR",
            message: sanitizeErrorMessage({
              error,
              fallback: "Could not submit job."
            })
          }
        });
        return;
      }

      sendJson({
        response,
        statusCode: 202,
        payload: accepted
      });
      return;
    }

    sendJson({
      response,
      statusCode: 404,
      payload: {
        error: "NOT_FOUND",
        message: `Unknown route: ${method} ${pathname}`
      }
    });
  };
}

/** Allowed extensions for directory listing (matches validateSourceFilePath). */
const LISTING_EXTENSIONS = new Set([".tsx", ".ts", ".json", ".css", ".html", ".svg"]);
const LISTING_BLOCKED_DIRS = new Set(["node_modules", "dist"]);

async function collectSourceFiles(
  projectDir: string,
  dirFilter?: string
): Promise<Array<{ path: string; sizeBytes: number }>> {
  const results: Array<{ path: string; sizeBytes: number }> = [];
  const baseDir = dirFilter !== undefined ? path.join(projectDir, dirFilter) : projectDir;

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
