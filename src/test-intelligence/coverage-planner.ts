import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  COVERAGE_PLAN_ARTIFACT_FILENAME,
  COVERAGE_PLAN_SCHEMA_VERSION,
  DEFAULT_MUTATION_KILL_RATE_TARGET,
  type CoveragePlan,
  type CoveragePlanTechnique,
  type CoverageRequirement,
  type CoverageRequirementReasonCode,
  type SourceMixPlan,
  type TestDesignModel,
  type TestDesignRiskSignal,
  type TestDesignRule,
  type TestDesignScreen,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { selectTestDesignHeuristics } from "./test-design-heuristics.js";

export interface BuildCoveragePlanInput {
  model: TestDesignModel;
  sourceMixPlan?: SourceMixPlan;
  mutationKillRateTarget?: number;
}

const TECHNIQUE_ORDER: readonly CoveragePlanTechnique[] = [
  "initial_state",
  "equivalence_partitioning",
  "boundary_value",
  "decision_table",
  "state_transition",
  "pairwise",
  "error_guessing",
] as const;

const BOUNDARY_SIGNAL_PATTERN =
  /\b(min(?:imum)?|max(?:imum)?|range|between|greater than|less than|at least|at most|digits?|decimal|amount|currency|length|percent|rate|rounded?|rounding|years?|months?|days?)\b|<=|>=|<|>/i;
const DECISION_SIGNAL_PATTERN =
  /\b(if|when|unless|otherwise|depends|only if|required when|either|one of|all of)\b|\band\/or\b/i;
const NUMERIC_KIND_PATTERN =
  /\b(number|amount|currency|percentage|percent|rate|integer|decimal|float)\b/i;

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const techniqueRank = (technique: CoveragePlanTechnique): number =>
  TECHNIQUE_ORDER.indexOf(technique);

const buildRequirementId = (input: {
  technique: CoveragePlanTechnique;
  reasonCode: CoverageRequirementReasonCode;
  screenId?: string;
  targetIds: readonly string[];
  sourceRefs: readonly string[];
  visualRefs: readonly string[];
}): string =>
  `cov-${sha256Hex({
    technique: input.technique,
    reasonCode: input.reasonCode,
    screenId: input.screenId ?? null,
    targetIds: [...input.targetIds],
    sourceRefs: [...input.sourceRefs],
    visualRefs: [...input.visualRefs],
  }).slice(0, 16)}`;

const buildRequirement = (input: {
  technique: CoveragePlanTechnique;
  reasonCode: CoverageRequirementReasonCode;
  screenId?: string;
  targetIds: readonly string[];
  sourceRefs: readonly string[];
  visualRefs: readonly string[];
}): CoverageRequirement => ({
  requirementId: buildRequirementId(input),
  technique: input.technique,
  reasonCode: input.reasonCode,
  ...(input.screenId !== undefined ? { screenId: input.screenId } : {}),
  targetIds: [...input.targetIds],
  sourceRefs: uniqueSorted(input.sourceRefs),
  visualRefs: uniqueSorted(input.visualRefs),
});

const compareRequirements = (
  left: CoverageRequirement,
  right: CoverageRequirement,
): number =>
  (left.screenId ?? "").localeCompare(right.screenId ?? "") ||
  techniqueRank(left.technique) - techniqueRank(right.technique) ||
  left.reasonCode.localeCompare(right.reasonCode) ||
  left.targetIds.join("\0").localeCompare(right.targetIds.join("\0")) ||
  left.requirementId.localeCompare(right.requirementId);

const isBoundaryRule = (rule: TestDesignRule): boolean =>
  BOUNDARY_SIGNAL_PATTERN.test(rule.description);

const isDecisionRule = (rule: TestDesignRule): boolean =>
  DECISION_SIGNAL_PATTERN.test(rule.description);

const screenById = (
  model: TestDesignModel,
): ReadonlyMap<string, TestDesignScreen> =>
  new Map(model.screens.map((screen) => [screen.screenId, screen] as const));

const allModelSourceRefs = (model: TestDesignModel): string[] =>
  uniqueSorted([
    ...model.screens.flatMap((screen) => screen.sourceRefs),
    ...model.businessRules.flatMap((rule) => rule.sourceRefs),
    ...model.riskSignals.flatMap((signal) => signal.sourceRefs),
  ]);

