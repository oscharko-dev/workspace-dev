// ---------------------------------------------------------------------------
// generator-patterns.ts — Pattern extraction and component deduplication
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  GeneratedFile,
  ScreenElementIR,
  ScreenIR,
  ScreenResponsiveLayoutOverridesByBreakpoint
} from "./types.js";
import { ensureTsxName } from "./path-utils.js";
import {
  PATTERN_SIMILARITY_THRESHOLD,
  PATTERN_MIN_OCCURRENCES,
  PATTERN_MIN_SUBTREE_NODE_COUNT
} from "./constants.js";
import {
  literal,
  indentBlock,
  renderElement,
  toRenderableAssetSource
} from "./generator-templates.js";
import {
  sortChildren,
  resolveTypographyVariantByNodeId,
  normalizeIconImports,
  toDeterministicImagePlaceholderSrc
} from "./generator-render.js";
import {
  inferHeadingComponentByNodeId,
  resolveElementA11yLabel
} from "./generator-a11y.js";
import type {
  VirtualParent,
  RenderContext,
  IconFallbackResolver,
  ExtractedComponentImportSpec
} from "./generator-render.js";
import type { ThemeComponentDefaults } from "./generator-design-system.js";
import {
  extractSharedSxConstantsFromScreenContent,
  SX_ATTRIBUTE_PREFIX,
  findSxBodyEndIndex,
  countTopLevelSxProperties
} from "./generator-sx.js";

export interface PatternExtractionInvocation {
  componentName: string;
  instanceId: string;
  usesPatternContext: boolean;
  propValues: Record<string, string | undefined>;
}

interface PatternInvocationStateEntry {
  instanceId: string;
  values: Record<string, string | undefined>;
}

interface PatternContextClusterStateSpec {
  componentName: string;
  stateTypeName: string;
  propBindings: DynamicPropBinding[];
  entries: PatternInvocationStateEntry[];
}

export interface PatternContextFileSpec {
  file: GeneratedFile;
  providerName: string;
  hookName: string;
  stateTypeName: string;
  importPath: string;
  initialStateLiteral: string;
  contextEnabledComponentNames: Set<string>;
}

export interface FormContextFileSpec {
  file: GeneratedFile;
  providerName: string;
  hookName: string;
  importPath: string;
}

interface ScreenPatternStatePlan {
  contextFileSpec?: PatternContextFileSpec;
}

type DynamicPropBindingKind = "text" | "image_src" | "image_alt";

interface DynamicPropBinding {
  kind: DynamicPropBindingKind;
  path: string;
  propName: string;
  optional: boolean;
  placeholder: string;
  valuesByRootNodeId: Map<string, string | undefined>;
}

interface ExtractionCandidate {
  root: ScreenElementIR;
  parent: VirtualParent;
  depth: number;
  signature: Set<string>;
  pathNodeMap: Map<string, ScreenElementIR>;
  subtreeNodeIds: Set<string>;
  subtreeNodeCount: number;
}

interface PatternCluster {
  componentName: string;
  prototype: ExtractionCandidate;
  members: ExtractionCandidate[];
  propBindings: DynamicPropBinding[];
}

export interface PatternExtractionPlan {
  componentFiles: GeneratedFile[];
  contextFiles: GeneratedFile[];
  componentImports: ExtractedComponentImportSpec[];
  invocationByRootNodeId: Map<string, PatternExtractionInvocation>;
  patternStatePlan: ScreenPatternStatePlan;
}

// Pattern extraction constants imported from ./constants.js
const EXTRACTION_CANDIDATE_TYPES = new Set<ScreenElementIR["type"]>([
  "container",
  "card",
  "paper",
  "stack",
  "grid",
  "list",
  "table"
]);
const EXTRACTION_FORBIDDEN_TYPES = new Set<ScreenElementIR["type"]>([
  "input",
  "button",
  "chip",
  "switch",
  "checkbox",
  "radio",
  "select",
  "slider",
  "rating",
  "tab",
  "dialog",
  "stepper",
  "navigation",
  "appbar",
  "breadcrumbs",
  "drawer"
]);

const emptyPatternExtractionPlan = (): PatternExtractionPlan => ({
  componentFiles: [],
  contextFiles: [],
  componentImports: [],
  invocationByRootNodeId: new Map<string, PatternExtractionInvocation>(),
  patternStatePlan: {}
});

const toSortedChildrenForExtraction = ({
  children,
  layoutMode,
  generationLocale
}: {
  children: ScreenElementIR[];
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  generationLocale: string;
}): ScreenElementIR[] => {
  return sortChildren(children, layoutMode, { generationLocale });
};

