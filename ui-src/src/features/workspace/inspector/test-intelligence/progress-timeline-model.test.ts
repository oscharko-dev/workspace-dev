import { describe, expect, it } from "vitest";

import {
  TIMELINE_PHASES,
  applyEventToRows,
  buildInitialTimelineRows,
  formatElapsed,
  type ProductionRunnerEvent,
} from "./progress-timeline-model";

const evt = (
  phase: ProductionRunnerEvent["phase"],
  timestamp: number,
  details?: Record<string, unknown>,
): ProductionRunnerEvent =>
  details === undefined ? { phase, timestamp } : { phase, timestamp, details };

describe("progress-timeline-model", () => {
  it("buildInitialTimelineRows yields one pending row per logical phase", () => {
    const rows = buildInitialTimelineRows();
    expect(rows).toHaveLength(TIMELINE_PHASES.length);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.every((r) => r.timestamp === null)).toBe(true);
  });

  it("a started event marks the row as running", () => {
    const start = applyEventToRows(
      buildInitialTimelineRows(),
      evt("intent_derivation_started", 1000),
    );
    const intent = start.find((r) => r.phase === "intent");
    expect(intent?.status).toBe("running");
    expect(intent?.timestamp).toBe(1000);
  });

  it("a complete event marks the row as complete", () => {
    const after = applyEventToRows(
      applyEventToRows(
        buildInitialTimelineRows(),
        evt("intent_derivation_started", 1000),
      ),
      evt("intent_derivation_complete", 2500),
    );
    const intent = after.find((r) => r.phase === "intent");
    expect(intent?.status).toBe("complete");
    expect(intent?.timestamp).toBe(2500);
  });

  it("a skip event marks the visual sidecar row as skipped", () => {
    const after = applyEventToRows(
      buildInitialTimelineRows(),
      evt("visual_sidecar_skipped", 500, { message: "deployment unavailable" }),
    );
    const row = after.find((r) => r.phase === "visual_sidecar");
    expect(row?.status).toBe("skipped");
    expect(row?.detail).toBe("deployment unavailable");
  });

  it("a complete event with `error` detail marks the row as failed", () => {
    const after = applyEventToRows(
      buildInitialTimelineRows(),
      evt("validation_complete", 3000, { error: "schema mismatch" }),
    );
    const row = after.find((r) => r.phase === "validation");
    expect(row?.status).toBe("failed");
    expect(row?.detail).toBe("schema mismatch");
  });

  it("ignores unknown phases instead of throwing", () => {
    const before = buildInitialTimelineRows();
    const after = applyEventToRows(
      before,
      // @ts-expect-error — exercising the defensive runtime branch.
      evt("totally_unknown_phase", 100),
    );
    expect(after).toEqual(before);
  });

  it("extracts the deployment detail when available", () => {
    const after = applyEventToRows(
      buildInitialTimelineRows(),
      evt("llm_gateway_request", 100, { deployment: "gpt-oss-120b" }),
    );
    const row = after.find((r) => r.phase === "llm_gateway");
    expect(row?.detail).toBe("gpt-oss-120b");
  });

  it("extracts a tokens detail and formats it", () => {
    const after = applyEventToRows(
      buildInitialTimelineRows(),
      evt("llm_gateway_response", 100, { tokens: 1234 }),
    );
    const row = after.find((r) => r.phase === "llm_gateway");
    expect(row?.detail).toBe("1234 tokens");
  });

  it("a re-start (retry) demotes a complete row back to running", () => {
    const seq = [
      evt("validation_started", 100),
      evt("validation_complete", 200),
      evt("validation_started", 300),
    ];
    const after = seq.reduce(applyEventToRows, buildInitialTimelineRows());
    const row = after.find((r) => r.phase === "validation");
    expect(row?.status).toBe("running");
    expect(row?.timestamp).toBe(300);
  });

  it("formatElapsed prints seconds with one decimal", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(1500)).toBe("1.5s");
    expect(formatElapsed(123456)).toBe("123.5s");
  });

  it("formatElapsed clamps negative or non-finite to 0.0s", () => {
    expect(formatElapsed(-100)).toBe("0.0s");
    expect(formatElapsed(Number.NaN)).toBe("0.0s");
    expect(formatElapsed(Infinity)).toBe("0.0s");
  });
});
