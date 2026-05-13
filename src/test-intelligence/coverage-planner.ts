import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  COVERAGE_PLAN_ARTIFACT_FILENAME,
  COVERAGE_PLAN_SCHEMA_VERSION,
  DEFAULT_MUTATION_KILL_RATE_TARGET,
  type CoveragePlan,
  type CoveragePlanElementRiskClass,
  type CoveragePlanPerElement,
  type CoveragePlanPerScreen,
  type CoveragePlanTechnique,
  type CoverageRequirement,
  type CoverageRequirementReasonCode,
  type LlmGenerationResult,
  type SourceMixPlan,
  type TestCaseTechnique29119,
  type TestDesignModel,
  type TestDesignRiskSignal,
  type TestDesignRule,
  type TestDesignScreen,
  type WorkflowTopology,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { generateWithLocalWallClockGuard } from "./llm-generation-guard.js";
import {
  isCoverageRelevantElementLike,
  isInteractiveCoverageElementLike,
  normalizeCoverageText,
} from "./coverage-relevance.js";
import type { LlmGatewayClient } from "./llm-gateway.js";
import { selectTestDesignHeuristics } from "./test-design-heuristics.js";

export interface BuildCoveragePlanInput {
  model: TestDesignModel;
  workflowTopology?: WorkflowTopology;
  sourceMixPlan?: SourceMixPlan;
  mutationKillRateTarget?: number;
  policyProfile?: Record<string, unknown>;
}

