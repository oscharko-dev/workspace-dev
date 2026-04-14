import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement, type ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";
import {
  computeInspectorDraftBaseFingerprint,
  createInspectorOverrideDraft,
  toInspectorOverrideDraftStorageKey,
  upsertInspectorOverrideEntry,
} from "./inspector-override-draft";
import { toInspectorLayoutStorageKey } from "./layout-state";
import {
  createInitialPipelineState,
  type PastePipelineState,
} from "./paste-pipeline";
import { createPipelineExecutionLog } from "./pipeline-execution-log";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock("@tanstack/react-query", () => {
  return {
    useQuery: (args: unknown) => mockUseQuery(args),
    useMutation: (args: unknown) => mockUseMutation(args),
  };
});

type MockQueryKey =
  | "inspector-files"
  | "inspector-manifest"
  | "inspector-design-ir"
  | "inspector-file-content"
  | "inspector-generation-metrics";

interface MockQueryResult {
  data: unknown;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
}

function createDefaultQueryResults(): Record<MockQueryKey, MockQueryResult> {
  return {
    "inspector-files": {
      data: {
        ok: true,
        status: 200,
        payload: {
          jobId: "job-1",
          files: [{ path: "src/screens/Home.tsx", sizeBytes: 123 }],
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    },
    "inspector-manifest": {
      data: {
        ok: true,
        status: 200,
        payload: {
          jobId: "job-1",
          screens: [
            {
              screenId: "screen-home",
              screenName: "Home",
              file: "src/screens/Home.tsx",
              components: [],
            },
          ],
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    },
    "inspector-design-ir": {
      data: {
        ok: true,
        status: 200,
        payload: {
          jobId: "job-1",
          screens: [
            {
              id: "screen-home",
              name: "Home",
              generatedFile: "src/screens/Home.tsx",
              children: [],
            },
          ],
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    },
    "inspector-file-content": {
      data: {
        ok: true,
        status: 200,
        content: "export default function Home() { return null; }",
        error: null,
        message: null,
      },
      isLoading: false,
      refetch: vi.fn(),
    },
    "inspector-generation-metrics": {
      data: {
        ok: true,
        status: 200,
        payload: {
          skippedHidden: 2,
          skippedPlaceholders: 1,
          truncatedScreens: [
            {
              originalElements: 10,
              retainedElements: 7,
            },
          ],
          depthTruncatedScreens: [{ truncatedBranchCount: 2 }],
          classificationFallbacks: [{ nodeId: "node-1" }],
          degradedGeometryNodes: ["1:1"],
        },
        error: null,
        message: null,
      },
      isLoading: false,
      refetch: vi.fn(),
    },
  };
}

function installQueryMock({
  overrides,
}: {
  overrides?: Partial<Record<MockQueryKey, Partial<MockQueryResult>>>;
} = {}): Record<MockQueryKey, MockQueryResult> {
  const base = createDefaultQueryResults();
  const merged = {
    "inspector-files": {
      ...base["inspector-files"],
      ...(overrides?.["inspector-files"] ?? {}),
    },
    "inspector-manifest": {
      ...base["inspector-manifest"],
      ...(overrides?.["inspector-manifest"] ?? {}),
    },
    "inspector-design-ir": {
      ...base["inspector-design-ir"],
      ...(overrides?.["inspector-design-ir"] ?? {}),
    },
    "inspector-file-content": {
      ...base["inspector-file-content"],
      ...(overrides?.["inspector-file-content"] ?? {}),
    },
    "inspector-generation-metrics": {
      ...base["inspector-generation-metrics"],
      ...(overrides?.["inspector-generation-metrics"] ?? {}),
    },
  } satisfies Record<MockQueryKey, MockQueryResult>;

  mockUseQuery.mockImplementation((input: { queryKey?: unknown[] }) => {
    const key = Array.isArray(input.queryKey) ? input.queryKey[0] : "";
    if (key === "inspector-files") {
      return merged["inspector-files"];
    }
    if (key === "inspector-manifest") {
      return merged["inspector-manifest"];
    }
    if (key === "inspector-design-ir") {
      return merged["inspector-design-ir"];
    }
    if (key === "inspector-file-content") {
      return merged["inspector-file-content"];
    }
    if (key === "inspector-generation-metrics") {
      return merged["inspector-generation-metrics"];
    }

    return {
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  return merged;
}

function installMutationMock(): void {
  mockUseMutation.mockImplementation(
    (options: {
      mutationFn: (variables?: unknown) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (error: unknown) => void;
    }) => {
      return {
        isPending: false,
        mutate: (variables?: unknown) => {
          void Promise.resolve()
            .then(async () => await options.mutationFn(variables))
            .then((data) => {
              options.onSuccess?.(data);
            })
            .catch((error) => {
              options.onError?.(error);
            });
        },
      };
    },
  );
}

function renderInspectorPanel(
  overrides: Partial<ComponentProps<typeof InspectorPanel>> = {},
) {
  return render(
    createElement(InspectorPanel, {
      jobId: "job-1",
      previewUrl: "/workspace/repros/job-1/",
      ...overrides,
    }),
  );
}

function buildPipelineState(
  overrides: Partial<PastePipelineState> = {},
): PastePipelineState {
  const base = createInitialPipelineState();
  return {
    ...base,
    stage: "partial",
    jobId: "job-1",
    jobStatus: "completed",
    canRetry: true,
    stageProgress: {
      ...base.stageProgress,
      resolving: { state: "done", duration: 12 },
      transforming: {
        state: "failed",
        error: {
          stage: "transforming",
          code: "TRANSFORM_PARTIAL",
          message: "Unsupported nodes were skipped.",
          retryable: false,
        },
      },
      generating: {
        state: "failed",
        error: {
          stage: "generating",
          code: "CODEGEN_PARTIAL",
          message: "Some files failed.",
          retryable: true,
        },
      },
    },
    errors: [
      {
        stage: "transforming",
        code: "TRANSFORM_PARTIAL",
        message: "Unsupported nodes were skipped.",
        retryable: false,
      },
      {
        stage: "generating",
        code: "CODEGEN_PARTIAL",
        message: "Some files failed.",
        retryable: true,
        retryTargets: [
          {
            id: "src/routes/settings.tsx",
            label: "settings.tsx",
            filePath: "src/routes/settings.tsx",
            stage: "generating",
          },
        ],
      },
    ],
    partialStats: { resolvedStages: 2, totalStages: 4, errorCount: 2 },
    fallbackMode: "rest",
    retryRequest: {
      stage: "generating",
      targetIds: ["src/routes/settings.tsx"],
    },
    screenshot: "http://127.0.0.1:1983/partial-shot.png",
    ...overrides,
  };
}

function editableNodeQueryOverrides({
  invalidPadding = false,
  nodeOverrides = {},
}: {
  invalidPadding?: boolean;
  nodeOverrides?: Record<string, unknown>;
} = {}): Partial<Record<MockQueryKey, Partial<MockQueryResult>>> {
  return {
    "inspector-manifest": {
      data: {
        ok: true,
        status: 200,
        payload: {
          jobId: "job-1",
          screens: [
            {
              screenId: "screen-home",
              screenName: "Home",
              file: "src/screens/Home.tsx",
              components: [
                {
                  irNodeId: "node-editable",
                  irNodeName: "Editable Node",
                  irNodeType: "container",
                  file: "src/screens/Home.tsx",
                  startLine: 1,
                  endLine: 6,
                },
              ],
            },
          ],
        },
      },
    },
    "inspector-design-ir": {
      data: {
        ok: true,
        status: 200,
        payload: {
          jobId: "job-1",
          screens: [
            {
              id: "screen-home",
              name: "Home",
              generatedFile: "src/screens/Home.tsx",
              children: [
                {
                  id: "node-editable",
                  name: "Editable Node",
                  type: "container",
                  fillColor: "#112233",
                  opacity: 0.5,
                  fontSize: 16,
                  fontWeight: 400,
                  fontFamily: "Inter",
                  padding: invalidPadding
                    ? "bad-padding-shape"
                    : {
                        top: 8,
                        right: 10,
                        bottom: 8,
                        left: 10,
                      },
                  gap: 12,
                  width: 360,
                  height: 48,
                  layoutMode: "HORIZONTAL",
                  primaryAxisAlignItems: "CENTER",
                  counterAxisAlignItems: "MAX",
                  ...nodeOverrides,
                  children: [
                    {
                      id: "node-editable-child",
                      name: "Child",
                      type: "text",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  };
}

beforeAll(() => {
  const matchMediaMock = vi.fn().mockImplementation((query: string) => {
    return {
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: matchMediaMock,
  });
});

function installPointerCaptureMock(element: HTMLElement): {
  releasePointerCapture: ReturnType<typeof vi.fn>;
  setPointerCapture: ReturnType<typeof vi.fn>;
} {
  let capturedPointerId: number | null = null;
  const setPointerCapture = vi.fn((pointerId: number) => {
    capturedPointerId = pointerId;
  });
  const releasePointerCapture = vi.fn((pointerId: number) => {
    if (capturedPointerId === pointerId) {
      capturedPointerId = null;
    }
  });

  Object.defineProperty(element, "setPointerCapture", {
    configurable: true,
    value: setPointerCapture,
  });
  Object.defineProperty(element, "releasePointerCapture", {
    configurable: true,
    value: releasePointerCapture,
  });
  Object.defineProperty(element, "hasPointerCapture", {
    configurable: true,
    value: (pointerId: number) => capturedPointerId === pointerId,
  });

  return {
    releasePointerCapture,
    setPointerCapture,
  };
}

describe("InspectorPanel splitters", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    installQueryMock();
    installMutationMock();
  });

  it("supports keyboard resizing on the preview-code separator", () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const separator = screen.getByTestId("inspector-splitter-preview-code");
    expect(separator).toHaveAttribute("role", "separator");

    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    const after = Number(separator.getAttribute("aria-valuenow"));

    expect(after).toBeGreaterThan(before);
  });

  it("renders two interactive separators when tree is expanded", () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-splitter-tree-preview"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-splitter-preview-code"),
    ).toBeInTheDocument();
  });

  it("supports pointer resizing on the preview-code separator and persists layout on pointerup", () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const separator = screen.getByTestId("inspector-splitter-preview-code");
    const { releasePointerCapture, setPointerCapture } =
      installPointerCaptureMock(separator);

    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.pointerDown(separator, {
      pointerId: 7,
      clientX: 600,
      buttons: 1,
    });
    fireEvent.pointerMove(separator, {
      pointerId: 7,
      clientX: 480,
      buttons: 1,
    });

    const mid = Number(separator.getAttribute("aria-valuenow"));
    expect(mid).toBeLessThan(before);
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.documentElement.style.cursor).toBe("col-resize");

    fireEvent.pointerUp(separator, {
      pointerId: 7,
      clientX: 480,
    });

    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(mid);
    expect(
      window.localStorage.getItem(toInspectorLayoutStorageKey("job-1")),
    ).toBeTruthy();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(document.documentElement.style.cursor).toBe("");
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("persists the last known drag position when pointer capture is lost", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderInspectorPanel({ openDialog: "inspectability" });

    const separator = screen.getByTestId("inspector-splitter-tree-preview");
    installPointerCaptureMock(separator);

    fireEvent.pointerDown(separator, {
      pointerId: 9,
      clientX: 400,
      buttons: 1,
    });
    fireEvent.pointerMove(separator, {
      pointerId: 9,
      clientX: 520,
      buttons: 1,
    });

    const movedValue = Number(separator.getAttribute("aria-valuenow"));
    const setItemCallsBeforeLostCapture = setItemSpy.mock.calls.length;

    fireEvent(
      separator,
      new PointerEvent("lostpointercapture", {
        bubbles: true,
        pointerId: 9,
        clientX: 0,
      }),
    );

    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(movedValue);
    expect(
      window.localStorage.getItem(toInspectorLayoutStorageKey("job-1")),
    ).toBeTruthy();
    expect(document.body.style.userSelect).toBe("");
    expect(setItemSpy.mock.calls.length - setItemCallsBeforeLostCapture).toBe(
      1,
    );

    setItemSpy.mockRestore();
  });

  it("restores the tree pane width after collapse and re-expand", () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const separator = screen.getByTestId("inspector-splitter-tree-preview");
    installPointerCaptureMock(separator);

    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.pointerDown(separator, {
      pointerId: 11,
      clientX: 360,
      buttons: 1,
    });
    fireEvent.pointerMove(separator, {
      pointerId: 11,
      clientX: 500,
      buttons: 1,
    });
    fireEvent.pointerUp(separator, {
      pointerId: 11,
      clientX: 500,
    });

    const resizedValue = Number(
      screen
        .getByTestId("inspector-splitter-tree-preview")
        .getAttribute("aria-valuenow"),
    );
    expect(resizedValue).toBeGreaterThan(before);

    fireEvent.click(screen.getByTestId("tree-collapse-button"));
    expect(
      screen.queryByTestId("inspector-splitter-tree-preview"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tree-expand-button")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tree-expand-button"));
    expect(
      Number(
        screen
          .getByTestId("inspector-splitter-tree-preview")
          .getAttribute("aria-valuenow"),
      ),
    ).toBe(resizedValue);
  });

  it("ignores unsupported keys and keyboard resizing when desktop layout is disabled", () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const separator = screen.getByTestId("inspector-splitter-preview-code");
    const before = Number(separator.getAttribute("aria-valuenow"));

    fireEvent.keyDown(separator, { key: "Enter" });
    expect(Number(separator.getAttribute("aria-valuenow"))).toBe(before);

    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((_query: string) => ({
        matches: false,
        media: _query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    cleanup();
    installQueryMock();
    installMutationMock();
    renderInspectorPanel({ openDialog: "inspectability" });

    const nonDesktopSeparator = screen.getByTestId(
      "inspector-splitter-preview-code",
    );
    const nonDesktopBefore = Number(
      nonDesktopSeparator.getAttribute("aria-valuenow"),
    );
    fireEvent.keyDown(nonDesktopSeparator, { key: "ArrowRight" });
    expect(Number(nonDesktopSeparator.getAttribute("aria-valuenow"))).toBe(
      nonDesktopBefore,
    );

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });
});

describe("InspectorPanel navigation stack", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.sessionStorage.clear();
    installQueryMock();
    installMutationMock();
  });

  it("replays committed selection states via back and forward controls", async () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const backButton = screen.getByTestId("inspector-nav-back");
    const forwardButton = screen.getByTestId("inspector-nav-forward");
    const screenNode = screen.getByTestId("tree-screen-screen-home");

    expect(backButton).toBeDisabled();
    expect(forwardButton).toBeDisabled();
    expect(screenNode).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screenNode);
    await waitFor(() => {
      expect(screenNode).toHaveAttribute("aria-selected", "true");
    });
    expect(backButton).toBeEnabled();
    expect(forwardButton).toBeDisabled();

    fireEvent.click(backButton);
    await waitFor(() => {
      expect(screenNode).toHaveAttribute("aria-selected", "false");
    });
    expect(backButton).toBeDisabled();
    expect(forwardButton).toBeEnabled();

    fireEvent.click(forwardButton);
    await waitFor(() => {
      expect(screenNode).toHaveAttribute("aria-selected", "true");
    });
    expect(backButton).toBeEnabled();
  });

  it("exposes level-up in breadcrumb and applies one-scope-level pop", async () => {
    renderInspectorPanel({ openDialog: "inspectability" });

    const screenNode = screen.getByTestId("tree-screen-screen-home");
    fireEvent.click(screenNode);

    await waitFor(() => {
      expect(screen.getByTestId("inspector-breadcrumb")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("breadcrumb-enter-scope"));
    await waitFor(() => {
      expect(screen.getByTestId("breadcrumb-scope-badge")).toBeInTheDocument();
    });

    const levelUpButton = screen.getByTestId("breadcrumb-exit-scope");
    expect(levelUpButton).toHaveTextContent("Level up");
    fireEvent.click(levelUpButton);

    await waitFor(() => {
      expect(
        screen.queryByTestId("breadcrumb-scope-badge"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("InspectorPanel pipeline recovery UI", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.sessionStorage.clear();
    installQueryMock();
    installMutationMock();
  });

  it("shows pane-local recovery banners and failed-file retry actions for partial imports", () => {
    const onPipelineRetry = vi.fn();

    renderInspectorPanel({
      previewUrl: "",
      pipeline: buildPipelineState(),
      onPipelineRetry,
    });

    expect(
      screen.getByTestId("pipeline-status-bar-fallback-mode"),
    ).toHaveTextContent("Figma REST fallback active");
    expect(
      screen.getByTestId("inspector-tree-recovery-banner"),
    ).toHaveTextContent("Transform partial");
    expect(
      screen.getByTestId("inspector-preview-recovery-banner"),
    ).toHaveTextContent("Showing the captured screenshot instead");
    expect(
      screen.getByTestId("inspector-code-recovery-banner"),
    ).toHaveTextContent("Some generated files failed.");

    fireEvent.click(screen.getByTestId("inspector-tree-recovery-retry"));
    expect(onPipelineRetry).toHaveBeenCalledWith("transforming");

    fireEvent.click(
      screen.getByTestId(
        "inspector-code-retry-target-src/routes/settings.tsx",
      ),
    );
    expect(onPipelineRetry).toHaveBeenCalledWith("generating", [
      "src/routes/settings.tsx",
    ]);
  });

  it("copies the unified sanitized pipeline report", async () => {
    const executionLog = createPipelineExecutionLog();
    executionLog.addEntry({
      timestamp: "2026-04-14T12:00:00.000Z",
      stage: "generating",
      success: false,
      errorCode: "CODEGEN_PARTIAL",
      errorMessage: "Bearer figd_secret_token",
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderInspectorPanel({
      previewUrl: "",
      pipeline: buildPipelineState(),
      executionLog,
    });

    fireEvent.click(screen.getByTestId("pipeline-status-bar-copy-report"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('"outcome": "partial"');
    expect(copied).toContain('"fallbackMode": "rest"');
    expect(copied).toContain('"retry": {');
    expect(copied).toContain('"executionLog": [');
    expect(copied).toContain("[REDACTED]");
  });
});

describe("InspectorPanel data states", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.sessionStorage.clear();
    installMutationMock();
  });

  it("shows design-ir error state and retries only the design-ir endpoint", () => {
    const designIrRefetch = vi.fn();
    installQueryMock({
      overrides: {
        "inspector-design-ir": {
          data: {
            ok: false,
            status: 500,
            payload: {
              error: "DESIGN_IR_NOT_FOUND",
              message: "Design IR artifact is unavailable.",
            },
          },
          refetch: designIrRefetch,
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-source-design-ir-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-design-ir-state-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-file-selector")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("inspector-retry-design-ir"));
    expect(designIrRefetch).toHaveBeenCalledTimes(1);
  });

  it("keeps tree/code available when manifest fails and retries manifest endpoint", () => {
    const manifestRefetch = vi.fn();
    installQueryMock({
      overrides: {
        "inspector-manifest": {
          data: {
            ok: false,
            status: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: "Failed to parse component manifest.",
            },
          },
          refetch: manifestRefetch,
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-source-component-manifest-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("component-tree")).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-error-component-manifest"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("inspector-banner-retry-component-manifest"),
    );
    expect(manifestRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows file-content error with retry action", () => {
    const fileContentRefetch = vi.fn();
    installQueryMock({
      overrides: {
        "inspector-file-content": {
          data: {
            ok: false,
            status: 404,
            content: null,
            error: "FILE_NOT_FOUND",
            message: "File 'src/screens/Home.tsx' not found.",
          },
          refetch: fileContentRefetch,
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-source-file-content-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-state-file-content-error"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("inspector-retry-file-content"));
    expect(fileContentRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders aggregate inspectability summary with manifest coverage and omission counters", () => {
    installQueryMock({
      overrides: {
        "inspector-design-ir": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [
                {
                  id: "screen-home",
                  name: "Home",
                  generatedFile: "src/screens/Home.tsx",
                  children: [
                    {
                      id: "node-a",
                      name: "A",
                      type: "container",
                      children: [],
                    },
                    {
                      id: "node-b",
                      name: "B",
                      type: "text",
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        },
        "inspector-manifest": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [
                {
                  screenId: "screen-home",
                  screenName: "Home",
                  file: "src/screens/Home.tsx",
                  components: [
                    {
                      irNodeId: "node-a",
                      irNodeName: "A",
                      irNodeType: "container",
                      file: "src/screens/Home.tsx",
                      startLine: 1,
                      endLine: 4,
                    },
                  ],
                },
              ],
            },
          },
        },
        "inspector-generation-metrics": {
          data: {
            ok: true,
            status: 200,
            payload: {
              skippedHidden: 2,
              skippedPlaceholders: 3,
              truncatedScreens: [{ originalElements: 9, retainedElements: 5 }],
              depthTruncatedScreens: [{ truncatedBranchCount: 2 }],
              classificationFallbacks: [{ nodeId: "x" }, { nodeId: "y" }],
              degradedGeometryNodes: ["1:1"],
            },
            error: null,
            message: null,
          },
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-inspectability-summary"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-summary-manifest-coverage"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-summary-design-ir-omissions"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-summary-mapped-count"),
    ).toHaveTextContent("Mapped: 2");
    expect(
      screen.getByTestId("inspector-summary-unmapped-count"),
    ).toHaveTextContent("Unmapped: 1");
    expect(
      screen.getByTestId("inspector-summary-total-count"),
    ).toHaveTextContent("Total IR nodes: 3");
    expect(
      screen.getByTestId("inspector-summary-mapped-percent"),
    ).toHaveTextContent("Coverage: 66.7%");
    expect(
      screen.getByTestId("inspector-summary-omission-skipped-hidden"),
    ).toHaveTextContent("Hidden nodes skipped: 2");
    expect(
      screen.getByTestId("inspector-summary-omission-truncated-by-budget"),
    ).toHaveTextContent("Nodes truncated by budget: 4");
    expect(
      screen.getByTestId("inspector-summary-aggregate-note"),
    ).toHaveTextContent(
      /Node-level diagnostics available|Aggregate-only summary/,
    );
  });

  it("shows manifest summary fallback when manifest data is unavailable", () => {
    installQueryMock({
      overrides: {
        "inspector-manifest": {
          data: {
            ok: false,
            status: 500,
            payload: {
              error: "INTERNAL_ERROR",
              message: "Injected manifest failure",
            },
          },
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-summary-manifest-unavailable"),
    ).toHaveTextContent("component manifest data is not ready");
  });

  it("shows omission summary fallback when generation metrics are unavailable", () => {
    installQueryMock({
      overrides: {
        "inspector-generation-metrics": {
          data: {
            ok: false,
            status: 404,
            payload: null,
            error: "GENERATION_METRICS_NOT_FOUND",
            message: "generation-metrics.json is unavailable for this job.",
          },
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-summary-omission-unavailable"),
    ).toHaveTextContent("omission counters are unavailable");
  });

  it("renders loading and empty design-ir states in the tree pane", () => {
    installQueryMock({
      overrides: {
        "inspector-design-ir": {
          data: undefined,
          isLoading: true,
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-design-ir-state-loading"),
    ).toHaveTextContent("Loading design IR");

    cleanup();
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    installMutationMock();
    installQueryMock({
      overrides: {
        "inspector-design-ir": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [],
            },
          },
          isLoading: false,
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-design-ir-state-empty"),
    ).toHaveTextContent("No component tree data is available for this job.");
  });

  it("ignores pipeline fallback nodes when they belong to a different job", () => {
    installQueryMock({
      overrides: {
        "inspector-design-ir": {
          data: undefined,
          isLoading: true,
        },
      },
    });

    renderInspectorPanel({
      pipeline: {
        stage: "generating",
        progress: 80,
        stageProgress: createInitialPipelineState().stageProgress,
        jobId: "job-other",
        designIR: {
          jobId: "job-other",
          screens: [
            {
              id: "screen-other",
              name: "Other Screen",
              children: [],
            },
          ],
        },
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    expect(
      screen.getByTestId("inspector-design-ir-state-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Other Screen")).not.toBeInTheDocument();
  });

  it("uses active pipeline IR, manifest, and files for streamed node selection", async () => {
    installQueryMock({
      overrides: {
        "inspector-files": {
          data: undefined,
          isLoading: true,
        },
        "inspector-manifest": {
          data: undefined,
          isLoading: true,
        },
        "inspector-design-ir": {
          data: undefined,
          isLoading: true,
        },
      },
    });

    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 80,
        jobId: "job-1",
        componentManifest: {
          jobId: "job-1",
          screens: [
            {
              screenId: "screen-stream",
              screenName: "Streaming Screen",
              file: "src/screens/StreamingScreen.tsx",
              components: [
                {
                  irNodeId: "node-stream",
                  irNodeName: "Streaming Card",
                  irNodeType: "card",
                  file: "src/components/StreamingCard.tsx",
                  startLine: 3,
                  endLine: 12,
                },
              ],
            },
          ],
        },
        designIR: {
          jobId: "job-1",
          screens: [
            {
              id: "screen-stream",
              name: "Streaming Screen",
              generatedFile: "src/screens/StreamingScreen.tsx",
              children: [
                {
                  id: "node-stream",
                  name: "Streaming Card",
                  type: "card",
                },
              ],
            },
          ],
        },
        generatedFiles: [
          { path: "src/screens/StreamingScreen.tsx", sizeBytes: 120 },
          { path: "src/components/StreamingCard.tsx", sizeBytes: 64 },
        ],
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    fireEvent.click(await screen.findByTestId("tree-node-node-stream"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-file-selector")).toHaveValue(
        "src/components/StreamingCard.tsx",
      );
    });
  });

  // ── Progressive file pane (issue #1006) ────────────────────────────────

  it("enables file selector when pipeline has generatedFiles and query is still loading", () => {
    installQueryMock({
      overrides: {
        "inspector-files": { data: undefined, isLoading: true },
        "inspector-manifest": { data: undefined, isLoading: true },
        "inspector-design-ir": { data: undefined, isLoading: true },
      },
    });

    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 60,
        jobId: "job-1",
        generatedFiles: [
          { path: "src/screens/Dashboard.tsx", sizeBytes: 300 },
          { path: "src/components/Card.tsx", sizeBytes: 180 },
        ],
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    // Selector must be enabled so the user can interact with progressively-
    // arriving files during the generating stage. (issue #1006)
    expect(screen.getByTestId("inspector-file-selector")).not.toBeDisabled();
  });

  it("auto-selects first code file from pipeline generatedFiles when query is not yet ready", () => {
    installQueryMock({
      overrides: {
        "inspector-files": { data: undefined, isLoading: true },
        "inspector-manifest": { data: undefined, isLoading: true },
        "inspector-design-ir": { data: undefined, isLoading: true },
      },
    });

    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 40,
        jobId: "job-1",
        generatedFiles: [
          { path: "src/theme/theme.ts", sizeBytes: 95 },
          { path: "src/screens/Profile.tsx", sizeBytes: 250 },
          { path: "src/App.tsx", sizeBytes: 120 },
        ],
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    // First code file should be auto-selected via defaultFile. (issue #1006)
    expect(screen.getByTestId("inspector-file-selector")).toHaveValue(
      "src/theme/theme.ts",
    );
  });

  it("keeps the first auto-selected file latched when later streamed files sort earlier", () => {
    installQueryMock({
      overrides: {
        "inspector-files": { data: undefined, isLoading: true },
        "inspector-manifest": { data: undefined, isLoading: true },
        "inspector-design-ir": { data: undefined, isLoading: true },
      },
    });

    const view = renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 30,
        jobId: "job-1",
        generatedFiles: [
          { path: "src/screens/Profile.tsx", sizeBytes: 250 },
          { path: "src/App.tsx", sizeBytes: 120 },
        ],
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    expect(screen.getByTestId("inspector-file-selector")).toHaveValue(
      "src/screens/Profile.tsx",
    );

    view.rerender(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
        pipeline: {
          ...createInitialPipelineState(),
          stage: "generating",
          progress: 55,
          jobId: "job-1",
          generatedFiles: [
            { path: "src/screens/Profile.tsx", sizeBytes: 250 },
            { path: "src/App.tsx", sizeBytes: 120 },
            { path: "src/components/AaaCard.tsx", sizeBytes: 160 },
          ],
          errors: [],
          canRetry: false,
          canCancel: true,
        },
      }),
    );

    expect(screen.getByTestId("inspector-file-selector")).toHaveValue(
      "src/screens/Profile.tsx",
    );
  });

  it("does not show loading-files indicator when pipeline generatedFiles override filesState", () => {
    installQueryMock({
      overrides: {
        "inspector-files": { data: undefined, isLoading: true },
      },
    });

    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 75,
        jobId: "job-1",
        generatedFiles: [{ path: "src/screens/Login.tsx", sizeBytes: 200 }],
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });

    // effectiveFilesState overrides loading→ready when pipeline files arrive,
    // so the "Loading generated files…" spinner must not appear. (issue #1006)
    expect(
      screen.queryByTestId("inspector-state-files-loading"),
    ).not.toBeInTheDocument();
  });

  it("does not override filesState to ready when pipeline generatedFiles is empty", () => {
    installQueryMock({
      overrides: {
        "inspector-files": { data: undefined, isLoading: true },
      },
    });
    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "generating",
        progress: 10,
        jobId: "job-1",
        generatedFiles: [], // empty — must NOT trigger effectiveFilesState override
        errors: [],
        canRetry: false,
        canCancel: true,
      },
    });
    // With 0 pipeline files, effectiveFilesState must not pretend "ready".
    // The loading indicator should still be visible.
    expect(
      screen.getByTestId("inspector-state-files-loading"),
    ).toBeInTheDocument();
  });

  it("keeps filesState empty when pipeline has no generatedFiles and query returns empty", () => {
    installQueryMock({
      overrides: {
        "inspector-files": {
          data: {
            ok: true,
            status: 200,
            payload: { jobId: "job-1", files: [] },
          },
          isLoading: false,
        },
      },
    });
    renderInspectorPanel({
      pipeline: createInitialPipelineState(),
    });
    // No pipeline files + empty query result → inspector shows empty state, not loading.
    expect(
      screen.queryByTestId("inspector-state-files-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-file-selector")).toBeDisabled();
  });

  it("does not override ready filesState when query already resolved", () => {
    installQueryMock({
      overrides: {
        "inspector-files": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              files: [
                { path: "src/App.tsx", sizeBytes: 100 },
                { path: "src/screens/Home.tsx", sizeBytes: 200 },
              ],
            },
          },
          isLoading: false,
        },
      },
    });
    renderInspectorPanel({
      pipeline: {
        ...createInitialPipelineState(),
        stage: "ready",
        generatedFiles: [{ path: "src/screens/OldFile.tsx", sizeBytes: 50 }],
      },
    });
    // filesState is "ready" (query resolved), so effectiveFilesState must not
    // replace it with the stale pipeline files. The selector should be enabled,
    // showing query-resolved files, not the pipeline list.
    expect(screen.getByTestId("inspector-file-selector")).not.toBeDisabled();
    // The pipeline file OldFile.tsx must NOT be the selector value —
    // the query-resolved App.tsx should take precedence.
    expect(screen.getByTestId("inspector-file-selector")).not.toHaveValue(
      "src/screens/OldFile.tsx",
    );
  });

  it("shows manifest empty warning when manifest payload has no screens", () => {
    installQueryMock({
      overrides: {
        "inspector-manifest": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [],
            },
          },
        },
      },
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    expect(
      screen.getByTestId("inspector-manifest-empty-warning"),
    ).toBeInTheDocument();
  });

  it("persists boundary toggle state and syncs boundary clicks to tree selection", async () => {
    installQueryMock({
      overrides: {
        "inspector-manifest": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [
                {
                  screenId: "screen-home",
                  screenName: "Home",
                  file: "src/screens/Home.tsx",
                  components: [
                    {
                      irNodeId: "node-1",
                      irNodeName: "Header",
                      irNodeType: "container",
                      file: "src/screens/Home.tsx",
                      startLine: 1,
                      endLine: 2,
                    },
                  ],
                },
              ],
            },
          },
        },
        "inspector-design-ir": {
          data: {
            ok: true,
            status: 200,
            payload: {
              jobId: "job-1",
              screens: [
                {
                  id: "screen-home",
                  name: "Home",
                  generatedFile: "src/screens/Home.tsx",
                  children: [
                    {
                      id: "node-1",
                      name: "Header",
                      type: "container",
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        },
        "inspector-file-content": {
          data: {
            ok: true,
            status: 200,
            content: "line1\\nline2\\nline3",
            error: null,
            message: null,
          },
        },
      },
    });

    const { unmount } = render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
      }),
    );

    const toggle = screen.getByTestId("code-viewer-boundaries-toggle");
    expect(toggle).toHaveTextContent("Boundaries: Off");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Boundaries: On");

    await waitFor(() => {
      expect(
        screen.getAllByTestId("code-boundary-marker-node-1").length,
      ).toBeGreaterThan(0);
    });

    const marker = screen.getAllByTestId("code-boundary-marker-node-1")[0];
    if (!marker) {
      throw new Error("Expected boundary marker.");
    }
    fireEvent.click(marker);

    await waitFor(() => {
      expect(screen.getByTestId("tree-node-node-1")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    unmount();

    renderInspectorPanel({ openDialog: "preApplyReview" });

    expect(
      screen.getByTestId("code-viewer-boundaries-toggle"),
    ).toHaveTextContent("Boundaries: On");
  });
});

describe("InspectorPanel Edit Studio", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    installMutationMock();
  });

  it("focuses the code viewer find input from the global shortcut while tree focus is active", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    const treeNode = screen.getByTestId("tree-node-node-editable");
    fireEvent.click(treeNode);
    treeNode.focus();

    const findInput = screen.getByTestId("code-viewer-find-input");
    expect(findInput).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    await waitFor(() => {
      expect(findInput).toHaveFocus();
    });
  });

  it("restores edit capability after exiting edit mode for the same selected node", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-enter-edit-mode")).toBeEnabled();
      expect(screen.getByTestId("inspector-edit-capability")).toHaveTextContent(
        /^Edit: \d+ fields$/,
      );
    });

    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("inspector-exit-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-enter-edit-mode")).toBeEnabled();
      expect(
        screen.queryByTestId("inspector-edit-studio-panel"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("inspector-edit-capability")).toHaveTextContent(
        /^Edit: \d+ fields$/,
      );
    });
  });

  it("renders scalar and layout controls in edit mode while keeping deferred fields hidden", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("inspector-edit-input-fillColor"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-opacity"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-fontSize"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-fontWeight"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-fontFamily"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-padding-top"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-gap")).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-layout-panel"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-width"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-height"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-layoutMode"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-primaryAxisAlignItems"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-input-counterAxisAlignItems"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("inspector-edit-input-x"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inspector-edit-input-maxWidth"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-v1-deferred-fields"),
    ).toHaveTextContent(
      "Deferred: x, y, minWidth, maxWidth, maxHeight, responsive breakpoints, and screen-root layout editing.",
    );
  });

  it("shows unsupported reasons and translator validation errors while keeping exact IR field names in payload", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides({ invalidPadding: true }),
    });

    renderInspectorPanel({ openDialog: "inspectability" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("inspector-edit-unsupported-padding"),
    ).toHaveTextContent("padding is present but has an unsupported shape.");

    const opacityInput = screen.getByTestId("inspector-edit-input-opacity");
    fireEvent.change(opacityInput, { target: { value: "1.5" } });
    fireEvent.blur(opacityInput);
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-error-opacity"),
      ).toHaveTextContent("opacity must be a finite number between 0 and 1.");
    });

    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#abc" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(
        screen.queryByTestId("inspector-edit-error-fillColor"),
      ).not.toBeInTheDocument();
    });

    const payloadText =
      screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
    expect(payloadText).toContain('"field": "fillColor"');
    expect(payloadText).toContain('"value": "#aabbcc"');
    expect(payloadText).not.toContain('"backgroundColor"');
  });

  it("updates layout fields, hides alignment controls for NONE, and keeps exact IR field names in payload", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    const widthInput = screen.getByTestId("inspector-edit-input-width");
    fireEvent.change(widthInput, { target: { value: "420" } });
    fireEvent.blur(widthInput);

    const layoutModeSelect = screen.getByTestId(
      "inspector-edit-input-layoutMode",
    );
    fireEvent.change(layoutModeSelect, { target: { value: "NONE" } });

    await waitFor(() => {
      expect(
        screen.queryByTestId("inspector-edit-input-primaryAxisAlignItems"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("inspector-edit-input-counterAxisAlignItems"),
      ).not.toBeInTheDocument();
    });

    const payloadText =
      screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
    expect(payloadText).toContain('"field": "width"');
    expect(payloadText).toContain('"field": "layoutMode"');
    expect(payloadText).toContain('"value": "NONE"');
  });

  it("applies padding override on blur and supports enter-to-commit for scalar and layout numeric fields", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    const paddingTopInput = screen.getByTestId(
      "inspector-edit-input-padding-top",
    );
    const paddingRightInput = screen.getByTestId(
      "inspector-edit-input-padding-right",
    );
    const paddingBottomInput = screen.getByTestId(
      "inspector-edit-input-padding-bottom",
    );
    const paddingLeftInput = screen.getByTestId(
      "inspector-edit-input-padding-left",
    );
    fireEvent.change(paddingTopInput, { target: { value: "20" } });
    fireEvent.change(paddingRightInput, { target: { value: "24" } });
    fireEvent.change(paddingBottomInput, { target: { value: "28" } });
    fireEvent.change(paddingLeftInput, { target: { value: "32" } });
    fireEvent.blur(paddingTopInput);

    await waitFor(() => {
      const payloadText =
        screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
      expect(payloadText).toContain('"field": "padding"');
      expect(payloadText).toContain('"top": 20');
      expect(payloadText).toContain('"right": 24');
      expect(payloadText).toContain('"bottom": 28');
      expect(payloadText).toContain('"left": 32');
    });

    const fontSizeInput = screen.getByTestId("inspector-edit-input-fontSize");
    fireEvent.change(fontSizeInput, { target: { value: "22" } });
    fireEvent.keyDown(fontSizeInput, { key: "Enter" });
    fireEvent.blur(fontSizeInput);

    const widthInput = screen.getByTestId("inspector-edit-input-width");
    fireEvent.change(widthInput, { target: { value: "480" } });
    fireEvent.keyDown(widthInput, { key: "Enter" });
    fireEvent.blur(widthInput);

    await waitFor(() => {
      const payloadText =
        screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
      expect(payloadText).toContain('"field": "fontSize"');
      expect(payloadText).toContain('"value": 22');
      expect(payloadText).toContain('"field": "width"');
      expect(payloadText).toContain('"value": 480');
    });

    expect(
      screen.getByTestId("inspector-edit-reset-padding"),
    ).toBeInTheDocument();
  });

  it("renders and updates form-validation controls when validation fields are present on the node", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides({
        nodeOverrides: {
          required: false,
          validationType: "email",
          validationMessage: "Initial message",
        },
      }),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-form-validation-panel"),
      ).toBeInTheDocument();
    });

    const requiredCheckbox = screen.getByTestId(
      "inspector-edit-input-required",
    );
    fireEvent.click(requiredCheckbox);
    await waitFor(() => {
      expect(screen.getByText("Yes")).toBeInTheDocument();
    });

    const validationTypeSelect = screen.getByTestId(
      "inspector-edit-input-validationType",
    );
    fireEvent.change(validationTypeSelect, { target: { value: "url" } });

    const validationMessageInput = screen.getAllByTestId(
      "inspector-edit-input-validationMessage",
    )[0];
    if (!validationMessageInput) {
      throw new Error("Expected at least one validation message input.");
    }
    fireEvent.change(validationMessageInput, {
      target: { value: "Needs a valid URL" },
    });
    fireEvent.keyDown(validationMessageInput, { key: "Enter" });
    fireEvent.blur(validationMessageInput);

    await waitFor(() => {
      const payloadText =
        screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
      expect(payloadText).toContain('"field": "required"');
      expect(payloadText).toContain('"field": "validationType"');
      expect(payloadText).toContain('"value": "url"');
      expect(payloadText).toContain('"field": "validationMessage"');
      expect(payloadText).toContain('"value": "Needs a valid URL"');
    });

    expect(
      screen.getByTestId("inspector-edit-reset-required"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-edit-reset-validationType"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("inspector-edit-reset-validationMessage").length,
    ).toBeGreaterThan(0);
  });

  it("restores persisted draft for matching fingerprint after remount", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    const { unmount } = render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
      }),
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });

    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#ff0000" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-payload-preview"),
      ).toHaveTextContent('"value": "#ff0000"');
    });

    unmount();

    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });
    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-input-fillColor")).toHaveValue(
        "#ff0000",
      );
    });
    expect(
      screen.getByTestId("inspector-edit-payload-preview"),
    ).toHaveTextContent('"field": "fillColor"');
  });

  it("flags stale persisted drafts and keeps edit studio usable", async () => {
    const staleDraft = upsertInspectorOverrideEntry({
      draft: createInspectorOverrideDraft({
        sourceJobId: "job-1",
        baseFingerprint: "fnv1a64:stale",
      }),
      nodeId: "node-editable",
      field: "fillColor",
      value: "#ffffff",
    });
    window.localStorage.setItem(
      toInspectorOverrideDraftStorageKey("job-1"),
      JSON.stringify(staleDraft),
    );

    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-draft-stale-warning"),
      ).toBeInTheDocument();
    });
    // Stale draft entries are preserved in memory so the user can review
    // them before deciding to continue, discard, or carry forward.
    expect(screen.getByTestId("inspector-edit-input-fillColor")).toHaveValue(
      "#ffffff",
    );
    expect(
      screen.getByTestId("inspector-edit-payload-preview"),
    ).toHaveTextContent('"field": "fillColor"');
  });
});

