import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INSPECTOR_PANE_RATIOS,
  loadInspectorPaneRatios,
  resizePreviewCodePanes,
  resizeTreePreviewPane,
  saveInspectorPaneRatios,
  toInspectorLayoutStorageKey
} from "./layout-state";

describe("layout-state", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("clamps tree resize so preview and code remain within minimum width", () => {
    const next = resizeTreePreviewPane({
      ratios: { tree: 0.24, preview: 0.38, code: 0.38 },
      widthPx: 1280,
      deltaPx: 900
    });

    expect(next.tree).toBeLessThan(0.34);
    expect(next.preview).toBeGreaterThan(0.21);
    expect(next.code).toBeCloseTo(0.38, 4);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("clamps preview-code resize in collapsed tree mode while preserving tree ratio", () => {
    const next = resizePreviewCodePanes({
      ratios: { tree: 0.3, preview: 0.35, code: 0.35 },
      widthPx: 1400,
      deltaPx: -1000,
      treeCollapsed: true
    });

    expect(next.tree).toBeCloseTo(0.3, 5);
    expect(next.preview + next.code).toBeCloseTo(0.7, 5);
    expect(next.preview).toBeGreaterThan(0.13);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("saves and reloads valid ratios from localStorage", () => {
    const key = toInspectorLayoutStorageKey("job-123");
    const value = { tree: 0.2, preview: 0.45, code: 0.35 };

    saveInspectorPaneRatios({ storageKey: key, ratios: value });
    const loaded = loadInspectorPaneRatios(key);

    expect(loaded).not.toBeNull();
    expect(loaded?.tree).toBeCloseTo(0.2, 5);
    expect(loaded?.preview).toBeCloseTo(0.45, 5);
    expect(loaded?.code).toBeCloseTo(0.35, 5);
  });

  it("rejects malformed stored ratios and falls back to default in callers", () => {
    const key = toInspectorLayoutStorageKey("job-invalid");
    window.localStorage.setItem(key, JSON.stringify({ tree: 5, preview: 2, code: -1 }));

    const loaded = loadInspectorPaneRatios(key);
    expect(loaded).toBeNull();
    expect(DEFAULT_INSPECTOR_PANE_RATIOS.tree + DEFAULT_INSPECTOR_PANE_RATIOS.preview + DEFAULT_INSPECTOR_PANE_RATIOS.code).toBeCloseTo(1, 5);
  });
});
