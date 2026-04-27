// ---------------------------------------------------------------------------
// Jira Write panel (Issue #1482 — Wave 5)
//
// Configures the Jira sub-task write pipeline. Surfaces:
//   - explicit read-only / dry-run / write mode (default read-only)
//   - parent issue key input with format validation
//   - configurable markdown output directory + default-path fallback
//   - localStorage-backed config persistence + server-side config save
//
// Wire-protocol:
//   GET  /workspace/test-intelligence/write/config            (read)
//   PUT  /workspace/test-intelligence/write/config            (save)
//   POST /workspace/test-intelligence/write/<jobId>/jira-subtasks  (run)
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type JSX } from "react";

import {
  getJiraWriteConfig,
  saveJiraWriteConfig,
  startJiraWrite,
  type JiraWriteStartResult,
} from "./api";
import { safeReadStorage, safeWriteStorage } from "./safe-storage";
import { validateOutputPathFormat } from "./output-path-validation";

export const JIRA_WRITE_CONFIG_STORAGE_KEY =
  "workspace-dev:ti-jira-write-config:v1";

export const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/u;

export interface JiraWritePanelProps {
  jobId: string;
  bearerToken: string;
  onWriteComplete?: (result: JiraWriteStartResult) => void;
}

type JiraWriteUiMode = "read" | "dry-run" | "write";

interface CurrentPersistedConfig {
  writeMode: JiraWriteUiMode;
  parentIssueKey: string;
  outputPathMarkdown: string;
  useDefaultOutputPath: boolean;
}

interface LegacyPersistedConfig {
  writeEnabled: boolean;
  parentIssueKey: string;
  dryRun: boolean;
  outputPathMarkdown: string;
  useDefaultOutputPath: boolean;
}

type PersistedConfig = CurrentPersistedConfig;

const DEFAULT_CONFIG: PersistedConfig = {
  writeMode: "read",
  parentIssueKey: "",
  outputPathMarkdown: "",
  useDefaultOutputPath: true,
};

const isJiraWriteUiMode = (value: unknown): value is JiraWriteUiMode =>
  value === "read" || value === "dry-run" || value === "write";

const isCurrentPersistedConfig = (
  value: unknown,
): value is CurrentPersistedConfig =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  isJiraWriteUiMode((value as Record<string, unknown>)["writeMode"]) &&
  typeof (value as Record<string, unknown>)["parentIssueKey"] === "string" &&
  typeof (value as Record<string, unknown>)["outputPathMarkdown"] ===
    "string" &&
  typeof (value as Record<string, unknown>)["useDefaultOutputPath"] ===
    "boolean";

const isLegacyPersistedConfig = (
  value: unknown,
): value is LegacyPersistedConfig =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>)["writeEnabled"] === "boolean" &&
  typeof (value as Record<string, unknown>)["parentIssueKey"] === "string" &&
  typeof (value as Record<string, unknown>)["dryRun"] === "boolean" &&
  typeof (value as Record<string, unknown>)["outputPathMarkdown"] ===
    "string" &&
  typeof (value as Record<string, unknown>)["useDefaultOutputPath"] ===
    "boolean";

const migrateLegacyConfig = (
  value: LegacyPersistedConfig,
): PersistedConfig => ({
  writeMode: !value.writeEnabled ? "read" : value.dryRun ? "dry-run" : "write",
  parentIssueKey: value.parentIssueKey,
  outputPathMarkdown: value.outputPathMarkdown,
  useDefaultOutputPath: value.useDefaultOutputPath,
});

const readPersistedConfig = (): PersistedConfig => {
  const raw = safeReadStorage(JIRA_WRITE_CONFIG_STORAGE_KEY);
  if (raw.length === 0) return DEFAULT_CONFIG;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCurrentPersistedConfig(parsed)) {
      return parsed;
    }
    if (isLegacyPersistedConfig(parsed)) return migrateLegacyConfig(parsed);
  } catch {
    // ignore corrupt config — fall back to defaults
  }
  return DEFAULT_CONFIG;
};

type RunStatus = "idle" | "running" | "success" | "error" | "refused";

