import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME,
  WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
  type TestDesignElement,
  type TestDesignModel,
  type WorkflowTopology,
  type WorkflowTopologyAction,
  type WorkflowTopologyState,
  type WorkflowTopologyTransition,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  isCoverageRelevantElementLike,
  normalizeCoverageText,
} from "./coverage-relevance.js";

const INPUT_KIND_PATTERN =
  /\b(number|text|email|password|phone|date|currency|percentage|percent|rate|integer|decimal|float|input)\b/iu;
const SELECT_KIND_PATTERN =
  /\b(select|dropdown|combobox|radio|checkbox|option|choice|picker|segmented|chip|pill|auswahl)\b/iu;
const RESULT_KIND_PATTERN =
  /\b(result|summary|status|total|balance|output|confirmation|receipt|preview|overview|message|ergebnis|bedarf)\b/iu;
const HELPER_COPY_PATTERN =
  /\b(hinweis|helper|copy|note|mwst|vat|nicht teil|optional)\b/iu;
const OPTIONAL_PATTERN = /\boptional\b/iu;
const WORKFLOW_ACTION_ID_PATTERN = /^ACT-\d{3}$/u;

export interface BuildWorkflowTopologyInput {
  model: TestDesignModel;
  customContextMarkdown?: string;
}

const compareActions = (
  left: WorkflowTopologyAction,
  right: WorkflowTopologyAction,
): number =>
  left.screenId.localeCompare(right.screenId) ||
  left.label.localeCompare(right.label) ||
  left.kind.localeCompare(right.kind) ||
  left.targetIds.join("\0").localeCompare(right.targetIds.join("\0"));

const compareStates = (
  left: WorkflowTopologyState,
  right: WorkflowTopologyState,
): number =>
  left.screenId.localeCompare(right.screenId) ||
  left.label.localeCompare(right.label);

const inferActionKind = (
  element: TestDesignElement,
): WorkflowTopologyAction["kind"] => {
  const label = normalizeCoverageText(element.label);
  const kind = normalizeCoverageText(element.kind);
  if (SELECT_KIND_PATTERN.test(`${label} ${kind}`)) {
    return "select_option";
  }
  if (RESULT_KIND_PATTERN.test(`${label} ${kind}`)) {
    return "review_result";
  }
  if (HELPER_COPY_PATTERN.test(`${label} ${kind}`)) {
    return "review_copy";
  }
  if (INPUT_KIND_PATTERN.test(`${label} ${kind}`)) {
    return "enter_value";
  }
  return "confirm_state";
};

const inferActionLabel = (element: TestDesignElement): string => {
  const label = element.label.trim();
  const normalized = normalizeCoverageText(`${element.label} ${element.kind}`);
  if (SELECT_KIND_PATTERN.test(normalized)) {
    return `Wähle ${label}`;
  }
  if (RESULT_KIND_PATTERN.test(normalized)) {
    return `Prüfe ${label}`;
  }
  if (HELPER_COPY_PATTERN.test(normalized)) {
    return `Bestätige ${label}`;
  }
  if (INPUT_KIND_PATTERN.test(normalized)) {
    return `${OPTIONAL_PATTERN.test(normalized) ? "Optional eingeben" : "Eingeben"} ${label}`;
  }
  return `Bestätige ${label}`;
};

