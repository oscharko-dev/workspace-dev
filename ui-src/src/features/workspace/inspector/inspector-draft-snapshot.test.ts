import { describe, expect, it } from "vitest";
import {
  clearDraftSnapshots,
  createDraftSnapshot,
  createDraftSnapshotStore,
  deleteDraftSnapshot,
  getDraftSnapshot,
  isSnapshotStoreFull,
  listDraftSnapshots,
  MAX_DRAFT_SNAPSHOTS,
  restoreDraftSnapshot,
  snapshotCount
} from "./inspector-draft-snapshot";
import {
  createInspectorOverrideDraft,
  upsertInspectorOverrideEntry
} from "./inspector-override-draft";

function makeDraft(id: string) {
  return createInspectorOverrideDraft({
    sourceJobId: `job-${id}`,
    baseFingerprint: `fp-${id}`
  });
}

function makeDraftWithEntry(id: string, color: string) {
  const draft = makeDraft(id);
  return upsertInspectorOverrideEntry({
    draft,
    nodeId: "node-1",
    field: "fillColor",
    value: color
  });
}

describe("createDraftSnapshotStore", () => {
  it("creates empty store with defaults", () => {
    const store = createDraftSnapshotStore();
    expect(store.snapshots).toHaveLength(0);
    expect(store.maxSnapshots).toBe(MAX_DRAFT_SNAPSHOTS);
  });

  it("accepts custom maxSnapshots", () => {
    const store = createDraftSnapshotStore({ maxSnapshots: 5 });
    expect(store.maxSnapshots).toBe(5);
  });

  it("throws on maxSnapshots < 1", () => {
    expect(() => createDraftSnapshotStore({ maxSnapshots: 0 })).toThrow(RangeError);
  });
});

describe("createDraftSnapshot", () => {
  it("creates a labelled snapshot", () => {
    const store = createDraftSnapshotStore();
    const draft = makeDraftWithEntry("1", "#aabbcc");

    const result = createDraftSnapshot(store, draft, "My checkpoint");
    expect(result.snapshot.label).toBe("My checkpoint");
    expect(result.snapshot.id).toMatch(/^snap-/);
    expect(result.snapshot.draft.sourceJobId).toBe("job-1");
    expect(result.store.snapshots).toHaveLength(1);
  });

  it("auto-labels when no label provided", () => {
    const store = createDraftSnapshotStore();
    const draft = makeDraft("1");

    const r1 = createDraftSnapshot(store, draft);
    expect(r1.snapshot.label).toBe("Checkpoint 1");

    const r2 = createDraftSnapshot(r1.store, draft);
    expect(r2.snapshot.label).toBe("Checkpoint 2");
  });

  it("deep-copies the draft (mutation safety)", () => {
    const store = createDraftSnapshotStore();
    const draft = makeDraftWithEntry("1", "#111111");

    const result = createDraftSnapshot(store, draft);
    // Mutating the original draft should not affect the snapshot
    const mutated = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-1",
      field: "fillColor",
      value: "#999999"
    });

    const snapshotEntry = result.snapshot.draft.entries[0];
    expect(snapshotEntry?.value).toBe("#111111");
    // Confirm the mutation worked on original
    expect(mutated.entries[0]?.value).toBe("#999999");
  });

  it("evicts oldest snapshot when at capacity", () => {
    let store = createDraftSnapshotStore({ maxSnapshots: 3 });

    const r1 = createDraftSnapshot(store, makeDraft("1"), "First");
    store = r1.store;

    const r2 = createDraftSnapshot(store, makeDraft("2"), "Second");
    store = r2.store;

    const r3 = createDraftSnapshot(store, makeDraft("3"), "Third");
    store = r3.store;
    expect(store.snapshots).toHaveLength(3);

    const r4 = createDraftSnapshot(store, makeDraft("4"), "Fourth");
    store = r4.store;
    expect(store.snapshots).toHaveLength(3);
    // "First" should be evicted
    expect(store.snapshots[0]?.label).toBe("Second");
  });
});

