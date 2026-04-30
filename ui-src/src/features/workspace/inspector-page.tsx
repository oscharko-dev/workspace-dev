import { useCallback, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../lib/http";
import { InspectorPanel } from "./inspector/InspectorPanel";
import { InspectorErrorBoundary } from "./inspector/InspectorErrorBoundary";
import { InspectorBootstrap } from "./inspector/InspectorBootstrap";
import { useInspectorBootstrap } from "./inspector/useInspectorBootstrap";
import { useStreamingTreeNodes } from "./inspector/component-tree-utils";
import { useImportHistory } from "./inspector/useImportHistory";
import {
  getJobQualityPassportPayload,
  isJobPayload,
  type JobPayload,
  type RuntimeStatusPayload,
} from "./workspace-page.helpers";
import type { PasteImportSession } from "./inspector/paste-import-history";
import type { ImportIntent } from "./inspector/paste-input-classifier";
import {
  BACKEND_STAGES,
  createInitialPipelineState,
  type PipelineError,
  type PipelineFallbackMode,
  type PastePipelineState,
  type PipelineImportMode,
  type PipelineStage,
} from "./inspector/paste-pipeline";
import type { PipelineExecutionLog } from "./inspector/pipeline-execution-log";

function BackIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
    >
      <path
        fillRule="evenodd"
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
    >
      <path d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" />
      <path d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
    >
      <path
        fillRule="evenodd"
        d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.916a.5.5 0 0 1 .67.033l.774.775a.5.5 0 0 1 .034.67l-.916 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.497v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.916 1.321a.5.5 0 0 1-.034.67l-.774.774a.5.5 0 0 1-.67.033l-1.32-.916c-.417.25-.873.443-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a4.973 4.973 0 0 1-1.356-.562l-1.321.916a.5.5 0 0 1-.67-.034l-.774-.774a.5.5 0 0 1-.034-.67l.916-1.32a4.972 4.972 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.916-1.321a.5.5 0 0 1 .034-.67l.774-.774a.5.5 0 0 1 .67-.033l1.32.916c.417-.25.873-.443 1.357-.563l.17-1.699ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export type ConfigDialogKey =
  | "preApplyReview"
  | "localSync"
  | "createPr"
  | "inspectability";

const CONFIG_BUTTONS: { key: ConfigDialogKey; label: string }[] = [
  { key: "preApplyReview", label: "Review" },
  { key: "localSync", label: "Sync" },
  { key: "createPr", label: "PR" },
  { key: "inspectability", label: "Coverage" },
];

interface PanelViewProps {
  jobId: string;
  previewUrl: string;
  previousJobId: string | null;
  initialIsRegeneration: boolean;
  pipeline?: PastePipelineState;
  onPipelineRetry?: (stage?: PipelineStage, targetIds?: string[]) => void;
  executionLog?: PipelineExecutionLog;
  importHistory?: readonly PasteImportSession[];
  previousImportSession?: PasteImportSession | null;
  onGenerateSelected?: (
    selectedNodeIds: readonly string[],
    options?: { importMode?: PipelineImportMode },
  ) => void;
  onResubmitFresh?: () => void;
  onRemoveImportSession?: (sessionId: string) => void;
  onReimportSession?: (session: PasteImportSession) => void;
}

const BACKEND_TO_PIPELINE_STAGE: Record<string, PipelineStage> = {
  "figma.source": "resolving",
  "ir.derive": "transforming",
  "template.prepare": "mapping",
  "codegen.generate": "generating",
  "validate.project": "generating",
  "repro.export": "generating",
  "git.pr": "generating",
};

function toPipelineStage(value: unknown): PipelineStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value in BACKEND_TO_PIPELINE_STAGE) {
    return BACKEND_TO_PIPELINE_STAGE[value];
  }
  if (
    value === "resolving" ||
    value === "extracting" ||
    value === "transforming" ||
    value === "mapping" ||
    value === "generating"
  ) {
    return value;
  }
  return undefined;
}

