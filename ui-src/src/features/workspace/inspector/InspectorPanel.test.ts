import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";
import {
  computeInspectorDraftBaseFingerprint,
  createInspectorOverrideDraft,
  toInspectorOverrideDraftStorageKey,
  upsertInspectorOverrideEntry
} from "./inspector-override-draft";

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock("@tanstack/react-query", () => {
  return {
    useQuery: (args: unknown) => mockUseQuery(args),
    useMutation: (args: unknown) => mockUseMutation(args)
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
          files: [{ path: "src/screens/Home.tsx", sizeBytes: 123 }]
        }
      },
      isLoading: false,
      refetch: vi.fn()
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
              components: []
            }
          ]
        }
      },
      isLoading: false,
      refetch: vi.fn()
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
              children: []
            }
          ]
        }
      },
      isLoading: false,
      refetch: vi.fn()
    },
    "inspector-file-content": {
      data: {
        ok: true,
        status: 200,
        content: "export default function Home() { return null; }",
        error: null,
        message: null
      },
      isLoading: false,
      refetch: vi.fn()
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
              retainedElements: 7
            }
          ],
          depthTruncatedScreens: [{ truncatedBranchCount: 2 }],
          classificationFallbacks: [{ nodeId: "node-1" }],
          degradedGeometryNodes: ["1:1"]
        },
        error: null,
        message: null
      },
      isLoading: false,
      refetch: vi.fn()
    }
  };
}

function installQueryMock({
  overrides
}: {
  overrides?: Partial<Record<MockQueryKey, Partial<MockQueryResult>>>;
} = {}): Record<MockQueryKey, MockQueryResult> {
  const base = createDefaultQueryResults();
  const merged = {
    "inspector-files": { ...base["inspector-files"], ...(overrides?.["inspector-files"] ?? {}) },
    "inspector-manifest": { ...base["inspector-manifest"], ...(overrides?.["inspector-manifest"] ?? {}) },
    "inspector-design-ir": { ...base["inspector-design-ir"], ...(overrides?.["inspector-design-ir"] ?? {}) },
    "inspector-file-content": { ...base["inspector-file-content"], ...(overrides?.["inspector-file-content"] ?? {}) },
    "inspector-generation-metrics": {
      ...base["inspector-generation-metrics"],
      ...(overrides?.["inspector-generation-metrics"] ?? {})
    }
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
      refetch: vi.fn()
    };
  });

  return merged;
}

function installMutationMock(): void {
  mockUseMutation.mockImplementation((options: {
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
      }
    };
  });
}

function editableNodeQueryOverrides({
  invalidPadding = false
}: {
  invalidPadding?: boolean;
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
                  irNodeType: "text",
                  file: "src/screens/Home.tsx",
                  startLine: 1,
                  endLine: 6
                }
              ]
            }
          ]
        }
      }
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
                  type: "text",
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
                        left: 10
                      },
                  gap: 12,
                  width: 360,
                  height: 48,
                  layoutMode: "row",
                  children: []
                }
              ]
            }
          ]
        }
      }
    }
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
      dispatchEvent: vi.fn()
    };
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: matchMediaMock
  });
});

