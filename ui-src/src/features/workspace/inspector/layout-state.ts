export interface InspectorPaneRatios {
  tree: number;
  preview: number;
  code: number;
}

export const INSPECTOR_LAYOUT_STORAGE_VERSION = 1;
export const MIN_TREE_WIDTH_PX = 180;
export const MAX_TREE_WIDTH_PX = 9999;
export const MIN_PREVIEW_WIDTH_PX = 280;
export const MIN_CODE_WIDTH_PX = 280;

export const DEFAULT_INSPECTOR_PANE_RATIOS: InspectorPaneRatios = {
  tree: 0.3333,
  preview: 0.3333,
  code: 0.3334
};

const EPSILON = 0.0001;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeRatios(ratios: InspectorPaneRatios): InspectorPaneRatios {
  const sum = ratios.tree + ratios.preview + ratios.code;
  if (!Number.isFinite(sum) || sum <= EPSILON) {
    return { ...DEFAULT_INSPECTOR_PANE_RATIOS };
  }
  return {
    tree: ratios.tree / sum,
    preview: ratios.preview / sum,
    code: ratios.code / sum
  };
}

export function toInspectorLayoutStorageKey(jobId: string): string {
  return `workspace-dev:inspector-layout:v${String(INSPECTOR_LAYOUT_STORAGE_VERSION)}:${jobId}`;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isValidInspectorPaneRatios(value: unknown): value is InspectorPaneRatios {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const rec = value as Record<string, unknown>;
  if (!isFinitePositive(rec.tree) || !isFinitePositive(rec.preview) || !isFinitePositive(rec.code)) {
    return false;
  }

  const sum = rec.tree + rec.preview + rec.code;
  return Math.abs(sum - 1) <= 0.02;
}

export function loadInspectorPaneRatios(storageKey: string): InspectorPaneRatios | null {
  if (typeof window === "undefined") {
    return null;
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isValidInspectorPaneRatios(parsed)) {
    return null;
  }

  return normalizeRatios(parsed);
}

export function saveInspectorPaneRatios({ storageKey, ratios }: { storageKey: string; ratios: InspectorPaneRatios }): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeRatios(ratios)));
  } catch {
    // Best-effort persistence only.
  }
}

function resolveLeftBounds({
  availablePx,
  minLeftPx,
  minRightPx
}: {
  availablePx: number;
  minLeftPx: number;
  minRightPx: number;
}): { minLeft: number; maxLeft: number } {
  const available = Math.max(0, availablePx);
  const idealMinLeft = Math.max(0, minLeftPx);
  const idealMinRight = Math.max(0, minRightPx);
  const idealMaxLeft = Math.max(0, available - idealMinRight);

  if (idealMaxLeft >= idealMinLeft) {
    return {
      minLeft: idealMinLeft,
      maxLeft: idealMaxLeft
    };
  }

  const midpoint = available / 2;
  return {
    minLeft: midpoint,
    maxLeft: midpoint
  };
}

export function getContainerWidthPx(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return 1200;
  }
  return value;
}

export function resizeTreePreviewPane({
  ratios,
  widthPx,
  deltaPx
}: {
  ratios: InspectorPaneRatios;
  widthPx: number;
  deltaPx: number;
}): InspectorPaneRatios {
  const width = getContainerWidthPx(widthPx);
  const treePx = ratios.tree * width;
  const codePx = ratios.code * width;
  const availableForTreePreview = width - codePx;

  const treeMaxPx = Math.min(MAX_TREE_WIDTH_PX, availableForTreePreview - MIN_PREVIEW_WIDTH_PX);
  const treeMinPx = Math.min(MIN_TREE_WIDTH_PX, treeMaxPx);

  if (treeMaxPx <= 0) {
    return { ...ratios };
  }

  const nextTreePx = clamp(treePx + deltaPx, Math.max(0, treeMinPx), Math.max(0, treeMaxPx));
  const nextPreviewPx = width - nextTreePx - codePx;

  return normalizeRatios({
    tree: nextTreePx / width,
    preview: nextPreviewPx / width,
    code: codePx / width
  });
}

export function resizePreviewCodePanes({
  ratios,
  widthPx,
  deltaPx,
  treeCollapsed
}: {
  ratios: InspectorPaneRatios;
  widthPx: number;
  deltaPx: number;
  treeCollapsed: boolean;
}): InspectorPaneRatios {
  const width = getContainerWidthPx(widthPx);
  const treePx = ratios.tree * width;

  if (treeCollapsed) {
    const shareTotal = ratios.preview + ratios.code;
    const previewShare = shareTotal > EPSILON ? ratios.preview / shareTotal : 0.5;
    const currentPreviewPx = previewShare * width;

    const bounds = resolveLeftBounds({
      availablePx: width,
      minLeftPx: MIN_PREVIEW_WIDTH_PX,
      minRightPx: MIN_CODE_WIDTH_PX
    });
    const nextPreviewPx = clamp(currentPreviewPx + deltaPx, bounds.minLeft, bounds.maxLeft);
    const nextPreviewShare = width > EPSILON ? nextPreviewPx / width : 0.5;

    const remainingRatio = Math.max(EPSILON, 1 - ratios.tree);

    return normalizeRatios({
      tree: ratios.tree,
      preview: nextPreviewShare * remainingRatio,
      code: (1 - nextPreviewShare) * remainingRatio
    });
  }

  const availablePx = Math.max(0, width - treePx);
  const currentPreviewPx = ratios.preview * width;

  const bounds = resolveLeftBounds({
    availablePx,
    minLeftPx: MIN_PREVIEW_WIDTH_PX,
    minRightPx: MIN_CODE_WIDTH_PX
  });
  const nextPreviewPx = clamp(currentPreviewPx + deltaPx, bounds.minLeft, bounds.maxLeft);
  const nextCodePx = Math.max(0, availablePx - nextPreviewPx);

  return normalizeRatios({
    tree: treePx / width,
    preview: nextPreviewPx / width,
    code: nextCodePx / width
  });
}
