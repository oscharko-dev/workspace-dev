import { useEffect, useMemo, useState, type JSX } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { getInitialFigmaKeyFromPath } from "../../lib/path-utils";
import { redactSecrets } from "../../lib/redact-secrets";
import {
  workspaceSubmitSchema,
  toWorkspaceSubmitPayload,
  type WorkspaceSubmitFormData,
  type WorkspaceSubmitPayload
} from "./submit-schema";

const endpoints = {
  health: "/healthz",
  workspace: "/workspace",
  submit: "/workspace/submit",
  job: ({ jobId }: { jobId: string }) => `/workspace/jobs/${encodeURIComponent(jobId)}`,
  result: ({ jobId }: { jobId: string }) => `/workspace/jobs/${encodeURIComponent(jobId)}/result`,
  cancel: ({ jobId }: { jobId: string }) => `/workspace/jobs/${encodeURIComponent(jobId)}/cancel`
};

const RUNTIME_POLL_INTERVAL_MS = 5_000;
const JOB_POLL_INTERVAL_MS = 1_500;

type BadgeVariant = "default" | "ok" | "warn" | "error";
type JobLifecycleStatus = "queued" | "running" | "completed" | "failed" | "canceled";

interface RuntimeStatusPayload {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: "rest" | "hybrid" | "local_json";
  llmCodegenMode: "deterministic";
  uptimeMs: number;
  outputRoot: string;
  previewEnabled: boolean;
}

interface JobStagePayload {
  name: string;
  status: string;
}

interface JobErrorPayload {
  message?: string;
}

interface JobPreviewPayload {
  enabled?: boolean;
  url?: string;
}

interface JobQueuePayload {
  runningCount?: number;
  queuedCount?: number;
  maxConcurrentJobs?: number;
  maxQueuedJobs?: number;
  position?: number;
}

interface JobCancellationPayload {
  requestedAt?: string;
  reason?: string;
  completedAt?: string;
}

interface JobGenerationDiffPayload {
  summary?: string;
  added?: string[];
  modified?: { file: string }[];
  removed?: string[];
  unchanged?: string[];
  previousJobId?: string | null;
}

interface JobLineagePayload {
  sourceJobId?: string;
}

interface JobPayload {
  jobId: string;
  status: string;
  stages?: JobStagePayload[];
  preview?: JobPreviewPayload;
  queue?: JobQueuePayload;
  cancellation?: JobCancellationPayload;
  generationDiff?: JobGenerationDiffPayload;
  lineage?: JobLineagePayload;
  error?: JobErrorPayload;
}