const collectPathNodeMapForExtraction = ({
  root,
  generationLocale
}: {
  root: ScreenElementIR;
  generationLocale: string;
}): Map<string, ScreenElementIR> => {
  const byPath = new Map<string, ScreenElementIR>();
  const visit = (node: ScreenElementIR, pathToken: string): void => {
    byPath.set(pathToken, node);
    const children = toSortedChildrenForExtraction({
      children: node.children ?? [],
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    children.forEach((child, index) => {
      const nextPath = pathToken.length > 0 ? `${pathToken}.${index}` : String(index);
      visit(child, nextPath);
    });
  };
  visit(root, "");
  return byPath;
};

const collectSubtreeNodeIdsForExtraction = (
  root: ScreenElementIR,
  visited: Set<ScreenElementIR> = new Set()
): Set<string> => {
  if (visited.has(root)) {
    return new Set<string>();
  }
  visited.add(root);
  const nodeIds = new Set<string>([root.id]);
  for (const child of root.children ?? []) {
    const nested = collectSubtreeNodeIdsForExtraction(child, visited);
    for (const nodeId of nested) {
      nodeIds.add(nodeId);
    }
  }
  return nodeIds;
};

const hasForbiddenExtractionSignals = (
  node: ScreenElementIR,
  visited: Set<ScreenElementIR> = new Set()
): boolean => {
  if (visited.has(node)) {
    return false;
  }
  visited.add(node);
  if (EXTRACTION_FORBIDDEN_TYPES.has(node.type) || Boolean(node.prototypeNavigation) || Boolean(node.variantMapping)) {
    return true;
  }
  return (node.children ?? []).some((child) => hasForbiddenExtractionSignals(child, visited));
};

const hasTextOrImageDescendants = (node: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): boolean => {
  if (visited.has(node)) {
    return false;
  }
  visited.add(node);
  if (node.type === "text" || node.type === "image") {
    return true;
  }
  return (node.children ?? []).some((child) => hasTextOrImageDescendants(child, visited));
};

const computeStructuralSignature = ({
  root,
  generationLocale
}: {
  root: ScreenElementIR;
  generationLocale: string;
}): Set<string> => {
  const signature = new Set<string>();
  const visit = (node: ScreenElementIR, depth: number): void => {
    const children = toSortedChildrenForExtraction({
      children: node.children ?? [],
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    const bucketedChildrenCount = Math.min(6, children.length);
    signature.add(`n:${depth}:${node.type}:${node.nodeType}:${bucketedChildrenCount}`);
    if (node.layoutMode) {
      signature.add(`layout:${depth}:${node.layoutMode}`);
    }
    if (node.type === "text") {
      signature.add(`text:${depth}`);
    }
    if (node.type === "image") {
      signature.add(`image:${depth}`);
    }
    children.forEach((child, index) => {
      const bucketedIndex = Math.min(index, 4);
      signature.add(`e:${depth}:${node.type}>${child.type}:${bucketedIndex}`);
      visit(child, depth + 1);
    });
  };
  visit(root, 0);
  return signature;
};

const computeSubtreeSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersectionCount = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersectionCount += 1;
    }
  }
  const unionCount = left.size + right.size - intersectionCount;
  if (unionCount <= 0) {
    return 0;
  }
  return intersectionCount / unionCount;
};

const hasIntersectionWithSet = ({
  values,
  targets
}: {
  values: Set<string>;
  targets: Set<string>;
}): boolean => {
  for (const value of values) {
    if (targets.has(value)) {
      return true;
    }
  }
  return false;
};

const toExtractionPropName = ({
  rawName,
  fallback
}: {
  rawName: string;
  fallback: string;
}): string => {
  const words = rawName
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (words.length === 0) {
    return fallback;
  }
  const camelCased = words
    .map((word, index) => {
      const lowered = word.toLowerCase();
      if (index === 0) {
        return lowered;
      }
      return `${lowered.charAt(0).toUpperCase()}${lowered.slice(1)}`;
    })
    .join("");
  if (!camelCased) {
    return fallback;
  }
  if (/^\d/.test(camelCased)) {
    return `${fallback}${camelCased}`;
  }
  return camelCased;
};

const toUniquePropName = ({
  candidate,
  used
}: {
  candidate: string;
  used: Set<string>;
}): string => {
  let nextName = candidate;
  let suffix = 2;
  while (used.has(nextName)) {
    nextName = `${candidate}${suffix}`;
    suffix += 1;
  }
  used.add(nextName);
  return nextName;
};

const toTextValueForExtraction = (node: ScreenElementIR | undefined): string | undefined => {
  if (!node || node.type !== "text") {
    return undefined;
  }
  const normalizedText = node.text.trim();
  if (normalizedText && normalizedText.length > 0) {
    return normalizedText;
  }
  const normalizedName = node.name.trim();
  return normalizedName.length > 0 ? normalizedName : undefined;
};

const toImageSourceForExtraction = ({
  node,
  imageAssetMap
}: {
  node: ScreenElementIR | undefined;
  imageAssetMap: Record<string, string>;
}): string | undefined => {
  if (!node || node.type !== "image") {
    return undefined;
  }
  const mappedSource = imageAssetMap[node.id];
  if (typeof mappedSource === "string" && mappedSource.trim().length > 0) {
    return toRenderableAssetSource(mappedSource);
  }
  const fallbackLabel = resolveElementA11yLabel({ element: node, fallback: "Image" });
  return toDeterministicImagePlaceholderSrc({
    element: node,
    label: fallbackLabel
  });
};

const inferDynamicPropsFromCluster = ({
  members,
  imageAssetMap
}: {
  members: ExtractionCandidate[];
  imageAssetMap: Record<string, string>;
}): DynamicPropBinding[] => {
  const prototype = members[0];
  if (!prototype) {
    return [];
  }
  const usedPropNames = new Set<string>(["sx"]);
  const bindings: DynamicPropBinding[] = [];
  const sortedPrototypePaths = Array.from(prototype.pathNodeMap.keys()).sort((left, right) => left.localeCompare(right));

  for (const pathToken of sortedPrototypePaths) {
    const prototypeNode = prototype.pathNodeMap.get(pathToken);
    if (!prototypeNode) {
      continue;
    }

    if (prototypeNode.type === "text") {
      const valuesByRootNodeId = new Map<string, string | undefined>();
      const distinctValues = new Set<string>();
      let optional = false;
      for (const member of members) {
        const memberNode = member.pathNodeMap.get(pathToken);
        const value = toTextValueForExtraction(memberNode);
        if (value === undefined) {
          optional = true;
        } else {
          distinctValues.add(value);
        }
        valuesByRootNodeId.set(member.root.id, value);
      }
      if (distinctValues.size <= 1 && !optional) {
        continue;
      }
      const propName = toUniquePropName({
        candidate: toExtractionPropName({
          rawName: `${prototypeNode.name} text`,
          fallback: "textValue"
        }),
        used: usedPropNames
      });
      bindings.push({
        kind: "text",
        path: pathToken,
        propName,
        optional,
        placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
        valuesByRootNodeId
      });
      continue;
    }

    if (prototypeNode.type === "image") {
      const sourceValuesByRootNodeId = new Map<string, string | undefined>();
      const sourceDistinctValues = new Set<string>();
      let sourceOptional = false;
      const altValuesByRootNodeId = new Map<string, string | undefined>();
      const altDistinctValues = new Set<string>();
      let altOptional = false;

      for (const member of members) {
        const memberNode = member.pathNodeMap.get(pathToken);
        const sourceValue = toImageSourceForExtraction({
          node: memberNode,
          imageAssetMap
        });
        if (sourceValue === undefined) {
          sourceOptional = true;
        } else {
          sourceDistinctValues.add(sourceValue);
        }
        sourceValuesByRootNodeId.set(member.root.id, sourceValue);

        const altValue = memberNode
          ? resolveElementA11yLabel({
              element: memberNode,
              fallback: "Image"
            })
          : undefined;
        if (altValue === undefined) {
          altOptional = true;
        } else {
          altDistinctValues.add(altValue);
        }
        altValuesByRootNodeId.set(member.root.id, altValue);
      }

      if (sourceDistinctValues.size > 1 || sourceOptional) {
        const propName = toUniquePropName({
          candidate: toExtractionPropName({
            rawName: `${prototypeNode.name} src`,
            fallback: "imageSrc"
          }),
          used: usedPropNames
        });
        bindings.push({
          kind: "image_src",
          path: pathToken,
          propName,
          optional: sourceOptional,
          placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
          valuesByRootNodeId: sourceValuesByRootNodeId
        });
      }

      if (altDistinctValues.size > 1 || altOptional) {
        const propName = toUniquePropName({
          candidate: toExtractionPropName({
            rawName: `${prototypeNode.name} alt`,
            fallback: "imageAlt"
          }),
          used: usedPropNames
        });
        bindings.push({
          kind: "image_alt",
          path: pathToken,
          propName,
          optional: altOptional,
          placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
          valuesByRootNodeId: altValuesByRootNodeId
        });
      }
    }
  }

  return bindings;
};

const cloneElementForExtraction = (element: ScreenElementIR): ScreenElementIR => {
  return {
    ...element,
    ...(element.children ? { children: element.children.map((child) => cloneElementForExtraction(child)) } : {})
  };
};

interface ExtractedComponentRootSxAnalysis {
  rootTagName: string;
  rootSxBody: string;
  rootSxPropertyCount: number | undefined;
  withMergedSx: string;
  withSxPropOnly: string;
}

const findRootOpeningTagEndIndex = (renderedRoot: string): number | undefined => {
  const rootTagStartIndex = renderedRoot.indexOf("<");
  if (rootTagStartIndex < 0) {
    return undefined;
  }

  let braceDepth = 0;
  let activeQuote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let index = rootTagStartIndex + 1; index < renderedRoot.length; index += 1) {
    const char = renderedRoot[index];
    if (!char) {
      continue;
    }

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      activeQuote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === ">" && braceDepth === 0) {
      return index;
    }
  }

  return undefined;
};

