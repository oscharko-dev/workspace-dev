/**
 * Intent delta computation (Issue #1373).
 *
 * Given two `BusinessTestIntentIr` artifacts (the prior and the
 * current revision) plus optional matching visual sidecar payloads,
 * produce an {@link IntentDeltaReport} describing every additive,
 * removed, and changed element. The function is pure and
 * deterministic — identical inputs produce byte-identical output.
 *
 * The report covers:
 *
 *   - screens (`screen` kind),
 *   - input fields (`field` kind),
 *   - actions (`action` kind),
 *   - validations (`validation` kind),
 *   - navigation edges (`navigation` kind),
 *   - per-screen visual fixtures + `VisualScreenDescription`
 *     (`visual_screen` kind, with `confidence_dropped` and
 *     `ambiguity_increased` change types so unchanged screens avoid
 *     unnecessary visual-sidecar calls).
 *
 * No filesystem IO is performed by `computeIntentDelta`. The
 * companion {@link writeIntentDeltaReport} persists the artifact
 * atomically using the `${pid}.${randomUUID()}.tmp` rename pattern
 * shared by the rest of the test-intelligence module.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  INTENT_DELTA_REPORT_ARTIFACT_FILENAME,
  INTENT_DELTA_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type BusinessTestIntentIr,
  type DetectedAction,
  type DetectedField,
  type DetectedNavigation,
  type DetectedValidation,
  type IntentDeltaChangeType,
  type IntentDeltaEntry,
  type IntentDeltaKind,
  type IntentDeltaReport,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

/**
 * Default minimum drop in mean visual confidence that triggers a
 * `confidence_dropped` entry. Conservative — set so rounding noise
 * inside the visual sidecar does not surface as a delta.
 */
export const INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT = 0.05;

/** Optional configuration for {@link computeIntentDelta}. */
export interface ComputeIntentDeltaOptions {
  /**
   * Minimum drop in mean visual confidence that surfaces as a
   * `confidence_dropped` entry. Defaults to
   * {@link INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT}. Must be in
   * `[0, 1]`.
   */
  visualConfidenceDriftThreshold?: number;
  /**
   * Optional per-screen visual fixture identity (e.g. a SHA-256 of
   * the on-disk PNG). When supplied for both prior and current
   * revisions, a fixture-byte change surfaces as a `visual_screen`
   * `changed` entry even if the IR itself is byte-identical.
   *
   * Maps from `screenId` to fixture hash. Missing entries are
   * treated as "no fixture identity provided"; mismatched presence
   * (one side has it, the other does not) is treated as a
   * `changed` entry.
   */
  priorFixtureHashes?: Readonly<Record<string, string>>;
  /** Same as {@link priorFixtureHashes} for the current revision. */
  currentFixtureHashes?: Readonly<Record<string, string>>;
  /** Optional prior visual sidecar descriptions (matched by `screenId`). */
  priorVisual?: ReadonlyArray<VisualScreenDescription>;
  /** Optional current visual sidecar descriptions. */
  currentVisual?: ReadonlyArray<VisualScreenDescription>;
}

export interface ComputeIntentDeltaInput {
  jobId: string;
  generatedAt: string;
  prior: BusinessTestIntentIr;
  current: BusinessTestIntentIr;
  options?: ComputeIntentDeltaOptions;
}

const KIND_ORDER: Record<IntentDeltaKind, number> = {
  action: 0,
  field: 1,
  navigation: 2,
  screen: 3,
  validation: 4,
  visual_screen: 5,
};

const CHANGE_TYPE_ORDER: Record<IntentDeltaChangeType, number> = {
  added: 0,
  ambiguity_increased: 1,
  changed: 2,
  confidence_dropped: 3,
  removed: 4,
};

