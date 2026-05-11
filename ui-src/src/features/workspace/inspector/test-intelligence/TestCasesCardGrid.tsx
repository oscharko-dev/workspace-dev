/**
 * Beautiful test-cases card grid (Issue #1735 polish).
 *
 * Replaces the legacy flat list. Each case is a self-contained card
 * with title, type chip, priority chip, risk badge, and an optional
 * regulatoryRelevance domain badge (banking blue / insurance purple /
 * general gray). Click expands the card inline to show the objective +
 * rationale tooltip.
 *
 * Filtering:
 *   - debounced search (200 ms) over title + objective + id
 *   - filter chips: domain (banking/insurance/general), type, priority
 *   - explicit empty-state UI when filters yield zero cases
 *
 * WCAG 2.2 AA:
 *   - Each card is a button (keyboard-focusable, role=button)
 *   - Focus rings use the brand color with offset
 *   - Filter chips are checkboxes (aria-pressed via data attribute is
 *     additional, role-correct via type=button + aria-pressed)
 *   - Empty state announces via role=status
 */

import { useEffect, useMemo, useState, type JSX } from "react";

import {
  DOMAIN_BADGE_CLASS,
  DOMAIN_LABEL,
  PRIORITY_BADGE_CLASS,
  buildEmptyFilter,
  filterTestCases,
  type TestCaseCardFilter,
} from "./test-cases-card-model";
import type {
  GeneratedTestCase,
  RegulatoryRelevanceDomain,
  TestCasePriority,
  TestCaseType,
} from "./types";

