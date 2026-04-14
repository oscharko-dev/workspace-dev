/**
 * Unit tests for the progressive-streaming helpers that power the
 * component tree during a paste pipeline run.
 *
 * Scope:
 *  - `buildTreeFromIR(pipeline)` — pure transform from PastePipelineState to TreeNode[].
 *  - `useStreamingTreeNodes(pipeline)` — memoized React hook built on top of it.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/1005
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { TreeNode } from "./component-tree";
import type {
  FigmaAnalysisPayload,
  PastePipelineState,
  PipelineStage,
  SourceScreenHint,
  StageStatus,
} from "./paste-pipeline";
import { buildTreeFromIR, useStreamingTreeNodes } from "./component-tree-utils";

// Non-optional aliases for PastePipelineState fields. The module exposes them
// as optional (`designIR?`, `componentManifest?`), but `exactOptionalPropertyTypes`
// forbids explicitly passing `undefined` — so we cast fixtures to the non-optional
// shape and let `makePipeline` decide whether to include them.
type DesignIrPayload = NonNullable<PastePipelineState["designIR"]>;
type ComponentManifestPayload = NonNullable<
  PastePipelineState["componentManifest"]
>;

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_STAGES: readonly PipelineStage[] = [
  "idle",
  "parsing",
  "resolving",
  "transforming",
  "mapping",
  "generating",
  "ready",
  "error",
] as const;

function makeStageProgress(): Record<PipelineStage, StageStatus> {
  const progress = {} as Record<PipelineStage, StageStatus>;
  for (const stage of ALL_STAGES) {
    progress[stage] = { state: "pending" };
  }
  return progress;
}

function makePipeline(
  overrides: Partial<PastePipelineState> = {},
): PastePipelineState {
  return {
    stage: "idle",
    progress: 0,
    stageProgress: makeStageProgress(),
    errors: [],
    canRetry: false,
    canCancel: false,
    ...overrides,
  };
}

interface IrElementInput {
  id: string;
  name: string;
  type: string;
  children?: IrElementInput[];
}

interface DesignIRInput {
  jobId: string;
  screens: Array<{
    id: string;
    name: string;
    generatedFile?: string;
    children: IrElementInput[];
  }>;
}

/**
 * Creates a tiny DesignIR with a single screen containing a nested tree.
 * Matches the `DesignIrPayload` shape imported by paste-pipeline.
 */
function makeDesignIR(): DesignIRInput {
  return {
    jobId: "job-1",
    screens: [
      {
        id: "screen-1",
        name: "HomeScreen",
        children: [
          {
            id: "header",
            name: "Header",
            type: "container",
            children: [{ id: "logo", name: "Logo", type: "image" }],
          },
          { id: "footer", name: "Footer", type: "container", children: [] },
        ],
      },
    ],
  };
}

function makeEmptyScreenDesignIR(): DesignIRInput {
  return {
    jobId: "job-empty",
    screens: [
      {
        id: "screen-empty",
        name: "EmptyScreen",
        children: [],
      },
    ],
  };
}

interface ManifestInput {
  jobId: string;
  screens: Array<{
    screenId: string;
    screenName: string;
    file: string;
    components: Array<{
      irNodeId: string;
      irNodeName: string;
      irNodeType: string;
      file: string;
      startLine: number;
      endLine: number;
      extractedComponent?: true;
    }>;
  }>;
}

function makeManifest(
  irNodeIds: Array<string | { id: string; extractedComponent?: true }>,
): ManifestInput {
  return {
    jobId: "job-1",
    screens: [
      {
        screenId: "screen-1",
        screenName: "HomeScreen",
        file: "HomeScreen.tsx",
        components: irNodeIds.map((entry) => ({
          irNodeId: typeof entry === "string" ? entry : entry.id,
          irNodeName: typeof entry === "string" ? entry : entry.id,
          irNodeType: "container",
          file: "HomeScreen.tsx",
          startLine: 1,
          endLine: 10,
          ...(typeof entry === "string" || entry.extractedComponent !== true
            ? {}
            : { extractedComponent: true }),
        })),
      },
    ],
  };
}

function makeSourceScreens(): SourceScreenHint[] {
  return [
    { id: "root-1", name: "Dashboard", nodeType: "frame" },
    { id: "root-2", name: "Settings", nodeType: "frame" },
  ];
}

function makeFigmaAnalysis(): FigmaAnalysisPayload {
  return {
    jobId: "job-1",
    layoutGraph: {
      pages: [
        {
          id: "page-1",
          name: "Page",
          frameIds: ["root-1", "nested-frame", "root-2"],
        },
      ],
      frames: [
        { id: "root-1", name: "Dashboard", pageId: "page-1" },
        {
          id: "nested-frame",
          name: "Nested Card",
          pageId: "page-1",
          parentSectionId: "section-1",
        },
        { id: "root-2", name: "Settings", pageId: "page-1" },
      ],
    },
    diagnostics: [{ severity: "error", sourceNodeId: "footer" }],
  };
}

