import type { WorkspaceComponentMappingRule } from "./contracts/index.js";
import type { FigmaLibraryResolutionArtifact } from "./job-engine/figma-library-resolution.js";
import type { FigmaAnalysis } from "./parity/figma-analysis.js";
import type {
  ComponentMappingRule,
  ComponentMappingSource,
  ComponentMappingWarning
} from "./parity/types-mapping.js";
import type { DesignIR, ScreenElementIR } from "./parity/types-ir.js";
import type {
  ComponentMatchReportArtifact,
  ComponentMatchReportFigmaLibraryResolution
} from "./storybook/types.js";

type ComponentMappingPatternSelectorKey =
  | "nodeNamePattern"
  | "canonicalComponentName"
  | "storybookTier"
  | "figmaLibrary"
  | "semanticType";

export const COMPONENT_MAPPING_PATTERN_SELECTOR_KEYS: readonly ComponentMappingPatternSelectorKey[] = [
  "nodeNamePattern",
  "canonicalComponentName",
  "storybookTier",
  "figmaLibrary",
  "semanticType"
] as const;
type ComponentMappingRuleKind = "exact" | "pattern";

interface ComponentMappingNodeContext {
  nodeId: string;
  nodeName: string;
  semanticType?: string;
  familyKey: string;
  canonicalComponentName?: string;
  storybookTier?: string;
  figmaLibrary?: string;
  figmaLibraryResolution?: ComponentMatchReportFigmaLibraryResolution;
}

interface NormalizedComponentMappingRule extends ComponentMappingRule {
  nodeId?: string;
  nodeNamePattern?: string;
  canonicalComponentName?: string;
  storybookTier?: string;
  figmaLibrary?: string;
  semanticType?: string;
}

type ComponentMappingRuleValidationResult =
  | {
      ok: true;
      kind: ComponentMappingRuleKind;
      normalizedRule: NormalizedComponentMappingRule;
      nodeNameRegex?: RegExp;
    }
  | {
      ok: false;
      normalizedRule: NormalizedComponentMappingRule;
      message: string;
      field?: string;
    };

