import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
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

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  focusedId: string | null;
  onFocusNode: (nodeId: string) => void;
  flatIndex: number;
}

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
// Flatten tree for keyboard navigation
// ---------------------------------------------------------------------------

function flattenVisible(nodes: TreeNode[], expandedIds: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      result.push(node);
      if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Tree node row
// ---------------------------------------------------------------------------

function TreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  focusedId,
  onFocusNode,
  flatIndex
}: TreeNodeRowProps): JSX.Element {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isFocused = focusedId === node.id;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isFocused]);

  const paddingLeft = 8 + depth * 16;

  return (
    <>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={depth + 1}
        aria-setsize={1}
        aria-posinset={flatIndex + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={isFocused ? 0 : -1}
        data-testid={`tree-node-${node.id}`}
        data-node-id={node.id}
        className={`flex cursor-pointer items-center gap-1 py-[3px] pr-2 text-xs transition-colors select-none ${
          isSelected
            ? "bg-emerald-50 font-semibold text-emerald-900"
            : "text-slate-700 hover:bg-slate-50"
        } ${isFocused ? "outline-2 -outline-offset-2 outline-emerald-400" : ""}`}
        style={{ paddingLeft }}
        onClick={() => {
          onSelect(node.id);
          onFocusNode(node.id);
        }}
      >
        {/* Chevron */}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
          >
            <svg
              viewBox="0 0 16 16"
              className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4z" />
            </svg>
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}

        <TypeBadge type={node.type ?? "container"} />

        <span className="min-w-0 truncate">{node.name}</span>
      </div>

      {/* Render children recursively if expanded */}
      {hasChildren && isExpanded
        ? node.children!.map((child, i) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              focusedId={focusedId}
              onFocusNode={onFocusNode}
              flatIndex={flatIndex + i + 1}
            />
          ))
        : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen-level tree entry (top level)
// ---------------------------------------------------------------------------

function ScreenTreeNode({
  screen,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  focusedId,
  onFocusNode
}: {
  screen: TreeNode;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  focusedId: string | null;
  onFocusNode: (nodeId: string) => void;
}): JSX.Element {
  const isExpanded = expandedIds.has(screen.id);
  const isSelected = selectedId === screen.id;
  const isFocused = focusedId === screen.id;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isFocused]);

  const hasChildren = Boolean(screen.children && screen.children.length > 0);

  return (
    <>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={isFocused ? 0 : -1}
        data-testid={`tree-screen-${screen.id}`}
        data-node-id={screen.id}
        className={`flex cursor-pointer items-center gap-1.5 py-1 pr-2 pl-2 text-xs font-bold transition-colors select-none ${
          isSelected
            ? "bg-emerald-50 text-emerald-900"
            : "text-slate-800 hover:bg-slate-50"
        } ${isFocused ? "outline-2 -outline-offset-2 outline-emerald-400" : ""}`}
        onClick={() => {
          onSelect(screen.id);
          onFocusNode(screen.id);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-slate-400 transition hover:text-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(screen.id);
            }}
          >
            <svg
              viewBox="0 0 16 16"
              className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4z" />
            </svg>
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}

        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-500" fill="currentColor">
          <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h10V3H3z" />
        </svg>

        <span className="min-w-0 truncate">{screen.name}</span>
      </div>

      {hasChildren && isExpanded
        ? screen.children!.map((child, i) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              focusedId={focusedId}
              onFocusNode={onFocusNode}
              flatIndex={i}
            />
          ))
        : null}
    </>
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

  // Expand all screen-level nodes by default
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const s of screens) {
      initial.add(s.id);
    }
    return initial;
  });

  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Filter screens based on search query
  const filteredScreens = useMemo(
    () => filterTree(screens, searchQuery),
    [screens, searchQuery]
  );

  // When searching, auto-expand all nodes so matches are visible
  const effectiveExpandedIds = useMemo(() => {
    if (!searchQuery.trim()) {
      return expandedIds;
    }
    // Collect all node ids from filteredScreens
    const allIds = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        allIds.add(n.id);
        if (n.children) {
          walk(n.children);
        }
      }
    };
    walk(filteredScreens);
    return allIds;
  }, [searchQuery, expandedIds, filteredScreens]);

  // Flatten visible nodes for keyboard navigation
  const flatNodes = useMemo(
    () => flattenVisible(filteredScreens, effectiveExpandedIds),
    [filteredScreens, effectiveExpandedIds]
  );

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
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!focusedId) {
        if (flatNodes.length > 0 && flatNodes[0]) {
          setFocusedId(flatNodes[0].id);
        }
        return;
      }

      const currentIndex = flatNodes.findIndex((n) => n.id === focusedId);
      if (currentIndex < 0) {
        return;
      }

      const current = flatNodes[currentIndex]!;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = flatNodes[currentIndex + 1];
        if (next) {
          setFocusedId(next.id);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = flatNodes[currentIndex - 1];
        if (prev) {
          setFocusedId(prev.id);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (current.children && current.children.length > 0) {
          if (!effectiveExpandedIds.has(current.id)) {
            toggleExpand(current.id);
          } else {
            // Move focus to first child
            const firstChild = current.children[0];
            if (firstChild) {
              setFocusedId(firstChild.id);
            }
          }
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (effectiveExpandedIds.has(current.id) && current.children && current.children.length > 0) {
          toggleExpand(current.id);
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(current.id);
      }
    },
    [focusedId, flatNodes, effectiveExpandedIds, toggleExpand, onSelect]
  );

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
      className="flex h-full min-h-0 w-56 flex-col border-r border-slate-200 bg-slate-50 xl:w-64"
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
          onChange={(e) => { setSearchQuery(e.target.value); }}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
          aria-label="Search component tree"
        />
      </div>

      {/* Tree */}
      <div
        role="tree"
        aria-label="Component tree"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (!focusedId && flatNodes.length > 0 && flatNodes[0]) {
            setFocusedId(flatNodes[0].id);
          }
        }}
      >
        {filteredScreens.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-slate-400">
            {searchQuery.trim() ? "No matching components" : "No components"}
          </p>
        ) : (
          filteredScreens.map((screen) => (
            <ScreenTreeNode
              key={screen.id}
              screen={screen}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={effectiveExpandedIds}
              onToggleExpand={toggleExpand}
              focusedId={focusedId}
              onFocusNode={setFocusedId}
            />
          ))
        )}
      </div>
    </div>
  );
}
