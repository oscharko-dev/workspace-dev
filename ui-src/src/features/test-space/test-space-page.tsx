import { useEffect, useMemo, useState, type JSX } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { fetchJson } from "../../lib/http";

const MODEL_NAME = "gpt-oss-120b";

const endpoints = {
  runs: "/workspace/test-space/runs",
  run: ({ runId }: { runId: string }) =>
    `/workspace/test-space/runs/${encodeURIComponent(runId)}`,
  testCases: ({ runId }: { runId: string }) =>
    `/workspace/test-space/runs/${encodeURIComponent(runId)}/test-cases`,
  markdown: ({ runId }: { runId: string }) =>
    `/workspace/test-space/runs/${encodeURIComponent(runId)}/test-cases.md`,
};

const sourceModes = ["rest", "hybrid", "local_json"] as const;
type SourceMode = (typeof sourceModes)[number];
type BackendSourceMode = SourceMode | "figma_paste" | "figma_plugin";

function isJsonObjectOrArray(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) || (parsed !== null && typeof parsed === "object");
  } catch {
    return false;
  }
}

const testSpaceFormSchema = z
  .object({
    figmaSourceMode: z.enum(sourceModes),
    figmaFileKey: z.string().trim(),
    figmaJsonPayload: z.string().trim(),
    figmaJsonPath: z.string().trim(),
    businessContext: z.string().trim().min(20, "Business context is required."),
    businessObjective: z
      .string()
      .trim()
      .min(10, "Business objective is required."),
    businessConstraints: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    const hasPayload = value.figmaJsonPayload.length > 0;
    const hasPath = value.figmaJsonPath.length > 0;

    if (value.figmaSourceMode === "local_json") {
      if (!hasPath && !hasPayload) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPayload"],
          message: "Provide a Figma JSON payload or local JSON path.",
        });
      }

      if (hasPayload && !isJsonObjectOrArray(value.figmaJsonPayload)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPayload"],
          message: "Figma JSON payload must be a JSON object or array.",
        });
      }

      return;
    }

    if (!hasPayload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["figmaJsonPayload"],
        message: "Figma JSON payload is required in REST and hybrid modes.",
      });
      return;
    }

    if (!isJsonObjectOrArray(value.figmaJsonPayload)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["figmaJsonPayload"],
        message: "Figma JSON payload must be a JSON object or array.",
      });
    }
  });

type TestSpaceFormData = z.infer<typeof testSpaceFormSchema>;

interface WorkspaceTestSpaceRunRequest {
  figmaSourceMode: BackendSourceMode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaJsonPath?: string;
  figmaJsonPayload?: string;
  testSuiteName?: string;
  businessContext: {
    summary: string;
    productName?: string;
    audience?: string;
    goals?: string[];
    constraints?: string[];
    notes?: string;
  };
}

interface TestSpaceRunPayload {
  runId?: string;
  status?: string;
  model?: string;
  modelDeployment?: string;
  figmaSourceMode?: string;
  businessContext?: string;
  businessObjective?: string;
  businessConstraints?: string;
  request?: {
    figmaSourceMode?: string;
    businessContext?: {
      summary?: string;
      productName?: string;
      audience?: string;
      goals?: string[];
      constraints?: string[];
      notes?: string;
    };
  };
  error?: string | { message?: string; code?: string };
  message?: string;
  markdownReady?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface TestCaseRecord {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | string;
  type: string;
  preconditions: string[];
  steps: TestCaseStepRecord[];
  expectedResult: string;
  coverageTags: string[];
  traceability: string[];
  notes: string | undefined;
  status: string | undefined;
}

interface TestCaseStepRecord {
  order: number;
  action: string;
  expectedResult: string;
}

interface TestSpaceRunView {
  runId: string;
  status: string;
  model: string;
  businessContext: string;
  businessObjective: string;
  businessConstraints: string;
  figmaSourceMode: SourceMode;
  createdAt: string | undefined;
  updatedAt: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }

        if (isRecord(entry)) {
          const candidate =
            toStringOrEmpty(entry.label) ||
            toStringOrEmpty(entry.value) ||
            toStringOrEmpty(entry.text) ||
            toStringOrEmpty(entry.name) ||
            toStringOrEmpty(entry.id);
          return candidate;
        }