describe("restoreDraftSnapshot", () => {
  it("restores draft from snapshot", () => {
    let store = createDraftSnapshotStore();
    const draft = makeDraftWithEntry("1", "#112233");

    const { store: s1, snapshot } = createDraftSnapshot(store, draft, "Save");
    store = s1;

    const result = restoreDraftSnapshot(store, snapshot.id);
    expect(result.draft).not.toBeNull();
    expect(result.draft?.sourceJobId).toBe("job-1");
    expect(result.draft?.entries[0]?.value).toBe("#112233");
  });

  it("returns null for unknown snapshot id", () => {
    const store = createDraftSnapshotStore();
    const result = restoreDraftSnapshot(store, "snap-nonexistent");
    expect(result.draft).toBeNull();
  });

  it("restored draft is a deep copy", () => {
    let store = createDraftSnapshotStore();
    const draft = makeDraftWithEntry("1", "#aabbcc");

    const { store: s1, snapshot } = createDraftSnapshot(store, draft);
    store = s1;

    const r1 = restoreDraftSnapshot(store, snapshot.id);
    const r2 = restoreDraftSnapshot(store, snapshot.id);
    // Two restores should be independent objects
    expect(r1.draft).not.toBe(r2.draft);
    expect(r1.draft?.entries).not.toBe(r2.draft?.entries);
  });
});

describe("deleteDraftSnapshot", () => {
  it("removes a snapshot by id", () => {
    let store = createDraftSnapshotStore();
    const { store: s1, snapshot } = createDraftSnapshot(store, makeDraft("1"));
    store = s1;
    createDraftSnapshot(store, makeDraft("2"));

    const result = deleteDraftSnapshot(store, snapshot.id);
    expect(result.snapshots).toHaveLength(0);
  });

  it("is a no-op for unknown id", () => {
    let store = createDraftSnapshotStore();
    const { store: s1 } = createDraftSnapshot(store, makeDraft("1"));
    store = s1;

    const result = deleteDraftSnapshot(store, "snap-unknown");
    expect(result).toBe(store);
  });
});

describe("clearDraftSnapshots", () => {
  it("removes all snapshots", () => {
    let store = createDraftSnapshotStore();
    const { store: s1 } = createDraftSnapshot(store, makeDraft("1"));
    const { store: s2 } = createDraftSnapshot(s1, makeDraft("2"));
    store = s2;

    const cleared = clearDraftSnapshots(store);
    expect(cleared.snapshots).toHaveLength(0);
    expect(cleared.maxSnapshots).toBe(store.maxSnapshots);
  });

  it("is a no-op when already empty", () => {
    const store = createDraftSnapshotStore();
    const result = clearDraftSnapshots(store);
    expect(result).toBe(store);
  });
});

describe("selectors", () => {
  it("listDraftSnapshots returns ordered list", () => {
    let store = createDraftSnapshotStore();
    const { store: s1 } = createDraftSnapshot(store, makeDraft("1"), "A");
    const { store: s2 } = createDraftSnapshot(s1, makeDraft("2"), "B");
    store = s2;

    const list = listDraftSnapshots(store);
    expect(list).toHaveLength(2);
    expect(list[0]?.label).toBe("A");
    expect(list[1]?.label).toBe("B");
  });

  it("getDraftSnapshot returns by id", () => {
    let store = createDraftSnapshotStore();
    const { store: s1, snapshot } = createDraftSnapshot(store, makeDraft("1"), "Target");
    store = s1;

    expect(getDraftSnapshot(store, snapshot.id)?.label).toBe("Target");
    expect(getDraftSnapshot(store, "snap-nope")).toBeNull();
  });

  it("snapshotCount returns correct count", () => {
    let store = createDraftSnapshotStore();
    expect(snapshotCount(store)).toBe(0);

    const { store: s1 } = createDraftSnapshot(store, makeDraft("1"));
    store = s1;
    expect(snapshotCount(store)).toBe(1);
  });

  it("isSnapshotStoreFull detects capacity", () => {
    let store = createDraftSnapshotStore({ maxSnapshots: 2 });
    expect(isSnapshotStoreFull(store)).toBe(false);

    const { store: s1 } = createDraftSnapshot(store, makeDraft("1"));
    store = s1;
    expect(isSnapshotStoreFull(store)).toBe(false);

    const { store: s2 } = createDraftSnapshot(store, makeDraft("2"));
    store = s2;
    expect(isSnapshotStoreFull(store)).toBe(true);
  });
});

describe("snapshot bounds stress test", () => {
  it("maintains maxSnapshots bound under heavy creation", () => {
    const max = 5;
    let store = createDraftSnapshotStore({ maxSnapshots: max });

    for (let i = 0; i < 50; i += 1) {
      const { store: next } = createDraftSnapshot(store, makeDraft(String(i)));
      store = next;
    }

    expect(store.snapshots.length).toBeLessThanOrEqual(max);
    // Latest snapshot should be from the last creation
    const last = store.snapshots[store.snapshots.length - 1];
    expect(last?.draft.sourceJobId).toBe("job-49");
  });
});
