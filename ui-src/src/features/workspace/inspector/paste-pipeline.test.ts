import { describe, expect, it } from "vitest";
import {
  createInitialPipelineState,
  pastePipelineReducer,
  type PastePipelineState,
  type PipelineAction,
  type PipelineError,
} from "./paste-pipeline";

function makeError(stage: PipelineError["stage"]): PipelineError {
  return {
    stage,
    code: "ERR_TEST",
    message: "test failure",
    retryable: true,
  };
}

function dispatch(
  state: PastePipelineState,
  action: PipelineAction,
): PastePipelineState {
  return pastePipelineReducer(state, action);
}

describe("createInitialPipelineState", () => {
  it("returns a fully pending idle state", () => {
    const state = createInitialPipelineState();

    expect(state.stage).toBe("idle");
    expect(state.progress).toBe(0);
    expect(state.errors).toEqual([]);
    expect(state.canRetry).toBe(false);
    expect(state.canCancel).toBe(false);
    expect(state.jobId).toBeUndefined();
    expect(state.designIR).toBeUndefined();
    expect(state.componentManifest).toBeUndefined();
    expect(state.generatedFiles).toBeUndefined();
    expect(state.screenshot).toBeUndefined();

    for (const status of Object.values(state.stageProgress)) {
      expect(status.state).toBe("pending");
    }
  });
});

describe("pastePipelineReducer — start", () => {
  it("transitions idle → parsing, marks parsing running, enables cancel", () => {
    const state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });

    expect(state.stage).toBe("parsing");
    expect(state.stageProgress.parsing.state).toBe("running");
    expect(state.canCancel).toBe(true);
    expect(state.canRetry).toBe(false);
  });
});

describe("pastePipelineReducer — parsing_done", () => {
  it("marks parsing done and advances to resolving (running)", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, {
      type: "parsing_done",
      figmeta: { fileKey: "k", pasteID: 1, dataType: "scene" },
    });

    expect(state.stageProgress.parsing.state).toBe("done");
    expect(state.stage).toBe("resolving");
    expect(state.stageProgress.resolving.state).toBe("running");
  });
});

describe("pastePipelineReducer — parsing_failed", () => {
  it("transitions to error, pushes error, sets canRetry and !canCancel", () => {
    const err = makeError("parsing");
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, { type: "parsing_failed", error: err });

    expect(state.stage).toBe("error");
    expect(state.stageProgress.parsing.state).toBe("failed");
    expect(state.errors).toEqual([err]);
    expect(state.canRetry).toBe(true);
    expect(state.canCancel).toBe(false);
  });
});

describe("pastePipelineReducer — job_created", () => {
  it("stores jobId without changing stage", () => {
    const before = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    const after = dispatch(before, { type: "job_created", jobId: "job-42" });

    expect(after.jobId).toBe("job-42");
    expect(after.stage).toBe(before.stage);
  });
});

describe("pastePipelineReducer — stage transitions", () => {
  it("stage_start marks the stage running with message", () => {
    const state = dispatch(createInitialPipelineState(), {
      type: "stage_start",
      stage: "mapping",
      message: "starting",
    });
    expect(state.stageProgress.mapping.state).toBe("running");
    expect(state.stageProgress.mapping.message).toBe("starting");
  });

  it("stage_message updates the message without changing state", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "stage_start",
      stage: "mapping",
      message: "starting",
    });
    state = dispatch(state, {
      type: "stage_message",
      stage: "mapping",
      message: "progress",
    });
    expect(state.stageProgress.mapping.state).toBe("running");
    expect(state.stageProgress.mapping.message).toBe("progress");
  });

  it("stage_done marks the stage done, advances to the next, and adds duration", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, {
      type: "parsing_done",
      figmeta: { fileKey: "k", pasteID: 1, dataType: "scene" },
    });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 123,
    });

    expect(state.stageProgress.resolving.state).toBe("done");
    expect(state.stageProgress.resolving.duration).toBe(123);
    expect(state.stage).toBe("extracting");
    expect(state.stageProgress.extracting.state).toBe("running");
  });

  it("stage_failed for an active stage transitions to error and is retryable", () => {
    const err = makeError("resolving");
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, {
      type: "parsing_done",
      figmeta: { fileKey: "k", pasteID: 1, dataType: "scene" },
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "resolving",
      error: err,
    });

    expect(state.stage).toBe("error");
    expect(state.stageProgress.resolving.state).toBe("failed");
    expect(state.errors).toEqual([err]);
    expect(state.canRetry).toBe(true);
    expect(state.canCancel).toBe(false);
  });
});

