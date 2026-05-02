import { type ChangeEvent, type JSX } from "react";
import { SORT_OPTIONS, type FilterState, type SortKey } from "./filter-logic";
import { type HotspotSeverity } from "../data/types";

interface FilterControlsProps {
  state: FilterState;
  fixtureOptions: string[];
  onChange: (next: FilterState) => void;
}

const SEVERITY_OPTIONS: HotspotSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/**
 * Filter + sort toolbar. Stateless — bubbles every change back up via
 * `onChange` so the caller controls the source of truth and can persist it
 * into the URL query string.
 */
export function FilterControls({
  state,
  fixtureOptions,
  onChange,
}: FilterControlsProps): JSX.Element {
  function toggleFixture(fixtureId: string): void {
    const next = state.fixtures.includes(fixtureId)
      ? state.fixtures.filter((f) => f !== fixtureId)
      : [...state.fixtures, fixtureId];
    onChange({ ...state, fixtures: next });
  }

  function toggleSeverity(severity: HotspotSeverity): void {
    const next = state.severities.includes(severity)
      ? state.severities.filter((s) => s !== severity)
      : [...state.severities, severity];
    onChange({ ...state, severities: next });
  }

  function handleMinScore(event: ChangeEvent<HTMLInputElement>): void {
    const parsed = Number.parseFloat(event.target.value);
    const value = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : 0;
    onChange({ ...state, minScore: value });
  }

  return (
    <div
      data-testid="filter-controls"
      className="flex flex-col gap-2 rounded-md border border-white/10 bg-[#171717] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-1 min-w-[180px] flex-col gap-0.5 text-[10px] uppercase tracking-wider text-white/75">
          Search
          <input
            type="search"
            data-testid="filter-query"
            value={state.query}
            placeholder="fixture or screen…"
            onChange={(event) => {
              onChange({ ...state, query: event.target.value });
            }}
            className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] text-white placeholder-white/35 focus:border-[#4eba87]/60 focus:outline-none"
          />
        </label>
        <label className="flex w-[120px] flex-col gap-0.5 text-[10px] uppercase tracking-wider text-white/75">
          Min score
          <input
            type="number"
            data-testid="filter-min-score"
            min={0}
            max={100}
            step={1}
            value={state.minScore}
            onChange={handleMinScore}
            className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] text-white focus:border-[#4eba87]/60 focus:outline-none"
          />
        </label>
        <label className="flex w-[200px] flex-col gap-0.5 text-[10px] uppercase tracking-wider text-white/75">
          Sort by
          <select
            data-testid="filter-sort"
            value={state.sort}
            onChange={(event) => {
              onChange({ ...state, sort: event.target.value as SortKey });
            }}
            className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] text-white focus:border-[#4eba87]/60 focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fixtureOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/75">
            Fixtures:
          </span>
          {fixtureOptions.map((fixture) => {
            const active = state.fixtures.includes(fixture);
            return (
              <button
                key={fixture}
                type="button"
                data-testid={`fixture-chip-${fixture}`}
                onClick={() => {
                  toggleFixture(fixture);
                }}
                aria-pressed={active}
                className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition ${
                  active
                    ? "border-[#4eba87] bg-[#4eba87]/12 text-[#4eba87]"
                    : "border-white/10 bg-[#0a0a0a] text-white/85 hover:border-white/25 hover:text-white"
                }`}
              >
                {fixture}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-white/75">
          Severity:
        </span>
        {SEVERITY_OPTIONS.map((severity) => {
          const active = state.severities.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              data-testid={`severity-chip-${severity}`}
              onClick={() => {
                toggleSeverity(severity);
              }}
              aria-pressed={active}
              className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] uppercase transition ${
                active
                  ? "border-[#4eba87] bg-[#4eba87]/12 text-[#4eba87]"
                  : "border-white/10 bg-[#0a0a0a] text-white/85 hover:border-white/25 hover:text-white"
              }`}
            >
              {severity}
            </button>
          );
        })}
      </div>
    </div>
  );
}