export interface ResolveComponentMappingRulesResult {
  componentMappings: ComponentMappingRule[];
  mappingWarnings: ComponentMappingWarning[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const MAX_NODE_NAME_PATTERN_LENGTH = 256;
const MAX_QUANTIFIER_COUNT = 3;
const MAX_BRACE_REPEAT = 1000;
const NESTED_QUANTIFIER_PATTERN = /(\+|\*|\{)\)?(\+|\*|\{)/;
const ALTERNATION_QUANTIFIER_PATTERN = /\([^)]*\|[^)]*\)[+*{]/;

const countQuantifiersOutsideCharClass = (pattern: string): number => {
  let count = 0;
  let inCharClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\" && !inCharClass) {
      i++;
      continue;
    }
    if (char === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (char === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (inCharClass) {
      continue;
    }
    if (char === "+" || char === "*") {
      count++;
    }
    if (char === "{" && i + 1 < pattern.length && /\d/.test(pattern[i + 1]!)) {
      count++;
    }
  }
  return count;
};

const exceedsBraceRepeatLimit = (pattern: string): boolean => {
  const bracePattern = /\{(\d+)(?:,(\d*))?\}/g;
  let match: RegExpExecArray | null;
  while ((match = bracePattern.exec(pattern)) !== null) {
    const min = Number(match[1]);
    const max = match[2] !== undefined && match[2] !== "" ? Number(match[2]) : undefined;
    if (min > MAX_BRACE_REPEAT || (max !== undefined && max > MAX_BRACE_REPEAT)) {
      return true;
    }
  }
  return false;
};

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const normalizeComparableToken = (value: string | undefined): string | undefined => {
  return normalizeOptionalString(value)?.toLowerCase();
};

const normalizeFigmaLibraryResolution = ({
  entry
}: {
  entry:
    | ComponentMatchReportArtifact["entries"][number]["figma"]["figmaLibraryResolution"]
    | FigmaLibraryResolutionArtifact["entries"][number]
    | undefined;
}): ComponentMatchReportFigmaLibraryResolution | undefined => {
  if (!entry) {
    return undefined;
  }
  if ("designLinks" in entry) {
    return entry;
  }
  const designLinks = [
    ...(entry.publishedComponentSet
      ? [
          {
            fileKey: entry.publishedComponentSet.fileKey,
            ...(entry.publishedComponentSet.nodeId ? { nodeId: entry.publishedComponentSet.nodeId } : {})
          }
        ]
      : []),
    ...(entry.publishedComponent
      ? [
          {
            fileKey: entry.publishedComponent.fileKey,
            ...(entry.publishedComponent.nodeId ? { nodeId: entry.publishedComponent.nodeId } : {})
          }
        ]
      : [])
  ].sort((left, right) => {
    const byFileKey = left.fileKey.localeCompare(right.fileKey);
    if (byFileKey !== 0) {
      return byFileKey;
    }
    return (left.nodeId ?? "").localeCompare(right.nodeId ?? "");
  });
  return {
    status: entry.status,
    resolutionSource: entry.resolutionSource,
    ...(entry.originFileKey ? { originFileKey: entry.originFileKey } : {}),
    ...(entry.canonicalFamilyName ? { canonicalFamilyName: entry.canonicalFamilyName } : {}),
    canonicalFamilyNameSource: entry.canonicalFamilyNameSource,
    issues: (entry.issues ?? []).map((issue) => ({
      code: issue.code,
      message: issue.message,
      scope: issue.scope,
      ...(issue.retriable !== undefined ? { retriable: issue.retriable } : {})
    })),
    designLinks
  };
};

const toSourceOrder = (source: ComponentMappingSource | undefined): number => {
  return source === "local_override" ? 0 : 1;
};

const compareComponentMappings = (left: NormalizedComponentMappingRule, right: NormalizedComponentMappingRule): number => {
  const leftHasNodeId = typeof left.nodeId === "string" && left.nodeId.length > 0;
  const rightHasNodeId = typeof right.nodeId === "string" && right.nodeId.length > 0;
  if (leftHasNodeId !== rightHasNodeId) {
    return leftHasNodeId ? -1 : 1;
  }
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  const sourceOrder = toSourceOrder(left.source) - toSourceOrder(right.source);
  if (sourceOrder !== 0) {
    return sourceOrder;
  }
  const leftKey = left.nodeId ?? describeComponentMappingRule({ rule: left });
  const rightKey = right.nodeId ?? describeComponentMappingRule({ rule: right });
  return leftKey.localeCompare(rightKey);
};

const flattenElements = (elements: readonly ScreenElementIR[]): ScreenElementIR[] => {
  const flattened: ScreenElementIR[] = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    flattened.push(current);
    for (let index = (current.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      const child = current.children?.[index];
      if (child) {
        stack.push(child);
      }
    }
  }
  return flattened;
};

const normalizePatternSelectorValue = ({
  rule,
  key
}: {
  rule: WorkspaceComponentMappingRule;
  key: ComponentMappingPatternSelectorKey;
}): string | undefined => {
  const rawValue = rule[key];
  return typeof rawValue === "string" ? normalizeOptionalString(rawValue) : undefined;
};

export const normalizeComponentMappingRule = ({
  rule
}: {
  rule: WorkspaceComponentMappingRule;
}): NormalizedComponentMappingRule => {
  const normalizedRule: NormalizedComponentMappingRule = {
    boardKey: normalizeOptionalString(rule.boardKey) ?? "",
    componentName: normalizeOptionalString(rule.componentName) ?? "",
    importPath: normalizeOptionalString(rule.importPath) ?? "",
    priority: rule.priority,
    source: rule.source,
    enabled: rule.enabled
  };
  if (rule.id !== undefined) {
    normalizedRule.id = rule.id;
  }
  const normalizedNodeId = normalizeOptionalString(rule.nodeId);
  if (normalizedNodeId) {
    normalizedRule.nodeId = normalizedNodeId;
  }
  const normalizedNodeNamePattern = normalizePatternSelectorValue({ rule, key: "nodeNamePattern" });
  if (normalizedNodeNamePattern) {
    normalizedRule.nodeNamePattern = normalizedNodeNamePattern;
  }
  const normalizedCanonicalComponentName = normalizePatternSelectorValue({ rule, key: "canonicalComponentName" });
  if (normalizedCanonicalComponentName) {
    normalizedRule.canonicalComponentName = normalizedCanonicalComponentName;
  }
  const normalizedStorybookTier = normalizePatternSelectorValue({ rule, key: "storybookTier" });
  if (normalizedStorybookTier) {
    normalizedRule.storybookTier = normalizedStorybookTier;
  }
  const normalizedFigmaLibrary = normalizePatternSelectorValue({ rule, key: "figmaLibrary" });
  if (normalizedFigmaLibrary) {
    normalizedRule.figmaLibrary = normalizedFigmaLibrary;
  }
  const normalizedSemanticType = normalizePatternSelectorValue({ rule, key: "semanticType" });
  if (normalizedSemanticType) {
    normalizedRule.semanticType = normalizedSemanticType;
  }
  if (rule.propContract !== undefined) {
    normalizedRule.propContract = rule.propContract;
  }
  const normalizedCreatedAt = normalizeOptionalString(rule.createdAt);
  if (normalizedCreatedAt) {
    normalizedRule.createdAt = normalizedCreatedAt;
  }
  const normalizedUpdatedAt = normalizeOptionalString(rule.updatedAt);
  if (normalizedUpdatedAt) {
    normalizedRule.updatedAt = normalizedUpdatedAt;
  }
  return normalizedRule;
};

export const normalizeComponentMappingRules = ({
  rules
}: {
  rules: readonly WorkspaceComponentMappingRule[];
}): NormalizedComponentMappingRule[] => {
  return rules.map((rule) => normalizeComponentMappingRule({ rule }));
};

export const describeComponentMappingRule = ({
  rule
}: {
  rule: Pick<
    WorkspaceComponentMappingRule,
    "boardKey" | "canonicalComponentName" | "figmaLibrary" | "id" | "nodeId" | "nodeNamePattern" | "semanticType" | "storybookTier"
  >;
}): string => {
  if (typeof rule.id === "number") {
    return `#${rule.id}`;
  }
  if (normalizeOptionalString(rule.nodeId)) {
    return `node '${normalizeOptionalString(rule.nodeId)}'`;
  }
  const parts = COMPONENT_MAPPING_PATTERN_SELECTOR_KEYS.flatMap((key) => {
    const value = typeof rule[key] === "string" ? normalizeOptionalString(rule[key]) : undefined;
    return value ? [`${key}='${value}'`] : [];
  });
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return `board '${normalizeOptionalString(rule.boardKey) ?? "unknown"}'`;
};

export const validateComponentMappingRule = ({
  rule
}: {
  rule: WorkspaceComponentMappingRule;
}): ComponentMappingRuleValidationResult => {
  const normalizedRule = normalizeComponentMappingRule({ rule });
  if (!normalizedRule.boardKey) {
    return {
      ok: false,
      normalizedRule,
      message: "boardKey must be a non-empty string."
    };
  }
  if (!normalizedRule.componentName) {
    return {
      ok: false,
      normalizedRule,
      message: "componentName must be a non-empty string."
    };
  }
  if (!normalizedRule.importPath) {
    return {
      ok: false,
      normalizedRule,
      message: "importPath must be a non-empty string."
    };
  }
  if (!Number.isFinite(normalizedRule.priority)) {
    return {
      ok: false,
      normalizedRule,
      message: "priority must be a finite number."
    };
  }
  const sourceValue: string = normalizedRule.source;
  if (sourceValue !== "local_override" && sourceValue !== "code_connect_import") {
    return {
      ok: false,
      normalizedRule,
      message: "source must be either 'local_override' or 'code_connect_import'."
    };
  }
  if (typeof normalizedRule.enabled !== "boolean") {
    return {
      ok: false,
      normalizedRule,
      message: "enabled must be a boolean."
    };
  }
  if (normalizedRule.propContract !== undefined && !isRecord(normalizedRule.propContract)) {
    return {
      ok: false,
      normalizedRule,
      message: "propContract must be an object when provided."
    };
  }

  const selectorValues = COMPONENT_MAPPING_PATTERN_SELECTOR_KEYS
    .map((key) => normalizePatternSelectorValue({ rule: normalizedRule, key }))
    .filter((value): value is string => value !== undefined);
  const hasNodeId = typeof normalizedRule.nodeId === "string" && normalizedRule.nodeId.length > 0;
  const hasPatternSelectors = selectorValues.length > 0;

  if (hasNodeId && hasPatternSelectors) {
    return {
      ok: false,
      normalizedRule,
      message: "component mapping rules must be either exact (nodeId only) or pattern-based (selectors only)."
    };
  }
  if (!hasNodeId && !hasPatternSelectors) {
    return {
      ok: false,
      normalizedRule,
      message:
        "pattern component mapping rules must define at least one selector: nodeNamePattern, canonicalComponentName, storybookTier, figmaLibrary, or semanticType."
    };
  }
  if (hasNodeId) {
    return {
      ok: true,
      kind: "exact",
      normalizedRule
    };
  }

  let nodeNameRegex: RegExp | undefined;
  if (normalizedRule.nodeNamePattern) {
    if (normalizedRule.nodeNamePattern.length > MAX_NODE_NAME_PATTERN_LENGTH) {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: `nodeNamePattern must not exceed ${MAX_NODE_NAME_PATTERN_LENGTH} characters.`
      };
    }
    if (NESTED_QUANTIFIER_PATTERN.test(normalizedRule.nodeNamePattern)) {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: "nodeNamePattern must not contain nested quantifiers (potential ReDoS)."
      };
    }
    if (ALTERNATION_QUANTIFIER_PATTERN.test(normalizedRule.nodeNamePattern)) {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: "nodeNamePattern must not contain alternation groups followed by quantifiers (potential ReDoS)."
      };
    }
    if (countQuantifiersOutsideCharClass(normalizedRule.nodeNamePattern) > MAX_QUANTIFIER_COUNT) {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: `nodeNamePattern must not contain more than ${MAX_QUANTIFIER_COUNT} quantifiers (potential ReDoS).`
      };
    }
    if (exceedsBraceRepeatLimit(normalizedRule.nodeNamePattern)) {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: `nodeNamePattern brace quantifier repeat count must not exceed ${MAX_BRACE_REPEAT}.`
      };
    }
    try {
      nodeNameRegex = new RegExp(normalizedRule.nodeNamePattern, "iu");
    } catch {
      return {
        ok: false,
        normalizedRule,
        field: "nodeNamePattern",
        message: "nodeNamePattern must be a valid regular expression source."
      };
    }
  }

  return {
    ok: true,
    kind: "pattern",
    normalizedRule,
    ...(nodeNameRegex ? { nodeNameRegex } : {})
  };
};

