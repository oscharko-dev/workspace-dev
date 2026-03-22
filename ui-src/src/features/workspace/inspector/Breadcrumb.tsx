/**
 * Breadcrumb navigation showing the path from root screen to the selected
 * component tree node. Provides click navigation to ancestor nodes and
 * overflow handling with an ellipsis dropdown for long paths.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/435
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Breadcrumb({ path, onSelect }: BreadcrumbProps): JSX.Element | null {
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
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-slate-50/80 px-3 py-1.5"
      onKeyDown={handleKeyDown}
    >
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
              <span className="mx-0.5 text-[10px] text-slate-400 select-none" aria-hidden="true">/</span>
            ) : null}

            {/* Overflow button */}
            {showOverflowBefore ? (
              <>
                <span className="mx-0.5 text-[10px] text-slate-400 select-none" aria-hidden="true">/</span>
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
                    className="cursor-pointer rounded px-1 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
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
                      className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      {collapsedSegments.map((seg) => (
                        <button
                          key={seg.id}
                          type="button"
                          role="menuitem"
                          data-testid={`breadcrumb-overflow-item-${seg.id}`}
                          onClick={() => { handleSegmentClick(seg.id); }}
                          className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left text-xs text-slate-700 transition hover:bg-slate-100"
                        >
                          <TypeBadge type={seg.type} />
                          <span className="truncate">{seg.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="mx-0.5 text-[10px] text-slate-400 select-none" aria-hidden="true">/</span>
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
              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition hover:bg-slate-200 ${
                isLast
                  ? "font-semibold text-slate-900"
                  : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {segment.type !== "screen" ? (
                <TypeBadge type={segment.type} />
              ) : (
                <span className="text-[10px]" aria-hidden="true">🖥</span>
              )}
              <span className="max-w-[120px] truncate">{segment.name}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
