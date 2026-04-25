import type {
  IntentRedaction,
  IntentTraceRef,
  PiiIndicator,
  PiiKind,
  PiiMatchLocation,
} from "../contracts/index.js";
import { detectPii, type PiiMatch } from "./pii-detection.js";

export interface PiiRedactionContext {
  screenId: string;
  elementId?: string;
  traceRef: IntentTraceRef;
  location: PiiMatchLocation;
}

export const maybeRedact = (
  value: string,
  ctx: PiiRedactionContext,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): string => {
  const match = detectPii(value);
  if (match === null) return value;
  recordPii(match, ctx, piiIndicators, redactions);
  return match.redacted;
};

export const recordPiiIndicator = (
  input: {
    kind: PiiKind;
    confidence: number;
    redacted: string;
  },
  ctx: PiiRedactionContext,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  recordPii(input, ctx, piiIndicators, redactions);
};

const recordPii = (
  match: PiiMatch,
  ctx: PiiRedactionContext,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  const prefix = ctx.elementId ?? ctx.screenId;
  const indicatorId = `${prefix}::pii::${match.kind}::${ctx.location}`;
  if (piiIndicators.some((indicator) => indicator.id === indicatorId)) {
    return;
  }
  const indicator: PiiIndicator = {
    id: indicatorId,
    kind: match.kind,
    confidence: match.confidence,
    matchLocation: ctx.location,
    redacted: match.redacted,
    screenId: ctx.screenId,
    traceRef: ctx.traceRef,
  };
  if (ctx.elementId !== undefined) indicator.elementId = ctx.elementId;
  piiIndicators.push(indicator);
  redactions.push({
    id: `${indicatorId}::redaction`,
    indicatorId,
    kind: match.kind,
    reason: `Detected ${match.kind} in ${ctx.location}`,
    replacement: match.redacted,
  });
};
