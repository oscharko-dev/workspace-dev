import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
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
import { findNodePath } from "./component-tree-utils";
import { ShortcutHelp } from "./ShortcutHelp";
import { suggestPairedFile } from "./file-pairing";
import type { CodeBoundaryEntry as GutterBoundaryEntry } from "./code-boundaries";
import {
  deriveInspectabilitySummary,
  type InspectabilityAvailability,
  type InspectabilityGenerationMetricsPayload
} from "./inspectability-summary";
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
import {
  inspectorScopeReducer,
  INITIAL_INSPECTOR_SCOPE_STATE,
  selectActiveScope,
  selectCanNavigateBack,
  selectCanNavigateForward,
  selectCanLevelUp,
  selectCanReturnToParentFile,
  selectHasActiveScope,
  selectParentFile,
  type ManifestMapping
} from "./inspector-scope-state";

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

interface FileContentResponse {
  ok: boolean;
  status: number;
  content: string | null;
  error: string | null;
  message: string | null;
}

interface GenerationMetricsResponse {
  ok: boolean;
  status: number;
  payload: InspectabilityGenerationMetricsPayload | null;
  error: string | null;
  message: string | null;
}

interface EndpointErrorDetails {
  status: number;
  code: string;
  message: string;
}

type InspectorSourceStatus = "loading" | "ready" | "empty" | "error";

interface InspectorPanelProps {
  jobId: string;
  previewUrl: string;
  /** Previous job ID for diff comparison. `null` when no prior job exists. */
  previousJobId?: string | null;
}

type PaneSeparator = "tree-preview" | "preview-code";

const DESKTOP_LAYOUT_MEDIA_QUERY = "(min-width: 1280px)";
const KEYBOARD_STEP_PX = 24;
const KEYBOARD_STEP_LARGE_PX = 72;
const KEYBOARD_EXTREME_DELTA_PX = 100_000;
const BOUNDARIES_SESSION_STORAGE_KEY = "workspace-dev:inspector-boundaries:v1";

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

function isComponentManifestPayload(value: unknown): value is ComponentManifestPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return typeof rec.jobId === "string" && Array.isArray(rec.screens);
}

function isGenerationMetricsPayload(value: unknown): value is InspectabilityGenerationMetricsPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toEndpointError({
  status,
  payload,
  fallbackCode,
  fallbackMessage
}: {
  status: number;
  payload: unknown;
  fallbackCode: string;
  fallbackMessage: string;
}): EndpointErrorDetails {
  if (!isRecord(payload)) {
    return {
      status,
      code: fallbackCode,
      message: fallbackMessage
    };
  }

  const payloadCode = typeof payload.error === "string" ? payload.error : fallbackCode;
  const payloadMessage = typeof payload.message === "string" ? payload.message : fallbackMessage;

  return {
    status,
    code: payloadCode,
    message: payloadMessage
  };
}