const extractRootSxAnalysisForExtractedComponent = (renderedRoot: string): ExtractedComponentRootSxAnalysis | undefined => {
  const rootTagStartIndex = renderedRoot.indexOf("<");
  if (rootTagStartIndex < 0) {
    return undefined;
  }
  const rootTagMatch = renderedRoot.slice(rootTagStartIndex).match(/^<([A-Za-z][A-Za-z0-9_]*)\b/);
  const rootTagName = rootTagMatch?.[1];
  if (!rootTagName) {
    return undefined;
  }

  const rootOpeningTagEndIndex = findRootOpeningTagEndIndex(renderedRoot);
  if (rootOpeningTagEndIndex === undefined) {
    return undefined;
  }

  const sxStartIndex = renderedRoot.indexOf(SX_ATTRIBUTE_PREFIX);
  if (sxStartIndex < 0) {
    return undefined;
  }
  if (sxStartIndex > rootOpeningTagEndIndex) {
    return undefined;
  }
  const bodyStartIndex = sxStartIndex + SX_ATTRIBUTE_PREFIX.length;
  const bodyEndIndex = findSxBodyEndIndex({
    source: renderedRoot,
    startIndex: bodyStartIndex
  });
  if (bodyEndIndex === undefined) {
    return undefined;
  }
  if (renderedRoot[bodyEndIndex + 1] !== "}") {
    return undefined;
  }
  if (bodyEndIndex > rootOpeningTagEndIndex) {
    return undefined;
  }
  const rootSxBody = renderedRoot.slice(bodyStartIndex, bodyEndIndex).trim();

  return {
    rootTagName,
    rootSxBody,
    rootSxPropertyCount: countTopLevelSxProperties(rootSxBody),
    withMergedSx: `${renderedRoot.slice(0, sxStartIndex)}sx={[{ ${rootSxBody} }, sx]}${renderedRoot.slice(bodyEndIndex + 2)}`,
    withSxPropOnly: `${renderedRoot.slice(0, sxStartIndex)}sx={sx}${renderedRoot.slice(bodyEndIndex + 2)}`
  };
};