        return "";
      })
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|;/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function toNumberOrFallback(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function normalizeTestStep(value: unknown, fallbackIndex: number): TestCaseStepRecord | null {
  if (typeof value === "string") {
    const action = value.trim();
    return action.length > 0
      ? {
          order: fallbackIndex + 1,
          action,
          expectedResult: "",
        }
      : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const order = toNumberOrFallback(value.order, fallbackIndex + 1);
  const action =
    toStringOrEmpty(value.action) ||
    toStringOrEmpty(value.step) ||
    toStringOrEmpty(value.description) ||
    toStringOrEmpty(value.text);
  const expectedResult =
    toStringOrEmpty(value.expectedResult) ||
    toStringOrEmpty(value.expected) ||
    toStringOrEmpty(value.outcome) ||
    toStringOrEmpty(value.result);

  if (action.length === 0 && expectedResult.length === 0) {
    return null;
  }

  return {
    order,
    action: action || `Step ${String(order)}`,
    expectedResult,
  };
}

function normalizeStepList(value: unknown): TestCaseStepRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((step, index) => normalizeTestStep(step, index))
    .filter((step): step is TestCaseStepRecord => step !== null);
}

function formatStepLabel(step: TestCaseStepRecord): string {
  return `${String(step.order)}. ${step.action}`;
}

function normalizeTestCase(value: unknown, fallbackIndex: number): TestCaseRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = toStringOrEmpty(value.id) || `case-${String(fallbackIndex + 1)}`;
  const title =
    toStringOrEmpty(value.title) ||
    toStringOrEmpty(value.name) ||
    toStringOrEmpty(value.summary) ||
    `Test case ${String(fallbackIndex + 1)}`;
  const priority = toStringOrEmpty(value.priority) || "Unspecified";
  const type = toStringOrEmpty(value.type) || toStringOrEmpty(value.category) || "Unspecified";
  const coverageTags = toStringList(value.coverageTags);
  let explicitTraceability = toStringList(value.traceability);
  if (explicitTraceability.length === 0) {
    explicitTraceability = toStringList(value.sourceNodes);
  }
  if (explicitTraceability.length === 0) {
    explicitTraceability = toStringList(value.figmaNodes);
  }
  let steps = normalizeStepList(value.steps);
  if (steps.length === 0) {
    steps = normalizeStepList(value.testSteps);
  }
  if (steps.length === 0) {
    steps = normalizeStepList(value.procedure);
  }
  if (steps.length === 0) {
    steps = normalizeStepList(value.instructions);
  }
  const expectedResult =
    toStringOrEmpty(value.expectedResult) ||
    toStringList(value.expectedResults).join("; ") ||
    toStringOrEmpty(value.expected) ||
    toStringOrEmpty(value.outcome);

  return {
    id,
    title,
    priority,
    type,
    preconditions: (() => {
      const list = toStringList(value.preconditions);
      if (list.length > 0) {
        return list;
      }

      const alternatePreconditions = toStringList(value.precondition);
      if (alternatePreconditions.length > 0) {
        return alternatePreconditions;
      }

      return toStringList(value.setup);
    })(),
    steps,
    expectedResult,
    coverageTags,
    traceability: explicitTraceability.length > 0 ? explicitTraceability : coverageTags,
    notes:
      toStringOrEmpty(value.notes) ||
      toStringOrEmpty(value.description) ||
      toStringOrEmpty(value.rationale) ||
      undefined,
    status: toStringOrEmpty(value.status) || undefined,
  };
}

function extractTestCases(payload: unknown): TestCaseRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry, index) => normalizeTestCase(entry, index))
      .filter((entry): entry is TestCaseRecord => entry !== null);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const candidate =
    payload.testCases ?? payload.items ?? payload.cases ?? payload.data ?? payload.results;
  if (Array.isArray(candidate)) {
    return candidate
      .map((entry, index) => normalizeTestCase(entry, index))
      .filter((entry): entry is TestCaseRecord => entry !== null);
  }

  if (isRecord(candidate)) {
    const normalized = normalizeTestCase(candidate, 0);
    return normalized ? [normalized] : [];
  }

  return [];
}

