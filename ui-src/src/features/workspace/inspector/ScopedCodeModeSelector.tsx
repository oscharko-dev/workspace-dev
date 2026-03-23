/**
 * Segmented control for switching between scoped code viewing modes.
 *
 * Renders three mutually-exclusive buttons: Snippet, Focused file, Full file.
 * When the active node has no manifest mapping, only Full file is enabled and
 * a fallback hint is shown.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
 */
import { type JSX } from "react";
import {
  isModeAvailable,
  modeLabel,
  type ScopedCodeMode
} from "./scoped-code-ranges";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScopedCodeModeSelectorProps {
  /** Currently active mode. */
  activeMode: ScopedCodeMode;
  /** Called when the user selects a different mode. */
  onModeChange: (mode: ScopedCodeMode) => void;
  /** Whether the active node has a manifest mapping. */
  isMapped: boolean;
  /** Whether the control is rendered inside the dark IDE shell. */
  ideMode?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScopedCodeModeSelector({
  activeMode,
  onModeChange,
  isMapped,
  ideMode = false
}: ScopedCodeModeSelectorProps): JSX.Element {
  const allModes: ScopedCodeMode[] = ["snippet", "focused", "full"];

  return (
    <div
      data-testid="scoped-code-mode-selector"
      className="flex items-center gap-1"
      role="group"
      aria-label="Code viewing mode"
    >
      {allModes.map((mode) => {
        const available = isModeAvailable(mode, isMapped);
        const isActive = activeMode === mode;

        return (
          <button
            key={mode}
            type="button"
            data-testid={`scoped-mode-${mode}`}
            disabled={!available}
            aria-pressed={isActive}
            onClick={() => {
              if (available && !isActive) {
                onModeChange(mode);
              }
            }}
            className="shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-40"
            style={{
              borderColor: isActive ? (ideMode ? "#10b981" : "#6366f1") : (ideMode ? "#3f3f46" : undefined),
              backgroundColor: isActive ? (ideMode ? "rgba(16, 185, 129, 0.12)" : "#eef2ff") : (ideMode ? "#252526" : undefined),
              color: isActive ? (ideMode ? "#d1fae5" : "#4338ca") : (ideMode ? "#d4d4d8" : undefined)
            }}
          >
            {modeLabel(mode)}
          </button>
        );
      })}

      {!isMapped ? (
        <span
          data-testid="scoped-mode-unmapped-hint"
          className="ml-1 text-[10px]"
          style={{ color: ideMode ? "#facc15" : "#b45309" }}
        >
          No mapping — showing full file
        </span>
      ) : null}
    </div>
  );
}
