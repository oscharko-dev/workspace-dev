import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import { PreviewPane } from "./PreviewPane";
import { CodePane, type HighlightRange } from "./CodePane";
import { ComponentTree, type TreeNode } from "./component-tree";
import { findNodePath, useStreamingTreeNodes } from "./component-tree-utils";
import {
  createInitialPipelineState,
  postTokenDecisions,
  type PastePipelineState,
  type PipelineStage,
} from "./paste-pipeline";
import {
  buildSanitizedPipelineReport,
  type PipelineExecutionLog,
} from "./pipeline-execution-log";
import { PipelineStatusBar } from "./PipelineStatusBar";
import { ShortcutHelp } from "./ShortcutHelp";
import { ConfigDialog } from "./ConfigDialog";
import { suggestPairedFile } from "./file-pairing";
import type { CodeBoundaryEntry as GutterBoundaryEntry } from "./code-boundaries";
import {
  deriveInspectabilitySummary,
  type InspectabilityAvailability,
  type InspectabilityGenerationMetricsPayload,
} from "./inspectability-summary";
import {
  deriveNodeDiagnosticsMap,
  getNodeDiagnostics,
  getNodeDiagnosticBadge,
  type RawNodeDiagnosticEntry,
} from "./node-diagnostics";
import {
  resolveNodeDiffMapping,
  nodeDiffUnavailableReason,
  type ManifestPayload as NodeDiffManifestPayload,
} from "./node-diff-resolution";
import {
  DEFAULT_INSPECTOR_PANE_RATIOS,
  MIN_CODE_WIDTH_PX,
  MIN_PREVIEW_WIDTH_PX,
  MIN_TREE_WIDTH_PX,
  getContainerWidthPx,
  loadInspectorPaneRatios,
  resizePreviewCodePanes,
  resizeTreePreviewPane,
  saveInspectorPaneRatios,
  toInspectorLayoutStorageKey,
  type InspectorPaneRatios,
} from "./layout-state";
import {
  inspectorScopeReducer,
  INITIAL_INSPECTOR_SCOPE_STATE,
  selectActiveScope,
  selectCanNavigateBack,
  selectCanNavigateForward,
  selectCanLevelUp,
  selectCanReturnToParentFile,
  selectHasActiveScope,
  selectParentFile,
  selectEditModeActive,
  selectEditCapability,
  type ManifestMapping,
} from "./inspector-scope-state";
import {
  detectEditCapability,
  extractPresentFields,
} from "./edit-capability-detection";
import {
  deriveScalarOverrideFieldSupport,
  isScalarPaddingValue,
  translateScalarOverrideInput,
  type ScalarOverrideField,
  type ScalarOverrideValueByField,
} from "./scalar-override-translators";
import {
  deriveFormValidationOverrideFieldSupport,
  translateFormValidationOverrideInput,
  SUPPORTED_VALIDATION_TYPES,
  type FormValidationOverrideField,
  type FormValidationOverrideValueByField,
} from "./form-validation-override-translators";
import {
  COUNTER_AXIS_ALIGN_ITEMS,
  LAYOUT_MODE_VALUES,
  PRIMARY_AXIS_ALIGN_ITEMS,
  deriveLayoutOverrideFieldSupport,
  resolveLayoutModeValue,
  translateLayoutOverrideInput,
  type LayoutModeOverrideValue,
  type LayoutOverrideField,
  type LayoutOverrideValueByField,
} from "./layout-override-translators";
import {
  computeInspectorDraftBaseFingerprint,
  createInspectorOverrideDraft,
  carryForwardDraft,
  getInspectorOverrideEntry,
  getInspectorOverrideValue,
  persistInspectorOverrideDraft,
  removeInspectorOverrideEntry,
  restorePersistedInspectorOverrideDraft,
  toStructuredInspectorOverridePayload,
  upsertInspectorOverrideEntry,
  type InspectorOverrideDraft,
  type InspectorOverrideField,
  type StaleDraftCheckResult,
  type StaleDraftDecision,
} from "./inspector-override-draft";
import { StaleDraftWarning } from "./StaleDraftWarning";
import {
  RemapReviewPanel,
  type RemapDecisionEntry,
  type RemapSuggestResult,
} from "./RemapReviewPanel";
import { SuggestionsPanel } from "./SuggestionsPanel";
import {
  deriveQualityScore,
  type QualityScoreElementInput,
} from "./import-quality-score";
import { deriveTokenSuggestionModel } from "./token-suggestion-model";
import { deriveA11yNudges } from "./a11y-nudge";
import {
  mergeA11yScanInputs,
  selectA11yScanFiles,
} from "./a11y-file-selection";
import {
  resolveWorkspacePolicy,
  type WorkspacePolicy,
} from "./workspace-policy";
import {
  deriveInspectorImpactReviewModel,
  type InspectorImpactReviewManifest,
} from "./inspector-impact-review";
import {
  canRedo,
  canUndo,
  createEditHistory,
  pushEditHistory,
  redoEditHistory,
  undoEditHistory,
  type InspectorEditHistory,
} from "./inspector-edit-history";
import {
  createDraftSnapshot,
  createDraftSnapshotStore,
  type DraftSnapshotStore,
} from "./inspector-draft-snapshot";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

interface FileEntry {
  path: string;
  sizeBytes: number;
}

interface FilesPayload {
  jobId: string;
  files: FileEntry[];
}

interface ComponentManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

interface ComponentManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
  components: ComponentManifestEntry[];
}

interface ComponentManifestPayload {
  jobId: string;
  screens: ComponentManifestScreen[];
}

interface DesignIrElementNode {
  id: string;
  name: string;
  type: string;
  children?: DesignIrElementNode[];
  [key: string]: unknown;
}

interface DesignIrScreen {
  id: string;
  name: string;
  generatedFile?: string;
  children: DesignIrElementNode[];
}

interface DesignIrPayload {
  jobId: string;
  screens: DesignIrScreen[];
}

interface FileContentResponse {
  ok: boolean;
  status: number;
  content: string | null;
  error: string | null;
  message: string | null;
}

interface GenerationMetricsResponse {
  ok: boolean;
  status: number;
  payload: InspectabilityGenerationMetricsPayload | null;
  error: string | null;
  message: string | null;
}

interface WorkspacePolicyPayload {
  policy: WorkspacePolicy | null;
}

type LocalSyncFileAction = "create" | "overwrite" | "none";
type LocalSyncFileStatus =
  | "create"
  | "overwrite"
  | "conflict"
  | "untracked"
  | "unchanged";
type LocalSyncFileReason =
  | "new_file"
  | "managed_destination_unchanged"
  | "destination_modified_since_sync"
  | "destination_deleted_since_sync"
  | "existing_without_baseline"
  | "already_matches_generated";
type LocalSyncFileDecision = "write" | "skip";

interface LocalSyncFileDecisionEntry {
  path: string;
  decision: LocalSyncFileDecision;
}

interface LocalSyncFilePlanEntry {
  path: string;
  action: LocalSyncFileAction;
  status: LocalSyncFileStatus;
  reason: LocalSyncFileReason;
  decision: LocalSyncFileDecision;
  selectedByDefault: boolean;
  sizeBytes: number;
  message: string;
}

interface LocalSyncSummary {
  totalFiles: number;
  selectedFiles: number;
  createCount: number;
  overwriteCount: number;
  conflictCount: number;
  untrackedCount: number;
  unchangedCount: number;
  totalBytes: number;
  selectedBytes: number;
}

interface LocalSyncDryRunPayload {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: LocalSyncFilePlanEntry[];
  summary: LocalSyncSummary;
  confirmationToken: string;
  confirmationExpiresAt: string;
}

interface LocalSyncApplyPayload {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: LocalSyncFilePlanEntry[];
  summary: LocalSyncSummary;
  appliedAt: string;
}

interface EndpointErrorDetails {
  status: number;
  code: string;
  message: string;
}

interface CreatePrPayload {
  jobId: string;
  sourceJobId: string;
  gitPr: {
    status: "executed" | "skipped";
    reason?: string;
    prUrl?: string;
    branchName?: string;
    scopePath?: string;
    changedFiles?: string[];
  };
}

interface RegenerationAcceptedPayload {
  jobId: string;
  sourceJobId: string;
  status: "queued";
}

function isCreatePrPayload(value: unknown): value is CreatePrPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.jobId === "string" &&
    typeof value.sourceJobId === "string" &&
    typeof value.gitPr === "object" &&
    value.gitPr !== null
  );
}

function isRegenerationAcceptedPayload(
  value: unknown,
): value is RegenerationAcceptedPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.jobId === "string" &&
    typeof value.sourceJobId === "string" &&
    value.status === "queued"
  );
}

class PrMutationError extends Error {
  details: EndpointErrorDetails;

  constructor(details: EndpointErrorDetails) {
    super(details.message);
    this.name = "PrMutationError";
    this.details = details;
  }
}

class SyncMutationError extends Error {
  details: EndpointErrorDetails;

  constructor(details: EndpointErrorDetails) {
    super(details.message);
    this.name = "SyncMutationError";
    this.details = details;
  }
}

class RegenerationMutationError extends Error {
  details: EndpointErrorDetails;

  constructor(details: EndpointErrorDetails) {
    super(details.message);
    this.name = "RegenerationMutationError";
    this.details = details;
  }
}

type InspectorSourceStatus = "loading" | "ready" | "empty" | "error";

type ConfigDialogKey =
  | "preApplyReview"
  | "localSync"
  | "createPr"
  | "inspectability";

interface InspectorPanelProps {
  jobId: string;
  previewUrl: string;
  /** Previous job ID for diff comparison. `null` when no prior job exists. */
  previousJobId?: string | null;
  /** Whether the active job has regeneration lineage metadata. */
  isRegenerationJob?: boolean;
  /** Callback invoked when regeneration is accepted and returns a new job ID. */
  onRegenerationAccepted?: (jobId: string) => void;
  /** Which config dialog is open, or null if none. */
  openDialog?: ConfigDialogKey | null;
  /** Close the currently open config dialog. */
  onCloseDialog?: () => void;
  /** Paste pipeline state for progressive tree rendering during paste flow. */
  pipeline?: PastePipelineState;
  /** Callback to retry the pipeline after a partial or full failure. */
  onPipelineRetry?: (stage?: PipelineStage, targetIds?: string[]) => void;
  /** In-memory execution log for exporting stage events as JSON. */
  executionLog?: PipelineExecutionLog;
}

type PaneSeparator = "tree-preview" | "preview-code";

interface SplitterDragState {
  element: HTMLDivElement;
  pointerId: number;
  separator: PaneSeparator;
  startX: number;
  lastClientX: number;
  startWidthPx: number;
  startRatios: InspectorPaneRatios;
  unlockDocument: () => void;
}

const DESKTOP_LAYOUT_MEDIA_QUERY = "(min-width: 1280px)";
const KEYBOARD_STEP_PX = 24;
const KEYBOARD_STEP_LARGE_PX = 72;
const KEYBOARD_EXTREME_DELTA_PX = 100_000;
const BOUNDARIES_SESSION_STORAGE_KEY = "workspace-dev:inspector-boundaries:v1";
const PADDING_SIDES = ["top", "right", "bottom", "left"] as const;
const IDLE_PIPELINE_STATE = createInitialPipelineState();

type PaddingSide = (typeof PADDING_SIDES)[number];
type FieldValidationErrors = Partial<
  Record<InspectorOverrideField, string | null>
>;
type ScalarControlInputState = Partial<
  Record<Exclude<ScalarOverrideField, "padding">, string>
>;
type PaddingControlInputState = Partial<Record<PaddingSide, string>>;
type LayoutControlInputState = Partial<Record<LayoutOverrideField, string>>;
type FormValidationControlInputState = {
  required?: boolean;
  validationType?: string;
  validationMessage?: string;
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFilesPayload(value: unknown): value is FilesPayload {
  if (!isRecord(value)) return false;
  return typeof value.jobId === "string" && Array.isArray(value.files);
}

function isDesignIrPayload(value: unknown): value is DesignIrPayload {
  if (!isRecord(value)) return false;
  return typeof value.jobId === "string" && Array.isArray(value.screens);
}

function isComponentManifestPayload(
  value: unknown,
): value is ComponentManifestPayload {
  if (!isRecord(value)) return false;
  return typeof value.jobId === "string" && Array.isArray(value.screens);
}

function isGenerationMetricsPayload(
  value: unknown,
): value is InspectabilityGenerationMetricsPayload {
  return isRecord(value);
}

function isWorkspacePolicyPayload(value: unknown): value is WorkspacePolicyPayload {
  if (!isRecord(value)) return false;
  return value.policy === null || value.policy === undefined || isRecord(value.policy);
}

function isLocalSyncFilePlanEntry(
  value: unknown,
): value is LocalSyncFilePlanEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    (value.action === "create" ||
      value.action === "overwrite" ||
      value.action === "none") &&
    (value.status === "create" ||
      value.status === "overwrite" ||
      value.status === "conflict" ||
      value.status === "untracked" ||
      value.status === "unchanged") &&
    (value.reason === "new_file" ||
      value.reason === "managed_destination_unchanged" ||
      value.reason === "destination_modified_since_sync" ||
      value.reason === "destination_deleted_since_sync" ||
      value.reason === "existing_without_baseline" ||
      value.reason === "already_matches_generated") &&
    (value.decision === "write" || value.decision === "skip") &&
    typeof value.selectedByDefault === "boolean" &&
    typeof value.sizeBytes === "number" &&
    typeof value.message === "string"
  );
}

function isLocalSyncSummary(value: unknown): value is LocalSyncSummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.totalFiles === "number" &&
    typeof value.selectedFiles === "number" &&
    typeof value.createCount === "number" &&
    typeof value.overwriteCount === "number" &&
    typeof value.conflictCount === "number" &&
    typeof value.untrackedCount === "number" &&
    typeof value.unchangedCount === "number" &&
    typeof value.totalBytes === "number" &&
    typeof value.selectedBytes === "number"
  );
}

function isLocalSyncDryRunPayload(
  value: unknown,
): value is LocalSyncDryRunPayload {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return false;
  }
  return (
    typeof value.jobId === "string" &&
    typeof value.sourceJobId === "string" &&
    typeof value.boardKey === "string" &&
    typeof value.targetPath === "string" &&
    typeof value.scopePath === "string" &&
    typeof value.destinationRoot === "string" &&
    value.files.every((entry) => isLocalSyncFilePlanEntry(entry)) &&
    isLocalSyncSummary(value.summary) &&
    typeof value.confirmationToken === "string" &&
    typeof value.confirmationExpiresAt === "string"
  );
}

function isLocalSyncApplyPayload(
  value: unknown,
): value is LocalSyncApplyPayload {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return false;
  }
  return (
    typeof value.jobId === "string" &&
    typeof value.sourceJobId === "string" &&
    typeof value.boardKey === "string" &&
    typeof value.targetPath === "string" &&
    typeof value.scopePath === "string" &&
    typeof value.destinationRoot === "string" &&
    value.files.every((entry) => isLocalSyncFilePlanEntry(entry)) &&
    isLocalSyncSummary(value.summary) &&
    typeof value.appliedAt === "string"
  );
}

function canWriteLocalSyncEntry(entry: LocalSyncFilePlanEntry): boolean {
  return entry.action !== "none";
}

function isAttentionSyncEntry(entry: LocalSyncFilePlanEntry): boolean {
  return entry.status === "conflict" || entry.status === "untracked";
}

function toLocalSyncStatusLabel(status: LocalSyncFileStatus): string {
  if (status === "create") {
    return "Create";
  }
  if (status === "overwrite") {
    return "Managed overwrite";
  }
  if (status === "conflict") {
    return "Conflict";
  }
  if (status === "untracked") {
    return "Untracked";
  }
  return "Up to date";
}

function toLocalSyncActionLabel(action: LocalSyncFileAction): string {
  if (action === "create") {
    return "Will create";
  }
  if (action === "overwrite") {
    return "Will overwrite";
  }
  return "No write needed";
}