interface SubmitAcceptedPayload {
  jobId?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJobPayload(value: unknown): value is JobPayload {
  return (
    isRecord(value) &&
    typeof value.jobId === "string" &&
    typeof value.status === "string"
  );
}

function getRouteFigmaKey(routeFigmaKey?: string): string | undefined {
  if (!routeFigmaKey || routeFigmaKey === "ui") {
    return undefined;
  }

  try {
    return decodeURIComponent(routeFigmaKey);
  } catch {
    return undefined;
  }
}

function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function getJobLifecycleStatus(payload?: JobPayload): JobLifecycleStatus | undefined {
  if (!payload) {
    return undefined;
  }

  if (payload.status === "queued") {
    return "queued";
  }
  if (payload.status === "running") {
    return "running";
  }
  if (payload.status === "completed") {
    return "completed";
  }
  if (payload.status === "failed") {
    return "failed";
  }
  if (payload.status === "canceled") {
    return "canceled";
  }

  return undefined;
}

function getSubmitBadge({
  isSubmitting,
  status,
  isCanceling
}: {
  isSubmitting: boolean;
  status: JobLifecycleStatus | undefined;
  isCanceling: boolean;
}): { text: string; variant: BadgeVariant } {
  if (isSubmitting) {
    return { text: "SUBMITTING", variant: "warn" };
  }
  if (isCanceling) {
    return { text: "CANCELING", variant: "warn" };
  }

  if (status === "queued") {
    return { text: "QUEUED", variant: "warn" };
  }
  if (status === "running") {
    return { text: "RUNNING", variant: "warn" };
  }
  if (status === "completed") {
    return { text: "COMPLETED", variant: "ok" };
  }
  if (status === "failed") {
    return { text: "FAILED", variant: "error" };
  }
  if (status === "canceled") {
    return { text: "CANCELED", variant: "warn" };
  }

  return { text: "IDLE", variant: "default" };
}

function toStageBadgeVariant(stageStatus: string): BadgeVariant {
  if (stageStatus === "completed") {
    return "ok";
  }
  if (stageStatus === "failed") {
    return "error";
  }
  if (stageStatus === "running") {
    return "warn";
  }
  return "default";
}

function getHealthBadge(response: JsonResponse<Record<string, unknown>> | undefined): {
  text: string;
  variant: BadgeVariant;
} {
  if (!response) {
    return { text: "UNKNOWN", variant: "default" };
  }

  if (response.ok) {
    return { text: "READY", variant: "ok" };
  }

  return { text: `ERROR ${response.status}`, variant: "error" };
}

function getWorkspaceBadge(response: JsonResponse<RuntimeStatusPayload> | undefined): {
  text: string;
  variant: BadgeVariant;
} {
  if (!response) {
    return { text: "UNKNOWN", variant: "default" };
  }

  if (response.ok) {
    return { text: "ONLINE", variant: "ok" };
  }

  return { text: `ERROR ${response.status}`, variant: "error" };
}

function getJobSummary({
  status,
  payload,
  activeJobId
}: {
  status: JobLifecycleStatus | undefined;
  payload: JobPayload | undefined;
  activeJobId: string | null;
}): string {
  if (!activeJobId) {
    return "No job started yet.";
  }

  if (!payload) {
    return `Job ${activeJobId} accepted.`;
  }

  if (status === "queued" || status === "running") {
    if (payload.cancellation && !payload.cancellation.completedAt) {
      return `Job ${payload.jobId} cancellation requested.`;
    }
    const queuePosition = payload.queue?.position;
    if (typeof queuePosition === "number" && queuePosition > 0 && status === "queued") {
      return `Job ${payload.jobId} is queued (position ${queuePosition}).`;
    }
    return `Job ${payload.jobId} is ${status}.`;
  }

  if (status === "completed") {
    return `Job ${payload.jobId} completed successfully.`;
  }

  if (status === "failed") {
    return `Job ${payload.jobId} failed.`;
  }
  if (status === "canceled") {
    return `Job ${payload.jobId} canceled.`;
  }

  return `Job ${payload.jobId} status is ${payload.status}.`;
}

function canCancelJob({
  status,
  payload
}: {
  status: JobLifecycleStatus | undefined;
  payload: JobPayload | undefined;
}): boolean {
  if (!payload || !status) {
    return false;
  }
  if (status !== "queued" && status !== "running") {
    return false;
  }
  if (payload.cancellation && !payload.cancellation.completedAt) {
    return false;
  }
  return true;
}

function getBadgeClasses(variant: BadgeVariant): string {
  if (variant === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-600";
  }
  if (variant === "warn") {
    return "border-slate-400 bg-slate-200 text-slate-900";
  }
  if (variant === "error") {
    return "border-black bg-white text-black";
  }
  return "border-slate-300 bg-slate-100 text-slate-900";
}

function StatusBadge({ text, variant }: { text: string; variant: BadgeVariant }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${getBadgeClasses(variant)}`}
    >
      {text}
    </span>
  );
}

function FieldHint({ message }: { message: string | undefined }): JSX.Element {
  return <p className="min-h-4 text-xs text-rose-700">{message || "\u00a0"}</p>;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds % 60}s`;
}

function getModeChipClasses({ isActive }: { isActive: boolean }): string {
  return `rounded-md px-3 py-1 text-sm font-medium ${
    isActive
      ? "border border-[#4eba87] bg-emerald-500/5 text-[#4eba87]"
      : "text-[#333]"
  }`;
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function RefreshIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.68a.75.75 0 0 1-1.5 0V9.565a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5h-1.37l.84.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.274-.498Z" clipRule="evenodd" />
    </svg>
  );
}

function CancelIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function EmptyPreviewIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-6 text-slate-400">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