const buildComponentMappingNodeContexts = ({
  ir,
  figmaAnalysis,
  componentMatchReportArtifact,
  figmaLibraryResolutionArtifact
}: {
  ir: DesignIR;
  figmaAnalysis: FigmaAnalysis;
  componentMatchReportArtifact: ComponentMatchReportArtifact;
  figmaLibraryResolutionArtifact?: FigmaLibraryResolutionArtifact;
}): ComponentMappingNodeContext[] => {
  const familyKeyByNodeId = new Map<string, string>();
  for (const family of figmaAnalysis.componentFamilies) {
    for (const nodeId of family.referringNodeIds) {
      if (!familyKeyByNodeId.has(nodeId)) {
        familyKeyByNodeId.set(nodeId, family.familyKey);
      }
    }
  }

  const componentMatchEntriesByFamilyKey = new Map(
    componentMatchReportArtifact.entries.map((entry) => [entry.figma.familyKey, entry] as const)
  );
  const figmaLibraryEntriesByFamilyKey = new Map(
    (figmaLibraryResolutionArtifact?.entries ?? []).map((entry) => [entry.familyKey, entry] as const)
  );

  return ir.screens.flatMap((screen) =>
    flattenElements(screen.children).flatMap((element) => {
      const familyKey = familyKeyByNodeId.get(element.id);
      if (!familyKey) {
        return [];
      }
      const componentMatchEntry = componentMatchEntriesByFamilyKey.get(familyKey);
      if (!componentMatchEntry) {
        return [];
      }
      const figmaLibraryResolution =
        componentMatchEntry.figma.figmaLibraryResolution ??
        normalizeFigmaLibraryResolution({
          entry: figmaLibraryEntriesByFamilyKey.get(familyKey)
        });
      const nodeContext: ComponentMappingNodeContext = {
        nodeId: element.id,
        nodeName: normalizeOptionalString(element.name) ?? "",
        familyKey,
        ...(figmaLibraryResolution ? { figmaLibraryResolution } : {})
      };
      const normalizedSemanticType = normalizeOptionalString(element.semanticType);
      if (normalizedSemanticType) {
        nodeContext.semanticType = normalizedSemanticType;
      }
      const normalizedCanonicalComponentName = normalizeOptionalString(
        figmaLibraryResolution?.canonicalFamilyName ?? componentMatchEntry.figma.canonicalFamilyName ?? componentMatchEntry.figma.familyName
      );
      if (normalizedCanonicalComponentName) {
        nodeContext.canonicalComponentName = normalizedCanonicalComponentName;
      }
      const normalizedStorybookTier = normalizeOptionalString(componentMatchEntry.storybookFamily?.tier);
      if (normalizedStorybookTier) {
        nodeContext.storybookTier = normalizedStorybookTier;
      }
      const normalizedFigmaLibrary = normalizeOptionalString(figmaLibraryResolution?.originFileKey);
      if (normalizedFigmaLibrary) {
        nodeContext.figmaLibrary = normalizedFigmaLibrary;
      }
      return [nodeContext];
    })
  );
};

