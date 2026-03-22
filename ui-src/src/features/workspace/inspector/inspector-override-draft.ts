import type {
  ScalarOverrideField,
  ScalarOverrideValue,
  ScalarOverrideValueByField
} from "./scalar-override-translators";

export const INSPECTOR_OVERRIDE_DRAFT_VERSION = 1;
const INSPECTOR_OVERRIDE_DRAFT_STORAGE_VERSION = 1;

export function toInspectorOverrideDraftStorageKey(jobId: string): string {
  return `workspace-dev:inspector-override-draft:v${String(INSPECTOR_OVERRIDE_DRAFT_STORAGE_VERSION)}:${jobId}`;
}

export interface InspectorScalarOverrideEntry {
  id: string;
  nodeId: string;
  field: ScalarOverrideField;
  value: ScalarOverrideValue;
  createdAt: string;
  updatedAt: string;
}

export interface InspectorOverrideDraft {
  version: number;
  draftId: string;
  sourceJobId: string;
  baseFingerprint: string;
  createdAt: string;
  updatedAt: string;
  entries: InspectorScalarOverrideEntry[];
}

export interface PersistInspectorOverrideDraftResult {
  ok: boolean;
  error: string | null;
}

export interface RestoreInspectorOverrideDraftResult {
  draft: InspectorOverrideDraft | null;
  stale: boolean;
  warning: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createDraftId(sourceJobId: string): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.trunc(Math.random() * 1_000_000)}`;
  return `${sourceJobId}:${randomPart}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScalarOverrideField(value: unknown): value is ScalarOverrideField {
  return value === "fillColor"
    || value === "opacity"
    || value === "cornerRadius"
    || value === "fontSize"
    || value === "fontWeight"
    || value === "fontFamily"
    || value === "padding"
    || value === "gap";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScalarPaddingValue(value: unknown): value is ScalarOverrideValueByField["padding"] {
  if (!isRecord(value)) {
    return false;
  }
  return isFiniteNumber(value.top)
    && isFiniteNumber(value.right)
    && isFiniteNumber(value.bottom)
    && isFiniteNumber(value.left)
    && value.top >= 0
    && value.right >= 0
    && value.bottom >= 0
    && value.left >= 0;
}

function isScalarOverrideValue(field: ScalarOverrideField, value: unknown): value is ScalarOverrideValue {
  if (field === "fillColor" || field === "fontFamily") {
    return typeof value === "string";
  }
  if (field === "padding") {
    return isScalarPaddingValue(value);
  }
  return isFiniteNumber(value);
}

function isInspectorScalarOverrideEntry(value: unknown): value is InspectorScalarOverrideEntry {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== "string" || typeof value.nodeId !== "string") {
    return false;
  }

  if (!isScalarOverrideField(value.field)) {
    return false;
  }

  if (!isScalarOverrideValue(value.field, value.value)) {
    return false;
  }

  return typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isInspectorOverrideDraft(value: unknown): value is InspectorOverrideDraft {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.version !== "number") {
    return false;
  }

  if (
    typeof value.draftId !== "string"
    || typeof value.sourceJobId !== "string"
    || typeof value.baseFingerprint !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(value.entries) || !value.entries.every((entry) => isInspectorScalarOverrideEntry(entry))) {
    return false;
  }

  return true;
}

function sortEntries(entries: readonly InspectorScalarOverrideEntry[]): InspectorScalarOverrideEntry[] {
  return [...entries].sort((left, right) => {
    if (left.nodeId !== right.nodeId) {
      return left.nodeId.localeCompare(right.nodeId);
    }
    return left.field.localeCompare(right.field);
  });
}

export function createInspectorOverrideDraft({
  sourceJobId,
  baseFingerprint
}: {
  sourceJobId: string;
  baseFingerprint: string;
}): InspectorOverrideDraft {
  const createdAt = nowIso();
  return {
    version: INSPECTOR_OVERRIDE_DRAFT_VERSION,
    draftId: createDraftId(sourceJobId),
    sourceJobId,
    baseFingerprint,
    createdAt,
    updatedAt: createdAt,
    entries: []
  };
}

export function getInspectorOverrideEntry({
  draft,
  nodeId,
  field
}: {
  draft: InspectorOverrideDraft;
  nodeId: string;
  field: ScalarOverrideField;
}): InspectorScalarOverrideEntry | null {
  return draft.entries.find((entry) => entry.nodeId === nodeId && entry.field === field) ?? null;
}

export function getInspectorOverrideValue<TField extends ScalarOverrideField>({
  draft,
  nodeId,
  field
}: {
  draft: InspectorOverrideDraft;
  nodeId: string;
  field: TField;
}): ScalarOverrideValueByField[TField] | null {
  const entry = getInspectorOverrideEntry({ draft, nodeId, field });
  if (!entry) {
    return null;
  }
  return entry.value as ScalarOverrideValueByField[TField];
}

