import { useMemo, useState, type JSX } from "react";
import { type MergedReport, type MergedScreen } from "../data/types";
import { ScreenCard } from "./screen-card";
import { ScreenDetail } from "./screen-detail";
import { FilterControls } from "./filter-controls";
import {
  applyFilters,
  buildPreviousScoreMap,
  type FilterState,
} from "./filter-logic";

interface GalleryViewProps {
  report: MergedReport;
  filterState: FilterState;
  onFilterStateChange: (next: FilterState) => void;
}

/**
 * Main gallery layout: filter bar on top, cards in a responsive grid on the
 * left, selected screen detail on the right.
 */
export function GalleryView({
  report,
  filterState,
  onFilterStateChange,
}: GalleryViewProps): JSX.Element {
  const allScreens = useMemo<MergedScreen[]>(
    () => report.fixtures.flatMap((fixture) => fixture.screens),
    [report],
  );
  const fixtureOptions = useMemo(
    () => report.fixtures.map((f) => f.fixtureId),
    [report],
  );
  const previousScores = useMemo(() => {
    if (!report.history) {
      return {};
    }
    return buildPreviousScoreMap(
      report.history.entries,
      report.aggregate.ranAt,
    );
  }, [report]);

  const filtered = useMemo(
    () => applyFilters(allScreens, filterState, previousScores),
    [allScreens, filterState, previousScores],
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => filtered[0]?.key ?? null,
  );

  const selected = useMemo(() => {
    if (selectedKey) {
      const match = filtered.find((s) => s.key === selectedKey);
      if (match) {
        return match;
      }
    }
    return filtered[0] ?? null;
  }, [selectedKey, filtered]);

  return (
    <div data-testid="gallery-view" className="flex flex-col gap-3">
      <FilterControls
        state={filterState}
        fixtureOptions={fixtureOptions}
        onChange={onFilterStateChange}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,_1.15fr)_minmax(0,_1fr)]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-[11px] text-white/85">
            <span>
              {filtered.length} of {allScreens.length} screens
            </span>
            {!report.hasImages ? (
              <span className="rounded border border-amber-400/30 bg-amber-950/20 px-1.5 py-0.5 text-amber-200">
                No images attached
              </span>
            ) : null}
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-[#171717] p-6 text-center text-[11px] text-white/75">
              No screens match the current filters.
            </div>
          ) : (
            <div
              data-testid="gallery-grid"
              className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"
            >
              {filtered.map((screen) => {
                const prev = previousScores[screen.key];
                const delta =
                  prev !== undefined ? screen.score - prev : undefined;
                const deltaLabel =
                  delta !== undefined
                    ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`
                    : undefined;
                const cardProps = {
                  screen,
                  selected: selected?.key === screen.key,
                  onSelect: () => {
                    setSelectedKey(screen.key);
                  },
                  ...(deltaLabel !== undefined ? { deltaLabel } : {}),
                };
                return <ScreenCard key={screen.key} {...cardProps} />;
              })}
            </div>
          )}
        </section>

        <aside className="min-w-0 rounded-md border border-white/10 bg-[#101010] p-3">
          {selected ? (
            <ScreenDetail screen={selected} />
          ) : (
            <p className="m-0 text-[11px] text-white/75">
              Select a screen to see its diff detail.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
