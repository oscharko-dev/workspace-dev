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
              className="flex items-center justify-center py-10 text-[11px] text-white/55"
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
              <ScoreDashboard report={report} />
              <HistoryChart history={report.history} />
              <GalleryView
                report={report}
                filterState={filterState}
                onFilterStateChange={handleFilterChange}
              />
            </>
          ) : null}
        </InspectorErrorBoundary>
      </main>
    </div>
  );
}
