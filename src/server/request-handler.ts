import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceFigmaSourceMode, WorkspaceStatus } from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import type { JobEngine } from "../job-engine.js";
import { enforceModeLock } from "../mode-lock.js";
import { buildScreenArtifactIdentities } from "../parity/generator-artifacts.js";
import type { ScreenIR } from "../parity/types-ir.js";
import { SubmitRequestSchema, formatZodError } from "../schemas.js";
import { sendBuffer, sendJson, sendText, readJsonBody } from "./http-helpers.js";
import { isWorkspaceProjectRoute, parseJobFilesRoute, parseJobRoute, parseReproRoute, resolveUiAssetPath, validateSourceFilePath } from "./routes.js";
import { getUiAsset, getUiAssets } from "./ui-assets.js";

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
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", "http://workspace-dev.local");
    const pathname = requestUrl.pathname;

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

        sendBuffer({
          response,
          statusCode: 200,
          contentType: previewAsset.contentType,
          payload: previewAsset.content,
          cacheControl: "no-store, no-cache, must-revalidate, max-age=0"
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

    if (method === "POST") {
      const parsedJobRoute = parseJobRoute(pathname);
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
              figmaSourceModes: ["rest", "local_json"],
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
