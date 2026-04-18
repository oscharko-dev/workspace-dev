import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialPipelineState,
  pastePipelineReducer,
  startPastePipeline,
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

  it("carries pasteDeltaSummary from a job_created action onto state", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "job_created",
      jobId: "job-delta",
      pasteDeltaSummary: {
        mode: "auto_resolved_to_delta",
        strategy: "delta",
        totalNodes: 10,
        nodesReused: 6,
        nodesReprocessed: 4,
        structuralChangeRatio: 0.4,
        pasteIdentityKey: "sha-abc",
        priorManifestMissing: false,
      },
    });

    expect(state.pasteDeltaSummary).toEqual({
      mode: "auto_resolved_to_delta",
      strategy: "delta",
      totalNodes: 10,
      nodesReused: 6,
      nodesReprocessed: 4,
      structuralChangeRatio: 0.4,
      pasteIdentityKey: "sha-abc",
      priorManifestMissing: false,
    });
  });

  it("leaves pasteDeltaSummary undefined when job_created has no summary", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, { type: "job_created", jobId: "job-no-delta" });

    expect(state.pasteDeltaSummary).toBeUndefined();
  });

  it("mirrors pasteDeltaSummary.pasteIdentityKey onto state when job_created carries a summary", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "job_created",
      jobId: "job-delta",
      pasteDeltaSummary: {
        mode: "auto_resolved_to_delta",
        strategy: "delta",
        totalNodes: 10,
        nodesReused: 6,
        nodesReprocessed: 4,
        structuralChangeRatio: 0.4,
        pasteIdentityKey: "sha-identity-123",
        priorManifestMissing: false,
      },
    });

    expect(state.pasteIdentityKey).toBe("sha-identity-123");
  });

  it("clears pasteIdentityKey and selectedNodeIds on start", () => {
    const dirtyState: PastePipelineState = {
      ...createInitialPipelineState(),
      stage: "ready",
      pasteIdentityKey: "sha-old",
      selectedNodeIds: ["node-1", "node-2"],
    };

    const state = dispatch(dirtyState, { type: "start" });

    expect(state.pasteIdentityKey).toBeUndefined();
    expect(state.selectedNodeIds).toBeUndefined();
  });

  it("can start URL imports directly in resolving", () => {
    const state = dispatch(createInitialPipelineState(), {
      type: "start_resolving",
    });

    expect(state.stage).toBe("resolving");
    expect(state.stageProgress.parsing.state).toBe("done");
    expect(state.stageProgress.resolving.state).toBe("running");
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
      stage: "extracting",
      durationMs: 10,
    });
    state = dispatch(state, {
      type: "stage_done",
      stage: "transforming",
      durationMs: 10,
    });

    expect(state.stage).toBe("mapping");
    expect(state.stageProgress.resolving.state).toBe("done");
    expect(state.stageProgress.extracting.state).toBe("done");
    expect(state.stageProgress.transforming.state).toBe("done");
    expect(state.progress).toBeGreaterThan(0);
  });

  it("inserts extracting between resolving and transforming in the active stage order", () => {
    let state = dispatch(createInitialPipelineState(), { type: "start" });
    state = dispatch(state, { type: "parsing_done" });
    state = dispatch(state, {
      type: "stage_done",
      stage: "resolving",
      durationMs: 5,
    });

    expect(state.stage).toBe("extracting");
    expect(state.stageProgress.resolving.state).toBe("done");
    expect(state.stageProgress.extracting.state).toBe("running");

    state = dispatch(state, {
      type: "stage_done",
      stage: "extracting",
      durationMs: 7,
    });

    expect(state.stage).toBe("transforming");
    expect(state.stageProgress.extracting.state).toBe("done");
    expect(state.stageProgress.transforming.state).toBe("running");
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

describe("startPastePipeline submit body", () => {
  const validPayload = JSON.stringify({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
      children: [],
    },
  });

  type FetchArgs = Parameters<typeof fetch>;
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn<typeof fetch>(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/workspace/submit") {
        return new Response(JSON.stringify({ jobId: "job-body-check" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function waitForSubmitCall(): Promise<RequestInit> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const submitCall = fetchSpy.mock.calls.find((call: FetchArgs) => {
        const input = call[0];
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return url === "/workspace/submit";
      });
      if (submitCall) {
        const init = submitCall[1];
        if (init !== undefined) return init;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("submit call not observed");
  }

  it("posts a submit body without selectedNodeIds and without importMode when no options are provided", async () => {
    startPastePipeline(validPayload);

    const init = await waitForSubmitCall();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body).toEqual({
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: validPayload,
      enableGitPr: false,
      llmCodegenMode: "deterministic",
    });
    expect(body.selectedNodeIds).toBeUndefined();
    expect(body.importMode).toBeUndefined();
  });

  it("posts a submit body containing selectedNodeIds and importMode when both are provided", async () => {
    startPastePipeline(validPayload, {
      selectedNodeIds: ["a", "b"],
      importMode: "delta",
    });

    const init = await waitForSubmitCall();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.selectedNodeIds).toEqual(["a", "b"]);
    expect(body.importMode).toBe("delta");
  });

  it("omits selectedNodeIds from the submit body when an empty array is provided", async () => {
    startPastePipeline(validPayload, {
      selectedNodeIds: [],
    });

    const init = await waitForSubmitCall();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.selectedNodeIds).toBeUndefined();
  });
});
