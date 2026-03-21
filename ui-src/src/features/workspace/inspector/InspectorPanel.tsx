import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import { PreviewPane } from "./PreviewPane";
import { CodePane, type HighlightRange } from "./CodePane";
import { ComponentTree, type TreeNode } from "./component-tree";
import {
  DEFAULT_INSPECTOR_PANE_RATIOS,
  MIN_CODE_WIDTH_PX,
  MIN_PREVIEW_WIDTH_PX,
  getContainerWidthPx,
  loadInspectorPaneRatios,
  resizePreviewCodePanes,
  resizeTreePreviewPane,
  saveInspectorPaneRatios,
  toInspectorLayoutStorageKey,
  type InspectorPaneRatios
} from "./layout-state";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

interface FileEntry {
  path: string;
  sizeBytes: number;
}

interface FilesPayload {
  jobId: string;
  files: FileEntry[];
}

interface ComponentManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

interface ComponentManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
  components: ComponentManifestEntry[];
}

interface ComponentManifestPayload {
  jobId: string;
  screens: ComponentManifestScreen[];
}

interface DesignIrElementNode {
  id: string;
  name: string;
  type: string;
  children?: DesignIrElementNode[];
}

interface DesignIrScreen {
  id: string;
  name: string;
  generatedFile?: string;
  children: DesignIrElementNode[];
}

interface DesignIrPayload {
  jobId: string;
  screens: DesignIrScreen[];
}

interface InspectorPanelProps {
  jobId: string;
  previewUrl: string;
}

type PaneSeparator = "tree-preview" | "preview-code";

const DESKTOP_LAYOUT_MEDIA_QUERY = "(min-width: 1280px)";
const KEYBOARD_STEP_PX = 24;
const KEYBOARD_STEP_LARGE_PX = 72;
const KEYBOARD_EXTREME_DELTA_PX = 100_000;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isFilesPayload(value: unknown): value is FilesPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return typeof rec.jobId === "string" && Array.isArray(rec.files);
}

function isDesignIrPayload(value: unknown): value is DesignIrPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return typeof rec.jobId === "string" && Array.isArray(rec.screens);
}

// ---------------------------------------------------------------------------
// Helpers: convert IR screens to TreeNode[]
// ---------------------------------------------------------------------------

function irElementToTreeNode(el: DesignIrElementNode): TreeNode {
  const node: TreeNode = {
    id: el.id,
    name: el.name,
    type: el.type
  };
  if (el.children && el.children.length > 0) {
    node.children = el.children.map(irElementToTreeNode);
  }
  return node;
}

function irScreensToTreeNodes(screens: DesignIrScreen[]): TreeNode[] {
  return screens.map((s) => ({
    id: s.id,
    name: s.name,
    type: "screen",
    children: s.children.map(irElementToTreeNode)
  }));
}

// ---------------------------------------------------------------------------
// Helpers: look up manifest entry for a selected node
// ---------------------------------------------------------------------------

