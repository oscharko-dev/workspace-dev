import type { FigmaAnalysis, FigmaAnalysisAppShellSignal, FigmaAnalysisFrameVariantGroup } from "./figma-analysis.js";
import type { AppShellIR, DesignIR, ScreenAppShellIR, ScreenIR } from "./types-ir.js";

interface ResolvedGroupSignal {
  signal: FigmaAnalysisAppShellSignal;
  canonicalNodeId: string;
  canonicalIndex: number;
}

interface DerivedGroupShellPlan {
  appShell: AppShellIR;
  screenShells: Array<{
    screenId: string;
    appShell: ScreenAppShellIR;
  }>;
}

const toScreenWithoutAppShell = (screen: ScreenIR): ScreenIR => {
  if (!screen.appShell) return screen;
  const copy = { ...screen };
  delete copy.appShell;
  return copy;
};

const findTopLevelSignalMatch = ({
  screen,
  signal
}: {
  screen: ScreenIR;
  signal: FigmaAnalysisAppShellSignal;
}): { nodeId: string; index: number } | undefined => {
  const matches = screen.children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => signal.nodeIds.includes(child.id));

  if (matches.length !== 1) {
    return undefined;
  }

  return {
    nodeId: matches[0]!.child.id,
    index: matches[0]!.index
  };
};

const resolveGroupSignals = ({
  group,
  signals,
  groupedScreens,
  canonicalScreen
}: {
  group: FigmaAnalysisFrameVariantGroup;
  signals: FigmaAnalysisAppShellSignal[];
  groupedScreens: ScreenIR[];
  canonicalScreen: ScreenIR;
}): ResolvedGroupSignal[] | undefined => {
  const resolvedSignals = signals
    .map((signal) => {
      const canonicalMatch = findTopLevelSignalMatch({ screen: canonicalScreen, signal });
      if (!canonicalMatch) {
        return undefined;
      }

      for (const screen of groupedScreens) {
        const match = findTopLevelSignalMatch({ screen, signal });
        if (!match) {
          return undefined;
        }
      }

      return {
        signal,
        canonicalNodeId: canonicalMatch.nodeId,
        canonicalIndex: canonicalMatch.index
      } satisfies ResolvedGroupSignal;
    })
    .filter((entry): entry is ResolvedGroupSignal => entry !== undefined)
    .sort((left, right) => left.canonicalIndex - right.canonicalIndex);

  if (resolvedSignals.length !== signals.length) {
    return undefined;
  }

  const hasLeadingTopLevelSegment = resolvedSignals.every((entry, index) => entry.canonicalIndex === index);
  if (!hasLeadingTopLevelSegment) {
    return undefined;
  }

  for (const screen of groupedScreens) {
    const signalIndices = resolvedSignals.map((entry) => {
      const match = findTopLevelSignalMatch({
        screen,
        signal: entry.signal
      });
      return match?.index;
    });
    const hasLeadingIndices = signalIndices.every((index, signalIndex) => index === signalIndex);
    if (!hasLeadingIndices) {
      return undefined;
    }
  }

  const hasFullCoverage = resolvedSignals.every((entry) => entry.signal.frameIds.length === group.frameIds.length);
  if (!hasFullCoverage) {
    return undefined;
  }

  return resolvedSignals;
};

const deriveGroupShellPlan = ({
  group,
  signals,
  groupedScreens,
  canonicalScreen
}: {
  group: FigmaAnalysisFrameVariantGroup;
  signals: FigmaAnalysisAppShellSignal[];
  groupedScreens: ScreenIR[];
  canonicalScreen: ScreenIR;
}): DerivedGroupShellPlan | undefined => {
  const resolvedSignals = resolveGroupSignals({
    group,
    signals,
    groupedScreens,
    canonicalScreen
  });

  if (!resolvedSignals || resolvedSignals.length === 0) {
    return undefined;
  }

  const shellNodeCount = resolvedSignals.length;
  const screenShells = groupedScreens.map((screen) => {
    const contentNodeIds = screen.children.slice(shellNodeCount).map((child) => child.id);
    return {
      screenId: screen.id,
      appShell: {
        id: group.groupId,
        contentNodeIds
      } satisfies ScreenAppShellIR
    };
  });

  if (screenShells.some((entry) => entry.appShell.contentNodeIds.length === 0)) {
    return undefined;
  }

  return {
    appShell: {
      id: group.groupId,
      sourceScreenId: canonicalScreen.id,
      screenIds: [...group.frameIds],
      shellNodeIds: resolvedSignals.map((entry) => entry.canonicalNodeId),
      slotIndex: shellNodeCount,
      signalIds: resolvedSignals.map((entry) => entry.signal.signalId)
    },
    screenShells
  };
};

export const applyAppShellsToDesignIr = ({
  ir,
  figmaAnalysis
}: {
  ir: DesignIR;
  figmaAnalysis: FigmaAnalysis;
}): DesignIR => {
  const baseScreens = ir.screens.map(toScreenWithoutAppShell);
  const screenById = new Map(baseScreens.map((screen) => [screen.id, screen] as const));
  const derivedAppShells: AppShellIR[] = [];
  const appShellByScreenId = new Map<string, ScreenAppShellIR>();
  const assignedScreenIds = new Set<string>();

  for (const group of figmaAnalysis.frameVariantGroups) {
    if (group.frameIds.some((screenId) => assignedScreenIds.has(screenId))) {
      continue;
    }

    const groupedScreens = group.frameIds
      .map((screenId) => screenById.get(screenId))
      .filter((screen): screen is ScreenIR => screen !== undefined);
    if (groupedScreens.length !== group.frameIds.length) {
      continue;
    }

    const canonicalScreen = screenById.get(group.canonicalFrameId);
    if (!canonicalScreen) {
      continue;
    }

    const groupSignals = figmaAnalysis.appShellSignals.filter(
      (signal) => signal.groupId === group.groupId && signal.confidence === 1
    );
    if (groupSignals.length === 0) {
      continue;
    }

    const plan = deriveGroupShellPlan({
      group,
      signals: groupSignals,
      groupedScreens,
      canonicalScreen
    });
    if (!plan) {
      continue;
    }

    derivedAppShells.push(plan.appShell);
    for (const screenShell of plan.screenShells) {
      appShellByScreenId.set(screenShell.screenId, screenShell.appShell);
      assignedScreenIds.add(screenShell.screenId);
    }
  }

  const irWithoutAppShells = { ...ir };
  delete irWithoutAppShells.appShells;
  const screens = baseScreens.map((screen) => {
    const screenAppShell = appShellByScreenId.get(screen.id);
    return screenAppShell ? { ...screen, appShell: screenAppShell } : screen;
  });

  return {
    ...irWithoutAppShells,
    screens,
    ...(derivedAppShells.length > 0 ? { appShells: derivedAppShells } : {})
  };
};
