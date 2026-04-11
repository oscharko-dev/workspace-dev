import {
  useCallback,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type JSX,
} from "react";
import { filesFromDataTransfer, loadReportFromFiles } from "./data/file-source";
import { buildSampleReport } from "./data/sample-report";
import { type MergedReport } from "./data/types";

interface EmptyStateProps {
  onLoad: (report: MergedReport) => void;
  onError: (message: string) => void;
  errorMessage: string | null;
}

/**
 * Empty state shown before the user has loaded a report. Offers three paths:
 * (1) drag-and-drop files/directory, (2) file picker (`webkitdirectory`),
 * (3) "Load sample" button that hydrates an inlined sample report.
 */
export function EmptyState({
  onLoad,
  onError,
  errorMessage,
}: EmptyStateProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) {
        return;
      }
      try {
        const report = await loadReportFromFiles(files);
        onLoad(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError(message);
      }
    },
    [onLoad, onError],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = event.target.files;
      if (!files) {
        return;
      }
      void handleFiles(Array.from(files));
    },
    [handleFiles],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault();
      const files = await filesFromDataTransfer(event.dataTransfer);
      await handleFiles(files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleLoadSample = useCallback(() => {
    onLoad(buildSampleReport());
  }, [onLoad]);

  return (
    <div
      data-testid="visual-quality-empty-state"
      className="flex flex-col items-center gap-4 py-8"
    >
      <div
        onDrop={(event) => {
          void handleDrop(event);
        }}
        onDragOver={handleDragOver}
        className="flex w-full max-w-xl flex-col items-center gap-3 rounded-lg border border-dashed border-white/15 bg-[#171717] p-6 text-center"
      >
        <div className="text-sm font-semibold text-white">
          Load a visual benchmark report
        </div>
        <p className="m-0 max-w-md text-[11px] text-white/55">
          Drop a <span className="font-mono text-white/80">last-run.json</span>{" "}
          (and optionally the surrounding{" "}
          <span className="font-mono text-white/80">
            artifacts/visual-benchmark
          </span>{" "}
          directory) to view scores, diffs, and history. Diff PNGs are matched
          to screens by path.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="visual-quality-load-files"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            className="cursor-pointer rounded border border-[#4eba87] bg-[#4eba87]/12 px-3 py-1.5 text-[11px] font-medium text-[#4eba87] transition hover:bg-[#4eba87]/18"
          >
            Select files…
          </button>
          <button
            type="button"
            data-testid="visual-quality-load-sample"
            onClick={handleLoadSample}
            className="cursor-pointer rounded border border-white/15 bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-medium text-white/75 transition hover:border-white/30 hover:text-white"
          >
            Load sample
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          data-testid="visual-quality-file-input"
          onChange={handleChange}
          className="hidden"
          {...({
            webkitdirectory: "",
            directory: "",
          } as Record<string, string>)}
        />
        <p className="m-0 text-[10px] text-white/35">
          Tip: you can also load a report by appending{" "}
          <span className="font-mono text-white/55">
            ?report=https://…/last-run.json
          </span>{" "}
          to the page URL.
        </p>
      </div>
      {errorMessage ? (
        <div
          role="alert"
          className="rounded border border-rose-400/40 bg-rose-950/20 px-3 py-2 text-[11px] text-rose-200"
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
