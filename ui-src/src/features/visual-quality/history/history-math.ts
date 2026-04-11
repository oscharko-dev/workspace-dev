import { type HistoryRuns } from "../data/types";

export interface ChartPoint {
  runAt: string;
  score: number;
  x: number;
  y: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  points: ChartPoint[];
}

export interface ChartGeometry {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  minScore: number;
  maxScore: number;
}

export const DEFAULT_GEOMETRY: ChartGeometry = {
  width: 320,
  height: 120,
  paddingLeft: 32,
  paddingRight: 8,
  paddingTop: 8,
  paddingBottom: 20,
  minScore: 0,
  maxScore: 100,
};

/**
 * Projects a score in [minScore, maxScore] onto the chart's plotting area.
 */
export function projectY(score: number, geometry: ChartGeometry): number {
  const { height, paddingTop, paddingBottom, minScore, maxScore } = geometry;
  const range = maxScore - minScore;
  if (range <= 0) {
    return paddingTop;
  }
  const clamped = Math.max(minScore, Math.min(maxScore, score));
  const ratio = (clamped - minScore) / range;
  const plotHeight = height - paddingTop - paddingBottom;
  return paddingTop + (1 - ratio) * plotHeight;
}

/**
 * Projects an index in [0, count-1] onto the chart's plotting area. When
 * there is a single point, it is centered horizontally.
 */
export function projectX(
  index: number,
  count: number,
  geometry: ChartGeometry,
): number {
  const { width, paddingLeft, paddingRight } = geometry;
  const plotWidth = width - paddingLeft - paddingRight;
  if (count <= 1) {
    return paddingLeft + plotWidth / 2;
  }
  return paddingLeft + (index / (count - 1)) * plotWidth;
}

/**
 * Builds a single "overall score" series from a history log. Entries missing
 * an `overallScore` are skipped silently. Only the most recent `maxEntries`
 * runs are included (default 20).
 */
export function buildOverallSeries(
  history: HistoryRuns,
  maxEntries = 20,
  geometry: ChartGeometry = DEFAULT_GEOMETRY,
): ChartSeries {
  const sorted = [...history.entries].sort((a, b) =>
    a.runAt.localeCompare(b.runAt),
  );
  const trimmed = sorted.slice(-maxEntries);
  const valid = trimmed.filter(
    (entry): entry is typeof entry & { overallScore: number } =>
      typeof entry.overallScore === "number",
  );
  const points: ChartPoint[] = valid.map((entry, index) => ({
    runAt: entry.runAt,
    score: entry.overallScore,
    x: projectX(index, valid.length, geometry),
    y: projectY(entry.overallScore, geometry),
  }));
  return { id: "overall", label: "Overall score", points };
}

/**
 * Builds a line path (`M x0,y0 L x1,y1 …`) from a list of points. Returns
 * an empty string when there are no points. For a single point the caller
 * should render a dot instead.
 */
export function pointsToPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/**
 * Returns evenly-spaced horizontal gridlines at the score levels specified
 * by `levels` (default 25 / 50 / 75 / 100).
 */
export function buildGridlines(
  geometry: ChartGeometry = DEFAULT_GEOMETRY,
  levels: number[] = [25, 50, 75, 100],
): { score: number; y: number }[] {
  return levels.map((level) => ({
    score: level,
    y: projectY(level, geometry),
  }));
}

/**
 * Picks a handful of evenly-spaced points to label on the X axis so the
 * axis doesn't get crowded. Always includes the first and last.
 */
export function pickAxisLabels<T>(
  items: T[],
  maxLabels = 5,
): { index: number; item: T }[] {
  if (items.length === 0) {
    return [];
  }
  if (items.length <= maxLabels) {
    return items.map((item, index) => ({ index, item }));
  }
  const step = (items.length - 1) / (maxLabels - 1);
  const picked: { index: number; item: T }[] = [];
  for (let i = 0; i < maxLabels; i += 1) {
    const index = Math.round(i * step);
    const item = items[index];
    if (item !== undefined) {
      picked.push({ index, item });
    }
  }
  return picked;
}
