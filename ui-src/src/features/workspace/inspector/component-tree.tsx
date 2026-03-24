import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type UIEvent } from "react";
import { filterTree } from "./component-tree-utils";
import { TypeBadge } from "./type-badge-config";
import { DiagnosticBadge } from "./DiagnosticBadge";
import { getPrimaryDiagnosticCategory, type NodeDiagnosticsMap } from "./node-diagnostics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreeNode {
  id: string;
  name: string;
  type: string;
  children?: TreeNode[];
}

interface ComponentTreeProps {
  screens: TreeNode[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** Callback for explicit scope entry (double-click). */
  onEnterScope?: (nodeId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  diagnosticsMap?: NodeDiagnosticsMap;
}

interface VisibleTreeRow {
  node: TreeNode;
  depth: number;
  isScreen: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  siblingIndex: number;
  siblingCount: number;
}

interface TreeRowProps {
  row: VisibleTreeRow;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onEnterScope?: (nodeId: string) => void;
  onToggleExpand: (nodeId: string) => void;
  focusedId: string | null;
  onFocusNode: (nodeId: string) => void;
  diagnosticsMap?: NodeDiagnosticsMap;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 120;
const TREE_ROW_HEIGHT_PX = 24;
const TREE_OVERSCAN_ROWS = 8;
const DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX = 480;

// Type badge config is imported from ./type-badge-config

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function flattenVisibleRows(nodes: TreeNode[], expandedIds: Set<string>): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  const walk = (list: TreeNode[], depth: number): void => {
    const siblingCount = list.length;
    for (let siblingIndex = 0; siblingIndex < list.length; siblingIndex += 1) {
      const node = list[siblingIndex];
      if (!node) {
        continue;
      }

      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isExpanded = hasChildren && expandedIds.has(node.id);
      rows.push({
        node,
        depth,
        isScreen: depth === 0,
        hasChildren,
        isExpanded,
        siblingIndex,
        siblingCount
      });

      if (isExpanded && node.children) {
        walk(node.children, depth + 1);
      }
    }
  };

  walk(nodes, 0);
  return rows;
}

function findParentRow(rows: VisibleTreeRow[], childIndex: number): VisibleTreeRow | null {
  const child = rows[childIndex];
  if (!child || child.depth === 0) {
    return null;
  }

  for (let index = childIndex - 1; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (candidate && candidate.depth === child.depth - 1) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tree row
// ---------------------------------------------------------------------------

function TreeRow({
  row,
  selectedId,
  onSelect,
  onEnterScope,
  onToggleExpand,
  focusedId,
  onFocusNode,
  diagnosticsMap
}: TreeRowProps): JSX.Element {
  const isSelected = selectedId === row.node.id;
  const isFocused = focusedId === row.node.id;

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-setsize={row.siblingCount}
      aria-posinset={row.siblingIndex + 1}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      data-testid={row.isScreen ? `tree-screen-${row.node.id}` : `tree-node-${row.node.id}`}
      data-node-id={row.node.id}
      className={`flex h-7 cursor-pointer items-center gap-1.5 px-2 py-[3px] text-xs transition-colors select-none ${
        row.isScreen ? "font-semibold" : ""
      } ${
        isSelected
          ? "bg-[#000000] text-[#4eba87]"
          : "text-white/80 hover:bg-[#000000] hover:text-white"
      } ${isFocused ? "outline-2 -outline-offset-2 outline-[#4eba87]" : ""}`}
      onClick={() => {
        onSelect(row.node.id);
        onFocusNode(row.node.id);
      }}
      onDoubleClick={() => {
        if (onEnterScope) {
          onEnterScope(row.node.id);
        }
      }}
    >
      {row.depth > 0 ? (
        <span aria-hidden="true" className="flex h-full shrink-0 items-stretch">
          {Array.from({ length: row.depth }).map((_, index) => (
            <span key={index} className="w-4 border-l border-[#000000]/70" />
          ))}
        </span>
      ) : null}

      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={row.isExpanded ? "Collapse" : "Expand"}
          className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 transition ${
            isSelected ? "text-[#4eba87]/80" : "text-white/45 hover:text-[#4eba87]"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand(row.node.id);
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className={`h-3 w-3 transition-transform ${row.isExpanded ? "rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M6 4l4 4-4 4z" />
          </svg>
        </button>
      ) : (
        <span className="inline-block h-4 w-4 shrink-0" />
      )}

      {row.isScreen ? (
        <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-[#4eba87]" : "text-[#4eba87]/80"}`} fill="currentColor">
          <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h10V3H3z" />
        </svg>
      ) : (
        <TypeBadge type={row.node.type} />
      )}

      <span className="min-w-0 truncate">{row.node.name}</span>
      {diagnosticsMap ? (() => {
        const diagnostics = diagnosticsMap.get(row.node.id);
        if (!diagnostics || diagnostics.length === 0) return null;
        const primary = getPrimaryDiagnosticCategory(diagnostics);
        if (!primary) return null;
        return <DiagnosticBadge category={primary} />;
      })() : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComponentTree (public)
// ---------------------------------------------------------------------------

export function ComponentTree({
  screens,
  selectedId,
  onSelect,
  onEnterScope,
  collapsed,
  onToggleCollapsed,
  diagnosticsMap
}: ComponentTreeProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

  // Expand all screen-level nodes by default
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const screen of screens) {
      initial.add(screen.id);
    }
    return initial;
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [virtualWindow, setVirtualWindow] = useState({
    scrollTop: 0,
    viewportHeight: DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX
  });
  const treeViewportRef = useRef<HTMLDivElement>(null);

  // Filter screens based on debounced search query
  const filteredScreens = useMemo(() => {
    return filterTree(screens, debouncedSearchQuery);
  }, [screens, debouncedSearchQuery]);

  // When searching, auto-expand all nodes so matches are visible
  const effectiveExpandedIds = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return expandedIds;
    }
    const allIds = new Set<string>();
    const walk = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        allIds.add(node.id);
        if (node.children) {
          walk(node.children);
        }
      }
    };
    walk(filteredScreens);
    return allIds;
  }, [debouncedSearchQuery, expandedIds, filteredScreens]);

  // Flatten visible nodes for keyboard navigation and virtualization
  const flatRows = useMemo(() => {
    return flattenVisibleRows(filteredScreens, effectiveExpandedIds);
  }, [filteredScreens, effectiveExpandedIds]);
  const effectiveFocusedId = useMemo(() => {
    if (focusedId && flatRows.some((row) => row.node.id === focusedId)) {
      return focusedId;
    }
    return flatRows[0]?.node.id ?? null;
  }, [flatRows, focusedId]);
  const focusedIndex = useMemo(() => {
    if (!effectiveFocusedId) {
      return -1;
    }
    return flatRows.findIndex((row) => row.node.id === effectiveFocusedId);
  }, [effectiveFocusedId, flatRows]);

  const totalRowCount = flatRows.length;
  const viewportHeight = Math.max(virtualWindow.viewportHeight, DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX);
  const startIndex = Math.max(0, Math.floor(virtualWindow.scrollTop / TREE_ROW_HEIGHT_PX) - TREE_OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(viewportHeight / TREE_ROW_HEIGHT_PX) + TREE_OVERSCAN_ROWS * 2;
  const endIndex = Math.min(totalRowCount - 1, startIndex + visibleRowCount - 1);
  const virtualRows = totalRowCount > 0 ? flatRows.slice(startIndex, endIndex + 1) : [];
  const topSpacerHeight = totalRowCount > 0 ? startIndex * TREE_ROW_HEIGHT_PX : 0;
  const bottomSpacerHeight = totalRowCount > 0 ? Math.max(0, (totalRowCount - endIndex - 1) * TREE_ROW_HEIGHT_PX) : 0;

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!effectiveFocusedId) {
        return;
      }

      const currentIndex = flatRows.findIndex((row) => row.node.id === effectiveFocusedId);
      if (currentIndex < 0) {
        return;
      }

      const current = flatRows[currentIndex];
      if (!current) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = flatRows[currentIndex + 1];
        if (next) {
          setFocusedId(next.node.id);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = flatRows[currentIndex - 1];
        if (prev) {
          setFocusedId(prev.node.id);
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (current.hasChildren) {
          if (!current.isExpanded) {
            toggleExpand(current.node.id);
          } else {
            const firstChild = current.node.children?.[0];
            if (firstChild) {
              setFocusedId(firstChild.id);
            }
          }
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (current.hasChildren && current.isExpanded) {
          toggleExpand(current.node.id);
        } else {
          const parent = findParentRow(flatRows, currentIndex);
          if (parent) {
            setFocusedId(parent.node.id);
          }
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(current.node.id);
      }
    },
    [effectiveFocusedId, flatRows, onSelect, toggleExpand]
  );

  const handleTreeScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    setVirtualWindow({
      scrollTop: target.scrollTop,
      viewportHeight: target.clientHeight || DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX
    });
  }, []);

  useEffect(() => {
    const viewport = treeViewportRef.current;
    if (!viewport || focusedIndex < 0) {
      return;
    }

    const rowTop = focusedIndex * TREE_ROW_HEIGHT_PX;
    const rowBottom = rowTop + TREE_ROW_HEIGHT_PX;
    const viewTop = viewport.scrollTop;
    const viewBottom = viewTop + (viewport.clientHeight || DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX);

    if (rowTop < viewTop) {
      viewport.scrollTop = rowTop;
      return;
    }
    if (rowBottom > viewBottom) {
      viewport.scrollTop = rowBottom - (viewport.clientHeight || DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX);
    }
  }, [focusedIndex]);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col border-r border-[#000000] bg-[#333333]">
        <button
          type="button"
          data-testid="tree-expand-button"
          onClick={onToggleCollapsed}
          aria-label="Expand component tree"
          className="flex h-10 w-10 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-white/60 transition hover:text-[#4eba87]"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <path d="M6 4l4 4-4 4z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="component-tree"
      className="flex h-full min-h-0 w-full flex-col border-r border-[#000000] bg-[#333333] text-white"
    >
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#000000] px-4">
        <span className="text-[11px] font-bold tracking-[0.24em] text-white/70 uppercase">Components</span>
        <button
          type="button"
          data-testid="tree-collapse-button"
          onClick={onToggleCollapsed}
          aria-label="Collapse component tree"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-white/45 transition hover:text-[#4eba87]"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
            <path d="M10 4l-4 4 4 4z" />
          </svg>
        </button>
      </div>

      {/* Search input */}
      <div className="shrink-0 border-b border-[#000000] px-3 py-2">
        <input
          type="search"
          data-testid="tree-search-input"
          placeholder="Search components…"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          className="w-full rounded border border-[#000000] bg-[#1f1f1f] px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-[#4eba87] focus:outline-none"
          aria-label="Search component tree"
        />
      </div>

      {/* Tree */}
      <div
        ref={treeViewportRef}
        role="tree"
        aria-label="Component tree"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto py-2"
        data-testid="component-tree-viewport"
        onKeyDown={handleKeyDown}
        onScroll={handleTreeScroll}
        onFocus={(event) => {
          setVirtualWindow({
            scrollTop: event.currentTarget.scrollTop,
            viewportHeight: event.currentTarget.clientHeight || DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX
          });
          if (!focusedId && flatRows.length > 0 && flatRows[0]) {
            setFocusedId(flatRows[0].node.id);
          }
        }}
      >
        {filteredScreens.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-white/45">
            {debouncedSearchQuery.trim() ? "No matching components" : "No components"}
          </p>
        ) : (
          <div data-testid="component-tree-virtual-window">
            <div style={{ height: topSpacerHeight }} />
            {virtualRows.map((row) => (
              <TreeRow
                key={row.node.id}
                row={row}
                selectedId={selectedId}
                onSelect={onSelect}
                onEnterScope={onEnterScope}
                onToggleExpand={toggleExpand}
                focusedId={effectiveFocusedId}
                onFocusNode={setFocusedId}
                diagnosticsMap={diagnosticsMap}
              />
            ))}
            <div style={{ height: bottomSpacerHeight }} />
            <span data-testid="component-tree-total-count" className="sr-only">
              {String(totalRowCount)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
