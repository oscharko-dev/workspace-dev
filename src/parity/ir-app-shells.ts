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

interface TopLevelSignalMatch {
  nodeId: string;
  index: number;
}

const toScreenWithoutAppShell = (screen: ScreenIR): ScreenIR => {
  if (!screen.appShell) return screen;
  const { appShell: _discarded, ...rest } = screen;
  void _discarded;
  return rest;
};

/**
 * Returns the index of the signal's matching top-level child in `screen`, if
 * and only if exactly one of the signal's node ids appears among the screen's
 * top-level children. Zero matches and multi-match cases both return
 * `undefined` — multi-match indicates a data-integrity issue in the signal
 * (a signal should resolve to at most one node per screen) and is treated
 * defensively rather than logged, because this function must remain pure.
 */
const findTopLevelSignalMatch = ({
  screen,
  signal
}: {
  screen: ScreenIR;
  signal: FigmaAnalysisAppShellSignal;
}): TopLevelSignalMatch | undefined => {
  const matches = screen.children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => signal.nodeIds.includes(child.id));

  if (matches.length !== 1) {
    // Defensive: zero matches = signal not present at top level; multi-match =
    // malformed signal (multiple of its node ids appear as top-level children
    // of the same screen). Both cases disqualify the signal from this screen.
    return undefined;
  }

  return {
    nodeId: matches[0]!.child.id,
    index: matches[0]!.index
  };
};

/**
 * Builds a single lookup map of `screenId -> signalId -> TopLevelSignalMatch`
 * by scanning each screen once. Downstream checks (canonical resolution,
 * contiguity, full coverage) reuse this map instead of re-scanning.
 */
const buildSignalMatchIndex = ({
  screens,
  signals
}: {
  screens: readonly ScreenIR[];
  signals: readonly FigmaAnalysisAppShellSignal[];
}): Map<string, Map<string, TopLevelSignalMatch>> => {
  const index = new Map<string, Map<string, TopLevelSignalMatch>>();
  for (const screen of screens) {
    const perSignal = new Map<string, TopLevelSignalMatch>();
    for (const signal of signals) {
      const match = findTopLevelSignalMatch({ screen, signal });
      if (match) {
        perSignal.set(signal.signalId, match);
      }
    }
    index.set(screen.id, perSignal);
  }
  return index;
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
  const groupFrameIdSet = new Set(group.frameIds);

  // Scan every screen (canonical first, de-duplicated) exactly once to build
  // a reusable signal-match index. This unifies what were previously three
  // separate passes (canonical match, grouped-screen match, contiguity check).
  const screensToScan: ScreenIR[] = [
    canonicalScreen,
    ...groupedScreens.filter((screen) => screen.id !== canonicalScreen.id)
  ];
  const matchIndex = buildSignalMatchIndex({ screens: screensToScan, signals });

  const canonicalMatches = matchIndex.get(canonicalScreen.id);
  if (!canonicalMatches) {
    return undefined;
  }

  const resolvedSignals = signals
    .map((signal) => {
      const canonicalMatch = canonicalMatches.get(signal.signalId);
      if (!canonicalMatch) {
        return undefined;
      }

      for (const screen of groupedScreens) {
        const perSignal = matchIndex.get(screen.id);
        if (!perSignal || !perSignal.has(signal.signalId)) {
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
    const perSignal = matchIndex.get(screen.id);
    if (!perSignal) {
      return undefined;
    }
    const hasLeadingIndices = resolvedSignals.every((entry, signalIndex) => {
      const match = perSignal.get(entry.signal.signalId);
      return match !== undefined && match.index === signalIndex;
    });
    if (!hasLeadingIndices) {
      return undefined;
    }
  }

  // Full coverage: every signal must reference exactly the group's frame ids
  // (set equality — both direction checks are required).
  const hasFullCoverage = resolvedSignals.every(
    (entry) =>
      entry.signal.frameIds.length === group.frameIds.length &&
      entry.signal.frameIds.every((id) => groupFrameIdSet.has(id))
  );
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

  if (!resolvedSignals) {
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
      screenIds: groupedScreens.map((screen) => screen.id),
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
  const derivedAppShellIds = new Set<string>();
  const appShellByScreenId = new Map<string, ScreenAppShellIR>();
  const assignedScreenIds = new Set<string>();

  for (const group of figmaAnalysis.frameVariantGroups) {
    // A single-frame variant group has nothing to deduplicate — extracting
    // a shell from it would produce a one-screen AppShell that serves no
    // purpose. Skip defensively.
    if (group.frameIds.length < 2) {
      continue;
    }

    if (derivedAppShellIds.has(group.groupId)) {
      continue;
    }

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

    // Restrict to signals that belong to this specific group *and* whose frame
    // references are fully contained in the group's frame set. The subset
    // check hardens against malformed analyses where two variant groups share
    // the same `groupId` but reference disjoint frames — without it, signals
    // from one group would cross-pollute the other and cause both to fail
    // signal resolution.
    const groupFrameIdSet = new Set(group.frameIds);
    const groupSignals = figmaAnalysis.appShellSignals.filter(
      (signal) =>
        signal.groupId === group.groupId &&
        signal.confidence === 1 &&
        signal.frameIds.every((frameId) => groupFrameIdSet.has(frameId))
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
    derivedAppShellIds.add(plan.appShell.id);
    for (const screenShell of plan.screenShells) {
      appShellByScreenId.set(screenShell.screenId, screenShell.appShell);
      assignedScreenIds.add(screenShell.screenId);
    }
  }

  const { appShells: _discardedAppShells, ...irWithoutAppShells } = ir;
  void _discardedAppShells;
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
