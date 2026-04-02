import type { FigmaAnalysis, FigmaAnalysisFrameVariantGroup } from "./figma-analysis.js";
import type {
  AppShellIR,
  DesignIR,
  ScreenElementIR,
  ScreenIR,
  ScreenVariantFamilyAxis,
  ScreenVariantFamilyIR,
  ScreenVariantFamilyInitialStateIR,
  ScreenVariantFamilyScenarioIR
} from "./types-ir.js";

interface IndexedNodeRecord {
  element: ScreenElementIR;
  path: string;
}

const ACTIONABLE_AXES: readonly ScreenVariantFamilyAxis[] = [
  "pricing-mode",
  "expansion-state",
  "validation-state"
] as const;

const ACTIONABLE_AXIS_SET = new Set<string>(ACTIONABLE_AXES);
const ERROR_TOKEN_SET = new Set(["error", "errors", "fehler", "fehlermeldung", "fehlermeldungen"]);
const COLLAPSED_TOKEN_SET = new Set(["collapsed", "collapse", "eingeklappt"]);
const EXPANDED_TOKEN_SET = new Set(["expanded", "expand", "expandedstate"]);

const normalizeNodeName = (value: string | undefined): string => {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const normalizeValueToken = (value: string | undefined): string => {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
};

const createAccordionStateKey = (element: ScreenElementIR): string => {
  const sanitizedName = element.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  return `${sanitizedName}_${element.id.replace(/[^a-zA-Z0-9]+/g, "_")}`;
};

const collectScreenElements = (roots: readonly ScreenElementIR[]): ScreenElementIR[] => {
  const result: ScreenElementIR[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    result.push(current);
    if (Array.isArray(current.children) && current.children.length > 0) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push(current.children[index]!);
      }
    }
  }
  return result;
};

