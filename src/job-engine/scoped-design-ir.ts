import type { DesignIR, ScreenElementIR, ScreenIR } from "../parity/types-ir.js";
import { pruneElementToSelection } from "../parity/ir-screens.js";

const normalizeSelectedNodeIds = (
  selectedNodeIds: readonly string[],
): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const nodeId of selectedNodeIds) {
    const trimmed = nodeId.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

const collectExpandedSelectionForScreen = ({
  screen,
  selectedIds,
}: {
  screen: ScreenIR;
  selectedIds: ReadonlySet<string>;
}): Set<string> => {
  const expanded = new Set<string>();
  const walk = (
    node: Pick<ScreenElementIR, "id" | "children">,
    ancestors: readonly string[],
  ): boolean => {
    const nextAncestors = [...ancestors, node.id];
    const hasDirectSelection = selectedIds.has(node.id);
    let hasSelectedDescendant = false;

    for (const child of node.children ?? []) {
      if (walk(child, nextAncestors)) {
        hasSelectedDescendant = true;
      }
    }

    if (hasDirectSelection || hasSelectedDescendant) {
      for (const ancestorId of ancestors) {
        expanded.add(ancestorId);
      }
      expanded.add(node.id);
      return true;
    }

    return false;
  };

  const hasSelectedScreen = selectedIds.has(screen.id);
  let hasSelectedDescendant = false;
  for (const child of screen.children) {
    if (walk(child, [screen.id])) {
      hasSelectedDescendant = true;
    }
  }
  if (hasSelectedScreen || hasSelectedDescendant) {
    expanded.add(screen.id);
  }
  return expanded;
};

const pruneScreenChildren = ({
  screen,
  selectedIds,
}: {
  screen: ScreenIR;
  selectedIds: Set<string>;
}): ScreenIR | null => {
  if (!selectedIds.has(screen.id)) {
    return null;
  }

  const nextChildren: ScreenElementIR[] = [];
  for (const child of screen.children) {
    const pruned = pruneElementToSelection({
      element: child,
      selectedIds,
    });
    if (pruned) {
      nextChildren.push(pruned);
    }
  }

  return {
    ...screen,
    children: nextChildren,
    ...(screen.appShell
      ? {
          appShell: {
            ...screen.appShell,
            contentNodeIds: screen.appShell.contentNodeIds.filter((nodeId) =>
              selectedIds.has(nodeId),
            ),
          },
        }
      : {}),
  };
};

export const pruneDesignIrToSelectedNodeIds = ({
  ir,
  selectedNodeIds,
}: {
  ir: DesignIR;
  selectedNodeIds: readonly string[];
}): DesignIR => {
  const normalizedSelectedNodeIds = normalizeSelectedNodeIds(selectedNodeIds);
  if (normalizedSelectedNodeIds.length === 0) {
    return ir;
  }

  const selectedIds = new Set(normalizedSelectedNodeIds);
  const nextScreens = ir.screens
    .map((screen) => {
      const expandedSelection = collectExpandedSelectionForScreen({
        screen,
        selectedIds,
      });
      return pruneScreenChildren({
        screen,
        selectedIds: expandedSelection,
      });
    })
    .filter((screen): screen is ScreenIR => screen !== null);

  const keptScreenIds = new Set(nextScreens.map((screen) => screen.id));

  return {
    ...ir,
    screens: nextScreens,
    ...(ir.appShells
      ? {
          appShells: ir.appShells.filter((shell) =>
            shell.screenIds.some((screenId) => keptScreenIds.has(screenId)),
          ),
        }
      : {}),
    ...(ir.screenVariantFamilies
      ? {
          screenVariantFamilies: ir.screenVariantFamilies.filter((family) =>
            family.memberScreenIds.some((screenId) => keptScreenIds.has(screenId)),
          ),
        }
      : {}),
  };
};
