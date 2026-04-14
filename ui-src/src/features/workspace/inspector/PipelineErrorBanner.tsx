import { useEffect, useState, type JSX } from "react";
import { getPasteErrorMessage } from "./paste-error-catalog";
import type { PipelineError, PipelineStage } from "./paste-pipeline";

export interface PipelineErrorBannerProps {
  error: PipelineError;
  onRetry?: (stage?: PipelineStage, targetIds?: string[]) => void;
}

function useRetryCountdown(
  retryAvailableAtMs: number | undefined,
  retryAfterMs: number | undefined,
): number | undefined {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (retryAvailableAtMs === undefined && retryAfterMs === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [retryAfterMs, retryAvailableAtMs]);

  if (retryAvailableAtMs !== undefined) {
    return Math.max(0, retryAvailableAtMs - now);
  }
  return retryAfterMs;
}

export function PipelineErrorBanner({
  error,
  onRetry,
}: PipelineErrorBannerProps): JSX.Element {
  const msg = getPasteErrorMessage(error.code);
  const retryRemainingMs = useRetryCountdown(
    error.retryAvailableAtMs,
    error.retryAfterMs,
  );
  const retryBlocked =
    retryRemainingMs !== undefined && retryRemainingMs > 0 && error.retryable;
  const retryTargetIds = error.retryTargets
    ?.map((target) => target.id)
    .filter((id) => id.length > 0);

  return (
    <div
      data-testid="pipeline-error-banner"
      role="alert"
      className="flex flex-wrap items-start gap-2 text-[11px] text-rose-400"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold leading-snug">{msg.title}</span>
        <span className="leading-snug text-rose-400/80">{msg.description}</span>
        <span className="leading-snug text-white/45">{msg.action}</span>
        {retryRemainingMs !== undefined && retryRemainingMs > 0 ? (
          <span className="text-[10px] text-white/35">
            Retry available in {Math.ceil(retryRemainingMs / 1000)}s
          </span>
        ) : null}
      </div>
      {error.retryable && onRetry ? (
        <button
          type="button"
          data-testid="pipeline-error-banner-retry"
          aria-label={`Retry ${error.stage} stage`}
          onClick={() => {
            if (retryBlocked) {
              return;
            }
            onRetry(
              error.stage,
              retryTargetIds !== undefined && retryTargetIds.length > 0
                ? retryTargetIds
                : undefined,
            );
          }}
          disabled={retryBlocked}
          className="shrink-0 rounded border border-rose-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-rose-400 transition hover:bg-rose-500/10 disabled:cursor-default disabled:opacity-50"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
