/**
 * Segmented control for switching between scoped code viewing modes.
 *
 * Renders three mutually-exclusive options: Snippet, Focused file, Full file.
 * Uses the WAI-ARIA radiogroup pattern for correct accessibility semantics.
 * When the active node has no manifest mapping, only Full file is enabled and
 * a fallback hint is shown.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
 */
import { useCallback, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  getAvailableModes,
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
  const availableModes = getAvailableModes(isMapped);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = availableModes.indexOf(activeMode);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % availableModes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + availableModes.length) % availableModes.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = availableModes.length - 1;
    }

    if (nextIndex !== null) {
      const nextMode = availableModes[nextIndex];
      if (nextMode) {
        onModeChange(nextMode);
      }
    }
  }, [activeMode, availableModes, onModeChange]);

  return (
    <div
      data-testid="scoped-code-mode-selector"
      className="flex items-center gap-2"
    >
      <div
        role="radiogroup"
        aria-label="Code viewing mode"
        className="flex items-center gap-1 rounded-md border border-[#000000] bg-[#1b1b1b] p-1"
        onKeyDown={handleKeyDown}
      >
        {allModes.map((mode) => {
          const available = isModeAvailable(mode, isMapped);
          const isActive = activeMode === mode;

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              data-testid={`scoped-mode-${mode}`}
              disabled={!available}
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
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