function extractMarkdownText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (!isRecord(payload)) {
    return "";
  }

  const candidate = payload.markdown ?? payload.text ?? payload.value ?? payload.content;
  return typeof candidate === "string" ? candidate : "";
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (!isRecord(payload)) {
    return fallback;
  }

  const nestedError = payload.error;
  if (typeof nestedError === "string" && nestedError.trim().length > 0) {
    return nestedError;
  }

  if (isRecord(nestedError) && typeof nestedError.message === "string") {
    return nestedError.message;
  }

  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }

  return fallback;
}

function isRunActive(status: string | undefined): boolean {
  return status === "queued" || status === "running" || status === "pending";
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatListItems(items: string[]): JSX.Element {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">Not provided.</p>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li
          key={`${String(index)}-${item}`}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function formatStepItems(steps: TestCaseStepRecord[]): JSX.Element {
  if (steps.length === 0) {
    return <p className="text-sm text-slate-500">Not provided.</p>;
  }

  return (
    <ol className="min-w-0 space-y-2">
      {steps
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((step) => (
          <li
            key={`${String(step.order)}-${step.action}`}
            className="min-w-0 break-words rounded-md border border-slate-200 bg-white px-3 py-2"
          >
            <p className="break-words text-sm font-medium text-slate-800">
              {formatStepLabel(step)}
            </p>
            <p className="mt-1 break-words text-sm text-slate-600">
              <span className="font-medium text-slate-700">Expected result:</span>{" "}
              {step.expectedResult || "Not provided."}
            </p>
          </li>
        ))}
    </ol>
  );
}

function buildDownloadFilename(runId?: string): string {
  return runId ? `test-space-${runId}.md` : "test-space.md";
}

function getSelectedRunView(payload: TestSpaceRunPayload | undefined, runId: string): TestSpaceRunView {
  return {
    runId,
    status: toStringOrEmpty(payload?.status) || "unknown",
    model: toStringOrEmpty(payload?.modelDeployment) || toStringOrEmpty(payload?.model) || MODEL_NAME,
    businessContext:
      toStringOrEmpty(payload?.request?.businessContext?.summary) ||
      toStringOrEmpty(payload?.businessContext),
    businessObjective:
      toStringOrEmpty(payload?.request?.businessContext?.goals?.[0]) ||
      toStringOrEmpty(payload?.businessObjective),
    businessConstraints: toStringOrEmpty(payload?.businessConstraints),
    figmaSourceMode: sourceModes.includes(payload?.figmaSourceMode as SourceMode)
      ? (payload?.figmaSourceMode as SourceMode)
      : "rest",
    createdAt: payload?.createdAt,
    updatedAt: payload?.updatedAt,
  };
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {value}
      </dd>
    </div>
  );
}

function StatusChip({
  children,
  tone = "slate",
}: {
  children: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "indigo";
}): JSX.Element {
  const toneClasses: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-slate-100 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  description,
  children,
  className = "",
  actions,
  testId,
}: {
  title: string;
  description?: string;
  children: JSX.Element;
  className?: string;
  actions?: JSX.Element;
  testId?: string;
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs text-slate-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TextInput({
  label,
  error,
  className = "",
  ...props
}: JSX.IntrinsicElements["input"] & {
  label: string;
  error: string | undefined;
  className?: string;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <input
        {...props}
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 ${className}`}
      />
      <span className="min-h-4 text-xs text-rose-700">{error || "\u00a0"}</span>
    </label>
  );
}

function TextArea({
  label,
  error,
  ...props
}: JSX.IntrinsicElements["textarea"] & {
  label: string;
  error: string | undefined;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <textarea
        {...props}
        className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
      />
      <span className="min-h-4 text-xs text-rose-700">{error || "\u00a0"}</span>
    </label>
  );
}

function Select({
  label,
  error,
  children,
  ...props
}: JSX.IntrinsicElements["select"] & {
  label: string;
  error: string | undefined;
  children: JSX.Element[];
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <select
        {...props}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
      >
        {children}
      </select>
      <span className="min-h-4 text-xs text-rose-700">{error || "\u00a0"}</span>
    </label>
  );
}

function actionButtonClasses(
  variant: "primary" | "secondary" | "ghost" = "secondary",
): string {
  const variants: Record<typeof variant, string> = {
    primary:
      "border-slate-900 bg-slate-900 text-white hover:border-slate-700 hover:bg-slate-700",
    secondary:
      "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
    ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100",
  };

  return `inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${variants[variant]}`;
}

export function TestSpacePage(): JSX.Element {
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string>("No run generated yet.");
  const [isExporting, setIsExporting] = useState(false);

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TestSpaceFormData>({
    resolver: zodResolver(testSpaceFormSchema),
    defaultValues: {
      figmaSourceMode: "rest",
      figmaFileKey: "",
      figmaJsonPayload: "",
      figmaJsonPath: "",
      businessContext:
        "Generate business-facing test cases for the primary Figma flow. Focus on customer-visible outcomes, critical state transitions, and failure recovery.",
      businessObjective:
        "Validate the flow against business rules and expected customer outcomes.",
      businessConstraints: "Keep the suite concise, deterministic, and traceable.",
    },
  });

  const selectedSourceMode = watch("figmaSourceMode");

  const generateMutation = useMutation({
    mutationFn: async (formData: TestSpaceFormData) => {
      const trimmedJsonPayload = formData.figmaJsonPayload.trim();
      const trimmedJsonPath = formData.figmaJsonPath.trim();
      const trimmedFileKey = formData.figmaFileKey.trim();
      const requestPayload: WorkspaceTestSpaceRunRequest = {
        figmaSourceMode: formData.figmaSourceMode,
        businessContext: {
          summary: formData.businessContext.trim(),
          goals: [formData.businessObjective.trim()],
          constraints: toStringList(formData.businessConstraints),
        },
      };

      if (trimmedFileKey.length > 0) {
        requestPayload.figmaFileKey = trimmedFileKey;
      }

      if (formData.figmaSourceMode === "local_json" && trimmedJsonPath.length > 0) {
        requestPayload.figmaJsonPath = trimmedJsonPath;
      } else if (trimmedJsonPayload.length > 0) {
        requestPayload.figmaJsonPayload = trimmedJsonPayload;
      }

      const response = await fetchJson<TestSpaceRunPayload>({
        url: endpoints.runs,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        },
      });

      if (!response.ok) {
        throw new Error(
          extractErrorMessage(
            response.payload,
            `Test space run creation failed with HTTP ${String(response.status)}.`,
          ),
        );
      }

      return response.payload;
    },
    onSuccess: (payload) => {
      const nextRunId = toStringOrEmpty(payload.runId);
      if (!nextRunId) {
        setActionMessage("Run created, but the backend did not return a run id.");
        return;
      }

      setRunId(nextRunId);
      setSelectedTestCaseId(null);
      setActionMessage(`Run ${nextRunId} created. Loading generated test cases.`);
    },
    onError: (error) => {
      setActionMessage(error instanceof Error ? error.message : "Failed to create test run.");
    },
  });

  const runQuery = useQuery({
    queryKey: ["test-space-run", runId],
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const payload = query.state.data as TestSpaceRunPayload | undefined;
      return isRunActive(payload?.status) ? 2500 : false;
    },
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run id.");
      }

      const response = await fetchJson<TestSpaceRunPayload>({
        url: endpoints.run({ runId }),
      });

      if (!response.ok) {
        throw new Error(
          extractErrorMessage(
            response.payload,
            `Run fetch failed with HTTP ${String(response.status)}.`,
          ),
        );
      }

      return response.payload;
    },
  });

  const testCasesQuery = useQuery({
    queryKey: ["test-space-test-cases", runId],
    enabled: Boolean(runId),
    refetchInterval: () => {
      const payload = runQuery.data as TestSpaceRunPayload | undefined;
      return isRunActive(payload?.status) ? 2500 : false;
    },
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run id.");
      }

      const response = await fetchJson<unknown>({
        url: endpoints.testCases({ runId }),
      });

      if (!response.ok) {
        throw new Error(
          extractErrorMessage(
            response.payload,
            `Test cases fetch failed with HTTP ${String(response.status)}.`,
          ),
        );
      }

      return extractTestCases(response.payload);
    },
  });

  const markdownQuery = useQuery({
    queryKey: ["test-space-markdown", runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run id.");
      }

      const response = await fetch(endpoints.markdown({ runId }));
      if (!response.ok) {
        const fallbackMessage = `Markdown fetch failed with HTTP ${String(response.status)}.`;
        let payloadText = "";
        try {
          payloadText = await response.text();
        } catch {
          payloadText = "";
        }
        throw new Error(payloadText.trim().length > 0 ? payloadText : fallbackMessage);
      }

      return extractMarkdownText(await response.text());
    },
  });

  const selectedRun = useMemo(() => {
    if (!runId) {
      return undefined;
    }

    return getSelectedRunView(runQuery.data, runId);
  }, [runId, runQuery.data]);

  const testCases = useMemo(() => testCasesQuery.data ?? [], [testCasesQuery.data]);

  useEffect(() => {
    if (testCases.length === 0) {
      setSelectedTestCaseId(null);
      return;
    }

    if (!selectedTestCaseId || !testCases.some((item) => item.id === selectedTestCaseId)) {
      setSelectedTestCaseId(testCases[0]?.id ?? null);
    }
  }, [selectedTestCaseId, testCases]);

  const selectedTestCase = useMemo(() => {
    if (!selectedTestCaseId) {
      return testCases[0];
    }

    return testCases.find((item) => item.id === selectedTestCaseId) ?? testCases[0];
  }, [selectedTestCaseId, testCases]);

  const markdownText = markdownQuery.data ?? "";
  const canExportMarkdown = markdownText.trim().length > 0;

  async function handleSaveMarkdown(): Promise<void> {
    if (!runId) {
      setActionMessage("Generate a run before refreshing markdown.");
      return;
    }

    setActionMessage("Refreshing markdown from the backend.");
    try {
      await markdownQuery.refetch();
      setActionMessage("Markdown refreshed from the backend.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Markdown refresh failed.");
    }
  }

  async function handleCopyMarkdown(): Promise<void> {
    if (!canExportMarkdown) {
      setActionMessage("No markdown is available to copy.");
      return;
    }

    if (!("clipboard" in navigator) || typeof navigator.clipboard.writeText !== "function") {
      setActionMessage("Clipboard access is unavailable in this browser.");
      return;
    }

    await navigator.clipboard.writeText(markdownText);
    setActionMessage("Markdown copied to clipboard.");
  }

  async function handleExportMarkdown(): Promise<void> {
    if (!canExportMarkdown || !runId) {
      setActionMessage("No markdown is available to export.");
      return;
    }

    setIsExporting(true);
    try {
      const blob = new Blob([markdownText], {
        type: "text/markdown;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = buildDownloadFilename(runId);
      anchor.rel = "noopener";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setActionMessage("Markdown export started.");
    } finally {
      setIsExporting(false);
    }
  }

  const submitTestCases = handleSubmit((formData) => {
    void generateMutation.mutateAsync(formData).catch(() => undefined);
  });

  const selectedCaseIndex = selectedTestCase
    ? testCases.findIndex((item) => item.id === selectedTestCase.id)
    : -1;

  return (
    <div data-testid="test-space-page" className="flex h-screen flex-col overflow-auto bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">
                Test Space v1
              </h1>
              <StatusChip tone="indigo">{MODEL_NAME}</StatusChip>
              <StatusChip tone={runId ? "emerald" : "slate"}>
                {runId ? "Run ready" : "Draft mode"}
              </StatusChip>
            </div>
            <p className="mt-1 max-w-4xl text-sm text-slate-600">
              Generate business test cases from Figma inputs, review the case set,
              and keep the Markdown output synchronized with the backend.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionButtonClasses("primary")}
              onClick={() => {
                void submitTestCases();
              }}
              disabled={generateMutation.isPending || isSubmitting}
            >
              {generateMutation.isPending || isSubmitting ? "Generating..." : "Generate test cases"}
            </button>
            <button
              type="button"
              className={actionButtonClasses("secondary")}
              onClick={() => void handleSaveMarkdown()}
              disabled={!runId || markdownQuery.isFetching}
            >
              {markdownQuery.isFetching ? "Refreshing..." : "Save Markdown"}
            </button>
            <button
              type="button"
              className={actionButtonClasses("secondary")}
              onClick={() => void handleExportMarkdown()}
              disabled={!canExportMarkdown || isExporting}
            >
              {isExporting ? "Exporting..." : "Export Markdown"}
            </button>
            <button
              type="button"
              className={actionButtonClasses("secondary")}
              onClick={() => void handleCopyMarkdown()}
              disabled={!canExportMarkdown}
            >
              Copy Markdown
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full flex-1 max-w-[1800px] gap-4 px-4 py-4 xl:grid-cols-[360px_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel
          title="Figma source"
          description="Set the source mode and the business framing used to generate the case set."
          testId="test-space-config-panel"
        >
          <form
            onSubmit={(event) => {
              void submitTestCases(event);
            }}
            className="space-y-4 p-4"
          >
            <Select
              label="Source mode"
              error={errors.figmaSourceMode?.message}
              {...register("figmaSourceMode")}
            >
              <option value="rest">REST</option>
              <option value="hybrid">Hybrid</option>
              <option value="local_json">Local JSON</option>
            </Select>

            <TextArea
              label="Figma JSON payload"
              placeholder='{"document": {"name": "Test Space"}}'
              rows={10}
              error={errors.figmaJsonPayload?.message}
              {...register("figmaJsonPayload")}
            />
            <p className="text-xs leading-5 text-slate-500">
              REST and hybrid require an inline JSON object or array. Local JSON can use
              a filesystem path instead.
            </p>

            {selectedSourceMode === "local_json" ? (
              <>
                <TextInput
                  label="Local JSON path"
                  placeholder="/fixtures/figma.json"
                  error={errors.figmaJsonPath?.message}
                  {...register("figmaJsonPath")}
                />
                <p className="text-xs leading-5 text-slate-500">
                  Optional when you paste JSON above, required only if you want to load
                  from disk.
                </p>
              </>
            ) : (
              <>
                <TextInput
                  label="Figma file key"
                  placeholder="abc123"
                  error={errors.figmaFileKey?.message}
                  {...register("figmaFileKey")}
                />
                <p className="text-xs leading-5 text-slate-500">
                  Optional traceability metadata for REST and hybrid runs.
                </p>
              </>
            )}

            <TextArea
              label="Business context"
              placeholder="Describe the product area, customer intent, and business constraints."
              error={errors.businessContext?.message}
              {...register("businessContext")}
            />

            <TextInput
              label="Business objective"
              placeholder="What should the generated cases validate?"
              error={errors.businessObjective?.message}
              {...register("businessObjective")}
            />

            <TextArea
              label="Business constraints"
              placeholder="Optional constraints, exclusions, or policy notes."
              error={errors.businessConstraints?.message}
              {...register("businessConstraints")}
            />

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Model status
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{MODEL_NAME}</p>
                </div>
                <StatusChip tone="indigo">{MODEL_NAME}</StatusChip>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                The UI keeps model selection fixed for this version.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Current run
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusChip tone={runId ? "emerald" : "slate"}>
                  {runId ? `Run ${runId}` : "No run yet"}
                </StatusChip>
                {selectedRun ? <StatusChip tone="slate">{selectedRun.status}</StatusChip> : null}
              </div>
              <dl className="mt-3 grid gap-3">
                <Field
                  label="Last updated"
                  value={formatDateTime(selectedRun?.updatedAt ?? selectedRun?.createdAt)}
                />
              </dl>
            </div>
          </form>
        </Panel>

        <Panel
          title="Generated test cases"
          description="Review the generated business test cases before using the Markdown output."
          testId="test-space-cases-panel"
          actions={
            <div className="flex flex-wrap gap-2">
              {runId ? <StatusChip tone="emerald">{runId}</StatusChip> : null}
              {selectedRun ? <StatusChip tone="slate">{selectedRun.status}</StatusChip> : null}
            </div>
          }
          className="min-h-0"
        >
          <div className="space-y-4 p-4">
            {generateMutation.isError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {(generateMutation.error as Error).message}
              </div>
            ) : null}

            {runQuery.isError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {(runQuery.error as Error).message}
              </div>
            ) : runId && runQuery.isPending ? (
              <p className="text-sm text-slate-500">Loading run details.</p>
            ) : null}

            {testCasesQuery.isError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {(testCasesQuery.error as Error).message}
              </div>
            ) : runId && testCasesQuery.isPending ? (
              <p className="text-sm text-slate-500">Loading generated cases.</p>
            ) : null}

            {testCases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-600">
                <p className="font-medium text-slate-800">No test cases yet.</p>
                <p className="mt-1">
                  Generate a run to fetch the business test case table from the API.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        ID
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Title
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Priority
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Type
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Traceability
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {testCases.map((testCase, index) => {
                      const isSelected = testCase.id === selectedTestCase?.id;
                      return (
                        <tr
                          key={testCase.id}
                          className={isSelected ? "bg-slate-50" : "bg-white"}
                        >
                          <td className="px-3 py-3 align-top text-xs text-slate-500">
                            {testCase.id}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              className={`text-left font-medium leading-5 transition hover:text-slate-950 ${
                                isSelected ? "text-slate-950" : "text-slate-800"
                              }`}
                              onClick={() => setSelectedTestCaseId(testCase.id)}
                              aria-current={isSelected ? "true" : undefined}
                            >
                              <span className="block">{testCase.title}</span>
                              <span className="mt-1 block text-xs text-slate-500">
                                Case {String(index + 1)} of {String(testCases.length)}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <StatusChip tone="slate">{testCase.priority}</StatusChip>
                          </td>
                          <td className="px-3 py-3 align-top text-slate-700">{testCase.type}</td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {testCase.traceability.length > 0
                              ? testCase.traceability.join(", ")
                              : "Not provided"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>

        <div className="grid min-w-0 gap-4">
          <Panel
            title="Selected case details"
            description="Inspect one generated test case in detail."
            testId="test-space-detail-panel"
          >
            <div className="space-y-4 p-4">
              {!selectedTestCase ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-600">
                  Select a test case to inspect its preconditions, steps, and traceability.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="indigo">{selectedTestCase.id}</StatusChip>
                    <StatusChip tone="slate">{selectedTestCase.priority}</StatusChip>
                    <StatusChip tone="amber">{selectedTestCase.type}</StatusChip>
                    {selectedTestCase.status ? (
                      <StatusChip tone="emerald">{selectedTestCase.status}</StatusChip>
                    ) : null}
                  </div>

                  <dl className="grid gap-3">
                    <Field label="Title" value={selectedTestCase.title} />
                    <Field label="Type" value={selectedTestCase.type} />
                    <Field
                      label="Preconditions"
                      value={formatListItems(selectedTestCase.preconditions)}
                    />
                    <Field label="Steps" value={formatStepItems(selectedTestCase.steps)} />
                    <Field
                      label="Expected result"
                      value={selectedTestCase.expectedResult || "Not provided."}
                    />
                    <Field label="Coverage tags" value={formatListItems(selectedTestCase.coverageTags)} />
                    <Field
                      label="Traceability"
                      value={formatListItems(selectedTestCase.traceability)}
                    />
                    <Field
                      label="Notes"
                      value={selectedTestCase.notes ?? "Not provided."}
                    />
                  </dl>
                </>
              )}
            </div>
          </Panel>

          <Panel
            title="Markdown preview"
            description="Review the Markdown representation generated by the backend."
            testId="test-space-markdown-panel"
            actions={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={actionButtonClasses("ghost")}
                  onClick={() => void handleSaveMarkdown()}
                  disabled={!runId || markdownQuery.isFetching}
                >
                  Refresh
                </button>
              </div>
            }
          >
            <div className="space-y-3 p-4">
              <div
                role="status"
                aria-live="polite"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                {actionMessage}
              </div>

              {markdownQuery.isError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                  {(markdownQuery.error as Error).message}
                </div>
              ) : null}

              {!runId ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-sm text-slate-600">
                  Generate a run to load the Markdown output.
                </div>
              ) : markdownQuery.isPending ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-sm text-slate-600">
                  Loading Markdown from the backend.
                </div>
              ) : markdownText.trim().length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-sm text-slate-600">
                  No Markdown content is available yet.
                </div>
              ) : (
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-950 p-4 text-sm leading-6 text-slate-100">
                  {markdownText}
                </pre>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Run: {runId ?? "none"}</span>
                <span>Selected case: {selectedCaseIndex >= 0 ? String(selectedCaseIndex + 1) : "none"}</span>
                <span>Markdown length: {String(markdownText.length)}</span>
              </div>
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}