const buildWorkflowActionSeed = (input: {
  screenId: string;
  element: TestDesignElement;
  screenSourceRefs: readonly string[];
}): WorkflowTopologyAction | undefined => {
  if (!isCoverageRelevantElementLike(input.element)) {
    return undefined;
  }
  const kind = inferActionKind(input.element);
  if (kind === "confirm_state" && !HELPER_COPY_PATTERN.test(input.element.label)) {
    return undefined;
  }
  return {
    actionId: "",
    screenId: input.screenId,
    label: inferActionLabel(input.element),
    kind,
    targetIds: [input.element.elementId],
    sourceRefs: [...input.screenSourceRefs].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

const stableUniqueActions = (
  seeds: readonly WorkflowTopologyAction[],
): WorkflowTopologyAction[] => {
  const byKey = new Map<string, WorkflowTopologyAction>();
  for (const seed of seeds) {
    const key = canonicalJson({
      screenId: seed.screenId,
      label: seed.label,
      kind: seed.kind,
      targetIds: seed.targetIds,
    });
    if (!byKey.has(key)) {
      byKey.set(key, seed);
    }
  }
  return [...byKey.values()].sort(compareActions);
};

const stableActionId = (index: number): string =>
  `ACT-${String(index + 1).padStart(3, "0")}`;

const buildGuard = (action: WorkflowTopologyAction, markdown: string): string => {
  if (action.kind === "review_result") {
    return "after prerequisite values are available";
  }
  if (action.kind === "review_copy") {
    return "when the screen shows supporting domain guidance";
  }
  if (OPTIONAL_PATTERN.test(markdown) && action.label.toLowerCase().includes("optional")) {
    return "when optional workflow data is provided";
  }
  if (action.kind === "select_option") {
    return "when the workflow branches by user selection";
  }
  return "when the workflow continues on the same screen";
};

export const isWorkflowActionId = (value: string): boolean =>
  WORKFLOW_ACTION_ID_PATTERN.test(value);

export const assertWorkflowTopologyInvariants = (
  topology: WorkflowTopology,
): void => {
  const stateIds = new Set<string>();
  for (const state of topology.states) {
    if (state.stateId.length === 0) {
      throw new TypeError("WorkflowTopology: stateId must be non-empty");
    }
    stateIds.add(state.stateId);
  }
  const actionIds = new Set<string>();
  for (const action of topology.actions) {
    if (!isWorkflowActionId(action.actionId)) {
      throw new TypeError(
        `WorkflowTopology: invalid actionId "${action.actionId}"`,
      );
    }
    if (action.label.trim().length === 0) {
      throw new TypeError("WorkflowTopology: action labels must be non-empty");
    }
    actionIds.add(action.actionId);
  }
  for (const transition of topology.transitions) {
    if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) {
      throw new TypeError(
        `WorkflowTopology: transition "${transition.transitionId}" references an unknown state`,
      );
    }
    if (transition.guard.trim().length === 0) {
      throw new TypeError(
        `WorkflowTopology: transition "${transition.transitionId}" guard must be non-empty`,
      );
    }
    for (const actionId of transition.actions) {
      if (!actionIds.has(actionId)) {
        throw new TypeError(
          `WorkflowTopology: transition "${transition.transitionId}" references unknown action "${actionId}"`,
        );
      }
    }
  }
};

export const buildWorkflowTopology = (
  input: BuildWorkflowTopologyInput,
): WorkflowTopology => {
  const markdown = input.customContextMarkdown ?? "";
  const actionSeeds = input.model.screens.flatMap((screen) =>
    screen.elements
      .map((element) =>
        buildWorkflowActionSeed({
          screenId: screen.screenId,
          element,
          screenSourceRefs: screen.sourceRefs,
        }),
      )
      .filter(
        (candidate): candidate is WorkflowTopologyAction => candidate !== undefined,
      ),
  );
  const actions = stableUniqueActions(actionSeeds).map((action, index) => ({
    ...action,
    actionId: stableActionId(index),
  }));
  const states: WorkflowTopologyState[] = [];
  const transitions: WorkflowTopologyTransition[] = [];
  const entryStates: string[] = [];
  const exitStates: string[] = [];
  let stateIndex = 0;
  let transitionIndex = 0;

  for (const screen of input.model.screens) {
    const screenActions = actions.filter(
      (action) => action.screenId === screen.screenId,
    );
    const baseState: WorkflowTopologyState = {
      stateId: `STATE-${String(stateIndex + 1).padStart(3, "0")}`,
      screenId: screen.screenId,
      label: `${screen.name}: Einstieg`,
      sourceRefs: [...screen.sourceRefs].sort((left, right) =>
        left.localeCompare(right),
      ),
    };
    stateIndex += 1;
    states.push(baseState);
    entryStates.push(baseState.stateId);
    let previous = baseState;
    if (screenActions.length === 0) {
      exitStates.push(baseState.stateId);
      continue;
    }
    for (const action of screenActions) {
      const nextState: WorkflowTopologyState = {
        stateId: `STATE-${String(stateIndex + 1).padStart(3, "0")}`,
        screenId: screen.screenId,
        label: `${screen.name}: ${action.label}`,
        sourceRefs: [...screen.sourceRefs].sort((left, right) =>
          left.localeCompare(right),
        ),
      };
      stateIndex += 1;
      states.push(nextState);
      transitions.push({
        transitionId: `TRANS-${String(transitionIndex + 1).padStart(3, "0")}`,
        from: previous.stateId,
        to: nextState.stateId,
        guard: buildGuard(action, markdown),
        actions: [action.actionId],
      });
      transitionIndex += 1;
      previous = nextState;
    }
    exitStates.push(previous.stateId);
  }

  const topology: WorkflowTopology = {
    schemaVersion: WORKFLOW_TOPOLOGY_SCHEMA_VERSION,
    jobId: input.model.jobId,
    actions,
    states: states.sort(compareStates),
    transitions,
    entryStates: [...new Set(entryStates)].sort((left, right) =>
      left.localeCompare(right),
    ),
    exitStates: [...new Set(exitStates)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
  assertWorkflowTopologyInvariants(topology);
  return topology;
};

export const writeWorkflowTopologyArtifact = async (input: {
  topology: WorkflowTopology;
  runDir: string;
}): Promise<{ artifactPath: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeWorkflowTopologyArtifact: runDir must be a non-empty string",
    );
  }
  assertWorkflowTopologyInvariants(input.topology);
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(input.runDir, WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.topology), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};

export const workflowActionAnchorText = (
  actionIds: readonly string[],
): string | undefined => {
  const normalized = [...new Set(actionIds.filter(isWorkflowActionId))].sort();
  if (normalized.length === 0) {
    return undefined;
  }
  return `[${normalized.join(", ")}]`;
};

export const workflowActionIdsForTargets = (input: {
  topology: WorkflowTopology;
  coveredFieldIds: readonly string[];
  screenIds: readonly string[];
  text: string;
}): string[] => {
  const screenIds = new Set(input.screenIds);
  const coveredFieldIds = new Set(input.coveredFieldIds);
  const normalizedText = normalizeCoverageText(input.text);
  return input.topology.actions
    .filter((action) => {
      if (!screenIds.has(action.screenId)) {
        return false;
      }
      if (action.targetIds.some((targetId) => coveredFieldIds.has(targetId))) {
        return true;
      }
      const semanticLabel = normalizeCoverageText(action.label.replace(/^(wähle|eingeben|optional eingeben|prüfe|bestätige)\s+/iu, ""));
      return semanticLabel.length > 0 && normalizedText.includes(semanticLabel);
    })
    .map((action) => action.actionId)
    .sort((left, right) => left.localeCompare(right));
};

export const buildWorkflowTopologyDigest = (
  topology: WorkflowTopology,
): string => sha256Hex(topology);
