/**
 * Integration tests for form validation override translation and
 * draft lifecycle with the override model.
 *
 * Verifies that:
 * - Validation overrides translate into the shared override model.
 * - The structured payload includes validation overrides.
 * - Draft persistence/restore handles validation fields correctly.
 * - Edit capability detection recognizes form validation fields.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/453
 */
import { describe, expect, it, vi } from "vitest";
import {
  createInspectorOverrideDraft,
  getInspectorOverrideValue,
  upsertInspectorOverrideEntry,
  removeInspectorOverrideEntry,
  toStructuredInspectorOverridePayload,
  persistInspectorOverrideDraft,
  restorePersistedInspectorOverrideDraft,
  INSPECTOR_OVERRIDE_DRAFT_VERSION,
  type InspectorOverrideDraft
} from "./inspector-override-draft";
import {
  detectEditCapability,
  extractPresentFields,
  SUPPORTED_OVERRIDE_FIELDS,
  type EditCapabilityNode
} from "./edit-capability-detection";
import {
  translateFormValidationOverrideInput,
  FORM_VALIDATION_OVERRIDE_FIELDS
} from "./form-validation-override-translators";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<EditCapabilityNode> = {}): EditCapabilityNode {
  return {
    id: "node-form-1",
    name: "EmailField",
    type: "input",
    mapped: true,
    presentFields: ["fillColor", "required", "validationType", "validationMessage"],
    ...overrides
  };
}

function makeDraft(): InspectorOverrideDraft {
  return createInspectorOverrideDraft({
    sourceJobId: "job-form-test",
    baseFingerprint: "fingerprint-form-1"
  });
}

// ---------------------------------------------------------------------------
// Override translation → draft model integration
// ---------------------------------------------------------------------------

describe("form validation override → draft model integration", () => {
  it("translates required=true and stores in draft", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");

    const draft = upsertInspectorOverrideEntry({
      draft: makeDraft(),
      nodeId: "node-1",
      field: result.field,
      value: result.value
    });

    const stored = getInspectorOverrideValue({ draft, nodeId: "node-1", field: "required" });
    expect(stored).toBe(true);
  });

  it("translates validationType and stores in draft", () => {
    const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: "email" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");

    const draft = upsertInspectorOverrideEntry({
      draft: makeDraft(),
      nodeId: "node-1",
      field: result.field,
      value: result.value
    });

    const stored = getInspectorOverrideValue({ draft, nodeId: "node-1", field: "validationType" });
    expect(stored).toBe("email");
  });

  it("translates validationMessage and stores in draft", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: "Enter email." });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");

    const draft = upsertInspectorOverrideEntry({
      draft: makeDraft(),
      nodeId: "node-1",
      field: result.field,
      value: result.value
    });

    const stored = getInspectorOverrideValue({ draft, nodeId: "node-1", field: "validationMessage" });
    expect(stored).toBe("Enter email.");
  });

  it("mixes scalar and validation overrides in the same draft", () => {
    let draft = makeDraft();

    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "fillColor", value: "#112233" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "required", value: true });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "tel" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationMessage", value: "Invalid phone." });

    expect(draft.entries).toHaveLength(4);
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "fillColor" })).toBe("#112233");
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "required" })).toBe(true);
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "validationType" })).toBe("tel");
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "validationMessage" })).toBe("Invalid phone.");
  });

  it("removes validation overrides independently", () => {
    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "required", value: true });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "email" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "fillColor", value: "#aabbcc" });

    draft = removeInspectorOverrideEntry({ draft, nodeId: "n1", field: "required" });

    expect(draft.entries).toHaveLength(2);
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "required" })).toBeNull();
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "validationType" })).toBe("email");
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "fillColor" })).toBe("#aabbcc");
  });

  it("overwrites validation overrides on re-upsert", () => {
    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "email" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "tel" });

    expect(draft.entries).toHaveLength(1);
    expect(getInspectorOverrideValue({ draft, nodeId: "n1", field: "validationType" })).toBe("tel");
  });
});

// ---------------------------------------------------------------------------
// Structured payload includes validation overrides
// ---------------------------------------------------------------------------

