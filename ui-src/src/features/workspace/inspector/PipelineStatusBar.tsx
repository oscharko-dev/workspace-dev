import { useState, type JSX } from "react";
import { BACKEND_STAGES } from "./paste-pipeline";
import type {
  PartialImportStats,
  PipelineError,
  PipelineStage,
  StageStatus,
} from "./paste-pipeline";
import { PipelineErrorBanner } from "./PipelineErrorBanner";

export interface PipelineStatusBarProps {
  stage: PipelineStage;
  errors: readonly PipelineError[];
  stageProgress: Record<PipelineStage, StageStatus>;
  partialStats?: PartialImportStats;
  canRetry: boolean;
  onRetry?: () => void;
  /** Called when the user clicks "Copy Report". Caller provides the report string. */
  onCopyReport?: () => void;
}

const BACKEND_STAGE_LABELS: Partial<Record<PipelineStage, string>> = {
  resolving: "Resolving",
  transforming: "Transforming",
  mapping: "Mapping",
  generating: "Generating",
};

function StageStatusIcon({
  state,
}: {
  state: StageStatus["state"];
}): JSX.Element {
  if (state === "done")
    return (
      <span aria-label="done" className="text-[#4eba87]">
        ✓
      </span>
    );
  if (state === "failed")
    return (
      <span aria-label="failed" className="text-rose-400">
        ✗
      </span>
    );
  if (state === "running")
    return (
      <span aria-label="running" className="text-amber-400">
        ◎
      </span>
    );
  return (
    <span aria-label="pending" className="text-white/25">
      ○
    </span>
  );
}

export function PipelineStatusBar({
  stage,
  errors,
  stageProgress,
  partialStats,
  canRetry,
  onRetry,
  onCopyReport,
}: PipelineStatusBarProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const summaryText =
    stage === "partial"
      ? partialStats !== undefined
        ? `Partially imported: ${String(partialStats.resolvedStages)}/${String(partialStats.totalStages)} stages resolved · ${String(partialStats.errorCount)} error${partialStats.errorCount !== 1 ? "s" : ""}`
        : "Partially imported"
      : `Import failed · ${String(errors.length)} error${errors.length !== 1 ? "s" : ""}`;

  return (
    <div
      data-testid="pipeline-status-bar"
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-[#000000] bg-[#1c1800] px-4 py-1.5"
    >
      <div className="flex items-center gap-3 text-[11px]">
        <span aria-hidden="true" className="text-amber-400">
          ⚠
        </span>
        <span className="text-amber-400">{summaryText}</span>

        <div className="ml-auto flex items-center gap-2">
          {canRetry && onRetry ? (
            <button
              type="button"
              data-testid="pipeline-status-bar-retry"
              onClick={onRetry}
              className="cursor-pointer rounded border border-amber-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-amber-400 transition hover:bg-amber-500/10"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            data-testid="pipeline-status-bar-details-toggle"
            aria-expanded={expanded}
            aria-controls="pipeline-status-bar-details"
            onClick={() => {
              setExpanded((prev) => !prev);
            }}
            className="cursor-pointer rounded border border-white/10 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-white/55 transition hover:border-white/20 hover:text-white/80"
          >
            {expanded ? "Hide Details" : "Details"}
          </button>
          {onCopyReport ? (
            <button
              type="button"
              data-testid="pipeline-status-bar-copy-report"
              onClick={onCopyReport}
              className="cursor-pointer rounded border border-white/10 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-white/55 transition hover:border-white/20 hover:text-white/80"
            >
              Copy Report
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div
          data-testid="pipeline-status-bar-details"
          id="pipeline-status-bar-details"
          role="region"
          aria-label="Pipeline error details"
          className="mt-2 space-y-2"
        >
          {/* Per-stage status */}
          <div className="flex flex-wrap gap-3">
            {BACKEND_STAGES.map((s) => {
              const status = stageProgress[s];
              const label = BACKEND_STAGE_LABELS[s] ?? s;
              return (
                <div
                  key={s}
                  className="flex items-center gap-1 text-[10px] text-white/55"
                >
                  <StageStatusIcon state={status.state} />
                  <span>{label}</span>
                  {status.duration !== undefined ? (
                    <span className="text-white/30">
                      {String(status.duration)}ms
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Per-error details */}
          {errors.length > 0 ? (
            <div className="space-y-2 border-t border-white/5 pt-2">
              {errors.map((error, i) => (
                <PipelineErrorBanner
                  key={`${error.stage}-${String(i)}`}
                  error={error}
                  {...(canRetry && onRetry !== undefined ? { onRetry } : {})}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
