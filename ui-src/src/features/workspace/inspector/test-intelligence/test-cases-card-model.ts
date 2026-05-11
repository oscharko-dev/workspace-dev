/**
 * Pure model for the polished test-cases card grid (Issue #1735).
 *
 * Lives apart from the React component so search + filter logic can be
 * tested without DOM overhead.
 */

import type {
  GeneratedTestCase,
  RegulatoryRelevanceDomain,
  TestCasePriority,
  TestCaseType,
} from "./types";

export interface TestCaseCardFilter {
  /** Trimmed, lower-case search query (matches title + objective + id). */
  query: string;
  /** Domain chip selection. `null` = all. */
  domain: RegulatoryRelevanceDomain | null;
  /** Type chip selection. `null` = all. */
  type: TestCaseType | null;
  /** Priority chip selection. `null` = all. */
  priority: TestCasePriority | null;
}

export const buildEmptyFilter = (): TestCaseCardFilter => ({
  query: "",
  domain: null,
  type: null,
  priority: null,
});

const matchesQuery = (testCase: GeneratedTestCase, query: string): boolean => {
  if (query.length === 0) return true;
  const haystack = [testCase.id, testCase.title, testCase.objective]
    .join(" \n")
    .toLowerCase();
  return haystack.includes(query);
};

const matchesDomain = (
  testCase: GeneratedTestCase,
  domain: RegulatoryRelevanceDomain | null,
): boolean => {
  if (domain === null) return true;
  return testCase.regulatoryRelevance?.domain === domain;
};

/**
 * Apply the filter to a list of generated test cases. Returns a fresh
 * array — does not mutate the input.
 */
export const filterTestCases = (
  testCases: readonly GeneratedTestCase[],
  filter: TestCaseCardFilter,
): readonly GeneratedTestCase[] => {
  const query = filter.query.trim().toLowerCase();
  return testCases.filter(
    (tc) =>
      matchesQuery(tc, query) &&
      matchesDomain(tc, filter.domain) &&
      (filter.type === null || tc.type === filter.type) &&
      (filter.priority === null || tc.priority === filter.priority),
  );
};

/** Tailwind class fragment for the regulatoryRelevance domain badge. */
export const DOMAIN_BADGE_CLASS: Readonly<
  Record<RegulatoryRelevanceDomain, string>
> = {
  banking: "border-sky-400/40 bg-sky-950/30 text-sky-200",
  insurance: "border-purple-400/40 bg-purple-950/30 text-purple-200",
  general: "border-white/15 bg-white/5 text-white/65",
};

/** Domain → human label. */
export const DOMAIN_LABEL: Readonly<Record<RegulatoryRelevanceDomain, string>> =
  {
    banking: "Banking",
    insurance: "Insurance",
    general: "General compliance",
  };

/** Priority → chip class. */
export const PRIORITY_BADGE_CLASS: Readonly<Record<TestCasePriority, string>> =
  {
    p0: "border-rose-400/40 bg-rose-950/30 text-rose-200",
    p1: "border-amber-400/40 bg-amber-950/30 text-amber-200",
    p2: "border-emerald-400/40 bg-emerald-950/30 text-emerald-200",
    p3: "border-white/15 bg-white/5 text-white/55",
  };
