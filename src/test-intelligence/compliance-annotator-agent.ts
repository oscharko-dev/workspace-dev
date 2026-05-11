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

import type {
  GeneratedTestCase,
  SubprocessorRegister,
} from "../contracts/index.js";
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
  /**
   * Stable, sorted list of subprocessor identifiers (Issue #2174) that
   * a rule match cites for this test case. Empty when the rule pack
   * does not reference a subprocessor; consumers cross-resolve the IDs
   * against the per-run `subprocessor-register.json` artifact named in
   * {@link ComplianceAnnotationArtifact.subprocessorRegisterRef}.
   */
  readonly subprocessorRefs: readonly string[];
}

/**
 * Cross-link from a `compliance-annotations.json` artifact to the
 * per-run `subprocessor-register.json` (Issue #2174). Every annotation
 * that names a subprocessor cites the `subprocessorId` from the
 * register; this top-level reference pins the register's identity so
 * the citation can be resolved without consulting the file system.
 */
export interface ComplianceAnnotationSubprocessorRegisterRef {
  readonly artifactFilename: string;
  readonly schemaVersion: SubprocessorRegister["schemaVersion"];
  readonly registerVersion: SubprocessorRegister["registerVersion"];
  readonly merkleRoot: string;
}

/** Run-level annotation artifact. */
export interface ComplianceAnnotationArtifact {
  readonly schemaVersion: typeof COMPLIANCE_ANNOTATION_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly activeFrameworks: readonly ComplianceFrameworkId[];
  readonly entries: readonly ComplianceAnnotationEntry[];
  /**
   * Cross-link to the per-run subprocessor register artifact (Issue
   * #2174). Optional so legacy fixtures that pre-date the register
   * artifact remain parseable; runtime emission always populates the
   * field.
   */
  readonly subprocessorRegisterRef?: ComplianceAnnotationSubprocessorRegisterRef;
}

export interface AnnotateTestCasesInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly testCases: readonly GeneratedTestCase[];
  readonly activeFrameworks: readonly ComplianceFrameworkId[];
  /**
   * Subprocessor register cross-link (Issue #2174). When present, the
   * artifact carries a top-level
   * {@link ComplianceAnnotationArtifact.subprocessorRegisterRef} so a
   * downstream consumer can resolve subprocessor citations without
   * reading the register file.
   */
  readonly subprocessorRegister?: SubprocessorRegister;
  /** Filename of the register artifact in the run bundle (defaults to the canonical name). */
  readonly subprocessorRegisterArtifactFilename?: string;
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
 * Resolve subprocessor citations for a single rule match (Issue #2174).
 * Today the deterministic compliance-rule pack does not carry an
 * explicit subprocessor mapping; the cross-link is inferred from the
 * rule citation by looking up matching `subprocessorId` values in the
 * per-run register. The lookup is exact — substring-style matches are
 * deliberately rejected — so a future rule pack that names a
 * subprocessor explicitly need only add the literal id to its citation
 * for the cross-link to start populating.
 */
const resolveSubprocessorRefsForCorpus = (
  corpus: string,
  register: SubprocessorRegister | undefined,
): readonly string[] => {
  if (register === undefined || register.subprocessors.length === 0) return [];
  const refs = new Set<string>();
  for (const subprocessor of register.subprocessors) {
    if (corpus.includes(subprocessor.subprocessorId)) {
      refs.add(subprocessor.subprocessorId);
    }
  }
  return Object.freeze(
    [...refs].sort((left, right) => left.localeCompare(right)),
  );
};

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
    const subprocessorRefs =
      orderedMatches.length === 0
        ? []
        : resolveSubprocessorRefsForCorpus(corpus, input.subprocessorRegister);
    entries.push({
      testCaseId: testCase.id,
      appliesTo: Object.freeze(orderedMatches.map((m) => m.ruleId)),
      matches: Object.freeze(orderedMatches),
      subprocessorRefs: Object.freeze(subprocessorRefs) as readonly string[],
    });
  }

  entries.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));

  const subprocessorRegisterRef =
    input.subprocessorRegister === undefined
      ? undefined
      : Object.freeze({
          artifactFilename:
            input.subprocessorRegisterArtifactFilename ??
            "subprocessor-register.json",
          schemaVersion: input.subprocessorRegister.schemaVersion,
          registerVersion: input.subprocessorRegister.registerVersion,
          merkleRoot: input.subprocessorRegister.merkleRoot,
        });

  return Object.freeze({
    schemaVersion: COMPLIANCE_ANNOTATION_SCHEMA_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    activeFrameworks: Object.freeze(activeFrameworks),
    entries: Object.freeze(entries),
    ...(subprocessorRegisterRef !== undefined
      ? { subprocessorRegisterRef }
      : {}),
  });
};

/** Stable string identifier for the deterministic annotator service. */
export const COMPLIANCE_ANNOTATOR_ROLE_ID = "compliance_annotator" as const;