function getLocalSyncStatusClasses(status: LocalSyncFileStatus): string {
  if (status === "create") {
    return "border-emerald-300 bg-emerald-100 text-emerald-900";
  }
  if (status === "overwrite") {
    return "border-sky-300 bg-sky-100 text-sky-900";
  }
  if (status === "conflict") {
    return "border-rose-300 bg-rose-100 text-rose-900";
  }
  if (status === "untracked") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function createLocalSyncDecisionMap(
  files: LocalSyncFilePlanEntry[],
): Record<string, LocalSyncFileDecision> {
  return files.reduce<Record<string, LocalSyncFileDecision>>(
    (accumulator, entry) => {
      accumulator[entry.path] = entry.decision;
      return accumulator;
    },
    {},
  );
}

function toEndpointError({
  status,
  payload,
  fallbackCode,
  fallbackMessage,
}: {
  status: number;
  payload: unknown;
  fallbackCode: string;
  fallbackMessage: string;
}): EndpointErrorDetails {
  if (!isRecord(payload)) {
    return {
      status,
      code: fallbackCode,
      message: fallbackMessage,
    };
  }

  const payloadCode =
    typeof payload.error === "string" ? payload.error : fallbackCode;
  const payloadMessage =
    typeof payload.message === "string" ? payload.message : fallbackMessage;

  return {
    status,
    code: payloadCode,
    message: payloadMessage,
  };
}

function toSyncErrorDetails({
  error,
  fallback,
}: {
  error: unknown;
  fallback: EndpointErrorDetails;
}): EndpointErrorDetails {
  if (error instanceof SyncMutationError) {
    return error.details;
  }
  if (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return {
      ...fallback,
      message: error.message,
    };
  }
  return fallback;
}

function getStatusBadgeClasses(status: InspectorSourceStatus): string {
  if (status === "ready") {
    return "border border-[#4eba87]/30 bg-[#4eba87]/10 text-[#4eba87]";
  }
  if (status === "loading") {
    return "border border-white/10 bg-[#242424] text-white/70";
  }
  if (status === "empty") {
    return "border border-amber-400/25 bg-amber-400/10 text-amber-300";
  }
  return "border border-rose-400/25 bg-rose-500/10 text-rose-300";
}

function loadBoundariesEnabledPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      window.sessionStorage.getItem(BOUNDARIES_SESSION_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function toBoundariesForFile({
  manifest,
  filePath,
}: {
  manifest: ComponentManifestPayload | null;
  filePath: string | null;
}): GutterBoundaryEntry[] {
  if (!manifest || !filePath) {
    return [];
  }

  const deduped = new Map<string, GutterBoundaryEntry>();
  for (const screen of manifest.screens) {
    for (const entry of screen.components) {
      if (entry.file !== filePath) {
        continue;
      }
      const key = `${entry.irNodeId}:${String(entry.startLine)}:${String(entry.endLine)}`;
      if (!deduped.has(key)) {
        deduped.set(key, {
          irNodeId: entry.irNodeId,
          irNodeName: entry.irNodeName,
          irNodeType: entry.irNodeType,
          startLine: entry.startLine,
          endLine: entry.endLine,
        });
      }
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }
    if (left.endLine !== right.endLine) {
      return left.endLine - right.endLine;
    }
    return left.irNodeId.localeCompare(right.irNodeId);
  });
}

// ---------------------------------------------------------------------------
// Helpers: look up a raw IR element node by id (for field-level inspection)
// ---------------------------------------------------------------------------

function findIrElementNode(
  screens: DesignIrScreen[],
  nodeId: string,
): DesignIrElementNode | null {
  const searchChildren = (
    nodes: DesignIrElementNode[],
  ): DesignIrElementNode | null => {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      if (node.children) {
        const found = searchChildren(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  for (const screen of screens) {
    if (screen.id === nodeId) {
      // Screen-level nodes are not element nodes — return a synthetic shape
      return { id: screen.id, name: screen.name, type: "screen" };
    }
    const found = searchChildren(screen.children);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers: convert IR screens to TreeNode[]
// ---------------------------------------------------------------------------

function irElementToTreeNode(el: DesignIrElementNode): TreeNode {
  const node: TreeNode = {
    id: el.id,
    name: el.name,
    type: el.type,
  };
  if (el.children && el.children.length > 0) {
    node.children = el.children.map(irElementToTreeNode);
  }
  return node;
}

function irScreensToTreeNodes(screens: DesignIrScreen[]): TreeNode[] {
  return screens.map((s) => ({
    id: s.id,
    name: s.name,
    type: "screen",
    children: s.children.map(irElementToTreeNode),
  }));
}

// ---------------------------------------------------------------------------
// Helpers: look up manifest entry for a selected node
// ---------------------------------------------------------------------------

function findManifestEntry(
  nodeId: string,
  manifest: ComponentManifestPayload,
): {
  screen: ComponentManifestScreen;
  entry: ComponentManifestEntry | null;
} | null {
  for (const screen of manifest.screens) {
    // Check if it's the screen itself
    if (screen.screenId === nodeId) {
      return { screen, entry: null };
    }
    // Check component entries
    for (const entry of screen.components) {
      if (entry.irNodeId === nodeId) {
        return { screen, entry };
      }
    }
  }
  return null;
}

function toScalarControlInputValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function toPaddingControlInputValue(value: unknown): PaddingControlInputState {
  if (!isScalarPaddingValue(value)) {
    return {};
  }
  return {
    top: String(value.top),
    right: String(value.right),
    bottom: String(value.bottom),
    left: String(value.left),
  };
}

function toLayoutControlInputValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return toScalarControlInputValue(value);
}

function fieldLabel(field: InspectorOverrideField): string {
  switch (field) {
    case "fillColor":
      return "Fill color";
    case "opacity":
      return "Opacity";
    case "cornerRadius":
      return "Corner radius";
    case "fontSize":
      return "Font size";
    case "fontWeight":
      return "Font weight";
    case "fontFamily":
      return "Font family";
    case "padding":
      return "Padding";
    case "gap":
      return "Gap";
    case "width":
      return "Width";
    case "height":
      return "Height";
    case "layoutMode":
      return "Layout mode";
    case "primaryAxisAlignItems":
      return "Primary axis align";
    case "counterAxisAlignItems":
      return "Counter axis align";
    case "required":
      return "Required";
    case "validationType":
      return "Validation type";
    case "validationMessage":
      return "Validation message";
    default:
      return field;
  }
}

const inspectorPanelTestOnly = {
  isRecord,
  isFilesPayload,
  isDesignIrPayload,
  isComponentManifestPayload,
  isGenerationMetricsPayload,
  isLocalSyncFilePlanEntry,
  isLocalSyncSummary,
  isLocalSyncDryRunPayload,
  isLocalSyncApplyPayload,
  canWriteLocalSyncEntry,
  isAttentionSyncEntry,
  toLocalSyncStatusLabel,
  toLocalSyncActionLabel,
  getLocalSyncStatusClasses,
  createLocalSyncDecisionMap,
  toEndpointError,
  getStatusBadgeClasses,
  loadBoundariesEnabledPreference,
  toBoundariesForFile,
  findIrElementNode,
  irScreensToTreeNodes,
  findManifestEntry,
  toScalarControlInputValue,
  toPaddingControlInputValue,
  toLayoutControlInputValue,
  fieldLabel,
};

// ---------------------------------------------------------------------------
// InspectorPanel
// ---------------------------------------------------------------------------

export function InspectorPanel({
  jobId,
  previewUrl,
  previousJobId,
  isRegenerationJob = false,
  onRegenerationAccepted,
  openDialog = null,
  onCloseDialog,
  pipeline,
  onPipelineRetry,
  executionLog,
}: InspectorPanelProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [autoSelectedFile, setAutoSelectedFile] = useState<string | null>(null);
  const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(
    null,
  );
  const [scopeState, scopeDispatch] = useReducer(
    inspectorScopeReducer,
    INITIAL_INSPECTOR_SCOPE_STATE,
  );
  const selectedNodeId = scopeState.selectedNodeId;
  const activeScopeNodeId = selectActiveScope(scopeState)?.nodeId ?? null;
  const hasActiveScope = selectHasActiveScope(scopeState);
  const canNavigateBack = selectCanNavigateBack(scopeState);
  const canNavigateForward = selectCanNavigateForward(scopeState);
  const canLevelUp = selectCanLevelUp(scopeState);
  const canReturnToParentFile = selectCanReturnToParentFile(scopeState);
  const parentFile = selectParentFile(scopeState);
  const editModeActive = selectEditModeActive(scopeState);
  const editCapability = selectEditCapability(scopeState);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [boundariesEnabled, setBoundariesEnabled] = useState<boolean>(
    loadBoundariesEnabledPreference,
  );
  const [paneRatios, setPaneRatios] = useState<InspectorPaneRatios>(
    DEFAULT_INSPECTOR_PANE_RATIOS,
  );
  const [overrideDraft, setOverrideDraft] =
    useState<InspectorOverrideDraft | null>(null);
  const [, setEditHistory] = useState<InspectorEditHistory>(() =>
    createEditHistory(),
  );
  const [, setSnapshotStore] = useState<DraftSnapshotStore>(() =>
    createDraftSnapshotStore(),
  );
  const [draftRestoreWarning, setDraftRestoreWarning] = useState<string | null>(
    null,
  );
  const [draftStale, setDraftStale] = useState(false);
  const [staleDraftCheckResult, setStaleDraftCheckResult] =
    useState<StaleDraftCheckResult | null>(null);
  const [staleDraftCheckPending, setStaleDraftCheckPending] = useState(false);
  const [remapResult, setRemapResult] = useState<RemapSuggestResult | null>(
    null,
  );
  const [remapPending, setRemapPending] = useState(false);
  const [draftPersistWarning, setDraftPersistWarning] = useState<string | null>(
    null,
  );
  const [fieldValidationErrors, setFieldValidationErrors] =
    useState<FieldValidationErrors>({});
  const [scalarControlInputs, setScalarControlInputs] =
    useState<ScalarControlInputState>({});
  const [paddingControlInputs, setPaddingControlInputs] =
    useState<PaddingControlInputState>({});
  const [layoutControlInputs, setLayoutControlInputs] =
    useState<LayoutControlInputState>({});
  const [formValidationControlInputs, setFormValidationControlInputs] =
    useState<FormValidationControlInputState>({});
  const [regenerationAccepted, setRegenerationAccepted] =
    useState<RegenerationAcceptedPayload | null>(null);
  const [regenerationError, setRegenerationError] =
    useState<EndpointErrorDetails | null>(null);
  const [syncTargetPathInput, setSyncTargetPathInput] = useState("");
  const [syncConfirmationChecked, setSyncConfirmationChecked] = useState(false);
  const [syncFileDecisions, setSyncFileDecisions] = useState<
    Record<string, LocalSyncFileDecision>
  >({});
  const [syncPreviewPlan, setSyncPreviewPlan] =
    useState<LocalSyncDryRunPayload | null>(null);
  const [syncApplyResult, setSyncApplyResult] =
    useState<LocalSyncApplyPayload | null>(null);
  const [syncError, setSyncError] = useState<EndpointErrorDetails | null>(null);
  const [prRepoUrlInput, setPrRepoUrlInput] = useState("");
  const [prRepoTokenInput, setPrRepoTokenInput] = useState("");
  const [prTargetPathInput, setPrTargetPathInput] = useState("");
  const [prResult, setPrResult] = useState<CreatePrPayload | null>(null);
  const [prError, setPrError] = useState<EndpointErrorDetails | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY).matches;
  });

  const encodedJobId = encodeURIComponent(jobId);
  const inspectorPanelRef = useRef<HTMLDivElement>(null);
  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<SplitterDragState | null>(null);

  const activePipeline =
    pipeline?.jobId === jobId ? pipeline : IDLE_PIPELINE_STATE;
  const pipelineTreeNodes = useStreamingTreeNodes(activePipeline);

  const treeRecoveryError = useMemo(() => {
    for (let index = activePipeline.errors.length - 1; index >= 0; index -= 1) {
      const error = activePipeline.errors[index];
      if (
        error !== undefined &&
        (error.stage === "resolving" || error.stage === "transforming")
      ) {
        return error;
      }
    }
    return null;
  }, [activePipeline.errors]);

  const generatingRecoveryError = useMemo(() => {
    for (let index = activePipeline.errors.length - 1; index >= 0; index -= 1) {
      const error = activePipeline.errors[index];
      if (error !== undefined && error.stage === "generating") {
        return error;
      }
    }
    return null;
  }, [activePipeline.errors]);

  const generatingRetryTargets = useMemo(() => {
    return generatingRecoveryError?.retryTargets ?? [];
  }, [generatingRecoveryError]);

  const previewRecoveryMessage = useMemo(() => {
    if (
      activePipeline.stage !== "partial" &&
      activePipeline.stage !== "error" &&
      activePipeline.stage !== "generating"
    ) {
      return null;
    }
    if (
      typeof activePipeline.previewUrl === "string" &&
      activePipeline.previewUrl.trim().length > 0
    ) {
      return null;
    }
    if (activePipeline.screenshot) {
      return "Preview is unavailable for this run. Showing the captured screenshot instead.";
    }
    return "Preview is unavailable for this run. Retry generation to rebuild the preview.";
  }, [
    activePipeline.previewUrl,
    activePipeline.screenshot,
    activePipeline.stage,
  ]);

  const handleCopyPipelineReport = useCallback((): void => {
    const text = buildSanitizedPipelineReport({
      pipeline: {
        stage: activePipeline.stage,
        ...(activePipeline.outcome !== undefined
          ? { outcome: activePipeline.outcome }
          : {}),
        ...(activePipeline.jobId !== undefined
          ? { jobId: activePipeline.jobId }
          : {}),
        ...(activePipeline.jobStatus !== undefined
          ? { jobStatus: activePipeline.jobStatus }
          : {}),
        ...(activePipeline.fallbackMode !== undefined
          ? { fallbackMode: activePipeline.fallbackMode }
          : {}),
        ...(activePipeline.retryRequest !== undefined
          ? { retryRequest: activePipeline.retryRequest }
          : {}),
        stageProgress: activePipeline.stageProgress,
        errors: activePipeline.errors,
      },
      executionLog,
    });
    void navigator.clipboard.writeText(text);
  }, [
    executionLog,
    activePipeline.errors,
    activePipeline.fallbackMode,
    activePipeline.jobId,
    activePipeline.jobStatus,
    activePipeline.outcome,
    activePipeline.retryRequest,
    activePipeline.stage,
    activePipeline.stageProgress,
  ]);

  const handleRetryCurrentPipeline = useCallback((): void => {
    onPipelineRetry?.(
      activePipeline.retryRequest?.stage,
      activePipeline.retryRequest?.targetIds,
    );
  }, [activePipeline.retryRequest, onPipelineRetry]);

  const handleRetryGeneratingTarget = useCallback(
    (targetId: string): void => {
      onPipelineRetry?.("generating", [targetId]);
    },
    [onPipelineRetry],
  );

  // --- Queries ---

  const filesQuery = useQuery({
    queryKey: ["inspector-files", jobId],
    queryFn: async () => {
      return await fetchJson<FilesPayload>({
        url: `/workspace/jobs/${encodedJobId}/files`,
      });
    },
    staleTime: Infinity,
  });

  const manifestQuery = useQuery({
    queryKey: ["inspector-manifest", jobId],
    queryFn: async () => {
      return await fetchJson<ComponentManifestPayload>({
        url: `/workspace/jobs/${encodedJobId}/component-manifest`,
      });
    },
    staleTime: Infinity,
  });

  const designIrQuery = useQuery({
    queryKey: ["inspector-design-ir", jobId],
    queryFn: async () => {
      return await fetchJson<DesignIrPayload>({
        url: `/workspace/jobs/${encodedJobId}/design-ir`,
      });
    },
    staleTime: Infinity,
  });

  const generationMetricsQuery = useQuery({
    queryKey: ["inspector-generation-metrics", jobId],
    queryFn: async (): Promise<GenerationMetricsResponse> => {
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent("generation-metrics.json")}`,
        );
        const body = await response.text();

        if (!response.ok) {
          let parsedPayload: unknown = null;
          if (body.trim()) {
            try {
              parsedPayload = JSON.parse(body) as unknown;
            } catch {
              parsedPayload = null;
            }
          }

          const error = toEndpointError({
            status: response.status,
            payload: parsedPayload,
            fallbackCode: "GENERATION_METRICS_NOT_FOUND",
            fallbackMessage:
              "generation-metrics.json is unavailable for this job.",
          });

          return {
            ok: false,
            status: error.status,
            payload: null,
            error: error.code,
            message: error.message,
          };
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          return {
            ok: false,
            status: response.status,
            payload: null,
            error: "GENERATION_METRICS_INVALID_JSON",
            message: "generation-metrics.json is not valid JSON.",
          };
        }

        if (!isGenerationMetricsPayload(payload)) {
          return {
            ok: false,
            status: response.status,
            payload: null,
            error: "GENERATION_METRICS_INVALID_PAYLOAD",
            message: "generation-metrics.json payload is invalid.",
          };
        }

        return {
          ok: true,
          status: response.status,
          payload,
          error: null,
          message: null,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          payload: null,
          error: "GENERATION_METRICS_FETCH_FAILED",
          message: "generation-metrics.json could not be loaded.",
        };
      }
    },
    staleTime: Infinity,
  });

  const workspacePolicyQuery = useQuery({
    queryKey: ["inspector-workspace-policy"],
    queryFn: async () => {
      return await fetchJson<WorkspacePolicyPayload>({
        url: "/workspace/inspector-policy",
      });
    },
    staleTime: Infinity,
  });

  const regenerateMutation = useMutation({
    mutationFn: async (): Promise<RegenerationAcceptedPayload> => {
      if (!overrideDraft) {
        throw new RegenerationMutationError({
          status: 409,
          code: "REGEN_DRAFT_UNAVAILABLE",
          message: "Override draft is not ready yet.",
        });
      }

      const structuredPayload =
        toStructuredInspectorOverridePayload(overrideDraft);
      const response = await fetchJson<RegenerationAcceptedPayload>({
        url: `/workspace/jobs/${encodedJobId}/regenerate`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            overrides: structuredPayload.overrides,
            draftId: structuredPayload.draftId,
            baseFingerprint: structuredPayload.baseFingerprint,
          }),
        },
      });

      if (!response.ok) {
        throw new RegenerationMutationError(
          toEndpointError({
            status: response.status,
            payload: response.payload,
            fallbackCode: "REGEN_SUBMIT_FAILED",
            fallbackMessage: "Could not submit regeneration job.",
          }),
        );
      }

      if (!isRegenerationAcceptedPayload(response.payload)) {
        throw new RegenerationMutationError({
          status: response.status,
          code: "REGEN_INVALID_PAYLOAD",
          message: "Regeneration acceptance payload is invalid.",
        });
      }

      return response.payload;
    },
    onSuccess: (payload) => {
      setRegenerationAccepted(payload);
      setRegenerationError(null);
      onRegenerationAccepted?.(payload.jobId);
    },
    onError: (error) => {
      if (error instanceof RegenerationMutationError) {
        setRegenerationError(error.details);
        return;
      }
      setRegenerationError({
        status: 500,
        code: "REGEN_SUBMIT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Could not submit regeneration job.",
      });
    },
  });

  const previewSyncMutation = useMutation({
    mutationFn: async ({
      targetPath,
    }: {
      targetPath: string;
    }): Promise<LocalSyncDryRunPayload> => {
      const normalizedTargetPath = targetPath.trim();
      const response = await fetchJson<LocalSyncDryRunPayload>({
        url: `/workspace/jobs/${encodedJobId}/sync`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "dry_run",
            ...(normalizedTargetPath.length > 0
              ? { targetPath: normalizedTargetPath }
              : {}),
          }),
        },
      });

      if (!response.ok) {
        throw new SyncMutationError(
          toEndpointError({
            status: response.status,
            payload: response.payload,
            fallbackCode: "SYNC_PREVIEW_FAILED",
            fallbackMessage: "Could not generate sync preview.",
          }),
        );
      }

      if (!isLocalSyncDryRunPayload(response.payload)) {
        throw new SyncMutationError({
          status: response.status,
          code: "SYNC_PREVIEW_INVALID_PAYLOAD",
          message: "Local sync preview payload is invalid.",
        });
      }

      return response.payload;
    },
    onSuccess: (payload) => {
      setSyncPreviewPlan(payload);
      setSyncFileDecisions(createLocalSyncDecisionMap(payload.files));
      setSyncApplyResult(null);
      setSyncConfirmationChecked(false);
      setSyncError(null);
    },
    onError: (error) => {
      setSyncError(
        toSyncErrorDetails({
          error,
          fallback: {
            status: 500,
            code: "SYNC_PREVIEW_FAILED",
            message: "Could not generate sync preview.",
          },
        }),
      );
    },
  });

  const applySyncMutation = useMutation({
    mutationFn: async (): Promise<LocalSyncApplyPayload> => {
      if (!syncPreviewPlan) {
        throw new SyncMutationError({
          status: 409,
          code: "SYNC_PREVIEW_REQUIRED",
          message: "Preview the sync plan before apply.",
        });
      }

      const fileDecisions: LocalSyncFileDecisionEntry[] =
        syncPreviewPlan.files.map((entry) => ({
          path: entry.path,
          decision: syncFileDecisions[entry.path] ?? entry.decision,
        }));

      const response = await fetchJson<LocalSyncApplyPayload>({
        url: `/workspace/jobs/${encodedJobId}/sync`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "apply",
            confirmationToken: syncPreviewPlan.confirmationToken,
            confirmOverwrite: true,
            fileDecisions,
          }),
        },
      });

      if (!response.ok) {
        throw new SyncMutationError(
          toEndpointError({
            status: response.status,
            payload: response.payload,
            fallbackCode: "SYNC_APPLY_FAILED",
            fallbackMessage: "Could not apply local sync.",
          }),
        );
      }

      if (!isLocalSyncApplyPayload(response.payload)) {
        throw new SyncMutationError({
          status: response.status,
          code: "SYNC_APPLY_INVALID_PAYLOAD",
          message: "Local sync apply payload is invalid.",
        });
      }

      return response.payload;
    },
    onSuccess: (payload) => {
      setSyncApplyResult(payload);
      setSyncPreviewPlan(null);
      setSyncFileDecisions({});
      setSyncConfirmationChecked(false);
      setSyncError(null);
    },
    onError: (error) => {
      setSyncError(
        toSyncErrorDetails({
          error,
          fallback: {
            status: 500,
            code: "SYNC_APPLY_FAILED",
            message: "Could not apply local sync.",
          },
        }),
      );
    },
  });

  const effectiveSyncPreviewFiles = useMemo(() => {
    if (!syncPreviewPlan) {
      return [];
    }

    return syncPreviewPlan.files.map((entry) => ({
      ...entry,
      decision: syncFileDecisions[entry.path] ?? entry.decision,
    }));
  }, [syncFileDecisions, syncPreviewPlan]);

  const effectiveSyncSummary = useMemo<LocalSyncSummary | null>(() => {
    if (!syncPreviewPlan) {
      return null;
    }

    return effectiveSyncPreviewFiles.reduce<LocalSyncSummary>(
      (summary, entry) => {
        summary.totalFiles += 1;
        summary.totalBytes += entry.sizeBytes;
        if (entry.decision === "write") {
          summary.selectedFiles += 1;
          summary.selectedBytes += entry.sizeBytes;
        }
        if (entry.status === "create") {
          summary.createCount += 1;
        } else if (entry.status === "overwrite") {
          summary.overwriteCount += 1;
        } else if (entry.status === "conflict") {
          summary.conflictCount += 1;
        } else if (entry.status === "untracked") {
          summary.untrackedCount += 1;
        } else {
          summary.unchangedCount += 1;
        }
        return summary;
      },
      {
        totalFiles: 0,
        selectedFiles: 0,
        createCount: 0,
        overwriteCount: 0,
        conflictCount: 0,
        untrackedCount: 0,
        unchangedCount: 0,
        totalBytes: 0,
        selectedBytes: 0,
      },
    );
  }, [effectiveSyncPreviewFiles, syncPreviewPlan]);

  const createPrMutation = useMutation({
    mutationFn: async (): Promise<CreatePrPayload> => {
      if (!prRepoUrlInput.trim() || !prRepoTokenInput.trim()) {
        throw new PrMutationError({
          status: 0,
          code: "PR_PREREQUISITES_MISSING",
          message: "Repository URL and token are required to create a PR.",
        });
      }

      const body: Record<string, string> = {
        repoUrl: prRepoUrlInput.trim(),
        repoToken: prRepoTokenInput.trim(),
      };
      if (prTargetPathInput.trim()) {
        body.targetPath = prTargetPathInput.trim();
      }

      const response = await fetchJson<CreatePrPayload>({
        url: `/workspace/jobs/${encodedJobId}/create-pr`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      });

      if (!response.ok) {
        throw new PrMutationError(
          toEndpointError({
            status: response.status,
            payload: response.payload,
            fallbackCode: "PR_CREATE_FAILED",
            fallbackMessage: "Could not create PR.",
          }),
        );
      }

      if (!isCreatePrPayload(response.payload)) {
        throw new PrMutationError({
          status: response.status,
          code: "PR_CREATE_INVALID_PAYLOAD",
          message: "PR creation payload is invalid.",
        });
      }

      return response.payload;
    },
    onSuccess: (payload) => {
      setPrResult(payload);
      setPrError(null);
    },
    onError: (error) => {
      if (error instanceof PrMutationError) {
        setPrError(error.details);
      } else {
        setPrError({
          status: 500,
          code: "PR_CREATE_FAILED",
          message:
            error instanceof Error ? error.message : "Could not create PR.",
        });
      }
    },
  });

  useEffect(() => {
    setSelectedFile(null);
    setAutoSelectedFile(null);
    setHighlightRange(null);
    setRegenerationAccepted(null);
    setRegenerationError(null);
    setSyncTargetPathInput("");
    setSyncConfirmationChecked(false);
    setSyncPreviewPlan(null);
    setSyncApplyResult(null);
    setSyncError(null);
    setPrRepoUrlInput("");
    setPrRepoTokenInput("");
    setPrTargetPathInput("");
    setPrResult(null);
    setPrError(null);
  }, [jobId]);

  // --- Derived data ---

  const filesState = useMemo<{
    status: InspectorSourceStatus;
    files: FileEntry[];
    error: EndpointErrorDetails | null;
  }>(() => {
    if (filesQuery.isLoading) {
      return { status: "loading", files: [], error: null };
    }

    if (!filesQuery.data) {
      return { status: "loading", files: [], error: null };
    }

    if (!filesQuery.data.ok) {
      return {
        status: "error",
        files: [],
        error: toEndpointError({
          status: filesQuery.data.status,
          payload: filesQuery.data.payload,
          fallbackCode: "FILES_FETCH_FAILED",
          fallbackMessage: "Could not load generated files.",
        }),
      };
    }

    if (!isFilesPayload(filesQuery.data.payload)) {
      return {
        status: "error",
        files: [],
        error: {
          status: filesQuery.data.status,
          code: "FILES_INVALID_PAYLOAD",
          message: "Generated files response payload is invalid.",
        },
      };
    }

    if (filesQuery.data.payload.files.length === 0) {
      return {
        status: "empty",
        files: [],
        error: null,
      };
    }

    return {
      status: "ready",
      files: filesQuery.data.payload.files,
      error: null,
    };
  }, [filesQuery.data, filesQuery.isLoading]);

  // When the paste pipeline has already delivered generated files, treat the
  // code pane as "ready" regardless of the React Query loading/error state.
  // This enables the file selector and auto-selects the first file during the
  // generating stage, rather than showing a disabled selector while files are
  // already available from the live pipeline. (issue #1006)
  const effectiveFilesState = useMemo<{
    status: InspectorSourceStatus;
    files: FileEntry[];
    error: EndpointErrorDetails | null;
  }>(() => {
    const pipelineFiles = activePipeline.generatedFiles;
    if (
      pipelineFiles !== undefined &&
      pipelineFiles.length > 0 &&
      filesState.status !== "ready"
    ) {
      return { status: "ready", files: pipelineFiles, error: null };
    }
    return filesState;
  }, [activePipeline.generatedFiles, filesState]);

  const manifestState = useMemo<{
    status: InspectorSourceStatus;
    manifest: ComponentManifestPayload | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (manifestQuery.isLoading) {
      return { status: "loading", manifest: null, error: null };
    }

    if (!manifestQuery.data) {
      return { status: "loading", manifest: null, error: null };
    }

    if (!manifestQuery.data.ok) {
      return {
        status: "error",
        manifest: null,
        error: toEndpointError({
          status: manifestQuery.data.status,
          payload: manifestQuery.data.payload,
          fallbackCode: "MANIFEST_FETCH_FAILED",
          fallbackMessage: "Could not load component manifest.",
        }),
      };
    }

    if (!isComponentManifestPayload(manifestQuery.data.payload)) {
      return {
        status: "error",
        manifest: null,
        error: {
          status: manifestQuery.data.status,
          code: "MANIFEST_INVALID_PAYLOAD",
          message: "Component manifest payload is invalid.",
        },
      };
    }

    if (manifestQuery.data.payload.screens.length === 0) {
      return {
        status: "empty",
        manifest: null,
        error: null,
      };
    }

    return {
      status: "ready",
      manifest: manifestQuery.data.payload,
      error: null,
    };
  }, [manifestQuery.data, manifestQuery.isLoading]);

  const designIrState = useMemo<{
    status: InspectorSourceStatus;
    screens: DesignIrScreen[];
    treeNodes: TreeNode[];
    error: EndpointErrorDetails | null;
  }>(() => {
    if (designIrQuery.isLoading) {
      return { status: "loading", screens: [], treeNodes: [], error: null };
    }

    if (!designIrQuery.data) {
      return { status: "loading", screens: [], treeNodes: [], error: null };
    }

    if (!designIrQuery.data.ok) {
      return {
        status: "error",
        screens: [],
        treeNodes: [],
        error: toEndpointError({
          status: designIrQuery.data.status,
          payload: designIrQuery.data.payload,
          fallbackCode: "DESIGN_IR_FETCH_FAILED",
          fallbackMessage: "Could not load design IR.",
        }),
      };
    }

    if (!isDesignIrPayload(designIrQuery.data.payload)) {
      return {
        status: "error",
        screens: [],
        treeNodes: [],
        error: {
          status: designIrQuery.data.status,
          code: "DESIGN_IR_INVALID_PAYLOAD",
          message: "Design IR payload is invalid.",
        },
      };
    }

    if (designIrQuery.data.payload.screens.length === 0) {
      return {
        status: "empty",
        screens: [],
        treeNodes: [],
        error: null,
      };
    }

    return {
      status: "ready",
      screens: designIrQuery.data.payload.screens,
      treeNodes: irScreensToTreeNodes(designIrQuery.data.payload.screens),
      error: null,
    };
  }, [designIrQuery.data, designIrQuery.isLoading]);

  const generationMetricsState = useMemo<{
    status: InspectabilityAvailability;
    metrics: InspectabilityGenerationMetricsPayload | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (generationMetricsQuery.isLoading) {
      return {
        status: "loading",
        metrics: null,
        error: null,
      };
    }

    if (!generationMetricsQuery.data) {
      return {
        status: "loading",
        metrics: null,
        error: null,
      };
    }

    if (
      !generationMetricsQuery.data.ok ||
      !generationMetricsQuery.data.payload
    ) {
      return {
        status: "unavailable",
        metrics: null,
        error: {
          status: generationMetricsQuery.data.status,
          code:
            generationMetricsQuery.data.error ??
            "GENERATION_METRICS_FETCH_FAILED",
          message:
            generationMetricsQuery.data.message ??
            "generation-metrics.json is unavailable for this job.",
        },
      };
    }

    return {
      status: "ready",
      metrics: generationMetricsQuery.data.payload,
      error: null,
    };
  }, [generationMetricsQuery.data, generationMetricsQuery.isLoading]);

  const files = effectiveFilesState.files;
  const manifest =
    manifestState.status === "ready"
      ? manifestState.manifest
      : (activePipeline.componentManifest ?? manifestState.manifest);
  const queryTreeNodes = designIrState.treeNodes;
  const effectiveTreeNodes =
    designIrState.status === "ready"
      ? queryTreeNodes
      : pipelineTreeNodes.length > 0
        ? pipelineTreeNodes
        : queryTreeNodes;
  const treeNodes = effectiveTreeNodes;
  const irScreens =
    designIrState.status === "ready"
      ? designIrState.screens
      : (activePipeline.designIR?.screens ?? designIrState.screens);
  const selectedIrNode = useMemo<DesignIrElementNode | null>(() => {
    if (!selectedNodeId) {
      return null;
    }
    return findIrElementNode(irScreens, selectedNodeId);
  }, [irScreens, selectedNodeId]);

  // Issue #993 — quality score + token intelligence + a11y nudges.
  const workspacePolicy = useMemo(() => {
    const payload = workspacePolicyQuery.data?.payload;
    if (
      workspacePolicyQuery.data?.ok &&
      isWorkspacePolicyPayload(payload)
    ) {
      return resolveWorkspacePolicy(payload.policy ?? null);
    }
    return resolveWorkspacePolicy();
  }, [workspacePolicyQuery.data]);
  const qualityScoreModel = useMemo(() => {
    const screens = irScreens.map((screen) => ({
      id: screen.id,
      name: screen.name,
      children: screen.children as QualityScoreElementInput[],
    }));
    return deriveQualityScore({
      screens,
      diagnostics: activePipeline.figmaAnalysis?.diagnostics ?? [],
      errors: activePipeline.errors,
      ...(manifest ? { manifest } : {}),
      policy: workspacePolicy.quality,
    });
  }, [
    irScreens,
    manifest,
    activePipeline.errors,
    activePipeline.figmaAnalysis?.diagnostics,
    workspacePolicy.quality,
  ]);

  const tokenSuggestionsModel = useMemo(() => {
    const intelligence = activePipeline.tokenIntelligence;
    return deriveTokenSuggestionModel({
      ...(intelligence
        ? {
            intelligence: {
              conflicts: intelligence.conflicts,
              unmappedVariables: intelligence.unmappedVariables,
              libraryKeys: intelligence.libraryKeys,
              cssCustomProperties: intelligence.cssCustomProperties,
            },
          }
        : {}),
      policy: workspacePolicy.tokens,
    });
  }, [activePipeline.tokenIntelligence, workspacePolicy.tokens]);

  // Collect JSX-like files so we fetch only what the a11y scanner can parse.
  // Filtering rules and caps are extracted into pure helpers so they can be
  // unit-tested in isolation; see `a11y-file-selection.ts`.
  const jsxLikeFiles = useMemo(() => selectA11yScanFiles(files), [files]);

  const a11yFileContentQueries = useQueries({
    queries: jsxLikeFiles.map((file) => ({
      queryKey: ["inspector-a11y-file", jobId, file.path] as const,
      enabled: Boolean(jobId && file.path),
      staleTime: 30_000,
      queryFn: async (): Promise<string | null> => {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(file.path)}`,
        );
        if (!response.ok) return null;
        return response.text();
      },
    })),
  });

  const a11yNudgeInputs = useMemo(() => {
    const fetched = a11yFileContentQueries.map((query) => query.data ?? null);
    return mergeA11yScanInputs(jsxLikeFiles, fetched);
  }, [jsxLikeFiles, a11yFileContentQueries]);

  const a11yNudgeModel = useMemo(() => {
    return deriveA11yNudges({
      files: a11yNudgeInputs,
      policy: workspacePolicy.a11y,
    });
  }, [a11yNudgeInputs, workspacePolicy.a11y]);

  const [tokenDecisionsStatus, setTokenDecisionsStatus] = useState<{
    state: "idle" | "saving" | "saved" | "error";
    message?: string;
    updatedAt?: string | null;
  }>({ state: "idle" });

  const handleApplyTokenDecisions = useCallback(
    (decisions: {
      acceptedTokenNames: string[];
      rejectedTokenNames: string[];
    }): void => {
      if (!jobId) {
        setTokenDecisionsStatus({
          state: "error",
          message: "Cannot save: job id is missing.",
        });
        return;
      }
      setTokenDecisionsStatus({ state: "saving" });
      void (async () => {
        try {
          const response = await postTokenDecisions({
            jobId,
            acceptedTokenNames: decisions.acceptedTokenNames,
            rejectedTokenNames: decisions.rejectedTokenNames,
          });
          setTokenDecisionsStatus({
            state: "saved",
            updatedAt: response.updatedAt,
          });
        } catch (error) {
          setTokenDecisionsStatus({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to persist token decisions.",
          });
        }
      })();
    },
    [jobId],
  );
  const selectedIrNodeData = useMemo<
    | (DesignIrElementNode &
        Partial<
          ScalarOverrideValueByField &
            LayoutOverrideValueByField &
            FormValidationOverrideValueByField
        >)
    | null
  >(() => {
    if (!selectedIrNode) {
      return null;
    }
    return selectedIrNode;
  }, [selectedIrNode]);
  const scalarFieldSupport = useMemo(() => {
    if (!selectedIrNodeData) {
      return [];
    }
    return deriveScalarOverrideFieldSupport(selectedIrNodeData);
  }, [selectedIrNodeData]);
  const editableScalarFields = useMemo(() => {
    return scalarFieldSupport
      .filter((entry) => entry.supported)
      .map((entry) => entry.field);
  }, [scalarFieldSupport]);
  const unsupportedScalarFields = useMemo(() => {
    return scalarFieldSupport.filter((entry) => !entry.supported);
  }, [scalarFieldSupport]);
  const effectiveLayoutMode = useMemo<LayoutModeOverrideValue>(() => {
    if (!selectedNodeId || !selectedIrNodeData) {
      return "NONE";
    }
    const overrideValue = overrideDraft
      ? getInspectorOverrideValue({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field: "layoutMode",
        })
      : null;
    return (
      resolveLayoutModeValue(overrideValue ?? selectedIrNodeData.layoutMode) ??
      "NONE"
    );
  }, [overrideDraft, selectedIrNodeData, selectedNodeId]);
  const layoutFieldSupport = useMemo(() => {
    if (!selectedIrNodeData) {
      return [];
    }
    return deriveLayoutOverrideFieldSupport({
      nodeData: selectedIrNodeData,
      effectiveLayoutMode,
    });
  }, [effectiveLayoutMode, selectedIrNodeData]);
  const editableLayoutFields = useMemo(() => {
    return layoutFieldSupport
      .filter((entry) => entry.supported)
      .map((entry) => entry.field);
  }, [layoutFieldSupport]);
  const unsupportedLayoutFields = useMemo(() => {
    return layoutFieldSupport.filter((entry) => {
      if (entry.supported) {
        return false;
      }
      if (
        effectiveLayoutMode === "NONE" &&
        (entry.field === "primaryAxisAlignItems" ||
          entry.field === "counterAxisAlignItems")
      ) {
        return false;
      }
      return true;
    });
  }, [effectiveLayoutMode, layoutFieldSupport]);
  const formValidationFieldSupport = useMemo(() => {
    if (!selectedIrNodeData) {
      return [];
    }
    return deriveFormValidationOverrideFieldSupport(selectedIrNodeData);
  }, [selectedIrNodeData]);
  const editableFormValidationFields = useMemo(() => {
    return formValidationFieldSupport
      .filter((entry) => entry.supported)
      .map((entry) => entry.field);
  }, [formValidationFieldSupport]);
  const unsupportedFormValidationFields = useMemo(() => {
    return formValidationFieldSupport.filter((entry) => !entry.supported);
  }, [formValidationFieldSupport]);
  const baseFingerprint = useMemo(() => {
    if (designIrState.status !== "ready") {
      return null;
    }
    return computeInspectorDraftBaseFingerprint({ screens: irScreens });
  }, [designIrState.status, irScreens]);

  const handleStaleDraftDecision = useCallback(
    (decision: StaleDraftDecision | "remap") => {
      if (!baseFingerprint) {
        return;
      }

      if (decision === "continue") {
        setStaleDraftCheckResult(null);
        setDraftStale(false);
        return;
      }

      if (decision === "discard") {
        setStaleDraftCheckResult(null);
        setDraftStale(false);
        setDraftRestoreWarning(null);
        setRemapResult(null);
        setOverrideDraft(
          createInspectorOverrideDraft({
            sourceJobId: jobId,
            baseFingerprint,
          }),
        );
        return;
      }

      if (decision === "carry-forward") {
        if (!overrideDraft || !staleDraftCheckResult?.latestJobId) {
          return;
        }
        const carried = carryForwardDraft({
          staleDraft: overrideDraft,
          newJobId: staleDraftCheckResult.latestJobId,
          newBaseFingerprint: baseFingerprint,
        });
        setStaleDraftCheckResult(null);
        setDraftStale(false);
        setDraftRestoreWarning(null);
        setRemapResult(null);
        setOverrideDraft(carried);
      }

      if (decision === "remap") {
        if (
          !staleDraftCheckResult?.latestJobId ||
          staleDraftCheckResult.unmappedNodeIds.length === 0
        ) {
          return;
        }
        setRemapPending(true);
        const encodedId = encodeURIComponent(jobId);
        fetch(`/workspace/jobs/${encodedId}/remap-suggest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceJobId: staleDraftCheckResult.sourceJobId,
            latestJobId: staleDraftCheckResult.latestJobId,
            unmappedNodeIds: staleDraftCheckResult.unmappedNodeIds,
          }),
        })
          .then((res) => res.json() as Promise<RemapSuggestResult>)
          .then((result) => {
            setRemapResult(result);
          })
          .catch(() => {
            setRemapResult(null);
          })
          .finally(() => {
            setRemapPending(false);
          });
      }
    },
    [baseFingerprint, jobId, overrideDraft, staleDraftCheckResult],
  );

  const handleRemapApply = useCallback(
    (decisions: RemapDecisionEntry[]) => {
      if (
        !overrideDraft ||
        !staleDraftCheckResult?.latestJobId ||
        !baseFingerprint
      ) {
        return;
      }

      // Build node ID remap map from accepted decisions
      const remapMap = new Map<string, string>();
      for (const decision of decisions) {
        if (decision.accepted && decision.targetNodeId) {
          remapMap.set(decision.sourceNodeId, decision.targetNodeId);
        }
      }

      // Remap draft entries: update nodeIds for accepted remaps, keep others unchanged
      const remappedEntries = overrideDraft.entries.map((entry) => {
        const newNodeId = remapMap.get(entry.nodeId);
        if (newNodeId) {
          return {
            ...entry,
            id: `${newNodeId}:${entry.field}`,
            nodeId: newNodeId,
            updatedAt: new Date().toISOString(),
          };
        }
        return entry;
      });

      // Carry forward the remapped draft to the latest job
      const carried = carryForwardDraft({
        staleDraft: { ...overrideDraft, entries: remappedEntries },
        newJobId: staleDraftCheckResult.latestJobId,
        newBaseFingerprint: baseFingerprint,
      });

      setStaleDraftCheckResult(null);
      setDraftStale(false);
      setDraftRestoreWarning(null);
      setRemapResult(null);
      setOverrideDraft(carried);
    },
    [baseFingerprint, overrideDraft, staleDraftCheckResult],
  );

  const handleRemapCancel = useCallback(() => {
    setRemapResult(null);
  }, []);

  const inspectabilitySummary = useMemo(() => {
    return deriveInspectabilitySummary({
      designIrStatus: designIrState.status,
      designIrScreens: irScreens,
      manifestStatus: manifestState.status,
      manifest,
      metricsStatus: generationMetricsState.status,
      metrics: generationMetricsState.metrics,
    });
  }, [
    designIrState.status,
    generationMetricsState.metrics,
    generationMetricsState.status,
    irScreens,
    manifest,
    manifestState.status,
  ]);

  const nodeDiagnosticsMap = useMemo(() => {
    const metricsPayload = generationMetricsState.metrics as
      | (InspectabilityGenerationMetricsPayload & {
          nodeDiagnostics?: RawNodeDiagnosticEntry[];
        })
      | null;
    return deriveNodeDiagnosticsMap({
      metricsNodeDiagnostics: metricsPayload?.nodeDiagnostics ?? null,
      designIrStatus: designIrState.status,
      designIrScreens: irScreens,
      manifestStatus: manifestState.status,
      manifest,
    });
  }, [
    designIrState.status,
    generationMetricsState.metrics,
    irScreens,
    manifest,
    manifestState.status,
  ]);

  const hasTreePane = designIrState.status !== "ready" || treeNodes.length > 0;
  const hasExpandedTree =
    designIrState.status === "ready"
      ? hasTreePane && !treeCollapsed
      : hasTreePane;
  const treeSelectionEnabled =
    designIrState.status === "ready" ||
    ((activePipeline.stage === "generating" ||
      activePipeline.stage === "ready") &&
      ((activePipeline.componentManifest?.screens.length ?? 0) > 0 ||
        (activePipeline.generatedFiles?.length ?? 0) > 0)) ||
    activePipeline.stage === "ready" ||
    activePipeline.stage === "partial";

  const layoutStorageKey = useMemo(() => {
    return toInspectorLayoutStorageKey(jobId);
  }, [jobId]);

  const getLayoutContainerWidth = useCallback((): number => {
    return getContainerWidthPx(
      layoutContainerRef.current?.getBoundingClientRect().width,
    );
  }, []);

  const persistPaneLayout = useCallback(
    (nextRatios: InspectorPaneRatios) => {
      saveInspectorPaneRatios({
        storageKey: layoutStorageKey,
        ratios: nextRatios,
      });
    },
    [layoutStorageKey],
  );

  const applyResizeDelta = useCallback(
    ({
      separator,
      deltaPx,
      sourceRatios,
      widthPxOverride,
    }: {
      separator: PaneSeparator;
      deltaPx: number;
      sourceRatios: InspectorPaneRatios;
      widthPxOverride?: number;
    }): InspectorPaneRatios => {
      const widthPx = widthPxOverride ?? getLayoutContainerWidth();

      if (separator === "tree-preview") {
        if (!hasExpandedTree) {
          return sourceRatios;
        }

        return resizeTreePreviewPane({
          ratios: sourceRatios,
          widthPx,
          deltaPx,
        });
      }

      return resizePreviewCodePanes({
        ratios: sourceRatios,
        widthPx,
        deltaPx,
        treeCollapsed: !hasExpandedTree,
      });
    },
    [getLayoutContainerWidth, hasExpandedTree],
  );

  const lockDocumentForSplitterDrag = useCallback((): (() => void) => {
    if (typeof document === "undefined") {
      return () => {};
    }

    const root = document.documentElement;
    const body = document.body;
    const previousRootCursor = root.style.cursor;
    const previousBodyCursor = body.style.cursor;
    const previousBodyUserSelect = body.style.userSelect;

    root.style.cursor = "col-resize";
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";

    return () => {
      root.style.cursor = previousRootCursor;
      body.style.cursor = previousBodyCursor;
      body.style.userSelect = previousBodyUserSelect;
    };
  }, []);

  const clearActiveSplitterDrag = useCallback(
    ({ releaseCapture }: { releaseCapture: boolean }) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }

      dragStateRef.current = null;
      state.unlockDocument();

      if (
        !releaseCapture ||
        typeof state.element.releasePointerCapture !== "function"
      ) {
        return;
      }

      try {
        if (
          typeof state.element.hasPointerCapture !== "function" ||
          state.element.hasPointerCapture(state.pointerId)
        ) {
          state.element.releasePointerCapture(state.pointerId);
        }
      } catch {
        // The browser may already have released capture; cleanup has already happened.
      }
    },
    [],
  );

  const resolveDragResizeRatios = useCallback(
    (state: SplitterDragState, clientX: number): InspectorPaneRatios => {
      return applyResizeDelta({
        separator: state.separator,
        deltaPx: clientX - state.startX,
        sourceRatios: state.startRatios,
        widthPxOverride: state.startWidthPx,
      });
    },
    [applyResizeDelta],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY);
    const handleChange = (): void => {
      setIsDesktopLayout(mediaQuery.matches);
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    const loaded = loadInspectorPaneRatios(layoutStorageKey);
    if (loaded) {
      setPaneRatios(loaded);
      return;
    }
    setPaneRatios(DEFAULT_INSPECTOR_PANE_RATIOS);
  }, [layoutStorageKey]);

  useEffect(() => {
    return () => {
      clearActiveSplitterDrag({ releaseCapture: false });
    };
  }, [clearActiveSplitterDrag]);

  // --- Edit history: push draft state on every edit mutation ---

  const commitDraftEdit = useCallback((nextDraft: InspectorOverrideDraft) => {
    setOverrideDraft(nextDraft);
    setEditHistory((current) => pushEditHistory(current, nextDraft));
  }, []);

  const focusInspectorFindInput = useCallback((): boolean => {
    const root = inspectorPanelRef.current;
    if (!root) {
      return false;
    }

    for (const selector of [
      "[data-testid='diff-viewer-find-input']",
      "[data-testid='code-viewer-find-input']",
    ]) {
      const candidates = Array.from(
        root.querySelectorAll<HTMLInputElement>(selector),
      );
      const target = candidates.find((candidate) => {
        return !candidate.disabled && candidate.getClientRects().length > 0;
      });
      if (!target) {
        continue;
      }

      target.focus();
      target.select();
      return true;
    }

    return false;
  }, []);

  const handleEditUndo = useCallback(() => {
    setEditHistory((current) => {
      if (!canUndo(current)) {
        return current;
      }
      const result = undoEditHistory(current);
      if (result.draft) {
        setOverrideDraft(result.draft);
      }
      return result.history;
    });
  }, []);

  const handleEditRedo = useCallback(() => {
    setEditHistory((current) => {
      if (!canRedo(current)) {
        return current;
      }
      const result = redoEditHistory(current);
      if (result.draft) {
        setOverrideDraft(result.draft);
      }
      return result.history;
    });
  }, []);

  const handleCreateSnapshot = useCallback(
    (label?: string) => {
      if (!overrideDraft) {
        return;
      }
      setSnapshotStore((current) => {
        const result = createDraftSnapshot(current, overrideDraft, label);
        return result.store;
      });
    },
    [overrideDraft],
  );

  // --- Shortcut help: toggle on `?` key (skip when text input is focused) ---
  // --- Edit history shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Shift+S ---

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleShortcutKey = (event: KeyboardEvent): void => {
      // Do not trigger when a text input, textarea, or contenteditable is focused
      const target = event.target as HTMLElement | null;
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : target;
      const isTextInput =
        activeElement != null &&
        typeof activeElement.tagName === "string" &&
        (activeElement.tagName.toLowerCase() === "input" ||
          activeElement.tagName.toLowerCase() === "textarea" ||
          activeElement.isContentEditable);

      // `?` toggles shortcut help — only outside text inputs
      if (event.key === "?" && !isTextInput) {
        event.preventDefault();
        setShortcutHelpOpen((prev) => !prev);
        return;
      }

      // Edit history shortcuts — only outside text inputs so native undo/redo
      // in text fields remains intact.
      if (isTextInput) {
        return;
      }

      const isModKey = event.metaKey || event.ctrlKey;
      const activeElementNode =
        activeElement instanceof Node
          ? activeElement
          : target instanceof Node
            ? target
            : null;
      const isFocusInsideInspector =
        activeElementNode !== null &&
        (activeElementNode === document.body ||
          inspectorPanelRef.current?.contains(activeElementNode));

      if (
        isModKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        isFocusInsideInspector
      ) {
        if (focusInspectorFindInput()) {
          event.preventDefault();
          return;
        }
      }

      // Ctrl/Cmd+Z — undo
      if (isModKey && !event.shiftKey && event.key === "z") {
        event.preventDefault();
        handleEditUndo();
        return;
      }

      // Ctrl/Cmd+Shift+Z — redo
      if (
        isModKey &&
        event.shiftKey &&
        (event.key === "z" || event.key === "Z")
      ) {
        event.preventDefault();
        handleEditRedo();
        return;
      }

      // Ctrl/Cmd+Shift+S — create snapshot
      if (
        isModKey &&
        event.shiftKey &&
        (event.key === "s" || event.key === "S")
      ) {
        event.preventDefault();
        handleCreateSnapshot();
        return;
      }
    };

    window.addEventListener("keydown", handleShortcutKey);
    return () => {
      window.removeEventListener("keydown", handleShortcutKey);
    };
  }, [
    focusInspectorFindInput,
    handleEditUndo,
    handleEditRedo,
    handleCreateSnapshot,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.sessionStorage.setItem(
        BOUNDARIES_SESSION_STORAGE_KEY,
        boundariesEnabled ? "1" : "0",
      );
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
  }, [boundariesEnabled]);

  useEffect(() => {
    if (!baseFingerprint) {
      setOverrideDraft(null);
      setDraftRestoreWarning(null);
      setDraftStale(false);
      setStaleDraftCheckResult(null);
      setStaleDraftCheckPending(false);
      setDraftPersistWarning(null);
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    const restored = restorePersistedInspectorOverrideDraft({
      jobId,
      currentBaseFingerprint: baseFingerprint,
    });
    setDraftRestoreWarning(restored.warning);
    setDraftStale(restored.stale);
    setDraftPersistWarning(null);
    setStaleDraftCheckResult(null);

    if (restored.draft && !restored.stale) {
      setOverrideDraft(restored.draft);

      // Check server-side for newer jobs even when fingerprint matches
      const draftNodeIds = [
        ...new Set(restored.draft.entries.map((e) => e.nodeId)),
      ];
      if (draftNodeIds.length > 0) {
        setStaleDraftCheckPending(true);
        const encodedId = encodeURIComponent(jobId);
        fetch(`/workspace/jobs/${encodedId}/stale-check`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftNodeIds }),
          signal,
        })
          .then((res) => res.json() as Promise<StaleDraftCheckResult>)
          .then((result) => {
            if (!signal.aborted && result.stale) {
              setStaleDraftCheckResult(result);
              setDraftStale(true);
            }
          })
          .catch(() => {
            // Server-side check failure is non-critical; local check stands.
          })
          .finally(() => {
            if (!signal.aborted) {
              setStaleDraftCheckPending(false);
            }
          });
      }

      return () => {
        abortController.abort();
      };
    }

    if (restored.draft && restored.stale) {
      // Draft exists but fingerprint changed — keep stale draft in memory for carry-forward
      setOverrideDraft(restored.draft);

      const draftNodeIds = [
        ...new Set(restored.draft.entries.map((e) => e.nodeId)),
      ];
      setStaleDraftCheckPending(true);
      const encodedId = encodeURIComponent(jobId);
      fetch(`/workspace/jobs/${encodedId}/stale-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftNodeIds }),
        signal,
      })
        .then((res) => res.json() as Promise<StaleDraftCheckResult>)
        .then((result) => {
          if (!signal.aborted) {
            setStaleDraftCheckResult(result);
          }
        })
        .catch(() => {
          if (!signal.aborted) {
            setStaleDraftCheckResult({
              stale: true,
              latestJobId: null,
              sourceJobId: jobId,
              boardKey: null,
              carryForwardAvailable: false,
              unmappedNodeIds: [],
              message: "Could not verify carry-forward availability.",
            });
          }
        })
        .finally(() => {
          if (!signal.aborted) {
            setStaleDraftCheckPending(false);
          }
        });

      return () => {
        abortController.abort();
      };
    }

    setOverrideDraft(
      createInspectorOverrideDraft({
        sourceJobId: jobId,
        baseFingerprint,
      }),
    );

    return () => {
      abortController.abort();
    };
  }, [baseFingerprint, jobId]);

  // Reset edit history and snapshots when the draft identity changes
  // (creation, restore, carry-forward — NOT on edit mutations which keep draftId stable).
  const draftId = overrideDraft?.draftId ?? null;
  useEffect(() => {
    if (!overrideDraft) {
      setEditHistory(createEditHistory());
      setSnapshotStore(createDraftSnapshotStore());
      return;
    }
    setEditHistory(createEditHistory({ initialDraft: overrideDraft }));
    setSnapshotStore(createDraftSnapshotStore());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on draftId change only
  }, [draftId]);

  useEffect(() => {
    if (!overrideDraft) {
      return;
    }
    const result = persistInspectorOverrideDraft({
      jobId,
      draft: overrideDraft,
    });
    setDraftPersistWarning(result.error);
  }, [jobId, overrideDraft]);

  useEffect(() => {
    if (!selectedNodeId || !selectedIrNodeData || !overrideDraft) {
      setScalarControlInputs({});
      setPaddingControlInputs({});
      setLayoutControlInputs({});
      setFormValidationControlInputs({});
      setFieldValidationErrors({});
      return;
    }

    const nextScalarControlInputs: ScalarControlInputState = {};
    let nextPaddingControlInputs: PaddingControlInputState = {};

    for (const field of editableScalarFields) {
      if (field === "padding") {
        const value =
          getInspectorOverrideValue({
            draft: overrideDraft,
            nodeId: selectedNodeId,
            field,
          }) ?? selectedIrNodeData.padding;
        nextPaddingControlInputs = toPaddingControlInputValue(value);
        continue;
      }

      const value =
        getInspectorOverrideValue({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }) ?? selectedIrNodeData[field];

      nextScalarControlInputs[field] = toScalarControlInputValue(value);
    }

    const nextLayoutControlInputs: LayoutControlInputState = {};
    for (const field of editableLayoutFields) {
      const overrideValue = getInspectorOverrideValue({
        draft: overrideDraft,
        nodeId: selectedNodeId,
        field,
      });
      const fallbackValue =
        field === "layoutMode"
          ? effectiveLayoutMode
          : selectedIrNodeData[field];
      nextLayoutControlInputs[field] = toLayoutControlInputValue(
        overrideValue ?? fallbackValue,
      );
    }

    const nextFormValidationControlInputs: FormValidationControlInputState = {};
    for (const field of editableFormValidationFields) {
      const overrideValue = getInspectorOverrideValue({
        draft: overrideDraft,
        nodeId: selectedNodeId,
        field,
      });
      const effectiveValue = overrideValue ?? selectedIrNodeData[field];
      if (field === "required") {
        nextFormValidationControlInputs.required = effectiveValue === true;
      } else if (field === "validationType") {
        nextFormValidationControlInputs.validationType =
          typeof effectiveValue === "string" ? effectiveValue : "";
      } else if (field === "validationMessage") {
        nextFormValidationControlInputs.validationMessage =
          typeof effectiveValue === "string" ? effectiveValue : "";
      }
    }

    setScalarControlInputs(nextScalarControlInputs);
    setPaddingControlInputs(nextPaddingControlInputs);
    setLayoutControlInputs(nextLayoutControlInputs);
    setFormValidationControlInputs(nextFormValidationControlInputs);
    setFieldValidationErrors({});
  }, [
    editableFormValidationFields,
    editableLayoutFields,
    editableScalarFields,
    effectiveLayoutMode,
    overrideDraft,
    selectedIrNodeData,
    selectedNodeId,
  ]);

  // --- Derive default file from manifest/files when none explicitly selected ---
  const defaultFile = useMemo<string | null>(() => {
    if (manifest && manifest.screens.length > 0) {
      const firstScreen = manifest.screens[0];
      if (firstScreen && firstScreen.file) {
        return firstScreen.file;
      }
    }

    const codeFiles = files.filter(
      (f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts"),
    );
    if (codeFiles.length > 0 && codeFiles[0]) {
      return codeFiles[0].path;
    }

    return null;
  }, [files, manifest]);

  useEffect(() => {
    if (selectedFile || autoSelectedFile || !defaultFile) {
      return;
    }
    setAutoSelectedFile(defaultFile);
  }, [autoSelectedFile, defaultFile, selectedFile]);

  const effectiveSelectedFile = selectedFile ?? autoSelectedFile ?? defaultFile;
  const selectedFileBoundaries = useMemo(() => {
    return toBoundariesForFile({
      manifest,
      filePath: effectiveSelectedFile,
    });
  }, [effectiveSelectedFile, manifest]);

  const fileContentQuery = useQuery({
    queryKey: ["inspector-file-content", jobId, effectiveSelectedFile],
    enabled: Boolean(effectiveSelectedFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSelectedFile) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FILE_NOT_SELECTED",
          message: "No file selected.",
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(effectiveSelectedFile)}`,
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null,
          };
        }

        let parsedPayload: unknown = null;
        if (body.trim()) {
          try {
            parsedPayload = JSON.parse(body) as unknown;
          } catch {
            parsedPayload = null;
          }
        }

        const error = toEndpointError({
          status: response.status,
          payload: parsedPayload,
          fallbackCode: "FILE_CONTENT_FETCH_FAILED",
          fallbackMessage: `Could not load file '${effectiveSelectedFile}'.`,
        });

        return {
          ok: false,
          status: error.status,
          content: null,
          error: error.code,
          message: error.message,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FILE_CONTENT_FETCH_FAILED",
          message: `Could not load file '${effectiveSelectedFile}'.`,
        };
      }
    },
    staleTime: Infinity,
  });

  const fileContentState = useMemo<{
    status: InspectorSourceStatus;
    content: string | null;
    error: EndpointErrorDetails | null;
  }>(() => {
    if (!effectiveSelectedFile) {
      return {
        status: "empty",
        content: null,
        error: null,
      };
    }

    if (fileContentQuery.isLoading) {
      return {
        status: "loading",
        content: null,
        error: null,
      };
    }

    if (!fileContentQuery.data) {
      return {
        status: "loading",
        content: null,
        error: null,
      };
    }

    if (!fileContentQuery.data.ok) {
      return {
        status: "error",
        content: null,
        error: {
          status: fileContentQuery.data.status,
          code: fileContentQuery.data.error ?? "FILE_CONTENT_FETCH_FAILED",
          message:
            fileContentQuery.data.message ??
            `Could not load file '${effectiveSelectedFile}'.`,
        },
      };
    }

    return {
      status: "ready",
      content: fileContentQuery.data.content,
      error: null,
    };
  }, [
    effectiveSelectedFile,
    fileContentQuery.data,
    fileContentQuery.isLoading,
  ]);

  // --- Previous file content for diff comparison ---

  const encodedPreviousJobId = previousJobId
    ? encodeURIComponent(previousJobId)
    : null;

  const previousFileContentQuery = useQuery({
    queryKey: [
      "inspector-prev-file-content",
      previousJobId,
      effectiveSelectedFile,
    ],
    enabled: Boolean(previousJobId) && Boolean(effectiveSelectedFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSelectedFile || !encodedPreviousJobId) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "NO_PREVIOUS_JOB",
          message: "No previous job selected.",
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedPreviousJobId}/files/${encodeURIComponent(effectiveSelectedFile)}`,
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null,
          };
        }

        // File may not exist in the previous job — that's fine, treat as empty
        return {
          ok: true,
          status: response.status,
          content: "",
          error: null,
          message: null,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "PREV_FILE_FETCH_FAILED",
          message: `Could not load previous version of '${effectiveSelectedFile}'.`,
        };
      }
    },
    staleTime: Infinity,
  });

  const previousFileContent = useMemo<string | null>(() => {
    if (!previousJobId || !effectiveSelectedFile) return null;
    if (!previousFileContentQuery.data) return null;
    if (!previousFileContentQuery.data.ok) return null;
    return previousFileContentQuery.data.content;
  }, [previousJobId, effectiveSelectedFile, previousFileContentQuery.data]);

  const previousFileContentLoading =
    previousFileContentQuery.isLoading && !previousFileContentQuery.data;

  // --- Breadcrumb path derivation ---

  const breadcrumbPath = useMemo(() => {
    if (!selectedNodeId || treeNodes.length === 0) return [];
    return findNodePath(treeNodes, selectedNodeId);
  }, [selectedNodeId, treeNodes]);

  // --- Split view: second file ---

  const [splitFile, setSplitFile] = useState<string | null>(null);

  const suggestedPairedFile = useMemo(() => {
    if (!effectiveSelectedFile) return null;
    const filePaths = files.map((f) => f.path);
    return suggestPairedFile(effectiveSelectedFile, manifest, filePaths);
  }, [effectiveSelectedFile, manifest, files]);

  const effectiveSplitFile = splitFile ?? suggestedPairedFile;
  const splitFileBoundaries = useMemo(() => {
    return toBoundariesForFile({
      manifest,
      filePath: effectiveSplitFile,
    });
  }, [effectiveSplitFile, manifest]);

  const splitFileContentQuery = useQuery({
    queryKey: ["inspector-split-file-content", jobId, effectiveSplitFile],
    enabled: Boolean(effectiveSplitFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!effectiveSplitFile) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "NO_FILE",
          message: "No file selected.",
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedJobId}/files/${encodeURIComponent(effectiveSplitFile)}`,
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null,
          };
        }
        return {
          ok: false,
          status: response.status,
          content: null,
          error: "FETCH_FAILED",
          message: `Could not load '${effectiveSplitFile}'.`,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FETCH_FAILED",
          message: `Could not load '${effectiveSplitFile}'.`,
        };
      }
    },
    staleTime: Infinity,
  });

  const splitFileContent = useMemo<string | null>(() => {
    if (!effectiveSplitFile || !splitFileContentQuery.data) return null;
    if (!splitFileContentQuery.data.ok) return null;
    return splitFileContentQuery.data.content;
  }, [effectiveSplitFile, splitFileContentQuery.data]);

  const splitFileContentLoading =
    splitFileContentQuery.isLoading && !splitFileContentQuery.data;

  const handleSelectSplitFile = useCallback((filePath: string) => {
    setSplitFile(filePath);
  }, []);

  const refetchFiles = filesQuery.refetch;
  const refetchManifest = manifestQuery.refetch;
  const refetchDesignIr = designIrQuery.refetch;
  const refetchFileContent = fileContentQuery.refetch;

  const handleRetryFiles = useCallback(() => {
    void refetchFiles();
  }, [refetchFiles]);

  const handleRetryManifest = useCallback(() => {
    void refetchManifest();
  }, [refetchManifest]);

  const handleRetryDesignIr = useCallback(() => {
    void refetchDesignIr();
  }, [refetchDesignIr]);

  const handleRetryFileContent = useCallback(() => {
    if (!effectiveSelectedFile) {
      return;
    }
    void refetchFileContent();
  }, [effectiveSelectedFile, refetchFileContent]);

  const applyScalarOverrideInput = useCallback(
    ({
      field,
      rawValue,
    }: {
      field: ScalarOverrideField;
      rawValue: unknown;
    }) => {
      if (!selectedNodeId) {
        return;
      }

      const result = translateScalarOverrideInput({
        field,
        rawValue,
      });

      if (!result.ok) {
        setFieldValidationErrors((current) => ({
          ...current,
          [field]: result.error,
        }));
        return;
      }

      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));

      if (overrideDraft) {
        commitDraftEdit(
          upsertInspectorOverrideEntry({
            draft: overrideDraft,
            nodeId: selectedNodeId,
            field: result.field,
            value: result.value,
          }),
        );
      }
    },
    [selectedNodeId, overrideDraft, commitDraftEdit],
  );

  const handleScalarInputChange = useCallback(
    (field: Exclude<ScalarOverrideField, "padding">, value: string) => {
      setScalarControlInputs((current) => ({
        ...current,
        [field]: value,
      }));
      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));
    },
    [],
  );

  const handlePaddingInputChange = useCallback(
    (side: PaddingSide, value: string) => {
      setPaddingControlInputs((current) => ({
        ...current,
        [side]: value,
      }));
      setFieldValidationErrors((current) => ({
        ...current,
        padding: null,
      }));
    },
    [],
  );

  const handleResetScalarOverride = useCallback(
    (field: ScalarOverrideField) => {
      if (!selectedNodeId || !overrideDraft) {
        return;
      }
      commitDraftEdit(
        removeInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }),
      );
      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));
    },
    [selectedNodeId, overrideDraft, commitDraftEdit],
  );

  const applyLayoutOverrideInput = useCallback(
    ({
      field,
      rawValue,
    }: {
      field: LayoutOverrideField;
      rawValue: unknown;
    }) => {
      if (!selectedNodeId) {
        return;
      }

      const result = translateLayoutOverrideInput({
        field,
        rawValue,
        effectiveLayoutMode,
      });

      if (!result.ok) {
        setFieldValidationErrors((current) => ({
          ...current,
          [field]: result.error,
        }));
        return;
      }

      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));

      if (overrideDraft) {
        let nextDraft = upsertInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field: result.field,
          value: result.value,
        });

        if (field === "layoutMode" && result.value === "NONE") {
          nextDraft = removeInspectorOverrideEntry({
            draft: nextDraft,
            nodeId: selectedNodeId,
            field: "primaryAxisAlignItems",
          });
          nextDraft = removeInspectorOverrideEntry({
            draft: nextDraft,
            nodeId: selectedNodeId,
            field: "counterAxisAlignItems",
          });
          setLayoutControlInputs((current) => ({
            ...current,
            primaryAxisAlignItems: "",
            counterAxisAlignItems: "",
          }));
          setFieldValidationErrors((current) => ({
            ...current,
            primaryAxisAlignItems: null,
            counterAxisAlignItems: null,
          }));
        }

        commitDraftEdit(nextDraft);
      }
    },
    [selectedNodeId, effectiveLayoutMode, overrideDraft, commitDraftEdit],
  );

  const handleLayoutInputChange = useCallback(
    (field: LayoutOverrideField, value: string) => {
      setLayoutControlInputs((current) => ({
        ...current,
        [field]: value,
      }));
      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));
    },
    [],
  );

  const handleResetLayoutOverride = useCallback(
    (field: LayoutOverrideField) => {
      if (!selectedNodeId || !overrideDraft) {
        return;
      }

      let nextDraft = removeInspectorOverrideEntry({
        draft: overrideDraft,
        nodeId: selectedNodeId,
        field,
      });

      if (field === "layoutMode") {
        const resetLayoutMode =
          resolveLayoutModeValue(selectedIrNodeData?.layoutMode) ?? "NONE";
        if (resetLayoutMode === "NONE") {
          nextDraft = removeInspectorOverrideEntry({
            draft: nextDraft,
            nodeId: selectedNodeId,
            field: "primaryAxisAlignItems",
          });
          nextDraft = removeInspectorOverrideEntry({
            draft: nextDraft,
            nodeId: selectedNodeId,
            field: "counterAxisAlignItems",
          });
          setLayoutControlInputs((current) => ({
            ...current,
            primaryAxisAlignItems: "",
            counterAxisAlignItems: "",
          }));
        }
      }

      commitDraftEdit(nextDraft);
      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));
    },
    [selectedIrNodeData, selectedNodeId, overrideDraft, commitDraftEdit],
  );

  const structuredOverridePayload = useMemo(() => {
    if (!overrideDraft) {
      return null;
    }
    return toStructuredInspectorOverridePayload(overrideDraft);
  }, [overrideDraft]);

  const impactReviewModel = useMemo(() => {
    return deriveInspectorImpactReviewModel({
      entries: overrideDraft?.entries ?? [],
      manifest: manifest as InspectorImpactReviewManifest | null,
    });
  }, [manifest, overrideDraft]);

  const canSubmitRegeneration =
    impactReviewModel.summary.totalOverrides > 0 &&
    !regenerateMutation.isPending;

  const handleSubmitRegeneration = useCallback(() => {
    if (!canSubmitRegeneration) {
      return;
    }
    setRegenerationError(null);
    setRegenerationAccepted(null);
    regenerateMutation.mutate();
  }, [canSubmitRegeneration, regenerateMutation]);

  const hasScalarFieldOverride = useCallback(
    (field: ScalarOverrideField): boolean => {
      if (!overrideDraft || !selectedNodeId) {
        return false;
      }
      return Boolean(
        getInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }),
      );
    },
    [overrideDraft, selectedNodeId],
  );

  const hasLayoutFieldOverride = useCallback(
    (field: LayoutOverrideField): boolean => {
      if (!overrideDraft || !selectedNodeId) {
        return false;
      }
      return Boolean(
        getInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }),
      );
    },
    [overrideDraft, selectedNodeId],
  );

  const applyFormValidationOverrideInput = useCallback(
    ({
      field,
      rawValue,
    }: {
      field: FormValidationOverrideField;
      rawValue: unknown;
    }) => {
      if (!selectedNodeId) {
        return;
      }

      const result = translateFormValidationOverrideInput({
        field,
        rawValue,
      });

      if (!result.ok) {
        setFieldValidationErrors((current) => ({
          ...current,
          [field]: result.error,
        }));
        return;
      }

      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));

      if (overrideDraft) {
        commitDraftEdit(
          upsertInspectorOverrideEntry({
            draft: overrideDraft,
            nodeId: selectedNodeId,
            field: result.field,
            value: result.value,
          }),
        );
      }
    },
    [selectedNodeId, overrideDraft, commitDraftEdit],
  );

  const handleResetFormValidationOverride = useCallback(
    (field: FormValidationOverrideField) => {
      if (!selectedNodeId || !overrideDraft) {
        return;
      }
      commitDraftEdit(
        removeInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }),
      );
      setFieldValidationErrors((current) => ({
        ...current,
        [field]: null,
      }));
    },
    [selectedNodeId, overrideDraft, commitDraftEdit],
  );

  const hasFormValidationFieldOverride = useCallback(
    (field: FormValidationOverrideField): boolean => {
      if (!overrideDraft || !selectedNodeId) {
        return false;
      }
      return Boolean(
        getInspectorOverrideEntry({
          draft: overrideDraft,
          nodeId: selectedNodeId,
          field,
        }),
      );
    },
    [overrideDraft, selectedNodeId],
  );

  // --- Handlers ---

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    setHighlightRange(null);
  }, []);

  /** Resolve a ManifestMapping for a given node id (null if unmapped). */
  const resolveMapping = useCallback(
    (nodeId: string): ManifestMapping | null => {
      if (!manifest) return null;
      const match = findManifestEntry(nodeId, manifest);
      if (!match) return null;
      if (match.entry) {
        return {
          file: match.entry.file,
          startLine: match.entry.startLine,
          endLine: match.entry.endLine,
          ...(match.entry.extractedComponent
            ? { extractedComponent: true }
            : {}),
        };
      }
      // Screen-level: use the screen file
      return {
        file: match.screen.file,
        startLine: 1,
        endLine: 1,
      };
    },
    [manifest],
  );

  // Derive the active manifest range for the currently selected node
  const activeManifestRange = useMemo<ManifestMapping | null>(() => {
    if (!selectedNodeId) return null;
    return resolveMapping(selectedNodeId);
  }, [selectedNodeId, resolveMapping]);

  const isNodeMapped = activeManifestRange !== null;

  // --- Previous job manifest for node-scoped diff ---

  const previousManifestQuery = useQuery({
    queryKey: ["inspector-prev-manifest", previousJobId],
    enabled: Boolean(previousJobId),
    queryFn: async () => {
      if (!encodedPreviousJobId) {
        throw new Error("No previous job ID");
      }
      return await fetchJson<ComponentManifestPayload>({
        url: `/workspace/jobs/${encodedPreviousJobId}/component-manifest`,
      });
    },
    staleTime: Infinity,
  });

  const previousManifest = useMemo<NodeDiffManifestPayload | null>(() => {
    if (!previousJobId) return null;
    if (!previousManifestQuery.data?.ok) return null;
    const payload = previousManifestQuery.data.payload;
    if (!isComponentManifestPayload(payload)) return null;
    return { jobId: previousJobId, screens: payload.screens };
  }, [previousJobId, previousManifestQuery.data]);

  // Resolve the node-scoped diff mapping for the selected node
  const nodeDiffResult = useMemo(() => {
    if (!selectedNodeId || !previousJobId) return null;
    return resolveNodeDiffMapping(
      selectedNodeId,
      activeManifestRange?.file ?? null,
      previousManifest,
    );
  }, [selectedNodeId, previousJobId, activeManifestRange, previousManifest]);

  // Determine previous manifest range for scoped diff
  const previousManifestRange = useMemo(() => {
    if (!nodeDiffResult?.previousMapping) return null;
    return {
      file: nodeDiffResult.previousMapping.file,
      startLine: nodeDiffResult.previousMapping.startLine,
      endLine: nodeDiffResult.previousMapping.endLine,
    };
  }, [nodeDiffResult]);

  // If the node moved to a different file in the previous job, fetch that file
  const previousDiffFile = useMemo<string | null>(() => {
    if (!nodeDiffResult?.fileChanged || !nodeDiffResult.previousMapping)
      return null;
    return nodeDiffResult.previousMapping.file;
  }, [nodeDiffResult]);

  const previousDiffFileContentQuery = useQuery({
    queryKey: [
      "inspector-prev-diff-file-content",
      previousJobId,
      previousDiffFile,
    ],
    enabled: Boolean(previousJobId) && Boolean(previousDiffFile),
    queryFn: async (): Promise<FileContentResponse> => {
      if (!previousDiffFile || !encodedPreviousJobId) {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "NO_FILE",
          message: "No file.",
        };
      }
      try {
        const response = await fetch(
          `/workspace/jobs/${encodedPreviousJobId}/files/${encodeURIComponent(previousDiffFile)}`,
        );
        const body = await response.text();
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            content: body,
            error: null,
            message: null,
          };
        }
        return {
          ok: true,
          status: response.status,
          content: "",
          error: null,
          message: null,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          content: null,
          error: "FETCH_FAILED",
          message: `Could not load '${previousDiffFile}'.`,
        };
      }
    },
    staleTime: Infinity,
  });

  // Effective previous file content: use cross-file content when the node moved files
  const effectivePreviousFileContent = useMemo<string | null>(() => {
    if (nodeDiffResult?.fileChanged && previousDiffFile) {
      if (!previousDiffFileContentQuery.data) return null;
      if (!previousDiffFileContentQuery.data.ok) return null;
      return previousDiffFileContentQuery.data.content;
    }
    return previousFileContent;
  }, [
    nodeDiffResult,
    previousDiffFile,
    previousDiffFileContentQuery.data,
    previousFileContent,
  ]);

  const effectivePreviousFileContentLoading = nodeDiffResult?.fileChanged
    ? previousDiffFileContentQuery.isLoading &&
      !previousDiffFileContentQuery.data
    : previousFileContentLoading;

  // Node-scoped diff unavailability reason (null when available)
  const nodeDiffFallbackReason = useMemo<string | null>(() => {
    if (!nodeDiffResult) return null;
    return nodeDiffUnavailableReason(nodeDiffResult.status);
  }, [nodeDiffResult]);

  /** Look up the node name and type from the IR tree. */
  const resolveNodeMeta = useCallback(
    (nodeId: string): { name: string; type: string } => {
      const findInTree = (
        nodes: TreeNode[],
      ): { name: string; type: string } | null => {
        for (const node of nodes) {
          if (node.id === nodeId) return { name: node.name, type: node.type };
          if (node.children) {
            const found = findInTree(node.children);
            if (found) return found;
          }
        }
        return null;
      };
      return (
        findInTree(effectiveTreeNodes) ?? { name: nodeId, type: "unknown" }
      );
    },
    [effectiveTreeNodes],
  );

  const computeSelectedNodeEditCapability = useCallback(() => {
    if (!selectedNodeId) {
      return {
        editable: false,
        reason: "No node selected.",
        editableFields: [],
      };
    }

    const isMapped = isNodeMapped;
    const irNode = findIrElementNode(irScreens, selectedNodeId);
    const nodeType = irNode?.type ?? "unknown";
    const nodeName = irNode?.name ?? selectedNodeId;

    // Extract present fields from the raw IR node (the JSON contains all fields)
    const presentFields = irNode ? extractPresentFields(irNode) : [];

    return detectEditCapability({
      id: selectedNodeId,
      name: nodeName,
      type: nodeType,
      mapped: isMapped,
      presentFields,
    });
  }, [irScreens, isNodeMapped, selectedNodeId]);

  // --- Edit capability: recompute when selected node changes ---

  useEffect(() => {
    scopeDispatch({
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: computeSelectedNodeEditCapability() },
    });
  }, [computeSelectedNodeEditCapability]);

  const effectiveEditCapability =
    editCapability ??
    (selectedNodeId ? computeSelectedNodeEditCapability() : null);
  const canEnterEditMode = Boolean(effectiveEditCapability?.editable);

  const handleEnterEditMode = useCallback(() => {
    if (canEnterEditMode) {
      scopeDispatch({ type: "ENTER_EDIT_MODE" });
    }
  }, [canEnterEditMode]);

  const handleExitEditMode = useCallback(() => {
    scopeDispatch({ type: "EXIT_EDIT_MODE" });
    scopeDispatch({
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: computeSelectedNodeEditCapability() },
    });
  }, [computeSelectedNodeEditCapability]);

  const applyNavigationVisualState = useCallback(
    (nextScopeState: {
      selectedNodeId: string | null;
      effectiveFileTarget: string | null;
    }) => {
      const nodeId = nextScopeState.selectedNodeId;

      if (!nodeId) {
        setSelectedFile(null);
        setHighlightRange(null);
        return;
      }

      if (manifest) {
        const match = findManifestEntry(nodeId, manifest);
        if (match?.entry) {
          setSelectedFile(match.entry.file);
          if (match.entry.extractedComponent) {
            setHighlightRange(null);
          } else {
            setHighlightRange({
              startLine: match.entry.startLine,
              endLine: match.entry.endLine,
            });
          }
          return;
        }

        if (match) {
          setSelectedFile(match.screen.file);
          setHighlightRange(null);
          return;
        }
      }

      const irScreen = irScreens.find((screen) => screen.id === nodeId);
      if (irScreen?.generatedFile) {
        setSelectedFile(irScreen.generatedFile);
        setHighlightRange(null);
        return;
      }

      if (nextScopeState.effectiveFileTarget) {
        setSelectedFile(nextScopeState.effectiveFileTarget);
        setHighlightRange(null);
      }
    },
    [irScreens, manifest],
  );

  const handleSelectTreeNode = useCallback(
    (nodeId: string) => {
      const mapping = resolveMapping(nodeId);
      const meta = resolveNodeMeta(nodeId);

      // Dispatch to scope reducer (selection only, not scope entry)
      scopeDispatch({
        type: "SELECT_NODE",
        payload: {
          nodeId,
          nodeName: meta.name,
          nodeType: meta.type,
          mapping,
        },
      });

      if (!manifest) {
        return;
      }

      const match = findManifestEntry(nodeId, manifest);
      if (!match) {
        return;
      }

      if (match.entry) {
        // Element-level or extracted component selection
        if (match.entry.extractedComponent) {
          // Navigate to the extracted component's own file
          setSelectedFile(match.entry.file);
          setHighlightRange(null);
        } else {
          // Navigate to the screen file with line highlight
          setSelectedFile(match.entry.file);
          setHighlightRange({
            startLine: match.entry.startLine,
            endLine: match.entry.endLine,
          });
        }
      } else {
        // Screen-level selection — show entire screen file
        setSelectedFile(match.screen.file);
        setHighlightRange(null);
      }
    },
    [manifest, resolveMapping, resolveNodeMeta],
  );

  // Also check if the node is a screen directly from IR data (for screens without manifest)
  const handleTreeSelect = useCallback(
    (nodeId: string) => {
      handleSelectTreeNode(nodeId);

      // Fallback for screens: if manifest didn't match, try IR screen generatedFile
      if (!manifest || !findManifestEntry(nodeId, manifest)) {
        const irScreen = irScreens.find((s) => s.id === nodeId);
        if (irScreen?.generatedFile) {
          setSelectedFile(irScreen.generatedFile);
          setHighlightRange(null);
        }
      }
    },
    [handleSelectTreeNode, manifest, irScreens],
  );

  // Handle inspect:select from the preview iframe overlay
  const handleInspectSelect = useCallback(
    (irNodeId: string) => {
      handleTreeSelect(irNodeId);
    },
    [handleTreeSelect],
  );

  /** Explicitly enter scope on a node (separate from selection). */
  const handleEnterScope = useCallback(
    (nodeId: string) => {
      const mapping = resolveMapping(nodeId);
      const meta = resolveNodeMeta(nodeId);

      scopeDispatch({
        type: "ENTER_SCOPE",
        payload: {
          nodeId,
          nodeName: meta.name,
          nodeType: meta.type,
          mapping,
        },
      });

      // Also navigate to the node's file if mapped
      if (mapping) {
        setSelectedFile(mapping.file);
        if (mapping.extractedComponent) {
          setHighlightRange(null);
        } else {
          setHighlightRange({
            startLine: mapping.startLine,
            endLine: mapping.endLine,
          });
        }
      }
    },
    [resolveMapping, resolveNodeMeta],
  );

  const handleLevelUp = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, {
      type: "LEVEL_UP",
    });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "LEVEL_UP" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  /** Exit scope remains as a compatibility alias for level-up navigation. */
  const handleExitScope = useCallback(() => {
    handleLevelUp();
  }, [handleLevelUp]);

  /** Return to parent file context without unwinding scope. */
  const handleReturnToParentFile = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, {
      type: "RETURN_TO_PARENT_FILE",
    });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "RETURN_TO_PARENT_FILE" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  const handleNavigateBack = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, {
      type: "NAVIGATE_BACK",
    });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "NAVIGATE_BACK" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  const handleNavigateForward = useCallback(() => {
    const nextScopeState = inspectorScopeReducer(scopeState, {
      type: "NAVIGATE_FORWARD",
    });
    if (nextScopeState === scopeState) {
      return;
    }

    scopeDispatch({ type: "NAVIGATE_FORWARD" });
    applyNavigationVisualState(nextScopeState);
  }, [applyNavigationVisualState, scopeState]);

  const handleToggleInspect = useCallback(() => {
    setInspectEnabled((prev) => !prev);
  }, []);

  const handleSplitterPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (
        !state ||
        state.pointerId !== event.pointerId ||
        state.element !== event.currentTarget
      ) {
        return;
      }

      state.lastClientX = event.clientX;
      setPaneRatios(resolveDragResizeRatios(state, event.clientX));
    },
    [resolveDragResizeRatios],
  );

  const finalizeSplitterDrag = useCallback(
    ({
      event,
      fallbackClientX,
      releaseCapture,
    }: {
      event: ReactPointerEvent<HTMLDivElement>;
      fallbackClientX?: number | undefined;
      releaseCapture: boolean;
    }) => {
      const state = dragStateRef.current;
      if (
        !state ||
        state.pointerId !== event.pointerId ||
        state.element !== event.currentTarget
      ) {
        return;
      }

      const finalClientX =
        fallbackClientX ??
        (Number.isFinite(event.clientX) ? event.clientX : state.lastClientX);
      state.lastClientX = finalClientX;

      const next = resolveDragResizeRatios(state, finalClientX);
      setPaneRatios(next);
      persistPaneLayout(next);
      clearActiveSplitterDrag({ releaseCapture });
    },
    [clearActiveSplitterDrag, persistPaneLayout, resolveDragResizeRatios],
  );

  const handleSplitterPointerDown = useCallback(
    (separator: PaneSeparator) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!isDesktopLayout) {
          return;
        }
        if (separator === "tree-preview" && !hasExpandedTree) {
          return;
        }

        event.preventDefault();
        clearActiveSplitterDrag({ releaseCapture: false });

        dragStateRef.current = {
          element: event.currentTarget,
          pointerId: event.pointerId,
          separator,
          startX: event.clientX,
          lastClientX: event.clientX,
          startWidthPx: getLayoutContainerWidth(),
          startRatios: paneRatios,
          unlockDocument: lockDocumentForSplitterDrag(),
        };

        if (typeof event.currentTarget.setPointerCapture === "function") {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // The drag still works when browsers refuse capture for synthetic or stale pointers.
          }
        }
      },
    [
      clearActiveSplitterDrag,
      getLayoutContainerWidth,
      hasExpandedTree,
      isDesktopLayout,
      lockDocumentForSplitterDrag,
      paneRatios,
    ],
  );

  const handleSplitterPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finalizeSplitterDrag({
        event,
        releaseCapture: true,
      });
    },
    [finalizeSplitterDrag],
  );

  const handleSplitterPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finalizeSplitterDrag({
        event,
        fallbackClientX: dragStateRef.current?.lastClientX,
        releaseCapture: true,
      });
    },
    [finalizeSplitterDrag],
  );

  const handleSplitterLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finalizeSplitterDrag({
        event,
        fallbackClientX: dragStateRef.current?.lastClientX,
        releaseCapture: false,
      });
    },
    [finalizeSplitterDrag],
  );

  const handleSplitterKeyDown = useCallback(
    (separator: PaneSeparator) =>
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!isDesktopLayout) {
          return;
        }
        if (separator === "tree-preview" && !hasExpandedTree) {
          return;
        }

        const keyboardStep = event.shiftKey
          ? KEYBOARD_STEP_LARGE_PX
          : KEYBOARD_STEP_PX;
        let deltaPx: number | null = null;

        switch (event.key) {
          case "ArrowLeft":
            deltaPx = -keyboardStep;
            break;
          case "ArrowRight":
            deltaPx = keyboardStep;
            break;
          case "Home":
            deltaPx = -KEYBOARD_EXTREME_DELTA_PX;
            break;
          case "End":
            deltaPx = KEYBOARD_EXTREME_DELTA_PX;
            break;
          default:
            break;
        }

        if (deltaPx === null) {
          return;
        }

        event.preventDefault();
        const next = applyResizeDelta({
          separator,
          deltaPx,
          sourceRatios: paneRatios,
        });

        setPaneRatios(next);
        persistPaneLayout(next);
      },
    [
      applyResizeDelta,
      hasExpandedTree,
      isDesktopLayout,
      paneRatios,
      persistPaneLayout,
    ],
  );

  const collapsedPreviewShare = useMemo(() => {
    const sum = paneRatios.preview + paneRatios.code;
    if (sum <= 0) {
      return 0.5;
    }
    return paneRatios.preview / sum;
  }, [paneRatios.code, paneRatios.preview]);

  const treeSeparatorNow = Math.round(paneRatios.tree * 100);
  const previewSeparatorNow = Math.round(collapsedPreviewShare * 100);

  const treePaneStyle = useMemo(() => {
    if (!isDesktopLayout || !hasExpandedTree) {
      return undefined;
    }

    return {
      flexBasis: "0%",
      flexGrow: paneRatios.tree,
      flexShrink: 1,
      minWidth: `${String(MIN_TREE_WIDTH_PX)}px`,
    };
  }, [hasExpandedTree, isDesktopLayout, paneRatios.tree]);

  const previewPaneStyle = useMemo(() => {
    if (!isDesktopLayout) {
      return undefined;
    }

    if (hasExpandedTree) {
      return {
        flexBasis: "0%",
        flexGrow: paneRatios.preview,
        flexShrink: 1,
        minWidth: `${String(MIN_PREVIEW_WIDTH_PX)}px`,
      };
    }

    return {
      flexBasis: "0%",
      flexGrow: collapsedPreviewShare,
      flexShrink: 1,
      minWidth: `${String(MIN_PREVIEW_WIDTH_PX)}px`,
    };
  }, [
    collapsedPreviewShare,
    hasExpandedTree,
    isDesktopLayout,
    paneRatios.preview,
  ]);

  const codePaneStyle = useMemo(() => {
    if (!isDesktopLayout) {
      return undefined;
    }

    if (hasExpandedTree) {
      return {
        flexBasis: "0%",
        flexGrow: paneRatios.code,
        flexShrink: 1,
        minWidth: `${String(MIN_CODE_WIDTH_PX)}px`,
      };
    }

    return {
      flexBasis: "0%",
      flexGrow: 1 - collapsedPreviewShare,
      flexShrink: 1,
      minWidth: `${String(MIN_CODE_WIDTH_PX)}px`,
    };
  }, [
    collapsedPreviewShare,
    hasExpandedTree,
    isDesktopLayout,
    paneRatios.code,
  ]);

  const sourceStatuses = useMemo(() => {
    return [
      { source: "files", label: "Files", status: effectiveFilesState.status },
      { source: "design-ir", label: "Design IR", status: designIrState.status },
      {
        source: "component-manifest",
        label: "Manifest",
        status: manifestState.status,
      },
      {
        source: "file-content",
        label: "File content",
        status: fileContentState.status,
      },
    ] as const;
  }, [
    designIrState.status,
    effectiveFilesState.status,
    fileContentState.status,
    manifestState.status,
  ]);

  const sourceErrorBanners = useMemo(() => {
    const banners: Array<{
      source: "files" | "design-ir" | "component-manifest" | "file-content";
      title: string;
      details: EndpointErrorDetails;
      onRetry: (() => void) | null;
    }> = [];

    if (effectiveFilesState.error) {
      banners.push({
        source: "files",
        title: "Generated files unavailable",
        details: effectiveFilesState.error,
        onRetry: handleRetryFiles,
      });
    }

    if (designIrState.error) {
      banners.push({
        source: "design-ir",
        title: "Design IR unavailable",
        details: designIrState.error,
        onRetry: handleRetryDesignIr,
      });
    }

    if (manifestState.error) {
      banners.push({
        source: "component-manifest",
        title: "Component mapping unavailable",
        details: manifestState.error,
        onRetry: handleRetryManifest,
      });
    }

    if (fileContentState.error) {
      banners.push({
        source: "file-content",
        title: "Selected file unavailable",
        details: fileContentState.error,
        onRetry: handleRetryFileContent,
      });
    }

    return banners;
  }, [
    designIrState.error,
    effectiveFilesState.error,
    fileContentState.error,
    handleRetryDesignIr,
    handleRetryFileContent,
    handleRetryFiles,
    handleRetryManifest,
    manifestState.error,
  ]);

  const handlePreviewLocalSync = useCallback(() => {
    if (!isRegenerationJob) {
      return;
    }
    setSyncError(null);
    previewSyncMutation.mutate({
      targetPath: syncTargetPathInput,
    });
  }, [isRegenerationJob, previewSyncMutation, syncTargetPathInput]);

  const handleToggleLocalSyncFile = useCallback(
    (path: string, checked: boolean) => {
      setSyncFileDecisions((current) => ({
        ...current,
        [path]: checked ? "write" : "skip",
      }));
    },
    [],
  );

  const handleApplyLocalSync = useCallback(() => {
    if (
      !isRegenerationJob ||
      !syncPreviewPlan ||
      !syncConfirmationChecked ||
      !effectiveSyncSummary ||
      effectiveSyncSummary.selectedFiles === 0
    ) {
      return;
    }
    setSyncError(null);
    applySyncMutation.mutate();
  }, [
    applySyncMutation,
    effectiveSyncSummary,
    isRegenerationJob,
    syncConfirmationChecked,
    syncPreviewPlan,
  ]);

  const syncPreviewDisabled =
    !isRegenerationJob ||
    previewSyncMutation.isPending ||
    applySyncMutation.isPending ||
    regenerateMutation.isPending;

  const syncApplyDisabled =
    !isRegenerationJob ||
    !syncPreviewPlan ||
    !effectiveSyncSummary ||
    effectiveSyncSummary.selectedFiles === 0 ||
    !syncConfirmationChecked ||
    previewSyncMutation.isPending ||
    applySyncMutation.isPending ||
    regenerateMutation.isPending;

  const handleCreatePr = useCallback(() => {
    if (!isRegenerationJob) {
      return;
    }
    setPrError(null);
    setPrResult(null);
    createPrMutation.mutate();
  }, [createPrMutation, isRegenerationJob]);

  const prCreateDisabled =
    !isRegenerationJob ||
    !prRepoUrlInput.trim() ||
    !prRepoTokenInput.trim() ||
    createPrMutation.isPending ||
    regenerateMutation.isPending;

  const handleCloseDialog = useCallback(() => {
    onCloseDialog?.();
  }, [onCloseDialog]);

  return (
    <div
      ref={inspectorPanelRef}
      data-testid="inspector-panel"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[#141414] text-white"
    >
      {/* Compact toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#000000] bg-[#1d1d1d] px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="inspector-nav-back"
            disabled={!canNavigateBack}
            onClick={handleNavigateBack}
            className="cursor-pointer rounded border border-[#333333] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/65 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87] disabled:cursor-default disabled:opacity-30"
            title="Back to previous committed drilldown state"
            aria-label="Navigate back in inspector drilldown history"
          >
            ←
          </button>
          <button
            type="button"
            data-testid="inspector-nav-forward"
            disabled={!canNavigateForward}
            onClick={handleNavigateForward}
            className="cursor-pointer rounded border border-[#333333] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/65 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87] disabled:cursor-default disabled:opacity-30"
            title="Forward to next committed drilldown state"
            aria-label="Navigate forward in inspector drilldown history"
          >
            →
          </button>
          <button
            type="button"
            data-testid="inspector-shortcut-help-button"
            onClick={() => {
              setShortcutHelpOpen((prev) => !prev);
            }}
            className="cursor-pointer rounded border border-[#333333] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/45 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87]"
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            ⌨
          </button>
          {editModeActive ? (
            <button
              type="button"
              data-testid="inspector-exit-edit-mode"
              onClick={handleExitEditMode}
              className="cursor-pointer rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 transition hover:bg-amber-400/15"
              title="Exit edit mode"
              aria-label="Exit edit mode"
            >
              Exit Edit
            </button>
          ) : (
            <button
              type="button"
              data-testid="inspector-enter-edit-mode"
              disabled={!canEnterEditMode}
              onClick={handleEnterEditMode}
              className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[11px] font-medium text-white/65 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87] disabled:cursor-default disabled:opacity-30"
              title={
                effectiveEditCapability?.editable
                  ? "Enter edit mode for this node"
                  : (effectiveEditCapability?.reason ??
                    "Select a node to check edit capability")
              }
              aria-label="Enter edit mode"
            >
              Edit
            </button>
          )}
        </div>
        <div className="h-3 w-px bg-[#333333]" />
        <div
          className="flex flex-wrap gap-1"
          data-testid="inspector-source-statuses"
        >
          {sourceStatuses.map(({ source, label, status }) => (
            <span
              key={source}
              data-testid={`inspector-source-${source}-${status}`}
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getStatusBadgeClasses(status)}`}
            >
              {label}: {status}
            </span>
          ))}
        </div>
        {selectedNodeId && effectiveEditCapability ? (
          <div className="h-3 w-px bg-[#333333]" />
        ) : null}
        {selectedNodeId && effectiveEditCapability ? (
          <span
            data-testid="inspector-edit-capability"
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              effectiveEditCapability.editable
                ? "border border-[#4eba87]/30 bg-[#4eba87]/10 text-[#4eba87]"
                : "border border-white/10 bg-[#262626] text-white/45"
            }`}
          >
            {effectiveEditCapability.editable
              ? `Edit: ${effectiveEditCapability.editableFields.length} fields`
              : "Not editable"}
          </span>
        ) : null}
      </div>

      {/* Edit Studio — slides down below toolbar when active */}
      {editModeActive && selectedNodeId ? (
        <div
          data-testid="inspector-edit-studio-panel"
          className="shrink-0 overflow-y-auto border-b border-[#2a2a3d] bg-[#1a1a2a] px-4 py-2 text-xs text-indigo-200"
          style={{ maxHeight: "30vh" }}
        >
          <div className="mx-auto max-w-5xl">
            <p className="m-0 font-semibold text-indigo-300">Edit Studio</p>
            <p className="m-0 mt-1 text-slate-400">
              Structured overrides use exact IR field names in payload output
              and persist as a single draft.
            </p>
            <p
              data-testid="inspector-edit-supported-layout-fields"
              className="m-0 mt-1 text-indigo-900"
            >
              Supported layout overrides: width, height, layoutMode,
              primaryAxisAlignItems, counterAxisAlignItems.
            </p>
            <p
              data-testid="inspector-edit-v1-deferred-fields"
              className="m-0 mt-1 text-indigo-800"
            >
              Deferred: x, y, minWidth, maxWidth, maxHeight, responsive
              breakpoints, and screen-root layout editing.
            </p>
            {draftRestoreWarning && !staleDraftCheckResult ? (
              <p
                data-testid={
                  draftStale
                    ? "inspector-edit-draft-stale-warning"
                    : "inspector-edit-draft-restore-warning"
                }
                className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
              >
                {draftRestoreWarning}
              </p>
            ) : null}
            {staleDraftCheckResult?.stale && !remapResult ? (
              <div className="mt-2" data-testid="inspector-stale-draft-warning">
                <StaleDraftWarning
                  checkResult={staleDraftCheckResult}
                  onDecision={handleStaleDraftDecision}
                  disabled={staleDraftCheckPending}
                  remapPending={remapPending}
                />
              </div>
            ) : null}
            {remapResult ? (
              <div className="mt-2" data-testid="inspector-remap-review">
                <RemapReviewPanel
                  result={remapResult}
                  onApply={handleRemapApply}
                  onCancel={handleRemapCancel}
                  disabled={remapPending}
                />
              </div>
            ) : null}
            {draftPersistWarning ? (
              <p
                data-testid="inspector-edit-draft-persist-warning"
                className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
              >
                {draftPersistWarning}
              </p>
            ) : null}
            {selectedIrNodeData ? (
              <>
                {editableScalarFields.length > 0 ? (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {editableScalarFields.map((field) => {
                      if (field === "padding") {
                        return (
                          <div
                            key={field}
                            data-testid="inspector-edit-field-padding"
                            className="rounded border border-indigo-200 bg-white px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <label
                                className="font-semibold text-indigo-900"
                                htmlFor="inspector-edit-input-padding-top"
                              >
                                {fieldLabel(field)}
                              </label>
                              {hasScalarFieldOverride(field) ? (
                                <button
                                  type="button"
                                  data-testid="inspector-edit-reset-padding"
                                  onClick={() => {
                                    handleResetScalarOverride(field);
                                  }}
                                  className="cursor-pointer rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                                >
                                  Reset
                                </button>
                              ) : null}
                            </div>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              {PADDING_SIDES.map((side) => (
                                <label
                                  key={side}
                                  className="flex flex-col gap-0.5 text-[11px] text-slate-700"
                                >
                                  <span className="font-medium capitalize">
                                    {side}
                                  </span>
                                  <input
                                    id={`inspector-edit-input-padding-${side}`}
                                    data-testid={`inspector-edit-input-padding-${side}`}
                                    type="number"
                                    min={0}
                                    step={0.1}
                                    value={paddingControlInputs[side] ?? ""}
                                    onChange={(event) => {
                                      handlePaddingInputChange(
                                        side,
                                        event.currentTarget.value,
                                      );
                                    }}
                                    onBlur={() => {
                                      applyScalarOverrideInput({
                                        field,
                                        rawValue: {
                                          top: paddingControlInputs.top ?? "",
                                          right:
                                            paddingControlInputs.right ?? "",
                                          bottom:
                                            paddingControlInputs.bottom ?? "",
                                          left: paddingControlInputs.left ?? "",
                                        },
                                      });
                                    }}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                                  />
                                </label>
                              ))}
                            </div>
                            {fieldValidationErrors.padding ? (
                              <p
                                data-testid="inspector-edit-error-padding"
                                className="m-0 mt-1 text-[11px] text-rose-700"
                              >
                                {fieldValidationErrors.padding}
                              </p>
                            ) : null}
                          </div>
                        );
                      }

                      const inputType =
                        field === "fontFamily" || field === "fillColor"
                          ? "text"
                          : "number";
                      const inputStep =
                        field === "opacity"
                          ? 0.01
                          : field === "fontWeight"
                            ? 100
                            : 0.1;
                      const inputMin =
                        field === "opacity" ||
                        field === "cornerRadius" ||
                        field === "fontSize" ||
                        field === "gap"
                          ? 0
                          : field === "fontWeight"
                            ? 100
                            : undefined;
                      const inputMax =
                        field === "opacity"
                          ? 1
                          : field === "fontWeight"
                            ? 900
                            : undefined;
                      return (
                        <div
                          key={field}
                          data-testid={`inspector-edit-field-${field}`}
                          className="rounded border border-indigo-200 bg-white px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label
                              className="font-semibold text-indigo-900"
                              htmlFor={`inspector-edit-input-${field}`}
                            >
                              {fieldLabel(field)}
                            </label>
                            {hasScalarFieldOverride(field) ? (
                              <button
                                type="button"
                                data-testid={`inspector-edit-reset-${field}`}
                                onClick={() => {
                                  handleResetScalarOverride(field);
                                }}
                                className="cursor-pointer rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                              >
                                Reset
                              </button>
                            ) : null}
                          </div>
                          <input
                            id={`inspector-edit-input-${field}`}
                            data-testid={`inspector-edit-input-${field}`}
                            type={inputType}
                            step={inputStep}
                            min={inputMin}
                            max={inputMax}
                            value={scalarControlInputs[field] ?? ""}
                            onChange={(event) => {
                              handleScalarInputChange(
                                field,
                                event.currentTarget.value,
                              );
                            }}
                            onBlur={(event) => {
                              applyScalarOverrideInput({
                                field,
                                rawValue: event.currentTarget.value,
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                          />
                          {fieldValidationErrors[field] ? (
                            <p
                              data-testid={`inspector-edit-error-${field}`}
                              className="m-0 mt-1 text-[11px] text-rose-700"
                            >
                              {fieldValidationErrors[field]}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p
                    data-testid="inspector-edit-no-supported-fields"
                    className="m-0 mt-2 text-indigo-900"
                  >
                    No scalar overrides are supported for the selected node.
                  </p>
                )}
                {unsupportedScalarFields.length > 0 ? (
                  <div
                    data-testid="inspector-edit-unsupported-fields"
                    className="mt-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
                  >
                    <p className="m-0 font-semibold text-slate-900">
                      Unsupported scalar properties
                    </p>
                    {unsupportedScalarFields.map((entry) => (
                      <p
                        key={entry.field}
                        data-testid={`inspector-edit-unsupported-${entry.field}`}
                        className="m-0 mt-1"
                      >
                        {entry.field}: {entry.reason ?? "Not supported."}
                      </p>
                    ))}
                  </div>
                ) : null}
                {editableLayoutFields.length > 0 ? (
                  <div
                    data-testid="inspector-edit-layout-panel"
                    className="mt-3 rounded border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-950"
                  >
                    <p className="m-0 font-semibold">Layout &amp; Dimensions</p>
                    <p className="m-0 mt-1">
                      Generator-aware node-level layout controls for base IR
                      regeneration.
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {editableLayoutFields.map((field) => {
                        if (field === "layoutMode") {
                          return (
                            <div
                              key={field}
                              data-testid="inspector-edit-field-layoutMode"
                              className="rounded border border-cyan-200 bg-white px-2 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className="font-semibold text-cyan-900"
                                  htmlFor="inspector-edit-input-layoutMode"
                                >
                                  {fieldLabel(field)}
                                </label>
                                {hasLayoutFieldOverride(field) ? (
                                  <button
                                    type="button"
                                    data-testid="inspector-edit-reset-layoutMode"
                                    onClick={() => {
                                      handleResetLayoutOverride(field);
                                    }}
                                    className="cursor-pointer rounded border border-cyan-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-100"
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                              <select
                                id="inspector-edit-input-layoutMode"
                                data-testid="inspector-edit-input-layoutMode"
                                value={
                                  layoutControlInputs.layoutMode ??
                                  effectiveLayoutMode
                                }
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  handleLayoutInputChange(field, value);
                                  applyLayoutOverrideInput({
                                    field,
                                    rawValue: value,
                                  });
                                }}
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                              >
                                {LAYOUT_MODE_VALUES.map((layoutValue) => (
                                  <option key={layoutValue} value={layoutValue}>
                                    {layoutValue}
                                  </option>
                                ))}
                              </select>
                              {fieldValidationErrors.layoutMode ? (
                                <p
                                  data-testid="inspector-edit-error-layoutMode"
                                  className="m-0 mt-1 text-[11px] text-rose-700"
                                >
                                  {fieldValidationErrors.layoutMode}
                                </p>
                              ) : null}
                            </div>
                          );
                        }

                        if (
                          field === "primaryAxisAlignItems" ||
                          field === "counterAxisAlignItems"
                        ) {
                          const values =
                            field === "primaryAxisAlignItems"
                              ? PRIMARY_AXIS_ALIGN_ITEMS
                              : COUNTER_AXIS_ALIGN_ITEMS;
                          return (
                            <div
                              key={field}
                              data-testid={`inspector-edit-field-${field}`}
                              className="rounded border border-cyan-200 bg-white px-2 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className="font-semibold text-cyan-900"
                                  htmlFor={`inspector-edit-input-${field}`}
                                >
                                  {fieldLabel(field)}
                                </label>
                                {hasLayoutFieldOverride(field) ? (
                                  <button
                                    type="button"
                                    data-testid={`inspector-edit-reset-${field}`}
                                    onClick={() => {
                                      handleResetLayoutOverride(field);
                                    }}
                                    className="cursor-pointer rounded border border-cyan-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-100"
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                              <select
                                id={`inspector-edit-input-${field}`}
                                data-testid={`inspector-edit-input-${field}`}
                                value={layoutControlInputs[field] ?? ""}
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  handleLayoutInputChange(field, value);
                                  if (value) {
                                    applyLayoutOverrideInput({
                                      field,
                                      rawValue: value,
                                    });
                                  }
                                }}
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                              >
                                <option value="">— select —</option>
                                {values.map((optionValue) => (
                                  <option key={optionValue} value={optionValue}>
                                    {optionValue}
                                  </option>
                                ))}
                              </select>
                              {fieldValidationErrors[field] ? (
                                <p
                                  data-testid={`inspector-edit-error-${field}`}
                                  className="m-0 mt-1 text-[11px] text-rose-700"
                                >
                                  {fieldValidationErrors[field]}
                                </p>
                              ) : null}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={field}
                            data-testid={`inspector-edit-field-${field}`}
                            className="rounded border border-cyan-200 bg-white px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <label
                                className="font-semibold text-cyan-900"
                                htmlFor={`inspector-edit-input-${field}`}
                              >
                                {fieldLabel(field)}
                              </label>
                              {hasLayoutFieldOverride(field) ? (
                                <button
                                  type="button"
                                  data-testid={`inspector-edit-reset-${field}`}
                                  onClick={() => {
                                    handleResetLayoutOverride(field);
                                  }}
                                  className="cursor-pointer rounded border border-cyan-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-cyan-700 transition hover:bg-cyan-100"
                                >
                                  Reset
                                </button>
                              ) : null}
                            </div>
                            <input
                              id={`inspector-edit-input-${field}`}
                              data-testid={`inspector-edit-input-${field}`}
                              type="number"
                              min={1}
                              step={1}
                              value={layoutControlInputs[field] ?? ""}
                              onChange={(event) => {
                                handleLayoutInputChange(
                                  field,
                                  event.currentTarget.value,
                                );
                              }}
                              onBlur={(event) => {
                                applyLayoutOverrideInput({
                                  field,
                                  rawValue: event.currentTarget.value,
                                });
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                            />
                            {fieldValidationErrors[field] ? (
                              <p
                                data-testid={`inspector-edit-error-${field}`}
                                className="m-0 mt-1 text-[11px] text-rose-700"
                              >
                                {fieldValidationErrors[field]}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {unsupportedLayoutFields.length > 0 ? (
                  <div
                    data-testid="inspector-edit-unsupported-layout-fields"
                    className="mt-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
                  >
                    <p className="m-0 font-semibold text-slate-900">
                      Unsupported layout properties
                    </p>
                    {unsupportedLayoutFields.map((entry) => (
                      <p
                        key={entry.field}
                        data-testid={`inspector-edit-unsupported-layout-${entry.field}`}
                        className="m-0 mt-1"
                      >
                        {entry.field}: {entry.reason ?? "Not supported."}
                      </p>
                    ))}
                  </div>
                ) : null}
                {editableFormValidationFields.length > 0 ? (
                  <div
                    data-testid="inspector-edit-form-validation-panel"
                    className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950"
                  >
                    <p className="m-0 font-semibold">
                      Form Validation Settings
                    </p>
                    <p className="m-0 mt-1">
                      Per-field validation primitives consumed by the
                      form-generation pipeline.
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {editableFormValidationFields.map((field) => {
                        if (field === "required") {
                          return (
                            <div
                              key={field}
                              data-testid="inspector-edit-field-required"
                              className="rounded border border-emerald-200 bg-white px-2 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className="font-semibold text-emerald-900"
                                  htmlFor="inspector-edit-input-required"
                                >
                                  {fieldLabel(field)}
                                </label>
                                {hasFormValidationFieldOverride(field) ? (
                                  <button
                                    type="button"
                                    data-testid="inspector-edit-reset-required"
                                    onClick={() => {
                                      handleResetFormValidationOverride(field);
                                    }}
                                    className="cursor-pointer rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <input
                                  id="inspector-edit-input-required"
                                  data-testid="inspector-edit-input-required"
                                  type="checkbox"
                                  checked={
                                    formValidationControlInputs.required ??
                                    false
                                  }
                                  onChange={(event) => {
                                    const checked = event.currentTarget.checked;
                                    setFormValidationControlInputs(
                                      (current) => ({
                                        ...current,
                                        required: checked,
                                      }),
                                    );
                                    applyFormValidationOverrideInput({
                                      field: "required",
                                      rawValue: checked,
                                    });
                                  }}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                <span className="text-xs text-slate-700">
                                  {formValidationControlInputs.required
                                    ? "Yes"
                                    : "No"}
                                </span>
                              </div>
                              {fieldValidationErrors.required ? (
                                <p
                                  data-testid="inspector-edit-error-required"
                                  className="m-0 mt-1 text-[11px] text-rose-700"
                                >
                                  {fieldValidationErrors.required}
                                </p>
                              ) : null}
                            </div>
                          );
                        }

                        if (field === "validationType") {
                          return (
                            <div
                              key={field}
                              data-testid="inspector-edit-field-validationType"
                              className="rounded border border-emerald-200 bg-white px-2 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  className="font-semibold text-emerald-900"
                                  htmlFor="inspector-edit-input-validationType"
                                >
                                  {fieldLabel(field)}
                                </label>
                                {hasFormValidationFieldOverride(field) ? (
                                  <button
                                    type="button"
                                    data-testid="inspector-edit-reset-validationType"
                                    onClick={() => {
                                      handleResetFormValidationOverride(field);
                                    }}
                                    className="cursor-pointer rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                              <select
                                id="inspector-edit-input-validationType"
                                data-testid="inspector-edit-input-validationType"
                                value={
                                  formValidationControlInputs.validationType ??
                                  ""
                                }
                                onChange={(event) => {
                                  const value = event.currentTarget.value;
                                  setFormValidationControlInputs((current) => ({
                                    ...current,
                                    validationType: value,
                                  }));
                                  setFieldValidationErrors((current) => ({
                                    ...current,
                                    validationType: null,
                                  }));
                                  if (value) {
                                    applyFormValidationOverrideInput({
                                      field: "validationType",
                                      rawValue: value,
                                    });
                                  }
                                }}
                                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                              >
                                <option value="">— select —</option>
                                {SUPPORTED_VALIDATION_TYPES.map((vType) => (
                                  <option key={vType} value={vType}>
                                    {vType}
                                  </option>
                                ))}
                              </select>
                              {fieldValidationErrors.validationType ? (
                                <p
                                  data-testid="inspector-edit-error-validationType"
                                  className="m-0 mt-1 text-[11px] text-rose-700"
                                >
                                  {fieldValidationErrors.validationType}
                                </p>
                              ) : null}
                            </div>
                          );
                        }

                        // validationMessage
                        return (
                          <div
                            key={field}
                            data-testid="inspector-edit-field-validationMessage"
                            className="rounded border border-emerald-200 bg-white px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <label
                                className="font-semibold text-emerald-900"
                                htmlFor="inspector-edit-input-validationMessage"
                              >
                                {fieldLabel(field)}
                              </label>
                              {hasFormValidationFieldOverride(field) ? (
                                <button
                                  type="button"
                                  data-testid="inspector-edit-reset-validationMessage"
                                  onClick={() => {
                                    handleResetFormValidationOverride(field);
                                  }}
                                  className="cursor-pointer rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                >
                                  Reset
                                </button>
                              ) : null}
                            </div>
                            <input
                              id="inspector-edit-input-validationMessage"
                              data-testid="inspector-edit-input-validationMessage"
                              type="text"
                              value={
                                formValidationControlInputs.validationMessage ??
                                ""
                              }
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setFormValidationControlInputs((current) => ({
                                  ...current,
                                  validationMessage: value,
                                }));
                                setFieldValidationErrors((current) => ({
                                  ...current,
                                  validationMessage: null,
                                }));
                              }}
                              onBlur={(event) => {
                                const value = event.currentTarget.value.trim();
                                if (value) {
                                  applyFormValidationOverrideInput({
                                    field: "validationMessage",
                                    rawValue: event.currentTarget.value,
                                  });
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              placeholder="Enter validation message..."
                              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
                            />
                            {fieldValidationErrors.validationMessage ? (
                              <p
                                data-testid="inspector-edit-error-validationMessage"
                                className="m-0 mt-1 text-[11px] text-rose-700"
                              >
                                {fieldValidationErrors.validationMessage}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {unsupportedFormValidationFields.length > 0 ? (
                  <div
                    data-testid="inspector-edit-unsupported-validation-fields"
                    className="mt-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
                  >
                    <p className="m-0 font-semibold text-slate-900">
                      Unsupported validation properties
                    </p>
                    {unsupportedFormValidationFields.map((entry) => (
                      <p
                        key={entry.field}
                        data-testid={`inspector-edit-unsupported-validation-${entry.field}`}
                        className="m-0 mt-1"
                      >
                        {entry.field}: {entry.reason ?? "Not supported."}
                      </p>
                    ))}
                  </div>
                ) : null}
                {structuredOverridePayload ? (
                  <div className="mt-2">
                    <p className="m-0 font-semibold text-slate-900">
                      Structured override payload
                    </p>
                    <pre
                      data-testid="inspector-edit-payload-preview"
                      className="m-0 mt-1 max-h-48 overflow-auto rounded border border-slate-300 bg-white p-2 text-[11px] text-slate-900"
                    >
                      {JSON.stringify(structuredOverridePayload, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : (
              <p
                data-testid="inspector-edit-node-missing"
                className="m-0 mt-2 text-indigo-400"
              >
                Selected node details are not available in design IR.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* Error banners — compact strip */}
      {sourceErrorBanners.length > 0 ? (
        <div
          className="flex shrink-0 flex-wrap gap-2 border-b border-[#000000] bg-[#241414] px-4 py-1.5"
          data-testid="inspector-error-banners"
        >
          {sourceErrorBanners.map((banner) => (
            <div
              key={banner.source}
              data-testid={`inspector-error-${banner.source}`}
              className="flex flex-wrap items-center gap-2 text-[11px] text-rose-400"
            >
              <span className="font-semibold">{banner.title}</span>
              <span>
                {banner.details.message} ({banner.details.code}, HTTP{" "}
                {String(banner.details.status)})
              </span>
              {banner.onRetry ? (
                <button
                  type="button"
                  data-testid={`inspector-banner-retry-${banner.source}`}
                  onClick={banner.onRetry}
                  className="cursor-pointer rounded border border-rose-500/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-rose-400 transition hover:bg-rose-500/10"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {manifestState.status === "empty" ? (
        <div className="shrink-0 border-b border-[#000000] bg-[#242014] px-4 py-1">
          <p
            data-testid="inspector-manifest-empty-warning"
            className="m-0 text-[11px] text-amber-400"
          >
            Component manifest is empty. Tree selection still works, but
            file-to-component mappings are unavailable.
          </p>
        </div>
      ) : null}

      {activePipeline.stage === "partial" ||
      activePipeline.errors.length > 0 ? (
        <PipelineStatusBar
          stage={activePipeline.stage}
          errors={activePipeline.errors}
          stageProgress={activePipeline.stageProgress}
          {...(activePipeline.fallbackMode !== undefined
            ? { fallbackMode: activePipeline.fallbackMode }
            : {})}
          {...(activePipeline.partialStats !== undefined
            ? { partialStats: activePipeline.partialStats }
            : {})}
          {...(activePipeline.pasteDeltaSummary !== undefined
            ? { pasteDeltaSummary: activePipeline.pasteDeltaSummary }
            : {})}
          canRetry={activePipeline.canRetry}
          {...(onPipelineRetry !== undefined
            ? { onRetry: handleRetryCurrentPipeline }
            : {})}
          onCopyReport={handleCopyPipelineReport}
        />
      ) : null}

      {/* ===== THREE-COLUMN IDE LAYOUT ===== */}
      <div
        ref={layoutContainerRef}
        className="flex min-h-0 flex-1 flex-col xl:flex-row"
        data-testid="inspector-layout"
      >
        {/* Left: Component Tree sidebar */}
        {hasTreePane ? (
          <div
            data-testid="inspector-pane-tree"
            className="min-h-[120px] shrink-0 border-r border-[#000000]"
            style={treePaneStyle}
          >
            {treeRecoveryError ? (
              <div
                data-testid="inspector-tree-recovery-banner"
                className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {treeRecoveryError.stage === "resolving"
                      ? "Source import degraded"
                      : "Transform partial"}
                  </span>
                  <span>{treeRecoveryError.message}</span>
                  {onPipelineRetry ? (
                    <button
                      type="button"
                      data-testid="inspector-tree-recovery-retry"
                      onClick={() => {
                        onPipelineRetry(treeRecoveryError.stage);
                      }}
                      className="cursor-pointer rounded border border-amber-400/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-400/10"
                    >
                      Retry {treeRecoveryError.stage}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {designIrState.status === "ready" ||
            effectiveTreeNodes.length > 0 ? (
              <ComponentTree
                screens={effectiveTreeNodes}
                selectedId={selectedNodeId}
                onSelect={handleTreeSelect}
                onEnterScope={handleEnterScope}
                collapsed={treeCollapsed}
                onToggleCollapsed={() => {
                  setTreeCollapsed((prev) => !prev);
                }}
                diagnosticsMap={nodeDiagnosticsMap}
                selectionEnabled={treeSelectionEnabled}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col bg-[#191919] p-3">
                <div
                  data-testid={`inspector-design-ir-state-${designIrState.status}`}
                  className="rounded border border-[#333333] bg-[#232323] px-3 py-2 text-xs text-white/65"
                >
                  {designIrState.status === "loading" ? (
                    <p className="m-0">Loading design IR…</p>
                  ) : null}
                  {designIrState.status === "empty" ? (
                    <p className="m-0">
                      No component tree data is available for this job.
                    </p>
                  ) : null}
                  {designIrState.status === "error" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Design IR failed to load.</span>
                      <button
                        type="button"
                        data-testid="inspector-retry-design-ir"
                        onClick={handleRetryDesignIr}
                        className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[11px] font-semibold text-white/65 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87]"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Resizable divider: tree ↔ preview (desktop + expanded tree only) */}
        {hasExpandedTree ? (
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize tree and preview panes"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={treeSeparatorNow}
            data-testid="inspector-splitter-tree-preview"
            className="group hidden shrink-0 cursor-col-resize select-none focus:outline-none xl:flex xl:w-3 xl:items-stretch xl:justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={handleSplitterPointerDown("tree-preview")}
            onPointerMove={handleSplitterPointerMove}
            onPointerUp={handleSplitterPointerUp}
            onPointerCancel={handleSplitterPointerCancel}
            onLostPointerCapture={handleSplitterLostPointerCapture}
            onKeyDown={handleSplitterKeyDown("tree-preview")}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none h-full w-px bg-[#000000] transition-colors group-hover:bg-[#4eba87] group-focus:bg-[#4eba87]"
            />
          </div>
        ) : null}

        {/* Center: Preview pane */}
        <div
          data-testid="inspector-pane-preview"
          className="relative min-h-[200px] flex-1 border-r border-[#000000] lg:min-h-0"
          style={previewPaneStyle}
        >
          {previewRecoveryMessage ? (
            <div
              data-testid="inspector-preview-recovery-banner"
              className="border-b border-sky-500/20 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100"
            >
              {previewRecoveryMessage}
            </div>
          ) : null}
          <PreviewPane
            previewUrl={previewUrl}
            inspectEnabled={inspectEnabled}
            activeScopeNodeId={activeScopeNodeId}
            onToggleInspect={handleToggleInspect}
            onInspectSelect={handleInspectSelect}
            {...(activePipeline.stage !== "idle"
              ? { pipelineStage: activePipeline.stage }
              : {})}
            {...(activePipeline.screenshot
              ? { screenshot: activePipeline.screenshot }
              : {})}
          />
        </div>

        {/* Horizontal divider for stacked layout */}
        <div className="h-px shrink-0 bg-[#000000] xl:hidden" />

        {/* Resizable divider: preview ↔ code (desktop) */}
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize preview and code panes"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={previewSeparatorNow}
          data-testid="inspector-splitter-preview-code"
          className="group hidden shrink-0 cursor-col-resize select-none focus:outline-none xl:flex xl:w-3 xl:items-stretch xl:justify-center"
          style={{ touchAction: "none" }}
          onPointerDown={handleSplitterPointerDown("preview-code")}
          onPointerMove={handleSplitterPointerMove}
          onPointerUp={handleSplitterPointerUp}
          onPointerCancel={handleSplitterPointerCancel}
          onLostPointerCapture={handleSplitterLostPointerCapture}
          onKeyDown={handleSplitterKeyDown("preview-code")}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none h-full w-px bg-[#000000] transition-colors group-hover:bg-[#4eba87] group-focus:bg-[#4eba87]"
          />
        </div>

        {/* Right: Code pane */}
        <div
          data-testid="inspector-pane-code"
          className="min-h-[200px] flex-1 lg:min-h-0"
          style={codePaneStyle}
        >
          {qualityScoreModel.summary.totalNodes > 0 ||
          tokenSuggestionsModel.available ||
          a11yNudgeModel.summary.total > 0 ? (
            <div
              data-testid="inspector-suggestions-host"
              className="border-b border-[#000000] bg-[#171717] p-2"
            >
              <SuggestionsPanel
                qualityScore={qualityScoreModel}
                tokenModel={tokenSuggestionsModel}
                a11yResult={a11yNudgeModel}
                onApplyTokenDecisions={handleApplyTokenDecisions}
              />
              {tokenDecisionsStatus.state !== "idle" ? (
                <p
                  data-testid="inspector-token-decisions-status"
                  data-state={tokenDecisionsStatus.state}
                  className={`mt-1 text-[11px] ${
                    tokenDecisionsStatus.state === "error"
                      ? "text-rose-300"
                      : tokenDecisionsStatus.state === "saved"
                        ? "text-emerald-300"
                        : "text-white/60"
                  }`}
                >
                  {tokenDecisionsStatus.state === "saving"
                    ? "Saving token decisions…"
                    : tokenDecisionsStatus.state === "saved"
                      ? `Token decisions saved${
                          tokenDecisionsStatus.updatedAt
                            ? ` (${tokenDecisionsStatus.updatedAt})`
                            : ""
                        }.`
                      : `Failed to save token decisions: ${tokenDecisionsStatus.message ?? "Unknown error."}`}
                </p>
              ) : null}
            </div>
          ) : null}
          {generatingRetryTargets.length > 0 ? (
            <div
              data-testid="inspector-code-recovery-banner"
              className="border-b border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200"
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    Some generated files failed.
                  </span>
                  <span>
                    Successfully generated files remain available below.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {generatingRetryTargets.map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      data-testid={`inspector-code-retry-target-${target.id}`}
                      onClick={() => {
                        handleRetryGeneratingTarget(target.id);
                      }}
                      className="cursor-pointer rounded border border-rose-400/30 bg-transparent px-2 py-0.5 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-400/10"
                    >
                      Retry {target.filePath ?? target.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <CodePane
            files={files}
            selectedFile={effectiveSelectedFile}
            onSelectFile={handleSelectFile}
            filesState={effectiveFilesState.status}
            filesError={effectiveFilesState.error}
            onRetryFiles={handleRetryFiles}
            fileContent={fileContentState.content}
            fileContentState={fileContentState.status}
            fileContentError={fileContentState.error}
            onRetryFileContent={handleRetryFileContent}
            highlightRange={highlightRange}
            previousJobId={previousJobId}
            previousFileContent={effectivePreviousFileContent}
            previousFileContentLoading={effectivePreviousFileContentLoading}
            previousManifestRange={previousManifestRange}
            nodeDiffFallbackReason={nodeDiffFallbackReason}
            breadcrumbPath={breadcrumbPath}
            onBreadcrumbSelect={handleTreeSelect}
            hasActiveScope={hasActiveScope}
            onEnterScope={handleEnterScope}
            onExitScope={canLevelUp ? handleExitScope : undefined}
            splitFile={effectiveSplitFile}
            splitFileContent={splitFileContent}
            splitFileContentLoading={splitFileContentLoading}
            onSelectSplitFile={handleSelectSplitFile}
            boundariesEnabled={boundariesEnabled}
            onBoundariesEnabledChange={setBoundariesEnabled}
            fileBoundaries={selectedFileBoundaries}
            splitFileBoundaries={splitFileBoundaries}
            onBoundarySelect={handleTreeSelect}
            activeManifestRange={activeManifestRange}
            isNodeMapped={isNodeMapped}
            selectedIrNodeId={selectedNodeId}
            parentFile={canReturnToParentFile ? parentFile : null}
            onReturnToParentFile={
              canReturnToParentFile ? handleReturnToParentFile : undefined
            }
          />
        </div>
      </div>

      {/* Node diagnostics — shown as status bar at bottom */}
      {selectedNodeId &&
      getNodeDiagnostics(nodeDiagnosticsMap, selectedNodeId).length > 0 ? (
        <div
          data-testid="inspector-node-diagnostics-detail"
          className="flex shrink-0 flex-wrap gap-3 border-t border-[#2a2a3d] bg-[#252536] px-4 py-1"
        >
          {getNodeDiagnostics(nodeDiagnosticsMap, selectedNodeId).map(
            (diag, idx) => {
              const badge = getNodeDiagnosticBadge(diag.category);
              return (
                <span
                  key={`${diag.category}-${String(idx)}`}
                  data-testid={`inspector-node-diagnostic-${diag.category}`}
                  className="flex items-center gap-1 text-[10px] text-slate-400"
                >
                  <span
                    className={`inline-flex h-3.5 min-w-[1rem] items-center justify-center rounded px-0.5 text-[8px] font-bold leading-none ${badge.color}`}
                  >
                    {badge.abbr}
                  </span>
                  {diag.reason}
                </span>
              );
            },
          )}
        </div>
      ) : null}

      {/* ===== CONFIG DIALOGS ===== */}

      {/* Pre-Apply Review Dialog */}
      <ConfigDialog
        open={openDialog === "preApplyReview"}
        onClose={handleCloseDialog}
        title="Pre-Apply Review"
      >
        <div
          data-testid="inspector-impact-review-panel"
          className="text-xs text-sky-950"
        >
          <p className="m-0 font-semibold">Pre-Apply Review</p>
          <p className="m-0 mt-1">
            Review grouped file-level blast radius before creating a
            regeneration job.
          </p>
          <p
            data-testid="inspector-impact-review-diff-guidance"
            className="m-0 mt-1 text-sky-900"
          >
            After regeneration, use the existing code pane and diff controls for
            detailed code review.
          </p>
          {impactReviewModel.empty ? (
            <p
              data-testid="inspector-impact-review-empty"
              className="m-0 mt-2 rounded border border-sky-200 bg-white px-2 py-1 text-slate-700"
            >
              No pending overrides. Add overrides in Edit Studio to prepare a
              regeneration review.
            </p>
          ) : (
            <>
              <div
                data-testid="inspector-impact-review-summary"
                className="mt-2 rounded border border-sky-200 bg-white px-2 py-1.5 text-slate-800"
              >
                <p className="m-0 font-semibold text-slate-900">
                  Blast radius summary
                </p>
                <p
                  data-testid="inspector-impact-review-summary-total"
                  className="m-0 mt-1"
                >
                  Total overrides:{" "}
                  {String(impactReviewModel.summary.totalOverrides)}
                </p>
                <p
                  data-testid="inspector-impact-review-summary-files"
                  className="m-0 mt-1"
                >
                  Affected files:{" "}
                  {String(impactReviewModel.summary.affectedFiles)}
                </p>
                <p
                  data-testid="inspector-impact-review-summary-mapped"
                  className="m-0 mt-1"
                >
                  Mapped overrides:{" "}
                  {String(impactReviewModel.summary.mappedOverrides)}
                </p>
                <p
                  data-testid="inspector-impact-review-summary-unmapped"
                  className="m-0 mt-1"
                >
                  Unmapped overrides:{" "}
                  {String(impactReviewModel.summary.unmappedOverrides)}
                </p>
                <p
                  data-testid="inspector-impact-review-summary-categories"
                  className="m-0 mt-1"
                >
                  Categories:{" "}
                  {String(impactReviewModel.summary.categories.visual)} visual,{" "}
                  {String(impactReviewModel.summary.categories.layout)} layout,{" "}
                  {String(impactReviewModel.summary.categories.validation)}{" "}
                  validation,{" "}
                  {String(impactReviewModel.summary.categories.other)} other
                </p>
              </div>
              {impactReviewModel.summary.categories.layout > 0 ? (
                <p
                  data-testid="inspector-impact-review-layout-risk"
                  className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
                >
                  Layout overrides can affect sibling flow, spacing, and
                  wrapping across every mapped file listed below.
                </p>
              ) : null}
              <div
                data-testid="inspector-impact-review-file-list"
                className="mt-2 grid gap-2"
              >
                {impactReviewModel.files.map((fileReview, index) => (
                  <div
                    key={fileReview.filePath}
                    data-testid={`inspector-impact-review-file-${String(index)}`}
                    className="rounded border border-sky-200 bg-white px-2 py-1.5 text-slate-800"
                  >
                    <p className="m-0 font-semibold text-slate-900">
                      <code>{fileReview.filePath}</code>
                    </p>
                    <p className="m-0 mt-1">
                      Overrides: {String(fileReview.overrideCount)} (
                      {String(fileReview.categories.visual)} visual,{" "}
                      {String(fileReview.categories.layout)} layout,{" "}
                      {String(fileReview.categories.validation)} validation,{" "}
                      {String(fileReview.categories.other)} other)
                    </p>
                    <ul className="m-0 mt-1 list-disc pl-4 text-[11px]">
                      {fileReview.overrides.map((entry) => (
                        <li
                          key={`${entry.nodeId}:${entry.field}`}
                          data-testid={`inspector-impact-review-override-${entry.nodeId}-${entry.field}`}
                        >
                          {entry.nodeName} ({entry.nodeType}) → {entry.field} [
                          {entry.category}]
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {impactReviewModel.unmapped.length > 0 ? (
                <div
                  data-testid="inspector-impact-review-unmapped-list"
                  className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900"
                >
                  <p className="m-0 font-semibold">Unmapped overrides</p>
                  <ul className="m-0 mt-1 list-disc pl-4">
                    {impactReviewModel.unmapped.map((entry) => (
                      <li key={`${entry.nodeId}:${entry.field}`}>
                        {entry.nodeId} → {entry.field} [{entry.category}]
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="inspector-impact-review-regenerate-button"
              disabled={!canSubmitRegeneration}
              onClick={handleSubmitRegeneration}
              className="cursor-pointer rounded border border-sky-500 bg-sky-500 px-2 py-1 text-[11px] font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-default disabled:opacity-40"
            >
              {regenerateMutation.isPending
                ? "Submitting regeneration..."
                : "Regenerate From Overrides"}
            </button>
            {!isRegenerationJob ? (
              <span
                data-testid="inspector-impact-review-regeneration-required"
                className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900"
              >
                Regenerate first to enable Local Sync and PR actions.
              </span>
            ) : (
              <span
                data-testid="inspector-impact-review-regeneration-active"
                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900"
              >
                Regeneration job active. Continue review in code/diff.
              </span>
            )}
          </div>
          {regenerationAccepted ? (
            <p
              data-testid="inspector-impact-review-regeneration-accepted"
              className="m-0 mt-2 rounded border border-emerald-300 bg-emerald-100 px-2 py-1 text-emerald-900"
            >
              Regeneration accepted as job{" "}
              <code>{regenerationAccepted.jobId}</code>. Inspector switches to
              the new job automatically.
            </p>
          ) : null}
          {regenerationError ? (
            <p
              data-testid="inspector-impact-review-regeneration-error"
              className="m-0 mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900"
            >
              [{regenerationError.code}] {regenerationError.message} (HTTP{" "}
              {String(regenerationError.status)})
            </p>
          ) : null}
        </div>
      </ConfigDialog>

      {/* Local Sync Dialog */}
      <ConfigDialog
        open={openDialog === "localSync"}
        onClose={handleCloseDialog}
        title="Local Sync (Regeneration Jobs)"
      >
        <div
          data-testid="inspector-sync-panel"
          className="text-xs text-emerald-950"
        >
          <p className="m-0 font-semibold">Local Sync (Regeneration Jobs)</p>
          <p className="m-0 mt-1">
            Run a dry-run first, review the file-by-file write plan, then
            explicitly confirm overwrite before applying local sync.
          </p>
          {!isRegenerationJob ? (
            <p
              data-testid="inspector-sync-regeneration-required"
              className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
            >
              Local sync is disabled for non-regeneration jobs. Create and open
              a regeneration job first.
            </p>
          ) : null}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="font-semibold text-emerald-900">
                Target path override (optional)
              </span>
              <input
                type="text"
                data-testid="inspector-sync-target-path"
                value={syncTargetPathInput}
                onChange={(event) => {
                  setSyncTargetPathInput(event.currentTarget.value);
                }}
                placeholder="apps/generated"
                className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <button
              type="button"
              data-testid="inspector-sync-preview-button"
              disabled={syncPreviewDisabled}
              onClick={handlePreviewLocalSync}
              className="cursor-pointer rounded border border-emerald-400 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-default disabled:opacity-40"
            >
              {previewSyncMutation.isPending
                ? "Previewing..."
                : "Preview Sync Plan"}
            </button>
          </div>
          {syncPreviewPlan && effectiveSyncSummary ? (
            <div
              data-testid="inspector-sync-preview-summary"
              className="mt-2 rounded border border-emerald-300 bg-white px-2 py-1.5 text-slate-800"
            >
              <p className="m-0 font-semibold text-slate-900">
                Dry-run summary
              </p>
              <p className="m-0 mt-1">
                Destination: <code>{syncPreviewPlan.destinationRoot}</code>
              </p>
              <p className="m-0 mt-1">
                Files: {String(effectiveSyncSummary.totalFiles)} total,{" "}
                {String(effectiveSyncSummary.createCount)} create,{" "}
                {String(effectiveSyncSummary.overwriteCount)} managed overwrite,{" "}
                {String(effectiveSyncSummary.conflictCount)} conflict,{" "}
                {String(effectiveSyncSummary.untrackedCount)} untracked,{" "}
                {String(effectiveSyncSummary.unchangedCount)} unchanged
              </p>
              <p
                className="m-0 mt-1"
                data-testid="inspector-sync-selected-summary"
              >
                Selected: {String(effectiveSyncSummary.selectedFiles)} files (
                {String(effectiveSyncSummary.selectedBytes)} bytes)
              </p>
              <p className="m-0 mt-1">
                Confirmation expires: {syncPreviewPlan.confirmationExpiresAt}
              </p>
            </div>
          ) : null}
          {effectiveSyncSummary &&
          effectiveSyncSummary.conflictCount +
            effectiveSyncSummary.untrackedCount >
            0 ? (
            <p
              data-testid="inspector-sync-attention-banner"
              className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
            >
              Conflicts and untracked files default to skip until you explicitly
              choose to write them.
            </p>
          ) : null}
          {effectiveSyncPreviewFiles.length > 0 ? (
            <div
              data-testid="inspector-sync-file-list"
              className="mt-2 grid max-h-64 gap-2 overflow-auto"
            >
              {effectiveSyncPreviewFiles.map((entry, index) => {
                const checked = entry.decision === "write";
                const disabled =
                  !canWriteLocalSyncEntry(entry) ||
                  previewSyncMutation.isPending ||
                  applySyncMutation.isPending ||
                  regenerateMutation.isPending;
                return (
                  <div
                    key={entry.path}
                    data-testid={`inspector-sync-file-${String(index)}`}
                    className={`rounded border px-2 py-1.5 ${
                      isAttentionSyncEntry(entry)
                        ? "border-amber-300 bg-amber-50"
                        : "border-emerald-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex min-w-0 flex-1 items-start gap-2 text-slate-900">
                        <input
                          type="checkbox"
                          data-testid={`inspector-sync-file-toggle-${String(index)}`}
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => {
                            handleToggleLocalSyncFile(
                              entry.path,
                              event.currentTarget.checked,
                            );
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-emerald-400"
                        />
                        <span className="min-w-0">
                          <code className="break-all">{entry.path}</code>
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-1 text-[11px]">
                        <span
                          data-testid={`inspector-sync-file-status-${String(index)}`}
                          className={`rounded border px-1.5 py-0.5 font-semibold ${getLocalSyncStatusClasses(entry.status)}`}
                        >
                          {toLocalSyncStatusLabel(entry.status)}
                        </span>
                        <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-slate-700">
                          {toLocalSyncActionLabel(entry.action)}
                        </span>
                      </div>
                    </div>
                    <p className="m-0 mt-1 text-slate-700">{entry.message}</p>
                    <p className="m-0 mt-1 text-[11px] text-slate-600">
                      Size: {String(entry.sizeBytes)} bytes
                      {entry.selectedByDefault
                        ? " • default write"
                        : " • default skip"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-slate-800">
              <input
                type="checkbox"
                data-testid="inspector-sync-confirm-overwrite"
                checked={syncConfirmationChecked}
                disabled={
                  !isRegenerationJob ||
                  !syncPreviewPlan ||
                  previewSyncMutation.isPending ||
                  applySyncMutation.isPending ||
                  regenerateMutation.isPending
                }
                onChange={(event) => {
                  setSyncConfirmationChecked(event.currentTarget.checked);
                }}
                className="h-4 w-4 rounded border-emerald-400"
              />
              <span>Confirm overwrite and apply sync</span>
            </label>
            <button
              type="button"
              data-testid="inspector-sync-apply-button"
              disabled={syncApplyDisabled}
              onClick={handleApplyLocalSync}
              className="cursor-pointer rounded border border-emerald-500 bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-default disabled:opacity-40"
            >
              {applySyncMutation.isPending ? "Applying..." : "Apply Sync"}
            </button>
          </div>
          {syncApplyResult ? (
            <p
              data-testid="inspector-sync-success"
              className="m-0 mt-2 rounded border border-emerald-300 bg-emerald-100 px-2 py-1 text-emerald-900"
            >
              Local sync applied at {syncApplyResult.appliedAt}. Wrote{" "}
              {String(syncApplyResult.summary.selectedFiles)} files to{" "}
              <code>{syncApplyResult.destinationRoot}</code>.
            </p>
          ) : null}
          {syncError ? (
            <p
              data-testid="inspector-sync-error"
              className="m-0 mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900"
            >
              [{syncError.code}] {syncError.message} (HTTP{" "}
              {String(syncError.status)})
            </p>
          ) : null}
        </div>
      </ConfigDialog>

      {/* Create PR Dialog */}
      <ConfigDialog
        open={openDialog === "createPr"}
        onClose={handleCloseDialog}
        title="Create PR (Regeneration Jobs)"
      >
        <div
          data-testid="inspector-pr-panel"
          className="text-xs text-indigo-950"
        >
          <p className="m-0 font-semibold">Create PR (Regeneration Jobs)</p>
          <p className="m-0 mt-1">
            Create a GitHub Pull Request from regenerated output. Requires a
            GitHub repository URL and access token.
          </p>
          {!isRegenerationJob ? (
            <p
              data-testid="inspector-pr-regeneration-required"
              className="m-0 mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
            >
              PR creation is disabled for non-regeneration jobs. Regenerate
              first from the review panel.
            </p>
          ) : null}
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="font-semibold text-indigo-900">
                Repository URL
              </span>
              <input
                type="text"
                data-testid="inspector-pr-repo-url"
                value={prRepoUrlInput}
                onChange={(event) => {
                  setPrRepoUrlInput(event.currentTarget.value);
                }}
                placeholder="https://github.com/owner/repo"
                className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="font-semibold text-indigo-900">
                Access Token
              </span>
              <input
                type="password"
                data-testid="inspector-pr-repo-token"
                value={prRepoTokenInput}
                onChange={(event) => {
                  setPrRepoTokenInput(event.currentTarget.value);
                }}
                placeholder="ghp_..."
                className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <label className="flex min-w-[220px] flex-1 flex-col gap-1">
              <span className="font-semibold text-indigo-900">
                Target path (optional)
              </span>
              <input
                type="text"
                data-testid="inspector-pr-target-path"
                value={prTargetPathInput}
                onChange={(event) => {
                  setPrTargetPathInput(event.currentTarget.value);
                }}
                placeholder="generated"
                className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
          </div>
          <div className="mt-2">
            <button
              type="button"
              data-testid="inspector-pr-create-button"
              disabled={prCreateDisabled}
              onClick={handleCreatePr}
              className="cursor-pointer rounded border border-indigo-500 bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-default disabled:opacity-40"
            >
              {createPrMutation.isPending ? "Creating PR..." : "Create PR"}
            </button>
          </div>
          {prResult ? (
            <div
              data-testid="inspector-pr-success"
              className="m-0 mt-2 rounded border border-indigo-300 bg-indigo-100 px-2 py-1 text-indigo-900"
            >
              <p className="m-0 font-semibold">PR created successfully</p>
              {prResult.gitPr.prUrl ? (
                <p className="m-0 mt-1">
                  PR URL:{" "}
                  <a
                    href={prResult.gitPr.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-700 underline"
                    data-testid="inspector-pr-url-link"
                  >
                    {prResult.gitPr.prUrl}
                  </a>
                </p>
              ) : null}
              {prResult.gitPr.branchName ? (
                <p className="m-0 mt-1">
                  Branch: <code>{prResult.gitPr.branchName}</code>
                </p>
              ) : null}
              {prResult.gitPr.changedFiles &&
              prResult.gitPr.changedFiles.length > 0 ? (
                <p className="m-0 mt-1">
                  Changed files: {String(prResult.gitPr.changedFiles.length)}
                </p>
              ) : null}
            </div>
          ) : null}
          {prError ? (
            <p
              data-testid="inspector-pr-error"
              className="m-0 mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900"
            >
              [{prError.code}] {prError.message} (HTTP {String(prError.status)})
            </p>
          ) : null}
        </div>
      </ConfigDialog>

      {/* Inspectability Coverage Summary Dialog */}
      <ConfigDialog
        open={openDialog === "inspectability"}
        onClose={handleCloseDialog}
        title="Inspectability Coverage Summary"
      >
        <div data-testid="inspector-inspectability-summary" className="text-xs">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-700">
            Inspectability Coverage Summary
          </p>
          <p
            data-testid="inspector-summary-aggregate-note"
            className="m-0 mt-1 text-xs text-slate-600"
          >
            {nodeDiagnosticsMap.size > 0
              ? "Node-level diagnostics available. Select a node to see details."
              : inspectabilitySummary.aggregateOnlyNote}
          </p>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <div
              data-testid="inspector-summary-manifest-coverage"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
            >
              <p className="m-0 font-semibold text-slate-900">
                Manifest coverage
              </p>
              {inspectabilitySummary.manifestCoverage.status === "ready" ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <span data-testid="inspector-summary-mapped-count">
                    Mapped:{" "}
                    {String(inspectabilitySummary.manifestCoverage.mappedNodes)}
                  </span>
                  <span data-testid="inspector-summary-unmapped-count">
                    Unmapped:{" "}
                    {String(
                      inspectabilitySummary.manifestCoverage.unmappedNodes,
                    )}
                  </span>
                  <span data-testid="inspector-summary-total-count">
                    Total IR nodes:{" "}
                    {String(inspectabilitySummary.manifestCoverage.totalNodes)}
                  </span>
                  <span data-testid="inspector-summary-mapped-percent">
                    Coverage:{" "}
                    {String(
                      inspectabilitySummary.manifestCoverage.mappedPercent,
                    )}
                    %
                  </span>
                </div>
              ) : (
                <p
                  data-testid={`inspector-summary-manifest-${inspectabilitySummary.manifestCoverage.status}`}
                  className="m-0 mt-1 text-slate-600"
                >
                  {inspectabilitySummary.manifestCoverage.message}
                </p>
              )}
            </div>

            <div
              data-testid="inspector-summary-design-ir-omissions"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
            >
              <p className="m-0 font-semibold text-slate-900">
                Design IR cleanup/omission counters
              </p>
              {inspectabilitySummary.omissionMetrics.status === "ready" ? (
                <div className="mt-1 grid gap-1">
                  <span data-testid="inspector-summary-omission-skipped-hidden">
                    Hidden nodes skipped:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics.skippedHidden,
                    )}
                  </span>
                  <span data-testid="inspector-summary-omission-skipped-placeholders">
                    Placeholder nodes skipped:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics.skippedPlaceholders,
                    )}
                  </span>
                  <span data-testid="inspector-summary-omission-truncated-by-budget">
                    Nodes truncated by budget:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics.truncatedByBudget,
                    )}
                  </span>
                  <span data-testid="inspector-summary-omission-depth-truncated-branches">
                    Depth-truncated branches:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics
                        .depthTruncatedBranches,
                    )}
                  </span>
                  <span data-testid="inspector-summary-omission-classification-fallbacks">
                    Classification fallbacks:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics
                        .classificationFallbacks,
                    )}
                  </span>
                  <span data-testid="inspector-summary-omission-degraded-geometry">
                    Degraded geometry nodes:{" "}
                    {String(
                      inspectabilitySummary.omissionMetrics
                        .degradedGeometryNodes,
                    )}
                  </span>
                </div>
              ) : (
                <p
                  data-testid={`inspector-summary-omission-${inspectabilitySummary.omissionMetrics.status}`}
                  className="m-0 mt-1 text-slate-600"
                >
                  {inspectabilitySummary.omissionMetrics.message}
                </p>
              )}
            </div>
          </div>
        </div>
      </ConfigDialog>

      {/* Shortcut help overlay */}
      <ShortcutHelp
        open={shortcutHelpOpen}
        onClose={() => {
          setShortcutHelpOpen(false);
        }}
      />
    </div>
  );
}

(
  InspectorPanel as typeof InspectorPanel & {
    __TEST_ONLY__: typeof inspectorPanelTestOnly;
  }
).__TEST_ONLY__ = inspectorPanelTestOnly;
