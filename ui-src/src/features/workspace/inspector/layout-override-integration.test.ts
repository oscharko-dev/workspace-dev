import { describe, expect, it, vi } from "vitest";
import {
  createInspectorOverrideDraft,
  getInspectorOverrideValue,
  persistInspectorOverrideDraft,
  removeInspectorOverrideEntry,
  restorePersistedInspectorOverrideDraft,
  toStructuredInspectorOverridePayload,
  upsertInspectorOverrideEntry,
  type InspectorOverrideDraft
} from "./inspector-override-draft";
import {
  SUPPORTED_OVERRIDE_FIELDS,
  detectEditCapability,
  extractPresentFields,
  type EditCapabilityNode
} from "./edit-capability-detection";
import { deriveInspectorImpactReviewModel } from "./inspector-impact-review";
import { translateLayoutOverrideInput } from "./layout-override-translators";

function makeNode(overrides: Partial<EditCapabilityNode> = {}): EditCapabilityNode {
  return {
    id: "node-layout-1",
    name: "Content Stack",
    type: "container",
    mapped: true,
    presentFields: ["width", "height", "layoutMode", "primaryAxisAlignItems", "counterAxisAlignItems"],
    ...overrides
  };
}

function makeDraft(): InspectorOverrideDraft {
  return createInspectorOverrideDraft({
    sourceJobId: "job-layout-test",
    baseFingerprint: "fingerprint-layout-1"
  });
}

describe("layout override integration", () => {
  it("translates layout overrides into the shared draft model", () => {
    let draft = makeDraft();

    const width = translateLayoutOverrideInput({ field: "width", rawValue: "640" });
    const layoutMode = translateLayoutOverrideInput({ field: "layoutMode", rawValue: "horizontal" });
    const primaryAxisAlignItems = translateLayoutOverrideInput({
      field: "primaryAxisAlignItems",
      rawValue: "space_between",
      effectiveLayoutMode: "HORIZONTAL"
    });

    expect(width.ok).toBe(true);
    expect(layoutMode.ok).toBe(true);
    expect(primaryAxisAlignItems.ok).toBe(true);
    if (!width.ok || !layoutMode.ok || !primaryAxisAlignItems.ok) {
      throw new Error("Expected layout override translation success.");
    }

    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-layout-1",
      field: width.field,
      value: width.value
    });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-layout-1",
      field: layoutMode.field,
      value: layoutMode.value
    });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-layout-1",
      field: primaryAxisAlignItems.field,
      value: primaryAxisAlignItems.value
    });

    expect(getInspectorOverrideValue({ draft, nodeId: "node-layout-1", field: "width" })).toBe(640);
    expect(getInspectorOverrideValue({ draft, nodeId: "node-layout-1", field: "layoutMode" })).toBe("HORIZONTAL");
    expect(getInspectorOverrideValue({ draft, nodeId: "node-layout-1", field: "primaryAxisAlignItems" }))
      .toBe("SPACE_BETWEEN");
  });

  it("includes layout overrides in structured payloads and supports independent removal", () => {
    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "node-layout-1", field: "width", value: 480 });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "node-layout-1", field: "layoutMode", value: "VERTICAL" });
    draft = upsertInspectorOverrideEntry({
      draft,
      nodeId: "node-layout-1",
      field: "counterAxisAlignItems",
      value: "CENTER"
    });

    const payload = toStructuredInspectorOverridePayload(draft);
    expect(payload.overrides).toContainEqual({ nodeId: "node-layout-1", field: "width", value: 480 });
    expect(payload.overrides).toContainEqual({
      nodeId: "node-layout-1",
      field: "layoutMode",
      value: "VERTICAL"
    });
    expect(payload.overrides).toContainEqual({
      nodeId: "node-layout-1",
      field: "counterAxisAlignItems",
      value: "CENTER"
    });

    const removed = removeInspectorOverrideEntry({
      draft,
      nodeId: "node-layout-1",
      field: "counterAxisAlignItems"
    });
    expect(getInspectorOverrideValue({ draft: removed, nodeId: "node-layout-1", field: "counterAxisAlignItems" }))
      .toBeNull();
    expect(getInspectorOverrideValue({ draft: removed, nodeId: "node-layout-1", field: "width" })).toBe(480);
  });

  it("persists and restores layout fields from local storage", () => {
    const storageMap = new Map<string, string>();
    const mockLocalStorage = {
      getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storageMap.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storageMap.delete(key);
      }),
      clear: vi.fn(() => {
        storageMap.clear();
      }),
      length: 0,
      key: vi.fn(() => null)
    };
    vi.stubGlobal("window", { localStorage: mockLocalStorage });

    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "node-layout-1", field: "width", value: 512 });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "node-layout-1", field: "height", value: 288 });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "node-layout-1", field: "layoutMode", value: "VERTICAL" });

    const persistResult = persistInspectorOverrideDraft({ jobId: "job-layout-test", draft });
    expect(persistResult.ok).toBe(true);

    const restoreResult = restorePersistedInspectorOverrideDraft({
      jobId: "job-layout-test",
      currentBaseFingerprint: draft.baseFingerprint
    });

    expect(restoreResult.stale).toBe(false);
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "node-layout-1", field: "width" }))
      .toBe(512);
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "node-layout-1", field: "height" }))
      .toBe(288);
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "node-layout-1", field: "layoutMode" }))
      .toBe("VERTICAL");

    vi.unstubAllGlobals();
  });

  it("recognizes layout fields in capability detection and draft impact review", () => {
    const capability = detectEditCapability(makeNode());
    expect(capability.editable).toBe(true);
    expect(capability.editableFields).toEqual([
      "width",
      "height",
      "layoutMode",
      "primaryAxisAlignItems",
      "counterAxisAlignItems"
    ]);

    const extractedFields = extractPresentFields({
      type: "container",
      width: 320,
      height: 120,
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "MAX",
      counterAxisAlignItems: "CENTER",
      children: [{ id: "child-1" }]
    });
    expect(extractedFields).toEqual([
      "width",
      "height",
      "layoutMode",
      "primaryAxisAlignItems",
      "counterAxisAlignItems"
    ]);
    expect(SUPPORTED_OVERRIDE_FIELDS).toContain("layoutMode");

    const impactReview = deriveInspectorImpactReviewModel({
      entries: [
        { nodeId: "node-layout-1", field: "width" },
        { nodeId: "node-layout-1", field: "gap" },
        { nodeId: "node-layout-1", field: "validationMessage" }
      ],
      manifest: {
        screens: [
          {
            screenId: "screen-1",
            screenName: "Home",
            file: "src/screens/Home.tsx",
            components: [
              {
                irNodeId: "node-layout-1",
                irNodeName: "Content Stack",
                irNodeType: "container",
                file: "src/screens/Home.tsx"
              }
            ]
          }
        ]
      }
    });

    expect(impactReview.summary.categories).toEqual({
      visual: 0,
      layout: 2,
      validation: 1,
      other: 0
    });
  });
});
