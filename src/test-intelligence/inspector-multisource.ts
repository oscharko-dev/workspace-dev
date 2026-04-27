import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CUSTOM_CONTEXT_ARTIFACT_FILENAME,
  CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
  CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
  CUSTOM_CONTEXT_SCHEMA_VERSION,
  MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME,
  type BusinessTestIntentIr,
  type CustomContextSource,
  type GeneratedTestCaseList,
  type MultiSourceReconciliationReport,
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceKind,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

const SOURCES_DIR = "sources";
const BUSINESS_INTENT_IR_FILENAME = "business-intent-ir.json";
const JIRA_ISSUE_IR_FILENAME = "jira-issue-ir.json";
const JIRA_PASTE_PROVENANCE_FILENAME = "paste-provenance.json";
const CONFLICT_DECISIONS_FILENAME = "multi-source-conflict-decisions.json";
const SAFE_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/u;

export interface InspectorSourceRecord {
  sourceId: string;
  kind: TestIntentSourceKind;
  capturedAt: string;
  contentHash: string;
  role: "primary" | "supporting";
  label: string;
  authorHandle?: string;
  inputFormat?: TestIntentSourceRef["inputFormat"];
  canonicalIssueKey?: string;
}

export interface InspectorTestCaseProvenance {
  testCaseId: string;
  allSourceIds: string[];
  fieldSourceIds: string[];
  actionSourceIds: string[];
  validationSourceIds: string[];
  navigationSourceIds: string[];
}

export interface InspectorConflictDecisionEvent {
  id: string;
  sequence: number;
  jobId: string;
  conflictId: string;
  action: "approve" | "reject";
  at: string;
  actor: string;
  selectedSourceId?: string;
  selectedNormalizedValue?: string;
  note?: string;
}

export interface InspectorConflictDecisionSnapshot {
  conflictId: string;
  state: "approved" | "rejected";
  lastEventId: string;
  lastEventAt: string;
  actor: string;
  selectedSourceId?: string;
  selectedNormalizedValue?: string;
  note?: string;
}