describe("InspectorPanel splitters", () => {
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

  it("supports keyboard resizing on the preview-code separator", () => {
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    const separator = screen.getByTestId("inspector-splitter-preview-code");
    expect(separator).toHaveAttribute("role", "separator");

    const before = Number(separator.getAttribute("aria-valuenow"));
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    const after = Number(separator.getAttribute("aria-valuenow"));

    expect(after).toBeGreaterThan(before);
  });

  it("renders two interactive separators when tree is expanded", () => {
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-splitter-tree-preview")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-splitter-preview-code")).toBeInTheDocument();
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
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

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
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

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
      expect(screen.queryByTestId("breadcrumb-scope-badge")).not.toBeInTheDocument();
    });
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
              message: "Design IR artifact is unavailable."
            }
          },
          refetch: designIrRefetch
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-source-design-ir-error")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-design-ir-state-error")).toBeInTheDocument();
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
              message: "Failed to parse component manifest."
            }
          },
          refetch: manifestRefetch
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-source-component-manifest-error")).toBeInTheDocument();
    expect(screen.getByTestId("component-tree")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-error-component-manifest")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("inspector-banner-retry-component-manifest"));
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
            message: "File 'src/screens/Home.tsx' not found."
          },
          refetch: fileContentRefetch
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-source-file-content-error")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-state-file-content-error")).toBeInTheDocument();

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
                      children: []
                    },
                    {
                      id: "node-b",
                      name: "B",
                      type: "text",
                      children: []
                    }
                  ]
                }
              ]
            }
          }
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
                      endLine: 4
                    }
                  ]
                }
              ]
            }
          }
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
              degradedGeometryNodes: ["1:1"]
            },
            error: null,
            message: null
          }
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-inspectability-summary")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-summary-manifest-coverage")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-summary-design-ir-omissions")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-summary-mapped-count")).toHaveTextContent("Mapped: 2");
    expect(screen.getByTestId("inspector-summary-unmapped-count")).toHaveTextContent("Unmapped: 1");
    expect(screen.getByTestId("inspector-summary-total-count")).toHaveTextContent("Total IR nodes: 3");
    expect(screen.getByTestId("inspector-summary-mapped-percent")).toHaveTextContent("Coverage: 66.7%");
    expect(screen.getByTestId("inspector-summary-omission-skipped-hidden")).toHaveTextContent(
      "Hidden nodes skipped: 2"
    );
    expect(screen.getByTestId("inspector-summary-omission-truncated-by-budget")).toHaveTextContent(
      "Nodes truncated by budget: 4"
    );
    expect(screen.getByTestId("inspector-summary-aggregate-note")).toHaveTextContent(/Node-level diagnostics available|Aggregate-only summary/);
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
              message: "Injected manifest failure"
            }
          }
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-summary-manifest-unavailable")).toHaveTextContent(
      "component manifest data is not ready"
    );
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
            message: "generation-metrics.json is unavailable for this job."
          }
        }
      }
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-summary-omission-unavailable")).toHaveTextContent(
      "omission counters are unavailable"
    );
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
                      endLine: 2
                    }
                  ]
                }
              ]
            }
          }
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
                      children: []
                    }
                  ]
                }
              ]
            }
          }
        },
        "inspector-file-content": {
          data: {
            ok: true,
            status: 200,
            content: "line1\\nline2\\nline3",
            error: null,
            message: null
          }
        }
      }
    });

    const { unmount } = render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    const toggle = screen.getByTestId("code-viewer-boundaries-toggle");
    expect(toggle).toHaveTextContent("Boundaries: Off");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Boundaries: On");

    await waitFor(() => {
      expect(screen.getAllByTestId("code-boundary-marker-node-1").length).toBeGreaterThan(0);
    });

    const marker = screen.getAllByTestId("code-boundary-marker-node-1")[0];
    if (!marker) {
      throw new Error("Expected boundary marker.");
    }
    fireEvent.click(marker);

    await waitFor(() => {
      expect(screen.getByTestId("tree-node-node-1")).toHaveAttribute("aria-selected", "true");
    });

    unmount();

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("code-viewer-boundaries-toggle")).toHaveTextContent("Boundaries: On");
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

  it("renders scalar controls in edit mode and excludes deferred fields", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-studio-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("inspector-edit-input-fillColor")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-opacity")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-fontSize")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-fontWeight")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-fontFamily")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-padding-top")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-input-gap")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-edit-input-width")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inspector-edit-input-height")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inspector-edit-input-layoutMode")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspector-edit-v1-deferred-fields")).toHaveTextContent(
      "Deferred in v1: width, height, layoutMode."
    );
  });

  it("shows unsupported reasons and translator validation errors while keeping exact IR field names in payload", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides({ invalidPadding: true })
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-studio-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("inspector-edit-unsupported-padding")).toHaveTextContent(
      "padding is present but has an unsupported shape."
    );

    const opacityInput = screen.getByTestId("inspector-edit-input-opacity");
    fireEvent.change(opacityInput, { target: { value: "1.5" } });
    fireEvent.blur(opacityInput);
    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-error-opacity")).toHaveTextContent(
        "opacity must be a finite number between 0 and 1."
      );
    });

    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#abc" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(screen.queryByTestId("inspector-edit-error-fillColor")).not.toBeInTheDocument();
    });

    const payloadText = screen.getByTestId("inspector-edit-payload-preview").textContent ?? "";
    expect(payloadText).toContain("\"field\": \"fillColor\"");
    expect(payloadText).toContain("\"value\": \"#aabbcc\"");
    expect(payloadText).not.toContain("\"backgroundColor\"");
  });

  it("restores persisted draft for matching fingerprint after remount", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });

    const { unmount } = render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-studio-panel")).toBeInTheDocument();
    });

    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#ff0000" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-payload-preview")).toHaveTextContent("\"value\": \"#ff0000\"");
    });

    unmount();

    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-input-fillColor")).toHaveValue("#ff0000");
    });
    expect(screen.getByTestId("inspector-edit-payload-preview")).toHaveTextContent("\"field\": \"fillColor\"");
  });

  it("flags stale persisted drafts and keeps edit studio usable", async () => {
    const staleDraft = upsertInspectorOverrideEntry({
      draft: createInspectorOverrideDraft({
        sourceJobId: "job-1",
        baseFingerprint: "fnv1a64:stale"
      }),
      nodeId: "node-editable",
      field: "fillColor",
      value: "#ffffff"
    });
    window.localStorage.setItem(
      toInspectorOverrideDraftStorageKey("job-1"),
      JSON.stringify(staleDraft)
    );

    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-draft-stale-warning")).toBeInTheDocument();
    });
    // Stale draft entries are preserved in memory so the user can review
    // them before deciding to continue, discard, or carry forward.
    expect(screen.getByTestId("inspector-edit-input-fillColor")).toHaveValue("#ffffff");
    expect(screen.getByTestId("inspector-edit-payload-preview")).toHaveTextContent("\"field\": \"fillColor\"");
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
      overrides: editableNodeQueryOverrides()
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-impact-review-panel")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-impact-review-empty")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-impact-review-regenerate-button")).toBeDisabled();
  });

  it("renders grouped review summary with mapped and unmapped overrides from restored draft", async () => {
    const queryOverrides = editableNodeQueryOverrides();
    const designIrPayload = (queryOverrides["inspector-design-ir"]?.data as {
      payload?: { screens?: Array<Record<string, unknown>> };
    }).payload;
    const screens = designIrPayload?.screens ?? [];
    const baseFingerprint = computeInspectorDraftBaseFingerprint({
      screens: screens as Array<{
        id: string;
        name: string;
        generatedFile?: string;
        children: Array<Record<string, unknown>>;
      }>
    });

    let restoredDraft = createInspectorOverrideDraft({
      sourceJobId: "job-1",
      baseFingerprint
    });
    restoredDraft = upsertInspectorOverrideEntry({
      draft: restoredDraft,
      nodeId: "node-editable",
      field: "fillColor",
      value: "#00aa44"
    });
    restoredDraft = upsertInspectorOverrideEntry({
      draft: restoredDraft,
      nodeId: "node-unmapped",
      field: "required",
      value: true
    });
    window.localStorage.setItem(
      toInspectorOverrideDraftStorageKey("job-1"),
      JSON.stringify(restoredDraft)
    );

    installQueryMock({
      overrides: queryOverrides
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("inspector-impact-review-summary")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-impact-review-summary-total")).toHaveTextContent("Total overrides: 2");
    expect(screen.getByTestId("inspector-impact-review-summary-files")).toHaveTextContent("Affected files: 1");
    expect(screen.getByTestId("inspector-impact-review-summary-unmapped")).toHaveTextContent("Unmapped overrides: 1");
    expect(screen.getByTestId("inspector-impact-review-summary-categories")).toHaveTextContent(
      "Categories: 1 visual, 1 validation, 0 other"
    );
    expect(screen.getByTestId("inspector-impact-review-file-list")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-impact-review-unmapped-list")).toBeInTheDocument();
  });

  it("submits regeneration and invokes parent handoff callback with accepted job id", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });
    const onRegenerationAccepted = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-regen-accepted",
          sourceJobId: "job-1",
          status: "queued"
        }),
        { status: 202, headers: { "content-type": "application/json" } }
      )
    );

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
        onRegenerationAccepted
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-studio-panel")).toBeInTheDocument();
    });
    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#aa2255" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(screen.getByTestId("inspector-impact-review-regenerate-button")).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("inspector-impact-review-regenerate-button"));

    await waitFor(() => {
      expect(onRegenerationAccepted).toHaveBeenCalledWith("job-regen-accepted");
    });
    expect(screen.getByTestId("inspector-impact-review-regeneration-accepted")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    const requestBody = typeof firstCall?.[1]?.body === "string"
      ? JSON.parse(firstCall[1].body) as Record<string, unknown>
      : {};
    expect(requestBody).toHaveProperty("overrides");
    expect(requestBody).toHaveProperty("draftId");
    expect(requestBody).toHaveProperty("baseFingerprint");

    fetchSpy.mockRestore();
  });

  it("renders regeneration errors from API response payload", async () => {
    installQueryMock({
      overrides: editableNodeQueryOverrides()
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "REGEN_INVALID_OVERRIDE",
          message: "Override payload is invalid."
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    fireEvent.click(screen.getByTestId("tree-node-node-editable"));
    fireEvent.click(screen.getByTestId("inspector-enter-edit-mode"));
    await waitFor(() => {
      expect(screen.getByTestId("inspector-edit-studio-panel")).toBeInTheDocument();
    });
    const fillColorInput = screen.getByTestId("inspector-edit-input-fillColor");
    fireEvent.change(fillColorInput, { target: { value: "#117799" } });
    fireEvent.blur(fillColorInput);
    await waitFor(() => {
      expect(screen.getByTestId("inspector-impact-review-regenerate-button")).toBeEnabled();
    });

    fireEvent.click(screen.getByTestId("inspector-impact-review-regenerate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-impact-review-regeneration-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-impact-review-regeneration-error")).toHaveTextContent(
      "REGEN_INVALID_OVERRIDE"
    );

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
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
              { path: "src/screens/Home.tsx", action: "overwrite", sizeBytes: 123 },
              { path: "package.json", action: "create", sizeBytes: 64 }
            ],
            summary: {
              totalFiles: 2,
              createCount: 1,
              overwriteCount: 1,
              totalBytes: 187
            },
            confirmationToken: "token-123",
            confirmationExpiresAt: "2026-03-22T12:00:00.000Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (parsedBody.mode === "apply") {
        expect(parsedBody.confirmationToken).toBe("token-123");
        expect(parsedBody.confirmOverwrite).toBe(true);
        return new Response(
          JSON.stringify({
            jobId: "job-1",
            sourceJobId: "job-source-1",
            boardKey: "board-abc",
            targetPath: "sync-target",
            scopePath: "sync-target/board-abc",
            destinationRoot: "/tmp/workspace/sync-target/board-abc",
            files: [
              { path: "src/screens/Home.tsx", action: "overwrite", sizeBytes: 123 },
              { path: "package.json", action: "create", sizeBytes: 64 }
            ],
            summary: {
              totalFiles: 2,
              createCount: 1,
              overwriteCount: 1,
              totalBytes: 187
            },
            appliedAt: "2026-03-22T12:05:00.000Z"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: "UNEXPECTED" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    });

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
        isRegenerationJob: true
      })
    );

    const applyButton = screen.getByTestId("inspector-sync-apply-button");
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("inspector-sync-preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-sync-preview-summary")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-sync-preview-summary")).toHaveTextContent(
      "Files: 2 total, 1 create, 1 overwrite"
    );
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("inspector-sync-confirm-overwrite"));
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeEnabled();
    fireEvent.click(screen.getByTestId("inspector-sync-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-sync-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-sync-success")).toHaveTextContent("Wrote 2 files");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });

  it("keeps sync controls disabled with explicit hint for non-regeneration jobs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-sync-regeneration-required")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-sync-preview-button")).toBeDisabled();
    expect(screen.getByTestId("inspector-sync-apply-button")).toBeDisabled();
    expect(screen.getByTestId("inspector-sync-confirm-overwrite")).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("renders sync error details when preview endpoint fails for regeneration jobs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "SYNC_REGEN_REQUIRED",
          message: "Local sync is only available for regeneration jobs."
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );

    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/",
        isRegenerationJob: true
      })
    );

    fireEvent.click(screen.getByTestId("inspector-sync-preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-sync-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-sync-error")).toHaveTextContent("SYNC_REGEN_REQUIRED");
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
    render(
      createElement(InspectorPanel, {
        jobId: "job-1",
        previewUrl: "/workspace/repros/job-1/"
      })
    );

    expect(screen.getByTestId("inspector-pr-regeneration-required")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-pr-create-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("inspector-pr-repo-url"), {
      target: { value: "https://github.com/acme/repo" }
    });
    fireEvent.change(screen.getByTestId("inspector-pr-repo-token"), {
      target: { value: "ghp_token" }
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
            changedFiles: ["src/screens/Home.tsx"]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    render(
      createElement(InspectorPanel, {
        jobId: "job-regen-1",
        previewUrl: "/workspace/repros/job-regen-1/",
        isRegenerationJob: true
      })
    );

    fireEvent.change(screen.getByTestId("inspector-pr-repo-url"), {
      target: { value: "https://github.com/acme/repo" }
    });
    fireEvent.change(screen.getByTestId("inspector-pr-repo-token"), {
      target: { value: "ghp_token" }
    });
    fireEvent.click(screen.getByTestId("inspector-pr-create-button"));

    await waitFor(() => {
      expect(screen.getByTestId("inspector-pr-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("inspector-pr-url-link")).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });
});