function findManifestEntry(
  nodeId: string,
  manifest: ComponentManifestPayload
): { screen: ComponentManifestScreen; entry: ComponentManifestEntry | null } | null {
  for (const screen of manifest.screens) {
    // Check if it's the screen itself
    if (screen.screenId === nodeId) {
      return { screen, entry: null };
    }
    // Check component entries
    for (const entry of screen.components) {
      if (entry.irNodeId === nodeId) {
        return { screen, entry };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// InspectorPanel
// ---------------------------------------------------------------------------

export function InspectorPanel({ jobId, previewUrl }: InspectorPanelProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [paneRatios, setPaneRatios] = useState<InspectorPaneRatios>(DEFAULT_INSPECTOR_PANE_RATIOS);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY).matches;
  });

  const encodedJobId = encodeURIComponent(jobId);
  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    separator: PaneSeparator;
    startX: number;
    startRatios: InspectorPaneRatios;
  } | null>(null);
  const pointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const pointerEndHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);

  // --- Queries ---

  const filesQuery = useQuery({
    queryKey: ["inspector-files", jobId],
    queryFn: async () => {
      return await fetchJson<FilesPayload>({
        url: `/workspace/jobs/${encodedJobId}/files`
      });
    },
    staleTime: Infinity
  });

  const manifestQuery = useQuery({
    queryKey: ["inspector-manifest", jobId],
    queryFn: async () => {
      return await fetchJson<ComponentManifestPayload>({
        url: `/workspace/jobs/${encodedJobId}/component-manifest`
      });
    },
    staleTime: Infinity
  });

  const designIrQuery = useQuery({
    queryKey: ["inspector-design-ir", jobId],
    queryFn: async () => {
      return await fetchJson<DesignIrPayload>({
        url: `/workspace/jobs/${encodedJobId}/design-ir`
      });
    },
    staleTime: Infinity
  });

  // --- Derived data ---

  const files = useMemo<FileEntry[]>(() => {
    if (!filesQuery.data?.ok || !isFilesPayload(filesQuery.data.payload)) {
      return [];
    }
    return filesQuery.data.payload.files;
  }, [filesQuery.data]);

  const manifest = useMemo<ComponentManifestPayload | null>(() => {
    const payload = manifestQuery.data?.payload as ComponentManifestPayload | undefined;
    if (payload?.screens?.length) {
      return payload;
    }
    return null;
  }, [manifestQuery.data]);

  const treeNodes = useMemo<TreeNode[]>(() => {
    if (!designIrQuery.data?.ok || !isDesignIrPayload(designIrQuery.data.payload)) {
      return [];
    }
    return irScreensToTreeNodes(designIrQuery.data.payload.screens);
  }, [designIrQuery.data]);

  const hasTreePane = treeNodes.length > 0;
  const hasExpandedTree = hasTreePane && !treeCollapsed;

  const irScreens = useMemo<DesignIrScreen[]>(() => {
    if (!designIrQuery.data?.ok || !isDesignIrPayload(designIrQuery.data.payload)) {
      return [];
    }
    return designIrQuery.data.payload.screens;
  }, [designIrQuery.data]);

  const layoutStorageKey = useMemo(() => {
    return toInspectorLayoutStorageKey(jobId);
  }, [jobId]);

  const getLayoutContainerWidth = useCallback((): number => {
    return getContainerWidthPx(layoutContainerRef.current?.getBoundingClientRect().width);
  }, []);

  const persistPaneLayout = useCallback((nextRatios: InspectorPaneRatios) => {
    saveInspectorPaneRatios({
      storageKey: layoutStorageKey,
      ratios: nextRatios
    });
  }, [layoutStorageKey]);

  const applyResizeDelta = useCallback(({
    separator,
    deltaPx,
    sourceRatios
  }: {
    separator: PaneSeparator;
    deltaPx: number;
    sourceRatios: InspectorPaneRatios;
  }): InspectorPaneRatios => {
    const widthPx = getLayoutContainerWidth();

    if (separator === "tree-preview") {
      if (!hasExpandedTree) {
        return sourceRatios;
      }

      return resizeTreePreviewPane({
        ratios: sourceRatios,
        widthPx,
        deltaPx
      });
    }

    return resizePreviewCodePanes({
      ratios: sourceRatios,
      widthPx,
      deltaPx,
      treeCollapsed: !hasExpandedTree
    });
  }, [getLayoutContainerWidth, hasExpandedTree]);

  const clearPointerDragListeners = useCallback(() => {
    if (pointerMoveHandlerRef.current) {
      window.removeEventListener("pointermove", pointerMoveHandlerRef.current);
      pointerMoveHandlerRef.current = null;
    }
    if (pointerEndHandlerRef.current) {
      window.removeEventListener("pointerup", pointerEndHandlerRef.current);
      window.removeEventListener("pointercancel", pointerEndHandlerRef.current);
      pointerEndHandlerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY);
    const handleChange = (): void => {
      setIsDesktopLayout(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const loaded = loadInspectorPaneRatios(layoutStorageKey);
    if (loaded) {
      setPaneRatios(loaded);
      return;
    }
    setPaneRatios(DEFAULT_INSPECTOR_PANE_RATIOS);
  }, [layoutStorageKey]);

  useEffect(() => {
    return () => {
      clearPointerDragListeners();
    };
  }, [clearPointerDragListeners]);

  // --- Derive default file from manifest/files when none explicitly selected ---
  const defaultFile = useMemo<string | null>(() => {
    if (manifest?.screens?.length) {
      const firstScreen = manifest.screens[0];
      if (firstScreen && firstScreen.file) {
        return firstScreen.file;
      }
    }

    const codeFiles = files.filter(
      (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts")
    );
    if (codeFiles.length > 0 && codeFiles[0]) {
      return codeFiles[0].path;
    }

    return null;
  }, [files, manifest]);

  const effectiveSelectedFile = selectedFile ?? defaultFile;

  const fileContentQuery = useQuery({
    queryKey: ["inspector-file-content", jobId, effectiveSelectedFile],
    enabled: Boolean(effectiveSelectedFile),
    queryFn: async () => {
      if (!effectiveSelectedFile) {
        throw new Error("No file selected");
      }
      const resp = await fetch(
        `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(effectiveSelectedFile)}`
      );
      if (!resp.ok) {
        throw new Error(`Failed to fetch file: ${resp.status}`);
      }
      return await resp.text();
    },
    staleTime: Infinity
  });

  // --- Handlers ---

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    setHighlightRange(null);
  }, []);

  const handleSelectTreeNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);

      if (!manifest) {
        return;
      }

      const match = findManifestEntry(nodeId, manifest);
      if (!match) {
        return;
      }

      if (match.entry) {
        // Element-level or extracted component selection
        if (match.entry.extractedComponent) {
          // Navigate to the extracted component's own file
          setSelectedFile(match.entry.file);
          setHighlightRange(null);
        } else {
          // Navigate to the screen file with line highlight
          setSelectedFile(match.entry.file);
          setHighlightRange({
            startLine: match.entry.startLine,
            endLine: match.entry.endLine
          });
        }
      } else {
        // Screen-level selection — show entire screen file
        setSelectedFile(match.screen.file);
        setHighlightRange(null);
      }
    },
    [manifest]
  );

  // Also check if the node is a screen directly from IR data (for screens without manifest)
  const handleTreeSelect = useCallback(
    (nodeId: string) => {
      handleSelectTreeNode(nodeId);

      // Fallback for screens: if manifest didn't match, try IR screen generatedFile
      if (manifest && !findManifestEntry(nodeId, manifest)) {
        const irScreen = irScreens.find((s) => s.id === nodeId);
        if (irScreen?.generatedFile) {
          setSelectedFile(irScreen.generatedFile);
          setHighlightRange(null);
        }
      }
    },
    [handleSelectTreeNode, manifest, irScreens]
  );

  // Handle inspect:select from the preview iframe overlay
  const handleInspectSelect = useCallback(
    (irNodeId: string) => {
      handleTreeSelect(irNodeId);
    },
    [handleTreeSelect]
  );

  const handleToggleInspect = useCallback(() => {
    setInspectEnabled((prev) => !prev);
  }, []);

  const handleSplitterPointerDown = useCallback(
    (separator: PaneSeparator) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDesktopLayout) {
        return;
      }
      if (separator === "tree-preview" && !hasExpandedTree) {
        return;
      }

      event.preventDefault();

      dragStateRef.current = {
        separator,
        startX: event.clientX,
        startRatios: paneRatios
      };

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const state = dragStateRef.current;
        if (!state) {
          return;
        }

        const next = applyResizeDelta({
          separator: state.separator,
          deltaPx: moveEvent.clientX - state.startX,
          sourceRatios: state.startRatios
        });
        setPaneRatios(next);
      };

      const onPointerEnd = (upEvent: PointerEvent): void => {
        const state = dragStateRef.current;
        if (!state) {
          clearPointerDragListeners();
          return;
        }

        const next = applyResizeDelta({
          separator: state.separator,
          deltaPx: upEvent.clientX - state.startX,
          sourceRatios: state.startRatios
        });

        setPaneRatios(next);
        persistPaneLayout(next);
        dragStateRef.current = null;
        clearPointerDragListeners();
      };

      pointerMoveHandlerRef.current = onPointerMove;
      pointerEndHandlerRef.current = onPointerEnd;

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerEnd);
      window.addEventListener("pointercancel", onPointerEnd);
    },
    [
      applyResizeDelta,
      clearPointerDragListeners,
      hasExpandedTree,
      isDesktopLayout,
      paneRatios,
      persistPaneLayout
    ]
  );

  const handleSplitterKeyDown = useCallback(
    (separator: PaneSeparator) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isDesktopLayout) {
        return;
      }
      if (separator === "tree-preview" && !hasExpandedTree) {
        return;
      }

      const keyboardStep = event.shiftKey ? KEYBOARD_STEP_LARGE_PX : KEYBOARD_STEP_PX;
      let deltaPx: number | null = null;

      switch (event.key) {
        case "ArrowLeft":
          deltaPx = -keyboardStep;
          break;
        case "ArrowRight":
          deltaPx = keyboardStep;
          break;
        case "Home":
          deltaPx = -KEYBOARD_EXTREME_DELTA_PX;
          break;
        case "End":
          deltaPx = KEYBOARD_EXTREME_DELTA_PX;
          break;
        default:
          break;
      }

      if (deltaPx === null) {
        return;
      }

      event.preventDefault();
      const next = applyResizeDelta({
        separator,
        deltaPx,
        sourceRatios: paneRatios
      });

      setPaneRatios(next);
      persistPaneLayout(next);
    },
    [applyResizeDelta, hasExpandedTree, isDesktopLayout, paneRatios, persistPaneLayout]
  );

  const collapsedPreviewShare = useMemo(() => {
    const sum = paneRatios.preview + paneRatios.code;
    if (sum <= 0) {
      return 0.5;
    }
    return paneRatios.preview / sum;
  }, [paneRatios.code, paneRatios.preview]);

  const treeSeparatorNow = Math.round(paneRatios.tree * 100);
  const previewSeparatorNow = Math.round(collapsedPreviewShare * 100);

  const treePaneStyle = useMemo(() => {
    if (!isDesktopLayout || !hasExpandedTree) {
      return undefined;
    }

    return {
      flexBasis: `${String((paneRatios.tree * 100).toFixed(4))}%`,
      flexGrow: 0,
      flexShrink: 0
    };
  }, [hasExpandedTree, isDesktopLayout, paneRatios.tree]);

  const previewPaneStyle = useMemo(() => {
    if (!isDesktopLayout) {
      return undefined;
    }

    if (hasExpandedTree) {
      return {
        flexBasis: "0%",
        flexGrow: paneRatios.preview,
        flexShrink: 1,
        minWidth: `${String(MIN_PREVIEW_WIDTH_PX)}px`
      };
    }

    return {
      flexBasis: "0%",
      flexGrow: collapsedPreviewShare,
      flexShrink: 1,
      minWidth: `${String(MIN_PREVIEW_WIDTH_PX)}px`
    };
  }, [collapsedPreviewShare, hasExpandedTree, isDesktopLayout, paneRatios.preview]);

  const codePaneStyle = useMemo(() => {
    if (!isDesktopLayout) {
      return undefined;
    }

    if (hasExpandedTree) {
      return {
        flexBasis: "0%",
        flexGrow: paneRatios.code,
        flexShrink: 1,
        minWidth: `${String(MIN_CODE_WIDTH_PX)}px`
      };
    }

    return {
      flexBasis: "0%",
      flexGrow: 1 - collapsedPreviewShare,
      flexShrink: 1,
      minWidth: `${String(MIN_CODE_WIDTH_PX)}px`
    };
  }, [collapsedPreviewShare, hasExpandedTree, isDesktopLayout, paneRatios.code]);

  return (
    <div data-testid="inspector-panel" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <h2 className="m-0 text-xl font-bold text-slate-900">Inspector</h2>
        <p className="m-0 text-sm text-slate-600">Live preview and generated source code</p>
      </div>

      <div ref={layoutContainerRef} className="flex min-h-0 flex-1 flex-col xl:flex-row" data-testid="inspector-layout">
        {/* Left: Component Tree sidebar */}
        {hasTreePane ? (
          <div data-testid="inspector-pane-tree" className="min-h-[120px] shrink-0" style={treePaneStyle}>
            <ComponentTree
              screens={treeNodes}
              selectedId={selectedNodeId}
              onSelect={handleTreeSelect}
              collapsed={treeCollapsed}
              onToggleCollapsed={() => {
                setTreeCollapsed((prev) => !prev);
              }}
            />
          </div>
        ) : null}

        {/* Resizable divider: tree ↔ preview (desktop + expanded tree only) */}
        {hasExpandedTree ? (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize tree and preview panes"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={treeSeparatorNow}
            data-testid="inspector-splitter-tree-preview"
            className="hidden shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400 focus:bg-slate-400 focus:outline-none xl:block xl:w-1"
            style={{ touchAction: "none" }}
            onPointerDown={handleSplitterPointerDown("tree-preview")}
            onKeyDown={handleSplitterKeyDown("tree-preview")}
          />
        ) : null}

        {/* Center: Preview pane */}
        <div data-testid="inspector-pane-preview" className="relative min-h-[200px] flex-1 lg:min-h-0" style={previewPaneStyle}>
          <PreviewPane
            previewUrl={previewUrl}
            inspectEnabled={inspectEnabled}
            onToggleInspect={handleToggleInspect}
            onInspectSelect={handleInspectSelect}
          />
        </div>

        {/* Horizontal divider for stacked layout */}
        <div className="h-px shrink-0 bg-slate-200 xl:hidden" />

        {/* Resizable divider: preview ↔ code (desktop) */}
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize preview and code panes"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={previewSeparatorNow}
          data-testid="inspector-splitter-preview-code"
          className="hidden shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400 focus:bg-slate-400 focus:outline-none xl:block xl:w-1"
          style={{ touchAction: "none" }}
          onPointerDown={handleSplitterPointerDown("preview-code")}
          onKeyDown={handleSplitterKeyDown("preview-code")}
        />

        {/* Right: Code pane */}
        <div data-testid="inspector-pane-code" className="min-h-[200px] flex-1 lg:min-h-0" style={codePaneStyle}>
          <CodePane
            files={files}
            selectedFile={effectiveSelectedFile}
            onSelectFile={handleSelectFile}
            fileContent={fileContentQuery.data ?? null}
            isLoadingContent={fileContentQuery.isLoading}
            highlightRange={highlightRange}
          />
        </div>
      </div>
    </div>
  );
}