export interface BuildCoveragePlanWithAugmentationInput
  extends BuildCoveragePlanInput {
  plannerClient?: LlmGatewayClient;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export interface CoveragePlanBuildResult {
  plan: CoveragePlan;
  usedAugmentation: boolean;
  gatewayResult?: LlmGenerationResult;
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
const INPUT_KIND_PATTERN =
  /\b(number|email|password|phone|date|select|dropdown|checkbox|radio|textarea|currency|percentage|percent|rate|integer|decimal|float|input)\b/i;
const RESULT_DISPLAY_HINT_PATTERN =
  /\b(result|summary|status|total|balance|output|confirmation|receipt|preview|overview|message|ergebnis|anzeige)\b/i;
const SELECTABLE_OPTION_HINT_PATTERN =
  /\b(select[_\s-]?field|selectable|select|dropdown|combobox|radio[_\s-]?option|radio|checkbox|option|choice|picker|segmented|chip|pill|auswahl)\b/i;
const COVERAGE_PLANNER_RESPONSE_SCHEMA_NAME =
  "workspace-dev-coverage-planner-v1" as const;
const RISK_CLASS_ORDER: readonly CoveragePlanElementRiskClass[] = [
  "low",
  "medium",
  "high",
  "financial_transaction",
  "regulated_data",
] as const;
const GENERATED_TECHNIQUE_ORDER: readonly TestCaseTechnique29119[] = [
  "use_case",
  "equivalence_partitioning",
  "boundary_value_analysis",
  "decision_table",
  "state_transition",
  "exploratory",
  "error_guessing",
  "syntax_testing",
  "classification_tree",
] as const;

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const semanticCoverageText = (
  element: { label?: string; kind?: string },
): string => normalizeCoverageText(`${element.label ?? ""} ${element.kind ?? ""}`);

const isResultDisplayElementLike = (
  element: { label?: string; kind?: string },
): boolean => RESULT_DISPLAY_HINT_PATTERN.test(semanticCoverageText(element));

const isSelectableOptionElementLike = (
  element: { label?: string; kind?: string },
): boolean => SELECTABLE_OPTION_HINT_PATTERN.test(semanticCoverageText(element));

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

const isSemanticCoverageRule = (rule: TestDesignRule): boolean =>
  /^Semantic category:\s*(result display|selectable option|informative label)\b/i.test(
    rule.description,
  );

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
  if (isSemanticCoverageRule(rule)) {
    return "equivalence_partitioning";
  }
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
  screen.elements.filter((element) => isInteractiveCoverageElementLike(element))
    .length >= 3;

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

const riskClassRank = (riskClass: CoveragePlanElementRiskClass): number =>
  RISK_CLASS_ORDER.indexOf(riskClass);

const generatedTechniqueRank = (technique: TestCaseTechnique29119): number =>
  GENERATED_TECHNIQUE_ORDER.indexOf(technique);

const compareTechniqueQuotas = (
  left: { technique: TestCaseTechnique29119; minCount: number },
  right: { technique: TestCaseTechnique29119; minCount: number },
): number =>
  generatedTechniqueRank(left.technique) -
    generatedTechniqueRank(right.technique) ||
  left.minCount - right.minCount;

const comparePerScreen = (
  left: CoveragePlanPerScreen,
  right: CoveragePlanPerScreen,
): number => left.screenId.localeCompare(right.screenId);

const comparePerElement = (
  left: CoveragePlanPerElement,
  right: CoveragePlanPerElement,
): number => left.elementId.localeCompare(right.elementId);

const buildCoverageRelevantFieldCounts = (
  model: TestDesignModel,
): ReadonlyMap<string, number> =>
  new Map(
    model.screens.map((screen) => [
      screen.screenId,
      screen.elements.filter((element) => isInteractiveCoverageElementLike(element))
        .length,
    ]),
  );

const buildPerScreenPlan = (input: {
  model: TestDesignModel;
  minimumCases: readonly CoverageRequirement[];
  recommendedCases: readonly CoverageRequirement[];
}): CoveragePlan["perScreen"] => {
  const countsByScreen = new Map<
    string,
    Map<TestCaseTechnique29119, number>
  >();
  const toGeneratedTechnique = (
    technique: CoveragePlanTechnique,
  ): TestCaseTechnique29119 | undefined => {
    switch (technique) {
      case "initial_state":
        return "use_case";
      case "equivalence_partitioning":
        return "equivalence_partitioning";
      case "boundary_value":
        return "boundary_value_analysis";
      case "decision_table":
        return "decision_table";
      case "state_transition":
        return "state_transition";
      case "error_guessing":
        return "error_guessing";
      case "pairwise":
        return undefined;
    }
  };
  for (const requirement of [
    ...input.minimumCases,
  ]) {
    if (requirement.screenId === undefined) {
      continue;
    }
    const generatedTechnique = toGeneratedTechnique(requirement.technique);
    if (generatedTechnique === undefined) {
      continue;
    }
    const screenCounts =
      countsByScreen.get(requirement.screenId) ??
      new Map<TestCaseTechnique29119, number>();
    screenCounts.set(
      generatedTechnique,
      (screenCounts.get(generatedTechnique) ?? 0) + 1,
    );
    countsByScreen.set(requirement.screenId, screenCounts);
  }
  const fieldCounts = buildCoverageRelevantFieldCounts(input.model);
  return input.model.screens
    .map((screen) => {
      const screenCounts = countsByScreen.get(screen.screenId);
      const techniqueQuotas =
        screenCounts === undefined
          ? []
          : [...screenCounts.entries()]
              .map(([technique, minCount]) => ({
                technique,
                minCount:
                  technique === "equivalence_partitioning"
                    ? Math.min(
                        minCount,
                        fieldCounts.get(screen.screenId) ?? minCount,
                      )
                    : minCount,
              }))
              .filter((quota) => quota.minCount > 0)
              .sort(compareTechniqueQuotas);
      return {
        screenId: screen.screenId,
        techniqueQuotas,
      };
    })
    .sort(comparePerScreen);
};

const buildPerElementPlan = (input: {
  model: TestDesignModel;
}): CoveragePlan["perElement"] => {
  const validationTargets = new Set(
    input.model.screens.flatMap((screen) =>
      screen.validations.map((validation) => validation.targetElementId),
    ),
  );
  const calculationInputs = new Set(
    input.model.screens.flatMap((screen) =>
      screen.calculations.flatMap((calculation) => calculation.inputElementIds),
    ),
  );
  const screenRuleKinds = new Map<
    string,
    { hasBoundary: boolean; hasDecision: boolean; hasRiskSignal: boolean }
  >();
  for (const screen of input.model.screens) {
    screenRuleKinds.set(screen.screenId, {
      hasBoundary: false,
      hasDecision: false,
      hasRiskSignal: false,
    });
  }
  for (const rule of input.model.businessRules) {
    if (rule.screenId === undefined) {
      continue;
    }
    const existing = screenRuleKinds.get(rule.screenId);
    if (existing === undefined) {
      continue;
    }
    existing.hasBoundary ||= isBoundaryRule(rule);
    existing.hasDecision ||= isDecisionRule(rule);
  }
  for (const signal of input.model.riskSignals) {
    if (signal.screenId === undefined) {
      continue;
    }
    const existing = screenRuleKinds.get(signal.screenId);
    if (existing !== undefined) {
      existing.hasRiskSignal = true;
    }
  }
  const piiElementPattern =
    /\b(iban|account|routing|swift|bic|tax|ssn|social security|passport|national id)\b/i;
  const financialElementPattern =
    /\b(amount|loan|payment|principal|interest|rate|term|currency|price|balance)\b/i;
  return input.model.screens
    .flatMap((screen) => {
      const screenSignals = screenRuleKinds.get(screen.screenId);
      return screen.elements
        .filter(
          (element) =>
            isInteractiveCoverageElementLike(element) ||
            isResultDisplayElementLike(element) ||
            isSelectableOptionElementLike(element),
        )
        .map((element) => {
        let riskClass: CoveragePlanElementRiskClass = "low";
        const elementText = `${element.label} ${element.kind}`;
        if (piiElementPattern.test(elementText)) {
          riskClass = "regulated_data";
        } else if (
          financialElementPattern.test(elementText) ||
          NUMERIC_KIND_PATTERN.test(element.kind)
        ) {
          riskClass = "financial_transaction";
        } else if (isResultDisplayElementLike(element)) {
          riskClass = "medium";
        } else if (isSelectableOptionElementLike(element)) {
          riskClass = "medium";
        } else if (
          validationTargets.has(element.elementId) ||
          calculationInputs.has(element.elementId) ||
          screenSignals?.hasRiskSignal === true
        ) {
          riskClass = "high";
        } else if (
          INPUT_KIND_PATTERN.test(element.kind) ||
          isInteractiveCoverageElementLike(element) ||
          screenSignals?.hasBoundary === true ||
          screenSignals?.hasDecision === true
        ) {
          riskClass = "medium";
        }
        return {
          screenId: screen.screenId,
          elementId: element.elementId,
          mustHaveCase: true,
          riskClass,
        };
      });
    })
    .sort(comparePerElement);
};

const buildCoveragePlanResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["perScreen", "perElement"],
  properties: {
    perScreen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screenId", "techniqueQuotas"],
        properties: {
          screenId: { type: "string", minLength: 1 },
          techniqueQuotas: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              GENERATED_TECHNIQUE_ORDER.map((technique) => [
                technique,
                { type: "integer", minimum: 0 },
              ]),
            ),
          },
        },
      },
    },
    perElement: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screenId", "elementId", "mustHaveCase", "riskClass"],
        properties: {
          screenId: { type: "string", minLength: 1 },
          elementId: { type: "string", minLength: 1 },
          mustHaveCase: { type: "boolean" },
          riskClass: { enum: [...RISK_CLASS_ORDER] },
        },
      },
    },
  },
});