const allModelVisualRefs = (model: TestDesignModel): string[] =>
  uniqueSorted(model.screens.flatMap((screen) => screen.visualRefs));

const selectRuleTechnique = (rule: TestDesignRule): CoveragePlanTechnique => {
  if (isBoundaryRule(rule)) {
    return "boundary_value";
  }
  if (isDecisionRule(rule)) {
    return "decision_table";
  }
  return "equivalence_partitioning";
};

const selectRuleReasonCode = (
  rule: TestDesignRule,
): CoverageRequirementReasonCode => {
  if (isBoundaryRule(rule)) {
    return "rule_boundary";
  }
  if (isDecisionRule(rule)) {
    return "rule_decision";
  }
  return "rule_partition";
};

const hasPairwiseEvidence = (screen: TestDesignScreen): boolean =>
  screen.elements.length >= 3;

const hasSupportingContextSection = (sourceMixPlan: SourceMixPlan | undefined): boolean =>
  sourceMixPlan?.promptSections.some(
    (promptSection) =>
      promptSection === "custom_context" ||
      promptSection === "custom_context_markdown",
  ) ?? false;

const pushRiskRequirement = ({
  requirements,
  riskSignal,
  screens,
}: {
  requirements: CoverageRequirement[];
  riskSignal: TestDesignRiskSignal;
  screens: ReadonlyMap<string, TestDesignScreen>;
}): void => {
  const screen = riskSignal.screenId === undefined ? undefined : screens.get(riskSignal.screenId);
  requirements.push(
    buildRequirement({
      technique: "error_guessing",
      reasonCode:
        riskSignal.text.startsWith("Multi-source ")
          ? "source_reconciliation_probe"
          : "risk_regression",
      ...(riskSignal.screenId !== undefined ? { screenId: riskSignal.screenId } : {}),
      targetIds: [riskSignal.riskSignalId],
      sourceRefs: riskSignal.sourceRefs,
      visualRefs: screen?.visualRefs ?? [],
    }),
  );
};

