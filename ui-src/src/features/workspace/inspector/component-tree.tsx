import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type UIEvent } from "react";
import { filterTree } from "./component-tree-utils";

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
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
  onToggleExpand: (nodeId: string) => void;
  focusedId: string | null;
  onFocusNode: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 120;
const TREE_ROW_HEIGHT_PX = 24;
const TREE_OVERSCAN_ROWS = 8;
const DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX = 480;

// ---------------------------------------------------------------------------
// Element type badge config
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, { abbr: string; color: string }> = {
  text: { abbr: "T", color: "bg-blue-100 text-blue-700" },
  button: { abbr: "B", color: "bg-emerald-100 text-emerald-700" },
  input: { abbr: "In", color: "bg-amber-100 text-amber-700" },
  image: { abbr: "Im", color: "bg-violet-100 text-violet-700" },
  container: { abbr: "C", color: "bg-slate-100 text-slate-600" },
  card: { abbr: "Cd", color: "bg-rose-100 text-rose-700" },
  appbar: { abbr: "Ab", color: "bg-indigo-100 text-indigo-700" },
  grid: { abbr: "G", color: "bg-cyan-100 text-cyan-700" },
  stack: { abbr: "S", color: "bg-teal-100 text-teal-700" },
  list: { abbr: "L", color: "bg-orange-100 text-orange-700" },
  table: { abbr: "Tb", color: "bg-pink-100 text-pink-700" },
  chip: { abbr: "Ch", color: "bg-fuchsia-100 text-fuchsia-700" },
  avatar: { abbr: "Av", color: "bg-lime-100 text-lime-700" },
  badge: { abbr: "Bg", color: "bg-yellow-100 text-yellow-700" },
  divider: { abbr: "D", color: "bg-gray-100 text-gray-500" },
  navigation: { abbr: "N", color: "bg-sky-100 text-sky-700" },
  dialog: { abbr: "Dl", color: "bg-purple-100 text-purple-700" },
  drawer: { abbr: "Dr", color: "bg-indigo-100 text-indigo-600" },
  tab: { abbr: "Tb", color: "bg-emerald-100 text-emerald-600" },
  select: { abbr: "Se", color: "bg-amber-100 text-amber-600" },
  switch: { abbr: "Sw", color: "bg-teal-100 text-teal-600" },
  checkbox: { abbr: "Cx", color: "bg-blue-100 text-blue-600" },
  radio: { abbr: "Ra", color: "bg-violet-100 text-violet-600" },
  slider: { abbr: "Sl", color: "bg-cyan-100 text-cyan-600" },
  rating: { abbr: "Rt", color: "bg-yellow-100 text-yellow-600" },
  tooltip: { abbr: "Tt", color: "bg-slate-100 text-slate-700" },
  snackbar: { abbr: "Sn", color: "bg-orange-100 text-orange-600" },
  stepper: { abbr: "St", color: "bg-indigo-100 text-indigo-600" },
  progress: { abbr: "P", color: "bg-blue-100 text-blue-600" },
  skeleton: { abbr: "Sk", color: "bg-gray-100 text-gray-500" },
  breadcrumbs: { abbr: "Bc", color: "bg-slate-100 text-slate-600" },
  paper: { abbr: "Pa", color: "bg-stone-100 text-stone-600" }
};

function TypeBadge({ type }: { type: string }): JSX.Element {
  const config = TYPE_LABELS[type];
  const abbr = config?.abbr ?? type.slice(0, 2).toUpperCase();
  const color = config?.color ?? "bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-0.5 text-[9px] font-bold leading-none ${color}`}
      title={type}
    >
      {abbr}
    </span>
  );
}

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

// ---------------------------------------------------------------------------
// Tree row
// ---------------------------------------------------------------------------

function TreeRow({
  row,
  selectedId,
  onSelect,
  onToggleExpand,
  focusedId,
  onFocusNode
}: TreeRowProps): JSX.Element {
  const isSelected = selectedId === row.node.id;
  const isFocused = focusedId === row.node.id;
  const paddingLeft = 8 + row.depth * 16;

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
      className={`flex h-6 cursor-pointer items-center gap-1 py-[3px] pr-2 text-xs transition-colors select-none ${
        row.isScreen ? "font-bold" : ""
      } ${
        isSelected
          ? "bg-emerald-50 text-emerald-900"
          : row.isScreen
            ? "text-slate-800 hover:bg-slate-50"
            : "text-slate-700 hover:bg-slate-50"
      } ${isFocused ? "outline-2 -outline-offset-2 outline-emerald-400" : ""}`}
      style={{ paddingLeft }}
      onClick={() => {
        onSelect(row.node.id);
        onFocusNode(row.node.id);
      }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={row.isExpanded ? "Collapse" : "Expand"}
          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700"
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
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="currentColor">
          <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h10V3H3z" />
        </svg>
      ) : (
        <TypeBadge type={row.node.type ?? "container"} />
      )}

      <span className="min-w-0 truncate">{row.node.name}</span>
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
  collapsed,
  onToggleCollapsed
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
      <div className="flex h-full flex-col border-r border-slate-200 bg-slate-50">
        <button
          type="button"
          data-testid="tree-expand-button"
          onClick={onToggleCollapsed}
          aria-label="Expand component tree"
          className="flex h-8 w-8 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-slate-500 transition hover:text-slate-800"
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
      className="flex h-full min-h-0 w-full flex-col border-r border-slate-200 bg-slate-50"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-2 py-1.5">
        <span className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">Components</span>
        <button
          type="button"
          data-testid="tree-collapse-button"
          onClick={onToggleCollapsed}
          aria-label="Collapse component tree"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
            <path d="M10 4l-4 4 4 4z" />
          </svg>
        </button>
      </div>

      {/* Search input */}
      <div className="shrink-0 border-b border-slate-200 px-2 py-1.5">
        <input
          type="search"
          data-testid="tree-search-input"
          placeholder="Search components…"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
          aria-label="Search component tree"
        />
      </div>

      {/* Tree */}
      <div
        ref={treeViewportRef}
        role="tree"
        aria-label="Component tree"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto py-1"
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
          <p className="px-2 py-4 text-center text-xs text-slate-400">
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
                onToggleExpand={toggleExpand}
                focusedId={effectiveFocusedId}
                onFocusNode={setFocusedId}
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