/** Pure compare of two intent IRs into a deterministic delta report. */
export const computeIntentDelta = (
  input: ComputeIntentDeltaInput,
): IntentDeltaReport => {
  const driftThreshold =
    input.options?.visualConfidenceDriftThreshold ??
    INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT;
  if (driftThreshold < 0 || driftThreshold > 1) {
    throw new RangeError(
      "computeIntentDelta: visualConfidenceDriftThreshold must be in [0, 1]",
    );
  }

  const entries: IntentDeltaEntry[] = [];

  appendScreenDeltas(input.prior, input.current, entries);
  appendCollectionDeltas(
    "field",
    input.prior.detectedFields,
    input.current.detectedFields,
    fieldHashSeed,
    entries,
  );
  appendCollectionDeltas(
    "action",
    input.prior.detectedActions,
    input.current.detectedActions,
    actionHashSeed,
    entries,
  );
  appendCollectionDeltas(
    "validation",
    input.prior.detectedValidations,
    input.current.detectedValidations,
    validationHashSeed,
    entries,
  );
  appendCollectionDeltas(
    "navigation",
    input.prior.detectedNavigation,
    input.current.detectedNavigation,
    navigationHashSeed,
    entries,
  );
  appendVisualDeltas(input, driftThreshold, entries);

  entries.sort(compareDeltaEntries);

  const totals = computeTotals(entries);

  return {
    schemaVersion: INTENT_DELTA_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    priorIntentHash: sha256Hex(input.prior),
    currentIntentHash: sha256Hex(input.current),
    entries,
    totals,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
  };
};

const compareDeltaEntries = (
  a: IntentDeltaEntry,
  b: IntentDeltaEntry,
): number => {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.elementId !== b.elementId) return a.elementId < b.elementId ? -1 : 1;
  return CHANGE_TYPE_ORDER[a.changeType] - CHANGE_TYPE_ORDER[b.changeType];
};

const computeTotals = (
  entries: ReadonlyArray<IntentDeltaEntry>,
): IntentDeltaReport["totals"] => {
  const totals: IntentDeltaReport["totals"] = {
    added: 0,
    removed: 0,
    changed: 0,
    confidenceDropped: 0,
    ambiguityIncreased: 0,
  };
  for (const entry of entries) {
    switch (entry.changeType) {
      case "added":
        totals.added += 1;
        break;
      case "removed":
        totals.removed += 1;
        break;
      case "changed":
        totals.changed += 1;
        break;
      case "confidence_dropped":
        totals.confidenceDropped += 1;
        break;
      case "ambiguity_increased":
        totals.ambiguityIncreased += 1;
        break;
    }
  }
  return totals;
};

const appendScreenDeltas = (
  prior: BusinessTestIntentIr,
  current: BusinessTestIntentIr,
  out: IntentDeltaEntry[],
): void => {
  const priorMap = new Map(prior.screens.map((s) => [s.screenId, s]));
  const currentMap = new Map(current.screens.map((s) => [s.screenId, s]));
  for (const [id, screen] of currentMap.entries()) {
    if (!priorMap.has(id)) {
      out.push({
        kind: "screen",
        changeType: "added",
        elementId: id,
        screenId: id,
        currentHash: sha256Hex({
          screenName: screen.screenName,
          screenPath: screen.screenPath ?? null,
        }),
      });
    }
  }
  for (const [id, screen] of priorMap.entries()) {
    if (!currentMap.has(id)) {
      out.push({
        kind: "screen",
        changeType: "removed",
        elementId: id,
        screenId: id,
        priorHash: sha256Hex({
          screenName: screen.screenName,
          screenPath: screen.screenPath ?? null,
        }),
      });
    }
  }
  for (const [id, currentScreen] of currentMap.entries()) {
    const priorScreen = priorMap.get(id);
    if (priorScreen === undefined) continue;
    const priorHash = sha256Hex({
      screenName: priorScreen.screenName,
      screenPath: priorScreen.screenPath ?? null,
    });
    const currentHash = sha256Hex({
      screenName: currentScreen.screenName,
      screenPath: currentScreen.screenPath ?? null,
    });
    if (priorHash !== currentHash) {
      out.push({
        kind: "screen",
        changeType: "changed",
        elementId: id,
        screenId: id,
        priorHash,
        currentHash,
      });
    }
  }
};

interface CollectionLike {
  id: string;
  screenId: string;
}

type HashSeed<T> = (entry: T) => unknown;

