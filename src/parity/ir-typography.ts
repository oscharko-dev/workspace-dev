// ---------------------------------------------------------------------------
// ir-typography.ts — Typography collection, clustering, and variant assignment
// Extracted from ir.ts (issue #299)
// ---------------------------------------------------------------------------
import type {
  DesignTokenTypographyScale,
  DesignTokenTypographyVariant,
  DesignTokenTypographyVariantName
} from "./types.js";
import type { FigmaTextStyleEntry } from "./typography-tokens.js";
import {
  HEADING_TYPOGRAPHY_VARIANTS,
  buildTypographyScaleFromFigmaStyles,
  completeTypographyScale
} from "./typography-tokens.js";
import {
  hasMeaningfulNodeText
} from "./ir-tree.js";
import {
  hasAnySubstring,
  hasAnyWord
} from "./ir-classification.js";
import {
  HEADING_LINE_HEIGHT_MULTIPLIER,
  BODY_LINE_HEIGHT_MULTIPLIER,
  REM_BASE_FONT_SIZE,
  UPPERCASE_DETECTION_RATIO,
  TEXT_WIDTH_PROMINENCE_DIVISOR
} from "./constants.js";
import type {
  FigmaNode,
  FontSample,
  TypographyCluster
} from "./ir-helpers.js";
import {
  clamp,
  weightedMedian
} from "./ir-helpers.js";
import {
  TOKEN_DERIVATION_DEFAULTS,
  resolveTextRole
} from "./ir-palette.js";

export const TYPOGRAPHY_SIZE_SNAP_THRESHOLD_PX = 1.75;
export const TYPOGRAPHY_INTEGER_EPSILON_PX = 0.15;

export const isUppercaseLikeText = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const letters = value.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length < 2) {
    return false;
  }
  const uppercaseLetters = letters.replace(/[^A-ZÄÖÜ]/g, "");
  return uppercaseLetters.length / letters.length >= UPPERCASE_DETECTION_RATIO;
};

export const isButtonLikeTextNode = ({
  node,
  ancestorNames
}: {
  node: FigmaNode;
  ancestorNames: string[];
}): boolean => {
  const combined = [node.name, ...ancestorNames].join(" ").toLowerCase();
  return (
    hasAnySubstring(combined, ["muibutton", "buttonbase", "buttonlabel"]) ||
    hasAnyWord(combined, ["button", "cta", "chip", "tab", "step", "pill"])
  );
};

export const collectFontSamples = (root: FigmaNode | undefined): FontSample[] => {
  if (!root) {
    return [];
  }

  const samples: FontSample[] = [];
  const visit = (node: FigmaNode, ancestorNames: string[]): void => {
    if (node.visible === false) {
      return;
    }

    if (node.type === "TEXT" && hasMeaningfulNodeText(node)) {
      const role = resolveTextRole(node);
      const size = node.style?.fontSize ?? (role === "heading" ? 24 : 14);
      const lineHeightMultiplier = role === "heading" ? HEADING_LINE_HEIGHT_MULTIPLIER : BODY_LINE_HEIGHT_MULTIPLIER;
      const height = node.absoluteBoundingBox?.height ?? Math.max(size * lineHeightMultiplier, size);
      const width = node.absoluteBoundingBox?.width ?? 120;
      const family = node.style?.fontFamily?.trim() || (TOKEN_DERIVATION_DEFAULTS.fontFamily.split(",")[0] ?? "Roboto");
      const fontWeight = node.style?.fontWeight ?? (role === "heading" ? 700 : 400);
      const lineHeight = node.style?.lineHeightPx ?? Math.max(Math.round(size * lineHeightMultiplier), size);
      const isButtonLike = isButtonLikeTextNode({ node, ancestorNames });
      const roleWeight = role === "heading" ? 1.8 : 1;
      const prominenceWeight = clamp(size / REM_BASE_FONT_SIZE, 0.75, 2.5);
      const geometryWeight = clamp(width / TEXT_WIDTH_PROMINENCE_DIVISOR + height / 96, 1, 8);
      samples.push({
        family,
        role,
        size,
        weight: geometryWeight * roleWeight * prominenceWeight * (isButtonLike ? 1.15 : 1),
        fontWeight,
        lineHeight,
        ...(typeof node.style?.letterSpacing === "number" && Number.isFinite(node.style.letterSpacing)
          ? { letterSpacingPx: node.style.letterSpacing }
          : {}),
        isButtonLike,
        isUppercaseLike: isUppercaseLikeText(node.characters)
      });
    }

    const nextAncestorNames = node.name ? [node.name, ...ancestorNames] : ancestorNames;
    for (const child of node.children ?? []) {
      visit(child, nextAncestorNames);
    }
  };

  visit(root, []);
  return samples;
};

