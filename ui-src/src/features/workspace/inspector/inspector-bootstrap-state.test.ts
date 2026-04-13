import { describe, expect, it } from "vitest";
import {
  bootstrapReducer,
  initialBootstrapState,
  type InspectorBootstrapEvent,
  type InspectorBootstrapState,
} from "./inspector-bootstrap-state";

function dispatch(
  state: InspectorBootstrapState,
  event: InspectorBootstrapEvent,
): InspectorBootstrapState {
  return bootstrapReducer(state, event);
}

describe("initialBootstrapState", () => {
  it("returns idle", () => {
    expect(initialBootstrapState()).toEqual({ kind: "idle" });
  });
});

describe("idle state", () => {
  const idle = initialBootstrapState();

  it("focus → focused", () => {
    expect(dispatch(idle, { type: "focus" })).toEqual({ kind: "focused" });
  });

  it("paste_started → pasting", () => {
    expect(dispatch(idle, { type: "paste_started" })).toEqual({
      kind: "pasting",
    });
  });

  it("blur is a no-op", () => {
    expect(dispatch(idle, { type: "blur" })).toBe(idle);
  });

  it("submit_accepted is a no-op", () => {
    expect(dispatch(idle, { type: "submit_accepted", jobId: "j1" })).toBe(idle);
  });

  it("submit_failed is a no-op", () => {
    expect(
      dispatch(idle, {
        type: "submit_failed",
        reason: "err",
        retryable: false,
      }),
    ).toBe(idle);
  });

  it("poll_updated is a no-op", () => {
    expect(
      dispatch(idle, {
        type: "poll_updated",
        status: "queued",
        jobId: "j1",
      }),
    ).toBe(idle);
  });
});

describe("focused state", () => {
  const focused: InspectorBootstrapState = { kind: "focused" };

  it("blur → idle", () => {
    expect(dispatch(focused, { type: "blur" })).toEqual({ kind: "idle" });
  });

  it("paste_started → pasting", () => {
    expect(dispatch(focused, { type: "paste_started" })).toEqual({
      kind: "pasting",
    });
  });

  it("focus is a no-op", () => {
    expect(dispatch(focused, { type: "focus" })).toBe(focused);
  });

  it("submit_accepted is a no-op", () => {
    expect(dispatch(focused, { type: "submit_accepted", jobId: "j1" })).toBe(
      focused,
    );
  });
});

describe("pasting state", () => {
  const pasting: InspectorBootstrapState = { kind: "pasting" };

  it("submit_accepted → queued with jobId", () => {
    expect(
      dispatch(pasting, { type: "submit_accepted", jobId: "job-abc" }),
    ).toEqual({
      kind: "queued",
      jobId: "job-abc",
    });
  });

  it("submit_failed → failed (not retryable)", () => {
    expect(
      dispatch(pasting, {
        type: "submit_failed",
        reason: "SCHEMA_MISMATCH",
        retryable: false,
      }),
    ).toEqual({ kind: "failed", reason: "SCHEMA_MISMATCH", retryable: false });
  });

  it("submit_failed → failed (retryable)", () => {
    expect(
      dispatch(pasting, {
        type: "submit_failed",
        reason: "NETWORK_ERROR",
        retryable: true,
      }),
    ).toEqual({ kind: "failed", reason: "NETWORK_ERROR", retryable: true });
  });

  it("focus is a no-op", () => {
    expect(dispatch(pasting, { type: "focus" })).toBe(pasting);
  });

  it("poll_updated is a no-op", () => {
    expect(
      dispatch(pasting, {
        type: "poll_updated",
        status: "queued",
        jobId: "j1",
      }),
    ).toBe(pasting);
  });
});

describe("queued state", () => {
  const queued: InspectorBootstrapState = { kind: "queued", jobId: "job-1" };

  it("poll_failed → failed retryable", () => {
    expect(
      dispatch(queued, {
        type: "poll_failed",
        reason: "POLL_FAILED",
        retryable: true,
      }),
    ).toEqual({ kind: "failed", reason: "POLL_FAILED", retryable: true });
  });

  it("poll_updated(running) → processing", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "running",
        jobId: "job-1",
      }),
    ).toEqual({ kind: "processing", jobId: "job-1" });
  });

  it("poll_updated(completed) with previewUrl → ready", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "completed",
        jobId: "job-1",
        previewUrl: "http://localhost/preview",
      }),
    ).toEqual({
      kind: "ready",
      jobId: "job-1",
      previewUrl: "http://localhost/preview",
    });
  });

  it("poll_updated(completed) without previewUrl → failed retryable", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "completed",
        jobId: "job-1",
      }),
    ).toEqual({
      kind: "failed",
      reason: "missing preview url",
      retryable: true,
    });
  });

  it("poll_updated(failed) → failed not retryable", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "failed",
        jobId: "job-1",
      }),
    ).toEqual({ kind: "failed", reason: "failed", retryable: false });
  });

  it("poll_updated(canceled) → failed not retryable", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "canceled",
        jobId: "job-1",
      }),
    ).toEqual({ kind: "failed", reason: "canceled", retryable: false });
  });

  it("poll_updated(queued) is a no-op", () => {
    expect(
      dispatch(queued, {
        type: "poll_updated",
        status: "queued",
        jobId: "job-1",
      }),
    ).toBe(queued);
  });

  it("focus is a no-op", () => {
    expect(dispatch(queued, { type: "focus" })).toBe(queued);
  });
});