export interface TestCasesCardGridProps {
  testCases: readonly GeneratedTestCase[];
  selectedTestCaseId: string | null;
  onSelect: (id: string) => void;
  /** Optional debounce for the search input (ms). Defaults to 200. */
  searchDebounceMs?: number;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

const ALL_DOMAINS: readonly RegulatoryRelevanceDomain[] = [
  "banking",
  "insurance",
  "general",
];

const ALL_TYPES: readonly TestCaseType[] = [
  "functional",
  "boundary",
  "negative",
  "validation",
  "navigation",
  "regression",
  "exploratory",
  "accessibility",
];

const ALL_PRIORITIES: readonly TestCasePriority[] = ["p0", "p1", "p2", "p3"];

export function TestCasesCardGrid({
  testCases,
  selectedTestCaseId,
  onSelect,
  searchDebounceMs = 200,
}: TestCasesCardGridProps): JSX.Element {
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<TestCaseCardFilter>(() =>
    buildEmptyFilter(),
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(rawQuery);
    }, searchDebounceMs);
    return () => clearTimeout(timeout);
  }, [rawQuery, searchDebounceMs]);

  const effectiveFilter = useMemo<TestCaseCardFilter>(
    () => ({ ...filter, query: debouncedQuery }),
    [filter, debouncedQuery],
  );

  const filtered = useMemo(
    () => filterTestCases(testCases, effectiveFilter),
    [testCases, effectiveFilter],
  );

  return (
    <section
      data-testid="ti-test-cases-card-grid"
      aria-labelledby="ti-test-cases-card-grid-heading"
      className="flex flex-col gap-3"
    >
      <header className="flex flex-col gap-2">
        <h3
          id="ti-test-cases-card-grid-heading"
          className="m-0 text-sm font-semibold text-white"
        >
          Generated test cases ({filtered.length} of {testCases.length})
        </h3>

        <label
          className="flex flex-col gap-1 text-[11px] text-white/65"
          htmlFor="ti-test-cases-card-grid-search"
        >
          Search
          <input
            id="ti-test-cases-card-grid-search"
            data-testid="ti-test-cases-card-grid-search"
            type="search"
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            placeholder="Filter by title, objective, or id"
            className={`w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 text-[12px] text-white/85 ${FOCUS_RING_CLASS}`}
          />
        </label>

        <FilterChipRow label="Domain">
          {ALL_DOMAINS.map((domain) => (
            <FilterChip
              key={domain}
              label={DOMAIN_LABEL[domain]}
              active={filter.domain === domain}
              onToggle={() =>
                setFilter((current) => ({
                  ...current,
                  domain: current.domain === domain ? null : domain,
                }))
              }
              testId={`ti-test-cases-card-grid-chip-domain-${domain}`}
            />
          ))}
        </FilterChipRow>

        <FilterChipRow label="Type">
          {ALL_TYPES.map((type) => (
            <FilterChip
              key={type}
              label={type}
              active={filter.type === type}
              onToggle={() =>
                setFilter((current) => ({
                  ...current,
                  type: current.type === type ? null : type,
                }))
              }
              testId={`ti-test-cases-card-grid-chip-type-${type}`}
            />
          ))}
        </FilterChipRow>

        <FilterChipRow label="Priority">
          {ALL_PRIORITIES.map((priority) => (
            <FilterChip
              key={priority}
              label={priority.toUpperCase()}
              active={filter.priority === priority}
              onToggle={() =>
                setFilter((current) => ({
                  ...current,
                  priority: current.priority === priority ? null : priority,
                }))
              }
              testId={`ti-test-cases-card-grid-chip-priority-${priority}`}
            />
          ))}
        </FilterChipRow>
      </header>

      {filtered.length === 0 ? (
        <p
          data-testid="ti-test-cases-card-grid-empty"
          role="status"
          className="m-0 rounded border border-white/10 bg-[#0a0a0a] px-3 py-4 text-center text-[12px] text-white/65"
        >
          No test cases match the current filters.
        </p>
      ) : (
        <ul
          data-testid="ti-test-cases-card-grid-list"
          className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2"
        >
          {filtered.map((tc) => (
            <TestCaseCard
              key={tc.id}
              testCase={tc}
              selected={tc.id === selectedTestCaseId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onToggle,
  testId,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  testId: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      onClick={onToggle}
      className={`cursor-pointer rounded border px-2 py-[2px] text-[10px] uppercase tracking-[0.14em] ${
        active
          ? "border-[#4eba87]/50 bg-emerald-950/30 text-[#4eba87]"
          : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
      } ${FOCUS_RING_CLASS}`}
    >
      {label}
    </button>
  );
}

function TestCaseCard({
  testCase,
  selected,
  onSelect,
}: {
  testCase: GeneratedTestCase;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const reg = testCase.regulatoryRelevance;
  return (
    <li className="m-0">
      <button
        type="button"
        data-testid={`ti-test-cases-card-${testCase.id}`}
        data-selected={selected ? "true" : "false"}
        onClick={() => onSelect(testCase.id)}
        aria-pressed={selected}
        className={`flex w-full flex-col gap-2 rounded border bg-[#0a0a0a] p-3 text-left ${
          selected
            ? "border-[#4eba87]/50 bg-emerald-950/20"
            : "border-white/10 hover:border-white/20"
        } ${FOCUS_RING_CLASS}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex-1 text-[12px] font-semibold text-white">
            {testCase.title}
          </span>
          <span className="font-mono text-[10px] text-white/45">
            {testCase.id}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-[1px] text-[10px] uppercase tracking-[0.14em] text-white/65">
            {testCase.type}
          </span>
          <span
            className={`rounded border px-1.5 py-[1px] text-[10px] uppercase tracking-[0.14em] ${PRIORITY_BADGE_CLASS[testCase.priority]}`}
          >
            {testCase.priority.toUpperCase()}
          </span>
          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-[1px] text-[10px] uppercase tracking-[0.14em] text-white/55">
            risk {testCase.riskCategory}
          </span>
          {reg !== undefined ? (
            <span
              data-testid={`ti-test-cases-card-${testCase.id}-domain-badge`}
              data-domain={reg.domain}
              title={reg.rationale ?? DOMAIN_LABEL[reg.domain]}
              aria-label={`Regulatory domain: ${DOMAIN_LABEL[reg.domain]}${reg.rationale !== undefined ? `. ${reg.rationale}` : ""}`}
              className={`rounded border px-1.5 py-[1px] text-[10px] uppercase tracking-[0.14em] ${DOMAIN_BADGE_CLASS[reg.domain]}`}
            >
              {DOMAIN_LABEL[reg.domain]}
            </span>
          ) : null}
        </div>
        {selected ? (
          <p
            data-testid={`ti-test-cases-card-${testCase.id}-objective`}
            className="m-0 text-[11px] leading-5 text-white/65"
          >
            {testCase.objective}
          </p>
        ) : null}
      </button>
    </li>
  );
}
