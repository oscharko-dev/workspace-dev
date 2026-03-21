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
    mockUseQuery.mockImplementation((input: { queryKey?: unknown[] }) => {
      const key = Array.isArray(input.queryKey) ? input.queryKey[0] : "";

      if (key === "inspector-files") {
        return {
          data: {
            ok: true,
            payload: {
              jobId: "job-1",
              files: [{ path: "src/screens/Home.tsx", sizeBytes: 123 }]
            }
          },
          isLoading: false
        };
      }

      if (key === "inspector-manifest") {
        return {
          data: {
            ok: true,
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
          isLoading: false
        };
      }

      if (key === "inspector-design-ir") {
        return {
          data: {
            ok: true,
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
          isLoading: false
        };
      }

      if (key === "inspector-file-content") {
        return {
          data: "export default function Home() { return null; }",
          isLoading: false
        };
      }

      return {
        data: undefined,
        isLoading: false
      };
    });
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
