import { describe, expect, it } from "vitest";
import {
  createInitialPipelineState,
  pastePipelineReducer,
  type PastePipelineState,
  type PipelineAction,
  type PipelineError,
} from "./paste-pipeline";

function dispatch(
  state: PastePipelineState,
  action: PipelineAction,
): PastePipelineState {
  return pastePipelineReducer(state, action);
}

function makeError(
  stage: PipelineError["stage"],
  retryable = true,
): PipelineError {
  return {
    stage,
    code: "ERR_TEST",
    message: "test failure",
    retryable,
  };
}

describe("createInitialPipelineState", () => {
  it("starts idle with no retained artifacts or errors", () => {
    const state = createInitialPipelineState();

    expect(state.stage).toBe("idle");
    expect(state.progress).toBe(0);
    expect(state.canCancel).toBe(false);
    expect(state.canRetry).toBe(false);
    expect(state.errors).toEqual([]);
    expect(state.jobId).toBeUndefined();
    expect(state.previewUrl).toBeUndefined();

    for (const status of Object.values(state.stageProgress)) {
      expect(status.state).toBe("pending");
    }
  });
});

describe("pastePipelineReducer", () => {
  it("resets stale state on start", () => {
    const dirtyState: PastePipelineState = {
      ...createInitialPipelineState(),
      stage: "error",
      progress: 80,
      jobId: "job-old",
      previewUrl: "http://old-preview",
      errors: [makeError("mapping")],
      canRetry: true,
      stageProgress: {
        ...createInitialPipelineState().stageProgress,
        mapping: { state: "failed", error: makeError("mapping") },
      },
    };

    const state = dispatch(dirtyState, { type: "start" });

    expect(state.stage).toBe("parsing");
    expect(state.progress).toBe(0);
    expect(state.jobId).toBeUndefined();
    expect(state.previewUrl).toBeUndefined();
    expect(state.errors).toEqual([]);
    expect(state.stageProgress.parsing.state).toBe("running");
  });

  it("advances from parsing to resolving when parsing completes", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });

    expect(state.stage).toBe("resolving");
    expect(state.stageProgress.parsing.state).toBe("done");
    expect(state.stageProgress.resolving.state).toBe("running");
  });

  it("tracks accepted jobs and runtime status", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, { type: "job_created", jobId: "job-42" });
    state = dispatch(state, {
      type: "job_status_updated",
      status: "running",
    });

    expect(state.jobId).toBe("job-42");
    expect(state.jobStatus).toBe("running");
  });

  it("marks intermediate backend stages done and advances progress", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 10,
    });
    state = dispatch(state, {
      type: "stage_done",
      stage: "transforming",
      durationMs: 10,
    });

    expect(state.stage).toBe("mapping");
    expect(state.stageProgress.resolving.state).toBe("done");
    expect(state.stageProgress.transforming.state).toBe("done");
    expect(state.progress).toBeGreaterThan(0);
  });

  it("stores final artifacts before ready", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "design_ir_ready",
      designIR: { jobId: "job-1", screens: [] },
    });
    state = dispatch(state, {
      type: "manifest_ready",
      manifest: { jobId: "job-1", screens: [] },
    });
    state = dispatch(state, {
      type: "files_ready",
      files: [{ path: "src/App.tsx", sizeBytes: 128 }],
    });
    state = dispatch(state, {
      type: "complete",
      previewUrl: "http://127.0.0.1:1983/preview",
    });

    expect(state.stage).toBe("ready");
    expect(state.progress).toBe(100);
    expect(state.previewUrl).toBe("http://127.0.0.1:1983/preview");
    expect(state.designIR?.jobId).toBe("job-1");
    expect(state.componentManifest?.jobId).toBe("job-1");
    expect(state.generatedFiles).toEqual([
      { path: "src/App.tsx", sizeBytes: 128 },
    ]);
  });

  it("surfaces non-retryable failures as terminal errors", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing", false),
    });

    expect(state.stage).toBe("error");
    expect(state.canRetry).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.errors[0]?.stage).toBe("parsing");
  });

  it("returns to idle once cancellation is complete", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "job_created",
      jobId: "job-cancel",
    });
    state = dispatch(state, { type: "cancel_complete" });

    expect(state).toEqual(createInitialPipelineState());
  });
});