const normalizeTechniqueQuotaRecord = (
  value: unknown,
): ReadonlyMap<TestCaseTechnique29119, number> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new Map();
  }
  const record = value as Record<string, unknown>;
  const quotas = new Map<TestCaseTechnique29119, number>();
  for (const technique of GENERATED_TECHNIQUE_ORDER) {
    const quota = record[technique];
    if (
      typeof quota === "number" &&
      Number.isSafeInteger(quota) &&
      quota >= 0
    ) {
      quotas.set(technique, quota);
    }
  }
  return quotas;
};

const mergeCoveragePlanAugmentation = (input: {
  plan: CoveragePlan;
  augmentation: unknown;
}): CoveragePlan => {
  if (typeof input.augmentation !== "object" || input.augmentation === null) {
    return input.plan;
  }
  const augmentation = input.augmentation as Record<string, unknown>;
  const perScreenRaw = Array.isArray(augmentation.perScreen)
    ? augmentation.perScreen
    : [];
  const perElementRaw = Array.isArray(augmentation.perElement)
    ? augmentation.perElement
    : [];
  const mergedPerScreen = input.plan.perScreen.map((screen) => {
    const override = perScreenRaw.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>).screenId === screen.screenId,
    ) as Record<string, unknown> | undefined;
    const nextCounts = new Map<TestCaseTechnique29119, number>(
      screen.techniqueQuotas.map((quota) => [quota.technique, quota.minCount]),
    );
    for (const [technique, minCount] of normalizeTechniqueQuotaRecord(
      override?.techniqueQuotas,
    )) {
      nextCounts.set(technique, Math.max(nextCounts.get(technique) ?? 0, minCount));
    }
    return {
      screenId: screen.screenId,
      techniqueQuotas: [...nextCounts.entries()]
        .map(([technique, minCount]) => ({ technique, minCount }))
        .filter((quota) => quota.minCount > 0)
        .sort(compareTechniqueQuotas),
    };
  });
  const mergedPerElement = input.plan.perElement.map((element) => {
    const override = perElementRaw.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>).screenId === element.screenId &&
        (candidate as Record<string, unknown>).elementId === element.elementId,
    ) as Record<string, unknown> | undefined;
    const mustHaveCase =
      typeof override?.mustHaveCase === "boolean"
        ? element.mustHaveCase || override.mustHaveCase
        : element.mustHaveCase;
    const riskClassCandidate = override?.riskClass;
    const riskClass =
      typeof riskClassCandidate === "string" &&
      RISK_CLASS_ORDER.includes(riskClassCandidate as CoveragePlanElementRiskClass) &&
      riskClassRank(riskClassCandidate as CoveragePlanElementRiskClass) >
        riskClassRank(element.riskClass)
        ? (riskClassCandidate as CoveragePlanElementRiskClass)
        : element.riskClass;
    return {
      screenId: element.screenId,
      elementId: element.elementId,
      mustHaveCase,
      riskClass,
    };
  });
  return {
    ...input.plan,
    perScreen: mergedPerScreen,
    perElement: mergedPerElement,
  };
};

