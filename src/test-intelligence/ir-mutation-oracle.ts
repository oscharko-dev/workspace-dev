import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type IrMutationCoverageStrengthReport,
  type TestDesignCalculation,
  type TestDesignModel,
  type TestDesignRule,
  type TestDesignScreen,
  type TestDesignValidation,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

export const IR_MUTATION_COVERAGE_STRENGTH_REPORT_SCHEMA_VERSION =
  "1.0.0" as const;
export const IR_MUTATION_COVERAGE_STRENGTH_REPORT_ARTIFACT_FILENAME =
  "ir-mutation-coverage-strength.json" as const;

export const IR_MUTATION_KINDS = [
  "flip_required",
  "shrink_boundary",
  "drop_state_transition",
  "swap_equivalence_class",
  "invert_decision_rule",
] as const;

export type IrMutationKind = (typeof IR_MUTATION_KINDS)[number];

export interface ComputeIrMutationCoverageStrengthInput {
  readonly model: TestDesignModel;
  readonly list: GeneratedTestCaseList;
}

interface CaseContext {
  readonly testCase: GeneratedTestCase;
  readonly text: string;
  readonly tokens: ReadonlySet<string>;
  readonly coveredFieldIds: ReadonlySet<string>;
  readonly coveredActionIds: ReadonlySet<string>;
  readonly coveredValidationIds: ReadonlySet<string>;
  readonly coveredNavigationIds: ReadonlySet<string>;
  readonly touchedScreens: ReadonlySet<string>;
}

interface MutationCandidate {
  readonly mutationId: string;
  readonly mutationKind: IrMutationKind;
  readonly affectedSourceRefs: readonly string[];
  readonly kills: (context: CaseContext) => boolean;
}

const REQUIRED_RULE_PATTERN = /\b(required|optional)\b/i;
const REQUIRED_CASE_PATTERN =
  /\b(required|optional|blank|empty|missing|omit|omitted|without)\b/i;
const BOUNDARY_RULE_PATTERN =
  /\b(min(?:imum)?|max(?:imum)?|range|between|greater than|less than|at least|at most|digits?|decimal|amount|currency|length|percent|rate|rounded?|rounding|years?|months?|days?)\b|<=|>=|<|>/i;
const BOUNDARY_CASE_PATTERN =
  /\b(min(?:imum)?|max(?:imum)?|between|greater than|less than|at least|at most|boundary|limit|too high|too low|outside|range)\b|<=|>=|<|>/i;
const DECISION_CASE_PATTERN =
  /\b(if|when|unless|otherwise|review|approve|approved|decline|declined|eligible|ineligible|decision|route|manual)\b/i;
const EQUIVALENCE_CASE_PATTERN =
  /\b(valid|invalid|accepted|rejected|allowed|disallowed|supported|unsupported|class|type|format|option)\b/i;
const TRANSITION_CASE_PATTERN =
  /\b(navigate|navigates|navigation|transition|redirect|land|lands|shown|summary|next|continue|submit|open)\b/i;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "between",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "must",
  "of",
  "on",
  "or",
  "screen",
  "than",
  "the",
  "to",
  "when",
  "with",
]);

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const tokenize = (value: string): string[] =>
  normalizeText(value)
    .split(" ")
    .filter(
      (token) =>
        token.length > 1 && !STOPWORDS.has(token) && token !== "required",
    );

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const buildMutationId = (seed: unknown): string =>
  `mut-${sha256Hex(seed).slice(0, 16)}`;

const intersects = (
  left: ReadonlySet<string>,
  right: readonly string[],
): boolean => right.some((value) => left.has(value));

const collectTokenSet = (value: string): ReadonlySet<string> =>
  new Set(normalizeText(value).split(" ").filter((token) => token.length > 0));

const hasAnyToken = (
  available: ReadonlySet<string>,
  tokens: readonly string[],
): boolean => tokens.some((token) => available.has(token));

const collectCaseText = (testCase: GeneratedTestCase): string =>
  normalizeText(
    [
      testCase.title,
      testCase.objective,
      ...testCase.preconditions,
      ...testCase.testData,
      ...testCase.expectedResults,
      ...testCase.steps.flatMap((step) => [
        step.action,
        step.data ?? "",
        step.expected ?? "",
      ]),
    ].join(" "),
  );