const replaceRootTagNameInRenderedComponent = ({
  renderedRoot,
  currentRootTagName,
  nextRootTagName
}: {
  renderedRoot: string;
  currentRootTagName: string;
  nextRootTagName: string;
}): string | undefined => {
  const openingTagToken = `<${currentRootTagName}`;
  const openingTagIndex = renderedRoot.indexOf(openingTagToken);
  if (openingTagIndex < 0) {
    return undefined;
  }
  const openingTagNameStartIndex = openingTagIndex + 1;
  const withOpeningTagReplaced = `${renderedRoot.slice(0, openingTagNameStartIndex)}${nextRootTagName}${renderedRoot.slice(
    openingTagNameStartIndex + currentRootTagName.length
  )}`;

  const closingTagToken = `</${currentRootTagName}>`;
  const closingTagIndex = withOpeningTagReplaced.lastIndexOf(closingTagToken);
  if (closingTagIndex < 0) {
    return undefined;
  }
  const closingTagNameStartIndex = closingTagIndex + 2;
  return `${withOpeningTagReplaced.slice(0, closingTagNameStartIndex)}${nextRootTagName}${withOpeningTagReplaced.slice(
    closingTagNameStartIndex + currentRootTagName.length
  )}`;
};

export const toPatternContextProviderName = (screenComponentName: string): string => {
  return `${screenComponentName}PatternContextProvider`;
};

export const toPatternContextHookName = (screenComponentName: string): string => {
  return `use${screenComponentName}PatternContext`;
};

const toPatternContextStateTypeName = (screenComponentName: string): string => {
  return `${screenComponentName}PatternContextState`;
};

const toPatternClusterStateTypeName = (componentName: string): string => {
  return `${componentName}State`;
};

export const toFormContextProviderName = (screenComponentName: string): string => {
  return `${screenComponentName}FormContextProvider`;
};

export const toFormContextHookName = (screenComponentName: string): string => {
  return `use${screenComponentName}FormContext`;
};

