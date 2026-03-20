// ---------------------------------------------------------------------------
// icon-template.ts — Icon fallback resolver and rendering
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "../types.js";
import {
  registerMuiImports,
  resolveFallbackIconComponent,
  resolveIconColor
} from "../generator-core.js";
import type {
  RenderContext,
  VirtualParent,
  SemanticIconModel
} from "../generator-core.js";
import {
  literal,
  toPxLiteral,
  sxString,
  toThemeColorLiteral,
  collectVectorPaths
} from "./utility-functions.js";

export const renderFallbackIconExpression = ({
  element,
  parent,
  context,
  ariaHidden = false,
  extraEntries = []
}: {
  element: ScreenElementIR;
  parent: Pick<VirtualParent, "name">;
  context: RenderContext;
  ariaHidden?: boolean;
  extraEntries?: Array<[string, string | number | undefined]>;
}): string => {
  const vectorPaths = collectVectorPaths(element);
  if (vectorPaths.length > 0) {
    return renderInlineSvgIcon({
      icon: {
        paths: vectorPaths,
        color: resolveIconColor(element),
        width: element.width,
        height: element.height
      },
      context,
      ariaHidden,
      extraEntries
    });
  }

  const iconComponent = resolveFallbackIconComponent({ element, parent, context });
  const color = resolveIconColor(element);
  const sx = sxString([
    ["width", toPxLiteral(element.width)],
    ["height", toPxLiteral(element.height)],
    ["fontSize", toPxLiteral(element.width ? Math.max(12, Math.round(element.width * 0.9)) : 16)],
    ["lineHeight", literal("1")],
    ["color", toThemeColorLiteral({ color, tokens: context.tokens })],
    ...extraEntries
  ]);
  const ariaHiddenProp = ariaHidden ? ` aria-hidden="true"` : "";
  return `<${iconComponent}${ariaHiddenProp} sx={{ ${sx} }} fontSize="inherit" />`;
};


export const renderInlineSvgIcon = ({
  icon,
  context,
  ariaHidden = false,
  extraEntries = []
}: {
  icon: SemanticIconModel;
  context: RenderContext;
  ariaHidden?: boolean;
  extraEntries?: Array<[string, string | number | undefined]>;
}): string => {
  registerMuiImports(context, "SvgIcon");
  const sx = sxString([
    ["width", toPxLiteral(icon.width)],
    ["height", toPxLiteral(icon.height)],
    ["color", toThemeColorLiteral({ color: icon.color, tokens: context.tokens })],
    ...extraEntries
  ]);
  const width = Math.max(1, Math.round(icon.width ?? 24));
  const height = Math.max(1, Math.round(icon.height ?? 24));
  const paths = icon.paths.map((pathData) => `<path d={${literal(pathData)}} />`).join("");
  const ariaHiddenProp = ariaHidden ? ` aria-hidden="true"` : "";
  return `<SvgIcon${ariaHiddenProp} sx={{ ${sx} }} viewBox={${literal(`0 0 ${width} ${height}`)}}>${paths}</SvgIcon>`;
};