const buildCaseContext = (testCase: GeneratedTestCase): CaseContext => ({
  testCase,
  text: collectCaseText(testCase),
  tokens: collectTokenSet(collectCaseText(testCase)),
  coveredFieldIds: new Set(testCase.qualitySignals.coveredFieldIds),
  coveredActionIds: new Set(testCase.qualitySignals.coveredActionIds),
  coveredValidationIds: new Set(testCase.qualitySignals.coveredValidationIds),
  coveredNavigationIds: new Set(testCase.qualitySignals.coveredNavigationIds),
  touchedScreens: new Set(testCase.figmaTraceRefs.map((trace) => trace.screenId)),
});

const buildFieldTokens = (screen: TestDesignScreen): ReadonlyMap<string, string[]> =>
  new Map(
    screen.elements.map((element) => [
      element.elementId,
      uniqueSorted([element.label, element.kind].flatMap(tokenize)),
    ]),
  );

const extractRuleLabel = (description: string): string | undefined => {
  const index = description.indexOf(":");
  if (index <= 0) return undefined;
  const label = description.slice(0, index).trim();
  return label.length === 0 ? undefined : label;
};

const inferRuleTargetElementId = (
  screen: TestDesignScreen | undefined,
  rule: TestDesignRule,
): string | undefined => {
  if (screen === undefined) return undefined;
  const label = extractRuleLabel(rule.description);
  if (label === undefined) return undefined;
  const normalizedLabel = normalizeText(label);
  return screen.elements.find(
    (element) => normalizeText(element.label) === normalizedLabel,
  )?.elementId;
};

const buildValidationMutations = (
  model: TestDesignModel,
): MutationCandidate[] => {
  const mutations: MutationCandidate[] = [];
  for (const screen of model.screens) {
    const fieldTokens = buildFieldTokens(screen);
    for (const validation of screen.validations) {
      if (REQUIRED_RULE_PATTERN.test(validation.rule)) {
        mutations.push(
          buildFlipRequiredMutation({ screen, validation, fieldTokens }),
        );
      }
      if (BOUNDARY_RULE_PATTERN.test(validation.rule)) {
        mutations.push(
          buildShrinkBoundaryMutation({ screen, validation, fieldTokens }),
        );
      }
    }
  }
  return mutations;
};

const buildFlipRequiredMutation = (input: {
  screen: TestDesignScreen;
  validation: TestDesignValidation;
  fieldTokens: ReadonlyMap<string, string[]>;
}): MutationCandidate => {
  const fieldId = input.validation.targetElementId;
  const tokens = uniqueSorted([
    input.validation.rule,
    ...(fieldId === undefined ? [] : input.fieldTokens.get(fieldId) ?? []),
  ].flatMap((value) => (typeof value === "string" ? tokenize(value) : value)));
  const relevantFieldIds = fieldId === undefined ? [] : [fieldId];
  const mutationId = buildMutationId({
    kind: "flip_required",
    screenId: input.screen.screenId,
    validationId: input.validation.validationId,
    fieldId,
  });
  return {
    mutationId,
    mutationKind: "flip_required",
    affectedSourceRefs: uniqueSorted(input.screen.sourceRefs),
    kills: (context) => {
      const relevant =
        context.coveredValidationIds.has(input.validation.validationId) ||
        intersects(context.coveredFieldIds, relevantFieldIds);
      if (!relevant) return false;
      if (!REQUIRED_CASE_PATTERN.test(context.text)) return false;
      return (
        context.coveredValidationIds.has(input.validation.validationId) ||
        hasAnyToken(context.tokens, tokens)
      );
    },
  };
};

