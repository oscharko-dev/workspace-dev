/**
 * Intent-classification telemetry (#1094, audits #991).
 *
 * Counts every classification (intent x confidence bucket) and every
 * user-driven correction (from -> to) for the paste-to-code flow. Target
 * misclassification rate <5% per #991. Local, air-gap-safe (no network).
 *
 * Dev access: window.__WORKSPACE_DEV_INTENT_METRICS__.getSnapshot().
 */

import type { ImportIntent } from "./paste-input-classifier";

export type ConfidenceBucket = "very_high" | "high" | "medium" | "low";

export interface IntentClassificationEvent {
  readonly type: "classification";
  readonly intent: ImportIntent;
  readonly confidenceBucket: ConfidenceBucket;
  readonly timestamp: number;
}

export interface IntentCorrectionEvent {
  readonly type: "correction";
  readonly from: ImportIntent;
  readonly to: ImportIntent;
  readonly timestamp: number;
}

export type IntentClassificationMetricEvent =
  | IntentClassificationEvent
  | IntentCorrectionEvent;

export interface IntentClassificationMetricsSnapshot {
  readonly classifications: Record<
    ImportIntent,
    Record<ConfidenceBucket, number>
  >;
  readonly corrections: Record<ImportIntent, Record<ImportIntent, number>>;
  readonly totalClassifications: number;
  readonly totalCorrections: number;
  readonly misclassificationRate: number;
  readonly recentEvents: ReadonlyArray<IntentClassificationMetricEvent>;
  readonly storageVersion: number;
}

export const INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION = 1;
export const INTENT_CLASSIFICATION_MAX_MISCLASSIFICATION_RATE = 0.05;
const STORAGE_KEY = "workspace-dev:intent-classification-metrics";
const RECENT_EVENTS_CAP = 200;

const ALL_INTENTS: readonly ImportIntent[] = [
  "FIGMA_JSON_NODE_BATCH",
  "FIGMA_JSON_DOC",
  "FIGMA_PLUGIN_ENVELOPE",
  "RAW_CODE_OR_TEXT",
  "UNKNOWN",
];

const ALL_BUCKETS: readonly ConfidenceBucket[] = [
  "very_high",
  "high",
  "medium",
  "low",
];

interface InternalState {
  classifications: Map<ImportIntent, Map<ConfidenceBucket, number>>;
  corrections: Map<ImportIntent, Map<ImportIntent, number>>;
  recentEvents: IntentClassificationMetricEvent[];
  totalClassifications: number;
  totalCorrections: number;
  restored: boolean;
}