describe("InspectorPanel pre-apply review and regeneration", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    installMutationMock();
  });

  it("shows empty pre-apply review state when there are no pending overrides", () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    expect(
      screen.getByTestId("inspector-impact-review-panel"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-impact-review-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-impact-review-regenerate-button"),
    ).toBeDisabled();
  });

  it("renders grouped review summary with mapped and unmapped overrides from restored draft", async () => {
    const queryOverrides = editableNodeQueryOverrides();
    const designIrPayload = (
      queryOverrides["inspector-design-ir"]?.data as {
        payload?: { screens?: Array<Record<string, unknown>> };
      }
    ).payload;
    const screens = designIrPayload?.screens ?? [];
    const baseFingerprint = computeInspectorDraftBaseFingerprint({
      screens: screens as Array<{
        id: string;
        name: string;
        generatedFile?: string;
        children: Array<Record<string, unknown>>;
      }>,
    });

    let restoredDraft = createInspectorOverrideDraft({
      sourceJobId: "job-1",
      baseFingerprint,
    });
    restoredDraft = upsertInspectorOverrideEntry({
      draft: restoredDraft,
      nodeId: "node-editable",
      field: "fillColor",
      value: "#00aa44",
    });
    restoredDraft = upsertInspectorOverrideEntry({
      draft: restoredDraft,
      nodeId: "node-unmapped",
      field: "required",
      value: true,
    });
    window.localStorage.setItem(
      toInspectorOverrideDraftStorageKey("job-1"),
      JSON.stringify(restoredDraft),
    );

    installQueryMock({
      overrides: queryOverrides,
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-impact-review-summary"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("inspector-impact-review-summary-total"),
    ).toHaveTextContent("Total overrides: 2");
    expect(
      screen.getByTestId("inspector-impact-review-summary-files"),
    ).toHaveTextContent("Affected files: 1");
    expect(
      screen.getByTestId("inspector-impact-review-summary-unmapped"),
    ).toHaveTextContent("Unmapped overrides: 1");
    expect(
      screen.getByTestId("inspector-impact-review-summary-categories"),
    ).toHaveTextContent(
      "Categories: 1 visual, 0 layout, 1 validation, 0 other",
    );
    expect(
      screen.getByTestId("inspector-impact-review-file-list"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-impact-review-unmapped-list"),
    ).toBeInTheDocument();
  });

  it("shows layout blast radius callout when pending overrides include layout fields", async () => {
    const queryOverrides = editableNodeQueryOverrides();
    const designIrPayload = (
      queryOverrides["inspector-design-ir"]?.data as {
        payload?: { screens?: Array<Record<string, unknown>> };
      }
    ).payload;
    const screens = designIrPayload?.screens ?? [];
    const baseFingerprint = computeInspectorDraftBaseFingerprint({
      screens: screens as Array<{
        id: string;
        name: string;
        generatedFile?: string;
        children: Array<Record<string, unknown>>;
      }>,
    });

    let restoredDraft = createInspectorOverrideDraft({
      sourceJobId: "job-1",
      baseFingerprint,
    });
    restoredDraft = upsertInspectorOverrideEntry({
      draft: restoredDraft,
      nodeId: "node-editable",
      field: "width",
      value: 420,
    });

    window.localStorage.setItem(
      toInspectorOverrideDraftStorageKey("job-1"),
      JSON.stringify(restoredDraft),
    );

    installQueryMock({
      overrides: queryOverrides,
    });

    renderInspectorPanel({ openDialog: "preApplyReview" });

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-impact-review-summary"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("inspector-impact-review-summary-categories"),
    ).toHaveTextContent(
      "Categories: 0 visual, 1 layout, 0 validation, 0 other",
    );
    expect(
      screen.getByTestId("inspector-impact-review-layout-risk"),
    ).toBeInTheDocument();
  });

  it("submits regeneration and invokes parent handoff callback with accepted job id", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });
    const onRegenerationAccepted = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-regen-accepted",
          sourceJobId: "job-1",
          status: "queued",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    renderInspectorPanel({
      openDialog: "preApplyReview",
      onRegenerationAccepted,
    });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });
    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#aa2255" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-impact-review-regenerate-button"),
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByTestId("inspector-impact-review-regenerate-button"),
    );

    await waitFor(() => {
      expect(onRegenerationAccepted).toHaveBeenCalledWith("job-regen-accepted");
    });
    expect(
      screen.getByTestId("inspector-impact-review-regeneration-accepted"),
    ).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    const requestBody =
      typeof firstCall?.[1]?.body === "string"
        ? (JSON.parse(firstCall[1].body) as Record<string, unknown>)
        : {};
    expect(requestBody).toHaveProperty("overrides");
    expect(requestBody).toHaveProperty("draftId");
    expect(requestBody).toHaveProperty("baseFingerprint");

    fetchSpy.mockRestore();
  });

  it("renders regeneration errors from API response payload", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides(),
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "REGEN_INVALID_OVERRIDE",
          message: "Override payload is invalid.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    renderInspectorPanel({ openDialog: "preApplyReview" });

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-edit-studio-panel"),
      ).toBeInTheDocument();
    });
    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#117799" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-impact-review-regenerate-button"),
      ).toBeEnabled();
    });

    fireEvent.click(
      screen.getByTestId("inspector-impact-review-regenerate-button"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-impact-review-regeneration-error"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("inspector-impact-review-regeneration-error"),
    ).toHaveTextContent("REGEN_INVALID_OVERRIDE");

    fetchSpy.mockRestore();
  });
});