export function WorkspacePage(): JSX.Element {
  const routeParams = useParams<{ figmaFileKey?: string }>();
  const routeFigmaKey = getRouteFigmaKey(routeParams.figmaFileKey);
  const pathnameFigmaKey = getInitialFigmaKeyFromPath({ pathname: window.location.pathname });
  const initialFigmaKey = routeFigmaKey || pathnameFigmaKey || "";
  const navigate = useNavigate();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [submitPayloadView, setSubmitPayloadView] = useState<string>(toPrettyJson({}));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRuntimeDiag, setShowRuntimeDiag] = useState(false);
  const [showJobDiag, setShowJobDiag] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<WorkspaceSubmitFormData>({
    resolver: zodResolver(workspaceSubmitSchema),
    defaultValues: {
      figmaFileKey: initialFigmaKey,
      figmaAccessToken: "",
      figmaJsonPath: "",
      storybookStaticDir: "",
      customerProfilePath: "",
      figmaSourceMode: "rest",
      enableGitPr: false,
      repoUrl: "",
      repoToken: "",
      projectName: "",
      targetPath: ""
    }
  });

  const isGitPrEnabled = watch("enableGitPr");
  const selectedFigmaSourceMode = watch("figmaSourceMode");

  const runtimeQuery = useQuery({
    queryKey: ["runtime-status"],
    queryFn: async () => {
      const [health, workspace] = await Promise.all([
        fetchJson<Record<string, unknown>>({ url: endpoints.health }),
        fetchJson<RuntimeStatusPayload>({ url: endpoints.workspace })
      ]);
      return { health, workspace };
    },
    refetchInterval: RUNTIME_POLL_INTERVAL_MS
  });

  const submitMutation = useMutation<
    {
      requestPayload: WorkspaceSubmitPayload;
      response: JsonResponse<SubmitAcceptedPayload>;
    },
    Error,
    WorkspaceSubmitFormData
  >({
    mutationFn: async (formData) => {
      const requestPayload = toWorkspaceSubmitPayload({ formData });
      const response = await fetchJson<SubmitAcceptedPayload>({
        url: endpoints.submit,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(requestPayload)
        }
      });

      return { requestPayload, response };
    },
    onSuccess: ({ requestPayload, response }) => {
      const submitSnapshot = redactSecrets({
        value: {
          request: requestPayload,
          response: {
            status: response.status,
            payload: response.payload
          }
        }
      });
      setSubmitPayloadView(toPrettyJson(submitSnapshot));

      const payload = response.payload;
      const maybeJobId = isRecord(payload) && typeof payload.jobId === "string" ? payload.jobId : undefined;
      if (response.status === 202 && maybeJobId) {
        setActiveJobId(maybeJobId);
        return;
      }

      setActiveJobId(null);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitPayloadView(
        toPrettyJson({
          error: "NETWORK_ERROR",
          message
        })
      );
      setActiveJobId(null);
    }
  });

  const jobQuery = useQuery({
    queryKey: ["job-status", activeJobId],
    enabled: Boolean(activeJobId),
    queryFn: async () => {
      if (!activeJobId) {
        throw new Error("Missing active job id");
      }

      return await fetchJson<JobPayload>({ url: endpoints.job({ jobId: activeJobId }) });
    },
    refetchInterval: (query) => {
      const response = query.state.data;
      if (!response?.ok || !isJobPayload(response.payload)) {
        return false;
      }

      return response.payload.status === "queued" || response.payload.status === "running"
        ? JOB_POLL_INTERVAL_MS
        : false;
    }
  });

  const cancelMutation = useMutation<
    {
      jobId: string;
      response: JsonResponse<JobPayload>;
    },
    Error,
    { jobId: string }
  >({
    mutationFn: async ({ jobId }) => {
      const response = await fetchJson<JobPayload>({
        url: endpoints.cancel({ jobId }),
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            reason: "Cancellation requested from workspace UI."
          })
        }
      });
      return { jobId, response };
    },
    onSuccess: ({ response }) => {
      setSubmitPayloadView((previous) => {
        let previousObject: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(previous) as unknown;
          if (isRecord(parsed)) {
            previousObject = parsed;
          }
        } catch {
          previousObject = {};
        }

        return toPrettyJson(
          redactSecrets({
            value: {
              ...previousObject,
              cancel: {
                status: response.status,
                payload: response.payload
              }
            }
          })
        );
      });
      void jobQuery.refetch();
    }
  });

  const jobPayload = useMemo(() => {
    if (!jobQuery.data?.ok || !isJobPayload(jobQuery.data.payload)) {
      return undefined;
    }

    return jobQuery.data.payload;
  }, [jobQuery.data]);

  const jobStatus = getJobLifecycleStatus(jobPayload);

  const jobResultQuery = useQuery({
    queryKey: ["job-result", activeJobId],
    enabled: Boolean(activeJobId && jobStatus === "completed"),
    queryFn: async () => {
      if (!activeJobId) {
        throw new Error("Missing active job id");
      }
      return await fetchJson<Record<string, unknown>>({ url: endpoints.result({ jobId: activeJobId }) });
    }
  });

  useEffect(() => {
    if (!jobResultQuery.data) {
      return;
    }

    setSubmitPayloadView((previous) => {
      let previousObject: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(previous) as unknown;
        if (isRecord(parsed)) {
          previousObject = parsed;
        }
      } catch {
        previousObject = {};
      }

      const merged: Record<string, unknown> = {
        ...previousObject,
        result: {
          status: jobResultQuery.data.status,
          payload: jobResultQuery.data.payload
        }
      };

      return toPrettyJson(redactSecrets({ value: merged }));
    });
  }, [jobResultQuery.data]);

  const runtimePayloadView = useMemo(() => {
    if (!runtimeQuery.data) {
      return toPrettyJson({});
    }

    return toPrettyJson({
      health: {
        status: runtimeQuery.data.health.status,
        payload: runtimeQuery.data.health.payload
      },
      workspace: {
        status: runtimeQuery.data.workspace.status,
        payload: runtimeQuery.data.workspace.payload
      }
    });
  }, [runtimeQuery.data]);

  const jobPayloadView = useMemo(() => {
    if (!activeJobId) {
      return toPrettyJson({});
    }

    if (!jobQuery.data) {
      return toPrettyJson({ status: "PENDING" });
    }

    return toPrettyJson(redactSecrets({ value: jobQuery.data.payload }));
  }, [activeJobId, jobQuery.data]);

  const jobStages = Array.isArray(jobPayload?.stages) ? jobPayload.stages : [];
  const previewUrl =
    jobPayload?.preview?.enabled === true && typeof jobPayload.preview.url === "string"
      ? jobPayload.preview.url
      : undefined;

  const healthBadge = getHealthBadge(runtimeQuery.data?.health);
  const workspaceBadge = getWorkspaceBadge(runtimeQuery.data?.workspace);
  const submitBadge = getSubmitBadge({
    isSubmitting: submitMutation.isPending,
    status: jobStatus,
    isCanceling: Boolean(jobPayload?.cancellation && !jobPayload.cancellation.completedAt)
  });

  const runtimeData = runtimeQuery.data?.workspace.ok
    ? (runtimeQuery.data.workspace.payload as RuntimeStatusPayload | undefined)
    : undefined;

  const submitForm = handleSubmit((formData) => {
    submitMutation.mutate(formData);
  });

  const jobSummary = getJobSummary({
    status: jobStatus,
    payload: jobPayload,
    activeJobId
  });
  const canCancelActiveJob = canCancelJob({
    status: jobStatus,
    payload: jobPayload
  });
  const queueInfo =
    jobPayload?.queue &&
    typeof jobPayload.queue.runningCount === "number" &&
    typeof jobPayload.queue.queuedCount === "number" &&
    typeof jobPayload.queue.maxConcurrentJobs === "number" &&
    typeof jobPayload.queue.maxQueuedJobs === "number"
      ? `running ${jobPayload.queue.runningCount}/${jobPayload.queue.maxConcurrentJobs}, queued ${jobPayload.queue.queuedCount}/${jobPayload.queue.maxQueuedJobs}`
      : undefined;
  const cancelInfo = jobPayload?.cancellation?.reason;

  const canOpenInspector = jobStatus === "completed" && previewUrl && activeJobId;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#fafafa]">
      {/* Header */}
      <header className="shrink-0 border-b border-black/10 bg-white">
        <div className="flex w-full items-center justify-between px-6 pb-1 pt-4">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-lg bg-emerald-500/10">
              <img
                src="/workspace/ui/logo-keiko.svg"
                alt=""
                className="block size-5 object-contain"
              />
            </div>
            <div>
              <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Workspace Dev</p>
              <h1 className="m-0 text-base font-medium tracking-tight text-[#333]">Workspace Dev</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void runtimeQuery.refetch();
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-sm font-medium text-[#333] transition hover:bg-slate-50"
            >
              <RefreshIcon />
              Refresh
            </button>
            <button
              type="button"
              disabled={!activeJobId || !canCancelActiveJob || cancelMutation.isPending}
              onClick={() => {
                if (!activeJobId) {
                  return;
                }
                cancelMutation.mutate({ jobId: activeJobId });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-sm font-medium text-[#333] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CancelIcon />
              {cancelMutation.isPending ? "Canceling..." : "Cancel Job"}
            </button>
            <button
              type="submit"
              form="workspace-submit-form"
              className="cursor-pointer rounded-md bg-[#4eba87] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600"
            >
              Generate
            </button>
          </div>
        </div>

        {/* Runtime look bar */}
        <div className="flex items-center gap-2 px-6 pb-3 pt-2">
          <span className="font-mono text-xs text-[#666]">Runtime lock</span>
          <code className="rounded bg-[#f5f5f5] px-2 py-1 font-mono text-xs text-[#666]">
            figmaSourceMode=rest|hybrid|local_json &nbsp; llmCodegenMode=deterministic
          </code>
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[#4eba87] hover:underline"
            >
              Open runtime preview
            </a>
          ) : null}
        </div>
      </header>

      {/* Main content */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left column — cards */}
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pr-2">
          {/* Generation Flow Card */}
          <section data-testid="input-card" className="shrink-0 rounded-xl border border-black/10 bg-white p-px">
            <div className="p-6 pb-0">
              <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Generation Flow</p>
              <h2 className="m-0 mt-1 text-lg font-medium tracking-tight text-[#333]">
                Generate a local app without the clutter
              </h2>
              <p className="m-0 mt-1 text-sm text-[#666]">
                Keep the required inputs in front, move advanced destination and Git settings out of the way, and jump straight into the inspector when code is ready.
              </p>
            </div>

            <div className="p-6 pt-4">
              {/* Mode tabs */}
              <div className="flex gap-2 border-b border-black/10 pb-3">
                <span className={getModeChipClasses({ isActive: selectedFigmaSourceMode === "rest" })}>
                  REST mode
                </span>
                <span className={getModeChipClasses({ isActive: selectedFigmaSourceMode === "hybrid" })}>
                  Hybrid mode
                </span>
                <span className={getModeChipClasses({ isActive: selectedFigmaSourceMode === "local_json" })}>
                  Local JSON mode
                </span>
                <span className="rounded-md px-3 py-1 text-sm font-medium text-[#333]">
                  Deterministic codegen
                </span>
                <span className="rounded-md px-3 py-1 text-sm font-medium text-[#333]">
                  Preview enabled
                </span>
              </div>

              {/* Input fields */}
              <form
                id="workspace-submit-form"
                onSubmit={(event) => {
                  void submitForm(event);
                }}
                className="mt-4"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="figma-source-mode" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                      Source mode
                    </label>
                    <select
                      id="figma-source-mode"
                      className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none focus:border-[#4eba87]"
                      {...register("figmaSourceMode")}
                    >
                      <option value="rest">REST</option>
                      <option value="hybrid">Hybrid (REST + MCP enrich)</option>
                      <option value="local_json">Local JSON</option>
                    </select>
                    <FieldHint
                      message={
                        selectedFigmaSourceMode === "hybrid"
                          ? "Hybrid keeps REST as the source of structure and applies additive MCP enrichment when available."
                          : selectedFigmaSourceMode === "local_json"
                            ? "Reads Figma data from a local JSON file. No Figma API credentials required."
                            : undefined
                      }
                    />
                  </div>

                  {selectedFigmaSourceMode === "local_json" ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor="figma-json-path" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Figma JSON Path
                      </label>
                      <input
                        id="figma-json-path"
                        autoComplete="off"
                        placeholder="/path/to/figma-export.json"
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none focus:border-[#4eba87]"
                        {...register("figmaJsonPath")}
                      />
                      <FieldHint message={errors.figmaJsonPath?.message} />
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">
                        <label htmlFor="figma-file-key" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                          Figma File Key
                        </label>
                        <input
                          id="figma-file-key"
                          autoComplete="off"
                          placeholder="11kmnrt..."
                          className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none focus:border-[#4eba87]"
                          {...register("figmaFileKey")}
                        />
                        <FieldHint message={errors.figmaFileKey?.message} />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label htmlFor="figma-access-token" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                          Figma Access Token
                        </label>
                        <input
                          id="figma-access-token"
                          type="password"
                          autoComplete="off"
                          className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none focus:border-[#4eba87]"
                          {...register("figmaAccessToken")}
                        />
                        <FieldHint message={errors.figmaAccessToken?.message} />
                      </div>
                    </>
                  )}
                </div>

                {/* Collapsible advanced section */}
                <button
                  type="button"
                  onClick={() => { setShowAdvanced(!showAdvanced); }}
                  className="mt-3 flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-[#666] hover:text-[#333]"
                >
                  <span className={`inline-block transition ${showAdvanced ? "" : "-rotate-90"}`}>
                    <ChevronDownIcon />
                  </span>
                  Advanced destination and Git / PR options
                </button>

                {showAdvanced ? (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="enable-git-pr" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Enable Git / PR
                      </label>
                      <div className="flex h-10 items-center rounded-md border border-black/10 bg-[#f9f9f9] px-3">
                        <input id="enable-git-pr" type="checkbox" className="size-4" {...register("enableGitPr")} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="repo-url" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Repo URL
                      </label>
                      <input
                        id="repo-url"
                        autoComplete="off"
                        placeholder="https://github.com/org/repo.git"
                        disabled={!isGitPrEnabled}
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none disabled:opacity-50"
                        {...register("repoUrl")}
                      />
                      <FieldHint message={errors.repoUrl?.message} />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="repo-token" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Repo token/key
                      </label>
                      <input
                        id="repo-token"
                        type="password"
                        autoComplete="off"
                        disabled={!isGitPrEnabled}
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none disabled:opacity-50"
                        {...register("repoToken")}
                      />
                      <FieldHint message={errors.repoToken?.message} />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="project-name" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Project name
                      </label>
                      <input
                        id="project-name"
                        autoComplete="off"
                        placeholder="my-figma-project"
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none"
                        {...register("projectName")}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="target-path" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Target path
                      </label>
                      <input
                        id="target-path"
                        autoComplete="off"
                        placeholder="apps/generated"
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none"
                        {...register("targetPath")}
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="storybook-static-dir" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Storybook static dir
                      </label>
                      <input
                        id="storybook-static-dir"
                        autoComplete="off"
                        placeholder="storybook-static/customer"
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none"
                        {...register("storybookStaticDir")}
                      />
                      <FieldHint message={errors.storybookStaticDir?.message ?? "Optional. Relative paths resolve from the workspace root."} />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label htmlFor="customer-profile-path" className="text-xs font-medium uppercase tracking-wider text-[#666]">
                        Customer profile path
                      </label>
                      <input
                        id="customer-profile-path"
                        autoComplete="off"
                        placeholder="profiles/customer-profile.json"
                        className="rounded-md border border-black/10 bg-[#f9f9f9] px-3 py-2 text-sm text-[#333] outline-none"
                        {...register("customerProfilePath")}
                      />
                      <FieldHint message={errors.customerProfilePath?.message ?? "Optional. Relative paths resolve from the workspace root."} />
                    </div>
                  </div>
                ) : null}
              </form>
            </div>
          </section>

          {/* Runtime Card */}
          <section data-testid="runtime-card" className="flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-xl border border-black/10 bg-white p-px">
            <div className="p-6 pb-0">
              <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Runtime</p>
              <h2 className="m-0 mt-1 text-lg font-medium tracking-tight text-[#333]">
                Healthy, locked, and ready to generate
              </h2>
              <p className="m-0 mt-1 text-sm text-[#666]">
                Operational signals stay available, but the UI prioritizes only the details that help you decide whether to proceed.
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-6 pt-4">
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {/* Health row */}
                <div className="flex items-center justify-between border-b border-black/10 py-3">
                  <div>
                    <p className="m-0 text-sm font-medium text-[#333]">Health</p>
                    <p className="m-0 text-xs text-[#666]">HTTP {runtimeQuery.data ? runtimeQuery.data.health.status : "---"}</p>
                  </div>
                  <StatusBadge text={healthBadge.text} variant={healthBadge.variant} />
                </div>

                {/* Workspace row */}
                <div className="flex items-center justify-between border-b border-black/10 py-3">
                  <div>
                    <p className="m-0 text-sm font-medium text-[#333]">Workspace</p>
                    <p className="m-0 font-mono text-xs text-[#666]">
                      {runtimeData?.url ?? "---"}
                    </p>
                  </div>
                  <StatusBadge text={workspaceBadge.text} variant={workspaceBadge.variant} />
                </div>

                {/* Submit row */}
                <div className="border-b border-black/10 py-3">
                  <div className="flex items-center justify-between">
                    <p className="m-0 text-sm font-medium text-[#333]">Submit:</p>
                    <StatusBadge text={submitBadge.text} variant={submitBadge.variant} />
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="m-0 text-xs text-[#666]">
                      <span className="text-[#666]">Mode: </span>
                      <span className="text-[#333]">
                        figmaSourceMode={selectedFigmaSourceMode} &nbsp; llmCodegenMode=deterministic
                      </span>
                    </p>
                    <p className="m-0 text-xs text-[#666]">
                      <span className="text-[#666]">Preview: </span>
                      <span className="text-[#333]">{runtimeData?.previewEnabled ? "Enabled" : "Disabled"}</span>
                    </p>
                    <p className="m-0 text-xs text-[#666]">
                      <span className="text-[#666]">Uptime: </span>
                      <span className="text-[#333]">{runtimeData ? formatUptime(runtimeData.uptimeMs) : "---"}</span>
                    </p>
                  </div>
                </div>

                {/* Runtime diagnostics toggle */}
                <button
                  type="button"
                  onClick={() => { setShowRuntimeDiag(!showRuntimeDiag); }}
                  className="mt-3 flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-[#666] hover:text-[#333]"
                >
                  <span className={`inline-block transition ${showRuntimeDiag ? "" : "-rotate-90"}`}>
                    <ChevronDownIcon />
                  </span>
                  Runtime diagnostics
                </button>
                {showRuntimeDiag ? (
                  <pre data-testid="runtime-payload" className="mt-2 overflow-auto rounded-lg border border-black/10 bg-[#f9f9f9] p-3 text-xs text-[#666]">
                    {runtimePayloadView}
                  </pre>
                ) : null}
              </div>
            </div>
          </section>

          {/* Job Status Card */}
          <section data-testid="job-status-card" className="shrink-0 rounded-xl border border-black/10 bg-white p-px">
            <div className="p-6 pb-0">
              <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Job Status</p>
              <h2 className="m-0 mt-1 text-lg font-medium tracking-tight text-[#333]">
                Pipeline progress without the noise
              </h2>
              <p className="m-0 mt-1 text-sm text-[#666]">
                Keep the current job, stage activity, diff summary, and failure context nearby, while deeper JSON stays tucked behind diagnostics.
              </p>
            </div>

            <div className="p-6 pt-4">
              {/* Job summary */}
              <div className="border-b border-black/10 pb-3 pt-2">
                <p className="m-0 text-sm text-[#666]">{jobSummary}</p>
              </div>

              {/* Awaiting / status */}
              <div className="flex items-center justify-between border-b border-black/10 py-3">
                <p className="m-0 text-sm font-medium text-[#333]">
                  {activeJobId ? `Job ${activeJobId.slice(0, 8)}` : "Awaiting submission"}
                </p>
                <StatusBadge
                  text={submitBadge.text}
                  variant={submitBadge.variant}
                />
              </div>

              {queueInfo ? <p className="m-0 mt-2 text-xs text-[#666]">Queue: {queueInfo}</p> : null}
              {cancelInfo ? <p className="m-0 mt-1 text-xs text-[#666]">Cancellation: {cancelInfo}</p> : null}

              {jobStages.length > 0 ? (
                <ul className="mt-2 grid gap-1">
                  {jobStages.map((stage) => {
                    const status = (stage.status || "queued").toUpperCase();
                    return (
                      <li
                        key={`${stage.name}-${stage.status}`}
                        className="flex items-center justify-between rounded-md border border-black/10 bg-white px-2 py-1"
                      >
                        <span className="text-xs font-medium text-[#333]">{stage.name || "unknown"}</span>
                        <StatusBadge text={status} variant={toStageBadgeVariant(stage.status || "queued")} />
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {jobPayload?.generationDiff?.summary ? (
                <div data-testid="generation-diff-summary" className="mt-3 rounded-lg border border-black/10 bg-[#f9f9f9] p-3">
                  <p className="m-0 text-xs font-bold uppercase tracking-wide text-[#666]">Generation Diff</p>
                  <p className="m-0 mt-1 text-sm text-[#333]">{jobPayload.generationDiff.summary}</p>
                  {jobPayload.generationDiff.previousJobId ? (
                    <p className="m-0 mt-1 text-xs text-[#666]">
                      Previous job: {jobPayload.generationDiff.previousJobId}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {(jobPayload.generationDiff.added?.length ?? 0) > 0 ? (
                      <span className="rounded-full border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                        +{jobPayload.generationDiff.added?.length} added
                      </span>
                    ) : null}
                    {(jobPayload.generationDiff.modified?.length ?? 0) > 0 ? (
                      <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-amber-800">
                        ~{jobPayload.generationDiff.modified?.length} modified
                      </span>
                    ) : null}
                    {(jobPayload.generationDiff.removed?.length ?? 0) > 0 ? (
                      <span className="rounded-full border border-rose-400 bg-rose-50 px-2 py-0.5 text-rose-800">
                        -{jobPayload.generationDiff.removed?.length} removed
                      </span>
                    ) : null}
                    {(jobPayload.generationDiff.unchanged?.length ?? 0) > 0 ? (
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
                        {jobPayload.generationDiff.unchanged?.length} unchanged
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Job diagnostics toggle */}
              <button
                type="button"
                onClick={() => { setShowJobDiag(!showJobDiag); }}
                className="mt-3 flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-[#666] hover:text-[#333]"
              >
                <span className={`inline-block transition ${showJobDiag ? "" : "-rotate-90"}`}>
                  <ChevronDownIcon />
                </span>
                Job diagnostics
              </button>
              {showJobDiag ? (
                <pre data-testid="job-payload" className="mt-2 overflow-auto rounded-lg border border-black/10 bg-[#f9f9f9] p-3 text-xs text-[#666]">
                  {jobPayloadView}
                </pre>
              ) : null}
            </div>
          </section>
        </div>

        {/* Right column — Preview panel */}
        <div className="flex w-[32%] min-w-[320px] shrink-0 flex-col p-6 pl-2">
          <section className="flex flex-1 flex-col rounded-xl border border-black/10 bg-white p-px">
            <div className="p-6 pb-0">
              <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Preview</p>
              <h2 className="m-0 mt-1 text-lg font-medium tracking-tight text-[#333]">
                The Inspector takes over after success
              </h2>
              <p className="m-0 mt-1 text-sm text-[#666]">
                Once generation completes, this panel becomes a dedicated developer workspace with an explorer, preview canvas, syntax-highlighted source, split view, and diff navigation.
              </p>
            </div>

            <div className="flex flex-1 flex-col gap-4 p-6 pt-4">
              {/* Preview area */}
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-black/10 bg-[#f5f5f5]/30">
                {canOpenInspector ? (
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div className="grid size-12 place-items-center rounded-lg bg-emerald-50">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6 text-emerald-600">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <p className="m-0 text-lg font-medium text-[#333]">Generation complete</p>
                      <p className="m-0 mt-1 text-sm text-[#666]">
                        Open the Inspector to explore, preview, and review the generated code.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigate(`/workspace/ui/inspector?jobId=${encodeURIComponent(activeJobId)}&previewUrl=${encodeURIComponent(previewUrl)}${jobPayload?.generationDiff?.previousJobId ? `&previousJobId=${encodeURIComponent(jobPayload.generationDiff.previousJobId)}` : ""}${jobPayload?.lineage?.sourceJobId ? "&isRegeneration=true" : ""}`);
                      }}
                      className="cursor-pointer rounded-md bg-[#4eba87] px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
                    >
                      Open Inspector
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="grid size-12 place-items-center rounded-lg bg-[#f5f5f5]">
                      <EmptyPreviewIcon />
                    </div>
                    <p className="m-0 text-lg font-medium text-[#333]">No generated output yet.</p>
                    <p className="m-0 max-w-xs text-sm text-[#666]">
                      The nodeIsign keeps operational context available while hiding payload-heavy detail until you intentionally open it.
                    </p>
                  </div>
                )}
              </div>

              {/* Submitted payload section */}
              <div className="border-t border-black/10 pt-3">
                <p className="m-0 text-sm font-medium text-[#333]">Submitted payload and result metadata</p>
                <pre data-testid="submit-payload" className="mt-2 max-h-32 overflow-auto rounded-lg border border-black/10 bg-[#f9f9f9] p-3 text-xs text-[#666]">
                  {submitPayloadView}
                </pre>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
