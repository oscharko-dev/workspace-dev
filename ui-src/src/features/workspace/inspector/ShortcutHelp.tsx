/**
 * Keyboard shortcut discovery overlay for the Inspector.
 *
 * Shows a categorised reference card of all available keyboard interactions
 * across the Inspector's sub-components. Triggered by pressing `?` or
 * clicking the toolbar button. Dismissed by `Escape` or repeating `?`.
 *
 * Features:
 * - Static shortcut data — no dynamic detection needed
 * - Platform-aware modifier labels (⌘ on Mac, Ctrl elsewhere)
 * - Focus trap while open (accessibility)
 * - Dark/light theme following system preference
 * - Does not capture events when a text input is focused
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/436
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { getPreferredTheme } from "../../../lib/shiki-shared";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const platform = uaDataPlatform ?? navigator.platform;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

const OVERLAY_QUICK_SET_KEYS = ["0", "5", "1"] as const;

function modifierLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

// ---------------------------------------------------------------------------
// Shortcut data
// ---------------------------------------------------------------------------

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  entries: ShortcutEntry[];
}

function buildShortcutData(): ShortcutCategory[] {
  const mod = modifierLabel();

  return [
    {
      title: "Component Tree",
      entries: [
        { keys: ["↑", "↓"], description: "Navigate between nodes" },
        { keys: ["←"], description: "Collapse node / move to parent" },
        { keys: ["→"], description: "Expand node / move to child" },
        { keys: ["Space", "Enter"], description: "Select focused node" }
      ]
    },
    {
      title: "Code Viewer",
      entries: [
        { keys: [`${mod}+F`], description: "Open find in file" },
        { keys: ["Enter"], description: "Next match" },
        { keys: ["Shift+Enter"], description: "Previous match" },
        { keys: [":N"], description: "Jump to line N (e.g. :42)" }
      ]
    },
    {
      title: "Pane Layout",
      entries: [
        { keys: ["←", "→"], description: "Resize pane (24 px)" },
        { keys: ["Shift+←", "Shift+→"], description: "Resize pane (72 px)" },
        { keys: ["Home"], description: "Collapse pane to minimum" },
        { keys: ["End"], description: "Expand pane to maximum" }
      ]
    },
    {
      title: "Edit History",
      entries: [
        { keys: [`${mod}+Z`], description: "Undo edit action" },
        { keys: [`${mod}+Shift+Z`], description: "Redo edit action" },
        { keys: [`${mod}+Shift+S`], description: "Create draft snapshot" }
      ]
    },
    {
      title: "Inspector Tool",
      entries: [
        { keys: ["?"], description: "Toggle this shortcut help" },
        {
          keys: [...OVERLAY_QUICK_SET_KEYS],
          description: `Set overlay opacity to ${OVERLAY_QUICK_SET_KEYS
            .map((value) => `${value === "1" ? 100 : Number(value) * 10}%`)
            .join(", ")
            .replace(/, ([^,]*)$/, ", or $1")}`
        }
      ]
    }
  ];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps): JSX.Element | null {
  const [currentTheme, setCurrentTheme] = useState(getPreferredTheme);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const isDark = currentTheme === "github-dark";
  const categories = useMemo(() => buildShortcutData(), []);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Theme listener
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => { setCurrentTheme(getPreferredTheme()); };
    mq.addEventListener("change", handler);
    return () => { mq.removeEventListener("change", handler); };
  }, []);

  // Focus management: save previous focus and restore on close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeButtonRef.current?.focus();
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Escape to close
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }

      // Tab trap — keep focus within the overlay
      if (event.key === "Tab" && overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  if (!open) return null;

  const bgOverlay = isDark ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.35)";
  const panelBg = isDark ? "#161b22" : "#ffffff";
  const panelBorder = isDark ? "#30363d" : "#d0d7de";
  const textPrimary = isDark ? "#c9d1d9" : "#24292f";
  const textSecondary = isDark ? "#8b949e" : "#57606a";
  const categoryBg = isDark ? "#0d1117" : "#f6f8fa";
  const kbdBg = isDark ? "#21262d" : "#f0f0f0";
  const kbdBorder = isDark ? "#30363d" : "#d0d7de";
  const kbdText = isDark ? "#e6edf3" : "#24292f";

  return (
    <div
      data-testid="shortcut-help-overlay"
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: bgOverlay }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        data-testid="shortcut-help-panel"
        className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border shadow-2xl"
        style={{
          backgroundColor: panelBg,
          borderColor: panelBorder
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3"
          style={{
            backgroundColor: panelBg,
            borderColor: panelBorder
          }}
        >
          <h3
            className="m-0 text-base font-bold"
            style={{ color: textPrimary }}
          >
            Keyboard Shortcuts
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="shortcut-help-close"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-lg leading-none transition hover:opacity-70"
            style={{ color: textSecondary }}
            aria-label="Close keyboard shortcuts"
          >
            ✕
          </button>
        </div>

        {/* Categories */}
        <div className="px-5 py-4">
          {categories.map((category) => (
            <div key={category.title} className="mb-4 last:mb-0">
              <h4
                data-testid={`shortcut-category-${category.title.toLowerCase().replace(/\s+/g, "-")}`}
                className="m-0 mb-2 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: categoryBg,
                  color: textSecondary
                }}
              >
                {category.title}
              </h4>
              <div className="flex flex-col gap-1.5">
                {category.entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 px-2 py-0.5"
                  >
                    <span
                      className="text-xs"
                      style={{ color: textPrimary }}
                    >
                      {entry.description}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {entry.keys.map((key, ki) => (
                        <kbd
                          key={ki}
                          className="inline-flex min-w-[1.5rem] items-center justify-center rounded border px-1.5 py-0.5 text-[11px] font-mono font-semibold leading-none"
                          style={{
                            backgroundColor: kbdBg,
                            borderColor: kbdBorder,
                            color: kbdText,
                            boxShadow: isDark
                              ? "0 1px 0 rgba(255,255,255,0.04)"
                              : "0 1px 0 rgba(0,0,0,0.08)"
                          }}
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="border-t px-5 py-2 text-center text-[10px]"
          style={{
            borderColor: panelBorder,
            color: textSecondary
          }}
        >
          Press <kbd
            className="mx-0.5 inline-flex items-center rounded border px-1 py-0 text-[10px] font-mono font-semibold"
            style={{
              backgroundColor: kbdBg,
              borderColor: kbdBorder,
              color: kbdText
            }}
          >?</kbd> or <kbd
            className="mx-0.5 inline-flex items-center rounded border px-1 py-0 text-[10px] font-mono font-semibold"
            style={{
              backgroundColor: kbdBg,
              borderColor: kbdBorder,
              color: kbdText
            }}
          >Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