describe("canRetry accumulation across multiple failures", () => {
  it("stays true when two retryable errors are dispatched in sequence", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing", true),
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: makeError("resolving", true),
    });

    expect(state.errors).toHaveLength(2);
    expect(state.canRetry).toBe(true);
  });

  it("flips to true when a retryable error follows a non-retryable one", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing", false),
    });
    // canRetry should be false at this point — precondition for the test
    expect(state.canRetry).toBe(false);

    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: makeError("resolving", true),
    });

    expect(state.errors).toHaveLength(2);
    expect(state.canRetry).toBe(true);
  });

  it("stays true when a non-retryable error follows a retryable one", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing", true),
    });
    // canRetry should be true here — precondition for the test
    expect(state.canRetry).toBe(true);

    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: makeError("resolving", false),
    });

    expect(state.errors).toHaveLength(2);
    // The accumulated .some() check means at least one retryable error
    // from the full error history keeps canRetry true.
    expect(state.canRetry).toBe(true);
  });
});

describe("partial state derivation", () => {
  it("enters 'partial' state when some stages done and one fails", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 100,
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "transforming",
      error: makeError("transforming"),
    });
    expect(state.stage).toBe("partial");
    expect(state.partialStats).toBeDefined();
    expect(state.partialStats?.resolvedStages).toBeGreaterThan(0);
    expect(state.partialStats?.errorCount).toBe(1);
  });

  it("enters 'error' state when the very first stage fails (no resolved stages)", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing", false),
    });
    expect(state.stage).toBe("error");
    expect(state.partialStats).toBeUndefined();
  });

  it("enters 'error' (not 'partial') when parsing succeeds but first backend stage fails (BACKEND_STAGES boundary)", () => {
    // parsing is excluded from BACKEND_STAGES, so resolvedStages=0 when only
    // parsing is done. A failed resolving with only parsing completed must NOT
    // produce 'partial' — it must produce 'error'.
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: makeError("resolving", true),
    });
    expect(state.stage).toBe("error");
    expect(state.partialStats).toBeUndefined();
  });
});

describe("retry_stage action", () => {
  it("resets a failed stage back to running", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "parsing",
      error: makeError("parsing"),
    });
    state = dispatch(state, { type: "retry_stage", stage: "parsing" });
    expect(state.stageProgress.parsing.state).toBe("running");
    expect(state.canCancel).toBe(true);
    expect(state.errors).toHaveLength(0);
  });

  it("is a no-op when the stage is not failed", () => {
    const initial = createInitialPipelineState();
    const after = dispatch(initial, { type: "retry_stage", stage: "parsing" });
    expect(after).toEqual(initial);
  });
});

describe("PipelineError retryAfterMs", () => {
  it("propagates retryAfterMs through stage_failed", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: {
        stage: "resolving",
        code: "MCP_RATE_LIMITED",
        message: "Rate limited",
        retryable: true,
        retryAfterMs: 60_000,
      },
    });
    const err = state.errors[0];
    expect(err?.retryAfterMs).toBe(60_000);
  });
});

describe("backend-authored retry metadata", () => {
  it("stores fallback mode and retry request when a retryable backend stage fails", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 12,
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "generating",
      error: {
        stage: "generating",
        code: "CODEGEN_PARTIAL",
        message: "Some files failed",
        retryable: true,
        fallbackMode: "rest",
        retryTargets: [
          {
            id: "src/routes/settings.tsx",
            label: "settings.tsx",
            filePath: "src/routes/settings.tsx",
            stage: "generating",
          },
        ],
      },
    });

    expect(state.fallbackMode).toBe("rest");
    expect(state.retryRequest).toEqual({
      stage: "generating",
      targetIds: ["src/routes/settings.tsx"],
    });
    expect(state.stage).toBe("partial");
  });

  it("keeps existing artifacts visible while a failed stage is retried", () => {
    let state = createInitialPipelineState();
    state = dispatch(state, { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "design_ir_ready",
      designIR: { jobId: "job-1", screens: [] },
    });
    state = dispatch(state, {
      type: "files_ready",
      files: [{ path: "src/App.tsx", sizeBytes: 128 }],
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "generating",
      error: {
        stage: "generating",
        code: "CODEGEN_PARTIAL",
        message: "Some files failed",
        retryable: true,
        retryTargets: [
          {
            id: "src/App.tsx",
            label: "src/App.tsx",
            filePath: "src/App.tsx",
            stage: "generating",
          },
        ],
      },
    });

    state = dispatch(state, {
      type: "retry_stage",
      stage: "generating",
      targetIds: ["src/App.tsx"],
    });

    expect(state.stage).toBe("generating");
    expect(state.designIR?.jobId).toBe("job-1");
    expect(state.generatedFiles).toEqual([
      { path: "src/App.tsx", sizeBytes: 128 },
    ]);
    expect(state.retryRequest).toEqual({
      stage: "generating",
      targetIds: ["src/App.tsx"],
    });
  });
});