describe("processing state", () => {
  const processing: InspectorBootstrapState = {
    kind: "processing",
    jobId: "job-2",
  };

  it("poll_failed → failed retryable", () => {
    expect(
      dispatch(processing, {
        type: "poll_failed",
        reason: "POLL_FAILED",
        retryable: true,
      }),
    ).toEqual({ kind: "failed", reason: "POLL_FAILED", retryable: true });
  });

  it("poll_updated(completed) with previewUrl → ready", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "completed",
        jobId: "job-2",
        previewUrl: "http://localhost/preview",
      }),
    ).toEqual({
      kind: "ready",
      jobId: "job-2",
      previewUrl: "http://localhost/preview",
    });
  });

  it("poll_updated(completed) without previewUrl → failed retryable", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "completed",
        jobId: "job-2",
      }),
    ).toEqual({
      kind: "failed",
      reason: "missing preview url",
      retryable: true,
    });
  });

  it("poll_updated(failed) → failed not retryable", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "failed",
        jobId: "job-2",
      }),
    ).toEqual({ kind: "failed", reason: "failed", retryable: false });
  });

  it("poll_updated(canceled) → failed not retryable", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "canceled",
        jobId: "job-2",
      }),
    ).toEqual({ kind: "failed", reason: "canceled", retryable: false });
  });

  it("poll_updated(running) is a no-op", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "running",
        jobId: "job-2",
      }),
    ).toBe(processing);
  });

  it("poll_updated(queued) is a no-op", () => {
    expect(
      dispatch(processing, {
        type: "poll_updated",
        status: "queued",
        jobId: "job-2",
      }),
    ).toBe(processing);
  });

  it("submit_accepted is a no-op", () => {
    expect(dispatch(processing, { type: "submit_accepted", jobId: "j2" })).toBe(
      processing,
    );
  });
});

describe("ready state", () => {
  const ready: InspectorBootstrapState = {
    kind: "ready",
    jobId: "job-3",
    previewUrl: "http://localhost/preview",
  };

  it("all events except reset are no-ops", () => {
    expect(dispatch(ready, { type: "focus" })).toBe(ready);
    expect(dispatch(ready, { type: "blur" })).toBe(ready);
    expect(dispatch(ready, { type: "paste_started" })).toBe(ready);
    expect(dispatch(ready, { type: "submit_accepted", jobId: "j2" })).toBe(
      ready,
    );
    expect(
      dispatch(ready, {
        type: "submit_failed",
        reason: "err",
        retryable: false,
      }),
    ).toBe(ready);
    expect(
      dispatch(ready, {
        type: "poll_updated",
        status: "queued",
        jobId: "job-3",
      }),
    ).toBe(ready);
  });
});

describe("failed state", () => {
  const failed: InspectorBootstrapState = {
    kind: "failed",
    reason: "SCHEMA_MISMATCH",
    retryable: false,
  };

  it("paste_started clears the failed state and restarts the flow", () => {
    expect(dispatch(failed, { type: "paste_started" })).toEqual({
      kind: "pasting",
    });
  });

  it("other events except reset are no-ops", () => {
    expect(dispatch(failed, { type: "focus" })).toBe(failed);
    expect(dispatch(failed, { type: "blur" })).toBe(failed);
    expect(dispatch(failed, { type: "submit_accepted", jobId: "j1" })).toBe(
      failed,
    );
    expect(
      dispatch(failed, {
        type: "submit_failed",
        reason: "other",
        retryable: true,
      }),
    ).toBe(failed);
    expect(
      dispatch(failed, { type: "poll_updated", status: "queued", jobId: "j1" }),
    ).toBe(failed);
    expect(
      dispatch(failed, {
        type: "poll_failed",
        reason: "POLL_FAILED",
        retryable: true,
      }),
    ).toBe(failed);
  });
});

describe("reset from any state", () => {
  const states: InspectorBootstrapState[] = [
    { kind: "idle" },
    { kind: "focused" },
    { kind: "pasting" },
    { kind: "queued", jobId: "j1" },
    { kind: "processing", jobId: "j1" },
    { kind: "ready", jobId: "j1", previewUrl: "http://localhost/preview" },
    { kind: "failed", reason: "err", retryable: true },
  ];

  for (const state of states) {
    it(`reset from ${state.kind} → idle`, () => {
      expect(dispatch(state, { type: "reset" })).toEqual({ kind: "idle" });
    });
  }
});