const collectNormalizedTokens = (screen: ScreenIR): Set<string> => {
  const tokens = new Set<string>();
  const visit = (node: ScreenElementIR): void => {
    for (const candidate of [node.name, node.text]) {
      const normalized = normalizeNodeName(candidate);
      if (!normalized) {
        continue;
      }
      for (const token of normalized.split("-")) {
        if (token.length > 0) {
          tokens.add(token);
        }
      }
    }
    if (node.variantMapping) {
      for (const [property, value] of Object.entries(node.variantMapping.properties)) {
        const normalizedProperty = normalizeNodeName(property);
        if (normalizedProperty) {
          tokens.add(normalizedProperty);
        }
        const normalizedValue = normalizeValueToken(value);
        if (normalizedValue) {
          tokens.add(normalizedValue);
        }
      }
      if (node.variantMapping.state) {
        const normalizedState = normalizeValueToken(node.variantMapping.state);
        if (normalizedState) {
          tokens.add(normalizedState);
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const child of screen.children) {
    visit(child);
  }
  return tokens;
};

const resolveAccordionExpanded = (element: ScreenElementIR): boolean | undefined => {
  const stateValues = [
    element.variantMapping?.properties["state"],
    element.variantMapping?.state,
    element.name
  ];
  for (const rawValue of stateValues) {
    const normalized = normalizeValueToken(rawValue);
    if (!normalized) {
      continue;
    }
    if (EXPANDED_TOKEN_SET.has(normalized)) {
      return true;
    }
    if (COLLAPSED_TOKEN_SET.has(normalized)) {
      return false;
    }
  }
  return undefined;
};

const resolveInitialState = ({
  screen,
  axes
}: {
  screen: ScreenIR;
  axes: readonly ScreenVariantFamilyAxis[];
}): ScreenVariantFamilyInitialStateIR => {
  const tokens = collectNormalizedTokens(screen);
  const accordions = collectScreenElements(screen.children).filter((element) => element.type === "accordion");
  const accordionStateByKey = Object.fromEntries(
    accordions
      .map((accordion) => {
        const expanded = resolveAccordionExpanded(accordion);
        if (expanded === undefined) {
          return undefined;
        }
        return [createAccordionStateKey(accordion), expanded] as const;
      })
      .filter((entry): entry is readonly [string, boolean] => entry !== undefined)
  );

  const initialState: ScreenVariantFamilyInitialStateIR = {};
  if (axes.includes("pricing-mode")) {
    if (tokens.has("brutto")) {
      initialState.pricingMode = "brutto";
    } else if (tokens.has("netto")) {
      initialState.pricingMode = "netto";
    }
  }

  if (axes.includes("validation-state")) {
    initialState.validationState = [...tokens].some((token) => ERROR_TOKEN_SET.has(token)) ? "error" : "default";
  }

  if (axes.includes("expansion-state")) {
    const hasExpandedAccordion = Object.values(accordionStateByKey).some((value) => value === true);
    const hasCollapsedAccordion = Object.values(accordionStateByKey).some((value) => value === false);
    if (hasExpandedAccordion) {
      initialState.expansionState = "expanded";
    } else if (hasCollapsedAccordion) {
      initialState.expansionState = "collapsed";
    } else if ([...tokens].some((token) => EXPANDED_TOKEN_SET.has(token))) {
      initialState.expansionState = "expanded";
    } else if ([...tokens].some((token) => COLLAPSED_TOKEN_SET.has(token))) {
      initialState.expansionState = "collapsed";
    }
  }

  if (Object.keys(accordionStateByKey).length > 0) {
    initialState.accordionStateByKey = accordionStateByKey;
  }

  return initialState;
};

const buildIndexedNodeRecords = ({ roots, rootPath }: { roots: readonly ScreenElementIR[]; rootPath: string }): IndexedNodeRecord[] => {
  const records: IndexedNodeRecord[] = [];

  const visitSiblings = (siblings: readonly ScreenElementIR[], parentPath: string): void => {
    const occurrenceByFingerprint = new Map<string, number>();
    for (const sibling of siblings) {
      const fingerprint = [
        normalizeNodeName(sibling.nodeType),
        normalizeNodeName(sibling.semanticType ?? sibling.type),
        normalizeNodeName(sibling.name)
      ].join("|");
      const occurrenceIndex = occurrenceByFingerprint.get(fingerprint) ?? 0;
      occurrenceByFingerprint.set(fingerprint, occurrenceIndex + 1);
      const path = `${parentPath}/${fingerprint}[${occurrenceIndex}]`;
      records.push({ element: sibling, path });
      if (Array.isArray(sibling.children) && sibling.children.length > 0) {
        visitSiblings(sibling.children, path);
      }
    }
  };

  visitSiblings(roots, rootPath);
  return records;
};

const buildIndexedNodeMap = ({ roots, rootPath }: { roots: readonly ScreenElementIR[]; rootPath: string }): Map<string, ScreenElementIR> => {
  return new Map(buildIndexedNodeRecords({ roots, rootPath }).map((record) => [record.path, record.element] as const));
};

const screenContentRoots = ({ screen, appShell }: { screen: ScreenIR; appShell: AppShellIR | undefined }): ScreenElementIR[] => {
  if (!screen.appShell || !appShell) {
    return [...screen.children];
  }
  const contentNodeIdSet = new Set(screen.appShell.contentNodeIds);
  return screen.children.filter((child) => contentNodeIdSet.has(child.id));
};

const screenShellRoots = ({ screen, appShell }: { screen: ScreenIR; appShell: AppShellIR | undefined }): ScreenElementIR[] => {
  if (!screen.appShell || !appShell) {
    return [];
  }
  const contentNodeIdSet = new Set(screen.appShell.contentNodeIds);
  return screen.children.filter((child) => !contentNodeIdSet.has(child.id));
};

const contentEqualityFingerprint = (element: ScreenElementIR): string => {
  return JSON.stringify({
    name: element.name,
    nodeType: element.nodeType,
    type: element.type,
    semanticType: element.semanticType,
    text: element.text,
    layoutMode: element.layoutMode,
    gap: element.gap,
    padding: element.padding,
    variantMapping: element.variantMapping
      ? {
          properties: Object.keys(element.variantMapping.properties)
            .sort((left, right) => left.localeCompare(right))
            .reduce<Record<string, string>>((result, key) => {
              result[key] = element.variantMapping?.properties[key] ?? "";
              return result;
            }, {}),
          muiProps: element.variantMapping.muiProps,
          state: element.variantMapping.state
        }
      : undefined,
    children: (element.children ?? []).map(contentEqualityFingerprint)
  });
};

const contentScreensAreEquivalent = ({
  canonicalRoots,
  memberRoots
}: {
  canonicalRoots: readonly ScreenElementIR[];
  memberRoots: readonly ScreenElementIR[];
}): boolean => {
  if (canonicalRoots.length !== memberRoots.length) {
    return false;
  }
  const canonicalFingerprint = canonicalRoots.map(contentEqualityFingerprint);
  const memberFingerprint = memberRoots.map(contentEqualityFingerprint);
  return JSON.stringify(canonicalFingerprint) === JSON.stringify(memberFingerprint);
};

const deriveShellTextOverrides = ({
  canonicalScreen,
  memberScreen,
  appShell
}: {
  canonicalScreen: ScreenIR;
  memberScreen: ScreenIR;
  appShell: AppShellIR;
}): Record<string, string> | undefined => {
  const canonicalShellRoots = screenShellRoots({ screen: canonicalScreen, appShell });
  const memberShellRoots = screenShellRoots({ screen: memberScreen, appShell });
  const canonicalIndex = buildIndexedNodeMap({ roots: canonicalShellRoots, rootPath: "shell" });
  const memberIndex = buildIndexedNodeMap({ roots: memberShellRoots, rootPath: "shell" });

  const canonicalPaths = [...canonicalIndex.keys()].sort((left, right) => left.localeCompare(right));
  const memberPaths = [...memberIndex.keys()].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(canonicalPaths) !== JSON.stringify(memberPaths)) {
    return undefined;
  }

  const overrides: Record<string, string> = {};
  for (const nodePath of canonicalPaths) {
    const canonicalNode = canonicalIndex.get(nodePath);
    const memberNode = memberIndex.get(nodePath);
    if (!canonicalNode || !memberNode || canonicalNode.type !== memberNode.type) {
      return undefined;
    }
    if (canonicalNode.type !== "text" || memberNode.type !== "text") {
      continue;
    }
    const canonicalText = canonicalNode.text.trim();
    const memberText = memberNode.text.trim();
    if (canonicalText !== memberText) {
      overrides[canonicalNode.id] = memberText;
    }
  }

  return overrides;
};

const resolveFamilyAppShell = ({
  ir,
  canonicalScreen
}: {
  ir: DesignIR;
  canonicalScreen: ScreenIR;
}): AppShellIR | undefined => {
  const appShellId = canonicalScreen.appShell?.id;
  if (!appShellId) {
    return undefined;
  }
  return ir.appShells?.find((candidate) => candidate.id === appShellId);
};

const deriveFamily = ({
  ir,
  group,
  canonicalScreen,
  memberScreens,
  axes
}: {
  ir: DesignIR;
  group: FigmaAnalysisFrameVariantGroup;
  canonicalScreen: ScreenIR;
  memberScreens: ScreenIR[];
  axes: ScreenVariantFamilyAxis[];
}): ScreenVariantFamilyIR | undefined => {
  const appShell = resolveFamilyAppShell({ ir, canonicalScreen });
  const canonicalContentRoots = screenContentRoots({ screen: canonicalScreen, appShell });
  const scenarios: ScreenVariantFamilyScenarioIR[] = [];

  for (const memberScreenId of group.frameIds) {
    const memberScreen = memberScreens.find((candidate) => candidate.id === memberScreenId);
    if (!memberScreen) {
      return undefined;
    }

    let shellTextOverrides: Record<string, string> | undefined;
    if (appShell) {
      shellTextOverrides = deriveShellTextOverrides({
        canonicalScreen,
        memberScreen,
        appShell
      });
      if (shellTextOverrides === undefined) {
        return undefined;
      }
    }

    const memberContentRoots = screenContentRoots({ screen: memberScreen, appShell });
    const contentScreenId = contentScreensAreEquivalent({
      canonicalRoots: canonicalContentRoots,
      memberRoots: memberContentRoots
    })
      ? canonicalScreen.id
      : memberScreen.id;

    const initialState = resolveInitialState({
      screen: memberScreen,
      axes
    });

    scenarios.push({
      screenId: memberScreen.id,
      contentScreenId,
      initialState,
      ...(shellTextOverrides && Object.keys(shellTextOverrides).length > 0 ? { shellTextOverrides } : {})
    });
  }

  return {
    familyId: group.groupId,
    canonicalScreenId: canonicalScreen.id,
    memberScreenIds: [...group.frameIds],
    axes,
    scenarios
  };
};

export const applyScreenVariantFamiliesToDesignIr = ({
  ir,
  figmaAnalysis
}: {
  ir: DesignIR;
  figmaAnalysis: FigmaAnalysis;
}): DesignIR => {
  const baseIr = { ...ir };
  delete baseIr.screenVariantFamilies;

  const screenById = new Map(ir.screens.map((screen) => [screen.id, screen] as const));
  const families: ScreenVariantFamilyIR[] = [];

  for (const group of figmaAnalysis.frameVariantGroups) {
    const axes = group.variantAxes
      .map((axis) => axis.axis)
      .filter((axis): axis is ScreenVariantFamilyAxis => ACTIONABLE_AXIS_SET.has(axis));
    if (axes.length === 0 || group.frameIds.length < 2) {
      continue;
    }

    const canonicalScreen = screenById.get(group.canonicalFrameId);
    if (!canonicalScreen) {
      continue;
    }

    const memberScreens = group.frameIds
      .map((frameId) => screenById.get(frameId))
      .filter((screen): screen is ScreenIR => screen !== undefined);
    if (memberScreens.length !== group.frameIds.length) {
      continue;
    }

    const family = deriveFamily({
      ir,
      group,
      canonicalScreen,
      memberScreens,
      axes
    });
    if (family) {
      families.push(family);
    }
  }

  return {
    ...baseIr,
    ...(families.length > 0 ? { screenVariantFamilies: families } : {})
  };
};
