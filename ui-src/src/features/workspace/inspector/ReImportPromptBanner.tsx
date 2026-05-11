import type { JSX } from "react";
import type { PasteImportSession } from "./paste-import-history";

const IMPORTED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatImportedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return IMPORTED_AT_FORMATTER.format(date);
}

export interface ReImportDeltaSummary {
  readonly totalNodes: number;
  readonly nodesReused: number;
  readonly nodesReprocessed: number;
}

export interface ReImportPromptBannerProps {
  /** The matching previous session. */
  previousSession: PasteImportSession;
  /** Click handler for "Regenerate changed" — caller re-runs the pipeline as a delta update. */
  onRegenerateChanged: () => void;
  /** Click handler for "Regenerate selected" — caller re-runs only the selected subset. */
  onRegenerateSelected: () => void;
  /** Click handler for "Create new" — caller re-runs pipeline with `importMode: "full"`. */
  onCreateNew: () => void;
  /** Click handler for the dismiss/close icon. */
  onDismiss: () => void;
  /** Count of changed nodes in the current diff. */
  changedCount?: number;
  /** Count of currently selected changed nodes. */
  selectedChangedCount?: number;
  /** Count of changed nodes that will keep existing code if the selected-only action runs. */
  keepExistingCount?: number;
  /** Optional delta summary from the most recent run. Renders an inline diff hint. */
  deltaSummary?: ReImportDeltaSummary | null;
}

export function ReImportPromptBanner({
  previousSession,
  onRegenerateChanged,
  onRegenerateSelected,
  onCreateNew,
  onDismiss,
  changedCount = 0,
  selectedChangedCount = 0,
  keepExistingCount = 0,
  deltaSummary = null,
}: ReImportPromptBannerProps): JSX.Element {
  const importedAtLabel = formatImportedAt(previousSession.importedAt);
  const message = `This design was previously imported on ${importedAtLabel}. Update existing import or create new?`;
  const diffHint =
    deltaSummary !== null && deltaSummary.totalNodes > 0
      ? `${String(deltaSummary.nodesReprocessed)} of ${String(deltaSummary.totalNodes)} nodes changed since last import`
      : null;
  const hasChangedSelection = selectedChangedCount > 0;
  const selectionHint =
    changedCount > 0
      ? keepExistingCount > 0
        ? `${String(keepExistingCount)} changed component${keepExistingCount === 1 ? "" : "s"} will keep existing code.`
        : "All changed components are currently selected."
      : "Select changed components to regenerate only part of the update.";

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
      <span
        data-testid="reimport-selection-hint"
        className="shrink-0 text-[10px] text-amber-100/70"
      >
        {selectionHint}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          data-testid="reimport-regenerate-changed"
          onClick={onRegenerateChanged}
          className="cursor-pointer rounded border border-amber-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-amber-400 transition hover:bg-amber-500/10"
        >
          Regenerate changed
        </button>
        <button
          type="button"
          data-testid="reimport-regenerate-selected"
          onClick={onRegenerateSelected}
          disabled={!hasChangedSelection}
          title={
            hasChangedSelection
              ? `Regenerate ${String(selectedChangedCount)} selected changed component${selectedChangedCount === 1 ? "" : "s"}`
              : "Select one or more changed components first"
          }
          className="cursor-pointer rounded border border-amber-500/20 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-amber-200 transition hover:bg-amber-500/10 disabled:cursor-default disabled:opacity-40"
        >
          Regenerate selected
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
