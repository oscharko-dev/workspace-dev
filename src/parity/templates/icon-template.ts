// ---------------------------------------------------------------------------
// icon-template.ts — Icon fallback resolver and rendering
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type { ScreenElementIR } from "../types.js";
import {
  registerMuiImports,
  resolveFallbackIconComponent,
  resolveIconColor,
  isRtlLocale,
  DIRECTIONAL_ICON_NAMES
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
  collectVectorPaths,
  toRenderableAssetSource
} from "./utility-functions.js";

interface PathPoint {
  x: number;
  y: number;
}

const PATH_TOKEN_PATTERN = /[MLHVZmlhvz]|-?\d*\.?\d+(?:e[+-]?\d+)?/g;

const isApproximatelyEqual = (left: number, right: number, tolerance: number): boolean => {
  return Math.abs(left - right) <= tolerance;
};

const toPathPoints = (value: string): PathPoint[] | undefined => {
  const tokens = value.match(PATH_TOKEN_PATTERN);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }
  if (tokens.some((token) => !/[MLHVZmlhvz]/.test(token) && !/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(token))) {
    return undefined;
  }

  const points: PathPoint[] = [];
  let index = 0;
  let command = "";
  let cursor: PathPoint = { x: 0, y: 0 };
  let subpathStart: PathPoint = { x: 0, y: 0 };

  const readNumber = (): number | undefined => {
    const token = tokens[index];
    if (!token || /[MLHVZmlhvz]/.test(token)) {
      return undefined;
    }
    index += 1;
    const parsed = Number(token);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }

    if (/[MLHVZmlhvz]/.test(token)) {
      command = token;
      index += 1;
      if (command === "Z" || command === "z") {
        cursor = { ...subpathStart };
        points.push(cursor);
        continue;
      }
    }

    if (!command) {
      return undefined;
    }

    switch (command) {
      case "M":
      case "m": {
        let firstPair = true;
        while (index < tokens.length) {
          const x = readNumber();
          const y = readNumber();
          if (x === undefined || y === undefined) {
            break;
          }
          cursor =
            command === "m"
              ? {
                  x: cursor.x + x,
                  y: cursor.y + y
                }
              : { x, y };
          if (firstPair) {
            subpathStart = { ...cursor };
            firstPair = false;
          }
          points.push({ ...cursor });
          command = command === "m" ? "l" : "L";
        }
        break;
      }
      case "L":
      case "l": {
        while (index < tokens.length) {
          const x = readNumber();
          const y = readNumber();
          if (x === undefined || y === undefined) {
            break;
          }
          cursor =
            command === "l"
              ? {
                  x: cursor.x + x,
                  y: cursor.y + y
                }
              : { x, y };
          points.push({ ...cursor });
        }
        break;
      }
      case "H":
      case "h": {
        while (index < tokens.length) {
          const x = readNumber();
          if (x === undefined) {
            break;
          }
          cursor =
            command === "h"
              ? {
                  x: cursor.x + x,
                  y: cursor.y
                }
              : {
                  x,
                  y: cursor.y
                };
          points.push({ ...cursor });
        }
        break;
      }
      case "V":
      case "v": {
        while (index < tokens.length) {
          const y = readNumber();
          if (y === undefined) {
            break;
          }
          cursor =
            command === "v"
              ? {
                  x: cursor.x,
                  y: cursor.y + y
                }
              : {
                  x: cursor.x,
                  y
                };
          points.push({ ...cursor });
        }
        break;
      }
      default:
        return undefined;
    }
  }

  return points.length > 0 ? points : undefined;
};

const isViewportBoundingPath = ({
  pathData,
  width,
  height
}: {
  pathData: string;
  width: number;
  height: number;
}): boolean => {
  const points = toPathPoints(pathData);
  if (!points || points.length < 4) {
    return false;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const tolerance = Math.max(0.5, Math.min(width, height) * 0.04);
  if (
    !isApproximatelyEqual(minX, 0, tolerance) ||
    !isApproximatelyEqual(minY, 0, tolerance) ||
    !isApproximatelyEqual(maxX, width, tolerance) ||
    !isApproximatelyEqual(maxY, height, tolerance)
  ) {
    return false;
  }

  const corners: PathPoint[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];

  return points.every((point) =>
    corners.some((corner) => isApproximatelyEqual(point.x, corner.x, tolerance) && isApproximatelyEqual(point.y, corner.y, tolerance))
  );
};

const filterBoundingBoxPaths = ({
  paths,
  width,
  height
}: {
  paths: string[];
  width: number;
  height: number;
}): string[] => {
  if (paths.length <= 1) {
    return paths;
  }
  const filtered = paths.filter((pathData) => !isViewportBoundingPath({ pathData, width, height }));
  return filtered.length > 0 ? filtered : paths;
};

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
  if (
    typeof element.asset?.source === "string" &&
    element.asset.source.trim().length > 0 &&
    (element.asset.kind === "svg" || element.asset.kind === "icon")
  ) {
    registerMuiImports(context, "Box");
    const sx = sxString([
      ["width", toPxLiteral(element.width)],
      ["height", toPxLiteral(element.height)],
      ["display", literal("block")],
      ...extraEntries
    ]);
    const assetLabel = element.asset.alt ?? element.asset.label ?? parent.name ?? element.name;
    const altProp = ariaHidden ? ' alt="" aria-hidden="true"' : ` alt={${literal(assetLabel)}}`;
    return `<Box component="img" src={${literal(toRenderableAssetSource(element.asset.source))}}${altProp} sx={{ ${sx} }} />`;
  }

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
  const rtlMirror = isRtlLocale(context.generationLocale) && DIRECTIONAL_ICON_NAMES.has(iconComponent);
  const sx = sxString([
    ["width", toPxLiteral(element.width)],
    ["height", toPxLiteral(element.height)],
    ["fontSize", toPxLiteral(element.width ? Math.max(12, Math.round(element.width * 0.9)) : 16)],
    ["lineHeight", literal("1")],
    ["color", toThemeColorLiteral({ color, tokens: context.tokens })],
    ["transform", rtlMirror ? literal("scaleX(-1)") : undefined],
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
  const paths = filterBoundingBoxPaths({
    paths: icon.paths,
    width,
    height
  })
    .map((pathData) => `<path d={${literal(pathData)}} />`)
    .join("");
  const ariaHiddenProp = ariaHidden ? ` aria-hidden="true"` : "";
  return `<SvgIcon${ariaHiddenProp} sx={{ ${sx} }} viewBox={${literal(`0 0 ${width} ${height}`)}}>${paths}</SvgIcon>`;
};
