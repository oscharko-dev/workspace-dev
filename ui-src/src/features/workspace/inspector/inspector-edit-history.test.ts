import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  clearEditHistory,
  createEditHistory,
  currentEditHistoryDraft,
  pushEditHistory,
  redoDepth,
  redoEditHistory,
  undoDepth,
  undoEditHistory,
  DEFAULT_MAX_EDIT_HISTORY
} from "./inspector-edit-history";
import { createInspectorOverrideDraft, upsertInspectorOverrideEntry } from "./inspector-override-draft";

function makeDraft(id: string) {
  return createInspectorOverrideDraft({
    sourceJobId: `job-${id}`,
    baseFingerprint: `fp-${id}`
  });
}

function makeDraftWithEntry(id: string, fillColor: string) {
  const draft = makeDraft(id);
  return upsertInspectorOverrideEntry({
    draft,
    nodeId: "node-1",
    field: "fillColor",
    value: fillColor
  });
}

describe("createEditHistory", () => {
  it("creates empty history with defaults", () => {
    const history = createEditHistory();
    expect(history.stack).toHaveLength(0);
    expect(history.cursor).toBe(-1);
    expect(history.maxEntries).toBe(DEFAULT_MAX_EDIT_HISTORY);
  });

  it("creates history with initial draft", () => {
    const draft = makeDraft("1");
    const history = createEditHistory({ initialDraft: draft });
    expect(history.stack).toHaveLength(1);
    expect(history.cursor).toBe(0);
    expect(currentEditHistoryDraft(history)).toBe(draft);
  });

  it("accepts custom maxEntries", () => {
    const history = createEditHistory({ maxEntries: 10 });
    expect(history.maxEntries).toBe(10);
  });

  it("throws on maxEntries < 1", () => {
    expect(() => createEditHistory({ maxEntries: 0 })).toThrow(RangeError);
  });
});

describe("pushEditHistory", () => {
  it("pushes drafts sequentially", () => {
    let history = createEditHistory();
    const d1 = makeDraft("1");
    const d2 = makeDraft("2");

    history = pushEditHistory(history, d1);
    expect(history.stack).toHaveLength(1);
    expect(history.cursor).toBe(0);

    history = pushEditHistory(history, d2);
    expect(history.stack).toHaveLength(2);
    expect(history.cursor).toBe(1);
  });

  it("truncates forward entries when pushing after undo", () => {
    const d1 = makeDraft("1");
    const d2 = makeDraft("2");
    const d3 = makeDraft("3");
    const d4 = makeDraft("4");

    let history = createEditHistory();
    history = pushEditHistory(history, d1);
    history = pushEditHistory(history, d2);
    history = pushEditHistory(history, d3);

    // Undo twice (cursor at d1)
    const undo1 = undoEditHistory(history);
    const undo2 = undoEditHistory(undo1.history);
    history = undo2.history;

    expect(history.cursor).toBe(0);

    // Push new draft — d2 and d3 should be gone
    history = pushEditHistory(history, d4);
    expect(history.stack).toHaveLength(2);
    expect(history.cursor).toBe(1);
    expect(currentEditHistoryDraft(history)?.sourceJobId).toBe("job-4");
  });

  it("evicts oldest entry when exceeding maxEntries", () => {
    let history = createEditHistory({ maxEntries: 3 });

    history = pushEditHistory(history, makeDraft("1"));
    history = pushEditHistory(history, makeDraft("2"));
    history = pushEditHistory(history, makeDraft("3"));
    expect(history.stack).toHaveLength(3);

    history = pushEditHistory(history, makeDraft("4"));
    expect(history.stack).toHaveLength(3);
    // Oldest (1) evicted — stack is [2, 3, 4]
    expect(history.stack[0]?.sourceJobId).toBe("job-2");
    expect(history.cursor).toBe(2);
  });
});

