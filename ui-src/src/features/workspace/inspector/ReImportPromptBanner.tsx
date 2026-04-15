import type { JSX } from "react";
import type { PasteImportSession } from "./paste-import-history";

export interface ReImportDeltaSummary {
  readonly totalNodes: number;
  readonly nodesReused: number;
  readonly nodesReprocessed: number;
}

export interface ReImportPromptBannerProps {
  /** The matching previous session. */
  previousSession: PasteImportSession;
  /** Click handler for "Update existing import" — caller re-runs the pipeline as a delta update. */
  onUpdate: () => void;
  /** Click handler for "Create new" — caller re-runs pipeline with `importMode: "full"`. */
  onCreateNew: () => void;
  /** Click handler for the dismiss/close icon. */
  onDismiss: () => void;
  /** Optional delta summary from the most recent run. Renders an inline diff hint. */
  deltaSummary?: ReImportDeltaSummary | null;
}

export function ReImportPromptBanner({
  previousSession,
  onUpdate,
  onCreateNew,
  onDismiss,
  deltaSummary = null,
}: ReImportPromptBannerProps): JSX.Element {
  const importedAtLabel = new Date(
    previousSession.importedAt,
  ).toLocaleDateString();
  const message = `This design was previously imported on ${importedAtLabel}. Update existing import or create new?`;
  const diffHint =
    deltaSummary !== null && deltaSummary.totalNodes > 0
      ? `${String(deltaSummary.nodesReprocessed)} of ${String(deltaSummary.totalNodes)} nodes changed since last import`
      : null;

  return (
    <div
      data-testid="reimport-banner"
      role="status"
      aria-live="polite"
      aria-label="Re-import prompt"
      className="flex shrink-0 items-center gap-3 border-b border-[#000000] bg-[#1c1800] px-4 py-1.5 text-[11px]"
    >
      <span aria-hidden="true" className="text-amber-400">
        ⚠
      </span>
      <span className="min-w-0 flex-1 text-amber-400">{message}</span>
      {diffHint !== null ? (
        <span
          data-testid="reimport-diff-hint"
          className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200"
        >
          {diffHint}
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          data-testid="reimport-update"
          onClick={onUpdate}
          className="cursor-pointer rounded border border-amber-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-amber-400 transition hover:bg-amber-500/10"
        >
          Update
        </button>
        <button
          type="button"
          data-testid="reimport-create-new"
          onClick={onCreateNew}
          className="cursor-pointer rounded border border-white/10 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-white/55 transition hover:border-white/20 hover:text-white/80"
        >
          Create new
        </button>
        <button
          type="button"
          data-testid="reimport-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="cursor-pointer rounded border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/45 transition hover:border-[#000000] hover:bg-[#222222] hover:text-white/85"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
