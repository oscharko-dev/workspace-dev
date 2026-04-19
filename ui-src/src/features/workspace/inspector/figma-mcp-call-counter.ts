/**
 * Figma MCP call counter for Issue #1093 (proactive plan-budget warning).
 *
 * Tracks successful MCP calls per YYYY-MM so the Inspector can render a
 * non-blocking banner at >=80% of the Figma Starter plan budget (6/month).
 * Local, air-gap-safe (no network). SSR-safe (window guarded). Malformed
 * or version-mismatched storage payloads are discarded silently.
 */

import {
  dispatchImportGovernanceEvent,
  type ImportGovernanceEvent,
} from "./import-governance-events";

export const FIGMA_STARTER_BUDGET = 6;
export const WARNING_THRESHOLD_PCT = 80;
export const FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION = 1;

const STORAGE_KEY = "workspace-dev:mcp-call-counter";
const DISMISS_KEY_PREFIX = "workspace-dev:mcp-budget-banner-dismissed:";

export interface QuotaSnapshot {
  readonly callsThisMonth: number;
  readonly budget: number;
  readonly usagePct: number;
  readonly thresholdCrossed: boolean;
  readonly month: string;
}

export interface CounterOptions {
  readonly now?: () => Date;
}

interface InternalState {
  month: string;
  callsThisMonth: number;
  thresholdDispatchedForMonth: string | null;
  restored: boolean;
}

interface PersistedEnvelope {
  readonly version: number;
  readonly month: string;
  readonly callsThisMonth: number;
  readonly thresholdDispatchedForMonth: string | null;
}

function formatMonth(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

function createInitialState(): InternalState {
  return {
    month: "",
    callsThisMonth: 0,
    thresholdDispatchedForMonth: null,
    restored: false,
  };
}

let state: InternalState = createInitialState();
// Reset on module load so the "exactly once per session" dispatch guard is
// session-scoped, not bound to localStorage. The persisted
// thresholdDispatchedForMonth is independent (cross-tab hint) and still
// honored on restore.
let hasDispatchedThisSession = false;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isNonNegativeFiniteInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Math.floor(value) === value
  );
}

function isPersistedEnvelope(value: unknown): value is PersistedEnvelope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION) {
    return false;
  }
  if (typeof record["month"] !== "string" || record["month"].length === 0) {
    return false;
  }
  if (!isNonNegativeFiniteInt(record["callsThisMonth"])) {
    return false;
  }
  const dispatched = record["thresholdDispatchedForMonth"];
  if (dispatched !== null && typeof dispatched !== "string") {
    return false;
  }
  return true;
}

function restoreFromStorage(): void {
  const storage = getLocalStorage();
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
  state.month = parsed.month;
  state.callsThisMonth = parsed.callsThisMonth;
  state.thresholdDispatchedForMonth = parsed.thresholdDispatchedForMonth;
}

function ensureRestored(): void {
  if (state.restored) {
    return;
  }
  state.restored = true;
  restoreFromStorage();
}

function persist(): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  const envelope: PersistedEnvelope = {
    version: FIGMA_MCP_CALL_COUNTER_STORAGE_VERSION,
    month: state.month,
    callsThisMonth: state.callsThisMonth,
    thresholdDispatchedForMonth: state.thresholdDispatchedForMonth,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    return;
  }
}

function rollMonthIfNeeded(currentMonth: string): void {
  if (state.month === currentMonth) {
    return;
  }
  state.month = currentMonth;
  state.callsThisMonth = 0;
  state.thresholdDispatchedForMonth = null;
}

function computeUsagePct(callsThisMonth: number): number {
  return Math.round((callsThisMonth / FIGMA_STARTER_BUDGET) * 100);
}

function resolveNow(options?: CounterOptions): Date {
  return options?.now?.() ?? new Date();
}

export function getQuotaSnapshot(options?: CounterOptions): QuotaSnapshot {
  ensureRestored();
  const month = formatMonth(resolveNow(options));
  const callsThisMonth = state.month === month ? state.callsThisMonth : 0;
  const usagePct = computeUsagePct(callsThisMonth);
  const thresholdCrossed = usagePct >= WARNING_THRESHOLD_PCT;
  return Object.freeze({
    callsThisMonth,
    budget: FIGMA_STARTER_BUDGET,
    usagePct,
    thresholdCrossed,
    month,
  });
}

export function recordMcpCall(options?: CounterOptions): void {
  ensureRestored();
  const month = formatMonth(resolveNow(options));
  rollMonthIfNeeded(month);
  state.callsThisMonth += 1;
  const usagePct = computeUsagePct(state.callsThisMonth);
  const thresholdCrossed = usagePct >= WARNING_THRESHOLD_PCT;
  if (thresholdCrossed && !hasDispatchedThisSession) {
    hasDispatchedThisSession = true;
    state.thresholdDispatchedForMonth = state.month;
    const event: ImportGovernanceEvent = {
      kind: "mcp-budget-threshold-crossed",
      callsThisMonth: state.callsThisMonth,
      budget: FIGMA_STARTER_BUDGET,
      month: state.month,
    };
    dispatchImportGovernanceEvent(event);
  }
  persist();
}

export function isBannerDismissedForMonth(month: string): boolean {
  const storage = getSessionStorage();
  if (storage === null) {
    return false;
  }
  try {
    return storage.getItem(`${DISMISS_KEY_PREFIX}${month}`) === "1";
  } catch {
    return false;
  }
}

export function dismissBannerForMonth(month: string): void {
  const storage = getSessionStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(`${DISMISS_KEY_PREFIX}${month}`, "1");
  } catch {
    return;
  }
}

export function __resetFigmaMcpCallCounterForTests(): void {
  state = createInitialState();
  hasDispatchedThisSession = false;
  const storage = getLocalStorage();
  if (storage !== null) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
