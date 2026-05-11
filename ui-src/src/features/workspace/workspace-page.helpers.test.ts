import { describe, expect, it } from "vitest";
import {
  canCancelJob,
  formatUptime,
  getBadgeClasses,
  getHealthBadge,
  getJobLifecycleStatus,
  getJobSummary,
  getModeChipClasses,
  getRouteFigmaKey,
  getSubmitBadge,
  getSelectedPipelineId,
  getWorkspaceBadge,
  hasMultipleAvailablePipelines,
  isJobPayload,
  isRecord,
  toPrettyJson,
  toStageBadgeVariant,
  type JobPayload,
  type RuntimeStatusPayload,
} from "./workspace-page.helpers";

describe("workspace-page.helpers", () => {
  it("validates record-like values", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("validates job payloads", () => {
    expect(isJobPayload({ jobId: "job-1", status: "queued" })).toBe(true);
    expect(isJobPayload({ jobId: 1, status: "queued" })).toBe(false);
    expect(isJobPayload({ jobId: "job-1" })).toBe(false);
  });

  it("normalizes route figma keys", () => {
    expect(getRouteFigmaKey()).toBeUndefined();
    expect(getRouteFigmaKey("ui")).toBeUndefined();
    expect(getRouteFigmaKey("demo%20file")).toBe("demo file");
    expect(getRouteFigmaKey("%E0%A4%A")).toBeUndefined();
  });

  it("selects the default pipeline when it is available", () => {
    const availablePipelines: Array<{
      id: string;
      displayName: string;
    }> = [
      { id: "pipe-a", displayName: "Pipeline A" },
      { id: "pipe-b", displayName: "Pipeline B" },
    ];

    expect(
      getSelectedPipelineId({
        availablePipelines,
        defaultPipelineId: "pipe-b",
      }),
    ).toBe("pipe-b");
    expect(hasMultipleAvailablePipelines(availablePipelines)).toBe(true);
  });

  it("falls back to the first available pipeline when there is no default or current selection", () => {
    const availablePipelines: Array<{
      id: string;
      displayName: string;
    }> = [
      { id: "pipe-a", displayName: "Pipeline A" },
    ];

    expect(
      getSelectedPipelineId({
        availablePipelines,
      }),
    ).toBe("pipe-a");
    expect(hasMultipleAvailablePipelines(availablePipelines)).toBe(false);
  });

  it("keeps the current selection when it remains valid", () => {
    const availablePipelines: Array<{
      id: string;
      displayName: string;
    }> = [
      { id: "pipe-a", displayName: "Pipeline A" },
      { id: "pipe-b", displayName: "Pipeline B" },
    ];

    expect(
      getSelectedPipelineId({
        availablePipelines,
        defaultPipelineId: "pipe-b",
        currentPipelineId: "pipe-a",
      }),
    ).toBe("pipe-a");
  });

  it("formats pretty json with a trailing newline", () => {
    expect(toPrettyJson({ ok: true })).toContain('"ok": true');
    expect(toPrettyJson({ ok: true }).endsWith("\n")).toBe(true);
  });

  it("maps lifecycle statuses", () => {
    expect(getJobLifecycleStatus()).toBeUndefined();
    expect(getJobLifecycleStatus({ jobId: "job", status: "queued" })).toBe(
      "queued",
    );
    expect(getJobLifecycleStatus({ jobId: "job", status: "running" })).toBe(
      "running",
    );
    expect(getJobLifecycleStatus({ jobId: "job", status: "completed" })).toBe(
      "completed",
    );
    expect(getJobLifecycleStatus({ jobId: "job", status: "failed" })).toBe(
      "failed",
    );
    expect(getJobLifecycleStatus({ jobId: "job", status: "canceled" })).toBe(
      "canceled",
    );
    expect(getJobLifecycleStatus({ jobId: "job", status: "unknown" })).toBe(
      undefined,
    );
  });

  it("derives submit badges", () => {
    expect(
      getSubmitBadge({
        isSubmitting: true,
        status: undefined,
        isCanceling: false,
      }),
    ).toEqual({ text: "SUBMITTING", variant: "warn" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: undefined,
        isCanceling: true,
      }),
    ).toEqual({ text: "CANCELING", variant: "warn" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: "queued",
        isCanceling: false,
      }),
    ).toEqual({ text: "QUEUED", variant: "warn" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: "running",
        isCanceling: false,
      }),
    ).toEqual({ text: "RUNNING", variant: "warn" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: "completed",
        isCanceling: false,
      }),
    ).toEqual({ text: "COMPLETED", variant: "ok" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: "failed",
        isCanceling: false,
      }),
    ).toEqual({ text: "FAILED", variant: "error" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: "canceled",
        isCanceling: false,
      }),
    ).toEqual({ text: "CANCELED", variant: "warn" });
    expect(
      getSubmitBadge({
        isSubmitting: false,
        status: undefined,
        isCanceling: false,
      }),
    ).toEqual({ text: "IDLE", variant: "default" });
  });

  it("maps stage and status badges", () => {
    expect(toStageBadgeVariant("completed")).toBe("ok");
    expect(toStageBadgeVariant("failed")).toBe("error");
    expect(toStageBadgeVariant("running")).toBe("warn");
    expect(toStageBadgeVariant("queued")).toBe("default");

    expect(getBadgeClasses("ok")).toContain("emerald");
    expect(getBadgeClasses("warn")).toContain("slate");
    expect(getBadgeClasses("error")).toContain("black");
    expect(getBadgeClasses("default")).toContain("slate-300");
  });

  it("derives runtime health badges", () => {
    const runtimePayload: RuntimeStatusPayload = {
      running: true,
      url: "http://127.0.0.1:1983",
      host: "127.0.0.1",
      port: 1983,
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
      uptimeMs: 1_000,
      outputRoot: "/tmp/workspace-dev",
      previewEnabled: true,
    };

    expect(getHealthBadge(undefined)).toEqual({
      text: "UNKNOWN",
      variant: "default",
    });
    expect(
      getHealthBadge({ ok: true, status: 200, payload: { status: "ok" } }),
    ).toEqual({ text: "READY", variant: "ok" });
    expect(
      getHealthBadge({ ok: false, status: 503, payload: { status: "down" } }),
    ).toEqual({ text: "ERROR 503", variant: "error" });

    expect(getWorkspaceBadge(undefined)).toEqual({
      text: "UNKNOWN",
      variant: "default",
    });
    expect(
      getWorkspaceBadge({ ok: true, status: 200, payload: runtimePayload }),
    ).toEqual({ text: "ONLINE", variant: "ok" });
    expect(
      getWorkspaceBadge({ ok: false, status: 500, payload: runtimePayload }),
    ).toEqual({ text: "ERROR 500", variant: "error" });
  });

  it("derives job summaries across lifecycle branches", () => {
    const basePayload: JobPayload = {
      jobId: "job-1",
      status: "queued",
    };

    expect(
      getJobSummary({
        status: undefined,
        payload: undefined,
        activeJobId: null,
      }),
    ).toBe("No job started yet.");
    expect(
      getJobSummary({
        status: undefined,
        payload: undefined,
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 accepted.");
    expect(
      getJobSummary({
        status: "queued",
        payload: {
          ...basePayload,
          cancellation: { requestedAt: "2026-04-11T00:00:00Z" },
        },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 cancellation requested.");
    expect(
      getJobSummary({
        status: "queued",
        payload: {
          ...basePayload,
          queue: { position: 3 },
        },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 is queued (position 3).");
    expect(
      getJobSummary({
        status: "running",
        payload: { ...basePayload, status: "running" },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 is running.");
    expect(
      getJobSummary({
        status: "completed",
        payload: { ...basePayload, status: "completed" },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 completed successfully.");
    expect(
      getJobSummary({
        status: "failed",
        payload: { ...basePayload, status: "failed" },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 failed.");
    expect(
      getJobSummary({
        status: "canceled",
        payload: { ...basePayload, status: "canceled" },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 canceled.");
    expect(
      getJobSummary({
        status: undefined,
        payload: { ...basePayload, status: "mystery" },
        activeJobId: "job-1",
      }),
    ).toBe("Job job-1 status is mystery.");
  });

  it("allows cancellation only for active uncanceled jobs", () => {
    expect(
      canCancelJob({
        status: undefined,
        payload: undefined,
      }),
    ).toBe(false);
    expect(
      canCancelJob({
        status: "completed",
        payload: { jobId: "job-1", status: "completed" },
      }),
    ).toBe(false);
    expect(
      canCancelJob({
        status: "queued",
        payload: {
          jobId: "job-1",
          status: "queued",
          cancellation: { requestedAt: "2026-04-11T00:00:00Z" },
        },
      }),
    ).toBe(false);
    expect(
      canCancelJob({
        status: "running",
        payload: { jobId: "job-1", status: "running" },
      }),
    ).toBe(true);
  });

  it("formats uptime and source-mode chip classes", () => {
    expect(formatUptime(59_000)).toBe("0m 59s");
    expect(formatUptime(3_661_000)).toBe("1h 1m");
    expect(getModeChipClasses({ isActive: true })).toContain("border");
    expect(getModeChipClasses({ isActive: false })).toContain("text-[#333]");
  });
});