describe("undoEditHistory", () => {
  it("returns null when stack is empty", () => {
    const history = createEditHistory();
    const result = undoEditHistory(history);
    expect(result.draft).toBeNull();
    expect(result.history.cursor).toBe(-1);
  });

  it("returns null when at first entry", () => {
    const history = createEditHistory({ initialDraft: makeDraft("1") });
    const result = undoEditHistory(history);
    expect(result.draft).toBeNull();
  });

  it("undoes to previous draft", () => {
    const d1 = makeDraftWithEntry("1", "#111111");
    const d2 = makeDraftWithEntry("2", "#222222");

    let history = createEditHistory();
    history = pushEditHistory(history, d1);
    history = pushEditHistory(history, d2);

    const result = undoEditHistory(history);
    expect(result.draft?.sourceJobId).toBe("job-1");
    expect(result.history.cursor).toBe(0);
  });
});

describe("redoEditHistory", () => {
  it("returns null when at tip", () => {
    const history = createEditHistory({ initialDraft: makeDraft("1") });
    const result = redoEditHistory(history);
    expect(result.draft).toBeNull();
  });

  it("redoes to next draft", () => {
    const d1 = makeDraft("1");
    const d2 = makeDraft("2");

    let history = createEditHistory();
    history = pushEditHistory(history, d1);
    history = pushEditHistory(history, d2);

    const undone = undoEditHistory(history);
    const redone = redoEditHistory(undone.history);
    expect(redone.draft?.sourceJobId).toBe("job-2");
    expect(redone.history.cursor).toBe(1);
  });
});

describe("clearEditHistory", () => {
  it("empties the history", () => {
    let history = createEditHistory();
    history = pushEditHistory(history, makeDraft("1"));
    history = pushEditHistory(history, makeDraft("2"));

    const cleared = clearEditHistory(history);
    expect(cleared.stack).toHaveLength(0);
    expect(cleared.cursor).toBe(-1);
    expect(cleared.maxEntries).toBe(history.maxEntries);
  });

  it("seeds with new initial draft", () => {
    let history = createEditHistory();
    history = pushEditHistory(history, makeDraft("1"));

    const seed = makeDraft("seed");
    const cleared = clearEditHistory(history, seed);
    expect(cleared.stack).toHaveLength(1);
    expect(cleared.cursor).toBe(0);
    expect(currentEditHistoryDraft(cleared)?.sourceJobId).toBe("job-seed");
  });
});

describe("selectors", () => {
  it("canUndo / canRedo reflect state", () => {
    let history = createEditHistory();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);

    history = pushEditHistory(history, makeDraft("1"));
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);

    history = pushEditHistory(history, makeDraft("2"));
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    const undone = undoEditHistory(history);
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);
  });

  it("undoDepth / redoDepth return correct values", () => {
    let history = createEditHistory();
    history = pushEditHistory(history, makeDraft("1"));
    history = pushEditHistory(history, makeDraft("2"));
    history = pushEditHistory(history, makeDraft("3"));

    expect(undoDepth(history)).toBe(2);
    expect(redoDepth(history)).toBe(0);

    const u1 = undoEditHistory(history);
    expect(undoDepth(u1.history)).toBe(1);
    expect(redoDepth(u1.history)).toBe(1);
  });

  it("currentEditHistoryDraft returns null for empty stack", () => {
    const history = createEditHistory();
    expect(currentEditHistoryDraft(history)).toBeNull();
  });
});

describe("stack bounds stress test", () => {
  it("maintains maxEntries bound under heavy push load", () => {
    const max = 5;
    let history = createEditHistory({ maxEntries: max });

    for (let i = 0; i < 100; i += 1) {
      history = pushEditHistory(history, makeDraft(String(i)));
    }

    expect(history.stack.length).toBeLessThanOrEqual(max);
    expect(history.cursor).toBe(max - 1);
    // Latest draft should be the last pushed
    expect(currentEditHistoryDraft(history)?.sourceJobId).toBe("job-99");
  });
});