const buildShrinkBoundaryMutation = (input: {
  screen: TestDesignScreen;
  validation: TestDesignValidation;
  fieldTokens: ReadonlyMap<string, string[]>;
}): MutationCandidate => {
  const fieldId = input.validation.targetElementId;
  const tokens = uniqueSorted([
    input.validation.rule,
    ...(fieldId === undefined ? [] : input.fieldTokens.get(fieldId) ?? []),
  ].flatMap((value) => (typeof value === "string" ? tokenize(value) : value)));
  const relevantFieldIds = fieldId === undefined ? [] : [fieldId];
  const mutationId = buildMutationId({
    kind: "shrink_boundary",
    screenId: input.screen.screenId,
    validationId: input.validation.validationId,
    fieldId,
  });
  return {
    mutationId,
    mutationKind: "shrink_boundary",
    affectedSourceRefs: uniqueSorted(input.screen.sourceRefs),
    kills: (context) => {
      const relevant =
        context.coveredValidationIds.has(input.validation.validationId) ||
        intersects(context.coveredFieldIds, relevantFieldIds);
      if (!relevant) return false;
      const boundaryTechnique =
        context.testCase.type === "boundary" ||
        context.testCase.technique === "boundary_value_analysis";
      if (!boundaryTechnique && !BOUNDARY_CASE_PATTERN.test(context.text)) {
        return false;
      }
      return (
        context.coveredValidationIds.has(input.validation.validationId) ||
        hasAnyToken(context.tokens, tokens)
      );
    },
  };
};

const buildTransitionMutations = (
  model: TestDesignModel,
): MutationCandidate[] => {
  const screensById = new Map(model.screens.map((screen) => [screen.screenId, screen]));
  return model.screens.flatMap((screen) =>
    screen.actions
      .filter((action) => action.targetScreenId !== undefined)
      .map((action) => {
        const targetScreen = screensById.get(action.targetScreenId!);
        const tokens = uniqueSorted(
          [
            action.label,
            targetScreen?.name ?? "",
            targetScreen?.screenId ?? "",
          ].flatMap(tokenize),
        );
        const mutationId = buildMutationId({
          kind: "drop_state_transition",
          screenId: screen.screenId,
          actionId: action.actionId,
          targetScreenId: action.targetScreenId,
        });
        return {
          mutationId,
          mutationKind: "drop_state_transition" as const,
          affectedSourceRefs: uniqueSorted([
            ...screen.sourceRefs,
            ...(targetScreen?.sourceRefs ?? []),
          ]),
          kills: (context: CaseContext) => {
            if (
              !context.coveredActionIds.has(action.actionId) &&
              !(
                context.coveredNavigationIds.size > 0 &&
                context.touchedScreens.has(screen.screenId)
              )
            ) {
              return false;
            }
            if (
              context.testCase.type !== "navigation" &&
              !TRANSITION_CASE_PATTERN.test(context.text)
            ) {
              return false;
            }
            return hasAnyToken(context.tokens, tokens);
          },
        } satisfies MutationCandidate;
      }),
  );
};

const buildEquivalenceMutations = (
  model: TestDesignModel,
): MutationCandidate[] => {
  const screensById = new Map(model.screens.map((screen) => [screen.screenId, screen]));
  return model.businessRules
    .filter(
      (rule) =>
        !REQUIRED_RULE_PATTERN.test(rule.description) &&
        !BOUNDARY_RULE_PATTERN.test(rule.description),
    )
    .filter((rule) => !/\b(if|when|unless|otherwise)\b/i.test(rule.description))
    .map((rule) => {
      const screen = rule.screenId === undefined ? undefined : screensById.get(rule.screenId);
      const targetElementId = inferRuleTargetElementId(screen, rule);
      const relevantFieldIds =
        targetElementId === undefined ? [] : [targetElementId];
      const fieldLabel =
        targetElementId === undefined
          ? undefined
          : screen?.elements.find((element) => element.elementId === targetElementId)
              ?.label;
      const tokens = uniqueSorted(
        [rule.description, fieldLabel ?? ""].flatMap(tokenize),
      );
      const mutationId = buildMutationId({
        kind: "swap_equivalence_class",
        ruleId: rule.ruleId,
        screenId: rule.screenId ?? null,
        targetElementId,
      });
      return {
        mutationId,
        mutationKind: "swap_equivalence_class" as const,
        affectedSourceRefs: uniqueSorted(rule.sourceRefs),
        kills: (context: CaseContext) => {
          const relevant =
            relevantFieldIds.length > 0
              ? intersects(context.coveredFieldIds, relevantFieldIds)
              : rule.screenId !== undefined &&
                context.touchedScreens.has(rule.screenId);
          if (!relevant) return false;
          const partitionTechnique =
            context.testCase.technique === "equivalence_partitioning" ||
            context.testCase.type === "negative";
          if (!partitionTechnique && !EQUIVALENCE_CASE_PATTERN.test(context.text)) {
            return false;
          }
          return hasAnyToken(context.tokens, tokens);
        },
      } satisfies MutationCandidate;
    });
};