const appendCollectionDeltas = <T extends CollectionLike>(
  kind: Extract<
    IntentDeltaKind,
    "field" | "action" | "validation" | "navigation"
  >,
  prior: ReadonlyArray<T>,
  current: ReadonlyArray<T>,
  hashSeed: HashSeed<T>,
  out: IntentDeltaEntry[],
): void => {
  const priorMap = new Map(prior.map((entry) => [entry.id, entry]));
  const currentMap = new Map(current.map((entry) => [entry.id, entry]));
  for (const [id, entry] of currentMap.entries()) {
    if (!priorMap.has(id)) {
      out.push({
        kind,
        changeType: "added",
        elementId: id,
        screenId: entry.screenId,
        currentHash: sha256Hex(hashSeed(entry)),
      });
    }
  }
  for (const [id, entry] of priorMap.entries()) {
    if (!currentMap.has(id)) {
      out.push({
        kind,
        changeType: "removed",
        elementId: id,
        screenId: entry.screenId,
        priorHash: sha256Hex(hashSeed(entry)),
      });
    }
  }
  for (const [id, currentEntry] of currentMap.entries()) {
    const priorEntry = priorMap.get(id);
    if (priorEntry === undefined) continue;
    const priorHash = sha256Hex(hashSeed(priorEntry));
    const currentHash = sha256Hex(hashSeed(currentEntry));
    if (priorHash !== currentHash) {
      out.push({
        kind,
        changeType: "changed",
        elementId: id,
        screenId: currentEntry.screenId,
        priorHash,
        currentHash,
      });
    }
  }
};

const fieldHashSeed = (entry: DetectedField): unknown => ({
  label: entry.label,
  type: entry.type,
  defaultValue: entry.defaultValue ?? null,
  ambiguity: entry.ambiguity?.reason ?? null,
});

const actionHashSeed = (entry: DetectedAction): unknown => ({
  label: entry.label,
  kind: entry.kind,
  ambiguity: entry.ambiguity?.reason ?? null,
});

const validationHashSeed = (entry: DetectedValidation): unknown => ({
  rule: entry.rule,
  targetFieldId: entry.targetFieldId ?? null,
  ambiguity: entry.ambiguity?.reason ?? null,
});

const navigationHashSeed = (entry: DetectedNavigation): unknown => ({
  targetScreenId: entry.targetScreenId,
  triggerElementId: entry.triggerElementId ?? null,
  ambiguity: entry.ambiguity?.reason ?? null,
});

const appendVisualDeltas = (
  input: ComputeIntentDeltaInput,
  driftThreshold: number,
  out: IntentDeltaEntry[],
): void => {
  const priorVisualMap = visualScreenIndex(input.options?.priorVisual);
  const currentVisualMap = visualScreenIndex(input.options?.currentVisual);
  const priorFixtures = input.options?.priorFixtureHashes ?? {};
  const currentFixtures = input.options?.currentFixtureHashes ?? {};
  const screenIds = new Set<string>();
  for (const id of priorVisualMap.keys()) screenIds.add(id);
  for (const id of currentVisualMap.keys()) screenIds.add(id);
  for (const id of Object.keys(priorFixtures)) screenIds.add(id);
  for (const id of Object.keys(currentFixtures)) screenIds.add(id);
  for (const id of Array.from(screenIds).sort()) {
    appendVisualDeltaForScreen(
      id,
      priorVisualMap.get(id),
      currentVisualMap.get(id),
      priorFixtures[id],
      currentFixtures[id],
      driftThreshold,
      out,
    );
  }
};

const visualScreenIndex = (
  list: ReadonlyArray<VisualScreenDescription> | undefined,
): Map<string, VisualScreenDescription> => {
  const out = new Map<string, VisualScreenDescription>();
  if (list === undefined) return out;
  for (const desc of list) out.set(desc.screenId, desc);
  return out;
};

const projectVisualForHash = (
  desc: VisualScreenDescription | undefined,
  fixtureHash: string | undefined,
): unknown => ({
  fixtureHash: fixtureHash ?? null,
  description: desc === undefined ? null : projectVisualDescription(desc),
});

