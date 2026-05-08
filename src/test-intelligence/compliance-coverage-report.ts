/**
 * Compliance coverage report (Issue #2042).
 *
 * Aggregates the per-test-case annotations produced by the
 * `compliance_annotator` deterministic service into a per-framework
 * and per-article coverage view that an auditor can consume directly.
 *
 * The report is pure: identical annotations always serialise to an
 * identical report. It does not validate compliance itself — it only
 * surfaces whether at least one generated test case applies (and
 * satisfies the mandatory test classes) for each rule, so the
 * auditor can decide whether the suite is acceptable.
 */

import type {
  ComplianceAnnotationArtifact,
  ComplianceAnnotationEntry,
} from "./compliance-annotator-agent.js";
import {
  type ComplianceFrameworkId,
  type ComplianceRule,
  type ComplianceRuleSeverity,
  COMPLIANCE_RULE_PACK_REGISTRY,
} from "./compliance-rules.js";

export const COMPLIANCE_COVERAGE_REPORT_SCHEMA_VERSION = "1.0.0" as const;

export const COMPLIANCE_COVERAGE_REPORT_ARTIFACT_FILENAME =
  "compliance-coverage-report.json" as const;

/** Coverage outcome for a single rule. */
export interface ComplianceRuleCoverage {
  readonly ruleId: string;
  readonly citation: string;
  readonly severity: ComplianceRuleSeverity;
  readonly mandatoryTestClasses: readonly string[];
  readonly applicableCases: number;
  readonly satisfyingCases: number;
  /** True iff at least one applicable case satisfies the mandatory class set. */
  readonly covered: boolean;
}

/** Coverage outcome for a single framework. */
export interface ComplianceFrameworkCoverage {
  readonly framework: ComplianceFrameworkId;
  readonly title: string;
  readonly citationRoot: string;
  readonly totalRules: number;
  readonly coveredRules: number;
  readonly uncoveredRules: number;
  /** 0..1, rounded to 6 decimal digits. `0` when totalRules is `0`. */
  readonly coverageRatio: number;
  /** Whether any rule with `severity === "error"` is uncovered. */
  readonly hasUncoveredErrorRule: boolean;
  readonly rules: readonly ComplianceRuleCoverage[];
}

/** Run-level coverage report. */
export interface ComplianceCoverageReport {
  readonly schemaVersion: typeof COMPLIANCE_COVERAGE_REPORT_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly activeFrameworks: readonly ComplianceFrameworkId[];
  readonly totalTestCases: number;
  readonly annotatedTestCases: number;
  readonly frameworks: readonly ComplianceFrameworkCoverage[];
  /** Aggregate ratio across all rules of all active frameworks. */
  readonly overallCoverageRatio: number;
  /** True iff any active framework has an uncovered error-severity rule. */
  readonly hasUncoveredErrorRule: boolean;
}

const roundRatio = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

const indexEntriesByRuleId = (
  entries: readonly ComplianceAnnotationEntry[],
): ReadonlyMap<
  string,
  { applicable: number; satisfying: number }
> => {
  const counters = new Map<string, { applicable: number; satisfying: number }>();
  for (const entry of entries) {
    for (const match of entry.matches) {
      const existing = counters.get(match.ruleId) ?? {
        applicable: 0,
        satisfying: 0,
      };
      existing.applicable += 1;
      if (match.satisfiesMandatoryTestClass) existing.satisfying += 1;
      counters.set(match.ruleId, existing);
    }
  }
  return counters;
};

const buildRuleCoverage = (
  rule: ComplianceRule,
  counters: ReadonlyMap<string, { applicable: number; satisfying: number }>,
): ComplianceRuleCoverage => {
  const counter = counters.get(rule.id) ?? { applicable: 0, satisfying: 0 };
  const covered = counter.satisfying > 0;
  return Object.freeze({
    ruleId: rule.id,
    citation: rule.citation,
    severity: rule.severity,
    mandatoryTestClasses: Object.freeze([
      ...rule.mandatoryTestClasses,
    ]) as readonly string[],
    applicableCases: counter.applicable,
    satisfyingCases: counter.satisfying,
    covered,
  });
};

export interface BuildComplianceCoverageReportInput {
  readonly annotations: ComplianceAnnotationArtifact;
  readonly totalTestCases: number;
}

/**
 * Build the coverage report from an annotation artifact. Pure.
 */
export const buildComplianceCoverageReport = (
  input: BuildComplianceCoverageReportInput,
): ComplianceCoverageReport => {
  const counters = indexEntriesByRuleId(input.annotations.entries);
  const frameworks: ComplianceFrameworkCoverage[] = [];
  let totalRulesAcross = 0;
  let coveredRulesAcross = 0;
  let hasUncoveredError = false;

  const sortedFrameworks = [...input.annotations.activeFrameworks].sort(
    (a, b) => a.localeCompare(b),
  );

  for (const framework of sortedFrameworks) {
    const pack = COMPLIANCE_RULE_PACK_REGISTRY[framework];
    const ruleCoverages = pack.rules.map((rule) =>
      buildRuleCoverage(rule, counters),
    );
    const total = ruleCoverages.length;
    const covered = ruleCoverages.filter((rc) => rc.covered).length;
    const uncoveredErrors = ruleCoverages.some(
      (rc) => !rc.covered && rc.severity === "error",
    );
    if (uncoveredErrors) hasUncoveredError = true;

    totalRulesAcross += total;
    coveredRulesAcross += covered;

    frameworks.push(
      Object.freeze({
        framework,
        title: pack.title,
        citationRoot: pack.citationRoot,
        totalRules: total,
        coveredRules: covered,
        uncoveredRules: total - covered,
        coverageRatio: total === 0 ? 0 : roundRatio(covered / total),
        hasUncoveredErrorRule: uncoveredErrors,
        rules: Object.freeze(ruleCoverages),
      }),
    );
  }

  const annotatedTestCases = input.annotations.entries.filter(
    (e) => e.appliesTo.length > 0,
  ).length;

  return Object.freeze({
    schemaVersion: COMPLIANCE_COVERAGE_REPORT_SCHEMA_VERSION,
    jobId: input.annotations.jobId,
    generatedAt: input.annotations.generatedAt,
    activeFrameworks: Object.freeze(sortedFrameworks),
    totalTestCases: input.totalTestCases,
    annotatedTestCases,
    frameworks: Object.freeze(frameworks),
    overallCoverageRatio:
      totalRulesAcross === 0
        ? 0
        : roundRatio(coveredRulesAcross / totalRulesAcross),
    hasUncoveredErrorRule: hasUncoveredError,
  });
};