export const resolveTypographyAnchorSizes = (samples: FontSample[]): number[] => {
  const anchors = new Set<number>();
  for (const sample of samples) {
    const rounded = Math.round(sample.size);
    if (Math.abs(sample.size - rounded) <= TYPOGRAPHY_INTEGER_EPSILON_PX) {
      anchors.add(rounded);
    }
  }
  if (anchors.size === 0) {
    anchors.add(TOKEN_DERIVATION_DEFAULTS.headingSize);
    anchors.add(TOKEN_DERIVATION_DEFAULTS.bodySize);
  }
  return [...anchors].sort((left, right) => right - left);
};

export const normalizeTypographyClusterSize = ({
  size,
  anchors
}: {
  size: number;
  anchors: number[];
}): number => {
  const rounded = Math.round(size);
  if (Math.abs(size - rounded) <= TYPOGRAPHY_INTEGER_EPSILON_PX) {
    return Math.max(10, rounded);
  }
  const snapped = anchors.find((anchor) => anchor <= size && size - anchor <= TYPOGRAPHY_SIZE_SNAP_THRESHOLD_PX);
  return Math.max(10, snapped ?? rounded);
};

export const resolveDominantClusterFontFamily = (samples: FontSample[]): string | undefined => {
  const weights = new Map<string, number>();
  for (const sample of samples) {
    weights.set(sample.family, (weights.get(sample.family) ?? 0) + sample.weight);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

export const clusterTypographySamples = (samples: FontSample[]): TypographyCluster[] => {
  if (samples.length === 0) {
    return [];
  }

  const anchors = resolveTypographyAnchorSizes(samples);
  const grouped = new Map<number, FontSample[]>();
  for (const sample of samples) {
    const key = normalizeTypographyClusterSize({
      size: sample.size,
      anchors
    });
    grouped.set(key, [...(grouped.get(key) ?? []), sample]);
  }

  return [...grouped.entries()]
    .map(([normalizedSize, clusterSamples]) => {
      const totalWeight = clusterSamples.reduce((sum, sample) => sum + sample.weight, 0);
      const headingWeight = clusterSamples
        .filter((sample) => sample.role === "heading")
        .reduce((sum, sample) => sum + sample.weight, 0);
      const bodyWeight = clusterSamples
        .filter((sample) => sample.role === "body")
        .reduce((sum, sample) => sum + sample.weight, 0);
      const buttonWeight = clusterSamples
        .filter((sample) => sample.isButtonLike)
        .reduce((sum, sample) => sum + sample.weight, 0);
      const uppercaseWeight = clusterSamples
        .filter((sample) => sample.isUppercaseLike)
        .reduce((sum, sample) => sum + sample.weight, 0);
      const cluster: TypographyCluster = {
        normalizedSize,
        totalWeight,
        headingWeight,
        bodyWeight,
        buttonWeight,
        uppercaseWeight,
        fontWeight: Math.round(
          weightedMedian(
            clusterSamples.map((sample) => ({
              value: sample.fontWeight,
              weight: sample.weight
            }))
          ) ?? 400
        ),
        lineHeight: Math.round(
          weightedMedian(
            clusterSamples.map((sample) => ({
              value: sample.lineHeight,
              weight: sample.weight
            }))
          ) ?? Math.max(normalizedSize, Math.round(normalizedSize * 1.4))
        )
      };
      const dominantFontFamily = resolveDominantClusterFontFamily(clusterSamples);
      if (dominantFontFamily) {
        cluster.fontFamily = dominantFontFamily;
      }
      const letterSpacingEm = weightedMedian(
        clusterSamples
          .filter(
            (sample): sample is FontSample & { letterSpacingPx: number } =>
              typeof sample.letterSpacingPx === "number" && Number.isFinite(sample.letterSpacingPx) && sample.size > 0
          )
          .map((sample) => ({
            value: sample.letterSpacingPx / sample.size,
            weight: sample.weight
          }))
      );
      if (typeof letterSpacingEm === "number") {
        cluster.letterSpacingEm = letterSpacingEm;
      }
      return cluster;
    })
    .sort((left, right) => {
      if (right.normalizedSize !== left.normalizedSize) {
        return right.normalizedSize - left.normalizedSize;
      }
      if (right.headingWeight !== left.headingWeight) {
        return right.headingWeight - left.headingWeight;
      }
      return right.totalWeight - left.totalWeight;
    });
};

export const toTypographyVariantFromCluster = ({
  cluster,
  fallbackFontFamily,
  textTransform,
  letterSpacingEm
}: {
  cluster: TypographyCluster;
  fallbackFontFamily: string;
  textTransform?: DesignTokenTypographyVariant["textTransform"];
  letterSpacingEm?: number;
}): DesignTokenTypographyVariant => {
  return {
    fontSizePx: cluster.normalizedSize,
    fontWeight: cluster.fontWeight,
    lineHeightPx: Math.max(cluster.normalizedSize, cluster.lineHeight),
    fontFamily: cluster.fontFamily ?? fallbackFontFamily,
    ...(typeof (letterSpacingEm ?? cluster.letterSpacingEm) === "number"
      ? { letterSpacingEm: letterSpacingEm ?? cluster.letterSpacingEm }
      : {}),
    ...(textTransform ? { textTransform } : {})
  };
};

export const chooseBodyTypographyCluster = (clusters: TypographyCluster[]): TypographyCluster | undefined => {
  return [...clusters].sort((left, right) => {
    const leftScore =
      left.bodyWeight * 2.6 + left.totalWeight * 0.9 + (left.normalizedSize >= 12 && left.normalizedSize <= 18 ? 2 : 0);
    const rightScore =
      right.bodyWeight * 2.6 +
      right.totalWeight * 0.9 +
      (right.normalizedSize >= 12 && right.normalizedSize <= 18 ? 2 : 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.totalWeight - left.totalWeight;
  })[0];
};

export const chooseButtonTypographyCluster = (clusters: TypographyCluster[]): TypographyCluster | undefined => {
  return [...clusters].sort((left, right) => {
    const leftScore =
      left.buttonWeight * 3 + left.fontWeight * 0.01 + left.totalWeight * 0.4 + (left.normalizedSize >= 14 ? 0.5 : 0);
    const rightScore =
      right.buttonWeight * 3 +
      right.fontWeight * 0.01 +
      right.totalWeight * 0.4 +
      (right.normalizedSize >= 14 ? 0.5 : 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.normalizedSize - left.normalizedSize;
  })[0];
};

export const findNextLargerTypographyCluster = ({
  clusters,
  size
}: {
  clusters: TypographyCluster[];
  size: number;
}): TypographyCluster | undefined => {
  return [...clusters].reverse().find((cluster) => cluster.normalizedSize > size);
};

export const findNextSmallerTypographyCluster = ({
  clusters,
  size
}: {
  clusters: TypographyCluster[];
  size: number;
}): TypographyCluster | undefined => {
  return clusters.find((cluster) => cluster.normalizedSize < size);
};

export const chooseHeadingTypographyClusters = ({
  clusters,
  bodySize
}: {
  clusters: TypographyCluster[];
  bodySize: number;
}): TypographyCluster[] => {
  const preferred = clusters.filter(
    (cluster) => cluster.normalizedSize > bodySize || cluster.headingWeight >= cluster.bodyWeight
  );
  const pool = preferred.length > 0 ? preferred : clusters;
  return [...pool]
    .sort((left, right) => {
      if (right.normalizedSize !== left.normalizedSize) {
        return right.normalizedSize - left.normalizedSize;
      }
      if (right.headingWeight !== left.headingWeight) {
        return right.headingWeight - left.headingWeight;
      }
      return right.totalWeight - left.totalWeight;
    })
    .slice(0, HEADING_TYPOGRAPHY_VARIANTS.length);
};

export type PartialTypographyScale = Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>>;

export interface DerivedTypographyClusterSelection {
  body1Cluster: TypographyCluster | undefined;
  body2Cluster: TypographyCluster | undefined;
  subtitle2Cluster: TypographyCluster | undefined;
  subtitle1Cluster: TypographyCluster | undefined;
  captionCluster: TypographyCluster | undefined;
  overlineCluster: TypographyCluster | undefined;
  buttonCluster: TypographyCluster | undefined;
  headingClusters: TypographyCluster[];
}

export const resolveClusterFallback = (
  ...clusters: Array<TypographyCluster | undefined>
): TypographyCluster | undefined => {
  return clusters.find((cluster): cluster is TypographyCluster => cluster !== undefined);
};

export const assignTypographyVariant = ({
  partialScale,
  variantName,
  cluster,
  fallbackFontFamily,
  textTransform,
  letterSpacingEm
}: {
  partialScale: PartialTypographyScale;
  variantName: DesignTokenTypographyVariantName;
  cluster: TypographyCluster | undefined;
  fallbackFontFamily: string;
  textTransform?: DesignTokenTypographyVariant["textTransform"];
  letterSpacingEm?: number;
}): void => {
  if (!cluster) {
    return;
  }
  partialScale[variantName] = toTypographyVariantFromCluster({
    cluster,
    fallbackFontFamily,
    ...(textTransform ? { textTransform } : {}),
    ...(typeof letterSpacingEm === "number" ? { letterSpacingEm } : {})
  });
};

export const mapHeadingVariants = ({
  partialScale,
  headingClusters,
  subtitle1Cluster,
  body1Cluster,
  fallbackFontFamily
}: {
  partialScale: PartialTypographyScale;
  headingClusters: TypographyCluster[];
  subtitle1Cluster: TypographyCluster | undefined;
  body1Cluster: TypographyCluster | undefined;
  fallbackFontFamily: string;
}): void => {
  let lastHeadingCluster = resolveClusterFallback(headingClusters[0], subtitle1Cluster, body1Cluster);
  for (const [index, variantName] of HEADING_TYPOGRAPHY_VARIANTS.entries()) {
    const cluster = resolveClusterFallback(headingClusters[index], lastHeadingCluster);
    if (!cluster) {
      continue;
    }
    assignTypographyVariant({
      partialScale,
      variantName,
      cluster,
      fallbackFontFamily
    });
    lastHeadingCluster = cluster;
  }
};

export const selectTypographyClustersForScale = ({
  clusters,
  bodySize
}: {
  clusters: TypographyCluster[];
  bodySize: number;
}): DerivedTypographyClusterSelection => {
  const body1Cluster = chooseBodyTypographyCluster(clusters);
  const body2Cluster = body1Cluster
    ? findNextSmallerTypographyCluster({ clusters, size: body1Cluster.normalizedSize }) ?? body1Cluster
    : undefined;
  const subtitle2Cluster = body1Cluster
    ? findNextLargerTypographyCluster({ clusters, size: body1Cluster.normalizedSize }) ?? body1Cluster
    : undefined;
  const subtitle1Cluster = subtitle2Cluster
    ? findNextLargerTypographyCluster({ clusters, size: subtitle2Cluster.normalizedSize }) ?? subtitle2Cluster
    : body1Cluster;
  const captionCluster = [...clusters].sort((left, right) => left.normalizedSize - right.normalizedSize)[0] ?? body2Cluster;
  const overlineCluster =
    [...clusters]
      .filter((cluster) => cluster.normalizedSize <= (captionCluster?.normalizedSize ?? Number.POSITIVE_INFINITY))
      .sort((left, right) => right.uppercaseWeight - left.uppercaseWeight || left.normalizedSize - right.normalizedSize)[0] ??
    captionCluster;
  const buttonCluster = chooseButtonTypographyCluster(clusters) ?? body2Cluster ?? subtitle2Cluster ?? body1Cluster;
  const headingClusters = chooseHeadingTypographyClusters({
    clusters,
    bodySize: body1Cluster?.normalizedSize ?? bodySize
  });

  return {
    body1Cluster,
    body2Cluster,
    subtitle2Cluster,
    subtitle1Cluster,
    captionCluster,
    overlineCluster,
    buttonCluster,
    headingClusters
  };
};

export const buildDerivedTypographyScale = ({
  clusters,
  figmaTextStyleEntries,
  fontFamily,
  headingSize,
  bodySize
}: {
  clusters: TypographyCluster[];
  figmaTextStyleEntries?: readonly FigmaTextStyleEntry[];
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}): DesignTokenTypographyScale => {
  const partialScale: PartialTypographyScale = {};
  const {
    body1Cluster,
    body2Cluster,
    subtitle2Cluster,
    subtitle1Cluster,
    captionCluster,
    overlineCluster,
    buttonCluster,
    headingClusters
  } = selectTypographyClustersForScale({
    clusters,
    bodySize
  });

  mapHeadingVariants({
    partialScale,
    headingClusters,
    subtitle1Cluster,
    body1Cluster,
    fallbackFontFamily: fontFamily
  });

  assignTypographyVariant({
    partialScale,
    variantName: "subtitle1",
    cluster: subtitle1Cluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "subtitle2",
    cluster: resolveClusterFallback(subtitle2Cluster, subtitle1Cluster, body1Cluster),
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "body1",
    cluster: body1Cluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "body2",
    cluster: resolveClusterFallback(body2Cluster, body1Cluster),
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "button",
    cluster: buttonCluster,
    fallbackFontFamily: fontFamily,
    textTransform: "none"
  });
  assignTypographyVariant({
    partialScale,
    variantName: "caption",
    cluster: captionCluster,
    fallbackFontFamily: fontFamily
  });
  assignTypographyVariant({
    partialScale,
    variantName: "overline",
    cluster: resolveClusterFallback(overlineCluster, captionCluster),
    fallbackFontFamily: fontFamily,
    letterSpacingEm: overlineCluster?.letterSpacingEm ?? 0.08
  });

  const figmaStyleOverrides =
    figmaTextStyleEntries && figmaTextStyleEntries.length > 0
      ? buildTypographyScaleFromFigmaStyles(figmaTextStyleEntries)
      : undefined;

  if (figmaStyleOverrides) {
    for (const [variantName, variant] of Object.entries(figmaStyleOverrides) as Array<
      [DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>]
    >) {
      partialScale[variantName] = {
        ...partialScale[variantName],
        ...variant
      };
    }
  }

  return completeTypographyScale({
    partialScale,
    fontFamily,
    headingSize,
    bodySize
  });
};

export const resolveDominantFont = (samples: FontSample[], role: "heading" | "body"): string | undefined => {
  const roleSamples = samples.filter((sample) => sample.role === role);
  const pool = roleSamples.length > 0 ? roleSamples : samples;
  const weights = new Map<string, number>();
  for (const sample of pool) {
    weights.set(sample.family, (weights.get(sample.family) ?? 0) + sample.weight);
  }
  return [...weights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};