function getStatusBadgeClasses(status: InspectorSourceStatus): string {
  if (status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "loading") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  if (status === "empty") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function loadBoundariesEnabledPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.sessionStorage.getItem(BOUNDARIES_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function toBoundariesForFile({
  manifest,
  filePath
}: {
  manifest: ComponentManifestPayload | null;
  filePath: string | null;
}): GutterBoundaryEntry[] {
  if (!manifest || !filePath) {
    return [];
  }

  const deduped = new Map<string, GutterBoundaryEntry>();
  for (const screen of manifest.screens) {
    for (const entry of screen.components) {
      if (entry.file !== filePath) {
        continue;
      }
      const key = `${entry.irNodeId}:${String(entry.startLine)}:${String(entry.endLine)}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          irNodeId: entry.irNodeId,
          irNodeName: entry.irNodeName,
          irNodeType: entry.irNodeType,
          startLine: entry.startLine,
          endLine: entry.endLine
        });
      }
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }
    if (left.endLine !== right.endLine) {
      return left.endLine - right.endLine;
    }
    return left.irNodeId.localeCompare(right.irNodeId);
  });
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

export function InspectorPanel({ jobId, previewUrl, previousJobId }: InspectorPanelProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(null);
  const [scopeState, scopeDispatch] = useReducer(inspectorScopeReducer, INITIAL_INSPECTOR_SCOPE_STATE);
  const selectedNodeId = scopeState.selectedNodeId;
  const activeScopeNodeId = selectActiveScope(scopeState)?.nodeId ?? null;
  const hasActiveScope = selectHasActiveScope(scopeState);
  const canNavigateBack = selectCanNavigateBack(scopeState);
  const canNavigateForward = selectCanNavigateForward(scopeState);
  const canLevelUp = selectCanLevelUp(scopeState);
  const canReturnToParentFile = selectCanReturnToParentFile(scopeState);
  const parentFile = selectParentFile(scopeState);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [boundariesEnabled, setBoundariesEnabled] = useState<boolean>(loadBoundariesEnabledPreference);
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

  const generationMetricsQuery = useQuery({
    queryKey: ["inspector-generation-metrics", jobId],
    queryFn: async (): Promise<GenerationMetricsResponse> => {
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent("generation-metrics.json")}`
        );
        const body = await response.text();

        if (!response.ok) {
          let parsedPayload: unknown = null;
          if (body.trim()) {
            try {
              parsedPayload = JSON.parse(body) as unknown;
            } catch {
              parsedPayload = null;
            }
          }

          const error = toEndpointError({
            status: response.status,
            payload: parsedPayload,
            fallbackCode: "GENERATION_METRICS_NOT_FOUND",
            fallbackMessage: "generation-metrics.json is unavailable for this job."
          });

          return {
            ok: false,
            status: error.status,
            payload: null,
            error: error.code,
            message: error.message
          };
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          return {
            ok: false,
            status: response.status,
            payload: null,
            error: "GENERATION_METRICS_INVALID_JSON",
            message: "generation-metrics.json is not valid JSON."
          };
        }

        if (!isGenerationMetricsPayload(payload)) {
          return {
            ok: false,
            status: response.status,
            payload: null,
            error: "GENERATION_METRICS_INVALID_PAYLOAD",
            message: "generation-metrics.json payload is invalid."
          };
        }

        return {
          ok: true,
          status: response.status,
          payload,
          error: null,
          message: null
        };
      } catch {
        return {
          ok: false,
          status: 0,
          payload: null,
          error: "GENERATION_METRICS_FETCH_FAILED",
          message: "generation-metrics.json could not be loaded."
        };
      }
    },
    staleTime: Infinity
  });

  // --- Derived data ---

  const filesState = useMemo<{
    status: InspectorSourceStatus;
    files: FileEntry[];
    error: EndpointErrorDetails | null;
  }>(() => {
    if (filesQuery.isLoading && !filesQuery.data) {
      return { status: "loading", files: [], error: null };
    }

    if (!filesQuery.data) {
      return { status: "loading", files: [], error: null };
    }

    if (!filesQuery.data.ok) {
      return {
        status: "error",
        files: [],
        error: toEndpointError({
          status: filesQuery.data.status,
          payload: filesQuery.data.payload,
          fallbackCode: "FILES_FETCH_FAILED",
          fallbackMessage: "Could not load generated files."
        })
      };
    }

    if (!isFilesPayload(filesQuery.data.payload)) {
      return {
        status: "error",
        files: [],
        error: {
          status: filesQuery.data.status,
          code: "FILES_INVALID_PAYLOAD",
          message: "Generated files response payload is invalid."
        }
      };
    }

    if (filesQuery.data.payload.files.length === 0) {
      return {
        status: "empty",
        files: [],
        error: null
      };
    }

    return {
      status: "ready",
      files: filesQuery.data.payload.files,
      error: null
    };
  }, [filesQuery.data, filesQuery.isLoading]);

  const manifestState = useMemo<{
    status: InspectorSourceStatus;
    manifest: ComponentManifestPayload | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (manifestQuery.isLoading && !manifestQuery.data) {
      return { status: "loading", manifest: null, error: null };
    }

    if (!manifestQuery.data) {
      return { status: "loading", manifest: null, error: null };
    }

    if (!manifestQuery.data.ok) {
      return {
        status: "error",
        manifest: null,
        error: toEndpointError({
          status: manifestQuery.data.status,
          payload: manifestQuery.data.payload,
          fallbackCode: "MANIFEST_FETCH_FAILED",
          fallbackMessage: "Could not load component manifest."
        })
      };
    }

    if (!isComponentManifestPayload(manifestQuery.data.payload)) {
      return {
        status: "error",
        manifest: null,
        error: {
          status: manifestQuery.data.status,
          code: "MANIFEST_INVALID_PAYLOAD",
          message: "Component manifest payload is invalid."
        }
      };
    }

    if (manifestQuery.data.payload.screens.length === 0) {
      return {
        status: "empty",
        manifest: null,
        error: null
      };
    }

    return {
      status: "ready",
      manifest: manifestQuery.data.payload,
      error: null
    };
  }, [manifestQuery.data, manifestQuery.isLoading]);

  const designIrState = useMemo<{
    status: InspectorSourceStatus;
    screens: DesignIrScreen[];
    treeNodes: TreeNode[];
    error: EndpointErrorDetails | null;
  }>(() => {
    if (designIrQuery.isLoading && !designIrQuery.data) {
      return { status: "loading", screens: [], treeNodes: [], error: null };
    }

    if (!designIrQuery.data) {
      return { status: "loading", screens: [], treeNodes: [], error: null };
    }

    if (!designIrQuery.data.ok) {
      return {
        status: "error",
        screens: [],
        treeNodes: [],
        error: toEndpointError({
          status: designIrQuery.data.status,
          payload: designIrQuery.data.payload,
          fallbackCode: "DESIGN_IR_FETCH_FAILED",
          fallbackMessage: "Could not load design IR."
        })
      };
    }

    if (!isDesignIrPayload(designIrQuery.data.payload)) {
      return {
        status: "error",
        screens: [],
        treeNodes: [],
        error: {
          status: designIrQuery.data.status,
          code: "DESIGN_IR_INVALID_PAYLOAD",
          message: "Design IR payload is invalid."
        }
      };
    }

    if (designIrQuery.data.payload.screens.length === 0) {
      return {
        status: "empty",
        screens: [],
        treeNodes: [],
        error: null
      };
    }

    return {
      status: "ready",
      screens: designIrQuery.data.payload.screens,
      treeNodes: irScreensToTreeNodes(designIrQuery.data.payload.screens),
      error: null
    };
  }, [designIrQuery.data, designIrQuery.isLoading]);

  const generationMetricsState = useMemo<{
    status: InspectabilityAvailability;
    metrics: InspectabilityGenerationMetricsPayload | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (generationMetricsQuery.isLoading && !generationMetricsQuery.data) {
      return {
        status: "loading",
        metrics: null,
        error: null
      };
    }

    if (!generationMetricsQuery.data) {
      return {
        status: "loading",
        metrics: null,
        error: null
      };
    }

    if (!generationMetricsQuery.data.ok || !generationMetricsQuery.data.payload) {
      return {
        status: "unavailable",
        metrics: null,
        error: {
          status: generationMetricsQuery.data.status,
          code: generationMetricsQuery.data.error ?? "GENERATION_METRICS_FETCH_FAILED",
          message: generationMetricsQuery.data.message ?? "generation-metrics.json is unavailable for this job."
        }
      };
    }

    return {
      status: "ready",
      metrics: generationMetricsQuery.data.payload,
      error: null
    };
  }, [generationMetricsQuery.data, generationMetricsQuery.isLoading]);

  const files = filesState.files;
  const manifest = manifestState.manifest;
  const treeNodes = designIrState.treeNodes;
  const irScreens = designIrState.screens;
  const inspectabilitySummary = useMemo(() => {
    return deriveInspectabilitySummary({
      designIrStatus: designIrState.status,
      designIrScreens: irScreens,
      manifestStatus: manifestState.status,
      manifest,
      metricsStatus: generationMetricsState.status,
      metrics: generationMetricsState.metrics
    });
  }, [
    designIrState.status,
    generationMetricsState.metrics,
    generationMetricsState.status,
    irScreens,
    manifest,
    manifestState.status
  ]);

  const hasTreePane = designIrState.status !== "ready" || treeNodes.length > 0;
  const hasExpandedTree = designIrState.status === "ready" ? hasTreePane && !treeCollapsed : hasTreePane;

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

  // --- Shortcut help: toggle on `?` key (skip when text input is focused) ---

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleShortcutKey = (event: KeyboardEvent): void => {
      if (event.key !== "?") return;

      // Do not trigger when a text input, textarea, or contenteditable is focused
      const target = event.target as HTMLElement | null;
      if (target && typeof target.tagName === "string") {
        const tagName = target.tagName.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || target.isContentEditable) {
          return;
        }
      }

      event.preventDefault();
      setShortcutHelpOpen((prev) => !prev);
    };

    window.addEventListener("keydown", handleShortcutKey);
    return () => { window.removeEventListener("keydown", handleShortcutKey); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.sessionStorage.setItem(
        BOUNDARIES_SESSION_STORAGE_KEY,
        boundariesEnabled ? "1" : "0"
      );
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }, [boundariesEnabled]);

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
  const selectedFileBoundaries = useMemo(() => {
    return toBoundariesForFile({
      manifest,
      filePath: effectiveSelectedFile
    });
  }, [effectiveSelectedFile, manifest]);

  const fileContentQuery = useQuery({
    queryKey: ["inspector-file-content", jobId, effectiveSelectedFile],
    enabled: Boolean(effectiveSelectedFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSelectedFile) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FILE_NOT_SELECTED",
          message: "No file selected."
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(effectiveSelectedFile)}`
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null
          };
        }

        let parsedPayload: unknown = null;
        if (body.trim()) {
          try {
            parsedPayload = JSON.parse(body) as unknown;
          } catch {
            parsedPayload = null;
          }
        }

        const error = toEndpointError({
          status: response.status,
          payload: parsedPayload,
          fallbackCode: "FILE_CONTENT_FETCH_FAILED",
          fallbackMessage: `Could not load file '${effectiveSelectedFile}'.`
        });

        return {
          ok: false,
          status: error.status,
          content: null,
          error: error.code,
          message: error.message
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FILE_CONTENT_FETCH_FAILED",
          message: `Could not load file '${effectiveSelectedFile}'.`
        };
      }
    },
    staleTime: Infinity
  });

  const fileContentState = useMemo<{
    status: InspectorSourceStatus;
    content: string | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (!effectiveSelectedFile) {
      return {
        status: "empty",
        content: null,
        error: null
      };
    }

    if (fileContentQuery.isLoading && !fileContentQuery.data) {
      return {
        status: "loading",
        content: null,
        error: null
      };
    }

    if (!fileContentQuery.data) {
      return {
        status: "loading",
        content: null,
        error: null
      };
    }

    if (!fileContentQuery.data.ok) {
      return {
        status: "error",
        content: null,
        error: {
          status: fileContentQuery.data.status,
          code: fileContentQuery.data.error ?? "FILE_CONTENT_FETCH_FAILED",
          message: fileContentQuery.data.message ?? `Could not load file '${effectiveSelectedFile}'.`
        }
      };
    }

    return {
      status: "ready",
      content: fileContentQuery.data.content,
      error: null
    };
  }, [effectiveSelectedFile, fileContentQuery.data, fileContentQuery.isLoading]);

  // --- Previous file content for diff comparison ---

  const encodedPreviousJobId = previousJobId ? encodeURIComponent(previousJobId) : null;

  const previousFileContentQuery = useQuery({
    queryKey: ["inspector-prev-file-content", previousJobId, effectiveSelectedFile],
    enabled: Boolean(previousJobId) && Boolean(effectiveSelectedFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSelectedFile || !encodedPreviousJobId) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "NO_PREVIOUS_JOB",
          message: "No previous job selected."
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedPreviousJobId}/files/${encodeURIComponent(effectiveSelectedFile)}`
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null
          };
        }

        // File may not exist in the previous job — that's fine, treat as empty
        return {
          ok: true,
          status: response.status,
          content: "",
          error: null,
          message: null
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "PREV_FILE_FETCH_FAILED",
          message: `Could not load previous version of '${effectiveSelectedFile}'.`
        };
      }
    },
    staleTime: Infinity
  });

  const previousFileContent = useMemo<string | null>(() => {
    if (!previousJobId || !effectiveSelectedFile) return null;
    if (!previousFileContentQuery.data) return null;
    if (!previousFileContentQuery.data.ok) return null;
    return previousFileContentQuery.data.content;
  }, [previousJobId, effectiveSelectedFile, previousFileContentQuery.data]);

  const previousFileContentLoading = previousFileContentQuery.isLoading && !previousFileContentQuery.data;

  // --- Breadcrumb path derivation ---

  const breadcrumbPath = useMemo(() => {
    if (!selectedNodeId || treeNodes.length === 0) return [];
    return findNodePath(treeNodes, selectedNodeId);
  }, [selectedNodeId, treeNodes]);

  // --- Split view: second file ---

  const [splitFile, setSplitFile] = useState<string | null>(null);

  const suggestedPairedFile = useMemo(() => {
    if (!effectiveSelectedFile) return null;
    const filePaths = files.map((f) => f.path);
    return suggestPairedFile(effectiveSelectedFile, manifest, filePaths);
  }, [effectiveSelectedFile, manifest, files]);

  const effectiveSplitFile = splitFile ?? suggestedPairedFile;
  const splitFileBoundaries = useMemo(() => {
    return toBoundariesForFile({
      manifest,
      filePath: effectiveSplitFile
    });
  }, [effectiveSplitFile, manifest]);

  const splitFileContentQuery = useQuery({
    queryKey: ["inspector-split-file-content", jobId, effectiveSplitFile],
    enabled: Boolean(effectiveSplitFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSplitFile) {
        return { ok: false, status: 0, content: null, error: "NO_FILE", message: "No file selected." };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(effectiveSplitFile)}`
        );
        const body = await response.text();
        if (response.ok) {
          return { ok: true, status: response.status, content: body, error: null, message: null };
        }
        return { ok: false, status: response.status, content: null, error: "FETCH_FAILED", message: `Could not load '${effectiveSplitFile}'.` };
      } catch {
        return { ok: false, status: 0, content: null, error: "FETCH_FAILED", message: `Could not load '${effectiveSplitFile}'.` };
      }
    },
    staleTime: Infinity
  });

  const splitFileContent = useMemo<string | null>(() => {
    if (!effectiveSplitFile || !splitFileContentQuery.data) return null;
    if (!splitFileContentQuery.data.ok) return null;
    return splitFileContentQuery.data.content;
  }, [effectiveSplitFile, splitFileContentQuery.data]);

  const splitFileContentLoading = splitFileContentQuery.isLoading && !splitFileContentQuery.data;

  const handleSelectSplitFile = useCallback((filePath: string) => {
    setSplitFile(filePath);
  }, []);

  const handleRetryFiles = useCallback(() => {
    void filesQuery.refetch();
  }, [filesQuery.refetch]);

  const handleRetryManifest = useCallback(() => {
    void manifestQuery.refetch();
  }, [manifestQuery.refetch]);

  const handleRetryDesignIr = useCallback(() => {
    void designIrQuery.refetch();
  }, [designIrQuery.refetch]);

  const handleRetryFileContent = useCallback(() => {
    if (!effectiveSelectedFile) {
      return;
    }
    void fileContentQuery.refetch();
  }, [effectiveSelectedFile, fileContentQuery.refetch]);

  // --- Handlers ---

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    setHighlightRange(null);
  }, []);

  /** Resolve a ManifestMapping for a given node id (null if unmapped). */
  const resolveMapping = useCallback(
    (nodeId: string): ManifestMapping | null => {
      if (!manifest) return null;
      const match = findManifestEntry(nodeId, manifest);
      if (!match) return null;
      if (match.entry) {
        return {
          file: match.entry.file,
          startLine: match.entry.startLine,
          endLine: match.entry.endLine,
          ...(match.entry.extractedComponent ? { extractedComponent: true } : {})
        };
      }
      // Screen-level: use the screen file
      return {
        file: match.screen.file,
        startLine: 1,
        endLine: 1
      };
    },
    [manifest]
  );

  // Derive the active manifest range for the currently selected node
  const activeManifestRange = useMemo<ManifestMapping | null>(() => {
    if (!selectedNodeId) return null;
    return resolveMapping(selectedNodeId);
  }, [selectedNodeId, resolveMapping]);

  const isNodeMapped = activeManifestRange !== null;

  /** Look up the node name and type from the IR tree. */
  const resolveNodeMeta = useCallback(
    (nodeId: string): { name: string; type: string } => {
      const findInTree = (nodes: TreeNode[]): { name: string; type: string } | null => {
        for (const node of nodes) {
          if (node.id === nodeId) return { name: node.name, type: node.type };
          if (node.children) {
            const found = findInTree(node.children);
            if (found) return found;
          }
        }
        return null;
      };
      return findInTree(treeNodes) ?? { name: nodeId, type: "unknown" };
    },
    [treeNodes]
  );

  const applyNavigationVisualState = useCallback(
    (nextScopeState: { selectedNodeId: string | null; effectiveFileTarget: string | null }) => {
      const nodeId = nextScopeState.selectedNodeId;

      if (!nodeId) {
        setSelectedFile(null);
        setHighlightRange(null);
        return;
      }

      if (manifest) {
        const match = findManifestEntry(nodeId, manifest);
        if (match?.entry) {
          setSelectedFile(match.entry.file);
          if (match.entry.extractedComponent) {
            setHighlightRange(null);
          } else {
            setHighlightRange({
              startLine: match.entry.startLine,
              endLine: match.entry.endLine
            });
          }
          return;
        }

        if (match) {
          setSelectedFile(match.screen.file);
          setHighlightRange(null);
          return;
        }
      }

      const irScreen = irScreens.find((screen) => screen.id === nodeId);
      if (irScreen?.generatedFile) {
        setSelectedFile(irScreen.generatedFile);
        setHighlightRange(null);
        return;
      }

      if (nextScopeState.effectiveFileTarget) {
        setSelectedFile(nextScopeState.effectiveFileTarget);
        setHighlightRange(null);
      }
    },
    [irScreens, manifest]
  );

  const handleSelectTreeNode = useCallback(
    (nodeId: string) => {
      const mapping = resolveMapping(nodeId);
      const meta = resolveNodeMeta(nodeId);

      // Dispatch to scope reducer (selection only, not scope entry)
      scopeDispatch({
        type: "SELECT_NODE",
        payload: {
          nodeId,
          nodeName: meta.name,
          nodeType: meta.type,
          mapping
        }
      });

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
    [manifest, resolveMapping, resolveNodeMeta]
  );

  // Also check if the node is a screen directly from IR data (for screens without manifest)
  const handleTreeSelect = useCallback(
    (nodeId: string) => {
      handleSelectTreeNode(nodeId);

      // Fallback for screens: if manifest didn't match, try IR screen generatedFile
      if (!manifest || !findManifestEntry(nodeId, manifest)) {
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

  /** Explicitly enter scope on a node (separate from selection). */
  const handleEnterScope = useCallback(
    (nodeId: string) => {
      const mapping = resolveMapping(nodeId);
      const meta = resolveNodeMeta(nodeId);

      scopeDispatch({
        type: "ENTER_SCOPE",
        payload: {
          nodeId,
          nodeName: meta.name,
          nodeType: meta.type,
          mapping
        }
      });

      // Also navigate to the node's file if mapped
      if (mapping) {
        setSelectedFile(mapping.file);
        if (mapping.extractedComponent) {
          setHighlightRange(null);
        } else {
          setHighlightRange({
            startLine: mapping.startLine,
            endLine: mapping.endLine
          });
        }
      }
    },
    [resolveMapping, resolveNodeMeta]
  );

  const handleLevelUp = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, { type: "LEVEL_UP" });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "LEVEL_UP" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  /** Exit scope remains as a compatibility alias for level-up navigation. */
  const handleExitScope = useCallback(() => {
    handleLevelUp();
  }, [handleLevelUp]);

  /** Return to parent file context without unwinding scope. */
  const handleReturnToParentFile = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, { type: "RETURN_TO_PARENT_FILE" });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "RETURN_TO_PARENT_FILE" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  const handleNavigateBack = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, { type: "NAVIGATE_BACK" });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "NAVIGATE_BACK" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  const handleNavigateForward = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, { type: "NAVIGATE_FORWARD" });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "NAVIGATE_FORWARD" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

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

  const sourceStatuses = useMemo(() => {
    return [
      { source: "files", label: "Files", status: filesState.status },
      { source: "design-ir", label: "Design IR", status: designIrState.status },
      { source: "component-manifest", label: "Manifest", status: manifestState.status },
      { source: "file-content", label: "File content", status: fileContentState.status }
    ] as const;
  }, [designIrState.status, fileContentState.status, filesState.status, manifestState.status]);

  const sourceErrorBanners = useMemo(() => {
    const banners: Array<{
      source: "files" | "design-ir" | "component-manifest" | "file-content";
      title: string;
      details: EndpointErrorDetails;
      onRetry: (() => void) | null;
    }> = [];

    if (filesState.error) {
      banners.push({
        source: "files",
        title: "Generated files unavailable",
        details: filesState.error,
        onRetry: handleRetryFiles
      });
    }

    if (designIrState.error) {
      banners.push({
        source: "design-ir",
        title: "Design IR unavailable",
        details: designIrState.error,
        onRetry: handleRetryDesignIr
      });
    }

    if (manifestState.error) {
      banners.push({
        source: "component-manifest",
        title: "Component mapping unavailable",
        details: manifestState.error,
        onRetry: handleRetryManifest
      });
    }

    if (fileContentState.error) {
      banners.push({
        source: "file-content",
        title: "Selected file unavailable",
        details: fileContentState.error,
        onRetry: handleRetryFileContent
      });
    }

    return banners;
  }, [
    designIrState.error,
    fileContentState.error,
    filesState.error,
    handleRetryDesignIr,
    handleRetryFileContent,
    handleRetryFiles,
    handleRetryManifest,
    manifestState.error
  ]);

  return (
    <div data-testid="inspector-panel" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <h2 className="m-0 text-xl font-bold text-slate-900">Inspector</h2>
        <p className="m-0 text-sm text-slate-600">Live preview and generated source code</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="inspector-nav-back"
            disabled={!canNavigateBack}
            onClick={handleNavigateBack}
            className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-default disabled:opacity-40"
            title="Back to previous committed drilldown state"
            aria-label="Navigate back in inspector drilldown history"
          >
            ← Back
          </button>
          <button
            type="button"
            data-testid="inspector-nav-forward"
            disabled={!canNavigateForward}
            onClick={handleNavigateForward}
            className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-default disabled:opacity-40"
            title="Forward to next committed drilldown state"
            aria-label="Navigate forward in inspector drilldown history"
          >
            Forward →
          </button>
          <button
            type="button"
            data-testid="inspector-shortcut-help-button"
            onClick={() => { setShortcutHelpOpen((prev) => !prev); }}
            className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            ⌨ Shortcuts
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" data-testid="inspector-source-statuses">
          {sourceStatuses.map(({ source, label, status }) => (
            <span
              key={source}
              data-testid={`inspector-source-${source}-${status}`}
              className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClasses(status)}`}
            >
              {label}: {status}
            </span>
          ))}
        </div>
        <div
          data-testid="inspector-inspectability-summary"
          className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-700">
            Inspectability Coverage Summary
          </p>
          <p data-testid="inspector-summary-aggregate-note" className="m-0 mt-1 text-xs text-slate-600">
            {inspectabilitySummary.aggregateOnlyNote}
          </p>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <div
              data-testid="inspector-summary-manifest-coverage"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
            >
              <p className="m-0 font-semibold text-slate-900">Manifest coverage</p>
              {inspectabilitySummary.manifestCoverage.status === "ready" ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <span data-testid="inspector-summary-mapped-count">
                    Mapped: {String(inspectabilitySummary.manifestCoverage.mappedNodes)}
                  </span>
                  <span data-testid="inspector-summary-unmapped-count">
                    Unmapped: {String(inspectabilitySummary.manifestCoverage.unmappedNodes)}
                  </span>
                  <span data-testid="inspector-summary-total-count">
                    Total IR nodes: {String(inspectabilitySummary.manifestCoverage.totalNodes)}
                  </span>
                  <span data-testid="inspector-summary-mapped-percent">
                    Coverage: {String(inspectabilitySummary.manifestCoverage.mappedPercent)}%
                  </span>
                </div>
              ) : (
                <p
                  data-testid={`inspector-summary-manifest-${inspectabilitySummary.manifestCoverage.status}`}
                  className="m-0 mt-1 text-slate-600"
                >
                  {inspectabilitySummary.manifestCoverage.message}
                </p>
              )}
            </div>

            <div
              data-testid="inspector-summary-design-ir-omissions"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
            >
              <p className="m-0 font-semibold text-slate-900">Design IR cleanup/omission counters</p>
              {inspectabilitySummary.omissionMetrics.status === "ready" ? (
                <div className="mt-1 grid gap-1">
                  <span data-testid="inspector-summary-omission-skipped-hidden">
                    Hidden nodes skipped: {String(inspectabilitySummary.omissionMetrics.skippedHidden)}
                  </span>
                  <span data-testid="inspector-summary-omission-skipped-placeholders">
                    Placeholder nodes skipped: {String(inspectabilitySummary.omissionMetrics.skippedPlaceholders)}
                  </span>
                  <span data-testid="inspector-summary-omission-truncated-by-budget">
                    Nodes truncated by budget: {String(inspectabilitySummary.omissionMetrics.truncatedByBudget)}
                  </span>
                  <span data-testid="inspector-summary-omission-depth-truncated-branches">
                    Depth-truncated branches: {String(inspectabilitySummary.omissionMetrics.depthTruncatedBranches)}
                  </span>
                  <span data-testid="inspector-summary-omission-classification-fallbacks">
                    Classification fallbacks: {String(inspectabilitySummary.omissionMetrics.classificationFallbacks)}
                  </span>
                  <span data-testid="inspector-summary-omission-degraded-geometry">
                    Degraded geometry nodes: {String(inspectabilitySummary.omissionMetrics.degradedGeometryNodes)}
                  </span>
                </div>
              ) : (
                <p
                  data-testid={`inspector-summary-omission-${inspectabilitySummary.omissionMetrics.status}`}
                  className="m-0 mt-1 text-slate-600"
                >
                  {inspectabilitySummary.omissionMetrics.message}
                </p>
              )}
            </div>
          </div>
        </div>
        {manifestState.status === "empty" ? (
          <p
            data-testid="inspector-manifest-empty-warning"
            className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
          >
            Component manifest is empty. Tree selection still works, but file-to-component mappings are unavailable.
          </p>
        ) : null}
        {sourceErrorBanners.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2" data-testid="inspector-error-banners">
            {sourceErrorBanners.map((banner) => (
              <div
                key={banner.source}
                data-testid={`inspector-error-${banner.source}`}
                className="flex flex-wrap items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900"
              >
                <span className="font-semibold">{banner.title}</span>
                <span>
                  {banner.details.message} ({banner.details.code}, HTTP {String(banner.details.status)})
                </span>
                {banner.onRetry ? (
                  <button
                    type="button"
                    data-testid={`inspector-banner-retry-${banner.source}`}
                    onClick={banner.onRetry}
                    className="cursor-pointer rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-800 transition hover:bg-rose-100"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={layoutContainerRef} className="flex min-h-0 flex-1 flex-col xl:flex-row" data-testid="inspector-layout">
        {/* Left: Component Tree sidebar */}
        {hasTreePane ? (
          <div data-testid="inspector-pane-tree" className="min-h-[120px] shrink-0" style={treePaneStyle}>
            {designIrState.status === "ready" ? (
              <ComponentTree
                screens={treeNodes}
                selectedId={selectedNodeId}
                onSelect={handleTreeSelect}
                onEnterScope={handleEnterScope}
                collapsed={treeCollapsed}
                onToggleCollapsed={() => {
                  setTreeCollapsed((prev) => !prev);
                }}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 p-3">
                <div
                  data-testid={`inspector-design-ir-state-${designIrState.status}`}
                  className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                >
                  {designIrState.status === "loading" ? (
                    <p className="m-0">Loading design IR…</p>
                  ) : null}
                  {designIrState.status === "empty" ? (
                    <p className="m-0">No component tree data is available for this job.</p>
                  ) : null}
                  {designIrState.status === "error" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Design IR failed to load. Component tree interactions are disabled.</span>
                      <button
                        type="button"
                        data-testid="inspector-retry-design-ir"
                        onClick={handleRetryDesignIr}
                        className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
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
            activeScopeNodeId={activeScopeNodeId}
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
            filesState={filesState.status}
            filesError={filesState.error}
            onRetryFiles={handleRetryFiles}
            fileContent={fileContentState.content}
            fileContentState={fileContentState.status}
            fileContentError={fileContentState.error}
            onRetryFileContent={handleRetryFileContent}
            highlightRange={highlightRange}
            previousJobId={previousJobId}
            previousFileContent={previousFileContent}
            previousFileContentLoading={previousFileContentLoading}
            breadcrumbPath={breadcrumbPath}
            onBreadcrumbSelect={handleTreeSelect}
            hasActiveScope={hasActiveScope}
            onEnterScope={handleEnterScope}
            onExitScope={canLevelUp ? handleExitScope : undefined}
            splitFile={effectiveSplitFile}
            splitFileContent={splitFileContent}
            splitFileContentLoading={splitFileContentLoading}
            onSelectSplitFile={handleSelectSplitFile}
            boundariesEnabled={boundariesEnabled}
            onBoundariesEnabledChange={setBoundariesEnabled}
            fileBoundaries={selectedFileBoundaries}
            splitFileBoundaries={splitFileBoundaries}
            onBoundarySelect={handleTreeSelect}
            activeManifestRange={activeManifestRange}
            isNodeMapped={isNodeMapped}
            parentFile={canReturnToParentFile ? parentFile : null}
            onReturnToParentFile={canReturnToParentFile ? handleReturnToParentFile : undefined}
          />
        </div>
      </div>

      {/* Shortcut help overlay */}
      <ShortcutHelp
        open={shortcutHelpOpen}
        onClose={() => { setShortcutHelpOpen(false); }}
      />
    </div>
  );
}
