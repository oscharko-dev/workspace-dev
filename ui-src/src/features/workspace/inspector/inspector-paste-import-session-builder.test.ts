import { describe, expect, it } from "vitest";
import { buildPasteImportSession } from "./inspector-paste-import-session-builder";
import type { PastePipelineState, PipelineStage } from "./paste-pipeline";

function makePipelineState(
  overrides: Partial<PastePipelineState> & { omitJobId?: boolean } = {},
): PastePipelineState {
  const { omitJobId, ...rest } = overrides;
  const base: PastePipelineState = {
    stage: "ready",
    progress: 1,
    stageProgress: {
      idle: { state: "done" },
      parsing: { state: "done" },
      extracting: { state: "done" },
      resolving: { state: "done" },
      extracting: { state: "done" },
      transforming: { state: "done" },
      mapping: { state: "done" },
      generating: { state: "done" },
      ready: { state: "done" },
      partial: { state: "pending" },
      error: { state: "pending" },
    },
    errors: [],
    canRetry: false,
    canCancel: false,
    ...(omitJobId === true ? {} : { jobId: "job-ready-1" }),
    ...rest,
  };
  return base;
}

const COMPLETED_AT = "2026-04-15T10:00:00.000Z";
const SESSION_ID = "paste-import-1";

describe("buildPasteImportSession — null cases", () => {
  it("returns null when jobId is undefined", () => {
    const pipelineState = makePipelineState({ omitJobId: true });
    expect(
      buildPasteImportSession({
        pipelineState,
        urlContext: null,
        sessionId: SESSION_ID,
        completedAt: COMPLETED_AT,
      }),
    ).toBeNull();
  });

  it.each<PipelineStage>([
    "idle",
    "parsing",
    "extracting",
    "resolving",
    "extracting",
    "transforming",
    "mapping",
    "generating",
    "error",
  ])("returns null when stage is '%s'", (stage) => {
    const pipelineState = makePipelineState({ stage });
    expect(
      buildPasteImportSession({
        pipelineState,
        urlContext: null,
        sessionId: SESSION_ID,
        completedAt: COMPLETED_AT,
      }),
    ).toBeNull();
  });
});

describe("buildPasteImportSession — happy path", () => {
  it("returns a session when stage is 'ready' with jobId", () => {
    const pipelineState = makePipelineState({ stage: "ready" });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_ID);
    expect(session?.jobId).toBe("job-ready-1");
    expect(session?.importedAt).toBe(COMPLETED_AT);
  });

  it("returns a session when stage is 'partial' with jobId", () => {
    const pipelineState = makePipelineState({ stage: "partial" });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session).not.toBeNull();
    expect(session?.jobId).toBe("job-ready-1");
  });
});

describe("buildPasteImportSession — nodeName resolution", () => {
  it("prefers designIR screens[0].name when available", () => {
    const pipelineState = makePipelineState({
      designIR: {
        jobId: "job-ready-1",
        screens: [
          { id: "s1", name: "HomePage", children: [] },
          { id: "s2", name: "AboutPage", children: [] },
        ],
      },
      sourceScreens: [
        { id: "s-hint", name: "SourceHintName", nodeType: "FRAME" },
      ],
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: { fileKey: "file-xyz", nodeId: "1:2" },
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.nodeName).toBe("HomePage");
  });

  it("falls back to sourceScreens[0].name when designIR is absent", () => {
    const pipelineState = makePipelineState({
      sourceScreens: [
        { id: "s-hint", name: "SourceHintName", nodeType: "FRAME" },
      ],
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: { fileKey: "file-xyz", nodeId: "1:2" },
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.nodeName).toBe("SourceHintName");
  });

  it("falls back to urlContext.fileKey when no screen names exist", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: { fileKey: "file-xyz", nodeId: "1:2" },
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.nodeName).toBe("file-xyz");
  });

  it("yields empty nodeName when no screen names and no urlContext", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.nodeName).toBe("");
  });
});

describe("buildPasteImportSession — nodeCount", () => {
  it("counts nodes recursively across screens with nested children", () => {
    const pipelineState = makePipelineState({
      designIR: {
        jobId: "job-ready-1",
        screens: [
          {
            id: "s1",
            name: "S1",
            children: [
              {
                id: "n1",
                name: "N1",
                type: "FRAME",
                children: [
                  { id: "n1.1", name: "N1.1", type: "TEXT" },
                  { id: "n1.2", name: "N1.2", type: "TEXT" },
                ],
              },
              { id: "n2", name: "N2", type: "FRAME" },
            ],
          },
          {
            id: "s2",
            name: "S2",
            children: [{ id: "n3", name: "N3", type: "FRAME" }],
          },
        ],
      },
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    // s1 + n1 + n1.1 + n1.2 + n2 + s2 + n3 = 7
    expect(session?.nodeCount).toBe(7);
  });

  it("defaults nodeCount to 0 when designIR is absent", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.nodeCount).toBe(0);
  });
});

describe("buildPasteImportSession — fileCount", () => {
  it("reflects generatedFiles.length", () => {
    const pipelineState = makePipelineState({
      generatedFiles: [
        { path: "src/App.tsx", sizeBytes: 100 },
        { path: "src/Page.tsx", sizeBytes: 200 },
      ],
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.fileCount).toBe(2);
  });

  it("defaults fileCount to 0 when generatedFiles is absent", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.fileCount).toBe(0);
  });
});