const matchesPatternRule = ({
  ruleCanonicalComponentName,
  ruleStorybookTier,
  ruleFigmaLibrary,
  ruleSemanticType,
  nodeContext,
  nodeNameRegex
}: {
  ruleCanonicalComponentName: string | undefined;
  ruleStorybookTier: string | undefined;
  ruleFigmaLibrary: string | undefined;
  ruleSemanticType: string | undefined;
  nodeContext: ComponentMappingNodeContext;
  nodeNameRegex?: RegExp;
}): boolean => {
  if (nodeNameRegex && !nodeNameRegex.test(nodeContext.nodeName)) {
    return false;
  }
  if (
    ruleCanonicalComponentName !== undefined &&
    ruleCanonicalComponentName !== normalizeComparableToken(nodeContext.canonicalComponentName)
  ) {
    return false;
  }
  if (
    ruleStorybookTier !== undefined &&
    ruleStorybookTier !== normalizeComparableToken(nodeContext.storybookTier)
  ) {
    return false;
  }
  if (
    ruleFigmaLibrary !== undefined &&
    ruleFigmaLibrary !== normalizeComparableToken(nodeContext.figmaLibrary)
  ) {
    return false;
  }
  if (
    ruleSemanticType !== undefined &&
    ruleSemanticType !== normalizeComparableToken(nodeContext.semanticType)
  ) {
    return false;
  }
  return true;
};

