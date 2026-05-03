import {
  ALLOWED_CONTEXT_BUDGET_CATEGORY_KINDS,
  CONTEXT_BUDGET_REPORT_SCHEMA_VERSION,
  type ContextBudgetAction,
  type ContextBudgetCategory,
  type ContextBudgetCategoryKind,
  type ContextBudgetPriority,
  type ContextBudgetReport,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { estimateLlmInputTokens, estimateTextTokens } from "./llm-token-estimator.js";

const CATEGORY_ORDER: readonly ContextBudgetCategoryKind[] =
  ALLOWED_CONTEXT_BUDGET_CATEGORY_KINDS;

const RETENTION_ORDER: readonly ContextBudgetCategoryKind[] = [
  "repair_history",
  "judge_findings",
  "validation_findings",
  "generated_cases",
  "source_context",
  "visual_binding",
  "coverage_plan",
  "business_intent_ir",
  "system_instructions",
] as const;

const compactedBlock = (input: {
  kind: ContextBudgetCategoryKind;
  artifactHashes: readonly string[];
}): string => {
  const label = input.kind.toUpperCase();
  const lines = [
    `${label} compacted from prompt payload due to context budget.`,
    "Source-of-truth artifact hashes:",
    ...(input.artifactHashes.length === 0
      ? ["- unavailable"]
      : input.artifactHashes.map((artifactHash) => `- ${artifactHash}`)),
  ];
  return lines.join("\n");
};

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const categoryRank = (kind: ContextBudgetCategoryKind): number =>
  CATEGORY_ORDER.indexOf(kind);

const validateHash = (value: string): boolean => /^[0-9a-f]{64}$/u.test(value);

export interface ContextBudgetCategoryInput {
  kind: ContextBudgetCategoryKind;
  priority: ContextBudgetPriority;
  promptPayload: string;
  artifactHashes: readonly string[];
  compactible: boolean;
  droppable: boolean;
}

export interface AnalyzeContextBudgetInput {
  jobId: string;
  roleStepId: string;
  modelBinding: string;
  maxInputTokens: number;
  systemPrompt: string;
  responseSchema?: Record<string, unknown>;
  categories: readonly ContextBudgetCategoryInput[];
}

export interface AnalyzeContextBudgetResult {
  report: ContextBudgetReport;
  renderedUserPrompt: string;
  finalEstimatedInputTokens: number;
  contextBudgetHash: string;
}

interface WorkingCategory {
  kind: ContextBudgetCategoryKind;
  priority: ContextBudgetPriority;
  promptPayload: string;
  artifactHashes: string[];
  compactible: boolean;
  droppable: boolean;
  estimatedTokens: number;
  status: ContextBudgetCategory["status"];
}

const toWorkingCategory = (
  category: ContextBudgetCategoryInput,
): WorkingCategory => {
  return {
    kind: category.kind,
    priority: category.priority,
    promptPayload: category.promptPayload,
    artifactHashes: uniqueSorted(category.artifactHashes).filter(validateHash),
    compactible: category.compactible,
    droppable: category.droppable,
    estimatedTokens: estimateTextTokens(category.promptPayload),
    status: "included",
  };
};

const renderUserPrompt = (categories: readonly WorkingCategory[]): string =>
  categories
    .filter((category) => category.status !== "dropped")
    .sort((left, right) => categoryRank(left.kind) - categoryRank(right.kind))
    .map((category) =>
      category.status === "compacted"
        ? compactedBlock({
            kind: category.kind,
            artifactHashes: category.artifactHashes,
          })
        : category.promptPayload,
    )
    .join("\n");

const estimatePromptTokens = (input: {
  systemPrompt: string;
  userPrompt: string;
  responseSchema?: Record<string, unknown>;
}): number => {
  const request = {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    ...(input.responseSchema !== undefined
      ? { responseSchema: input.responseSchema }
      : {}),
  };
  return estimateLlmInputTokens(request);
};

const toReportCategories = (
  systemPrompt: string,
  categories: readonly WorkingCategory[],
): ContextBudgetCategory[] => {
  const records: ContextBudgetCategory[] = [
    {
      kind: "system_instructions",
      priority: "required",
      estimatedTokens: estimateTextTokens(systemPrompt),
      status: "included",
      artifactHashes: [],
    },
    ...categories
      .slice()
      .sort((left, right) => categoryRank(left.kind) - categoryRank(right.kind))
      .map((category) => ({
        kind: category.kind,
        priority: category.priority,
        estimatedTokens: category.estimatedTokens,
        status: category.status,
        artifactHashes: category.artifactHashes,
      })),
  ];
  return records;
};

const buildReport = (input: {
  base: AnalyzeContextBudgetInput;
  categories: readonly WorkingCategory[];
  action: ContextBudgetAction;
  estimatedInputTokens: number;
}): ContextBudgetReport => {
  const compactedFromArtifactHashes = uniqueSorted(
    input.categories
      .filter((category) => category.status === "compacted")
      .flatMap((category) => category.artifactHashes),
  );
  return {
    schemaVersion: CONTEXT_BUDGET_REPORT_SCHEMA_VERSION,
    jobId: input.base.jobId,
    roleStepId: input.base.roleStepId,
    modelBinding: input.base.modelBinding,
    maxInputTokens: input.base.maxInputTokens,
    estimatedInputTokens: input.estimatedInputTokens,
    categories: toReportCategories(input.base.systemPrompt, input.categories),
    action: input.action,
    compactedFromArtifactHashes,
  };
};

const invalidBudgetReport = (
  input: AnalyzeContextBudgetInput,
  estimatedInputTokens: number,
  categories: readonly WorkingCategory[],
): AnalyzeContextBudgetResult => {
  const renderedUserPrompt = renderUserPrompt(categories);
  const report = buildReport({
    base: input,
    categories,
    action: "needs_review",
    estimatedInputTokens,
  });
  return {
    report,
    renderedUserPrompt,
    finalEstimatedInputTokens: estimatedInputTokens,
    contextBudgetHash: sha256Hex(
      canonicalJson({
        renderedUserPrompt,
        report,
      }),
    ),
  };
};

export const analyzeContextBudget = (
  input: AnalyzeContextBudgetInput,
): AnalyzeContextBudgetResult => {
  const categories = input.categories.map(toWorkingCategory);
  const renderedFullPrompt = renderUserPrompt(categories);
  const fullEstimatedInputTokens = estimatePromptTokens({
    systemPrompt: input.systemPrompt,
    userPrompt: renderedFullPrompt,
    ...(input.responseSchema !== undefined
      ? { responseSchema: input.responseSchema }
      : {}),
  });

  if (
    !Number.isSafeInteger(input.maxInputTokens) ||
    input.maxInputTokens <= 0 ||
    categories.some(
      (category) =>
        category.priority === "required" && category.droppable === true,
    )
  ) {
    return invalidBudgetReport(input, fullEstimatedInputTokens, categories);
  }

  let renderedUserPrompt = renderedFullPrompt;
  let finalEstimatedInputTokens = fullEstimatedInputTokens;
  let action: ContextBudgetAction = "none";

  if (finalEstimatedInputTokens > input.maxInputTokens) {
    for (const kind of RETENTION_ORDER) {
      const category = categories.find(
        (candidate) =>
          candidate.kind === kind &&
          candidate.status === "included" &&
          candidate.compactible,
      );
      if (category === undefined) continue;
      category.status = "compacted";
      renderedUserPrompt = renderUserPrompt(categories);
      finalEstimatedInputTokens = estimatePromptTokens({
        systemPrompt: input.systemPrompt,
        userPrompt: renderedUserPrompt,
        ...(input.responseSchema !== undefined
          ? { responseSchema: input.responseSchema }
          : {}),
      });
      if (finalEstimatedInputTokens <= input.maxInputTokens) {
        action = "compact_prompt_payload";
        break;
      }
    }
  }

  if (finalEstimatedInputTokens > input.maxInputTokens) {
    for (const kind of RETENTION_ORDER) {
      const category = categories.find(
        (candidate) =>
          candidate.kind === kind &&
          candidate.status !== "dropped" &&
          candidate.priority === "optional" &&
          candidate.droppable,
      );
      if (category === undefined) continue;
      category.status = "dropped";
      renderedUserPrompt = renderUserPrompt(categories);
      finalEstimatedInputTokens = estimatePromptTokens({
        systemPrompt: input.systemPrompt,
        userPrompt: renderedUserPrompt,
        ...(input.responseSchema !== undefined
          ? { responseSchema: input.responseSchema }
          : {}),
      });
      if (finalEstimatedInputTokens <= input.maxInputTokens) {
        action = "drop_optional_context";
        break;
      }
    }
  }

  if (finalEstimatedInputTokens > input.maxInputTokens) {
    action = "needs_review";
  }

  const report = buildReport({
    base: input,
    categories,
    action,
    estimatedInputTokens: finalEstimatedInputTokens,
  });
  const contextBudgetHash = sha256Hex(
    canonicalJson({
      renderedUserPrompt,
      report,
    }),
  );
  return {
    report,
    renderedUserPrompt,
    finalEstimatedInputTokens,
    contextBudgetHash,
  };
};