interface ConflictDecisionEnvelope {
  version: "1.0.0";
  jobId: string;
  nextSequence: number;
  events: InspectorConflictDecisionEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeId = (value: string): boolean =>
  SAFE_ID_RE.test(value) && value !== "." && value !== "..";

const sourceKindLabel = (kind: TestIntentSourceKind): string => {
  switch (kind) {
    case "figma_local_json":
      return "Figma local JSON";
    case "figma_plugin":
      return "Figma plugin";
    case "figma_rest":
      return "Figma REST";
    case "jira_rest":
      return "Jira REST";
    case "jira_paste":
      return "Jira paste";
    case "custom_text":
      return "Custom text";
    case "custom_structured":
      return "Custom attributes";
  }
};

const hasPrimaryKind = (kind: TestIntentSourceKind): boolean =>
  kind === "figma_local_json" ||
  kind === "figma_plugin" ||
  kind === "figma_rest" ||
  kind === "jira_rest" ||
  kind === "jira_paste";

const toSourceRecord = (ref: TestIntentSourceRef): InspectorSourceRecord => ({
  sourceId: ref.sourceId,
  kind: ref.kind,
  capturedAt: ref.capturedAt,
  contentHash: ref.contentHash,
  role: hasPrimaryKind(ref.kind) ? "primary" : "supporting",
  label:
    ref.canonicalIssueKey !== undefined
      ? `${sourceKindLabel(ref.kind)} ${ref.canonicalIssueKey}`
      : sourceKindLabel(ref.kind),
  ...(ref.authorHandle !== undefined ? { authorHandle: ref.authorHandle } : {}),
  ...(ref.inputFormat !== undefined ? { inputFormat: ref.inputFormat } : {}),
  ...(ref.canonicalIssueKey !== undefined
    ? { canonicalIssueKey: ref.canonicalIssueKey }
    : {}),
});

const sourceDirPath = (runDir: string): string => path.join(runDir, SOURCES_DIR);

const decisionsFilePath = (runDir: string): string =>
  path.join(runDir, CONFLICT_DECISIONS_FILENAME);

const isExistingDir = async (dirPath: string): Promise<boolean> => {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const readBusinessIntent = async (
  runDir: string,
): Promise<BusinessTestIntentIr | undefined> => {
  try {
    const raw = await readFile(path.join(runDir, BUSINESS_INTENT_IR_FILENAME), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    return parsed as unknown as BusinessTestIntentIr;
  } catch {
    return undefined;
  }
};

const readSingleIssueSourceRef = async (
  runDir: string,
  sourceId: string,
  kind: "jira_paste" | "jira_rest",
): Promise<TestIntentSourceRef | undefined> => {
  try {
    const [issueRaw, provenanceRaw] = await Promise.all([
      readFile(path.join(runDir, SOURCES_DIR, sourceId, JIRA_ISSUE_IR_FILENAME), "utf8"),
      readFile(
        path.join(runDir, SOURCES_DIR, sourceId, JIRA_PASTE_PROVENANCE_FILENAME),
        "utf8",
      ).catch(() => undefined),
    ]);
    const issue = JSON.parse(issueRaw) as {
      contentHash?: unknown;
      issueKey?: unknown;
    };
    if (
      typeof issue.contentHash !== "string" ||
      typeof issue.issueKey !== "string"
    ) {
      return undefined;
    }
    const provenance =
      provenanceRaw !== undefined
        ? (JSON.parse(provenanceRaw) as {
            capturedAt?: unknown;
            authorHandle?: unknown;
          })
        : undefined;
    return {
      sourceId,
      kind,
      contentHash: issue.contentHash,
      capturedAt:
        typeof provenance?.capturedAt === "string"
          ? provenance.capturedAt
          : "1970-01-01T00:00:00.000Z",
      canonicalIssueKey: issue.issueKey,
      ...(typeof provenance?.authorHandle === "string"
        ? { authorHandle: provenance.authorHandle }
        : {}),
    };
  } catch {
    return undefined;
  }
};

const readCustomContextSourceRef = async (
  runDir: string,
  sourceId: string,
): Promise<TestIntentSourceRef | undefined> => {
  try {
    const raw = await readFile(
      path.join(runDir, SOURCES_DIR, sourceId, CUSTOM_CONTEXT_ARTIFACT_FILENAME),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<CustomContextSource>;
    if (
      parsed.version !== CUSTOM_CONTEXT_SCHEMA_VERSION ||
      typeof parsed.aggregateContentHash !== "string"
    ) {
      return undefined;
    }
    const authorHandle =
      parsed.noteEntries?.[0]?.authorHandle ??
      parsed.structuredEntries?.[0]?.authorHandle;
    const capturedAt =
      parsed.noteEntries?.[0]?.capturedAt ??
      parsed.structuredEntries?.[0]?.capturedAt ??
      "1970-01-01T00:00:00.000Z";
    return {
      sourceId,
      kind:
        sourceId === CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID
          ? "custom_structured"
          : "custom_text",
      contentHash: parsed.aggregateContentHash,
      capturedAt,
      ...(typeof authorHandle === "string" ? { authorHandle } : {}),
      ...(sourceId === CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID
        ? { inputFormat: "markdown" as const }
        : sourceId === CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID
          ? { inputFormat: "structured_json" as const }
          : {}),
    };
  } catch {
    return undefined;
  }
};

export const listInspectorSourceRecords = async (
  runDir: string,
): Promise<InspectorSourceRecord[]> => {
  const intent = await readBusinessIntent(runDir);
  const byId = new Map<string, TestIntentSourceRef>();

  for (const ref of intent?.sourceEnvelope?.sources ?? []) {
    byId.set(ref.sourceId, ref);
  }

  const sourcesDir = sourceDirPath(runDir);
  if (await isExistingDir(sourcesDir)) {
    for (const sourceId of await readdir(sourcesDir)) {
      if (!isSafeId(sourceId) || byId.has(sourceId)) continue;
      const customRef = await readCustomContextSourceRef(runDir, sourceId);
      if (customRef !== undefined) {
        byId.set(sourceId, customRef);
        continue;
      }
      const jiraPasteRef = await readSingleIssueSourceRef(runDir, sourceId, "jira_paste");
      if (jiraPasteRef !== undefined) {
        byId.set(sourceId, jiraPasteRef);
      }
    }
  }

  if (
    intent !== undefined &&
    intent.sourceEnvelope === undefined &&
    (intent.source.kind === "figma_local_json" ||
      intent.source.kind === "figma_plugin" ||
      intent.source.kind === "figma_rest")
  ) {
    byId.set("business-intent-primary", {
      sourceId: "business-intent-primary",
      kind: intent.source.kind,
      contentHash: intent.source.contentHash,
      capturedAt: "1970-01-01T00:00:00.000Z",
    });
  }

  return [...byId.values()]
    .map(toSourceRecord)
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
};

export const readInspectorSourceEnvelope = async (
  runDir: string,
): Promise<MultiSourceTestIntentEnvelope | undefined> => {
  const intent = await readBusinessIntent(runDir);
  return intent?.sourceEnvelope;
};

export const readInspectorReconciliationReport = async (
  runDir: string,
): Promise<MultiSourceReconciliationReport | undefined> => {
  try {
    const raw = await readFile(
      path.join(runDir, MULTI_SOURCE_CONFLICT_REPORT_ARTIFACT_FILENAME),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed["conflicts"])) {
      return undefined;
    }
    return parsed as unknown as MultiSourceReconciliationReport;
  } catch {
    return undefined;
  }
};

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export const buildInspectorTestCaseProvenance = async (input: {
  runDir: string;
  generatedTestCases?: GeneratedTestCaseList;
}): Promise<Record<string, InspectorTestCaseProvenance>> => {
  if (input.generatedTestCases === undefined) {
    return {};
  }
  const intent = await readBusinessIntent(input.runDir);
  if (intent === undefined) {
    return {};
  }

  const fieldMap = new Map(
    intent.detectedFields.map((field) => [
      field.id,
      uniqueSorted((field.sourceRefs ?? []).map((ref) => ref.sourceId)),
    ]),
  );
  const actionMap = new Map(
    intent.detectedActions.map((action) => [
      action.id,
      uniqueSorted((action.sourceRefs ?? []).map((ref) => ref.sourceId)),
    ]),
  );
  const validationMap = new Map(
    intent.detectedValidations.map((validation) => [
      validation.id,
      uniqueSorted((validation.sourceRefs ?? []).map((ref) => ref.sourceId)),
    ]),
  );
  const navigationMap = new Map(
    intent.detectedNavigation.map((navigation) => [
      navigation.id,
      uniqueSorted((navigation.sourceRefs ?? []).map((ref) => ref.sourceId)),
    ]),
  );

  const output: Record<string, InspectorTestCaseProvenance> = {};
  for (const testCase of input.generatedTestCases.testCases) {
    const fieldSourceIds = uniqueSorted(
      testCase.qualitySignals.coveredFieldIds.flatMap(
        (id) => fieldMap.get(id) ?? [],
      ),
    );
    const actionSourceIds = uniqueSorted(
      testCase.qualitySignals.coveredActionIds.flatMap(
        (id) => actionMap.get(id) ?? [],
      ),
    );
    const validationSourceIds = uniqueSorted(
      testCase.qualitySignals.coveredValidationIds.flatMap(
        (id) => validationMap.get(id) ?? [],
      ),
    );
    const navigationSourceIds = uniqueSorted(
      testCase.qualitySignals.coveredNavigationIds.flatMap(
        (id) => navigationMap.get(id) ?? [],
      ),
    );
    output[testCase.id] = {
      testCaseId: testCase.id,
      fieldSourceIds,
      actionSourceIds,
      validationSourceIds,
      navigationSourceIds,
      allSourceIds: uniqueSorted([
        ...fieldSourceIds,
        ...actionSourceIds,
        ...validationSourceIds,
        ...navigationSourceIds,
      ]),
    };
  }
  return output;
};

const isConflictDecisionEnvelope = (
  value: unknown,
): value is ConflictDecisionEnvelope =>
  isRecord(value) &&
  value["version"] === "1.0.0" &&
  typeof value["jobId"] === "string" &&
  typeof value["nextSequence"] === "number" &&
  Array.isArray(value["events"]) &&
  value["events"].every(isConflictDecisionEvent);

const isConflictDecisionEvent = (
  value: unknown,
): value is InspectorConflictDecisionEvent =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["sequence"] === "number" &&
  typeof value["jobId"] === "string" &&
  typeof value["conflictId"] === "string" &&
  (value["action"] === "approve" || value["action"] === "reject") &&
  typeof value["at"] === "string" &&
  typeof value["actor"] === "string";

const readDecisionEnvelope = async (
  runDir: string,
  jobId: string,
): Promise<ConflictDecisionEnvelope> => {
  try {
    const raw = await readFile(decisionsFilePath(runDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isConflictDecisionEnvelope(parsed) && parsed.jobId === jobId) {
      return parsed;
    }
  } catch {
    // Missing or malformed decision artifacts are treated as absent.
  }
  return {
    version: "1.0.0",
    jobId,
    nextSequence: 1,
    events: [],
  };
};

const writeDecisionEnvelope = async (
  runDir: string,
  envelope: ConflictDecisionEnvelope,
): Promise<void> => {
  const artifactPath = decisionsFilePath(runDir);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(envelope), "utf8");
  await rename(tempPath, artifactPath);
};

export const readInspectorConflictDecisions = async (input: {
  runDir: string;
  jobId: string;
}): Promise<{
  events: InspectorConflictDecisionEvent[];
  byConflictId: Record<string, InspectorConflictDecisionSnapshot>;
}> => {
  const envelope = await readDecisionEnvelope(input.runDir, input.jobId);
  const byConflictId: Record<string, InspectorConflictDecisionSnapshot> = {};
  for (const event of envelope.events) {
    byConflictId[event.conflictId] = {
      conflictId: event.conflictId,
      state: event.action === "approve" ? "approved" : "rejected",
      lastEventId: event.id,
      lastEventAt: event.at,
      actor: event.actor,
      ...(event.selectedSourceId !== undefined
        ? { selectedSourceId: event.selectedSourceId }
        : {}),
      ...(event.selectedNormalizedValue !== undefined
        ? { selectedNormalizedValue: event.selectedNormalizedValue }
        : {}),
      ...(event.note !== undefined ? { note: event.note } : {}),
    };
  }
  return { events: envelope.events, byConflictId };
};

export const resolveInspectorConflict = async (input: {
  runDir: string;
  jobId: string;
  conflictId: string;
  actor: string;
  at: string;
  action: "approve" | "reject";
  selectedSourceId?: string;
  selectedNormalizedValue?: string;
  note?: string;
}): Promise<
  | {
      ok: true;
      event: InspectorConflictDecisionEvent;
      snapshot: InspectorConflictDecisionSnapshot;
    }
  | { ok: false; code: "conflict_not_found" | "conflict_resolution_invalid" }
> => {
  const report = await readInspectorReconciliationReport(input.runDir);
  const conflict = report?.conflicts.find((candidate) => candidate.conflictId === input.conflictId);
  if (conflict === undefined) {
    return { ok: false, code: "conflict_not_found" };
  }
  if (
    input.action === "approve" &&
    input.selectedSourceId === undefined &&
    input.selectedNormalizedValue === undefined
  ) {
    return { ok: false, code: "conflict_resolution_invalid" };
  }
  if (
    input.selectedSourceId !== undefined &&
    !conflict.participatingSourceIds.includes(input.selectedSourceId)
  ) {
    return { ok: false, code: "conflict_resolution_invalid" };
  }
  if (
    input.selectedNormalizedValue !== undefined &&
    !conflict.normalizedValues.includes(input.selectedNormalizedValue)
  ) {
    return { ok: false, code: "conflict_resolution_invalid" };
  }

  const envelope = await readDecisionEnvelope(input.runDir, input.jobId);
  const event: InspectorConflictDecisionEvent = {
    id: sha256Hex({
      kind: "inspector_conflict_decision_event",
      jobId: input.jobId,
      conflictId: input.conflictId,
      sequence: envelope.nextSequence,
      actor: input.actor,
      at: input.at,
      action: input.action,
      selectedSourceId: input.selectedSourceId,
      selectedNormalizedValue: input.selectedNormalizedValue,
      note: input.note,
    }),
    sequence: envelope.nextSequence,
    jobId: input.jobId,
    conflictId: input.conflictId,
    action: input.action,
    at: input.at,
    actor: input.actor,
    ...(input.selectedSourceId !== undefined
      ? { selectedSourceId: input.selectedSourceId }
      : {}),
    ...(input.selectedNormalizedValue !== undefined
      ? { selectedNormalizedValue: input.selectedNormalizedValue }
      : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const nextEnvelope: ConflictDecisionEnvelope = {
    ...envelope,
    nextSequence: envelope.nextSequence + 1,
    events: [...envelope.events, event],
  };
  await writeDecisionEnvelope(input.runDir, nextEnvelope);
  return {
    ok: true,
    event,
    snapshot: {
      conflictId: event.conflictId,
      state: event.action === "approve" ? "approved" : "rejected",
      lastEventId: event.id,
      lastEventAt: event.at,
      actor: event.actor,
      ...(event.selectedSourceId !== undefined
        ? { selectedSourceId: event.selectedSourceId }
        : {}),
      ...(event.selectedNormalizedValue !== undefined
        ? { selectedNormalizedValue: event.selectedNormalizedValue }
        : {}),
      ...(event.note !== undefined ? { note: event.note } : {}),
    },
  };
};
