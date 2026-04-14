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
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: makeError("resolving", false),
    });

    expect(state.stage).toBe("error");
    expect(state.canRetry).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.errors[0]?.stage).toBe("resolving");
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
