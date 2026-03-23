import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
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
    return "Generation is running. The preview and Inspector will appear here when the job completes.";
  }

  if (status === "completed") {
    return "Code was generated locally.";
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

function SectionHeading({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-700">{eyebrow}</p>
      <div className="space-y-1">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="m-0 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  badge,
  detail
}: {
  label: string;
  badge: { text: string; variant: BadgeVariant };
  detail?: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold text-slate-900">{label}</p>
        <StatusBadge text={badge.text} variant={badge.variant} />
      </div>
      {detail ? <div className="mt-2 text-xs leading-5 text-slate-600">{detail}</div> : null}
    </div>
  );
}

const cardBaseClasses =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200/90 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur";
const panelInsetClasses = "px-5 py-5";
const inputClasses =
  "w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-100";
const labelClasses = "text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500";
const secondaryButtonClasses =
  "cursor-pointer rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClasses =
  "cursor-pointer rounded-full border border-emerald-500 bg-emerald-500 px-4 py-2 text-sm font-semibold text-black shadow-sm hover:border-emerald-400 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50";
const disclosureClasses =
  "group rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4";
const disclosureSummaryClasses =
  "cursor-pointer list-none text-sm font-semibold text-slate-900 marker:hidden [&::-webkit-details-marker]:hidden";
const payloadPreClasses =
  "mt-3 max-h-72 overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-3 text-xs leading-6 text-emerald-50";
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
  const runtimeStatusPayload = runtimeQuery.data?.workspace.payload;
  const runtimeWorkspaceUrl =
    runtimeStatusPayload && typeof runtimeStatusPayload.url === "string"
      ? runtimeStatusPayload.url
      : undefined;
  const isInspectorReady = Boolean(jobStatus === "completed" && previewUrl && activeJobId);
  const jobStageItems = jobStages.length > 0 ? jobStages : [{ name: "Awaiting submission", status: "queued" }];
  const shouldOpenRuntimeDiagnostics = Boolean(
    runtimeQuery.data && (!runtimeQuery.data.health.ok || !runtimeQuery.data.workspace.ok)
  );
  const shouldOpenJobDiagnostics = jobStatus === "failed" || jobStatus === "canceled";
  const previewTarget = previewUrl ?? runtimeWorkspaceUrl;
  const sidebarStack = (
    <>
      <section data-testid="input-card" className={cardBaseClasses}>
        <div className={`${panelInsetClasses} space-y-5`}>
          <SectionHeading
            eyebrow="Generation flow"
            title="Generate a local app without the clutter"
            description="Keep the required inputs in front, move advanced destination and Git settings out of the way, and jump straight into the Inspector when code is ready."
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
              REST source
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Deterministic codegen
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
              Preview {runtimeStatusPayload?.previewEnabled ? "enabled" : "available when runtime is ready"}
            </span>
          </div>

          <form
            id="workspace-submit-form"
            onSubmit={onSubmit}
            className="grid gap-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="figma-file-key" className={labelClasses}>
                  Figma file key
                </label>
                <input
                  id="figma-file-key"
                  autoComplete="off"
                  placeholder="1Bvard..."
                  className={inputClasses}
                  {...register("figmaFileKey")}
                />
                <FieldHint message={errors.figmaFileKey?.message} />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="figma-access-token" className={labelClasses}>
                  Figma access token
                </label>
                <input
                  id="figma-access-token"
                  type="password"
                  autoComplete="off"
                  className={inputClasses}
                  {...register("figmaAccessToken")}
                />
                <FieldHint message={errors.figmaAccessToken?.message} />
              </div>
            </div>

            <details className={disclosureClasses} open={isGitPrEnabled}>
              <summary className={disclosureSummaryClasses}>Advanced destination and Git / PR options</summary>
              <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
                Use these only when you want metadata, a custom target path, or a follow-up pull request.
              </p>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="project-name" className={labelClasses}>
                      Project name
                    </label>
                    <input
                      id="project-name"
                      autoComplete="off"
                      placeholder="my-figma-project"
                      className={inputClasses}
                      {...register("projectName")}
                    />
                    <p className="m-0 text-xs text-slate-500">Optional metadata label for the generated output.</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="target-path" className={labelClasses}>
                      Target path
                    </label>
                    <input
                      id="target-path"
                      autoComplete="off"
                      placeholder="apps/generated"
                      className={inputClasses}
                      {...register("targetPath")}
                    />
                    <p className="m-0 text-xs text-slate-500">Optional destination hint used in metadata and follow-up tooling.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="m-0 text-sm font-semibold text-slate-900">Enable Git / PR automation</p>
                      <p className="m-0 text-xs leading-5 text-slate-500">
                        Turn this on only when you want the runtime to use the git.pr stage.
                      </p>
                    </div>
                    <label htmlFor="enable-git-pr" className="inline-flex items-center gap-3 text-sm font-semibold text-slate-800">
                      <input id="enable-git-pr" type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register("enableGitPr")} />
                      Enable Git / PR
                    </label>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="repo-url" className={labelClasses}>
                        Repo URL
                      </label>
                      <input
                        id="repo-url"
                        autoComplete="off"
                        placeholder="https://github.com/org/repo.git"
                        disabled={!isGitPrEnabled}
                        className={inputClasses}
                        {...register("repoUrl")}
                      />
                      <FieldHint message={errors.repoUrl?.message} />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label htmlFor="repo-token" className={labelClasses}>
                        Repo token/key
                      </label>
                      <input
                        id="repo-token"
                        type="password"
                        autoComplete="off"
                        disabled={!isGitPrEnabled}
                        className={inputClasses}
                        {...register("repoToken")}
                      />
                      <FieldHint message={errors.repoToken?.message} />
                    </div>
                  </div>
                </div>
              </div>
            </details>
          </form>
        </div>
      </section>

      <section data-testid="runtime-card" className={cardBaseClasses}>
        <div className={`${panelInsetClasses} space-y-5`}>
          <SectionHeading
            eyebrow="Runtime"
            title="Healthy, locked, and ready to generate"
            description="Operational signals stay available, but the UI prioritizes only the details that help you decide whether to proceed."
          />

          <div className="grid gap-3">
            <StatusRow
              label="Health"
              badge={healthBadge}
              detail={
                <span>
                  {runtimeQuery.data ? `HTTP ${String(runtimeQuery.data.health.status)}` : "Polling /healthz"}
                </span>
              }
            />
            <StatusRow
              label="Workspace"
              badge={workspaceBadge}
              detail={
                <span>
                  {runtimeStatusPayload
                    ? `${runtimeStatusPayload.host}:${String(runtimeStatusPayload.port)}${runtimeStatusPayload.url ? ` • ${runtimeStatusPayload.url}` : ""}`
                    : "Waiting for runtime metadata"}
                </span>
              }
            />
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3">
              <p className="m-0 text-sm font-semibold text-slate-900">
                Submit: <StatusBadge text={submitBadge.text} variant={submitBadge.variant} />
              </p>
              <div className="mt-2 grid gap-1 text-xs leading-5 text-slate-600">
                <p className="m-0">
                  Mode lock: <code>figmaSourceMode=rest</code> + <code>llmCodegenMode=deterministic</code>
                </p>
                <p className="m-0">
                  Preview: {runtimeStatusPayload?.previewEnabled ? "Enabled" : "Pending runtime confirmation"}
                </p>
                {typeof runtimeStatusPayload?.uptimeMs === "number" ? (
                  <p className="m-0">Uptime: {Math.round(runtimeStatusPayload.uptimeMs / 1000)}s</p>
                ) : null}
              </div>
            </div>
          </div>

          <details className={disclosureClasses} open={shouldOpenRuntimeDiagnostics}>
            <summary className={disclosureSummaryClasses}>Runtime diagnostics</summary>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
              Expand for raw runtime payloads and endpoint responses when you need to troubleshoot the workspace itself.
            </p>
            <pre data-testid="runtime-payload" className={payloadPreClasses}>
              {runtimePayloadView}
            </pre>
          </details>
        </div>
      </section>

      <section data-testid="job-status-card" className={cardBaseClasses}>
        <div className={`${panelInsetClasses} space-y-5`}>
          <SectionHeading
            eyebrow="Job status"
            title="Pipeline progress without the noise"
            description="Keep the current job, stage activity, diff summary, and failure context nearby while deeper JSON stays tucked behind diagnostics."
          />

          <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
            <p className="m-0 text-sm font-semibold text-slate-900">{jobSummary}</p>
            {activeJobId ? (
              <p className="m-0 mt-2 text-xs leading-5 text-slate-600">
                Current job: <code>{activeJobId}</code>
              </p>
            ) : null}
            {queueInfo ? <p className="m-0 mt-1 text-xs leading-5 text-slate-600">Queue: {queueInfo}</p> : null}
            {cancelInfo ? <p className="m-0 mt-1 text-xs leading-5 text-slate-600">Cancellation: {cancelInfo}</p> : null}
          </div>

          <ul className="m-0 grid gap-2 p-0">
            {jobStageItems.map((stage) => (
              <li
                key={`${stage.name}-${stage.status}`}
                className="flex list-none items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3"
              >
                <span className="text-sm font-semibold text-slate-900">{stage.name || "unknown"}</span>
                <StatusBadge text={(stage.status || "queued").toUpperCase()} variant={toStageBadgeVariant(stage.status || "queued")} />
              </li>
            ))}
          </ul>

          {jobPayload?.generationDiff?.summary ? (
            <div data-testid="generation-diff-summary" className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-700">Generation diff</p>
              <p className="m-0 mt-2 text-sm font-semibold text-emerald-950">{jobPayload.generationDiff.summary}</p>
              {jobPayload.generationDiff.previousJobId ? (
                <p className="m-0 mt-2 text-xs text-emerald-900">
                  Previous job: {jobPayload.generationDiff.previousJobId}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {(jobPayload.generationDiff.added?.length ?? 0) > 0 ? (
                  <span className="rounded-full border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-800">
                    +{jobPayload.generationDiff.added?.length} added
                  </span>
                ) : null}
                {(jobPayload.generationDiff.modified?.length ?? 0) > 0 ? (
                  <span className="rounded-full border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-800">
                    ~{jobPayload.generationDiff.modified?.length} modified
                  </span>
                ) : null}
                {(jobPayload.generationDiff.removed?.length ?? 0) > 0 ? (
                  <span className="rounded-full border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-800">
                    -{jobPayload.generationDiff.removed?.length} removed
                  </span>
                ) : null}
                {(jobPayload.generationDiff.unchanged?.length ?? 0) > 0 ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600">
                    {jobPayload.generationDiff.unchanged?.length} unchanged
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <details className={disclosureClasses} open={shouldOpenJobDiagnostics}>
            <summary className={disclosureSummaryClasses}>Job diagnostics</summary>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
              Expand for the raw job payload, terminal error context, and detailed runtime state during troubleshooting.
            </p>
            <pre data-testid="job-payload" className={payloadPreClasses}>
              {jobPayloadView}
            </pre>
          </details>
        </div>
      </section>
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-b border-slate-200/90 bg-white/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-6 xl:px-8">
          <div className="flex items-center gap-4">
            <div
              aria-hidden="true"
              className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
            >
              <img
                src="/workspace/ui/logo-keiko.svg"
                alt=""
                className="block h-full w-full object-contain"
              />
            </div>
            <div className="space-y-1">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-700">Workspace Dev</p>
              <div>
                <h1 className="m-0 text-[1.35rem] font-semibold tracking-tight text-slate-950">Workspace Dev</h1>
                <p className="m-0 text-sm leading-6 text-slate-600">
                  Deterministic Figma-to-code workspace for local generation, clearer review, and an IDE-style Inspector as soon as source code is ready.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void runtimeQuery.refetch();
              }}
              className={secondaryButtonClasses}
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
              className={secondaryButtonClasses}
            >
              {cancelMutation.isPending ? "Canceling..." : "Cancel Job"}
            </button>
            <button
              type="submit"
              form="workspace-submit-form"
              className={primaryButtonClasses}
            >
              Generate
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-emerald-50/80 px-4 py-3 text-sm text-slate-700 lg:px-6 xl:px-8">
          <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-900">
            Runtime lock
          </span>
          <span>
            <code>figmaSourceMode=rest</code> + <code>llmCodegenMode=deterministic</code>
          </span>
          {previewTarget ? (
            <a
              href={previewTarget}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-emerald-200 hover:text-emerald-800"
            >
              Open runtime preview
            </a>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 py-4 lg:px-6 xl:px-8">
        {isInspectorReady && previewUrl && activeJobId ? (
          <div className="grid min-h-full gap-4 xl:grid-cols-[22rem_minmax(0,1fr)] xl:overflow-hidden">
            <aside className="grid min-h-0 gap-4 xl:overflow-auto xl:pr-1">
              {sidebarStack}
            </aside>

            <section data-testid="result-card" className="min-h-[42rem] min-w-0 xl:min-h-0">
              <InspectorPanel
                jobId={activeJobId}
                previewUrl={previewUrl}
                previousJobId={jobPayload?.generationDiff?.previousJobId}
                isRegenerationJob={Boolean(jobPayload?.lineage?.sourceJobId)}
                onRegenerationAccepted={(nextJobId) => {
                  setActiveJobId(nextJobId);
                }}
              />
            </section>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
            <div className="grid gap-4">{sidebarStack}</div>

            <section data-testid="result-card" className={`${cardBaseClasses} xl:sticky xl:top-0`}>
              <div className={`${panelInsetClasses} flex h-full flex-col justify-between gap-5`}>
                <SectionHeading
                  eyebrow="Preview"
                  title="The Inspector takes over after success"
                  description="Once generation completes, this panel becomes a dedicated developer workspace with an explorer, preview canvas, syntax-highlighted source, split view, and diff navigation."
                />

                <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-5">
                  <p className="m-0 text-sm font-semibold text-slate-900">{previewMessage}</p>
                  <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
                    The redesign keeps operational context available while hiding payload-heavy detail until you intentionally open it.
                  </p>
                  {previewUrl ? (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      Open Preview
                    </a>
                  ) : null}
                </div>

                <details className={disclosureClasses}>
                  <summary className={disclosureSummaryClasses}>Submitted payload and result metadata</summary>
                  <p className="m-0 mt-2 text-sm leading-6 text-slate-600">
                    Expand for the redacted request payload, generation result metadata, and other low-level details that are useful during debugging.
                  </p>
                  <pre data-testid="submit-payload" className={payloadPreClasses}>
                    {submitPayloadView}
                  </pre>
                </details>
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-center border-t border-slate-200/90 bg-white/80 px-4 py-3 text-center text-xs text-slate-600 backdrop-blur lg:px-6 xl:px-8">
        <span>{`workspace-dev ui ${uiVersionLabel} - by oscharko`}</span>
      </footer>
    </div>
  );
}
