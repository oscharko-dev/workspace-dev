/**
 * Unit tests for CodePane scoped code modes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { CodePane } from "./CodePane";
import * as shikiLib from "../../../lib/shiki";
import * as workerClientLib from "../../../lib/shiki-worker-client";

// ---------------------------------------------------------------------------
// Mocks — prevent Shiki WASM loading
// ---------------------------------------------------------------------------

vi.mock("../../../lib/shiki", () => ({
  detectLanguage: vi.fn((filePath: string) => {
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) return "tsx";
    if (filePath.endsWith(".ts") || filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "typescript";
    return null;
  }),
  exceedsMaxSize: vi.fn().mockReturnValue(false),
  getPreferredTheme: vi.fn().mockReturnValue("github-light")
}));
vi.mock("../../../lib/shiki-worker-client", () => ({
  highlightCodeWithWorker: vi.fn(),
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === "AbortError"
}));

const mockHighlightCodeWithWorker = vi.mocked(workerClientLib.highlightCodeWithWorker);
const mockExceedsMaxSize = vi.mocked(shikiLib.exceedsMaxSize);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleCode = Array.from({ length: 20 }, (_, i) => `line ${String(i + 1)}`).join("\n");
const jsxSampleCode = [
  "export function EmptyState() {",
  "  return (",
  "    <section className=\"hero\">",
  "      <h1>Title</h1>",
  "    </section>",
  "  );",
  "}"
].join("\n");
const sampleFiles = [
  { path: "src/screens/Home.tsx", sizeBytes: 500 },
  { path: "src/screens/About.tsx", sizeBytes: 300 }
];
const noopFn = (): void => {};

function renderCodePane(overrides: Record<string, unknown> = {}): void {
  render(
    createElement(CodePane, {
      files: sampleFiles,
      filesState: "ready",
      filesError: null,
      onRetryFiles: noopFn,
      selectedFile: "src/screens/Home.tsx",
      onSelectFile: noopFn,
      fileContent: sampleCode,
      fileContentState: "ready",
      fileContentError: null,
      onRetryFileContent: noopFn,
      ...overrides
    })
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExceedsMaxSize.mockReturnValue(false);
  mockHighlightCodeWithWorker.mockResolvedValue(null);

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

describe("CodePane scoped code modes", () => {
  it("renders the mode selector when file content is available", () => {
    renderCodePane();
    expect(screen.getByTestId("scoped-code-mode-selector")).toBeTruthy();
  });

  it("does not render the mode selector when no file is selected", () => {
    renderCodePane({ selectedFile: null, fileContent: null });
    expect(screen.queryByTestId("scoped-code-mode-selector")).toBeNull();
  });

  it("shows all three mode buttons", () => {
    renderCodePane({ isNodeMapped: true });
    expect(screen.getByTestId("scoped-mode-snippet")).toBeTruthy();
    expect(screen.getByTestId("scoped-mode-focused")).toBeTruthy();
    expect(screen.getByTestId("scoped-mode-full")).toBeTruthy();
  });

  it("disables snippet and focused modes when node is unmapped", () => {
    renderCodePane({ isNodeMapped: false });
    const snippet = screen.getByTestId("scoped-mode-snippet") as HTMLButtonElement;
    const focused = screen.getByTestId("scoped-mode-focused") as HTMLButtonElement;
    const full = screen.getByTestId("scoped-mode-full") as HTMLButtonElement;

    expect(snippet.disabled).toBe(true);
    expect(focused.disabled).toBe(true);
    expect(full.disabled).toBe(false);
  });

  it("shows unmapped hint when node has no mapping", () => {
    renderCodePane({ isNodeMapped: false });
    expect(screen.getByTestId("scoped-mode-unmapped-hint")).toBeTruthy();
  });

  it("does not show unmapped hint when node is mapped", () => {
    renderCodePane({
      isNodeMapped: true,
      activeManifestRange: { startLine: 5, endLine: 10 }
    });
    expect(screen.queryByTestId("scoped-mode-unmapped-hint")).toBeNull();
  });

  it("defaults to snippet mode when node is mapped", () => {
    renderCodePane({
      isNodeMapped: true,
      activeManifestRange: { startLine: 5, endLine: 10 }
    });
    const snippet = screen.getByTestId("scoped-mode-snippet");
    expect(snippet.getAttribute("aria-pressed")).toBe("true");
  });

  it("defaults to full mode when node is unmapped", () => {
    renderCodePane({ isNodeMapped: false });
    const full = screen.getByTestId("scoped-mode-full");
    expect(full.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking a mode button switches the active mode", () => {
    renderCodePane({
      isNodeMapped: true,
      activeManifestRange: { startLine: 5, endLine: 10 }
    });

    // Initially snippet is active
    expect(screen.getByTestId("scoped-mode-snippet").getAttribute("aria-pressed")).toBe("true");

    // Click focused
    fireEvent.click(screen.getByTestId("scoped-mode-focused"));
    expect(screen.getByTestId("scoped-mode-focused").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("scoped-mode-snippet").getAttribute("aria-pressed")).toBe("false");

    // Click full
    fireEvent.click(screen.getByTestId("scoped-mode-full"));
    expect(screen.getByTestId("scoped-mode-full").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("scoped-mode-focused").getAttribute("aria-pressed")).toBe("false");
  });

  it("renders complete JSX tokens for a mapped snippet when Shiki returns nested spans", async () => {
    mockHighlightCodeWithWorker.mockResolvedValue({
      html: '<pre class="shiki github-light"><code><span class="line"><span style="color:#24292f">  return (</span></span>\n<span class="line"><span style="color:#24292f">    &#x3C;</span><span style="color:#0550AE">section</span><span style="color:#8250df"> className</span><span style="color:#cf222e">=</span><span style="color:#0a3069">"hero"</span><span style="color:#24292f">></span></span>\n<span class="line"><span style="color:#24292f">      &#x3C;</span><span style="color:#0550AE">h1</span><span style="color:#24292f">>Title&#x3C;/</span><span style="color:#0550AE">h1</span><span style="color:#24292f">></span></span>\n<span class="line"><span style="color:#24292f">    &#x3C;/</span><span style="color:#0550AE">section</span><span style="color:#24292f">></span></span>\n<span class="line"><span style="color:#24292f">  );</span></span></code></pre>',
      theme: "github-light"
    });

    renderCodePane({
      fileContent: jsxSampleCode,
      isNodeMapped: true,
      activeManifestRange: { file: "src/screens/Home.tsx", startLine: 3, endLine: 5 }
    });

    await waitFor(() => {
      expect(screen.getByTestId("code-content")).toHaveTextContent('<section className="hero">');
      expect(screen.getByTestId("code-content")).toHaveTextContent("<h1>Title</h1>");
    });
  });

  it("falls back to full file content when the active manifest range belongs to a different file", async () => {
    renderCodePane({
      fileContent: sampleCode,
      isNodeMapped: true,
      activeManifestRange: { file: "src/screens/About.tsx", startLine: 10, endLine: 12 }
    });

    await waitFor(() => {
      expect(screen.getByTestId("code-content")).toHaveTextContent("line 1");
      expect(screen.getByTestId("code-content")).toHaveTextContent("line 20");
    });
  });

  it("passes the selected node id through to CodeViewer so formatted snippet overlays remap from IR markers", async () => {
    renderCodePane({
      fileContent: [
        "export function Example() {",
        "  return (",
        "    <>",
        "      {/* @ir:start node-a Header FRAME */}",
        "      <Box data-super-long-first-prop=\"aaaaaaaaaaaaaaaaaaaa\" data-super-long-second-prop=\"bbbbbbbbbbbbbbbbbbbb\" data-super-long-third-prop=\"cccccccccccccccccccc\" data-super-long-fourth-prop=\"dddddddddddddddddddd\"><Text>Title</Text></Box>",
        "      {/* @ir:end node-a */}",
        "    </>",
        "  );",
        "}"
      ].join("\n"),
      isNodeMapped: true,
      selectedIrNodeId: "node-a",
      boundariesEnabled: true,
      activeManifestRange: { file: "src/screens/Home.tsx", startLine: 4, endLine: 6 }
    });

    fireEvent.click(screen.getByTestId("code-viewer-format-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("highlighted-line").length).toBeGreaterThan(3);
      expect(screen.getAllByTestId("code-boundary-marker-node-a").length).toBeGreaterThan(0);
    });
  });
});