interface PersistedEnvelope {
  version: number;
  classifications: Record<string, unknown>;
  corrections: Record<string, unknown>;
  recentEvents: ReadonlyArray<unknown>;
  totalClassifications: number;
  totalCorrections: number;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function createEmptyClassifications(): Map<
  ImportIntent,
  Map<ConfidenceBucket, number>
> {
  const map = new Map<ImportIntent, Map<ConfidenceBucket, number>>();
  for (const intent of ALL_INTENTS) {
    map.set(intent, new Map<ConfidenceBucket, number>());
  }
  return map;
}

function createEmptyCorrections(): Map<
  ImportIntent,
  Map<ImportIntent, number>
> {
  const map = new Map<ImportIntent, Map<ImportIntent, number>>();
  for (const intent of ALL_INTENTS) {
    map.set(intent, new Map<ImportIntent, number>());
  }
  return map;
}

function createEmptyState(): InternalState {
  return {
    classifications: createEmptyClassifications(),
    corrections: createEmptyCorrections(),
    recentEvents: [],
    totalClassifications: 0,
    totalCorrections: 0,
    restored: false,
  };
}

const state: InternalState = createEmptyState();

export function bucketFromConfidence(confidence: number): ConfidenceBucket {
  if (confidence >= 0.9) {
    return "very_high";
  }
  if (confidence >= 0.8) {
    return "high";
  }
  if (confidence >= 0.7) {
    return "medium";
  }
  return "low";
}

function isImportIntent(value: unknown): value is ImportIntent {
  return (
    typeof value === "string" &&
    (ALL_INTENTS as readonly string[]).includes(value)
  );
}

function isConfidenceBucket(value: unknown): value is ConfidenceBucket {
  return (
    typeof value === "string" &&
    (ALL_BUCKETS as readonly string[]).includes(value)
  );
}

function isPersistedEnvelope(value: unknown): value is PersistedEnvelope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION) {
    return false;
  }
  if (
    !isNonNegativeFiniteNumber(record["totalClassifications"]) ||
    !isNonNegativeFiniteNumber(record["totalCorrections"])
  ) {
    return false;
  }
  if (!Array.isArray(record["recentEvents"])) {
    return false;
  }
  if (
    typeof record["classifications"] !== "object" ||
    record["classifications"] === null
  ) {
    return false;
  }
  if (
    typeof record["corrections"] !== "object" ||
    record["corrections"] === null
  ) {
    return false;
  }
  return true;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function restoreFromStorage(): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return;
  }

  if (raw === null) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isPersistedEnvelope(parsed)) {
    return;
  }

  for (const intent of ALL_INTENTS) {
    const inner = parsed.classifications[intent];
    if (inner === undefined || inner === null || typeof inner !== "object") {
      continue;
    }
    const intentMap = state.classifications.get(intent);
    if (intentMap === undefined) {
      continue;
    }
    for (const bucket of ALL_BUCKETS) {
      const value = (inner as Record<string, unknown>)[bucket];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        intentMap.set(bucket, value);
      }
    }
  }

  for (const fromIntent of ALL_INTENTS) {
    const inner = parsed.corrections[fromIntent];
    if (inner === undefined || inner === null || typeof inner !== "object") {
      continue;
    }
    const fromMap = state.corrections.get(fromIntent);
    if (fromMap === undefined) {
      continue;
    }
    for (const toIntent of ALL_INTENTS) {
      const value = (inner as Record<string, unknown>)[toIntent];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        fromMap.set(toIntent, value);
      }
    }
  }

  const events: IntentClassificationMetricEvent[] = [];
  for (const entry of parsed.recentEvents) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const timestamp = record["timestamp"];
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      continue;
    }
    if (record["type"] === "classification") {
      if (
        isImportIntent(record["intent"]) &&
        isConfidenceBucket(record["confidenceBucket"])
      ) {
        events.push({
          type: "classification",
          intent: record["intent"],
          confidenceBucket: record["confidenceBucket"],
          timestamp,
        });
      }
      continue;
    }
    if (record["type"] === "correction") {
      if (isImportIntent(record["from"]) && isImportIntent(record["to"])) {
        events.push({
          type: "correction",
          from: record["from"],
          to: record["to"],
          timestamp,
        });
      }
    }
  }
  state.recentEvents = events.slice(-RECENT_EVENTS_CAP);

  state.totalClassifications = sumClassificationCounts(state.classifications);
  state.totalCorrections = sumCorrectionCounts(state.corrections);
}

function ensureRestored(): void {
  if (state.restored) {
    return;
  }
  state.restored = true;
  restoreFromStorage();
}

function toPersistedRecord(
  map: Map<ImportIntent, Map<ConfidenceBucket, number>>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [intent, inner] of map) {
    const innerRecord: Record<string, number> = {};
    for (const [bucket, value] of inner) {
      innerRecord[bucket] = value;
    }
    result[intent] = innerRecord;
  }
  return result;
}

function toPersistedIntentRecord(
  map: Map<ImportIntent, Map<ImportIntent, number>>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [from, inner] of map) {
    const innerRecord: Record<string, number> = {};
    for (const [to, value] of inner) {
      innerRecord[to] = value;
    }
    result[from] = innerRecord;
  }
  return result;
}

function persist(): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }
  const envelope: PersistedEnvelope = {
    version: INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
    classifications: toPersistedRecord(state.classifications),
    corrections: toPersistedIntentRecord(state.corrections),
    recentEvents: state.recentEvents,
    totalClassifications: state.totalClassifications,
    totalCorrections: state.totalCorrections,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    return;
  }
}

function pushEvent(event: IntentClassificationMetricEvent): void {
  state.recentEvents.push(event);
  if (state.recentEvents.length > RECENT_EVENTS_CAP) {
    state.recentEvents.splice(0, state.recentEvents.length - RECENT_EVENTS_CAP);
  }
}

function sumClassificationCounts(
  classifications: Map<ImportIntent, Map<ConfidenceBucket, number>>,
): number {
  let total = 0;
  for (const intentMap of classifications.values()) {
    for (const value of intentMap.values()) {
      total += value;
    }
  }
  return total;
}

function sumCorrectionCounts(
  corrections: Map<ImportIntent, Map<ImportIntent, number>>,
): number {
  let total = 0;
  for (const fromMap of corrections.values()) {
    for (const value of fromMap.values()) {
      total += value;
    }
  }
  return total;
}

