/**
 * Compliance annotator (Issue #2042).
 *
 * Deterministic post-processing service that runs after the production
 * runner emits its `GeneratedTestCaseList`. For each test case, the
 * annotator scans the case content (title, objective, preconditions,
 * test data, step actions, expected results) for the keyword set
 * declared on every active compliance rule and produces a stable
 * `appliesTo: [...rule ids]` annotation.
 *
 * The service is pure — given the same `(testCases, frameworks)`
 * inputs, it always emits the same annotations. It does not mutate the
 * `GeneratedTestCase` payload (the runtime contract stays
 * byte-stable); the annotations are surfaced as a side artifact and
 * folded into the compliance-coverage report.
 *
 * Design note: this module plays the role of the
 * `compliance_annotator` agent role described in Issue #2042. It is
 * implemented as a deterministic_service so the harness's hard
 * invariants on `AgentHarnessRole` profiles remain unchanged — the
 * annotator never calls an LLM, so it does not need an LLM model
 * binding or prompt-template version.
 */

import type { GeneratedTestCase } from "../contracts/index.js";
import {
  type ComplianceFrameworkId,
  type ComplianceRule,
  type ComplianceRulePack,
  COMPLIANCE_RULE_PACK_REGISTRY,
} from "./compliance-rules.js";

/**
 * Stable schema version for the annotation artifact emitted by this
 * service. Bump on breaking shape changes.
 */
export const COMPLIANCE_ANNOTATION_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Canonical filename for the persisted annotation artifact when
 * written next to the run's other artifacts.
 */
export const COMPLIANCE_ANNOTATION_ARTIFACT_FILENAME =
  "compliance-annotations.json" as const;

/** Single rule applicable to a single test case. */
export interface ComplianceAnnotationMatch {
  /** Stable rule id (e.g. `"PSD2-SCA-Art-97"`). */
  readonly ruleId: string;
  /** Originating framework id (e.g. `"PSD2"`). */
  readonly framework: ComplianceFrameworkId;
  /** Whether the case's `type` satisfies the rule's mandatoryTestClasses. */
  readonly satisfiesMandatoryTestClass: boolean;
}

/** Annotations attached to a single generated test case. */
export interface ComplianceAnnotationEntry {
  /** Generated test case id (`tc.id`). */
  readonly testCaseId: string;
  /**
   * Stable, sorted list of rule ids the case applies to. Mirrors the
   * shape requested in Issue #2042: `appliesTo: ["PSD2-SCA-Art-97", ...]`.
   */
  readonly appliesTo: readonly string[];
  /**
   * Detailed match metadata, kept alongside the flat `appliesTo` list
   * so consumers can compute coverage without re-scanning rules.
   */
  readonly matches: readonly ComplianceAnnotationMatch[];
}

/** Run-level annotation artifact. */
export interface ComplianceAnnotationArtifact {
  readonly schemaVersion: typeof COMPLIANCE_ANNOTATION_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly activeFrameworks: readonly ComplianceFrameworkId[];
  readonly entries: readonly ComplianceAnnotationEntry[];
}

export interface AnnotateTestCasesInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly testCases: readonly GeneratedTestCase[];
  readonly activeFrameworks: readonly ComplianceFrameworkId[];
}

const collectKeywordCorpus = (testCase: GeneratedTestCase): string => {
  const parts: string[] = [
    testCase.title,
    testCase.objective,
    ...testCase.preconditions,
    ...testCase.testData,
    ...testCase.expectedResults,
    ...testCase.assumptions,
    ...testCase.openQuestions,
  ];
  for (const step of testCase.steps) {
    parts.push(step.action);
    if (typeof step.expected === "string") parts.push(step.expected);
    if (typeof step.data === "string") parts.push(step.data);
  }
  return parts.join("\n").toLowerCase();
};

const ruleMatchesCase = (
  rule: ComplianceRule,
  corpus: string,
): boolean => {
  for (const keyword of rule.keywords) {
    if (corpus.includes(keyword.toLowerCase())) return true;
  }
  return false;
};

const sortMatches = (
  matches: readonly ComplianceAnnotationMatch[],
): readonly ComplianceAnnotationMatch[] =>
  [...matches].sort((a, b) => a.ruleId.localeCompare(b.ruleId));

/**
 * Annotate every test case with the rules that apply to it. Pure: same
 * inputs → same outputs.
 */
export const annotateTestCases = (
  input: AnnotateTestCasesInput,
): ComplianceAnnotationArtifact => {
  const activeFrameworks: ComplianceFrameworkId[] = [
    ...input.activeFrameworks,
  ].sort((a, b) => a.localeCompare(b));

  const activeRules: ReadonlyArray<{
    readonly framework: ComplianceFrameworkId;
    readonly rule: ComplianceRule;
  }> = activeFrameworks.flatMap((framework) => {
    const pack: ComplianceRulePack = COMPLIANCE_RULE_PACK_REGISTRY[framework];
    return pack.rules.map((rule) => ({ framework, rule }));
  });

  const entries: ComplianceAnnotationEntry[] = [];
  for (const testCase of input.testCases) {
    const corpus = collectKeywordCorpus(testCase);
    const matches: ComplianceAnnotationMatch[] = [];
    for (const { framework, rule } of activeRules) {
      if (!ruleMatchesCase(rule, corpus)) continue;
      const satisfies = rule.mandatoryTestClasses.includes(testCase.type);
      matches.push({
        ruleId: rule.id,
        framework,
        satisfiesMandatoryTestClass: satisfies,
      });
    }
    const orderedMatches = sortMatches(matches);
    entries.push({
      testCaseId: testCase.id,
      appliesTo: Object.freeze(orderedMatches.map((m) => m.ruleId)),
      matches: Object.freeze(orderedMatches),
    });
  }

  entries.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  return Object.freeze({
    schemaVersion: COMPLIANCE_ANNOTATION_SCHEMA_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    activeFrameworks: Object.freeze(activeFrameworks),
    entries: Object.freeze(entries),
  });
};

/** Stable string identifier for the deterministic annotator service. */
export const COMPLIANCE_ANNOTATOR_ROLE_ID = "compliance_annotator" as const;
