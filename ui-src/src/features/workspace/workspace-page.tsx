import { useEffect, useMemo, useState, type JSX } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { fetchJson, type JsonResponse } from "../../lib/http";
import { getInitialFigmaKeyFromPath } from "../../lib/path-utils";
import { redactSecrets } from "../../lib/redact-secrets";
import {
  workspaceSubmitSchema,
  toWorkspaceSubmitPayload,
  type WorkspaceSubmitFormData,
  type WorkspaceSubmitPayload
} from "./submit-schema";
import { InspectorPanel } from "./inspector/InspectorPanel";

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
  figmaSourceMode: "rest";
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

interface JobPayload {
  jobId: string;
  status: string;
  stages?: JobStagePayload[];
  preview?: JobPreviewPayload;
  queue?: JobQueuePayload;
  cancellation?: JobCancellationPayload;
  generationDiff?: JobGenerationDiffPayload;
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

function getPreviewMessage({
  status,
  payload,
  hasActiveJob,
  isSubmitting
}: {
  status: JobLifecycleStatus | undefined;
  payload: JobPayload | undefined;
  hasActiveJob: boolean;
  isSubmitting: boolean;
}): string {
  if (isSubmitting) {
    return "Starting autonomous job...";
  }

  if (!hasActiveJob) {
    return "No generated output yet.";
  }

  if (status === "queued" || status === "running") {
    if (payload?.cancellation && !payload.cancellation.completedAt) {
      return "Cancellation requested. Waiting for terminal state...";
    }
    return "Generation läuft. Bitte warten...";
  }

  if (status === "completed") {
    return "Code wurde lokal generiert.";
  }

  if (status === "failed") {
    return payload?.error?.message || "Generation failed.";
  }
  if (status === "canceled") {
    return payload?.cancellation?.reason || "Generation canceled.";
  }

  return "Polling job status...";
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
    return "border-emerald-500 bg-emerald-100 text-emerald-900";
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
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-wide ${getBadgeClasses(variant)}`}
    >
      {text}
    </span>
  );
}

function FieldHint({ message }: { message: string | undefined }): JSX.Element {
  return <p className="min-h-4 text-xs text-rose-700">{message || "\u00a0"}</p>;
}

const cardBaseClasses = "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const topRowCardClasses = `${cardBaseClasses}`;
const bottomRowCardClasses = `${cardBaseClasses}`;
const payloadPreClasses =
  "mt-3 overflow-x-auto overflow-y-auto rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-800";
const uiVersionLabel = `v${__WORKSPACE_DEV_VERSION__}`;

export function WorkspacePage(): JSX.Element {
  const routeParams = useParams<{ figmaFileKey?: string }>();
  const routeFigmaKey = getRouteFigmaKey(routeParams.figmaFileKey);
  const pathnameFigmaKey = getInitialFigmaKeyFromPath({ pathname: window.location.pathname });
  const initialFigmaKey = routeFigmaKey || pathnameFigmaKey || "";

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [submitPayloadView, setSubmitPayloadView] = useState<string>(toPrettyJson({}));

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
      enableGitPr: false,
      repoUrl: "",
      repoToken: "",
      projectName: "",
      targetPath: ""
    }
  });

  const isGitPrEnabled = watch("enableGitPr");

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

  const onSubmit = handleSubmit((formData) => {
    submitMutation.mutate(formData);
  });

  const previewMessage = getPreviewMessage({
    status: jobStatus,
    payload: jobPayload,
    hasActiveJob: Boolean(activeJobId),
    isSubmitting: submitMutation.isPending
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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-[0.9rem] lg:px-6 xl:px-8">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-[2.2rem] w-[2.2rem] place-items-center rounded-lg border border-slate-300 bg-white p-[0.2rem]"
            >
              <img
                src="/workspace/ui/logo-keiko.svg"
                alt=""
                className="block h-full w-full object-contain"
              />
            </div>
            <div>
              <h1 className="m-0 text-[1.1rem] font-bold text-slate-900">Workspace Dev</h1>
              <p className="m-0 text-[0.8rem] text-slate-600">Autonomous local REST + deterministic code generation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void runtimeQuery.refetch();
              }}
              className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
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
              className="cursor-pointer rounded-full border border-black bg-white px-3 py-1.5 text-sm font-semibold text-black transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelMutation.isPending ? "Canceling..." : "Cancel Job"}
            </button>
            <button
              type="submit"
              form="workspace-submit-form"
              className="cursor-pointer rounded-full border border-emerald-500 bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
            >
              Generate
            </button>
          </div>
        </div>
      </header>

      <p className="m-0 border-b border-slate-200 bg-emerald-50 px-4 py-2 text-sm text-slate-600 lg:px-6 xl:px-8">
        Runtime mode is hard-locked to <code>figmaSourceMode=rest</code> + <code>llmCodegenMode=deterministic</code>.
      </p>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto px-4 py-4 lg:px-6 xl:grid-cols-12 xl:[grid-template-rows:0.55fr_1.45fr] xl:px-8">
        <section data-testid="input-card" className={`${topRowCardClasses} xl:col-span-6`}>
          <div className="mb-3">
            <h2 className="m-0 text-xl font-bold text-slate-900">Input</h2>
            <p className="m-0 text-sm text-slate-600">Reduced workspace flow for autonomous generation</p>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto pr-1">
            <form
              id="workspace-submit-form"
              onSubmit={onSubmit}
              className="grid min-w-[46rem] gap-3 sm:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            >
            <div className="flex flex-col gap-1">
              <label htmlFor="figma-source-mode" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Figma source mode
              </label>
              <input
                id="figma-source-mode"
                value="rest"
                disabled
                className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-2 text-sm text-slate-900"
              />
              <p className="min-h-4 text-xs text-slate-500">Locked by runtime</p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="llm-codegen-mode" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                LLM codegen mode
              </label>
              <input
                id="llm-codegen-mode"
                value="deterministic"
                disabled
                className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-2 text-sm text-slate-900"
              />
              <p className="min-h-4 text-xs text-slate-500">Locked by runtime</p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="figma-file-key" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Figma file key
              </label>
              <input
                id="figma-file-key"
                autoComplete="off"
                placeholder="1Bvard..."
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                {...register("figmaFileKey")}
              />
              <FieldHint message={errors.figmaFileKey?.message} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="figma-access-token" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Figma access token
              </label>
              <input
                id="figma-access-token"
                type="password"
                autoComplete="off"
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                {...register("figmaAccessToken")}
              />
              <FieldHint message={errors.figmaAccessToken?.message} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="enable-git-pr" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Enable Git / PR (optional)
              </label>
              <div className="flex h-[38px] items-center rounded-lg border border-slate-300 bg-white px-2">
                <input id="enable-git-pr" type="checkbox" className="size-4" {...register("enableGitPr")} />
              </div>
              <p className="min-h-4 text-xs text-slate-500">
                When enabled, repo URL + token are required and git.pr stage is executed.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="repo-url" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Repo URL
              </label>
              <input
                id="repo-url"
                autoComplete="off"
                placeholder="https://github.com/org/repo.git"
                disabled={!isGitPrEnabled}
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                {...register("repoUrl")}
              />
              <FieldHint message={errors.repoUrl?.message} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="repo-token" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Repo token/key
              </label>
              <input
                id="repo-token"
                type="password"
                autoComplete="off"
                disabled={!isGitPrEnabled}
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                {...register("repoToken")}
              />
              <FieldHint message={errors.repoToken?.message} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="project-name" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Project name (optional)
              </label>
              <input
                id="project-name"
                autoComplete="off"
                placeholder="my-figma-project"
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                {...register("projectName")}
              />
              <p className="min-h-4 text-xs text-slate-500">Used for metadata only</p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="target-path" className="text-xs font-bold uppercase tracking-wide text-slate-800">
                Target path (optional)
              </label>
              <input
                id="target-path"
                autoComplete="off"
                placeholder="apps/generated"
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                {...register("targetPath")}
              />
              <p className="min-h-4 text-xs text-slate-500">Used for metadata only</p>
            </div>

            <div className="flex justify-end sm:col-span-2 xl:col-span-3 2xl:col-span-4">
              <button
                type="submit"
                className="cursor-pointer rounded-full border border-emerald-500 bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                Generate
              </button>
            </div>
            </form>
          </div>
        </section>

        <section data-testid="runtime-card" className={`${topRowCardClasses} xl:col-span-6`}>
          <div className="mb-3">
            <h2 className="m-0 text-xl font-bold text-slate-900">Runtime</h2>
            <p className="m-0 text-sm text-slate-600">Server readiness and mode lock state</p>
          </div>
          <div className="space-y-1 text-sm text-slate-800">
            <p className="m-0">
              Health: <StatusBadge text={healthBadge.text} variant={healthBadge.variant} />
            </p>
            <p className="m-0">
              Workspace: <StatusBadge text={workspaceBadge.text} variant={workspaceBadge.variant} />
            </p>
            <p className="m-0">
              Submit: <StatusBadge text={submitBadge.text} variant={submitBadge.variant} />
            </p>
          </div>
          <pre data-testid="runtime-payload" className={`${payloadPreClasses} min-h-0 flex-1`}>
            {runtimePayloadView}
          </pre>
        </section>

        <section data-testid="job-status-card" className={`${bottomRowCardClasses} xl:col-span-6`}>
          <div className="mb-3">
            <h2 className="m-0 text-xl font-bold text-slate-900">Job Status</h2>
            <p className="m-0 text-sm text-slate-600">Current pipeline stage and logs</p>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">
            <p className="m-0">{jobSummary}</p>
            {queueInfo ? <p className="m-0 mt-1 text-xs text-slate-500">Queue: {queueInfo}</p> : null}
            {cancelInfo ? <p className="m-0 mt-1 text-xs text-slate-500">Cancellation: {cancelInfo}</p> : null}
            <ul className="mt-2 grid gap-1">
              {jobStages.map((stage) => {
                const status = (stage.status || "queued").toUpperCase();
                return (
                  <li
                    key={`${stage.name}-${stage.status}`}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1"
                  >
                    <span className="text-xs font-semibold text-slate-800">{stage.name || "unknown"}</span>
                    <StatusBadge text={status} variant={toStageBadgeVariant(stage.status || "queued")} />
                  </li>
                );
              })}
            </ul>
            {jobPayload?.generationDiff?.summary ? (
              <div data-testid="generation-diff-summary" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="m-0 text-xs font-bold uppercase tracking-wide text-slate-700">Generation Diff</p>
                <p className="m-0 mt-1 text-sm text-slate-800">{jobPayload.generationDiff.summary}</p>
                {jobPayload.generationDiff.previousJobId ? (
                  <p className="m-0 mt-1 text-xs text-slate-500">
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
          </div>
          <pre data-testid="job-payload" className={`${payloadPreClasses} h-28 shrink-0`}>
            {jobPayloadView}
          </pre>
        </section>

        {jobStatus === "completed" && previewUrl && activeJobId ? (
          <section data-testid="result-card" className={`${bottomRowCardClasses} xl:col-span-6 xl:min-h-[420px]`}>
            <InspectorPanel jobId={activeJobId} previewUrl={previewUrl} previousJobId={jobPayload?.generationDiff?.previousJobId} />
          </section>
        ) : (
          <section data-testid="result-card" className={`${bottomRowCardClasses} xl:col-span-6 xl:min-h-[420px]`}>
            <div className="mb-3">
              <h2 className="m-0 text-xl font-bold text-slate-900">Result / Preview</h2>
              <p className="m-0 text-sm text-slate-600">Generated output for the latest job</p>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">
              <p className="m-0">{previewMessage}</p>
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block font-semibold text-emerald-700 hover:underline"
                >
                  Open Preview
                </a>
              ) : null}
            </div>
            <pre data-testid="submit-payload" className={`${payloadPreClasses} h-28 shrink-0`}>
              {submitPayloadView}
            </pre>
          </section>
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-center border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-600 lg:px-6 xl:px-8">
        <span>{`workspace-dev ui ${uiVersionLabel} - by oscharko`}</span>
      </footer>
    </div>
  );
}
