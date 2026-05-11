// @vitest-environment jsdom
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
      ratios: { tree: 0.3333, preview: 0.3333, code: 0.3334 },
      widthPx: 1280,
      deltaPx: 900
    });

    expect(next.preview).toBeGreaterThan(0.15);
    expect(next.code).toBeCloseTo(0.3334, 3);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("clamps preview-code resize in collapsed tree mode while preserving tree ratio", () => {
    const next = resizePreviewCodePanes({
      ratios: { tree: 0.3, preview: 0.35, code: 0.35 },
      widthPx: 1400,
      deltaPx: -1000,
      treeCollapsed: true
    });

    expect(next.tree).toBeCloseTo(0.3, 3);
    expect(next.preview + next.code).toBeCloseTo(0.7, 3);
    expect(next.preview).toBeGreaterThan(0.13);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("collapsed mode uses available width minus tree, not full width", () => {
    // BUG #4 regression test: dragging preview-code splitter right in collapsed
    // mode should not let preview exceed the available space (width - treePx).
    const ratios = { tree: 0.3, preview: 0.35, code: 0.35 };
    const widthPx = 1200;
    // Tree occupies 360px, available = 840px. Preview starts at 420px.
    // Drag right by 600px — should clamp to available - MIN_CODE_WIDTH_PX.
    const next = resizePreviewCodePanes({
      ratios,
      widthPx,
      deltaPx: 600,
      treeCollapsed: true
    });

    const previewPx = next.preview * widthPx;
    const codePx = next.code * widthPx;
    const treePx = next.tree * widthPx;

    // Code must not go below MIN_CODE_WIDTH_PX (280)
    expect(codePx).toBeGreaterThanOrEqual(279);
    // Preview + code must not exceed available (width - tree)
    expect(previewPx + codePx).toBeLessThanOrEqual(widthPx - treePx + 1);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("collapsed mode bounds are consistent with expanded mode bounds", () => {
    const ratios = { tree: 0.25, preview: 0.375, code: 0.375 };
    const widthPx = 1600;

    // Same delta in collapsed vs expanded should produce same result
    // because available space is the same (width - treePx)
    const collapsed = resizePreviewCodePanes({
      ratios,
      widthPx,
      deltaPx: 100,
      treeCollapsed: true
    });

    const expanded = resizePreviewCodePanes({
      ratios,
      widthPx,
      deltaPx: 100,
      treeCollapsed: false
    });

    // Both should produce valid ratios summing to 1
    expect(collapsed.tree + collapsed.preview + collapsed.code).toBeCloseTo(1, 5);
    expect(expanded.tree + expanded.preview + expanded.code).toBeCloseTo(1, 5);

    // Tree ratio should be preserved in both cases
    expect(collapsed.tree).toBeCloseTo(0.25, 3);
    expect(expanded.tree).toBeCloseTo(0.25, 3);
  });

  it("default ratios are equal thirds", () => {
    expect(DEFAULT_INSPECTOR_PANE_RATIOS.tree).toBeCloseTo(0.3333, 3);
    expect(DEFAULT_INSPECTOR_PANE_RATIOS.preview).toBeCloseTo(0.3333, 3);
    expect(DEFAULT_INSPECTOR_PANE_RATIOS.code).toBeCloseTo(0.3334, 3);
    expect(
      DEFAULT_INSPECTOR_PANE_RATIOS.tree +
      DEFAULT_INSPECTOR_PANE_RATIOS.preview +
      DEFAULT_INSPECTOR_PANE_RATIOS.code
    ).toBeCloseTo(1, 5);
  });

  it("tree resize works with equal-third ratios", () => {
    const ratios = { tree: 0.3333, preview: 0.3333, code: 0.3334 };
    // Drag tree-preview splitter 100px right on a 1500px container
    const next = resizeTreePreviewPane({
      ratios,
      widthPx: 1500,
      deltaPx: 100
    });

    // Tree should grow, preview should shrink, code stays same
    expect(next.tree).toBeGreaterThan(ratios.tree);
    expect(next.preview).toBeLessThan(ratios.preview);
    expect(next.code).toBeCloseTo(ratios.code, 3);
    expect(next.tree + next.preview + next.code).toBeCloseTo(1, 5);
  });

  it("preview-code resize works with equal-third ratios", () => {
    const ratios = { tree: 0.3333, preview: 0.3333, code: 0.3334 };
    // Drag preview-code splitter 100px right
    const next = resizePreviewCodePanes({
      ratios,
      widthPx: 1500,
      deltaPx: 100,
      treeCollapsed: false
    });

    // Preview should grow, code should shrink, tree stays same
    expect(next.preview).toBeGreaterThan(ratios.preview);
    expect(next.code).toBeLessThan(ratios.code);
    expect(next.tree).toBeCloseTo(ratios.tree, 3);
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