export function recordClassification({
  intent,
  confidence,
}: {
  intent: ImportIntent;
  confidence: number;
}): void {
  ensureRestored();
  const bucket = bucketFromConfidence(confidence);
  const intentMap = state.classifications.get(intent);
  if (intentMap !== undefined) {
    intentMap.set(bucket, (intentMap.get(bucket) ?? 0) + 1);
  }
  state.totalClassifications += 1;
  pushEvent({
    type: "classification",
    intent,
    confidenceBucket: bucket,
    timestamp: Date.now(),
  });
  persist();
}

export function recordCorrection({
  from,
  to,
}: {
  from: ImportIntent;
  to: ImportIntent;
}): void {
  ensureRestored();
  const fromMap = state.corrections.get(from);
  if (fromMap !== undefined) {
    fromMap.set(to, (fromMap.get(to) ?? 0) + 1);
  }
  state.totalCorrections += 1;
  pushEvent({
    type: "correction",
    from,
    to,
    timestamp: Date.now(),
  });
  persist();
}

function buildClassificationsSnapshot(): Record<
  ImportIntent,
  Record<ConfidenceBucket, number>
> {
  const result = {} as Record<ImportIntent, Record<ConfidenceBucket, number>>;
  for (const intent of ALL_INTENTS) {
    const inner = {} as Record<ConfidenceBucket, number>;
    const innerMap = state.classifications.get(intent);
    for (const bucket of ALL_BUCKETS) {
      inner[bucket] = innerMap?.get(bucket) ?? 0;
    }
    result[intent] = Object.freeze(inner);
  }
  return Object.freeze(result);
}

function buildCorrectionsSnapshot(): Record<
  ImportIntent,
  Record<ImportIntent, number>
> {
  const result = {} as Record<ImportIntent, Record<ImportIntent, number>>;
  for (const from of ALL_INTENTS) {
    const inner = {} as Record<ImportIntent, number>;
    const innerMap = state.corrections.get(from);
    for (const to of ALL_INTENTS) {
      inner[to] = innerMap?.get(to) ?? 0;
    }
    result[from] = Object.freeze(inner);
  }
  return Object.freeze(result);
}

export function getIntentClassificationMetricsSnapshot(): IntentClassificationMetricsSnapshot {
  ensureRestored();
  const classifications = buildClassificationsSnapshot();
  const corrections = buildCorrectionsSnapshot();
  const totalClassifications = state.totalClassifications;
  const totalCorrections = state.totalCorrections;
  const denominator = totalClassifications > 0 ? totalClassifications : 1;
  const misclassificationRate = totalCorrections / denominator;
  const recentEvents = Object.freeze(
    state.recentEvents.map((event) => Object.freeze({ ...event })),
  );
  return Object.freeze({
    classifications,
    corrections,
    totalClassifications,
    totalCorrections,
    misclassificationRate,
    recentEvents,
    storageVersion: INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
  });
}

export function __resetIntentClassificationMetricsForTests(): void {
  resetIntentClassificationMetrics();
}

export function resetIntentClassificationMetrics(): void {
  state.classifications = createEmptyClassifications();
  state.corrections = createEmptyCorrections();
  state.recentEvents = [];
  state.totalClassifications = 0;
  state.totalCorrections = 0;
  state.restored = false;
  const storage = getStorage();
  if (storage !== null) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
  }
}

interface DevtoolsAccessor {
  getSnapshot: () => IntentClassificationMetricsSnapshot;
  reset: () => void;
}

const DEVTOOLS_GLOBAL_KEY = "__WORKSPACE_DEV_INTENT_METRICS__";

function isDevEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const env = import.meta.env;
    if (!env.DEV) {
      return false;
    }
    if (env.MODE === "test") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function installIntentClassificationDevtoolsAccessor(): void {
  if (!isDevEnvironment()) {
    return;
  }
  try {
    const host = window as unknown as Record<string, unknown>;
    if (host[DEVTOOLS_GLOBAL_KEY] !== undefined) {
      return;
    }
    const accessor: DevtoolsAccessor = {
      getSnapshot: getIntentClassificationMetricsSnapshot,
      reset: resetIntentClassificationMetrics,
    };
    host[DEVTOOLS_GLOBAL_KEY] = accessor;
  } catch {
    return;
  }
}

installIntentClassificationDevtoolsAccessor();