const projectVisualDescription = (desc: VisualScreenDescription): unknown => ({
  sidecarDeployment: desc.sidecarDeployment,
  screenName: desc.screenName ?? null,
  confidenceSummary: desc.confidenceSummary,
  regions: desc.regions
    .slice()
    .sort((a, b) => (a.regionId < b.regionId ? -1 : 1))
    .map((r) => ({
      regionId: r.regionId,
      label: r.label ?? null,
      controlType: r.controlType ?? null,
      visibleText: r.visibleText ?? null,
      confidence: r.confidence,
      stateHints: (r.stateHints ?? []).slice().sort(),
      validationHints: (r.validationHints ?? []).slice().sort(),
      ambiguity: r.ambiguity?.reason ?? null,
    })),
  piiFlags: (desc.piiFlags ?? [])
    .slice()
    .sort((a, b) => (a.regionId < b.regionId ? -1 : 1)),
});

const ambiguityCount = (desc: VisualScreenDescription | undefined): number => {
  if (desc === undefined) return 0;
  let count = 0;
  for (const region of desc.regions) {
    if (region.ambiguity !== undefined) count += 1;
  }
  return count;
};

const meanConfidence = (
  desc: VisualScreenDescription | undefined,
): number | undefined =>
  desc === undefined ? undefined : desc.confidenceSummary.mean;

const appendVisualDeltaForScreen = (
  screenId: string,
  priorDesc: VisualScreenDescription | undefined,
  currentDesc: VisualScreenDescription | undefined,
  priorFixture: string | undefined,
  currentFixture: string | undefined,
  driftThreshold: number,
  out: IntentDeltaEntry[],
): void => {
  const priorHash = sha256Hex(projectVisualForHash(priorDesc, priorFixture));
  const currentHash = sha256Hex(
    projectVisualForHash(currentDesc, currentFixture),
  );
  const hasPrior = priorDesc !== undefined || priorFixture !== undefined;
  const hasCurrent = currentDesc !== undefined || currentFixture !== undefined;

  if (hasCurrent && !hasPrior) {
    out.push({
      kind: "visual_screen",
      changeType: "added",
      elementId: screenId,
      screenId,
      currentHash,
    });
    return;
  }
  if (hasPrior && !hasCurrent) {
    out.push({
      kind: "visual_screen",
      changeType: "removed",
      elementId: screenId,
      screenId,
      priorHash,
    });
    return;
  }
  if (priorHash !== currentHash) {
    out.push({
      kind: "visual_screen",
      changeType: "changed",
      elementId: screenId,
      screenId,
      priorHash,
      currentHash,
    });
  }

  const priorMean = meanConfidence(priorDesc);
  const currentMean = meanConfidence(currentDesc);
  if (
    priorMean !== undefined &&
    currentMean !== undefined &&
    priorMean - currentMean >= driftThreshold
  ) {
    out.push({
      kind: "visual_screen",
      changeType: "confidence_dropped",
      elementId: screenId,
      screenId,
      detail: `mean ${priorMean.toFixed(3)} -> ${currentMean.toFixed(3)}`,
    });
  }

  const priorAmb = ambiguityCount(priorDesc);
  const currentAmb = ambiguityCount(currentDesc);
  if (currentAmb > priorAmb) {
    out.push({
      kind: "visual_screen",
      changeType: "ambiguity_increased",
      elementId: screenId,
      screenId,
      detail: `regions ${priorAmb} -> ${currentAmb}`,
    });
  }
};

export interface WriteIntentDeltaReportInput {
  report: IntentDeltaReport;
  destinationDir: string;
}

export interface WriteIntentDeltaReportResult {
  artifactPath: string;
}

/**
 * Persist an intent-delta report atomically using the
 * `${pid}.${randomUUID()}.tmp` rename pattern that the rest of the
 * test-intelligence module uses for concurrent-safe writes.
 */
export const writeIntentDeltaReport = async (
  input: WriteIntentDeltaReportInput,
): Promise<WriteIntentDeltaReportResult> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    INTENT_DELTA_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.report);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return { artifactPath: path };
};
