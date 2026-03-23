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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScopedCodeModeSelector({
  activeMode,
  onModeChange,
  isMapped
}: ScopedCodeModeSelectorProps): JSX.Element {
  const allModes: ScopedCodeMode[] = ["snippet", "focused", "full"];

  return (
    <div
      data-testid="scoped-code-mode-selector"
      className="flex items-center gap-2"
      role="group"
      aria-label="Code viewing mode"
    >
      <div className="flex items-center gap-1 rounded-md border border-[#000000] bg-[#1b1b1b] p-1">
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
              className={`shrink-0 cursor-pointer rounded border px-2 py-0.5 text-[10px] font-semibold transition disabled:cursor-default disabled:opacity-35 ${
                isActive
                  ? "border-[#4eba87] bg-[#4eba87]/15 text-[#4eba87]"
                  : "border-transparent bg-transparent text-white/65 hover:border-white/10 hover:bg-[#000000] hover:text-white"
              }`}
            >
              {modeLabel(mode)}
            </button>
          );
        })}
      </div>

      {!isMapped ? (
        <span
          data-testid="scoped-mode-unmapped-hint"
          className="text-[10px] text-amber-300"
        >
          No mapping — showing full file
        </span>
      ) : null}
    </div>
  );
}