describe("InspectorPanel local sync", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    installQueryMock();
    installMutationMock();
  });

  it("previews local sync and requires explicit confirmation before apply", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const rawBody = typeof init?.body === "string" ? init.body : "{}";
        const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
        if (parsedBody.mode === "dry_run") {
          return new Response(
            JSON.stringify({
              jobId: "job-1",
              sourceJobId: "job-source-1",
              boardKey: "board-abc",
              targetPath: "sync-target",
              scopePath: "sync-target/board-abc",
              destinationRoot: "/tmp/workspace/sync-target/board-abc",
              files: [
                {
                  path: "src/screens/Home.tsx",
                  action: "overwrite",
                  status: "overwrite",
                  reason: "managed_destination_unchanged",
                  decision: "write",
                  selectedByDefault: true,
                  sizeBytes: 123,
                  message:
                    "Destination matches the last synced baseline and can be overwritten safely.",
                },
                {
                  path: "package.json",
                  action: "create",
                  status: "create",
                  reason: "new_file",
                  decision: "write",
                  selectedByDefault: true,
                  sizeBytes: 64,
                  message: "File will be created in the destination tree.",
                },
                {
                  path: "src/legacy.tsx",
                  action: "overwrite",
                  status: "conflict",
                  reason: "destination_modified_since_sync",
                  decision: "skip",
                  selectedByDefault: false,
                  sizeBytes: 88,
                  message:
                    "Destination was modified after the last sync. Review before overwriting it.",
                },
              ],
              summary: {
                totalFiles: 3,
                selectedFiles: 2,
                createCount: 1,
                overwriteCount: 1,
                conflictCount: 1,
                untrackedCount: 0,
                unchangedCount: 0,
                totalBytes: 275,
                selectedBytes: 187,
              },
              confirmationToken: "token-123",
              confirmationExpiresAt: "2026-03-22T12:00:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (parsedBody.mode === "apply") {
          expect(parsedBody.confirmationToken).toBe("token-123");
          expect(parsedBody.confirmOverwrite).toBe(true);
          expect(parsedBody.fileDecisions).toEqual([
            { path: "src/screens/Home.tsx", decision: "write" },
            { path: "package.json", decision: "write" },
            { path: "src/legacy.tsx", decision: "write" },
          ]);
          return new Response(
            JSON.stringify({
              jobId: "job-1",
              sourceJobId: "job-source-1",
              boardKey: "board-abc",
              targetPath: "sync-target",
              scopePath: "sync-target/board-abc",
              destinationRoot: "/tmp/workspace/sync-target/board-abc",
              files: [
                {
                  path: "src/screens/Home.tsx",
                  action: "overwrite",
                  status: "overwrite",
                  reason: "managed_destination_unchanged",
                  decision: "write",
                  selectedByDefault: true,
                  sizeBytes: 123,
                  message:
                    "Destination matches the last synced baseline and can be overwritten safely.",
                },
                {
                  path: "package.json",
                  action: "create",
                  status: "create",
                  reason: "new_file",
                  decision: "write",
                  selectedByDefault: true,
                  sizeBytes: 64,
                  message: "File will be created in the destination tree.",
                },
                {
                  path: "src/legacy.tsx",
                  action: "overwrite",
                  status: "conflict",
                  reason: "destination_modified_since_sync",
                  decision: "write",
                  selectedByDefault: false,
                  sizeBytes: 88,
                  message:
                    "Destination was modified after the last sync. Review before overwriting it.",
                },
              ],
              summary: {
                totalFiles: 3,
                selectedFiles: 3,
                createCount: 1,
                overwriteCount: 1,
                conflictCount: 1,
                untrackedCount: 0,
                unchangedCount: 0,
                totalBytes: 275,
                selectedBytes: 275,
              },
              appliedAt: "2026-03-22T12:05:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ error: "UNEXPECTED" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      });

    renderInspectorPanel({
      openDialog: "localSync",
      isRegenerationJob: true,
    });

    const applyButton = screen.getByTestId("inspector-sync-apply-button");
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("inspector-sync-preview-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("inspector-sync-preview-summary"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("inspector-sync-preview-summary"),
    ).toHaveTextContent(
      "Files: 3 total, 1 create, 1 managed overwrite, 1 conflict, 0 untracked, 0 unchanged",
    );
    expect(
      screen.getByTestId("inspector-sync-selected-summary"),
    ).toHaveTextContent("Selected: 2 files");
    expect(
      screen.getByTestId("inspector-sync-attention-banner"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("inspector-sync-file-toggle-2"));
    expect(
      screen.getByTestId("inspector-sync-selected-summary"),
    ).toHaveTextContent("Selected: 3 files");
    fireEvent.click(screen.getByTestId("inspector-sync-confirm-overwrite"));
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("inspector-sync-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-sync-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-sync-success")).toHaveTextContent(
      "Wrote 3 files",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });

  it("keeps sync controls disabled with explicit hint for non-regeneration jobs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderInspectorPanel({ openDialog: "localSync" });

    expect(
      screen.getByTestId("inspector-sync-regeneration-required"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-sync-preview-button")).toBeDisabled();
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeDisabled();
    expect(
      screen.getByTestId("inspector-sync-confirm-overwrite"),
    ).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("renders sync error details when preview endpoint fails for regeneration jobs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "SYNC_REGEN_REQUIRED",
          message: "Local sync is only available for regeneration jobs.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    renderInspectorPanel({
      openDialog: "localSync",
      isRegenerationJob: true,
    });

    fireEvent.click(screen.getByTestId("inspector-sync-preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-sync-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-sync-error")).toHaveTextContent(
      "SYNC_REGEN_REQUIRED",
    );
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeDisabled();

    fetchSpy.mockRestore();
  });
});

describe("InspectorPanel create PR", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    installQueryMock();
    installMutationMock();
  });

  it("shows non-regeneration hint and keeps PR action disabled", () => {
    renderInspectorPanel({ openDialog: "createPr" });

    expect(
      screen.getByTestId("inspector-pr-regeneration-required"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-pr-create-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("inspector-pr-repo-url"), {
      target: { value: "https://github.com/acme/repo" },
    });
    fireEvent.change(screen.getByTestId("inspector-pr-repo-token"), {
      target: { value: "ghp_token" },
    });
    expect(screen.getByTestId("inspector-pr-create-button")).toBeDisabled();
  });

  it("creates PR for regeneration jobs when prerequisites are provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-regen-1",
          sourceJobId: "job-1",
          gitPr: {
            status: "executed",
            prUrl: "https://github.com/acme/repo/pull/42",
            branchName: "auto/figma/board",
            scopePath: "generated/board",
            changedFiles: ["src/screens/Home.tsx"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderInspectorPanel({
      jobId: "job-regen-1",
      previewUrl: "/workspace/repros/job-regen-1/",
      openDialog: "createPr",
      isRegenerationJob: true,
    });

    fireEvent.change(screen.getByTestId("inspector-pr-repo-url"), {
      target: { value: "https://github.com/acme/repo" },
    });
    fireEvent.change(screen.getByTestId("inspector-pr-repo-token"), {
      target: { value: "ghp_token" },
    });
    fireEvent.click(screen.getByTestId("inspector-pr-create-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-pr-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-pr-url-link")).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });
});
