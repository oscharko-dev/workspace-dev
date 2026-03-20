/**
 * Unit tests for CodeViewer component.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/384
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { CodeViewer } from "./CodeViewer";
import * as shikiLib from "../../../lib/shiki";

// ---------------------------------------------------------------------------
// Mock shiki lib to avoid loading WASM in unit tests
// ---------------------------------------------------------------------------

vi.mock("../../../lib/shiki", () => ({
  highlightCode: vi.fn(),
  exceedsMaxSize: vi.fn().mockReturnValue(false),
  getPreferredTheme: vi.fn().mockReturnValue("github-light")
}));

const mockHighlightCode = vi.mocked(shikiLib.highlightCode);
const mockExceedsMaxSize = vi.mocked(shikiLib.exceedsMaxSize);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExceedsMaxSize.mockReturnValue(false);

  // jsdom does not implement matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodeViewer", () => {
  it("renders line numbers in gutter", async () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3",
        filePath: "src/App.tsx"
      })
    );

    await waitFor(() => {
      const lineNumbers = screen.getAllByTestId("line-number");
      expect(lineNumbers).toHaveLength(3);
      expect(lineNumbers[0]).toHaveTextContent("1");
      expect(lineNumbers[1]).toHaveTextContent("2");
      expect(lineNumbers[2]).toHaveTextContent("3");
    });
  });

  it("renders file path in header", () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/screens/Home.tsx"
      })
    );

    expect(screen.getByTestId("code-viewer-filepath")).toHaveTextContent("src/screens/Home.tsx");
  });

  it("highlights specified line range", async () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3\nline4\nline5",
        filePath: "src/App.tsx",
        highlightRange: { startLine: 2, endLine: 4 }
      })
    );

    await waitFor(() => {
      const highlighted = screen.getAllByTestId("highlighted-line");
      expect(highlighted).toHaveLength(3);
    });
  });

  it("shows oversize warning for files > 500 KB", () => {
    mockExceedsMaxSize.mockReturnValue(true);
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "x".repeat(600_000),
        filePath: "big-file.tsx"
      })
    );

    expect(screen.getByTestId("code-viewer-oversize-warning")).toHaveTextContent(
      "File exceeds 500 KB"
    );
  });

  it("renders highlighted HTML when Shiki returns a result", async () => {
    mockHighlightCode.mockResolvedValue({
      html: '<pre class="shiki github-light" style="background-color:#fff"><code><span class="line"><span style="color:#CF222E">import</span></span>\n<span class="line"><span style="color:#0550AE">React</span></span></code></pre>',
      theme: "github-light"
    });

    render(
      createElement(CodeViewer, {
        code: "import\nReact",
        filePath: "src/App.tsx"
      })
    );

    await waitFor(() => {
      const codeContent = screen.getByTestId("code-content");
      // Should have highlighted spans (innerHTML contains style attributes)
      expect(codeContent.innerHTML).toContain("color:");
    });
  });

  it("toggles word wrap", async () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/App.tsx"
      })
    );

    const wrapBtn = screen.getByTestId("code-viewer-wrap-toggle");
    expect(wrapBtn).toHaveTextContent("Wrap: Off");

    fireEvent.click(wrapBtn);
    expect(wrapBtn).toHaveTextContent("Wrap: On");

    fireEvent.click(wrapBtn);
    expect(wrapBtn).toHaveTextContent("Wrap: Off");
  });

  it("copy button is present and labeled correctly", () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/App.tsx"
      })
    );

    const copyBtn = screen.getByTestId("inspector-copy-button");
    expect(copyBtn).toHaveTextContent("Copy");
  });

  it("copy button shows 'Copy Range' when highlight range is set", () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3",
        filePath: "src/App.tsx",
        highlightRange: { startLine: 1, endLine: 2 }
      })
    );

    const copyBtn = screen.getByTestId("inspector-copy-button");
    expect(copyBtn).toHaveTextContent("Copy Range");
  });

  it("falls back to plain text when no highlight result", async () => {
    mockHighlightCode.mockResolvedValue(null);

    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/unknown.xyz"
      })
    );

    await waitFor(() => {
      const codeContent = screen.getByTestId("code-content");
      expect(codeContent).toHaveTextContent("const x = 1;");
    });
  });
});