describe("buildPasteImportSession — componentMappings", () => {
  it("sums components.length across componentManifest.screens", () => {
    const pipelineState = makePipelineState({
      componentManifest: {
        jobId: "job-ready-1",
        screens: [
          {
            screenId: "s1",
            screenName: "S1",
            file: "src/S1.tsx",
            components: [
              {
                irNodeId: "n1",
                irNodeName: "N1",
                irNodeType: "FRAME",
                file: "src/S1.tsx",
                startLine: 1,
                endLine: 10,
              },
              {
                irNodeId: "n2",
                irNodeName: "N2",
                irNodeType: "FRAME",
                file: "src/S1.tsx",
                startLine: 11,
                endLine: 20,
              },
            ],
          },
          {
            screenId: "s2",
            screenName: "S2",
            file: "src/S2.tsx",
            components: [
              {
                irNodeId: "n3",
                irNodeName: "N3",
                irNodeType: "FRAME",
                file: "src/S2.tsx",
                startLine: 1,
                endLine: 10,
              },
            ],
          },
        ],
      },
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.componentMappings).toBe(3);
  });

  it("defaults componentMappings to 0 when componentManifest is absent", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.componentMappings).toBe(0);
  });
});

describe("buildPasteImportSession — carried fields", () => {
  it("carries pasteIdentityKey from pipeline state", () => {
    const pipelineState = makePipelineState({
      pasteIdentityKey: "paste-ident-abc",
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.pasteIdentityKey).toBe("paste-ident-abc");
  });

  it("sets pasteIdentityKey to null when absent", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.pasteIdentityKey).toBeNull();
  });

  it("copies selectedNodeIds into a mutable selectedNodes array", () => {
    const selectedNodeIds: readonly string[] = ["1:2", "3:4"];
    const pipelineState = makePipelineState({ selectedNodeIds });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.selectedNodes).toEqual(["1:2", "3:4"]);
    // Ensure it's a copy, not the same reference.
    expect(session?.selectedNodes).not.toBe(selectedNodeIds);
  });

  it("returns empty selectedNodes when selectedNodeIds is undefined", () => {
    const pipelineState = makePipelineState({ selectedNodeIds: undefined });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.selectedNodes).toEqual([]);
  });

  it("carries fileKey and nodeId from urlContext", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: { fileKey: "file-xyz", nodeId: "1:2" },
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.fileKey).toBe("file-xyz");
    expect(session?.nodeId).toBe("1:2");
  });

  it("defaults fileKey and nodeId to empty strings when urlContext is null", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.fileKey).toBe("");
    expect(session?.nodeId).toBe("");
  });

  it("defaults nodeId to empty string when urlContext.nodeId is null", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: { fileKey: "file-xyz", nodeId: null },
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.fileKey).toBe("file-xyz");
    expect(session?.nodeId).toBe("");
  });

  it("omits version when the pipeline state does not provide it", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.version).toBeUndefined();
  });

  it("marks scope='all' when the pipeline state has no selectedNodeIds", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.scope).toBe("all");
    expect(session?.selectedNodes).toEqual([]);
  });

  it("marks scope='partial' when the pipeline echoed a non-empty selectedNodeIds", () => {
    const pipelineState = makePipelineState({
      selectedNodeIds: ["a", "b"],
    });
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.scope).toBe("partial");
    expect(session?.selectedNodes).toEqual(["a", "b"]);
  });
});

describe("buildPasteImportSession — qualityScore + status", () => {
  it("forwards a valid qualityScore to the session", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: 82,
    });
    expect(session?.qualityScore).toBe(82);
  });

  it("accepts boundary values 0 and 100", () => {
    const pipelineState = makePipelineState();
    const zero = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: 0,
    });
    const hundred = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: 100,
    });
    expect(zero?.qualityScore).toBe(0);
    expect(hundred?.qualityScore).toBe(100);
  });

  it("drops an out-of-range qualityScore (above 100) without throwing", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: 101,
    });
    expect(session?.qualityScore).toBeUndefined();
  });

  it("drops an out-of-range qualityScore (below 0) without throwing", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: -1,
    });
    expect(session?.qualityScore).toBeUndefined();
  });

  it("drops a non-integer qualityScore without throwing", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: 82.5,
    });
    expect(session?.qualityScore).toBeUndefined();
  });

  it("omits qualityScore when the caller passes null", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      qualityScore: null,
    });
    expect(session?.qualityScore).toBeUndefined();
  });

  it("omits qualityScore when the caller omits the field", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.qualityScore).toBeUndefined();
  });

  it("defaults status to 'imported' when not provided", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
    });
    expect(session?.status).toBe("imported");
  });

  it("forwards an explicit status when provided", () => {
    const pipelineState = makePipelineState();
    const session = buildPasteImportSession({
      pipelineState,
      urlContext: null,
      sessionId: SESSION_ID,
      completedAt: COMPLETED_AT,
      status: "reviewing",
    });
    expect(session?.status).toBe("reviewing");
  });
});