describe("structured override payload with validation fields", () => {
  it("includes validation overrides in the payload", () => {
    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "fillColor", value: "#ff0000" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "required", value: true });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "iban" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationMessage", value: "Bad IBAN." });

    const payload = toStructuredInspectorOverridePayload(draft);

    expect(payload.overrides).toHaveLength(4);
    expect(payload.overrides).toContainEqual({ nodeId: "n1", field: "required", value: true });
    expect(payload.overrides).toContainEqual({ nodeId: "n1", field: "validationType", value: "iban" });
    expect(payload.overrides).toContainEqual({ nodeId: "n1", field: "validationMessage", value: "Bad IBAN." });
    expect(payload.overrides).toContainEqual({ nodeId: "n1", field: "fillColor", value: "#ff0000" });
  });

  it("deterministic sort includes validation fields after scalar fields", () => {
    let draft = makeDraft();
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "email" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "fillColor", value: "#aabb" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "required", value: false });

    const payload = toStructuredInspectorOverridePayload(draft);
    const fields = payload.overrides.map((o) => o.field);

    // Sorted by nodeId then field name alphabetically
    expect(fields).toEqual(["fillColor", "required", "validationType"]);
  });
});

// ---------------------------------------------------------------------------
// Draft persistence with validation fields
// ---------------------------------------------------------------------------

describe("draft persistence with validation fields", () => {
  it("persists and restores a draft with validation overrides", () => {
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
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "required", value: true });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationType", value: "plz" });
    draft = upsertInspectorOverrideEntry({ draft, nodeId: "n1", field: "validationMessage", value: "Invalid PLZ." });

    const persistResult = persistInspectorOverrideDraft({ jobId: "job-persist-test", draft });
    expect(persistResult.ok).toBe(true);

    const restoreResult = restorePersistedInspectorOverrideDraft({
      jobId: "job-persist-test",
      currentBaseFingerprint: draft.baseFingerprint
    });

    expect(restoreResult.draft).not.toBeNull();
    expect(restoreResult.stale).toBe(false);
    expect(restoreResult.draft!.entries).toHaveLength(3);
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "n1", field: "required" })).toBe(true);
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "n1", field: "validationType" })).toBe("plz");
    expect(getInspectorOverrideValue({ draft: restoreResult.draft!, nodeId: "n1", field: "validationMessage" })).toBe("Invalid PLZ.");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Edit capability detection with form fields
// ---------------------------------------------------------------------------

describe("edit capability detection with form validation fields", () => {
  it("detects form field nodes as editable", () => {
    const result = detectEditCapability(makeNode());

    expect(result.editable).toBe(true);
    expect(result.editableFields).toContain("required");
    expect(result.editableFields).toContain("validationType");
    expect(result.editableFields).toContain("validationMessage");
    expect(result.editableFields).toContain("fillColor");
  });

  it("detects node editable with only validation fields", () => {
    const result = detectEditCapability(makeNode({
      presentFields: ["required", "validationType"]
    }));

    expect(result.editable).toBe(true);
    expect(result.editableFields).toEqual(["required", "validationType"]);
  });

  it("extractPresentFields includes form validation fields", () => {
    const nodeData: Record<string, unknown> = {
      required: true,
      validationType: "email",
      validationMessage: "Must be a valid email.",
      fillColor: "#000000"
    };

    const fields = extractPresentFields(nodeData);

    expect(fields).toContain("fillColor");
    expect(fields).toContain("required");
    expect(fields).toContain("validationType");
    expect(fields).toContain("validationMessage");
  });

  it("SUPPORTED_OVERRIDE_FIELDS includes all form validation fields", () => {
    for (const field of FORM_VALIDATION_OVERRIDE_FIELDS) {
      expect(SUPPORTED_OVERRIDE_FIELDS).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// Draft version compatibility
// ---------------------------------------------------------------------------

describe("draft version compatibility", () => {
  it("uses version 2 for new drafts", () => {
    const draft = makeDraft();
    expect(draft.version).toBe(INSPECTOR_OVERRIDE_DRAFT_VERSION);
    expect(draft.version).toBe(2);
  });
});
