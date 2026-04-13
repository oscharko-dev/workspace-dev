import { useCallback, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InspectorPanel } from "./inspector/InspectorPanel";
import { InspectorErrorBoundary } from "./inspector/InspectorErrorBoundary";
import { InspectorBootstrap } from "./inspector/InspectorBootstrap";
import { useInspectorBootstrap } from "./inspector/useInspectorBootstrap";

function BackIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
    >
      <path
        fillRule="evenodd"
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
    >
      <path d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" />
      <path d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
    >
      <path
        fillRule="evenodd"
        d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.916a.5.5 0 0 1 .67.033l.774.775a.5.5 0 0 1 .034.67l-.916 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.497v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.916 1.321a.5.5 0 0 1-.034.67l-.774.774a.5.5 0 0 1-.67.033l-1.32-.916c-.417.25-.873.443-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a4.973 4.973 0 0 1-1.356-.562l-1.321.916a.5.5 0 0 1-.67-.034l-.774-.774a.5.5 0 0 1-.034-.67l.916-1.32a4.972 4.972 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.916-1.321a.5.5 0 0 1 .034-.67l.774-.774a.5.5 0 0 1 .67-.033l1.32.916c.417-.25.873-.443 1.357-.563l.17-1.699ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export type ConfigDialogKey =
  | "preApplyReview"
  | "localSync"
  | "createPr"
  | "inspectability";

const CONFIG_BUTTONS: { key: ConfigDialogKey; label: string }[] = [
  { key: "preApplyReview", label: "Review" },
  { key: "localSync", label: "Sync" },
  { key: "createPr", label: "PR" },
  { key: "inspectability", label: "Coverage" },
];

interface PanelViewProps {
  jobId: string;
  previewUrl: string;
  previousJobId: string | null;
  initialIsRegeneration: boolean;
}

function PanelView({
  jobId,
  previewUrl,
  previousJobId,
  initialIsRegeneration,
}: PanelViewProps): JSX.Element {
  const navigate = useNavigate();
  const [activeJobId, setActiveJobId] = useState(jobId);
  const [activeIsRegenerationJob, setActiveIsRegenerationJob] = useState(
    initialIsRegeneration,
  );
  const [openDialog, setOpenDialog] = useState<ConfigDialogKey | null>(null);

  const activePreviewUrl = useMemo(() => {
    return previewUrl;
  }, [previewUrl]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#101010] text-white">
      <header className="shrink-0 border-b border-[#000000] bg-[#171717]">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigate("/workspace/ui");
              }}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-white/60 transition hover:border-white/10 hover:bg-[#000000] hover:text-[#4eba87]"
            >
              <BackIcon />
              Back
            </button>

            <div className="h-4 w-px bg-[#333333]" />

            <div className="flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded border border-[#000000] bg-[#333333]">
                <img
                  src="/workspace/ui/logo-keiko.svg"
                  alt=""
                  className="block size-4 object-contain"
                />
              </div>
              <div className="flex items-baseline gap-2">
                <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                  Inspector
                </h1>
                <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                  workspace-dev
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {CONFIG_BUTTONS.map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => {
                  setOpenDialog(btn.key);
                }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                  openDialog === btn.key
                    ? "border-[#4eba87] bg-[#4eba87]/12 text-[#4eba87]"
                    : "border-transparent bg-transparent text-white/55 hover:border-white/10 hover:bg-[#000000] hover:text-white"
                }`}
              >
                <SettingsIcon />
                {btn.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded border border-[#000000] bg-[#222222] px-2 py-0.5 text-[10px] font-mono text-white/45">
              rest + deterministic
            </span>
            {activePreviewUrl ? (
              <a
                href={activePreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-[#333333] bg-transparent px-2 py-1 text-[11px] font-medium text-white/60 no-underline transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
              >
                <ExternalLinkIcon />
                Preview
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <InspectorErrorBoundary>
          <InspectorPanel
            jobId={activeJobId}
            previewUrl={activePreviewUrl}
            previousJobId={previousJobId}
            isRegenerationJob={activeIsRegenerationJob}
            onRegenerationAccepted={(nextJobId) => {
              setActiveJobId(nextJobId);
              setActiveIsRegenerationJob(true);
            }}
            openDialog={openDialog}
            onCloseDialog={() => {
              setOpenDialog(null);
            }}
          />
        </InspectorErrorBoundary>
      </main>
    </div>
  );
}

function BootstrapView(): JSX.Element {
  const bootstrap = useInspectorBootstrap();

  const handlePaste = useCallback(
    (text: string): void => {
      bootstrap.submitPaste(text, { source: "paste-event" });
    },
    // `bootstrap` is a stable reference to the hook's return object; we re-run
    // when the object identity changes so we always submit via the latest
    // closure. The listed dep is intentional.
    [bootstrap],
  );

  const handleDropFile = useCallback(
    (text: string): void => {
      bootstrap.submitPaste(text, { source: "drop" });
    },
    [bootstrap],
  );

  const handleError = useCallback(
    (code: "TOO_LARGE" | "UNSUPPORTED_FILE"): void => {
      bootstrap.reportInputError(code);
    },
    [bootstrap],
  );

  const handleRetry = useCallback((): void => {
    bootstrap.retry();
  }, [bootstrap]);

  if (
    bootstrap.state.kind === "ready" &&
    bootstrap.jobId &&
    bootstrap.previewUrl
  ) {
    return (
      <PanelView
        jobId={bootstrap.jobId}
        previewUrl={bootstrap.previewUrl}
        previousJobId={null}
        initialIsRegeneration={false}
      />
    );
  }

  return (
    <InspectorBootstrap
      state={bootstrap.state}
      onPaste={handlePaste}
      onDropFile={handleDropFile}
      onError={handleError}
      onRetry={handleRetry}
    />
  );
}

export function InspectorPage(): JSX.Element {
  const [searchParams] = useSearchParams();

  const jobId = searchParams.get("jobId") ?? "";
  const previewUrl = searchParams.get("previewUrl") ?? "";
  const previousJobId = searchParams.get("previousJobId");
  const isRegeneration = searchParams.get("isRegeneration") === "true";

  const hasDeepLinkParams = Boolean(jobId && previewUrl);

  if (hasDeepLinkParams) {
    return (
      <PanelView
        jobId={jobId}
        previewUrl={previewUrl}
        previousJobId={previousJobId}
        initialIsRegeneration={isRegeneration}
      />
    );
  }

  return <BootstrapView />;
}
