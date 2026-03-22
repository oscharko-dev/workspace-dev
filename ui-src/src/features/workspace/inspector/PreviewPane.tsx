import { useRef, useState, type JSX } from "react";
import { InspectOverlay } from "./InspectOverlay";

interface PreviewPaneProps {
  previewUrl: string;
  inspectEnabled: boolean;
  activeScopeNodeId: string | null;
  onToggleInspect: () => void;
  onInspectSelect: (irNodeId: string) => void;
}

export function PreviewPane({
  previewUrl,
  inspectEnabled,
  activeScopeNodeId,
  onToggleInspect,
  onInspectSelect
}: PreviewPaneProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);
  const [iframeLoadVersion, setIframeLoadVersion] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
          <span className="text-sm text-slate-500">Loading preview…</span>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        src={previewUrl}
        title="Live preview"
        className="h-full w-full flex-1 border-0"
        onLoad={() => {
          setIsLoading(false);
          setIframeLoadVersion((prev) => prev + 1);
        }}
        sandbox="allow-scripts allow-same-origin"
      />
      <InspectOverlay
        inspectEnabled={inspectEnabled}
        activeScopeNodeId={activeScopeNodeId}
        onToggleInspect={onToggleInspect}
        onSelectNode={onInspectSelect}
        iframeRef={iframeRef}
        iframeLoadVersion={iframeLoadVersion}
      />
    </div>
  );
}