export const buildCoveragePlan = (input: BuildCoveragePlanInput): CoveragePlan => {
  const mutationKillRateTarget =
    input.mutationKillRateTarget ?? DEFAULT_MUTATION_KILL_RATE_TARGET;
  if (mutationKillRateTarget < 0 || mutationKillRateTarget > 1) {
    throw new RangeError("mutationKillRateTarget must be in [0, 1]");
  }

  const model = input.model;
  const screens = screenById(model);
  const heuristics = selectTestDesignHeuristics(
    input.sourceMixPlan === undefined
      ? {}
      : { sourceMixPlan: input.sourceMixPlan },
  );
  const minimumCases: CoverageRequirement[] = [];
  const recommendedCases: CoverageRequirement[] = [];
  const allSourceRefs = allModelSourceRefs(model);
  const allVisualRefs = allModelVisualRefs(model);

  for (const screen of model.screens) {
    minimumCases.push(
      buildRequirement({
        technique: "initial_state",
        reasonCode: "screen_baseline",
        screenId: screen.screenId,
        targetIds: [screen.screenId],
        sourceRefs: screen.sourceRefs,
        visualRefs: screen.visualRefs,
      }),
    );

    for (const element of screen.elements) {
      minimumCases.push(
        buildRequirement({
          technique: "equivalence_partitioning",
          reasonCode: "element_partition",
          screenId: screen.screenId,
          targetIds: [element.elementId],
          sourceRefs: screen.sourceRefs,
          visualRefs: screen.visualRefs,
        }),
      );
    }

    for (const action of screen.actions.filter(
      (candidate) => candidate.targetScreenId !== undefined,
    )) {
      minimumCases.push(
        buildRequirement({
          technique: "state_transition",
          reasonCode: "action_transition",
          screenId: screen.screenId,
          targetIds: [action.actionId, action.targetScreenId!],
          sourceRefs: screen.sourceRefs,
          visualRefs: screen.visualRefs,
        }),
      );
    }

    for (const calculation of screen.calculations) {
      recommendedCases.push(
        buildRequirement({
          technique: "decision_table",
          reasonCode: "calculation_rule",
          screenId: screen.screenId,
          targetIds: [calculation.calculationId, ...calculation.inputElementIds],
          sourceRefs: screen.sourceRefs,
          visualRefs: screen.visualRefs,
        }),
      );
    }

    if (hasPairwiseEvidence(screen)) {
      recommendedCases.push(
        buildRequirement({
          technique: "pairwise",
          reasonCode: "screen_pairwise",
          screenId: screen.screenId,
          targetIds: screen.elements.map((element) => element.elementId),
          sourceRefs: screen.sourceRefs,
          visualRefs: screen.visualRefs,
        }),
      );
    }
  }

  for (const rule of model.businessRules) {
    const screen = rule.screenId === undefined ? undefined : screens.get(rule.screenId);
    minimumCases.push(
      buildRequirement({
        technique: selectRuleTechnique(rule),
        reasonCode: selectRuleReasonCode(rule),
        ...(rule.screenId !== undefined ? { screenId: rule.screenId } : {}),
        targetIds: [rule.ruleId],
        sourceRefs: rule.sourceRefs,
        visualRefs: screen?.visualRefs ?? [],
      }),
    );
  }

  for (const riskSignal of model.riskSignals) {
    pushRiskRequirement({
      requirements: recommendedCases,
      riskSignal,
      screens,
    });
  }

  for (const openQuestion of model.openQuestions) {
    recommendedCases.push(
      buildRequirement({
        technique: "error_guessing",
        reasonCode: "open_question_probe",
        targetIds: [openQuestion.openQuestionId],
        sourceRefs: allSourceRefs,
        visualRefs: allVisualRefs,
      }),
    );
  }

  if (
    heuristics.some(
      (heuristic) => heuristic.heuristicId === "cross_source_reconciliation",
    ) &&
    input.sourceMixPlan !== undefined
  ) {
    recommendedCases.push(
      buildRequirement({
        technique: "error_guessing",
        reasonCode: "source_reconciliation_probe",
        targetIds: [
          ...input.sourceMixPlan.primarySourceIds,
          ...input.sourceMixPlan.supportingSourceIds,
        ],
        sourceRefs: [
          ...input.sourceMixPlan.primarySourceIds,
          ...input.sourceMixPlan.supportingSourceIds,
        ],
        visualRefs: allVisualRefs,
      }),
    );
  }

  if (hasSupportingContextSection(input.sourceMixPlan)) {
    recommendedCases.push(
      buildRequirement({
        technique: "error_guessing",
        reasonCode: "supporting_context_probe",
        targetIds: input.sourceMixPlan?.supportingSourceIds ?? [],
        sourceRefs: input.sourceMixPlan?.supportingSourceIds ?? [],
        visualRefs: allVisualRefs,
      }),
    );
  }

  const dedupeRequirements = (
    requirements: readonly CoverageRequirement[],
  ): CoverageRequirement[] =>
    [...new Map(requirements.map((requirement) => [requirement.requirementId, requirement])).values()].sort(
      compareRequirements,
    );

  const minimumCasesSorted = dedupeRequirements(minimumCases);
  const recommendedCasesSorted = dedupeRequirements(recommendedCases);
  const techniques = uniqueSorted(
    [...minimumCasesSorted, ...recommendedCasesSorted].map(
      (requirement) => requirement.technique,
    ),
  ).sort(
    (left, right) =>
      techniqueRank(left as CoveragePlanTechnique) -
      techniqueRank(right as CoveragePlanTechnique),
  ) as CoveragePlanTechnique[];

  return {
    schemaVersion: COVERAGE_PLAN_SCHEMA_VERSION,
    jobId: model.jobId,
    minimumCases: minimumCasesSorted,
    recommendedCases: recommendedCasesSorted,
    techniques,
    mutationKillRateTarget,
  };
};

export const writeCoveragePlanArtifact = async (input: {
  plan: CoveragePlan;
  runDir: string;
}): Promise<{ artifactPath: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError("writeCoveragePlanArtifact: runDir must be a non-empty string");
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(input.runDir, COVERAGE_PLAN_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.plan), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};

export const hasBoundaryEvidence = (model: TestDesignModel): boolean =>
  model.screens.some((screen) =>
    screen.elements.some((element) => NUMERIC_KIND_PATTERN.test(element.kind)),
  ) || model.businessRules.some((rule) => isBoundaryRule(rule));