const buildDecisionMutations = (
  model: TestDesignModel,
): MutationCandidate[] => {
  return model.screens.flatMap((screen) =>
    screen.calculations.map((calculation) =>
      buildDecisionMutation({ screen, calculation }),
    ),
  );
};

const buildDecisionMutation = (input: {
  screen: TestDesignScreen;
  calculation: TestDesignCalculation;
}): MutationCandidate => {
  const fieldTokens = buildFieldTokens(input.screen);
  const inputTokens = uniqueSorted([
    input.calculation.name,
    ...input.calculation.inputElementIds.flatMap(
      (fieldId) => fieldTokens.get(fieldId) ?? [],
    ),
  ].flatMap((value) => (typeof value === "string" ? tokenize(value) : value)));
  const mutationId = buildMutationId({
    kind: "invert_decision_rule",
    screenId: input.screen.screenId,
    calculationId: input.calculation.calculationId,
  });
  return {
    mutationId,
    mutationKind: "invert_decision_rule",
    affectedSourceRefs: uniqueSorted(input.screen.sourceRefs),
    kills: (context) => {
      if (
        !intersects(context.coveredFieldIds, input.calculation.inputElementIds) &&
        !context.touchedScreens.has(input.screen.screenId)
      ) {
        return false;
      }
      if (
        context.testCase.technique !== "decision_table" &&
        !DECISION_CASE_PATTERN.test(context.text)
      ) {
        return false;
      }
      return hasAnyToken(context.tokens, inputTokens);
    },
  };
};

const enumerateMutations = (model: TestDesignModel): MutationCandidate[] => {
  const mutations = [
    ...buildValidationMutations(model),
    ...buildTransitionMutations(model),
    ...buildEquivalenceMutations(model),
    ...buildDecisionMutations(model),
  ];
  return [...new Map(mutations.map((mutation) => [mutation.mutationId, mutation])).values()].sort(
    (left, right) => left.mutationId.localeCompare(right.mutationId),
  );
};

export const computeIrMutationCoverageStrength = (
  input: ComputeIrMutationCoverageStrengthInput,
): IrMutationCoverageStrengthReport => {
  if (input.model.jobId !== input.list.jobId) {
    throw new RangeError(
      "computeIrMutationCoverageStrength: model.jobId must match list.jobId",
    );
  }

  const mutations = enumerateMutations(input.model);
  const contexts = input.list.testCases.map(buildCaseContext);
  const perMutation = mutations.map((mutation) => {
    const killedByTestCaseIds = uniqueSorted(
      contexts
        .filter((context) => mutation.kills(context))
        .map((context) => context.testCase.id),
    );
    return {
      mutationId: mutation.mutationId,
      mutationKind: mutation.mutationKind,
      affectedSourceRefs: uniqueSorted(mutation.affectedSourceRefs),
      killedByTestCaseIds,
    };
  });
  const killedMutations = perMutation.filter(
    (mutation) => mutation.killedByTestCaseIds.length > 0,
  ).length;
  const mutationCount = perMutation.length;
  const survivingMutationsForRepair = perMutation
    .filter((mutation) => mutation.killedByTestCaseIds.length === 0)
    .map((mutation) => mutation.mutationId);

  return {
    schemaVersion: IR_MUTATION_COVERAGE_STRENGTH_REPORT_SCHEMA_VERSION,
    jobId: input.model.jobId,
    mutationCount,
    killedMutations,
    mutationKillRate:
      mutationCount === 0 ? 1 : roundTo(killedMutations / mutationCount, 6),
    perMutation,
    survivingMutationsForRepair,
  };
};

export const writeIrMutationCoverageStrengthArtifact = async (input: {
  readonly report: IrMutationCoverageStrengthReport;
  readonly runDir: string;
}): Promise<{ artifactPath: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeIrMutationCoverageStrengthArtifact: runDir must be a non-empty string",
    );
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(
    input.runDir,
    IR_MUTATION_COVERAGE_STRENGTH_REPORT_ARTIFACT_FILENAME,
  );
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.report), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};