export const buildCoveragePlan = (input: BuildCoveragePlanInput): CoveragePlan => {
  const mutationKillRateTarget =
    input.mutationKillRateTarget ?? DEFAULT_MUTATION_KILL_RATE_TARGET;
  if (
    typeof mutationKillRateTarget !== "number" ||
    !Number.isFinite(mutationKillRateTarget) ||
    mutationKillRateTarget < 0 ||
    mutationKillRateTarget > 1
  ) {
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

  for (const action of input.workflowTopology?.actions ?? []) {
    recommendedCases.push(
      buildRequirement({
        technique: "state_transition",
        reasonCode: "action_transition",
        screenId: action.screenId,
        targetIds: [action.actionId, ...action.targetIds],
        sourceRefs: action.sourceRefs,
        visualRefs:
          screens.get(action.screenId)?.visualRefs ?? [],
      }),
    );
  }
  for (const lifecycle of input.workflowTopology?.fieldLifecycles ?? []) {
    for (const transition of lifecycle.transitions) {
      recommendedCases.push(
        buildRequirement({
          technique: "state_transition",
          reasonCode: "field_lifecycle_transition",
          targetIds: [lifecycle.fieldId, transition.transitionId],
          sourceRefs: allModelSourceRefs(model),
          visualRefs: allModelVisualRefs(model),
        }),
      );
      if (transition.to === "error") {
        minimumCases.push(
          buildRequirement({
            technique: "error_guessing",
            reasonCode: "field_lifecycle_error_transition",
            targetIds: [lifecycle.fieldId, transition.transitionId],
            sourceRefs: allModelSourceRefs(model),
            visualRefs: allModelVisualRefs(model),
          }),
        );
      }
    }
  }

  for (const screen of model.screens) {
    const coverageRelevantElements = screen.elements.filter((element) =>
      isCoverageRelevantElementLike(element),
    );
    const interactiveElements = coverageRelevantElements.filter((element) =>
      isInteractiveCoverageElementLike(element),
    );
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

    for (const element of interactiveElements) {
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
          targetIds: interactiveElements.map(
            (element) => element.elementId,
          ),
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
    perScreen: buildPerScreenPlan({
      model,
      minimumCases: minimumCasesSorted,
      recommendedCases: recommendedCasesSorted,
    }),
    perElement: buildPerElementPlan({ model }),
    minimumCases: minimumCasesSorted,
    recommendedCases: recommendedCasesSorted,
    techniques,
    mutationKillRateTarget,
  };
};

export const buildCoveragePlanWithAugmentation = async (
  input: BuildCoveragePlanWithAugmentationInput,
): Promise<CoveragePlanBuildResult> => {
  const plan = buildCoveragePlan(input);
  if (input.plannerClient === undefined) {
    return { plan, usedAugmentation: false };
  }
  const request = {
    jobId: input.model.jobId,
    systemPrompt: [
      "You are the optional Coverage-Planner augmentation model for workspace-dev.",
      "You receive a deterministic TestDesignModel, CoveragePlan baseline, optional SourceMixPlan, and optional policy profile as JSON.",
      "Return JSON only. You may only strengthen the baseline by raising per-screen technique quotas, setting mustHaveCase=true, or elevating riskClass.",
      "Never lower a quota, never set mustHaveCase=false, and never reduce a risk class.",
    ].join(" "),
    userPrompt: [
      "[1] TestDesignModel",
      canonicalJson(input.model),
      "[2] CoveragePlanBaseline",
      canonicalJson(plan),
      ...(input.sourceMixPlan === undefined
        ? []
        : ["[3] SourceMixPlan", canonicalJson(input.sourceMixPlan)]),
      ...(input.policyProfile === undefined
        ? []
        : ["[4] PolicyProfile", canonicalJson(input.policyProfile)]),
    ].join("\n"),
    responseSchema: buildCoveragePlanResponseSchema(),
    responseSchemaName: COVERAGE_PLANNER_RESPONSE_SCHEMA_NAME,
    ...(input.maxInputTokens !== undefined
      ? { maxInputTokens: input.maxInputTokens }
      : {}),
    ...(input.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.maxOutputTokens }
      : {}),
    ...(input.maxWallClockMs !== undefined
      ? { maxWallClockMs: input.maxWallClockMs }
      : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    ...(input.abortSignal !== undefined ? { abortSignal: input.abortSignal } : {}),
  };
  const gatewayResult = await generateWithLocalWallClockGuard({
    client: input.plannerClient,
    request,
    operationLabel: "coverage planner gateway request",
    ...(input.maxWallClockMs !== undefined
      ? { defaultWallClockMs: input.maxWallClockMs }
      : {}),
  });
  if (gatewayResult.outcome !== "success") {
    return { plan, usedAugmentation: false, gatewayResult };
  }
  return {
    plan: mergeCoveragePlanAugmentation({
      plan,
      augmentation: gatewayResult.content,
    }),
    usedAugmentation: true,
    gatewayResult,
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
