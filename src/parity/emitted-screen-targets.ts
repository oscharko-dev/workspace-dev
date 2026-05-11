import { buildScreenArtifactIdentities, type ScreenArtifactIdentity } from "./generator-artifacts.js";
import type { DesignIR, ScreenIR, ScreenVariantFamilyIR } from "./types-ir.js";

export interface EmittedScreenRouteEntry {
  routeScreenId: string;
  emittedScreenId: string;
  routePath: string;
  initialVariantId?: string;
}

export interface EmittedScreenTarget {
  emittedScreenId: string;
  screen: ScreenIR;
  family?: ScreenVariantFamilyIR;
}

export interface ResolvedEmittedScreenTargets {
  emittedScreens: ScreenIR[];
  emittedTargets: EmittedScreenTarget[];
  routeEntries: EmittedScreenRouteEntry[];
  emittedIdentitiesByScreenId: Map<string, ScreenArtifactIdentity>;
  rawIdentitiesByScreenId: Map<string, ScreenArtifactIdentity>;
}

const resolveFamiliesByCanonicalScreenId = (
  families: readonly ScreenVariantFamilyIR[] | undefined
): Map<string, ScreenVariantFamilyIR> => {
  return new Map((families ?? []).map((family) => [family.canonicalScreenId, family] as const));
};

const resolveFamilyByMemberScreenId = (
  families: readonly ScreenVariantFamilyIR[] | undefined
): Map<string, ScreenVariantFamilyIR> => {
  const familyByMemberScreenId = new Map<string, ScreenVariantFamilyIR>();
  for (const family of families ?? []) {
    for (const memberScreenId of family.memberScreenIds) {
      familyByMemberScreenId.set(memberScreenId, family);
    }
  }
  return familyByMemberScreenId;
};

export const resolveEmittedScreenTargets = ({
  ir
}: {
  ir: Pick<DesignIR, "screens" | "screenVariantFamilies">;
}): ResolvedEmittedScreenTargets => {
  const rawIdentitiesByScreenId = buildScreenArtifactIdentities(ir.screens);
  const familyByCanonicalScreenId = resolveFamiliesByCanonicalScreenId(ir.screenVariantFamilies);
  const familyByMemberScreenId = resolveFamilyByMemberScreenId(ir.screenVariantFamilies);
  const emittedTargets: EmittedScreenTarget[] = [];

  for (const screen of ir.screens) {
    const family = familyByCanonicalScreenId.get(screen.id);
    if (family) {
      emittedTargets.push({
        emittedScreenId: screen.id,
        screen,
        family
      });
      continue;
    }
    if (familyByMemberScreenId.has(screen.id)) {
      continue;
    }
    emittedTargets.push({
      emittedScreenId: screen.id,
      screen
    });
  }

  const emittedScreens = emittedTargets.map((target) => target.screen);
  const emittedIdentitiesByScreenId = new Map<string, ScreenArtifactIdentity>();
  for (const target of emittedTargets) {
    const identity = rawIdentitiesByScreenId.get(target.emittedScreenId);
    if (identity) {
      emittedIdentitiesByScreenId.set(target.emittedScreenId, identity);
    }
  }

  const routeEntries: EmittedScreenRouteEntry[] = [];
  for (const target of emittedTargets) {
    const canonicalIdentity = rawIdentitiesByScreenId.get(target.emittedScreenId);
    if (!canonicalIdentity) {
      continue;
    }
    routeEntries.push({
      routeScreenId: target.emittedScreenId,
      emittedScreenId: target.emittedScreenId,
      routePath: canonicalIdentity.routePath
    });
    if (!target.family) {
      continue;
    }
    for (const memberScreenId of target.family.memberScreenIds) {
      if (memberScreenId === target.emittedScreenId) {
        continue;
      }
      const memberIdentity = rawIdentitiesByScreenId.get(memberScreenId);
      if (!memberIdentity) {
        continue;
      }
      routeEntries.push({
        routeScreenId: memberScreenId,
        emittedScreenId: target.emittedScreenId,
        routePath: memberIdentity.routePath,
        initialVariantId: memberScreenId
      });
    }
  }

  return {
    emittedScreens,
    emittedTargets,
    routeEntries,
    emittedIdentitiesByScreenId,
    rawIdentitiesByScreenId
  };
};
