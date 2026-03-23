/**
 * Breadcrumb navigation showing the path from root screen to the selected
 * component tree node. Provides click navigation to ancestor nodes,
 * overflow handling with an ellipsis dropdown for long paths, and
 * cross-file drilldown context with a return-to-parent-file action.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/435
 * @see https://github.com/oscharko-dev/workspace-dev/issues/446
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { BreadcrumbSegment } from "./component-tree-utils";
import { TypeBadge } from "./type-badge-config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum visible segments before collapsing middle items. */
const MAX_VISIBLE_SEGMENTS = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BreadcrumbProps {
  /** Ordered path segments from root screen to selected node. */
  path: BreadcrumbSegment[];
  /** Callback when the user clicks a segment to navigate. */
  onSelect: (nodeId: string) => void;
  /** Whether a hierarchical drilldown scope is currently active. */
  hasActiveScope?: boolean;
  /** Callback to enter scope on a node (explicit drilldown). */
  onEnterScope?: (nodeId: string) => void;
  /** Callback to move up exactly one scope level. */
  onExitScope?: () => void;
  /** The parent file path when viewing a cross-file extracted component (null when none). */
  parentFile?: string | null;
  /** Callback to return to the parent file context without unwinding scope. */
  onReturnToParentFile?: () => void;
}

function ScreenIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3 text-[#4eba87]">
      <path d="M2.75 3A1.75 1.75 0 0 0 1 4.75v5.5C1 11.216 1.784 12 2.75 12h3.5v1H4.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5H9.75v-1h3.5A1.75 1.75 0 0 0 15 10.25v-5.5A1.75 1.75 0 0 0 13.25 3h-10.5Zm-.25 1.75c0-.138.112-.25.25-.25h10.5c.138 0 .25.112.25.25v5.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25v-5.5Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Breadcrumb({ path, onSelect, hasActiveScope, onEnterScope, onExitScope, parentFile, onReturnToParentFile }: BreadcrumbProps): JSX.Element | null {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef(0);
  const segmentRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Hide when path is empty
  if (path.length === 0) {
    return null;
  }

  // Determine visible vs collapsed segments
  const needsOverflow = path.length > MAX_VISIBLE_SEGMENTS;
  const visibleSegments = useMemo(() => {
    if (!needsOverflow) return path;
    // Show first segment, "…", and the last (MAX_VISIBLE_SEGMENTS - 2) segments
    const tail = path.slice(-(MAX_VISIBLE_SEGMENTS - 1));
    return [path[0]!, ...tail];
  }, [needsOverflow, path]);

  const collapsedSegments = useMemo(() => {
    if (!needsOverflow) return [];
    return path.slice(1, -(MAX_VISIBLE_SEGMENTS - 1));
  }, [needsOverflow, path]);

  // Close overflow dropdown on outside click
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (event: MouseEvent): void => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); };
  }, [overflowOpen]);

  const handleSegmentClick = useCallback(
    (nodeId: string) => {
      setOverflowOpen(false);
      onSelect(nodeId);
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const totalVisible = visibleSegments.length + (needsOverflow ? 1 : 0);

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = Math.min(focusedIndexRef.current + 1, totalVisible - 1);
        focusedIndexRef.current = next;
        segmentRefs.current.get(next)?.focus();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const prev = Math.max(focusedIndexRef.current - 1, 0);
        focusedIndexRef.current = prev;
        segmentRefs.current.get(prev)?.focus();
      }
    },
    [needsOverflow, visibleSegments.length]
  );

  // Builds a ref index accounting for the overflow button position
  let refIndex = 0;

  return (
    <nav
      aria-label="Component path"
      data-testid="inspector-breadcrumb"
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[#000000] bg-[#1f1f1f] px-3 py-1.5"
      onKeyDown={handleKeyDown}
    >
      {/* Scope indicator badge */}
      {hasActiveScope ? (
        <span
          data-testid="breadcrumb-scope-badge"
          className="mr-1 inline-flex items-center rounded-full border border-[#4eba87]/30 bg-[#4eba87]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4eba87]"
        >
          Scoped
        </span>
      ) : null}

      {/* Cross-file context indicator */}
      {parentFile ? (
        <span
          data-testid="breadcrumb-cross-file-indicator"
          className="mr-1 inline-flex items-center gap-1 rounded-full border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200"
          title={`Viewing extracted component — parent file: ${parentFile}`}
        >
          <span aria-hidden="true">↗</span>
          <span className="max-w-[100px] truncate">{parentFile.split("/").pop() ?? parentFile}</span>
        </span>
      ) : null}

      {visibleSegments.map((segment, i) => {
        const isLast = !needsOverflow
          ? i === visibleSegments.length - 1
          : i === visibleSegments.length - 1;
        const isFirst = i === 0;
        const currentRefIndex = refIndex;
        refIndex += 1;

        // Insert overflow button after the first segment
        const showOverflowBefore = needsOverflow && i === 1;

        return (
          <span key={segment.id} className="flex items-center gap-0.5">
            {/* Separator before this segment (not before the first) */}
            {!isFirst && !showOverflowBefore ? (
              <span className="mx-0.5 select-none text-[10px] text-white/25" aria-hidden="true">/</span>
            ) : null}

            {/* Overflow button */}
            {showOverflowBefore ? (
              <>
                <span className="mx-0.5 select-none text-[10px] text-white/25" aria-hidden="true">/</span>
                <div className="relative" ref={overflowRef}>
                  <button
                    type="button"
                    data-testid="breadcrumb-overflow-toggle"
                    ref={(el) => {
                      const overflowRefIdx = currentRefIndex;
                      if (el) segmentRefs.current.set(overflowRefIdx, el);
                      else segmentRefs.current.delete(overflowRefIdx);
                      // Shift all subsequent indices
                      refIndex = currentRefIndex + 1;
                    }}
                    onClick={() => { setOverflowOpen((v) => !v); }}
                    className="cursor-pointer rounded border border-transparent px-1 py-0.5 text-[11px] font-semibold text-white/55 transition hover:border-white/10 hover:bg-[#000000] hover:text-white"
                    aria-expanded={overflowOpen}
                    aria-haspopup="menu"
                    title={`${String(collapsedSegments.length)} hidden segments`}
                  >
                    …
                  </button>
                  {overflowOpen ? (
                    <div
                      data-testid="breadcrumb-overflow-menu"
                      role="menu"
                      className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-[#000000] bg-[#1b1b1b] py-1 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
                    >
                      {collapsedSegments.map((seg) => (
                        <button
                          key={seg.id}
                          type="button"
                          role="menuitem"
                          data-testid={`breadcrumb-overflow-item-${seg.id}`}
                          onClick={() => { handleSegmentClick(seg.id); }}
                          className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left text-xs text-white/75 transition hover:bg-[#000000] hover:text-white"
                        >
                          <TypeBadge type={seg.type} />
                          <span className="truncate">{seg.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="mx-0.5 select-none text-[10px] text-white/25" aria-hidden="true">/</span>
              </>
            ) : null}

            {/* Segment button */}
            <button
              type="button"
              ref={(el) => {
                // Need correct index — after overflow if present
                const segRefIdx = needsOverflow && i >= 1 ? currentRefIndex + 1 : currentRefIndex;
                if (el) segmentRefs.current.set(segRefIdx, el);
                else segmentRefs.current.delete(segRefIdx);
              }}
              data-testid={`breadcrumb-segment-${segment.id}`}
              onClick={() => { handleSegmentClick(segment.id); }}
              aria-current={isLast ? "location" : undefined}
              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition hover:bg-[#000000] ${
                isLast
                  ? "border border-[#4eba87]/25 bg-[#000000] font-semibold text-white"
                  : "border border-transparent text-white/65 hover:text-white"
              }`}
            >
              {segment.type !== "screen" ? (
                <TypeBadge type={segment.type} />
              ) : (
                <ScreenIcon />
              )}
              <span className="max-w-[120px] truncate">{segment.name}</span>
            </button>
          </span>
        );
      })}

      {/* Scope action buttons */}
      <span className="ml-auto flex items-center gap-1">
        {/* Enter scope button — shown for the last (selected) segment when not already scoped to it */}
        {onEnterScope && path.length > 0 ? (
          <button
            type="button"
            data-testid="breadcrumb-enter-scope"
            onClick={() => {
              const last = path[path.length - 1];
              if (last) onEnterScope(last.id);
            }}
            className="cursor-pointer rounded border border-[#4eba87]/30 bg-[#4eba87]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4eba87] transition hover:bg-[#4eba87]/15"
            title="Enter scope (drill down into this component)"
          >
            Enter scope
          </button>
        ) : null}

        {/* Level-up button — shown when a scope is active */}
        {hasActiveScope && onExitScope ? (
          <button
            type="button"
            data-testid="breadcrumb-exit-scope"
            onClick={onExitScope}
            className="cursor-pointer rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70 transition hover:bg-[#000000] hover:text-white"
            title="Level up (go back up one scope level)"
            aria-label="Level up one scope level"
          >
            Level up
          </button>
        ) : null}

        {/* Return to parent file — shown during cross-file drilldown */}
        {parentFile && onReturnToParentFile ? (
          <button
            type="button"
            data-testid="breadcrumb-return-parent-file"
            onClick={onReturnToParentFile}
            className="cursor-pointer rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200 transition hover:bg-sky-400/15"
            title={`Return to parent file: ${parentFile}`}
            aria-label={`Return to parent file ${parentFile}`}
          >
            ← Parent file
          </button>
        ) : null}
      </span>
    </nav>
  );
}
