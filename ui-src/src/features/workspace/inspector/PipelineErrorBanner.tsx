import type { JSX } from "react";
import { getPasteErrorMessage } from "./paste-error-catalog";
import type { PipelineError } from "./paste-pipeline";

export interface PipelineErrorBannerProps {
  error: PipelineError;
  onRetry?: () => void;
}

export function PipelineErrorBanner({
  error,
  onRetry,
}: PipelineErrorBannerProps): JSX.Element {
  const msg = getPasteErrorMessage(error.code);

  return (
    <div
      data-testid="pipeline-error-banner"
      className="flex flex-wrap items-start gap-2 text-[11px] text-rose-400"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold leading-snug">{msg.title}</span>
        <span className="leading-snug text-rose-400/80">{msg.description}</span>
        <span className="leading-snug text-white/45">{msg.action}</span>
        {error.retryAfterMs !== undefined ? (
          <span className="text-[10px] text-white/35">
            Retry available in {Math.ceil(error.retryAfterMs / 1000)}s
          </span>
        ) : null}
      </div>
      {error.retryable && onRetry ? (
        <button
          type="button"
          data-testid="pipeline-error-banner-retry"
          onClick={onRetry}
          className="shrink-0 cursor-pointer rounded border border-rose-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-rose-400 transition hover:bg-rose-500/10"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
