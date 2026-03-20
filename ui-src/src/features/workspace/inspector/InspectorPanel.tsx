import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import { PreviewPane } from "./PreviewPane";
import { CodePane, type HighlightRange } from "./CodePane";
import { ComponentTree, type TreeNode } from "./component-tree";

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

  const encodedJobId = encodeURIComponent(jobId);

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

  const irScreens = useMemo<DesignIrScreen[]>(() => {
    if (!designIrQuery.data?.ok || !isDesignIrPayload(designIrQuery.data.payload)) {
      return [];
    }
    return designIrQuery.data.payload.screens;
  }, [designIrQuery.data]);

  // --- Auto-select first screen file from manifest ---
  useEffect(() => {
    if (selectedFile) {
      return;
    }

    if (manifest?.screens?.length) {
      const firstScreen = manifest.screens[0];
      if (firstScreen && firstScreen.file) {
        setSelectedFile(firstScreen.file);
        return;
      }
    }

    const codeFiles = files.filter(
      (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts")
    );
    if (codeFiles.length > 0 && codeFiles[0]) {
      setSelectedFile(codeFiles[0].path);
    }
  }, [files, manifest, selectedFile]);

  const fileContentQuery = useQuery({
    queryKey: ["inspector-file-content", jobId, selectedFile],
    enabled: Boolean(selectedFile),
    queryFn: async () => {
      if (!selectedFile) {
        throw new Error("No file selected");
      }
      const resp = await fetch(
        `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(selectedFile)}`
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

  return (
    <div data-testid="inspector-panel" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <h2 className="m-0 text-xl font-bold text-slate-900">Inspector</h2>
        <p className="m-0 text-sm text-slate-600">Live preview and generated source code</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* Left: Component Tree sidebar */}
        {treeNodes.length > 0 ? (
          <ComponentTree
            screens={treeNodes}
            selectedId={selectedNodeId}
            onSelect={handleTreeSelect}
            collapsed={treeCollapsed}
            onToggleCollapsed={() => {
              setTreeCollapsed((prev) => !prev);
            }}
          />
        ) : null}

        {/* Center: Preview pane */}
        <div className="relative min-h-[200px] flex-1 lg:min-h-0" style={{ resize: "none" }}>
          <PreviewPane
            previewUrl={previewUrl}
            inspectEnabled={inspectEnabled}
            onToggleInspect={handleToggleInspect}
            onInspectSelect={handleInspectSelect}
          />
        </div>

        {/* Resizable divider */}
        <div
          className="hidden shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-slate-400 lg:block lg:w-1"
          aria-hidden="true"
          style={{ touchAction: "none" }}
        />

        {/* Horizontal divider for stacked layout */}
        <div className="h-px shrink-0 bg-slate-200 lg:hidden" />

        {/* Right: Code pane */}
        <div className="min-h-[200px] flex-1 lg:min-h-0">
          <CodePane
            files={files}
            selectedFile={selectedFile}
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
