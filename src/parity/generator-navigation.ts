// ---------------------------------------------------------------------------
// generator-navigation.ts — Prototype navigation → router binding
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "./types.js";
import type { RenderContext } from "./generator-render.js";
import { literal } from "./generator-templates.js";


interface ResolvedPrototypeNavigation {
  routePath: string;
  replace: boolean;
}

export const resolvePrototypeNavigationBinding = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): ResolvedPrototypeNavigation | undefined => {
  const targetScreenId = element.prototypeNavigation?.targetScreenId;
  if (!targetScreenId) {
    return undefined;
  }
  const routePath = context.routePathByScreenId.get(targetScreenId);
  if (!routePath) {
    return undefined;
  }
  return {
    routePath,
    replace: element.prototypeNavigation?.mode === "replace"
  };
};

export const toRouterLinkProps = ({
  navigation,
  context
}: {
  navigation: ResolvedPrototypeNavigation;
  context: RenderContext;
}): string => {
  context.usesRouterLink = true;
  context.prototypeNavigationRenderedCount += 1;
  const replaceProp = navigation.replace ? " replace" : "";
  return ` component={RouterLink} to={${literal(navigation.routePath)}}${replaceProp}`;
};

export const toNavigateHandlerProps = ({
  navigation,
  context
}: {
  navigation: ResolvedPrototypeNavigation;
  context: RenderContext;
}): {
  onClickProp: string;
  onKeyDownProp: string;
  roleProp: string;
  tabIndexProp: string;
} => {
  context.usesNavigateHandler = true;
  context.prototypeNavigationRenderedCount += 1;
  const navigateCall = navigation.replace
    ? `navigate(${literal(navigation.routePath)}, { replace: true })`
    : `navigate(${literal(navigation.routePath)})`;
  const navigateStatement = `void ${navigateCall}`;
  return {
    onClickProp: ` onClick={() => { ${navigateStatement}; }}`,
    onKeyDownProp:
      ' onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ' +
      `${navigateStatement}; } }}`,
    roleProp: ' role="button"',
    tabIndexProp: " tabIndex={0}"
  };
};