describe("pastePipelineReducer — progress accounting", () => {
  it("increments by floor(100/6) for each active stage completion", () => {
    const INCREMENT = Math.floor(100 / 6);

    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    expect(state.progress).toBe(0);

    state = dispatch(state, {
      type: "parsing_done",
      figmeta: { fileKey: "k", pasteID: 1, dataType: "scene" },
    });
    expect(state.progress).toBe(INCREMENT);

    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 10,
    });
    expect(state.progress).toBe(INCREMENT * 2);

    state = dispatch(state, {
      type: "stage_done",
      stage: "extracting",
      durationMs: 10,
    });
    expect(state.progress).toBe(INCREMENT * 3);
  });

  it("complete clamps progress to 100 and marks ready", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, { type: "complete" });
    expect(state.stage).toBe("ready");
    expect(state.progress).toBe(100);
    expect(state.canRetry).toBe(false);
    expect(state.canCancel).toBe(false);
  });
});

describe("pastePipelineReducer — data accumulators", () => {
  it("stores screenshot, designIR, manifest, and files", () => {
    const initial = createInitialPipelineState();

    const withScreenshot = dispatch(initial, {
      type: "screenshot_ready",
      screenshot: "data:image/png;base64,abc",
    });
    expect(withScreenshot.screenshot).toBe("data:image/png;base64,abc");

    const ir = { jobId: "j1", screens: [] };
    const withIr = dispatch(initial, { type: "design_ir_ready", designIR: ir });
    expect(withIr.designIR).toEqual(ir);

    const manifest = { jobId: "j1", screens: [] };
    const withManifest = dispatch(initial, {
      type: "manifest_ready",
      manifest,
    });
    expect(withManifest.componentManifest).toEqual(manifest);

    const files = [{ path: "a.ts", sizeBytes: 42 }];
    const withFiles = dispatch(initial, { type: "files_ready", files });
    expect(withFiles.generatedFiles).toEqual(files);
  });
});

describe("pastePipelineReducer — cancel", () => {
  it("resets to initial state", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, { type: "job_created", jobId: "job-1" });
    state = dispatch(state, { type: "cancel" });

    expect(state).toEqual(createInitialPipelineState());
  });
});

describe("pastePipelineReducer — retry", () => {
  it("restarts from the last failed stage while keeping cached outputs", () => {
    const ir = { jobId: "j1", screens: [] };
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, {
      type: "parsing_done",
      figmeta: { fileKey: "k", pasteID: 1, dataType: "scene" },
    });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 5,
    });
    state = dispatch(state, {
      type: "screenshot_ready",
      screenshot: "shot",
    });
    state = dispatch(state, { type: "design_ir_ready", designIR: ir });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "mapping",
      error: makeError("mapping"),
    });

    const retried = dispatch(state, { type: "retry" });

    expect(retried.stage).toBe("mapping");
    expect(retried.stageProgress.mapping.state).toBe("running");
    expect(retried.screenshot).toBe("shot");
    expect(retried.designIR).toEqual(ir);
    expect(retried.canRetry).toBe(false);
    expect(retried.canCancel).toBe(true);
    expect(retried.errors).toEqual([]);
  });

  it("accepts an explicit fromStage override", () => {
    let state = dispatch(createInitialPipelineState(), {
      type: "start",
      clipboardHtml: "<html>",
    });
    state = dispatch(state, {
      type: "stage_failed",
      stage: "generating",
      error: makeError("generating"),
    });

    const retried = dispatch(state, { type: "retry", fromStage: "resolving" });

    expect(retried.stage).toBe("resolving");
    expect(retried.stageProgress.resolving.state).toBe("running");
  });
});
