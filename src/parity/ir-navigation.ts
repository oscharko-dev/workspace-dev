// ---------------------------------------------------------------------------
// ir-navigation.ts — Prototype navigation linking and resolution
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import type {
  FigmaNode,
  FigmaInteractionAction,
  MetricsAccumulator,
  PrototypeNavigationResolutionContext
} from "./ir-helpers.js";

export const normalizeNodeActionType = (value: string | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

export const resolvePrototypeNavigationMode = (
  navigation: string | undefined
): NonNullable<ScreenElementIR["prototypeNavigation"]>["mode"] | undefined => {
  const normalized = normalizeNodeActionType(navigation);
  if (!normalized || normalized === "NAVIGATE") {
    return "push";
  }
  if (normalized === "SWAP" || normalized === "REPLACE") {
    return "replace";
  }
  if (normalized === "OVERLAY") {
    return "overlay";
  }
  if (normalized === "CHANGE_TO") {
    return undefined;
  }
  return "push";
};

export const resolvePrototypeDestinationId = (action: FigmaInteractionAction): string | undefined => {
  const candidates = [action.destinationId, action.transitionNodeID, action.transitionNodeId];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
};

export const resolvePrototypeNavigation = ({
  node,
  metrics,
  navigationContext
}: {
  node: FigmaNode;
  metrics: MetricsAccumulator;
  navigationContext: PrototypeNavigationResolutionContext;
}): ScreenElementIR["prototypeNavigation"] | undefined => {
  for (const interaction of node.interactions ?? []) {
    if (normalizeNodeActionType(interaction.trigger?.type) !== "ON_CLICK") {
      continue;
    }
    const actions = Array.isArray(interaction.actions)
      ? interaction.actions
      : interaction.action
        ? [interaction.action]
        : [];
    for (const action of actions) {
      if (normalizeNodeActionType(action.type) !== "NODE") {
        continue;
      }
      const mode = resolvePrototypeNavigationMode(action.navigation);
      if (!mode) {
        continue;
      }

      metrics.prototypeNavigationDetected += 1;
      const destinationId = resolvePrototypeDestinationId(action);
      if (!destinationId) {
        metrics.prototypeNavigationUnresolved += 1;
        continue;
      }

      const targetScreenId =
        navigationContext.nodeIdToScreenId.get(destinationId) ??
        (navigationContext.knownScreenIds.has(destinationId) ? destinationId : undefined);
      if (!targetScreenId) {
        metrics.prototypeNavigationUnresolved += 1;
        continue;
      }

      metrics.prototypeNavigationResolved += 1;
      return {
        targetScreenId,
        mode
      };
    }
  }

  return undefined;
};