function toFallbackMode(value: unknown): PipelineFallbackMode | undefined {
  return value === "rest" ? "rest" : undefined;
}

function toHydratedPipelineError({
  source,
  fallbackStage,
}: {
  source: {
    code?: string;
    message?: string;
    stage?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    fallbackMode?: string;
  };
  fallbackStage: PipelineStage;
}): PipelineError {
  const stage = toPipelineStage(source.stage) ?? fallbackStage;
  const message = source.message ?? source.code ?? "Pipeline stage failed.";

  return {
    stage,
    code: source.code ?? message,
    message,
    retryable: source.retryable === true,
    ...(typeof source.retryAfterMs === "number"
      ? { retryAfterMs: source.retryAfterMs }
      : {}),
    ...(toFallbackMode(source.fallbackMode) !== undefined
      ? { fallbackMode: toFallbackMode(source.fallbackMode) }
      : {}),
  };
}

function toHydratedPipelineState(payload: JobPayload): PastePipelineState {
  const state = createInitialPipelineState();
  const stageProgress = { ...state.stageProgress };
  const stages = [
    ...(Array.isArray(payload.stages) ? payload.stages : []),
    ...(Array.isArray(payload.inspector?.stages) ? payload.inspector.stages : []),
  ];
  const errors: PipelineError[] = [];
  let fallbackMode: PipelineFallbackMode | undefined;

  for (const stagePayload of stages) {
    const pipelineStage = toPipelineStage(
      "name" in stagePayload ? stagePayload.name : stagePayload.stage,
    );
    if (pipelineStage === undefined) {
      continue;
    }
    const nextStatus =
      stagePayload.status === "completed"
        ? "done"
        : stagePayload.status === "failed"
          ? "failed"
          : stagePayload.status === "running"
            ? "running"
            : "pending";
    stageProgress[pipelineStage] = {
      state: nextStatus,
      ...(stagePayload.message !== undefined
        ? { message: stagePayload.message }
        : {}),
    };
    fallbackMode =
      fallbackMode ?? toFallbackMode(stagePayload.fallbackMode);
    if (nextStatus === "failed") {
      errors.push(
        toHydratedPipelineError({
          source: stagePayload,
          fallbackStage: pipelineStage,
        }),
      );
    }
  }

  if (payload.error !== undefined) {
    errors.push(
      toHydratedPipelineError({
        source: payload.error,
        fallbackStage: errors[errors.length - 1]?.stage ?? "generating",
      }),
    );
    fallbackMode = fallbackMode ?? toFallbackMode(payload.error.fallbackMode);
  }

  const uniqueErrors = errors.filter(
    (error, index) =>
      errors.findIndex(
        (candidate) =>
          candidate.stage === error.stage &&
          candidate.code === error.code &&
          candidate.message === error.message,
      ) === index,
  );
  const resolvedStages = BACKEND_STAGES.filter(
    (stage) => stageProgress[stage].state === "done",
  ).length;
  const errorCount = BACKEND_STAGES.filter(
    (stage) => stageProgress[stage].state === "failed",
  ).length;
  const isPartial = errorCount > 0 && resolvedStages > 0;
  const failedStage = uniqueErrors[uniqueErrors.length - 1]?.stage;
  const jobStatus =
    payload.status === "queued" ||
    payload.status === "running" ||
    payload.status === "completed" ||
    payload.status === "partial" ||
    payload.status === "failed" ||
    payload.status === "canceled"
      ? payload.status
      : undefined;
  const pipelineId = payload.pipelineId ?? payload.inspector?.pipelineId;
  const pipelineMetadata =
    payload.pipelineMetadata ?? payload.inspector?.pipelineMetadata;
  const qualityPassport = getJobQualityPassportPayload(payload);
  const previewUrl = payload.preview?.url;
  const outcome =
    payload.status === "completed"
      ? "success"
      : isPartial
        ? "partial"
        : uniqueErrors.length > 0
          ? "failed"
          : undefined;

  return {
    ...state,
    jobId: payload.jobId,
    stage:
      payload.status === "completed"
        ? "ready"
        : isPartial
          ? "partial"
          : uniqueErrors.length > 0
            ? "error"
            : payload.status === "running"
              ? (failedStage ?? "generating")
              : state.stage,
    stageProgress,
    errors: uniqueErrors,
    canRetry: uniqueErrors.some((error) => error.retryable),
    canCancel: payload.status === "queued" || payload.status === "running",
    ...(jobStatus !== undefined ? { jobStatus } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(pipelineId !== undefined ? { pipelineId } : {}),
    ...(pipelineMetadata !== undefined ? { pipelineMetadata } : {}),
    ...(qualityPassport !== undefined ? { qualityPassport } : {}),
    ...(previewUrl !== undefined ? { previewUrl } : {}),
    ...(fallbackMode !== undefined ? { fallbackMode } : {}),
    ...(isPartial
      ? {
          partialStats: {
            resolvedStages,
            totalStages: BACKEND_STAGES.length,
            errorCount,
          },
        }
      : {}),
  };
}

function useHydratedPipelineState({
  jobId,
  enabled,
}: {
  jobId: string;
  enabled: boolean;
}): PastePipelineState | undefined {
  const jobStatusQuery = useQuery({
    queryKey: ["inspector-panel-job-pipeline", jobId],
    enabled,
    queryFn: async (): Promise<PastePipelineState | undefined> => {
      const response = await fetchJson<JobPayload>({
        url: `/workspace/jobs/${encodeURIComponent(jobId)}`,
      });
      if (!response.ok || !isJobPayload(response.payload)) {
        return undefined;
      }
      return toHydratedPipelineState(response.payload);
    },
    staleTime: Infinity,
  });

  return jobStatusQuery.data;
}

function PanelView({
  jobId,
  previewUrl,
  previousJobId,
  initialIsRegeneration,
  pipeline,
  onPipelineRetry,
  executionLog,
  importHistory,
  previousImportSession,
  onGenerateSelected,
  onResubmitFresh,
  onRemoveImportSession,
  onReimportSession,
}: PanelViewProps): JSX.Element {
  const navigate = useNavigate();
  const [acceptedRegeneration, setAcceptedRegeneration] = useState<{
    sourceJobId: string;
    nextJobId: string;
  } | null>(null);
  const activeJobId =
    acceptedRegeneration?.sourceJobId === jobId
      ? acceptedRegeneration.nextJobId
      : jobId;
  const activePipeline =
    pipeline?.jobId === activeJobId ? pipeline : undefined;
  const hydratedPipeline = useHydratedPipelineState({
    jobId: activeJobId,
    enabled: activePipeline === undefined,
  });
  const activeIsRegenerationJob =
    initialIsRegeneration ||
    acceptedRegeneration?.sourceJobId === jobId ||
    acceptedRegeneration?.nextJobId === jobId;
  const [openDialog, setOpenDialog] = useState<ConfigDialogKey | null>(null);

  const runtimeStatusQuery = useQuery({
    queryKey: ["workspace", "runtime-status"],
    queryFn: async () => {
      const response = await fetchJson<{ testIntelligenceEnabled?: boolean }>({
        url: "/workspace",
      });
      if (!response.ok) {
        return { testIntelligenceEnabled: false };
      }
      const payload = response.payload;
      if (
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "testIntelligenceEnabled" in payload &&
        typeof (payload as { testIntelligenceEnabled?: unknown })
          .testIntelligenceEnabled === "boolean"
      ) {
        return {
          testIntelligenceEnabled: (
            payload as { testIntelligenceEnabled: boolean }
          ).testIntelligenceEnabled,
        };
      }
      return { testIntelligenceEnabled: false };
    },
  });
  const testIntelligenceEnabled =
    runtimeStatusQuery.data?.testIntelligenceEnabled === true;

  const activePreviewUrl = useMemo(() => {
    return previewUrl;
  }, [previewUrl]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#101010] text-white">
      <header className="shrink-0 border-b border-[#000000] bg-[#171717]">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigate("/workspace/ui");
              }}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-white/60 transition hover:border-white/10 hover:bg-[#000000] hover:text-[#4eba87]"
            >
              <BackIcon />
              Back
            </button>

            <div className="h-4 w-px bg-[#333333]" />

            <div className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded border border-[#000000] bg-[#333333]">
                <img
                  src="/workspace/ui/logo-keiko.svg"
                  alt=""
                  className="block size-4 object-contain"
                />
              </div>
              <div className="flex items-baseline gap-2">
                <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                  Inspector
                </h1>
                <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                  workspace-dev
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {CONFIG_BUTTONS.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => {
                  setOpenDialog(btn.key);
                }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                  openDialog === btn.key
                    ? "border-[#4eba87] bg-[#4eba87]/12 text-[#4eba87]"
                    : "border-transparent bg-transparent text-white/55 hover:border-white/10 hover:bg-[#000000] hover:text-white"
                }`}
              >
                <SettingsIcon />
                {btn.label}
              </button>
            ))}
            {testIntelligenceEnabled ? (
              <button
                type="button"
                data-testid="inspector-open-test-intelligence"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (jobId.length > 0) {
                    params.set("jobId", jobId);
                  }
                  const search = params.toString();
                  void navigate(
                    search.length > 0
                      ? `/workspace/ui/inspector/test-intelligence?${search}`
                      : "/workspace/ui/inspector/test-intelligence",
                  );
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-[11px] font-medium text-white/55 transition hover:border-white/10 hover:bg-[#000000] hover:text-white"
              >
                <SettingsIcon />
                Test Intelligence
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded border border-[#000000] bg-[#222222] px-2 py-0.5 text-[10px] font-mono text-white/45">
              rest + deterministic
            </span>
            {activePreviewUrl ? (
              <a
                href={activePreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-[#333333] bg-transparent px-2 py-1 text-[11px] font-medium text-white/60 no-underline transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
              >
                <ExternalLinkIcon />
                Preview
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorErrorBoundary>
          <InspectorPanel
            jobId={activeJobId}
            previewUrl={activePreviewUrl}
            previousJobId={previousJobId}
            isRegenerationJob={activeIsRegenerationJob}
            onRegenerationAccepted={(nextJobId) => {
              setAcceptedRegeneration({
                sourceJobId: jobId,
                nextJobId,
              });
            }}
            openDialog={openDialog}
            onCloseDialog={() => {
              setOpenDialog(null);
            }}
            {...(activePipeline !== undefined
              ? { pipeline: activePipeline }
              : hydratedPipeline !== undefined
                ? { pipeline: hydratedPipeline }
                : {})}
            {...(onPipelineRetry !== undefined ? { onPipelineRetry } : {})}
            {...(executionLog !== undefined ? { executionLog } : {})}
            {...(importHistory !== undefined ? { importHistory } : {})}
            {...(previousImportSession !== undefined
              ? { previousImportSession }
              : {})}
            {...(onGenerateSelected !== undefined
              ? { onGenerateSelected }
              : {})}
            {...(onResubmitFresh !== undefined ? { onResubmitFresh } : {})}
            {...(onRemoveImportSession !== undefined
              ? { onRemoveImportSession }
              : {})}
            {...(onReimportSession !== undefined ? { onReimportSession } : {})}
          />
        </InspectorErrorBoundary>
      </main>
    </div>
  );
}

function BootstrapView(): JSX.Element {
  const runtimeStatusQuery = useQuery({
    queryKey: ["workspace", "runtime-pipelines"],
    queryFn: async (): Promise<RuntimeStatusPayload | null> => {
      const response = await fetchJson<RuntimeStatusPayload>({
        url: "/workspace",
      });
      if (!response.ok) {
        return null;
      }
      return response.payload as RuntimeStatusPayload;
    },
  });

  const bootstrap = useInspectorBootstrap({
    availablePipelines: runtimeStatusQuery.data?.availablePipelines,
    defaultPipelineId: runtimeStatusQuery.data?.defaultPipelineId,
  });
  const treeNodes = useStreamingTreeNodes(bootstrap.pipelineState);
  const importHistoryHook = useImportHistory();
  const [historyReimportJobId, setHistoryReimportJobId] = useState<
    string | null
  >(null);
  const [historyReimportSourceJobId, setHistoryReimportSourceJobId] = useState<
    string | null
  >(null);
  const [historyReimportReplayReady, setHistoryReimportReplayReady] =
    useState(false);
  const [historyReimportPending, setHistoryReimportPending] =
    useState(false);

  const clearHistoryReimportState = useCallback((): void => {
    setHistoryReimportPending(false);
    setHistoryReimportReplayReady(false);
    setHistoryReimportJobId(null);
    setHistoryReimportSourceJobId(null);
  }, []);

  const previousImportSession = useMemo(() => {
    const pasteIdentityKey = bootstrap.pipelineState.pasteIdentityKey ?? null;
    const urlContext = bootstrap.lastUrlContext;
    const jobId = bootstrap.pipelineState.jobId;
    const match = importHistoryHook.findPrevious({
      pasteIdentityKey,
      ...(urlContext?.fileKey !== undefined
        ? { fileKey: urlContext.fileKey }
        : {}),
      ...(urlContext?.nodeId !== undefined && urlContext.nodeId !== null
        ? { nodeId: urlContext.nodeId }
        : {}),
    });
    if (!match) {
      return null;
    }
    if (jobId !== undefined && match.jobId === jobId) {
      return null;
    }
    return match;
  }, [
    bootstrap.lastUrlContext,
    bootstrap.pipelineState.jobId,
    bootstrap.pipelineState.pasteIdentityKey,
    importHistoryHook,
  ]);

  const handlePaste = useCallback(
    (text: string, clipboardHtml?: string): void => {
      bootstrap.submitPaste(
        text,
        clipboardHtml !== undefined
          ? { source: "paste-event", clipboardHtml }
          : { source: "paste-event" },
      );
    },
    // `bootstrap` is a stable reference to the hook's return object; we re-run
    // when the object identity changes so we always submit via the latest
    // closure. The listed dep is intentional.
    [bootstrap],
  );

  const handleDropFile = useCallback(
    (text: string, source: "drop" | "upload"): void => {
      bootstrap.submitPaste(text, { source });
    },
    [bootstrap],
  );

  const handleError = useCallback(
    (code: "TOO_LARGE" | "UNSUPPORTED_FILE"): void => {
      bootstrap.reportInputError(code);
    },
    [bootstrap],
  );

  const handleRetry = useCallback(
    (stage?: PipelineStage, targetIds?: string[]): void => {
      bootstrap.retry(stage, targetIds);
    },
    [bootstrap],
  );

  const handleConfirmIntent = useCallback(
    (intent: ImportIntent): void => {
      bootstrap.confirmIntent(intent);
    },
    [bootstrap],
  );

  const handleDismissIntent = useCallback((): void => {
    bootstrap.dismissIntent();
  }, [bootstrap]);

  const handleFigmaUrl = useCallback(
    (fileKey: string, nodeId: string | null): void => {
      bootstrap.submitUrl(fileKey, nodeId);
    },
    [bootstrap],
  );

  const handlePipelineIdChange = useCallback(
    (pipelineId: string): void => {
      bootstrap.setSelectedPipelineId(pipelineId);
    },
    [bootstrap],
  );

  const handleGenerateSelected = useCallback(
    (
      selectedNodeIds: readonly string[],
      options?: { importMode?: PipelineImportMode },
    ): void => {
      clearHistoryReimportState();
      bootstrap.regenerateScoped({
        selectedNodeIds,
        ...(options?.importMode !== undefined
          ? { importMode: options.importMode }
          : {}),
      });
    },
    [bootstrap, clearHistoryReimportState],
  );

  const handleResubmitFresh = useCallback((): void => {
    clearHistoryReimportState();
    bootstrap.resubmitFresh();
  }, [bootstrap, clearHistoryReimportState]);

  const handleRemoveImportSession = useCallback(
    (sessionId: string): void => {
      void importHistoryHook.removeSession(sessionId);
    },
    [importHistoryHook],
  );

  const handleReimportSession = useCallback(
    (session: PasteImportSession): void => {
      if (session.replayable === false) {
        return;
      }
      clearHistoryReimportState();
      setHistoryReimportPending(true);
      void (async (): Promise<void> => {
        try {
          const accepted = await importHistoryHook.reimportSession(session.id);
          const replayReady = bootstrap.seedReplayContext({
            fileKey: session.fileKey,
            nodeId: session.nodeId,
            ...(accepted.pipelineId !== undefined
              ? { acceptedPipelineId: accepted.pipelineId }
              : {}),
            ...(session.pipelineId !== undefined
              ? { sessionPipelineId: session.pipelineId }
              : {}),
          });
          setHistoryReimportReplayReady(replayReady);
          setHistoryReimportJobId(accepted.jobId);
          setHistoryReimportSourceJobId(accepted.sourceJobId);
        } catch {
          // Warning state is surfaced by useImportHistory.
        } finally {
          setHistoryReimportPending(false);
        }
      })();
    },
    [bootstrap, clearHistoryReimportState, importHistoryHook],
  );

  const activeJobId =
    historyReimportJobId ??
    (bootstrap.state.kind !== "failed" ? bootstrap.jobId : null);
  const exposeReplayControls =
    !historyReimportPending &&
    (historyReimportJobId === null || historyReimportReplayReady);

  if (activeJobId) {
    return (
      <PanelView
        jobId={activeJobId}
        previewUrl={historyReimportJobId ? "" : (bootstrap.previewUrl ?? "")}
        previousJobId={historyReimportSourceJobId}
        initialIsRegeneration={false}
        {...(historyReimportJobId === null
          ? {
              pipeline: bootstrap.pipelineState,
              onPipelineRetry: handleRetry,
              executionLog: bootstrap.executionLog,
            }
          : {})}
        importHistory={importHistoryHook.history.entries}
        previousImportSession={
          historyReimportJobId === null ? previousImportSession : null
        }
        {...(exposeReplayControls
          ? { onGenerateSelected: handleGenerateSelected }
          : {})}
        {...(exposeReplayControls ? { onResubmitFresh: handleResubmitFresh } : {})}
        onRemoveImportSession={handleRemoveImportSession}
        onReimportSession={handleReimportSession}
      />
    );
  }

  return (
    <InspectorBootstrap
      state={bootstrap.state}
      onPaste={handlePaste}
      onDropFile={handleDropFile}
      onError={handleError}
      onRetry={handleRetry}
      onConfirmIntent={handleConfirmIntent}
      onDismissIntent={handleDismissIntent}
      onFigmaUrl={handleFigmaUrl}
      availablePipelines={runtimeStatusQuery.data?.availablePipelines}
      selectedPipelineId={bootstrap.selectedPipelineId}
      onPipelineIdChange={handlePipelineIdChange}
      previewUrl={bootstrap.previewUrl}
      screenshot={bootstrap.screenshot}
      pipelineStage={bootstrap.pipelineStage}
      treeNodes={treeNodes}
    />
  );
}

export function InspectorPage(): JSX.Element {
  const [searchParams] = useSearchParams();

  const jobId = searchParams.get("jobId") ?? "";
  const previewUrl = searchParams.get("previewUrl") ?? "";
  const previousJobId = searchParams.get("previousJobId");
  const isRegeneration = searchParams.get("isRegeneration") === "true";

  const hasDeepLinkParams = Boolean(jobId && previewUrl);

  if (hasDeepLinkParams) {
    return (
      <PanelView
        jobId={jobId}
        previewUrl={previewUrl}
        previousJobId={previousJobId}
        initialIsRegeneration={isRegeneration}
      />
    );
  }

  return <BootstrapView />;
}
