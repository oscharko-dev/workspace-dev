import { useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InspectorPanel } from "./inspector/InspectorPanel";

function BackIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" />
      <path d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" />
    </svg>
  );
}


export function InspectorPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const jobId = searchParams.get("jobId") ?? "";
  const previewUrl = searchParams.get("previewUrl") ?? "";
  const previousJobId = searchParams.get("previousJobId");
  const isRegeneration = searchParams.get("isRegeneration") === "true";

  const [activeJobId, setActiveJobId] = useState(jobId);

  const hasRequiredParams = Boolean(activeJobId && previewUrl);

  const activePreviewUrl = useMemo(() => {
    return previewUrl;
  }, [previewUrl]);

  if (!hasRequiredParams) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-white">
        <p className="text-lg font-medium text-[#333]">No job data available.</p>
        <p className="mt-2 text-sm text-[#666]">Navigate back to the workspace to start a generation.</p>
        <button
          type="button"
          onClick={() => { void navigate("/workspace/ui"); }}
          className="mt-4 cursor-pointer rounded-md bg-[#4eba87] px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
        >
          Back to Workspace
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Inspector Header */}
      <header className="shrink-0 border-b border-black/10 bg-white">
        <div className="flex w-full items-center justify-between px-6 pb-1 pt-4">
          {/* Left: Back + Logo */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { void navigate("/workspace/ui"); }}
              className="flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent p-0 text-sm font-medium text-[#333] hover:text-[#4eba87]"
            >
              <BackIcon />
              Back
            </button>

            <div className="flex items-center gap-3">
              <div className="grid size-8 place-items-center rounded-lg bg-emerald-500/10">
                <img
                  src="/workspace/ui/logo-keiko.svg"
                  alt=""
                  className="block size-5 object-contain"
                />
              </div>
              <div>
                <p className="m-0 text-[10px] font-normal uppercase tracking-wider text-[#666]">Workspace Dev</p>
                <h1 className="m-0 text-base font-medium tracking-tight text-[#333]">Inspector</h1>
              </div>
            </div>
          </div>

          {/* Right: Info + Actions */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#666]">
              Figma:v2(figmaSourceMode=rest &nbsp; llmCodegenMode=deterministic)
            </span>
            {activePreviewUrl ? (
              <a
                href={activePreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-sm font-medium text-[#333] no-underline transition hover:bg-slate-50"
              >
                <ExternalLinkIcon />
                Open runtime preview
              </a>
            ) : null}
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-[#333] transition hover:bg-slate-50"
            >
              Download source
            </button>
          </div>
        </div>
      </header>

      {/* Inspector Panel — full area */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorPanel
          jobId={activeJobId}
          previewUrl={activePreviewUrl}
          previousJobId={previousJobId}
          isRegenerationJob={isRegeneration}
          onRegenerationAccepted={(nextJobId) => {
            setActiveJobId(nextJobId);
          }}
        />
      </main>
    </div>
  );
}
