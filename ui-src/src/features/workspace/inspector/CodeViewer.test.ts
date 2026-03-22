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
import * as workerClientLib from "../../../lib/shiki-worker-client";

// ---------------------------------------------------------------------------
// Mock shiki lib to avoid loading WASM in unit tests
// ---------------------------------------------------------------------------

vi.mock("../../../lib/shiki", () => ({
  exceedsMaxSize: vi.fn().mockReturnValue(false),
  getPreferredTheme: vi.fn().mockReturnValue("github-light")
}));
vi.mock("../../../lib/shiki-worker-client", () => ({
  highlightCodeWithWorker: vi.fn(),
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === "AbortError"
}));

const mockHighlightCodeWithWorker = vi.mocked(workerClientLib.highlightCodeWithWorker);
const mockExceedsMaxSize = vi.mocked(shikiLib.exceedsMaxSize);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExceedsMaxSize.mockReturnValue(false);
  mockHighlightCodeWithWorker.mockResolvedValue(null);

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });

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
    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/screens/Home.tsx"
      })
    );

    expect(screen.getByTestId("code-viewer-filepath")).toHaveTextContent("src/screens/Home.tsx");
  });

  it("highlights specified line range", async () => {
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
    mockHighlightCodeWithWorker.mockResolvedValue({
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

  it("focuses find input on Ctrl+F shortcut", () => {
    render(
      createElement(CodeViewer, {
        code: "const x = 1;",
        filePath: "src/App.tsx"
      })
    );

    const findInput = screen.getByTestId("code-viewer-find-input");
    expect(findInput).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(findInput).toHaveFocus();
  });

  it("updates search count and navigates matches with Enter and Shift+Enter", async () => {
    render(
      createElement(CodeViewer, {
        code: "alpha alpha\nalpha\nomega",
        filePath: "src/App.tsx"
      })
    );

    const findInput = screen.getByTestId("code-viewer-find-input");
    const matchCount = screen.getByTestId("code-viewer-find-count");

    fireEvent.change(findInput, { target: { value: "alpha" } });
    await waitFor(() => {
      expect(matchCount).toHaveTextContent("1 of 3");
    });
    expect(screen.getByTestId("code-viewer-active-match-line")).toHaveTextContent("1");

    fireEvent.keyDown(findInput, { key: "Enter" });
    await waitFor(() => {
      expect(matchCount).toHaveTextContent("2 of 3");
    });

    fireEvent.keyDown(findInput, { key: "Enter", shiftKey: true });
    await waitFor(() => {
      expect(matchCount).toHaveTextContent("1 of 3");
    });
  });

  it("jumps to clamped line using :line input", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3\nline4\nline5",
        filePath: "src/App.tsx"
      })
    );

    const findInput = screen.getByTestId("code-viewer-find-input");
    fireEvent.change(findInput, { target: { value: ":999" } });
    fireEvent.keyDown(findInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("code-viewer-jump-target-line")).toHaveTextContent("5");
    });
  });

  it("preserves IR highlight range while using find and line jump", async () => {
    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3\nline4",
        filePath: "src/App.tsx",
        highlightRange: { startLine: 2, endLine: 3 }
      })
    );

    const findInput = screen.getByTestId("code-viewer-find-input");
    fireEvent.change(findInput, { target: { value: "line" } });
    await waitFor(() => {
      expect(screen.getByTestId("code-viewer-find-count")).toHaveTextContent("1 of 4");
    });

    fireEvent.change(findInput, { target: { value: ":4" } });
    fireEvent.keyDown(findInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("code-viewer-jump-target-line")).toHaveTextContent("4");
      expect(screen.getAllByTestId("highlighted-line")).toHaveLength(2);
    });
  });

  it("copy button is present and labeled correctly", () => {
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

  it("copy button writes full file content to clipboard", async () => {
    const writeText = vi.mocked(navigator.clipboard.writeText);

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3",
        filePath: "src/App.tsx"
      })
    );

    fireEvent.click(screen.getByTestId("inspector-copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("line1\nline2\nline3");
    });
  });

  it("copy button writes only highlighted range to clipboard", async () => {
    const writeText = vi.mocked(navigator.clipboard.writeText);

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3\nline4",
        filePath: "src/App.tsx",
        highlightRange: { startLine: 2, endLine: 3 }
      })
    );

    fireEvent.click(screen.getByTestId("inspector-copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("line2\nline3");
    });
  });

  it("scrolls highlighted range into view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      createElement(CodeViewer, {
        code: "line1\nline2\nline3\nline4\nline5",
        filePath: "src/App.tsx",
        highlightRange: { startLine: 3, endLine: 4 }
      })
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it("falls back to plain text when no highlight result", async () => {
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

  it("aborts stale highlight jobs and applies only the latest highlighted output", async () => {
    const firstResult = {
      html: '<pre class="shiki github-light"><code><span class="line"><span style="color:#CF222E">stale</span></span></code></pre>',
      theme: "github-light" as const
    };
    const secondResult = {
      html: '<pre class="shiki github-light"><code><span class="line"><span style="color:#0550AE">fresh</span></span></code></pre>',
      theme: "github-light" as const
    };

    let firstSignal: AbortSignal | undefined;
    let resolveFirst!: (value: typeof firstResult | null) => void;
    const firstPromise = new Promise<typeof firstResult | null>((resolve) => {
      resolveFirst = resolve;
    });

    mockHighlightCodeWithWorker
      .mockImplementationOnce(async ({ signal }) => {
        firstSignal = signal;
        return await firstPromise;
      })
      .mockResolvedValueOnce(secondResult);

    const { rerender } = render(
      createElement(CodeViewer, {
        code: "const staleValue = 1;",
        filePath: "src/stale.tsx"
      })
    );

    rerender(
      createElement(CodeViewer, {
        code: "const freshValue = 2;",
        filePath: "src/fresh.tsx"
      })
    );

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
    });

    await waitFor(() => {
      const codeContent = screen.getByTestId("code-content");
      expect(codeContent.innerHTML).toContain("fresh");
    });

    resolveFirst(firstResult);

    await waitFor(() => {
      const codeContent = screen.getByTestId("code-content");
      expect(codeContent.innerHTML).not.toContain("stale");
    });
  });
});