export function JiraWritePanel({
  jobId,
  bearerToken,
  onWriteComplete,
}: JiraWritePanelProps): JSX.Element {
  const [config, setConfig] = useState<PersistedConfig>(() =>
    readPersistedConfig(),
  );
  const [status, setStatus] = useState<RunStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<JiraWriteStartResult | null>(
    null,
  );

  // Load server-side config on mount; merges over any localStorage state.
  useEffect(() => {
    const cancelled = { current: false };
    void (async () => {
      const result = await getJiraWriteConfig();
      if (cancelled.current || !result.ok) return;
      setConfig((prev) => ({
        ...prev,
        ...(result.value.outputPathMarkdown !== undefined
          ? { outputPathMarkdown: result.value.outputPathMarkdown }
          : {}),
        ...(result.value.useDefaultOutputPath !== undefined
          ? { useDefaultOutputPath: result.value.useDefaultOutputPath }
          : {}),
      }));
    })();
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Persist config to localStorage whenever it changes.
  useEffect(() => {
    safeWriteStorage(JIRA_WRITE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const parentIssueKeyValid =
    config.parentIssueKey.length > 0 &&
    JIRA_ISSUE_KEY_PATTERN.test(config.parentIssueKey);
  const parentIssueKeyValidationMessage =
    config.parentIssueKey.length === 0
      ? "Parent issue key is required."
      : !parentIssueKeyValid
        ? "Use the canonical Jira key shape, e.g. PROJ-123."
        : null;

  const outputPathFormatResult = config.useDefaultOutputPath
    ? ({ ok: true } as const)
    : validateOutputPathFormat(config.outputPathMarkdown);
  const outputPathValid =
    config.useDefaultOutputPath ||
    (config.outputPathMarkdown.trim().length > 0 && outputPathFormatResult.ok);
  const outputPathValidationMessage: string | null = config.useDefaultOutputPath
    ? null
    : config.outputPathMarkdown.trim().length === 0
      ? "Provide a markdown output directory or enable the default path."
      : !outputPathFormatResult.ok
        ? outputPathFormatResult.message
        : null;

  const runDisabled = useMemo(() => {
    if (config.writeMode === "read") return true;
    if (status === "running") return true;
    if (!parentIssueKeyValid) return true;
    if (!outputPathValid) return true;
    if (bearerToken.length === 0) return true;
    return false;
  }, [
    config.writeMode,
    status,
    parentIssueKeyValid,
    outputPathValid,
    bearerToken,
  ]);

  const handleSaveConfig = async (): Promise<void> => {
    setStatus("idle");
    setStatusMessage(null);
    const payload: {
      outputPathMarkdown?: string;
      useDefaultOutputPath: boolean;
    } = {
      useDefaultOutputPath: config.useDefaultOutputPath,
    };
    if (!config.useDefaultOutputPath && config.outputPathMarkdown.length > 0) {
      payload.outputPathMarkdown = config.outputPathMarkdown.trim();
    }
    const result = await saveJiraWriteConfig(payload, bearerToken);
    if (!result.ok) {
      setStatus("error");
      setStatusMessage(result.message);
      return;
    }
    setStatusMessage("Jira write config saved.");
  };

  const handleRun = async (): Promise<void> => {
    if (runDisabled) return;
    setStatus("running");
    setStatusMessage(null);
    const result = await startJiraWrite(
      {
        jobId,
        parentIssueKey: config.parentIssueKey,
        dryRun: config.writeMode === "dry-run",
        ...(config.useDefaultOutputPath
          ? {}
          : { outputPathMarkdown: config.outputPathMarkdown.trim() }),
        useDefaultOutputPath: config.useDefaultOutputPath,
      },
      bearerToken,
    );
    if (!result.ok) {
      setStatus("error");
      setStatusMessage(result.message);
      setLastResult(null);
      return;
    }
    setLastResult(result.value);
    if (result.value.refused) {
      setStatus("refused");
      const codes = result.value.refusalCodes ?? [];
      setStatusMessage(
        codes.length > 0
          ? `Refused: ${codes.join(", ")}`
          : "Jira write was refused.",
      );
    } else {
      setStatus("success");
      setStatusMessage(
        result.value.dryRun
          ? `Dry-run completed for ${String(result.value.dryRunCount ?? 0)} case(s).`
          : `Created ${String(result.value.createdCount)}, skipped ${String(
              result.value.skippedDuplicateCount,
            )}, failed ${String(result.value.failedCount)}.`,
      );
    }
    onWriteComplete?.(result.value);
  };

  return (
    <section
      data-testid="ti-jira-write-panel"
      aria-label="Jira sub-task write pipeline"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-semibold text-white">Jira write</h2>
          <p className="m-0 text-[11px] text-white/55">
            Idempotent sub-task creation for approved test cases.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-white/45">
          opt-in
        </span>
      </header>

      <fieldset className="flex flex-col gap-2 rounded border border-white/10 bg-[#0f0f0f] px-3 py-2">
        <legend className="px-1 text-[11px] text-white/65">Mode</legend>
        <div className="grid grid-cols-3 gap-1 rounded bg-[#0a0a0a] p-1">
          {(
            [
              { value: "read", label: "Read-only" },
              { value: "dry-run", label: "Dry-run" },
              { value: "write", label: "Write" },
            ] satisfies Array<{ value: JiraWriteUiMode; label: string }>
          ).map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center justify-center rounded px-2 py-1 text-[11px] font-medium ${
                config.writeMode === option.value
                  ? "bg-[#4eba87] text-[#07120c]"
                  : "text-white/70 hover:text-white"
              }`}
            >
              <input
                data-testid={`ti-jira-write-mode-${option.value}`}
                type="radio"
                name={`ti-jira-write-mode-${jobId}`}
                value={option.value}
                checked={config.writeMode === option.value}
                onChange={() => {
                  setConfig({ ...config, writeMode: option.value });
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label
          className="text-[11px] text-white/65"
          htmlFor="ti-jira-write-parent-key"
        >
          Parent issue key
        </label>
        <input
          data-testid="ti-jira-write-parent-key"
          id="ti-jira-write-parent-key"
          aria-label="Parent issue key"
          aria-invalid={
            config.parentIssueKey.length > 0 && !parentIssueKeyValid
              ? true
              : undefined
          }
          type="text"
          value={config.parentIssueKey}
          onChange={(event) => {
            setConfig({ ...config, parentIssueKey: event.target.value.trim() });
          }}
          placeholder="PROJ-123"
          className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[12px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
        />
        {parentIssueKeyValidationMessage ? (
          <p
            data-testid="ti-jira-write-parent-key-error"
            className="m-0 text-[10px] text-amber-200"
          >
            {parentIssueKeyValidationMessage}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2 rounded border border-white/10 bg-[#0f0f0f] px-3 py-2">
        <legend className="px-1 text-[11px] text-white/65">
          Markdown output path
        </legend>
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          <input
            data-testid="ti-jira-write-use-default-path"
            type="checkbox"
            checked={config.useDefaultOutputPath}
            onChange={(event) => {
              setConfig({
                ...config,
                useDefaultOutputPath: event.target.checked,
              });
            }}
          />
          Use default path (under the job&apos;s artifact root)
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/65">
          Custom directory
          <input
            data-testid="ti-jira-write-output-path"
            aria-label="Markdown output path"
            aria-invalid={!outputPathValid ? true : undefined}
            type="text"
            value={config.outputPathMarkdown}
            disabled={config.useDefaultOutputPath}
            onChange={(event) => {
              setConfig({
                ...config,
                outputPathMarkdown: event.target.value,
              });
            }}
            placeholder="/tmp/jira-write-out"
            className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[12px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50 disabled:opacity-50"
          />
        </label>
        {outputPathValidationMessage ? (
          <p
            data-testid="ti-jira-write-output-path-error"
            className="m-0 text-[10px] text-amber-200"
          >
            {outputPathValidationMessage}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="ti-jira-write-save-config"
          disabled={bearerToken.length === 0}
          onClick={() => {
            void handleSaveConfig();
          }}
          className="cursor-pointer rounded border border-white/15 bg-[#0a0a0a] px-2 py-1 text-[11px] font-medium text-white/75 transition hover:border-[#4eba87]/40 hover:text-[#4eba87] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save config
        </button>
        <button
          type="button"
          data-testid="ti-jira-write-run"
          disabled={runDisabled}
          onClick={() => {
            void handleRun();
          }}
          className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35"
        >
          {status === "running" ? "Running…" : "Start Jira write"}
        </button>
      </div>

      {statusMessage !== null ? (
        <p
          data-testid="ti-jira-write-status"
          role={status === "error" || status === "refused" ? "alert" : "status"}
          className={`m-0 text-[11px] ${
            status === "error" || status === "refused"
              ? "text-rose-200"
              : "text-white/70"
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {lastResult?.markdownOutputPath ? (
        <div
          data-testid="ti-jira-write-output-path-result"
          className="break-words rounded border border-white/10 bg-[#0f0f0f] px-2 py-1 text-[11px] text-white/70"
        >
          <span className="text-white/55">Markdown output: </span>
          <span className="font-mono text-white/85">
            {lastResult.markdownOutputPath}
          </span>
        </div>
      ) : null}

      {lastResult !== null && lastResult.refused ? (
        <ul
          data-testid="ti-jira-write-refusal-codes"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {(lastResult.refusalCodes ?? []).map((code, index) => (
            <li
              key={`${code}-${String(index)}`}
              data-testid={`ti-jira-write-refusal-code-${code}`}
              className="break-words rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1 font-mono text-[11px] text-rose-200"
            >
              {code}
            </li>
          ))}
        </ul>
      ) : null}

      {lastResult !== null && !lastResult.refused ? (
        <dl
          data-testid="ti-jira-write-result-summary"
          className="m-0 grid gap-1 text-[11px] text-white/70 md:grid-cols-2"
        >
          <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#0f0f0f] px-2 py-1">
            <dt>Total cases</dt>
            <dd className="m-0 font-mono text-white/85">
              {String(lastResult.totalCases)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#0f0f0f] px-2 py-1">
            <dt>Created</dt>
            <dd className="m-0 font-mono text-white/85">
              {String(lastResult.createdCount)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#0f0f0f] px-2 py-1">
            <dt>Skipped duplicates</dt>
            <dd className="m-0 font-mono text-white/85">
              {String(lastResult.skippedDuplicateCount)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#0f0f0f] px-2 py-1">
            <dt>Failed</dt>
            <dd className="m-0 font-mono text-white/85">
              {String(lastResult.failedCount)}
            </dd>
          </div>
          {lastResult.dryRun ? (
            <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#0f0f0f] px-2 py-1 md:col-span-2">
              <dt>Dry-run outcomes</dt>
              <dd className="m-0 font-mono text-white/85">
                {String(lastResult.dryRunCount ?? 0)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
