import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import { PreviewPane } from "./PreviewPane";
import { CodePane } from "./CodePane";

interface FileEntry {
  path: string;
  sizeBytes: number;
}

interface FilesPayload {
  jobId: string;
  files: FileEntry[];
}

interface ComponentManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
}

interface ComponentManifestPayload {
  jobId: string;
  screens: ComponentManifestScreen[];
}

interface InspectorPanelProps {
  jobId: string;
  previewUrl: string;
}

function isFilesPayload(value: unknown): value is FilesPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return typeof rec.jobId === "string" && Array.isArray(rec.files);
}

export function InspectorPanel({ jobId, previewUrl }: InspectorPanelProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const encodedJobId = encodeURIComponent(jobId);

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

  const files = useMemo<FileEntry[]>(() => {
    if (!filesQuery.data?.ok || !isFilesPayload(filesQuery.data.payload)) {
      return [];
    }
    return filesQuery.data.payload.files;
  }, [filesQuery.data]);

  // Auto-select the first screen file from manifest, or first .tsx file
  useEffect(() => {
    if (selectedFile) {
      return;
    }

    const manifestPayload = manifestQuery.data?.payload as ComponentManifestPayload | undefined;
    if (manifestPayload?.screens?.length) {
      const firstScreen = manifestPayload.screens[0];
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
  }, [files, manifestQuery.data, selectedFile]);

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

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
  }, []);

  return (
    <div data-testid="inspector-panel" className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <h2 className="m-0 text-xl font-bold text-slate-900">Inspector</h2>
        <p className="m-0 text-sm text-slate-600">Live preview and generated source code</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: Preview pane */}
        <div className="relative min-h-[200px] flex-1 lg:min-h-0" style={{ resize: "none" }}>
          <PreviewPane previewUrl={previewUrl} />
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
          />
        </div>
      </div>
    </div>
  );
}
