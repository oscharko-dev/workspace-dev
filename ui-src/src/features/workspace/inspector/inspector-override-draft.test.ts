import { describe, expect, it, vi } from "vitest";
import {
  computeInspectorDraftBaseFingerprint,
  createInspectorOverrideDraft,
  getInspectorOverrideValue,
  persistInspectorOverrideDraft,
  removeInspectorOverrideEntry,
  restorePersistedInspectorOverrideDraft,
  toInspectorOverrideDraftStorageKey,
  toStructuredInspectorOverridePayload,
  upsertInspectorOverrideEntry
} from "./inspector-override-draft";

describe("computeInspectorDraftBaseFingerprint", () => {
  it("is deterministic and key-order independent", () => {
    const left = {
      screens: [{ id: "screen-a", values: { fillColor: "#ffffff", gap: 16 } }],
      manifest: { file: "src/screens/A.tsx", mapped: true }
    };

    const right = {
      manifest: { mapped: true, file: "src/screens/A.tsx" },
      screens: [{ values: { gap: 16, fillColor: "#ffffff" }, id: "screen-a" }]
    };

    const fingerprintA = computeInspectorDraftBaseFingerprint(left);
    const fingerprintB = computeInspectorDraftBaseFingerprint(right);

    expect(fingerprintA).toEqual(fingerprintB);
    expect(fingerprintA).toMatch(/^fnv1a64:[a-f0-9]{16}$/);
  });

  it("changes when source content changes", () => {
    const base = computeInspectorDraftBaseFingerprint({ value: "a" });
    const changed = computeInspectorDraftBaseFingerprint({ value: "b" });

    expect(base).not.toEqual(changed);
  });
});

describe("inspector override draft lifecycle", () => {
  it("creates, upserts, and removes entries deterministically", () => {
    const draft = createInspectorOverrideDraft({
      sourceJobId: "job-123",
      baseFingerprint: "fingerprint-1"
    });

    const withFill = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-1",
      field: "fillColor",
      value: "#112233"
    });

    const withOpacity = upsertInspectorOverrideEntry({
      draft: withFill,
      nodeId: "node-1",
      field: "opacity",
      value: 0.8
    });

    const overwrittenFill = upsertInspectorOverrideEntry({
      draft: withOpacity,
      nodeId: "node-1",
      field: "fillColor",
      value: "#445566"
    });

    expect(overwrittenFill.entries).toHaveLength(2);
    expect(getInspectorOverrideValue({
      draft: overwrittenFill,
      nodeId: "node-1",
      field: "fillColor"
    })).toBe("#445566");

    const removed = removeInspectorOverrideEntry({
      draft: overwrittenFill,
      nodeId: "node-1",
      field: "opacity"
    });

    expect(removed.entries).toHaveLength(1);
    expect(getInspectorOverrideValue({
      draft: removed,
      nodeId: "node-1",
      field: "opacity"
    })).toBeNull();
  });

  it("emits structured payload with canonical ordering", () => {
    let draft = createInspectorOverrideDraft({
      sourceJobId: "job-abc",
      baseFingerprint: "fp"
    });

    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-b",
      field: "gap",
      value: 20
    });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-a",
      field: "fillColor",
      value: "#000000"
    });

    const payload = toStructuredInspectorOverridePayload(draft);
    expect(payload.overrides).toEqual([
      {
        nodeId: "node-a",
        field: "fillColor",
        value: "#000000"
      },
      {
        nodeId: "node-b",
        field: "gap",
        value: 20
      }
    ]);
  });
});

describe("draft persistence", () => {
  it("persists and restores a draft for a job", () => {
    const baseFingerprint = computeInspectorDraftBaseFingerprint({ screens: [{ id: "screen-1" }] });
    const jobId = "job-persist";
    let draft = createInspectorOverrideDraft({ sourceJobId: jobId, baseFingerprint });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-1",
      field: "fontFamily",
      value: "Inter"
    });

    const persisted = persistInspectorOverrideDraft({ jobId, draft });
    expect(persisted.ok).toBe(true);

    const restored = restorePersistedInspectorOverrideDraft({
      jobId,
      currentBaseFingerprint: baseFingerprint
    });

    expect(restored.stale).toBe(false);
    expect(restored.warning).toBeNull();
    expect(restored.draft?.entries).toHaveLength(1);
    expect(restored.draft?.entries[0]?.field).toBe("fontFamily");
  });

  it("marks restored drafts stale on fingerprint mismatch", () => {
    const jobId = "job-stale";
    const originalFingerprint = "fnv1a64:aaaa";
    const currentFingerprint = "fnv1a64:bbbb";

    let draft = createInspectorOverrideDraft({ sourceJobId: jobId, baseFingerprint: originalFingerprint });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-2",
      field: "gap",
      value: 12
    });

    persistInspectorOverrideDraft({ jobId, draft });

    const restored = restorePersistedInspectorOverrideDraft({
      jobId,
      currentBaseFingerprint: currentFingerprint
    });

    expect(restored.draft).not.toBeNull();
    expect(restored.stale).toBe(true);
    expect(restored.warning).toContain("fingerprint");
  });

  it("returns an explicit warning for invalid persisted JSON", () => {
    const jobId = "job-invalid-json";
    const key = toInspectorOverrideDraftStorageKey(jobId);
    window.localStorage.setItem(key, "not-valid-json");

    const restored = restorePersistedInspectorOverrideDraft({
      jobId,
      currentBaseFingerprint: "fnv1a64:ffff"
    });

    expect(restored.draft).toBeNull();
    expect(restored.stale).toBe(false);
    expect(restored.warning).toContain("invalid JSON");
  });

  it("returns non-fatal persistence failure when localStorage writes fail", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    const draft = createInspectorOverrideDraft({
      sourceJobId: "job-storage-error",
      baseFingerprint: "fnv1a64:1234"
    });

    const result = persistInspectorOverrideDraft({
      jobId: "job-storage-error",
      draft
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("In-memory draft");

    setItemSpy.mockRestore();
  });
});