/**
 * Recursively searches a tree for the node matching `id`. Returns `null` if
 * the node is not present. Useful for assertions on deeply nested nodes.
 */
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const nested = findNode(node.children, id);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// buildTreeFromIR
// ---------------------------------------------------------------------------

describe("buildTreeFromIR", () => {
  it("uses source screen hints to render resolving roots before designIR exists", () => {
    const pipeline = makePipeline({
      stage: "resolving",
      sourceScreens: makeSourceScreens(),
    });

    expect(buildTreeFromIR(pipeline)).toEqual([
      {
        id: "root-1",
        name: "Dashboard",
        type: "screen",
        children: [
          { id: "skeleton-root-1-0", name: "", type: "skeleton" },
          { id: "skeleton-root-1-1", name: "", type: "skeleton" },
          { id: "skeleton-root-1-2", name: "", type: "skeleton" },
        ],
      },
      {
        id: "root-2",
        name: "Settings",
        type: "screen",
        children: [
          { id: "skeleton-root-2-0", name: "", type: "skeleton" },
          { id: "skeleton-root-2-1", name: "", type: "skeleton" },
          { id: "skeleton-root-2-2", name: "", type: "skeleton" },
        ],
      },
    ]);
  });

  it("falls back to figma analysis roots when designIR is undefined", () => {
    const pipeline = makePipeline({
      stage: "transforming",
      figmaAnalysis: makeFigmaAnalysis(),
    });

    expect(buildTreeFromIR(pipeline).map((node) => node.id)).toEqual([
      "root-1",
      "root-2",
    ]);
  });

  it("returns [] when no streaming source is available", () => {
    const pipeline = makePipeline({ stage: "parsing" });
    expect(buildTreeFromIR(pipeline)).toEqual([]);
  });

  it("maps screens to screen-type tree nodes", () => {
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("screen-1");
    expect(tree[0]!.name).toBe("HomeScreen");
    expect(tree[0]!.type).toBe("screen");
  });

  it("maps nested children correctly", () => {
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);
    const screen = tree[0]!;
    expect(screen.children).toHaveLength(2);

    const header = screen.children![0]!;
    expect(header.id).toBe("header");
    expect(header.name).toBe("Header");
    expect(header.type).toBe("container");
    expect(header.children).toHaveLength(1);

    const logo = header.children![0]!;
    expect(logo.id).toBe("logo");
    expect(logo.name).toBe("Logo");
    expect(logo.type).toBe("image");
    // leaf nodes should have no `children` field when the IR did not
    // supply children (exact-shape assertion guards against regressions
    // that silently append empty arrays).
    expect(logo.children).toBeUndefined();
  });

  it("adds skeleton children when screen has no children and stage is not ready", () => {
    const pipeline = makePipeline({
      stage: "parsing",
      designIR: makeEmptyScreenDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);
    const screen = tree[0]!;

    expect(screen.children).toHaveLength(3);
    for (const child of screen.children!) {
      expect(child.type).toBe("skeleton");
      expect(child.name).toBe("");
    }
  });

  it("does NOT add skeleton children when stage is ready and screen has no children", () => {
    const pipeline = makePipeline({
      stage: "ready",
      designIR: makeEmptyScreenDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);
    const screen = tree[0]!;

    expect(screen.children).toEqual([]);
  });

  it("does NOT set mappingStatus before mapping stage", () => {
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest([
        "header",
        "logo",
        "footer",
      ]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "header")!.mappingStatus).toBeUndefined();
    expect(findNode(tree, "logo")!.mappingStatus).toBeUndefined();
    expect(findNode(tree, "footer")!.mappingStatus).toBeUndefined();
  });

  it("defaults to unmapped badges after mapping stage when no manifest is available", () => {
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "header")!.mappingStatus).toBe("unmapped");
    expect(findNode(tree, "logo")!.mappingStatus).toBe("unmapped");
    expect(findNode(tree, "footer")!.mappingStatus).toBe("unmapped");
  });

  it("sets mappingStatus:matched for nodes in the manifest (stage=mapping)", () => {
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest(["header"]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "header")!.mappingStatus).toBe("matched");
  });

  it("sets mappingStatus:matched for nodes in the manifest (stage=generating)", () => {
    const pipeline = makePipeline({
      stage: "generating",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest(["logo"]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "logo")!.mappingStatus).toBe("matched");
  });

  it("sets mappingStatus:matched for nodes in the manifest (stage=ready)", () => {
    const pipeline = makePipeline({
      stage: "ready",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest(["footer"]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "footer")!.mappingStatus).toBe("matched");
  });

  it("sets mappingStatus:suggested for extracted component entries", () => {
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest([
        { id: "header", extractedComponent: true },
      ]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "header")!.mappingStatus).toBe("suggested");
  });

  it("sets mappingStatus:error when figma analysis carries node diagnostics", () => {
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
      figmaAnalysis: makeFigmaAnalysis(),
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "footer")!.mappingStatus).toBe("error");
  });

  it("sets mappingStatus:unmapped for nodes NOT in the manifest (stage=mapping)", () => {
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
      // Only `header` is mapped — `logo` and `footer` should be "unmapped".
      componentManifest: makeManifest(["header"]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "logo")!.mappingStatus).toBe("unmapped");
    expect(findNode(tree, "footer")!.mappingStatus).toBe("unmapped");
  });

  it("sets pipelineStatus:generating on leaf nodes during generating stage", () => {
    const pipeline = makePipeline({
      stage: "generating",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    // Leaf nodes: `logo` (no children), `footer` (empty children array).
    expect(findNode(tree, "logo")!.pipelineStatus).toBe("generating");
    expect(findNode(tree, "footer")!.pipelineStatus).toBe("generating");
  });

  it("does NOT set pipelineStatus:generating on nodes that have children", () => {
    const pipeline = makePipeline({
      stage: "generating",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    // `header` has one child, so it should NOT be marked generating.
    expect(findNode(tree, "header")!.pipelineStatus).toBeUndefined();
  });

  it("does NOT set mappingStatus for parsing/resolving/transforming stages even with manifest", () => {
    for (const stage of ["parsing", "resolving", "transforming"] as const) {
      const pipeline = makePipeline({
        stage,
        designIR: makeDesignIR() as DesignIrPayload,
        componentManifest: makeManifest([
          "header",
          "logo",
          "footer",
        ]) as ComponentManifestPayload,
      });

      const tree = buildTreeFromIR(pipeline);

      expect(findNode(tree, "header")!.mappingStatus).toBeUndefined();
      expect(findNode(tree, "logo")!.mappingStatus).toBeUndefined();
      expect(findNode(tree, "footer")!.mappingStatus).toBeUndefined();
    }
  });

  it("produces stable node IDs for skeleton nodes (skeleton-{parentId}-{0,1,2})", () => {
    const pipeline = makePipeline({
      stage: "parsing",
      designIR: makeEmptyScreenDesignIR() as DesignIrPayload,
    });

    const tree = buildTreeFromIR(pipeline);
    const screen = tree[0]!;

    const ids = screen.children!.map((child) => child.id);
    expect(ids).toEqual([
      "skeleton-screen-empty-0",
      "skeleton-screen-empty-1",
      "skeleton-screen-empty-2",
    ]);
  });

  // ---------------------------------------------------------------------
  // Supplementary edge cases (self-critique pass 2).
  // ---------------------------------------------------------------------

  it("does NOT set pipelineStatus on leaf nodes when stage is not generating", () => {
    for (const stage of [
      "parsing",
      "resolving",
      "transforming",
      "mapping",
      "ready",
    ] as const) {
      const pipeline = makePipeline({
        stage,
        designIR: makeDesignIR() as DesignIrPayload,
      });
      const tree = buildTreeFromIR(pipeline);
      expect(findNode(tree, "logo")!.pipelineStatus).toBeUndefined();
      expect(findNode(tree, "footer")!.pipelineStatus).toBeUndefined();
    }
  });

  it("produces skeleton placeholders for every non-ready stage when screen has no IR children", () => {
    for (const stage of [
      "idle",
      "parsing",
      "resolving",
      "transforming",
      "mapping",
      "generating",
      "error",
    ] as const) {
      const pipeline = makePipeline({
        stage,
        designIR: makeEmptyScreenDesignIR() as DesignIrPayload,
      });
      const tree = buildTreeFromIR(pipeline);
      expect(tree[0]!.children).toHaveLength(3);
      for (const child of tree[0]!.children!) {
        expect(child.type).toBe("skeleton");
      }
    }
  });

  it("returns [] for an explicit `error` stage without designIR", () => {
    const pipeline = makePipeline({ stage: "error" });
    expect(buildTreeFromIR(pipeline)).toEqual([]);
  });

  it("processes every screen when designIR contains multiple screens", () => {
    // Multi-screen fixture exercises the `designIR.screens.map` branch
    // against a real screen list (length > 1), guarding against a
    // regression that hard-coded the first screen or broke iteration.
    const multiScreen: DesignIrPayload = {
      jobId: "job-multi",
      screens: [
        {
          id: "s-a",
          name: "A",
          children: [{ id: "a-1", name: "A1", type: "text" }],
        },
        {
          id: "s-b",
          name: "B",
          children: [{ id: "b-1", name: "B1", type: "text" }],
        },
        { id: "s-c", name: "C", children: [] },
      ],
    };
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: multiScreen,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(tree.map((node) => node.id)).toEqual(["s-a", "s-b", "s-c"]);
    // Empty screen should receive 3 skeletons (stage !== "ready").
    expect(tree[2]!.children).toHaveLength(3);
  });

  it("ignores manifest entries that do not correspond to any IR node", () => {
    // Regression guard: extra manifest entries that point at unknown IR ids
    // must not alter mappingStatus for the real IR nodes and must not
    // inject phantom nodes into the tree.
    const pipeline = makePipeline({
      stage: "mapping",
      designIR: makeDesignIR() as DesignIrPayload,
      componentManifest: makeManifest([
        "logo",
        "ghost-that-does-not-exist",
      ]) as ComponentManifestPayload,
    });

    const tree = buildTreeFromIR(pipeline);

    expect(findNode(tree, "logo")!.mappingStatus).toBe("matched");
    expect(findNode(tree, "ghost-that-does-not-exist")).toBeNull();
  });

  it("preserves child order from the DesignIR", () => {
    const ordered: DesignIrPayload = {
      jobId: "job-order",
      screens: [
        {
          id: "screen-order",
          name: "Ordered",
          children: [
            { id: "first", name: "First", type: "text" },
            { id: "second", name: "Second", type: "text" },
            { id: "third", name: "Third", type: "text" },
          ],
        },
      ],
    };
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: ordered,
    });

    const tree = buildTreeFromIR(pipeline);
    expect(tree[0]!.children!.map((child) => child.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

// ---------------------------------------------------------------------------
// useStreamingTreeNodes
// ---------------------------------------------------------------------------

describe("useStreamingTreeNodes", () => {
  it("returns [] when no designIR", () => {
    const pipeline = makePipeline({ stage: "parsing" });

    const { result } = renderHook(() => useStreamingTreeNodes(pipeline));

    expect(result.current).toEqual([]);
  });

  it("returns tree nodes when designIR present", () => {
    const pipeline = makePipeline({
      stage: "transforming",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const { result } = renderHook(() => useStreamingTreeNodes(pipeline));

    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.id).toBe("screen-1");
  });

  it("memoizes result — same reference when pipeline fields unchanged", () => {
    const designIR = makeDesignIR() as DesignIrPayload;
    const pipeline = makePipeline({ stage: "transforming", designIR });

    const { result, rerender } = renderHook(
      (props: PastePipelineState) => useStreamingTreeNodes(props),
      { initialProps: pipeline },
    );

    const firstRef = result.current;

    // Rerender with a NEW pipeline object whose tracked deps
    // (designIR, stage, componentManifest) have not changed.
    rerender({ ...pipeline, progress: 42 });

    expect(result.current).toBe(firstRef);
  });

  it("returns new reference when stage changes", () => {
    const designIR = makeDesignIR() as DesignIrPayload;
    const initial = makePipeline({ stage: "transforming", designIR });

    const { result, rerender } = renderHook(
      (props: PastePipelineState) => useStreamingTreeNodes(props),
      { initialProps: initial },
    );

    const firstRef = result.current;

    rerender(makePipeline({ stage: "generating", designIR }));

    expect(result.current).not.toBe(firstRef);
  });

  it("returns new reference when designIR changes", () => {
    const initial = makePipeline({
      stage: "transforming",
      designIR: makeDesignIR() as DesignIrPayload,
    });

    const { result, rerender } = renderHook(
      (props: PastePipelineState) => useStreamingTreeNodes(props),
      { initialProps: initial },
    );

    const firstRef = result.current;

    rerender(
      makePipeline({
        stage: "transforming",
        designIR: makeEmptyScreenDesignIR() as DesignIrPayload,
      }),
    );

    expect(result.current).not.toBe(firstRef);
  });

  it("returns new reference when componentManifest changes", () => {
    const designIR = makeDesignIR() as DesignIrPayload;
    const initial = makePipeline({ stage: "mapping", designIR });

    const { result, rerender } = renderHook(
      (props: PastePipelineState) => useStreamingTreeNodes(props),
      { initialProps: initial },
    );

    const firstRef = result.current;

    rerender(
      makePipeline({
        stage: "mapping",
        designIR,
        componentManifest: makeManifest(["header"]) as ComponentManifestPayload,
      }),
    );

    expect(result.current).not.toBe(firstRef);
  });
});
