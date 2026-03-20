import { useState, type JSX } from "react";

interface PreviewPaneProps {
  previewUrl: string;
}

export function PreviewPane({ previewUrl }: PreviewPaneProps): JSX.Element {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
          <span className="text-sm text-slate-500">Loading preview…</span>
        </div>
      ) : null}
      <iframe
        src={previewUrl}
        title="Live preview"
        className="h-full w-full flex-1 border-0"
        onLoad={() => {
          setIsLoading(false);
        }}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
