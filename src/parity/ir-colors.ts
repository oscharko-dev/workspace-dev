export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaPaint {
  type?: string;
  visible?: boolean;
  color?: FigmaColor;
  opacity?: number;
  gradientStops?: Array<{
    position?: number;
    color?: FigmaColor;
  }>;
  gradientHandlePositions?: Array<{
    x?: number;
    y?: number;
  }>;
}

export interface FigmaEffect {
  type?: string;
  visible?: boolean;
  color?: FigmaColor;
  radius?: number;
  offset?: {
    x?: number;
    y?: number;
  };
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const toHexColor = (color?: FigmaColor, opacity?: number): string | undefined => {
  if (!color) {
    return undefined;
  }

  const alpha = typeof opacity === "number" ? opacity : (color.a ?? 1);
  if (alpha <= 0) {
    return undefined;
  }

  const blendOnWhite = (channel: number): number => {
    if (alpha >= 1) {
      return channel;
    }
    return channel * alpha + (1 - alpha);
  };

  const toHex = (value: number): string => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(blendOnWhite(color.r))}${toHex(blendOnWhite(color.g))}${toHex(blendOnWhite(color.b))}`;
};

export const normalizePaintType = (value: string | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

export const resolveGradientPaintKind = (
  paintType: string | undefined
): "linear" | "radial" | "other" | undefined => {
  const normalized = normalizePaintType(paintType);
  if (!normalized.includes("GRADIENT")) {
    return undefined;
  }
  if (normalized.includes("LINEAR")) {
    return "linear";
  }
  if (normalized.includes("RADIAL")) {
    return "radial";
  }
  return "other";
};

export const resolveFirstVisibleSolidPaint = (paints: FigmaPaint[] | undefined): FigmaPaint | undefined => {
  return paints?.find((paint) => paint.visible !== false && normalizePaintType(paint.type) === "SOLID" && Boolean(paint.color));
};

export const resolveFirstVisibleGradientPaint = (paints: FigmaPaint[] | undefined): FigmaPaint | undefined => {
  return paints?.find((paint) => {
    if (paint.visible === false) {
      return false;
    }
    return resolveGradientPaintKind(paint.type) !== undefined;
  });
};

export const resolveFirstVisibleImagePaint = (paints: FigmaPaint[] | undefined): FigmaPaint | undefined => {
  return paints?.find((paint) => {
    return paint.visible !== false && normalizePaintType(paint.type) === "IMAGE";
  });
};

export const toCssNumber = (value: number, precision = 2): string => {
  const normalized = Number.isFinite(value) ? value : 0;
  const fixed = normalized.toFixed(precision).replace(/\.?0+$/, "");
  if (fixed === "-0") {
    return "0";
  }
  return fixed;
};

const toGradientStopCss = (paint: FigmaPaint): Array<{ position: number; color: string }> => {
  return (paint.gradientStops ?? [])
    .map((stop) => {
      if (typeof stop.position !== "number") {
        return undefined;
      }
      const color = toHexColor(stop.color, paint.opacity);
      if (!color) {
        return undefined;
      }
      return {
        position: clamp(stop.position, 0, 1),
        color
      };
    })
    .filter((stop): stop is { position: number; color: string } => Boolean(stop))
    .sort((left, right) => left.position - right.position);
};

const toLinearGradientAngle = (paint: FigmaPaint): number => {
  const first = paint.gradientHandlePositions?.[0];
  const second = paint.gradientHandlePositions?.[1];
  if (
    typeof first?.x !== "number" ||
    typeof first.y !== "number" ||
    typeof second?.x !== "number" ||
    typeof second.y !== "number"
  ) {
    return 180;
  }
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (dx === 0 && dy === 0) {
    return 180;
  }
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (degrees + 90 + 360) % 360;
};

export const toCssGradient = (paint: FigmaPaint | undefined): string | undefined => {
  if (!paint) {
    return undefined;
  }
  const kind = resolveGradientPaintKind(paint.type);
  if (!kind) {
    return undefined;
  }
  const stops = toGradientStopCss(paint);
  if (stops.length === 0) {
    return undefined;
  }
  const serializedStops = stops.map((stop) => `${stop.color} ${toCssNumber(stop.position * 100)}%`).join(", ");
  if (kind === "radial") {
    return `radial-gradient(circle, ${serializedStops})`;
  }
  const angle = kind === "linear" ? toLinearGradientAngle(paint) : 180;
  return `linear-gradient(${toCssNumber(angle)}deg, ${serializedStops})`;
};

export const normalizeEffectType = (value: string | undefined): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

export const resolveVisibleEffectsByType = (
  effects: FigmaEffect[] | undefined,
  effectType: "DROP_SHADOW" | "INNER_SHADOW"
): FigmaEffect[] => {
  return (effects ?? []).filter((effect) => effect.visible !== false && normalizeEffectType(effect.type) === effectType);
};

export const hasVisibleShadowEffect = (effects: FigmaEffect[] | undefined): boolean => {
  return resolveVisibleEffectsByType(effects, "DROP_SHADOW").length > 0 || resolveVisibleEffectsByType(effects, "INNER_SHADOW").length > 0;
};

export const toRgbaColor = (color: FigmaColor | undefined): string | undefined => {
  if (!color) {
    return undefined;
  }
  if (
    !Number.isFinite(color.r) ||
    !Number.isFinite(color.g) ||
    !Number.isFinite(color.b) ||
    (color.a !== undefined && !Number.isFinite(color.a))
  ) {
    return undefined;
  }
  const alpha = clamp(color.a ?? 1, 0, 1);
  if (alpha <= 0) {
    return undefined;
  }
  const red = clamp(Math.round(color.r * 255), 0, 255);
  const green = clamp(Math.round(color.g * 255), 0, 255);
  const blue = clamp(Math.round(color.b * 255), 0, 255);
  return `rgba(${red}, ${green}, ${blue}, ${toCssNumber(alpha, 3)})`;
};

const toDropShadowMagnitude = (effect: FigmaEffect): number | undefined => {
  if (!Number.isFinite(effect.radius)) {
    return undefined;
  }
  const radius = Math.max(0, effect.radius ?? 0);
  const offsetX = Number.isFinite(effect.offset?.x) ? (effect.offset?.x as number) : 0;
  const offsetY = Number.isFinite(effect.offset?.y) ? (effect.offset?.y as number) : 0;
  const offsetMagnitude = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
  return radius + 0.75 * offsetMagnitude;
};

const toLinearMappedRounded = ({
  value,
  sourceMin,
  sourceMax,
  targetMin,
  targetMax
}: {
  value: number;
  sourceMin: number;
  sourceMax: number;
  targetMin: number;
  targetMax: number;
}): number => {
  const normalizedValue = clamp(value, sourceMin, sourceMax);
  const ratio = sourceMax === sourceMin ? 0 : (normalizedValue - sourceMin) / (sourceMax - sourceMin);
  return Math.round(targetMin + ratio * (targetMax - targetMin));
};

const mapDropShadowMagnitudeToElevation = (magnitude: number): number => {
  if (!Number.isFinite(magnitude) || magnitude < 2) {
    return 0;
  }
  if (magnitude < 6) {
    return clamp(
      toLinearMappedRounded({
        value: magnitude,
        sourceMin: 2,
        sourceMax: 6,
        targetMin: 1,
        targetMax: 2
      }),
      1,
      2
    );
  }
  if (magnitude < 16) {
    return clamp(
      toLinearMappedRounded({
        value: magnitude,
        sourceMin: 6,
        sourceMax: 16,
        targetMin: 3,
        targetMax: 8
      }),
      3,
      8
    );
  }
  if (magnitude < 32) {
    return clamp(
      toLinearMappedRounded({
        value: magnitude,
        sourceMin: 16,
        sourceMax: 32,
        targetMin: 12,
        targetMax: 16
      }),
      12,
      16
    );
  }
  return clamp(
    toLinearMappedRounded({
      value: magnitude,
      sourceMin: 32,
      sourceMax: 64,
      targetMin: 20,
      targetMax: 24
    }),
    20,
    24
  );
};

export const resolveElevationFromEffects = (effects: FigmaEffect[] | undefined): number | undefined => {
  const dropShadows = resolveVisibleEffectsByType(effects, "DROP_SHADOW");
  if (dropShadows.length === 0) {
    return undefined;
  }
  let maxElevation = 0;
  let hasMagnitude = false;
  for (const effect of dropShadows) {
    const magnitude = toDropShadowMagnitude(effect);
    if (typeof magnitude !== "number" || !Number.isFinite(magnitude)) {
      continue;
    }
    hasMagnitude = true;
    maxElevation = Math.max(maxElevation, mapDropShadowMagnitudeToElevation(magnitude));
  }
  return hasMagnitude ? maxElevation : undefined;
};

const toInsetShadowToken = (effect: FigmaEffect): string | undefined => {
  const color = toRgbaColor(effect.color);
  if (!color || !Number.isFinite(effect.radius)) {
    return undefined;
  }
  const offsetX = Number.isFinite(effect.offset?.x) ? (effect.offset?.x as number) : 0;
  const offsetY = Number.isFinite(effect.offset?.y) ? (effect.offset?.y as number) : 0;
  const radius = Math.max(0, effect.radius ?? 0);
  return `inset ${toCssNumber(offsetX)}px ${toCssNumber(offsetY)}px ${toCssNumber(radius)}px ${color}`;
};

export const resolveInsetShadowFromEffects = (effects: FigmaEffect[] | undefined): string | undefined => {
  const tokens = resolveVisibleEffectsByType(effects, "INNER_SHADOW")
    .map((effect) => toInsetShadowToken(effect))
    .filter((value): value is string => Boolean(value));
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(", ");
};
