import { useMemo, useRef, useState, type JSX } from "react";

import {
  postCustomContextSource,
  postJiraFetchSource,
  postJiraPasteSource,
  postWorkspaceSubmit,
} from "./api";
import { CustomContextMarkdownEditor } from "./custom-context-markdown-editor";
import {
  type MarkdownValidationState,
  useMarkdownDraft,
} from "./custom-context-markdown-editor-state";
import type {
  InspectorSourceRecord,
  MultiSourceEnvelope,
} from "./types";

export interface MultiSourceIngestionPanelProps {
  jobId: string;
  bearerToken: string;
  sources: readonly InspectorSourceRecord[];
  sourceEnvelope: MultiSourceEnvelope | undefined;
  jiraGatewayConfigured?: boolean;
  onIngested: () => Promise<void>;
}

const SOURCE_KIND_LABELS: Record<InspectorSourceRecord["kind"], string> = {
  figma_local_json: "Figma local JSON",
  figma_plugin: "Figma plugin",
  figma_rest: "Figma REST",
  jira_rest: "Jira REST",
  jira_paste: "Jira paste",
  custom_text: "Custom text",
  custom_structured: "Custom structured",
};

type SourceMixMode =
  | "figma_only"
  | "jira_api_only"
  | "jira_paste_only"
  | "figma_jira"
  | "primary_custom";

type JiraPasteFormat = "auto" | "adf_json" | "plain_text" | "markdown";

const SOURCE_MIX_OPTIONS: Array<{
  mode: SourceMixMode;
  label: string;
  description: string;
}> = [
  {
    mode: "figma_only",
    label: "Figma only",
    description: "Use attached Figma source artifacts as the primary intent.",
  },
  {
    mode: "jira_api_only",
    label: "Jira API only",
    description: "Requires a configured Jira REST gateway in the runtime.",
  },
  {
    mode: "jira_paste_only",
    label: "Jira paste only",
    description: "Air-gapped Jira path; no Figma source is required.",
  },
  {
    mode: "figma_jira",
    label: "Figma + Jira",
    description: "Combine Figma and Jira primary sources before reconciliation.",
  },
  {
    mode: "primary_custom",
    label: "Primary source + custom context",
    description: "Attach custom context to a Figma or Jira primary source.",
  },
];

const JIRA_PASTE_FORMAT_OPTIONS: Array<{
  value: JiraPasteFormat;
  label: string;
}> = [
  { value: "auto", label: "Auto-detect" },
  { value: "adf_json", label: "ADF JSON" },
  { value: "plain_text", label: "Plain text" },
  { value: "markdown", label: "Markdown" },
];