const toMaterializedExactRule = ({
  rule,
  nodeId
}: {
  rule: NormalizedComponentMappingRule;
  nodeId: string;
}): ComponentMappingRule => {
  return {
    ...(rule.id !== undefined ? { id: rule.id } : {}),
    boardKey: rule.boardKey,
    nodeId,
    componentName: rule.componentName,
    importPath: rule.importPath,
    ...(rule.propContract !== undefined ? { propContract: rule.propContract } : {}),
    priority: rule.priority,
    source: rule.source,
    enabled: rule.enabled,
    ...(rule.createdAt ? { createdAt: rule.createdAt } : {}),
    ...(rule.updatedAt ? { updatedAt: rule.updatedAt } : {})
  };
};

export const resolveComponentMappingRules = ({
  componentMappings,
  ir,
  figmaAnalysis,
  componentMatchReportArtifact,
  figmaLibraryResolutionArtifact
}: {
  componentMappings: readonly WorkspaceComponentMappingRule[];
  ir: DesignIR;
  figmaAnalysis?: FigmaAnalysis;
  componentMatchReportArtifact?: ComponentMatchReportArtifact;
  figmaLibraryResolutionArtifact?: FigmaLibraryResolutionArtifact;
}): ResolveComponentMappingRulesResult => {
  const mappingWarnings: ComponentMappingWarning[] = [];
  const resolvedMappingsByNodeId = new Map<string, ComponentMappingRule>();
  const validations = componentMappings
    .map((rule) => validateComponentMappingRule({ rule }))
    .sort((left, right) => compareComponentMappings(left.normalizedRule, right.normalizedRule));

  const nodeContexts =
    figmaAnalysis && componentMatchReportArtifact
      ? buildComponentMappingNodeContexts({
          ir,
          figmaAnalysis,
          componentMatchReportArtifact,
          ...(figmaLibraryResolutionArtifact ? { figmaLibraryResolutionArtifact } : {})
        })
      : [];

  for (const validation of validations) {
    const ruleDescription = describeComponentMappingRule({ rule: validation.normalizedRule });
    if (!validation.ok) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping rule ${ruleDescription} is invalid: ${validation.message}`
      });
      continue;
    }

    if (validation.kind === "exact") {
      if (!validation.normalizedRule.enabled) {
        mappingWarnings.push({
          code: "W_COMPONENT_MAPPING_DISABLED",
          message: `Exact component mapping rule ${ruleDescription} is disabled; deterministic fallback used`
        });
        continue;
      }
      const nodeId = validation.normalizedRule.nodeId;
      if (!nodeId || resolvedMappingsByNodeId.has(nodeId)) {
        continue;
      }
      resolvedMappingsByNodeId.set(
        nodeId,
        toMaterializedExactRule({
          rule: validation.normalizedRule,
          nodeId
        })
      );
      continue;
    }

    if (!figmaAnalysis || !componentMatchReportArtifact) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message:
          `Pattern component mapping rule ${ruleDescription} requires figma.analysis and component.match_report; ` +
          "deterministic fallback used"
      });
      continue;
    }

    const ruleCanonicalComponentName = normalizeComparableToken(validation.normalizedRule.canonicalComponentName);
    const ruleStorybookTier = normalizeComparableToken(validation.normalizedRule.storybookTier);
    const ruleFigmaLibrary = normalizeComparableToken(validation.normalizedRule.figmaLibrary);
    const ruleSemanticType = normalizeComparableToken(validation.normalizedRule.semanticType);
    const matchedNodeContexts = nodeContexts.filter((nodeContext) =>
      matchesPatternRule({
        ruleCanonicalComponentName,
        ruleStorybookTier,
        ruleFigmaLibrary,
        ruleSemanticType,
        nodeContext,
        ...(validation.nodeNameRegex ? { nodeNameRegex: validation.nodeNameRegex } : {})
      })
    );

    if (matchedNodeContexts.length === 0) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Pattern component mapping rule ${ruleDescription} matched no Figma component nodes; deterministic fallback used`
      });
      continue;
    }

    if (!validation.normalizedRule.enabled) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_DISABLED",
        message:
          `Pattern component mapping rule ${ruleDescription} matched ${matchedNodeContexts.length} node(s) ` +
          "but is disabled; deterministic fallback used"
      });
      continue;
    }

    const matchedFamilyKeys = new Set(matchedNodeContexts.map((entry) => entry.familyKey));
    if (matchedFamilyKeys.size > 1) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_BROAD_PATTERN",
        message:
          `Pattern component mapping rule ${ruleDescription} matched ${matchedFamilyKeys.size} component families; ` +
          "narrow the selectors before applying the override"
      });
      continue;
    }

    for (const nodeContext of matchedNodeContexts.sort((left, right) => left.nodeId.localeCompare(right.nodeId))) {
      if (resolvedMappingsByNodeId.has(nodeContext.nodeId)) {
        continue;
      }
      resolvedMappingsByNodeId.set(
        nodeContext.nodeId,
        toMaterializedExactRule({
          rule: validation.normalizedRule,
          nodeId: nodeContext.nodeId
        })
      );
    }
  }

  return {
    componentMappings: [...resolvedMappingsByNodeId.values()].sort(compareComponentMappings),
    mappingWarnings
  };
};