export function listInspectorOverrideEntriesForNode({
  draft,
  nodeId
}: {
  draft: InspectorOverrideDraft;
  nodeId: string;
}): InspectorScalarOverrideEntry[] {
  return sortEntries(draft.entries.filter((entry) => entry.nodeId === nodeId));
}

export function upsertInspectorOverrideEntry({
  draft,
  nodeId,
  field,
  value
}: {
  draft: InspectorOverrideDraft;
  nodeId: string;
  field: ScalarOverrideField;
  value: ScalarOverrideValue;
}): InspectorOverrideDraft {
  const existing = getInspectorOverrideEntry({ draft, nodeId, field });
  const updatedAt = nowIso();

  const nextEntry: InspectorScalarOverrideEntry = {
    id: `${nodeId}:${field}`,
    nodeId,
    field,
    value,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt
  };

  const withoutOld = draft.entries.filter((entry) => !(entry.nodeId === nodeId && entry.field === field));
  return {
    ...draft,
    updatedAt,
    entries: sortEntries([...withoutOld, nextEntry])
  };
}

export function removeInspectorOverrideEntry({
  draft,
  nodeId,
  field
}: {
  draft: InspectorOverrideDraft;
  nodeId: string;
  field: ScalarOverrideField;
}): InspectorOverrideDraft {
  const nextEntries = draft.entries.filter((entry) => !(entry.nodeId === nodeId && entry.field === field));
  if (nextEntries.length === draft.entries.length) {
    return draft;
  }

  return {
    ...draft,
    updatedAt: nowIso(),
    entries: sortEntries(nextEntries)
  };
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      output[key] = toCanonicalJsonValue(record[key]);
    }
    return output;
  }
  return value;
}

function toCanonicalJsonString(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export function computeInspectorDraftBaseFingerprint(value: unknown): string {
  const canonical = toCanonicalJsonString(value);
  return `fnv1a64:${fnv1a64(canonical)}`;
}

export function toStructuredInspectorOverridePayload(draft: InspectorOverrideDraft): {
  sourceJobId: string;
  baseFingerprint: string;
  draftId: string;
  version: number;
  overrides: Array<{
    nodeId: string;
    field: ScalarOverrideField;
    value: ScalarOverrideValue;
  }>;
} {
  return {
    sourceJobId: draft.sourceJobId,
    baseFingerprint: draft.baseFingerprint,
    draftId: draft.draftId,
    version: draft.version,
    overrides: sortEntries(draft.entries).map((entry) => ({
      nodeId: entry.nodeId,
      field: entry.field,
      value: entry.value
    }))
  };
}

export function persistInspectorOverrideDraft({
  jobId,
  draft
}: {
  jobId: string;
  draft: InspectorOverrideDraft;
}): PersistInspectorOverrideDraftResult {
  if (typeof window === "undefined") {
    return {
      ok: true,
      error: null
    };
  }

  try {
    window.localStorage.setItem(toInspectorOverrideDraftStorageKey(jobId), JSON.stringify(draft));
    return {
      ok: true,
      error: null
    };
  } catch {
    return {
      ok: false,
      error: "Could not persist Inspector edit draft. In-memory draft is still active."
    };
  }
}

export function restorePersistedInspectorOverrideDraft({
  jobId,
  currentBaseFingerprint
}: {
  jobId: string;
  currentBaseFingerprint: string;
}): RestoreInspectorOverrideDraftResult {
  if (typeof window === "undefined") {
    return {
      draft: null,
      stale: false,
      warning: null
    };
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(toInspectorOverrideDraftStorageKey(jobId));
  } catch {
    return {
      draft: null,
      stale: false,
      warning: "Inspector draft storage is unavailable in this browser context."
    };
  }

  if (!raw) {
    return {
      draft: null,
      stale: false,
      warning: null
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      draft: null,
      stale: false,
      warning: "Stored Inspector draft is invalid JSON and was ignored."
    };
  }

  if (!isInspectorOverrideDraft(parsed)) {
    return {
      draft: null,
      stale: false,
      warning: "Stored Inspector draft is incompatible with the current schema and was ignored."
    };
  }

  if (parsed.version !== INSPECTOR_OVERRIDE_DRAFT_VERSION) {
    return {
      draft: null,
      stale: false,
      warning: `Stored Inspector draft version ${String(parsed.version)} is unsupported and was ignored.`
    };
  }

  const stale = parsed.baseFingerprint !== currentBaseFingerprint;
  return {
    draft: {
      ...parsed,
      entries: sortEntries(parsed.entries)
    },
    stale,
    warning: stale
      ? "Stored Inspector draft fingerprint does not match the current source job artifacts."
      : null
  };
}