const buildScreenPatternStatePlan = ({
  screenComponentName,
  clusters
}: {
  screenComponentName: string;
  clusters: PatternCluster[];
}): ScreenPatternStatePlan => {
  const contextEnabledClusters = clusters
    .filter((cluster) => cluster.propBindings.length > 0)
    .sort((left, right) => left.componentName.localeCompare(right.componentName));
  if (contextEnabledClusters.length === 0) {
    return {};
  }

  const clusterSpecs: PatternContextClusterStateSpec[] = contextEnabledClusters.map((cluster) => {
    const sortedBindings = [...cluster.propBindings].sort((left, right) => left.propName.localeCompare(right.propName));
    const sortedMembers = [...cluster.members].sort((left, right) => left.root.id.localeCompare(right.root.id));
    const entries = sortedMembers.map((member) => {
      const values = Object.fromEntries(
        sortedBindings.map((binding) => [binding.propName, binding.valuesByRootNodeId.get(member.root.id)])
      ) as Record<string, string | undefined>;
      return {
        instanceId: member.root.id,
        values
      };
    });
    return {
      componentName: cluster.componentName,
      stateTypeName: toPatternClusterStateTypeName(cluster.componentName),
      propBindings: sortedBindings,
      entries
    };
  });

  const providerName = toPatternContextProviderName(screenComponentName);
  const hookName = toPatternContextHookName(screenComponentName);
  const stateTypeName = toPatternContextStateTypeName(screenComponentName);
  const contextVarName = `${screenComponentName}PatternContext`;
  const contextStateLiteral = JSON.stringify(
    Object.fromEntries(
      clusterSpecs.map((clusterSpec) => [
        clusterSpec.componentName,
        Object.fromEntries(clusterSpec.entries.map((entry) => [entry.instanceId, entry.values]))
      ])
    ),
    null,
    2
  );
  const emptyStateLiteral = JSON.stringify(
    Object.fromEntries(clusterSpecs.map((clusterSpec) => [clusterSpec.componentName, {}])),
    null,
    2
  );
  const clusterInterfaces = clusterSpecs
    .map((clusterSpec) => {
      const entries = clusterSpec.propBindings
        .map((binding) => `  ${binding.propName}${binding.optional ? "?" : ""}: string;`)
        .join("\n");
      return `export interface ${clusterSpec.stateTypeName} {\n${entries}\n}`;
    })
    .join("\n\n");
  const contextInterfaceEntries = clusterSpecs
    .map((clusterSpec) => `  ${clusterSpec.componentName}: Record<string, ${clusterSpec.stateTypeName}>;`)
    .join("\n");
  const providerPropsName = `${providerName}Props`;
  const contextSource = `/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

${clusterInterfaces}

export interface ${stateTypeName} {
${contextInterfaceEntries}
}

const emptyPatternState: ${stateTypeName} = ${emptyStateLiteral};

const ${contextVarName} = createContext<${stateTypeName}>(emptyPatternState);

interface ${providerPropsName} {
  initialState: ${stateTypeName};
  children: ReactNode;
}

export function ${providerName}({ initialState, children }: ${providerPropsName}) {
  return <${contextVarName}.Provider value={initialState}>{children}</${contextVarName}.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${stateTypeName} => {
  return useContext(${contextVarName});
};
`;

  return {
    contextFileSpec: {
      file: {
        path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}PatternContext`)),
        content: contextSource
      },
      providerName,
      hookName,
      stateTypeName,
      importPath: `../context/${screenComponentName}PatternContext`,
      initialStateLiteral: contextStateLiteral,
      contextEnabledComponentNames: new Set(clusterSpecs.map((clusterSpec) => clusterSpec.componentName))
    }
  };
};

const buildExtractedComponentFile = ({
  cluster,
  patternStatePlan,
  screen,
  generationLocale,
  spacingBase,
  tokens,
  iconResolver,
  imageAssetMap,
  routePathByScreenId,
  mappingByNodeId,
  pageBackgroundColorNormalized,
  disallowedStyledRootMuiComponents,
  themeComponentDefaults,
  responsiveTopLevelLayoutOverrides
}: {
  cluster: PatternCluster;
  patternStatePlan: ScreenPatternStatePlan;
  screen: ScreenIR;
  generationLocale: string;
  spacingBase: number;
  tokens: DesignTokens | undefined;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  disallowedStyledRootMuiComponents: ReadonlySet<string>;
  themeComponentDefaults?: ThemeComponentDefaults;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}): GeneratedFile | undefined => {
  const prototypeRoot = cloneElementForExtraction(cluster.prototype.root);
  const placeholderImageAssetMap: Record<string, string> = {
    ...imageAssetMap
  };
  const pathNodeMap = collectPathNodeMapForExtraction({
    root: prototypeRoot,
    generationLocale
  });

  for (const binding of cluster.propBindings) {
    const node = pathNodeMap.get(binding.path);
    if (!node) {
      continue;
    }
    if (binding.kind === "text" && node.type === "text") {
      node.text = binding.placeholder;
      continue;
    }
    if (binding.kind === "image_src" && node.type === "image") {
      placeholderImageAssetMap[node.id] = binding.placeholder;
      continue;
    }
    if (binding.kind === "image_alt" && node.type === "image") {
      node.name = binding.placeholder;
    }
  }

  const headingComponentByNodeId = inferHeadingComponentByNodeId([prototypeRoot]);
  const typographyVariantByNodeId = resolveTypographyVariantByNodeId({
    elements: [prototypeRoot],
    tokens
  });
  const componentRenderContext: RenderContext = {
    screenId: screen.id,
    screenName: `${screen.name}:${cluster.componentName}`,
    currentFilePath: path.posix.join("src", "components", ensureTsxName(cluster.componentName)),
    generationLocale,
    formHandlingMode: "legacy_use_state",
    fields: [],
    accordions: [],
    tabs: [],
    dialogs: [],
    buttons: [],
    activeRenderElements: new Set<ScreenElementIR>(),
    renderNodeVisitCount: 0,
    interactiveDescendantCache: new Map<string, boolean>(),
    meaningfulTextDescendantCache: new Map<string, boolean>(),
    headingComponentByNodeId,
    typographyVariantByNodeId,
    accessibilityWarnings: [],
    muiImports: new Set<string>(),
    iconImports: [],
    iconResolver,
    imageAssetMap: placeholderImageAssetMap,
    routePathByScreenId,
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    specializedComponentMappings: {},
    usesDatePickerProvider: false,
    spacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized,
    requiresChangeEventTypeImport: false,
    ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
    ...(responsiveTopLevelLayoutOverrides ? { responsiveTopLevelLayoutOverrides } : {}),
    extractionInvocationByNodeId: new Map<string, PatternExtractionInvocation>()
  };

  const renderedRoot = renderElement(prototypeRoot, 2, cluster.prototype.parent, componentRenderContext);
  if (!renderedRoot || !renderedRoot.trim()) {
    return undefined;
  }
  if (
    componentRenderContext.fields.length > 0 ||
    componentRenderContext.accordions.length > 0 ||
    componentRenderContext.tabs.length > 0 ||
    componentRenderContext.dialogs.length > 0 ||
    componentRenderContext.usesNavigateHandler
  ) {
    return undefined;
  }

  let renderedComponentBody = renderedRoot;
  for (const binding of cluster.propBindings) {
    const placeholderLiteral = literal(binding.placeholder);
    if (binding.kind === "text") {
      renderedComponentBody = renderedComponentBody.split(`{${placeholderLiteral}}`).join(`{${binding.propName}}`);
      continue;
    }
    if (binding.kind === "image_src") {
      renderedComponentBody = renderedComponentBody
        .split(`src={${placeholderLiteral}}`)
        .join(`src={${binding.propName}}`);
      continue;
    }
    renderedComponentBody = renderedComponentBody
      .split(`alt={${placeholderLiteral}}`)
      .join(`alt={${binding.propName}}`);
  }

  const rootSxAnalysis = extractRootSxAnalysisForExtractedComponent(renderedComponentBody);
  if (!rootSxAnalysis) {
    return undefined;
  }

  const contextFileSpec = patternStatePlan.contextFileSpec;
  const patternContextSpec =
    contextFileSpec &&
    contextFileSpec.contextEnabledComponentNames.has(cluster.componentName) &&
    cluster.propBindings.length > 0
      ? contextFileSpec
      : undefined;
  const usesPatternContext = patternContextSpec !== undefined;
  const sortedMuiImports = [...componentRenderContext.muiImports].sort((left, right) => left.localeCompare(right));
  if (sortedMuiImports.length === 0) {
    return undefined;
  }
  const shouldUseStyledRootComponent =
    cluster.members.length >= PATTERN_MIN_OCCURRENCES &&
    sortedMuiImports.includes(rootSxAnalysis.rootTagName) &&
    !disallowedStyledRootMuiComponents.has(rootSxAnalysis.rootTagName) &&
    (rootSxAnalysis.rootSxPropertyCount ?? 0) >= 4;
  let renderedWithSx = rootSxAnalysis.withMergedSx;
  let styledRootDeclaration = "";
  if (shouldUseStyledRootComponent) {
    const styledRootComponentName = `${cluster.componentName}Root`;
    const styledTagReplaced = replaceRootTagNameInRenderedComponent({
      renderedRoot: rootSxAnalysis.withSxPropOnly,
      currentRootTagName: rootSxAnalysis.rootTagName,
      nextRootTagName: styledRootComponentName
    });
    if (styledTagReplaced) {
      renderedWithSx = styledTagReplaced;
      styledRootDeclaration =
        `const ${styledRootComponentName} = styled(${rootSxAnalysis.rootTagName})` +
        `(({ theme }) => theme.unstable_sx({ ${rootSxAnalysis.rootSxBody} }));\n\n`;
    }
  }
  const iconImports = normalizeIconImports(componentRenderContext.iconImports)
    .map((iconImport) => `import ${iconImport.localName} from "${iconImport.modulePath}";`)
    .join("\n");
  const mappedImports = componentRenderContext.mappedImports
    .map((mappedImport) => `import ${mappedImport.localName} from "${mappedImport.modulePath}";`)
    .join("\n");
  const routerImports: string[] = componentRenderContext.usesRouterLink ? ["Link as RouterLink"] : [];
  const reactRouterImport = routerImports.length > 0 ? `import { ${routerImports.join(", ")} } from "react-router-dom";\n` : "";
  const patternContextImport = patternContextSpec
    ? `import { ${patternContextSpec.hookName} } from "${patternContextSpec.importPath}";\n`
    : "";
  const navigationHookBlock = "";
  const sortedBindings = [...cluster.propBindings].sort((left, right) => left.propName.localeCompare(right.propName));
  const propsInterfaceEntries = usesPatternContext
    ? ["  instanceId: string;", "  sx?: SxProps<Theme>;"].join("\n")
    : ["  sx?: SxProps<Theme>;", ...sortedBindings.map((binding) => `  ${binding.propName}${binding.optional ? "?" : ""}: string;`)].join(
        "\n"
      );
  const parameterEntries = usesPatternContext ? ["instanceId", "sx"] : ["sx", ...sortedBindings.map((binding) => binding.propName)];
  const patternContextBindingBlock = patternContextSpec
    ? [
        `const patternContext = ${patternContextSpec.hookName}();`,
        `const patternState = patternContext.${cluster.componentName}[instanceId];`,
        ...sortedBindings.map((binding) => {
          const fallbackSuffix = binding.kind === "image_src" ? "" : ' ?? ""';
          return `const ${binding.propName} = patternState?.${binding.propName}${fallbackSuffix};`;
        })
      ].join("\n")
    : "";
  const componentSetupBlock = [patternContextBindingBlock, navigationHookBlock]
    .filter((block) => block.length > 0)
    .join("\n\n");
  const wrappedRenderedWithSx = `    <>\n${indentBlock(renderedWithSx.trim(), 6)}\n    </>`;
  const stylesImportLine = styledRootDeclaration
    ? 'import { styled, type SxProps, type Theme } from "@mui/material/styles";'
    : 'import type { SxProps, Theme } from "@mui/material/styles";';
  const componentSource = `${reactRouterImport}${patternContextImport}${stylesImportLine}
import { ${sortedMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}

${styledRootDeclaration}
interface ${cluster.componentName}Props {
${propsInterfaceEntries}
}

export function ${cluster.componentName}({ ${parameterEntries.join(", ")} }: ${cluster.componentName}Props) {
${componentSetupBlock ? `${indentBlock(componentSetupBlock, 2)}\n` : ""}  return (
${wrappedRenderedWithSx}
  );
}
`;
  return {
    path: path.posix.join("src", "components", ensureTsxName(cluster.componentName)),
    content: extractSharedSxConstantsFromScreenContent(componentSource)
  };
};

const buildInvocationMap = ({
  patternStatePlan,
  clusters
}: {
  patternStatePlan: ScreenPatternStatePlan;
  clusters: PatternCluster[];
}): Map<string, PatternExtractionInvocation> => {
  const byRootNodeId = new Map<string, PatternExtractionInvocation>();
  const contextEnabledComponentNames = patternStatePlan.contextFileSpec?.contextEnabledComponentNames ?? new Set<string>();
  for (const cluster of clusters) {
    const usesPatternContext = contextEnabledComponentNames.has(cluster.componentName);
    for (const member of cluster.members) {
      const propValues = Object.fromEntries(
        cluster.propBindings.map((binding) => [binding.propName, binding.valuesByRootNodeId.get(member.root.id)])
      ) as Record<string, string | undefined>;
      byRootNodeId.set(member.root.id, {
        componentName: cluster.componentName,
        instanceId: member.root.id,
        usesPatternContext,
        propValues
      });
    }
  }
  return byRootNodeId;
};

const collectExtractionCandidates = ({
  roots,
  rootParent,
  generationLocale
}: {
  roots: ScreenElementIR[];
  rootParent: VirtualParent;
  generationLocale: string;
}): ExtractionCandidate[] => {
  const candidates: ExtractionCandidate[] = [];
  const sortedRoots = toSortedChildrenForExtraction({
    children: roots,
    layoutMode: rootParent.layoutMode ?? "NONE",
    generationLocale
  });

  const visit = ({
    node,
    parent,
    depth
  }: {
    node: ScreenElementIR;
    parent: VirtualParent;
    depth: number;
  }): void => {
    const subtreeNodeIds = collectSubtreeNodeIdsForExtraction(node);
    const subtreeNodeCount = subtreeNodeIds.size;
    const children = node.children ?? [];
    if (
      EXTRACTION_CANDIDATE_TYPES.has(node.type) &&
      children.length >= 1 &&
      subtreeNodeCount >= PATTERN_MIN_SUBTREE_NODE_COUNT &&
      hasTextOrImageDescendants(node) &&
      !hasForbiddenExtractionSignals(node)
    ) {
      candidates.push({
        root: node,
        parent,
        depth,
        signature: computeStructuralSignature({
          root: node,
          generationLocale
        }),
        pathNodeMap: collectPathNodeMapForExtraction({
          root: node,
          generationLocale
        }),
        subtreeNodeIds,
        subtreeNodeCount
      });
    }

    const nextParent: VirtualParent = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      name: node.name,
      fillColor: node.fillColor,
      fillGradient: node.fillGradient,
      layoutMode: node.layoutMode ?? "NONE"
    };
    const sortedChildren = toSortedChildrenForExtraction({
      children,
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    sortedChildren.forEach((child) => {
      visit({
        node: child,
        parent: nextParent,
        depth: depth + 1
      });
    });
  };

  sortedRoots.forEach((root) => {
    visit({
      node: root,
      parent: rootParent,
      depth: 3
    });
  });

  return candidates;
};

const buildPatternClusters = ({
  candidates,
  screenComponentName,
  imageAssetMap
}: {
  candidates: ExtractionCandidate[];
  screenComponentName: string;
  imageAssetMap: Record<string, string>;
}): PatternCluster[] => {
  const sortedCandidates = [...candidates].sort((left, right) => {
    if (left.subtreeNodeCount !== right.subtreeNodeCount) {
      return right.subtreeNodeCount - left.subtreeNodeCount;
    }
    return left.root.id.localeCompare(right.root.id);
  });
  const rawClusters: ExtractionCandidate[][] = [];
  for (const candidate of sortedCandidates) {
    const matchingCluster = rawClusters.find((cluster) => {
      const prototype = cluster[0];
      if (!prototype) {
        return false;
      }
      return computeSubtreeSimilarity(prototype.signature, candidate.signature) >= PATTERN_SIMILARITY_THRESHOLD;
    });
    if (matchingCluster) {
      matchingCluster.push(candidate);
      continue;
    }
    rawClusters.push([candidate]);
  }

  const reservedSubtreeNodeIds = new Set<string>();
  const reservedRootIds = new Set<string>();
  const selectedClusters: PatternCluster[] = [];
  const sortedRawClusters = rawClusters
    .filter((cluster) => cluster.length >= PATTERN_MIN_OCCURRENCES)
    .sort((left, right) => {
      const leftSize = left[0]?.subtreeNodeCount ?? 0;
      const rightSize = right[0]?.subtreeNodeCount ?? 0;
      if (leftSize !== rightSize) {
        return rightSize - leftSize;
      }
      return (left[0]?.root.id ?? "").localeCompare(right[0]?.root.id ?? "");
    });

  let clusterIndex = 1;
  for (const cluster of sortedRawClusters) {
    const localMembers: ExtractionCandidate[] = [];
    const localRootIds = new Set<string>();
    const localSubtreeIds = new Set<string>();
    const memberCandidates = [...cluster].sort((left, right) => {
      if (left.subtreeNodeCount !== right.subtreeNodeCount) {
        return right.subtreeNodeCount - left.subtreeNodeCount;
      }
      return left.root.id.localeCompare(right.root.id);
    });

    for (const member of memberCandidates) {
      const collidesWithGlobal =
        reservedSubtreeNodeIds.has(member.root.id) ||
        hasIntersectionWithSet({ values: member.subtreeNodeIds, targets: reservedRootIds });
      if (collidesWithGlobal) {
        continue;
      }
      const collidesWithLocal =
        localSubtreeIds.has(member.root.id) || hasIntersectionWithSet({ values: member.subtreeNodeIds, targets: localRootIds });
      if (collidesWithLocal) {
        continue;
      }
      localMembers.push(member);
      localRootIds.add(member.root.id);
      for (const nodeId of member.subtreeNodeIds) {
        localSubtreeIds.add(nodeId);
      }
    }

    if (localMembers.length < PATTERN_MIN_OCCURRENCES) {
      continue;
    }
    localMembers.sort((left, right) => left.root.id.localeCompare(right.root.id));
    const propBindings = inferDynamicPropsFromCluster({
      members: localMembers,
      imageAssetMap
    });
    const [prototype] = localMembers;
    if (!prototype) {
      continue;
    }
    const componentName = `${screenComponentName}Pattern${clusterIndex}`;
    selectedClusters.push({
      componentName,
      prototype,
      members: localMembers,
      propBindings
    });
    clusterIndex += 1;
    for (const nodeId of localSubtreeIds) {
      reservedSubtreeNodeIds.add(nodeId);
    }
    for (const nodeId of localRootIds) {
      reservedRootIds.add(nodeId);
    }
  }

  return selectedClusters;
};

export const buildPatternExtractionPlan = ({
  enablePatternExtraction,
  screen,
  screenComponentName,
  roots,
  rootParent,
  generationLocale,
  spacingBase,
  tokens,
  iconResolver,
  imageAssetMap,
  routePathByScreenId,
  mappingByNodeId,
  pageBackgroundColorNormalized,
  disallowedStyledRootMuiComponents = new Set<string>(),
  themeComponentDefaults,
  responsiveTopLevelLayoutOverrides
}: {
  enablePatternExtraction: boolean;
  screen: ScreenIR;
  screenComponentName: string;
  roots: ScreenElementIR[];
  rootParent: VirtualParent;
  generationLocale: string;
  spacingBase: number;
  tokens: DesignTokens | undefined;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  disallowedStyledRootMuiComponents?: ReadonlySet<string>;
  themeComponentDefaults?: ThemeComponentDefaults;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}): PatternExtractionPlan => {
  if (!enablePatternExtraction) {
    return emptyPatternExtractionPlan();
  }
  const candidates = collectExtractionCandidates({
    roots,
    rootParent,
    generationLocale
  });
  if (candidates.length < PATTERN_MIN_OCCURRENCES) {
    return emptyPatternExtractionPlan();
  }
  const clusters = buildPatternClusters({
    candidates,
    screenComponentName,
    imageAssetMap
  });
  if (clusters.length === 0) {
    return emptyPatternExtractionPlan();
  }

  const preliminaryPatternStatePlan = buildScreenPatternStatePlan({
    screenComponentName,
    clusters
  });
  const componentFiles: GeneratedFile[] = [];
  const componentImports: ExtractedComponentImportSpec[] = [];
  const usableClusters: PatternCluster[] = [];
  for (const cluster of clusters) {
    const file = buildExtractedComponentFile({
      cluster,
      patternStatePlan: preliminaryPatternStatePlan,
      screen,
      generationLocale,
      spacingBase,
      tokens,
      iconResolver,
      imageAssetMap,
      routePathByScreenId,
      mappingByNodeId,
      pageBackgroundColorNormalized,
      disallowedStyledRootMuiComponents,
      ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
      ...(responsiveTopLevelLayoutOverrides ? { responsiveTopLevelLayoutOverrides } : {})
    });
    if (!file) {
      continue;
    }
    usableClusters.push(cluster);
    componentFiles.push(file);
    componentImports.push({
      componentName: cluster.componentName,
      importPath: `../components/${cluster.componentName}`
    });
  }
  if (usableClusters.length === 0) {
    return emptyPatternExtractionPlan();
  }

  const patternStatePlan = buildScreenPatternStatePlan({
    screenComponentName,
    clusters: usableClusters
  });
  const invocationByRootNodeId = buildInvocationMap({
    patternStatePlan,
    clusters: usableClusters
  });
  const contextFiles = patternStatePlan.contextFileSpec ? [patternStatePlan.contextFileSpec.file] : [];
  return {
    componentFiles,
    contextFiles,
    componentImports: componentImports.sort((left, right) => left.componentName.localeCompare(right.componentName)),
    invocationByRootNodeId,
    patternStatePlan
  };
};
