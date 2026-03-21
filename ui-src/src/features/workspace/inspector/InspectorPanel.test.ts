import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => {
  return {
    useQuery: (args: unknown) => mockUseQuery(args)
  };
});

type MockQueryKey =
  | "inspector-files"
  | "inspector-manifest"
  | "inspector-design-ir"
  | "inspector-file-content";

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
    "inspector-file-content": { ...base["inspector-file-content"], ...(overrides?.["inspector-file-content"] ?? {}) }
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

    return {
      data: undefined,
      isLoading: false,
      refetch: vi.fn()
    };
  });

  return merged;
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
    installQueryMock();
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

describe("InspectorPanel data states", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUseQuery.mockReset();
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
});