export function MultiSourceIngestionPanel({
  jobId,
  bearerToken,
  sources,
  sourceEnvelope,
  jiraGatewayConfigured = false,
  onIngested,
}: MultiSourceIngestionPanelProps): JSX.Element {
  const figmaFileInputRef = useRef<HTMLInputElement | null>(null);
  const jiraPasteFileInputRef = useRef<HTMLInputElement | null>(null);
  const [figmaJsonPayload, setFigmaJsonPayload] = useState("");
  const [figmaJsonFileName, setFigmaJsonFileName] = useState<string | null>(
    null,
  );
  const [jiraPaste, setJiraPaste] = useState("");
  const [jiraPasteFormat, setJiraPasteFormat] =
    useState<JiraPasteFormat>("auto");
  const [jiraPasteFileName, setJiraPasteFileName] = useState<string | null>(
    null,
  );
  const [jiraRestMode, setJiraRestMode] = useState<"issueKeys" | "jql">(
    "issueKeys",
  );
  const [jiraRestIssueKeys, setJiraRestIssueKeys] = useState("");
  const [jiraRestJql, setJiraRestJql] = useState("");
  const [jiraRestMaxResults, setJiraRestMaxResults] = useState(10);
  const [structuredAttributeKey, setStructuredAttributeKey] = useState("");
  const [structuredAttributeValue, setStructuredAttributeValue] = useState("");
  const [serverCanonicalMarkdown, setServerCanonicalMarkdown] = useState<
    string | null
  >(null);
  const [markdown, setMarkdown] = useMarkdownDraft(jobId);
  const [markdownValidation, setMarkdownValidation] =
    useState<MarkdownValidationState>({
      bytes: 0,
      withinBudget: true,
      message: null,
    });
  const [status, setStatus] = useState<string | null>(null);
  const [sourceMixMode, setSourceMixMode] =
    useState<SourceMixMode>("jira_paste_only");
  const [kindFilter, setKindFilter] =
    useState<"all" | InspectorSourceRecord["kind"]>("all");

  const sourceKinds = useMemo(
    () => [...new Set(sources.map((source) => source.kind))].sort(),
    [sources],
  );
  const filteredSources = useMemo(
    () =>
      kindFilter === "all"
        ? sources
        : sources.filter((source) => source.kind === kindFilter),
    [kindFilter, sources],
  );
  const primaryCount = sources.filter((source) => source.role === "primary").length;
  const supportingCount = sources.length - primaryCount;
  const jiraCount = sources.filter((source) => source.kind.startsWith("jira_")).length;
  const customCount = sources.filter((source) => source.kind.startsWith("custom_")).length;
  const figmaCount = sources.filter((source) => source.kind.startsWith("figma_")).length;
  const customOnly =
    sources.length > 0 &&
    customCount === sources.length &&
    primaryCount === 0;
  const hasPrimaryFigmaOrJira = sources.some(
    (source) =>
      source.role === "primary" &&
      (source.kind.startsWith("figma_") || source.kind.startsWith("jira_")),
  );
  const selectedMixDiagnostic = describeSourceMixMode({
    mode: sourceMixMode,
    figmaCount,
    jiraCount,
    customCount,
    hasPrimaryFigmaOrJira,
    jiraGatewayConfigured,
  });

  const handleJsonFileUpload = async (
    file: File,
    onLoaded: (text: string) => void,
  ): Promise<void> => {
    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setStatus("Upload a .json file to attach structured source content.");
      return;
    }
    const text = await file.text();
    onLoaded(text);
  };

  const handleGenerateJob = async (): Promise<void> => {
    const payload = figmaJsonPayload.trim();
    if (payload.length === 0) {
      return;
    }

    setStatus(null);
    const result = await postWorkspaceSubmit({
      figmaJsonPayload: payload,
      sourceMode: "figma_paste",
    });
    if (!result.ok) {
      setStatus(result.message);
      return;
    }

    setStatus(`Multi-source job submitted as ${result.value.jobId}.`);
    await onIngested();
  };

  const handleJiraPasteAttach = async (): Promise<void> => {
    setStatus(null);
    const result = await postJiraPasteSource({
      jobId,
      bearerToken,
      format: jiraPasteFormat,
      body: jiraPaste,
    });
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    setJiraPaste("");
    setStatus("Jira paste attached.");
    await onIngested();
  };

  const jiraRestQuery = buildJiraRestQuery({
    mode: jiraRestMode,
    issueKeysValue: jiraRestIssueKeys,
    jqlValue: jiraRestJql,
    maxResults: jiraRestMaxResults,
  });

  const handleJiraRestFetch = async (): Promise<void> => {
    if (jiraRestQuery === null) return;
    setStatus(null);
    const result = await postJiraFetchSource({
      jobId,
      bearerToken,
      query: jiraRestQuery,
    });
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    setJiraRestIssueKeys("");
    setJiraRestJql("");
    setStatus("Jira REST source attached.");
    await onIngested();
  };

  const handleCustomMarkdownAttach = async (): Promise<void> => {
    setStatus(null);
    const result = await postCustomContextSource({
      jobId,
      bearerToken,
      markdown,
    });
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    setMarkdown("");
    setServerCanonicalMarkdown(result.value.canonicalMarkdown ?? null);
    setStatus(
      result.value.redactionCount > 0
        ? `Custom context attached with ${String(
            result.value.redactionCount,
          )} server redaction(s).`
        : "Custom context attached with no server redactions.",
    );
    await onIngested();
  };

  const runSelectedMix = async (): Promise<void> => {
    switch (sourceMixMode) {
      case "jira_api_only":
        await handleJiraRestFetch();
        return;
      case "jira_paste_only":
        await handleJiraPasteAttach();
        return;
      case "figma_only":
      case "figma_jira":
      case "primary_custom":
        await handleGenerateJob();
        return;
    }
  };

  const selectedMixActionDisabled =
    bearerToken.length === 0 && sourceMixMode !== "figma_only"
      ? true
      : sourceMixMode === "jira_api_only"
        ? !jiraGatewayConfigured || jiraRestQuery === null
        : sourceMixMode === "jira_paste_only"
          ? jiraPaste.trim().length === 0
          : figmaJsonPayload.trim().length === 0;

  return (
    <section
      data-testid="ti-multisource-ingestion"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-semibold text-white">
            Multi-source ingestion
          </h2>
          <p className="m-0 text-[11px] text-white/55">
            Jira paste remains the supported air-gapped path. Jira REST is not
            exposed here unless the workspace runtime provides a gateway.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-white/45">
          bearer-gated
        </span>
      </header>

      <section
        data-testid="ti-multisource-source-mix"
        aria-label="Source mix summary"
        className="flex flex-col gap-2 rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
              Source mix
            </h3>
            <p className="m-0 text-[10px] text-white/45">
              {sourceEnvelope ? (
                <>
                  policy <span className="font-mono">{sourceEnvelope.conflictResolutionPolicy}</span>
                  {sourceEnvelope.priorityOrder && sourceEnvelope.priorityOrder.length > 0 ? (
                    <>
                      {" "}
                      · priority{" "}
                      <span className="font-mono">
                        {sourceEnvelope.priorityOrder.join(" > ")}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "No source-envelope metadata was emitted for this job."
              )}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
            Mode
            <select
              aria-label="Source mix mode"
              value={sourceMixMode}
              onChange={(event) => {
                setSourceMixMode(event.target.value as SourceMixMode);
              }}
              className="rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/80"
            >
              {SOURCE_MIX_OPTIONS.map((option) => (
                <option key={option.mode} value={option.mode}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          data-testid="ti-multisource-selected-mix"
          className={`rounded border px-3 py-2 text-[11px] ${
            selectedMixDiagnostic.available
              ? "border-emerald-500/20 bg-emerald-950/15 text-emerald-100"
              : "border-amber-500/20 bg-amber-950/15 text-amber-100"
          }`}
        >
          <div className="font-semibold text-white">
            {
              SOURCE_MIX_OPTIONS.find((option) => option.mode === sourceMixMode)
                ?.label
            }
          </div>
          <p className="m-0 mt-1 text-white/70">
            {selectedMixDiagnostic.message}
          </p>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <MixStat label="Total" value={String(sources.length)} />
          <MixStat label="Primary" value={String(primaryCount)} />
          <MixStat label="Supporting" value={String(supportingCount)} />
          <MixStat label="Filtered" value={String(filteredSources.length)} />
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] text-white/50">
          <span>Jira: {String(jiraCount)}</span>
          <span>Custom: {String(customCount)}</span>
          <span>Figma: {String(figmaCount)}</span>
          <span>
            Jira REST gateway: {jiraGatewayConfigured ? "configured" : "not configured"}
          </span>
        </div>

        <button
          type="button"
          disabled={selectedMixActionDisabled}
          onClick={() => {
            void runSelectedMix();
          }}
          className="w-fit cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35"
        >
          Run selected source mix
        </button>

        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
          Source list filter
          <select
            aria-label="Filter source list by kind"
            value={kindFilter}
            onChange={(event) => {
              setKindFilter(
                event.target.value as "all" | InspectorSourceRecord["kind"],
              );
            }}
            className="rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/80"
          >
            <option value="all">All kinds</option>
            {sourceKinds.map((kind) => (
              <option key={kind} value={kind}>
                {SOURCE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        {customOnly && !hasPrimaryFigmaOrJira ? (
          <p
            data-testid="ti-multisource-custom-only-disabled"
            className="m-0 rounded border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-200"
          >
            Custom-only mixes are disabled until a primary Figma or Jira source
            is attached.
          </p>
        ) : null}

        {filteredSources.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {filteredSources.map((source) => (
              <li
                key={source.sourceId}
                className="rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/75"
              >
                <span className="font-medium text-white">{source.label}</span>
                <span className="text-white/35"> · </span>
                <span className="font-mono">{SOURCE_KIND_LABELS[source.kind]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-white/65" htmlFor="ti-multisource-figma-json">
            Figma JSON
          </label>
          <p className="m-0 text-[10px] text-white/45">
            Upload a Figma JSON export, then submit it with the existing
            `/workspace/submit` flow.
          </p>
          <textarea
            data-testid="ti-multisource-figma-json"
            id="ti-multisource-figma-json"
            value={figmaJsonPayload}
            onChange={(event) => {
              setFigmaJsonPayload(event.target.value);
              setFigmaJsonFileName(null);
            }}
            rows={8}
            className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                figmaFileInputRef.current?.click();
              }}
              className="cursor-pointer rounded border border-white/20 bg-[#181818] px-2 py-1 text-[11px] font-medium text-white/75 transition hover:border-white/35 hover:text-white"
            >
              Upload Figma JSON
            </button>
            <button
              type="button"
              disabled={figmaJsonPayload.trim().length === 0}
              onClick={() => {
                void handleGenerateJob();
              }}
              className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35"
            >
              Generate multi-source job
            </button>
          </div>
          <input
            ref={figmaFileInputRef}
            type="file"
            aria-label="Upload Figma JSON file"
            className="sr-only"
            accept=".json,application/json"
            disabled={false}
            onChange={(event) => {
              const files = event.currentTarget.files;
              const file =
                files === null
                  ? null
                  : typeof files.item === "function"
                    ? files.item(0)
                    : (files[0] ?? null);
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void handleJsonFileUpload(file, (text) => {
                setFigmaJsonPayload(text);
                setFigmaJsonFileName(file.name);
                setStatus(`Loaded Figma JSON from ${file.name}.`);
              });
            }}
          />
          <p className="m-0 text-[10px] text-white/45">
            {figmaJsonFileName ? (
              <>
                Loaded <span className="font-mono">{figmaJsonFileName}</span>
              </>
            ) : (
              "Use a file upload or paste a JSON payload here."
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-white/65" htmlFor="ti-multisource-jira-paste">
            Jira paste
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
              Format
              <select
                aria-label="Jira paste format"
                value={jiraPasteFormat}
                onChange={(event) => {
                  setJiraPasteFormat(event.target.value as JiraPasteFormat);
                }}
                className="rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/80"
              >
                {JIRA_PASTE_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                jiraPasteFileInputRef.current?.click();
              }}
              className="cursor-pointer rounded border border-white/20 bg-[#181818] px-2 py-1 text-[11px] font-medium text-white/75 transition hover:border-white/35 hover:text-white"
            >
              Upload ADF JSON
            </button>
          </div>
          <textarea
            data-testid="ti-multisource-jira-paste"
            id="ti-multisource-jira-paste"
            value={jiraPaste}
            onChange={(event) => {
              setJiraPaste(event.target.value);
            }}
            rows={8}
            className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
          />
          <button
            type="button"
            disabled={bearerToken.length === 0 || jiraPaste.trim().length === 0}
            onClick={() => {
              void handleJiraPasteAttach();
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87]"
          >
            Attach Jira paste
          </button>
          <input
            ref={jiraPasteFileInputRef}
            type="file"
            aria-label="Upload Jira ADF JSON file"
            className="sr-only"
            accept=".json,application/json"
            disabled={false}
            onChange={(event) => {
              const files = event.currentTarget.files;
              const file =
                files === null
                  ? null
                  : typeof files.item === "function"
                    ? files.item(0)
                    : (files[0] ?? null);
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              void handleJsonFileUpload(file, (text) => {
                setJiraPasteFormat("adf_json");
                setJiraPaste(text);
                setJiraPasteFileName(file.name);
                setStatus(`Loaded Jira ADF JSON from ${file.name}.`);
              });
            }}
          />
          <p className="m-0 text-[10px] text-white/45">
            {jiraPasteFileName ? (
              <>
                Loaded <span className="font-mono">{jiraPasteFileName}</span>
              </>
            ) : (
              "ADF JSON files auto-select the ADF format override."
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-white/65" htmlFor="ti-multisource-jira-rest">
            Jira REST
          </label>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
            Query
            <select
              aria-label="Jira REST query mode"
              value={jiraRestMode}
              onChange={(event) => {
                setJiraRestMode(event.target.value as "issueKeys" | "jql");
              }}
              className="rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/80"
            >
              <option value="issueKeys">Issue keys</option>
              <option value="jql">JQL</option>
            </select>
          </label>
          <input
            data-testid="ti-multisource-jira-rest"
            id="ti-multisource-jira-rest"
            aria-label={
              jiraRestMode === "jql"
                ? "Jira REST JQL"
                : "Jira REST issue keys"
            }
            value={jiraRestMode === "jql" ? jiraRestJql : jiraRestIssueKeys}
            onChange={(event) => {
              if (jiraRestMode === "jql") {
                setJiraRestJql(event.target.value);
              } else {
                setJiraRestIssueKeys(event.target.value);
              }
            }}
            className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
          />
          {jiraRestMode === "jql" ? (
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
              Max
              <input
                aria-label="Jira REST max results"
                type="number"
                min={1}
                max={50}
                value={jiraRestMaxResults}
                onChange={(event) => {
                  setJiraRestMaxResults(Number(event.target.value));
                }}
                className="w-20 rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] text-white/80"
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={
              bearerToken.length === 0 ||
              !jiraGatewayConfigured ||
              jiraRestQuery === null
            }
            title={
              !jiraGatewayConfigured
                ? "Jira REST requires a configured runtime gateway."
                : undefined
            }
            onClick={() => {
              void handleJiraRestFetch();
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35"
          >
            Fetch Jira REST
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <CustomContextMarkdownEditor
            value={markdown}
            onChange={setMarkdown}
            onValidationChange={setMarkdownValidation}
          />
          <button
            type="button"
            disabled={
              bearerToken.length === 0 ||
              markdown.trim().length === 0 ||
              !markdownValidation.withinBudget ||
              !hasPrimaryFigmaOrJira
            }
            title={
              markdownValidation.message ??
              (!hasPrimaryFigmaOrJira
                ? "Attach a primary Figma or Jira source before custom context."
                : undefined) ??
              (bearerToken.length === 0
                ? "Set the bearer token to attach custom context."
                : undefined)
            }
            onClick={() => {
              void handleCustomMarkdownAttach();
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87]"
          >
            Attach custom context
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-white/65" htmlFor="ti-multisource-structured-key">
            Structured custom attribute
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              data-testid="ti-multisource-structured-key"
              id="ti-multisource-structured-key"
              aria-label="Structured custom attribute key"
              value={structuredAttributeKey}
              onChange={(event) => {
                setStructuredAttributeKey(event.target.value);
              }}
              className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
            />
            <input
              data-testid="ti-multisource-structured-value"
              aria-label="Structured custom attribute value"
              value={structuredAttributeValue}
              onChange={(event) => {
                setStructuredAttributeValue(event.target.value);
              }}
              className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
            />
          </div>
          <button
            type="button"
            disabled={
              bearerToken.length === 0 ||
              structuredAttributeKey.trim().length === 0 ||
              structuredAttributeValue.trim().length === 0 ||
              !hasPrimaryFigmaOrJira
            }
            title={
              !hasPrimaryFigmaOrJira
                ? "Attach a primary Figma or Jira source before custom context."
                : bearerToken.length === 0
                  ? "Set the bearer token to attach custom context."
                  : undefined
            }
            onClick={() => {
              setStatus(null);
              void postCustomContextSource({
                jobId,
                bearerToken,
                attributes: [
                  {
                    key: structuredAttributeKey.trim(),
                    value: structuredAttributeValue.trim(),
                  },
                ],
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.message);
                  return;
                }
                setStructuredAttributeKey("");
                setStructuredAttributeValue("");
                setStatus("Structured custom context attached.");
                await onIngested();
              });
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87]"
          >
            Attach structured context
          </button>
        </div>
      </div>

      <div className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2 text-[11px] text-white/65">
        Jira paste is the supported air-gapped ingestion path. Jira REST fetch
        requires a runtime gateway, and custom-only mixes remain blocked until a
        primary Figma or Jira source is present.
      </div>
      {status ? (
        <p
          data-testid="ti-multisource-ingestion-status"
          className="m-0 text-[11px] text-white/70"
        >
          {status}
        </p>
      ) : null}
      {serverCanonicalMarkdown !== null ? (
        <pre
          data-testid="ti-multisource-server-canonical-markdown"
          className="m-0 max-h-32 overflow-auto rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] text-white/65"
        >
          {serverCanonicalMarkdown}
        </pre>
      ) : null}
    </section>
  );
}

function parseJiraRestIssueKeys(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ).sort();
}

function buildJiraRestQuery(input: {
  mode: "issueKeys" | "jql";
  issueKeysValue: string;
  jqlValue: string;
  maxResults: number;
}):
  | { kind: "issueKeys"; issueKeys: string[] }
  | { kind: "jql"; jql: string; maxResults: number }
  | null {
  if (input.mode === "jql") {
    const jql = input.jqlValue.trim();
    if (jql.length === 0) return null;
    const maxResults = Number.isInteger(input.maxResults)
      ? Math.min(Math.max(input.maxResults, 1), 50)
      : 10;
    return { kind: "jql", jql, maxResults };
  }
  const issueKeys = parseJiraRestIssueKeys(input.issueKeysValue);
  return issueKeys.length > 0 ? { kind: "issueKeys", issueKeys } : null;
}

interface MixStatProps {
  label: string;
  value: string;
}

function MixStat({ label, value }: MixStatProps): JSX.Element {
  return (
    <div className="rounded border border-white/10 bg-[#171717] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function describeSourceMixMode(input: {
  mode: SourceMixMode;
  figmaCount: number;
  jiraCount: number;
  customCount: number;
  hasPrimaryFigmaOrJira: boolean;
  jiraGatewayConfigured: boolean;
}): { available: boolean; message: string } {
  switch (input.mode) {
    case "figma_only":
      return input.figmaCount > 0
        ? { available: true, message: "Figma sources are attached and primary." }
        : {
            available: false,
            message:
              "Attach a Figma source before using the Figma-only source mix.",
          };
    case "jira_api_only":
      return input.jiraGatewayConfigured
        ? {
            available: true,
            message:
              "Jira REST is configured; provide JQL or issue keys to run the Jira API-only source mix.",
          }
        : {
            available: false,
            message:
              "Jira API-only runs require a configured Jira REST gateway; use Jira paste for air-gapped workspaces.",
          };
    case "jira_paste_only":
      return input.jiraCount > 0
        ? { available: true, message: "Jira paste can run as the primary source." }
        : {
            available: false,
            message:
              "Paste a Jira issue body before running a Jira paste-only source mix.",
          };
    case "figma_jira":
      return input.figmaCount > 0 && input.jiraCount > 0
        ? {
            available: true,
            message: "Figma and Jira sources are attached for reconciliation.",
          }
        : {
            available: false,
            message:
              "Attach both a Figma source and a Jira source before using Figma + Jira.",
          };
    case "primary_custom":
      return input.hasPrimaryFigmaOrJira && input.customCount > 0
        ? {
            available: true,
            message:
              "A primary source and supporting custom context are attached.",
          }
        : {
            available: false,
            message:
              "Attach a primary Figma or Jira source plus custom context; custom-only is rejected server-side.",
          };
  }
}
