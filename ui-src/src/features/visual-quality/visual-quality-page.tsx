import { useCallback, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { InspectorErrorBoundary } from "../workspace/inspector/InspectorErrorBoundary";
import { EmptyState } from "./empty-state";
import { GalleryView } from "./gallery/gallery-view";
import { ScoreDashboard } from "./dashboard/score-dashboard";
import { HistoryChart } from "./history/history-chart";
import {
  filterStateFromSearchParams,
  filterStateToSearchParams,
  type FilterState,
} from "./gallery/filter-logic";
import { loadReportFromUrl } from "./data/file-source";
import { type MergedReport } from "./data/types";

const FILTER_KEYS = new Set(["q", "fixture", "minScore", "severity", "sort"]);

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

function ReportNotices({
  notices,
}: {
  notices: string[] | undefined;
}): JSX.Element | null {
  if (!notices || notices.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="visual-quality-notices"
      className="rounded-md border border-amber-400/30 bg-amber-950/20 p-3 text-[11px] text-amber-200"
    >
      <h2 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wider">
        Notes
      </h2>
      <ul className="m-0 list-disc space-y-0.5 pl-4">
        {notices.map((notice, index) => (
          <li key={`${String(index)}-${notice}`}>{notice}</li>
        ))}
      </ul>
    </section>
  );
}

function VisualParitySummaryCard({
  report,
}: {
  report: NonNullable<MergedReport["paritySummary"]>;
}): JSX.Element {
  return (
    <section
      data-testid="visual-parity-summary"
      className="rounded-md border border-white/10 bg-[#171717] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/75">
            Visual parity summary
          </div>
          <h2 className="m-0 mt-1 text-sm font-semibold text-white">
            {report.status === "passed" ? "Passed" : "Warn"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[10px] uppercase tracking-wider text-white/60">
            mode {report.mode}
          </span>
          <span className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[10px] text-white/60">
            max diff {report.maxDiffPixelRatio}
          </span>
        </div>
      </div>

      <p className="m-0 mt-3 text-sm text-white/75">{report.details}</p>

      <dl className="m-0 mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-white/75">
            Baseline path
          </dt>
          <dd className="m-0 mt-1 break-all font-mono text-[11px] text-white/75">
            {report.baselinePath}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-white/75">
            Runtime preview URL
          </dt>
          <dd className="m-0 mt-1 break-all font-mono text-[11px] text-white/75">
            {report.runtimePreviewUrl}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Top-level route component for `/workspace/ui/visual-quality`.
 * Renders the empty state until a report is loaded (via file input, URL query
 * parameter, or sample data), then switches to the dashboard + gallery view.
 */
export function VisualQualityPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manualReport, setManualReport] = useState<MergedReport | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  const filterState = useMemo<FilterState>(
    () => filterStateFromSearchParams(searchParams),
    [searchParams],
  );

  const reportUrl = searchParams.get("report");

  const urlQuery = useQuery<MergedReport, Error>({
    queryKey: ["visual-quality-report", reportUrl],
    queryFn: () => {
      if (reportUrl === null) {
        return Promise.reject(new Error("No report URL provided."));
      }
      return loadReportFromUrl(reportUrl);
    },
    enabled: reportUrl !== null && manualReport === null,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const report: MergedReport | null = manualReport ?? urlQuery.data ?? null;
  const isLoadingFromUrl =
    reportUrl !== null && manualReport === null && urlQuery.isFetching;
  const urlErrorMessage =
    urlQuery.error instanceof Error ? urlQuery.error.message : null;
  const displayedError = manualError ?? urlErrorMessage;

  const handleFilterChange = useCallback(
    (next: FilterState) => {
      const params = new URLSearchParams(searchParams);
      for (const key of FILTER_KEYS) {
        params.delete(key);
      }
      const filterParams = filterStateToSearchParams(next);
      filterParams.forEach((value, key) => {
        params.set(key, value);
      });
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleReportLoaded = useCallback((next: MergedReport) => {
    setManualError(null);
    setManualReport(next);
  }, []);

  const handleReportError = useCallback((message: string) => {
    setManualError(message);
  }, []);

  const handleReset = useCallback(() => {
    setManualReport(null);
    setManualError(null);
    const params = new URLSearchParams(searchParams);
    params.delete("report");
    for (const key of FILTER_KEYS) {
      params.delete(key);
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex min-h-screen flex-col bg-[#101010] text-white">
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
            <div className="flex items-baseline gap-2">
              <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                Visual Quality
              </h1>
              <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                diff gallery
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report ? (
              <button
                type="button"
                data-testid="visual-quality-reset"
                onClick={handleReset}
                className="cursor-pointer rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] font-medium text-white/60 transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
              >
                Load another report
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
        <InspectorErrorBoundary>
          {isLoadingFromUrl ? (
            <div
              data-testid="visual-quality-loading"
              className="flex items-center justify-center py-10 text-[11px] text-white/85"
            >
              Loading report from URL…
            </div>
          ) : null}
          {!report && !isLoadingFromUrl ? (
            <EmptyState
              onLoad={handleReportLoaded}
              onError={handleReportError}
              errorMessage={displayedError}
            />
          ) : null}
          {report ? (
            <>
              <ReportNotices notices={report.notices} />
              {report.paritySummary ? (
                <VisualParitySummaryCard report={report.paritySummary} />
              ) : (
                <>
                  <ScoreDashboard report={report} />
                  <HistoryChart history={report.history} />
                  <GalleryView
                    report={report}
                    filterState={filterState}
                    onFilterStateChange={handleFilterChange}
                  />
                </>
              )}
            </>
          ) : null}
        </InspectorErrorBoundary>
      </main>
    </div>
  );
}
