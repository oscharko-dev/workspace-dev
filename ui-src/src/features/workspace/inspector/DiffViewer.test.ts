/**
 * Unit tests for DiffViewer component.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/434
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { DiffViewer } from "./DiffViewer";
import * as shikiSharedLib from "../../../lib/shiki-shared";

vi.mock("../../../lib/shiki-shared", () => ({
  getPreferredTheme: vi.fn().mockReturnValue("github-light")
}));

const mockGetPreferredTheme = vi.mocked(shikiSharedLib.getPreferredTheme);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true
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

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn()
  });
});

const defaultProps = {
  oldCode: "line 1\nline 2\nline 3",
  newCode: "line 1\nchanged line 2\nline 3",
  filePath: "src/App.tsx",
  previousJobId: "prev-job-id-123"
};

describe("DiffViewer", () => {
  it("renders the diff viewer container", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer")).toBeTruthy();
  });

  it("displays the file path", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer-filepath").textContent).toContain("src/App.tsx");
  });

  it("shows previous job ID reference", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer-filepath").textContent).toContain("prev-job");
  });

  it("renders diff summary with add/remove counts", () => {
    render(createElement(DiffViewer, defaultProps));
    const summary = screen.getByTestId("diff-viewer-summary");
    expect(summary.textContent).toContain("+1 added");
    expect(summary.textContent).toContain("-1 removed");
  });

  it("renders added lines with correct test id", () => {
    render(createElement(DiffViewer, defaultProps));
    const addedLines = screen.getAllByTestId("diff-line-added");
    expect(addedLines.length).toBeGreaterThan(0);
  });

  it("renders removed lines with correct test id", () => {
    render(createElement(DiffViewer, defaultProps));
    const removedLines = screen.getAllByTestId("diff-line-removed");
    expect(removedLines.length).toBeGreaterThan(0);
  });

  it("renders context lines", () => {
    render(createElement(DiffViewer, defaultProps));
    const contextLines = screen.getAllByTestId("diff-line-context");
    expect(contextLines.length).toBeGreaterThan(0);
  });

  it("renders dual line number gutters", () => {
    render(createElement(DiffViewer, defaultProps));
    const oldLineNumbers = screen.getAllByTestId("diff-old-line-number");
    const newLineNumbers = screen.getAllByTestId("diff-new-line-number");
    expect(oldLineNumbers.length).toBeGreaterThan(0);
    expect(newLineNumbers.length).toBeGreaterThan(0);
  });

  it("shows identical message when files are the same", () => {
    const sameText = "line 1\nline 2";
    render(createElement(DiffViewer, {
      ...defaultProps,
      oldCode: sameText,
      newCode: sameText
    }));

    const summary = screen.getByTestId("diff-viewer-summary");
    expect(summary.textContent).toContain("identical");
  });

  it("renders find input for search", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer-find-input")).toBeTruthy();
  });

  it("shows match count when searching", () => {
    render(createElement(DiffViewer, defaultProps));

    const input = screen.getByTestId("diff-viewer-find-input");
    fireEvent.change(input, { target: { value: "line" } });

    const count = screen.getByTestId("diff-viewer-find-count");
    expect(count.textContent).not.toBe("0");
  });

  it("renders word wrap toggle", () => {
    render(createElement(DiffViewer, defaultProps));
    const wrapToggle = screen.getByTestId("diff-viewer-wrap-toggle");
    expect(wrapToggle.textContent).toContain("Wrap");
  });

  it("toggles word wrap on click", () => {
    render(createElement(DiffViewer, defaultProps));
    const wrapToggle = screen.getByTestId("diff-viewer-wrap-toggle");
    expect(wrapToggle.textContent).toBe("Wrap: Off");
    fireEvent.click(wrapToggle);
    expect(wrapToggle.textContent).toBe("Wrap: On");
  });

  it("renders copy button", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer-copy-button")).toBeTruthy();
  });

  it("renders Prev and Next navigation buttons", () => {
    render(createElement(DiffViewer, defaultProps));
    expect(screen.getByTestId("diff-viewer-find-prev")).toBeTruthy();
    expect(screen.getByTestId("diff-viewer-find-next")).toBeTruthy();
  });

  it("disables navigation buttons when no search query", () => {
    render(createElement(DiffViewer, defaultProps));
    const prev = screen.getByTestId("diff-viewer-find-prev") as HTMLButtonElement;
    const next = screen.getByTestId("diff-viewer-find-next") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });

  it("supports keyboard find navigation and scrolls the active match into view", async () => {
    render(createElement(DiffViewer, {
      ...defaultProps,
      oldCode: "alpha\nbeta\nalpha\nbeta",
      newCode: "alpha\nbeta\nalpha\nbeta"
    }));

    const input = screen.getByTestId("diff-viewer-find-input");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "alpha" } });
    await waitFor(() => {
      expect(screen.getByTestId("diff-viewer-find-count")).toHaveTextContent("1 of 2");
    });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("diff-viewer-find-count")).toHaveTextContent("2 of 2");
    });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId("diff-viewer-find-count")).toHaveTextContent("1 of 2");
    });

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("copies new file content and resets the copied state after the timer elapses", async () => {
    render(createElement(DiffViewer, defaultProps));

    fireEvent.click(screen.getByTestId("diff-viewer-copy-button"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(defaultProps.newCode);
      expect(screen.getByTestId("diff-viewer-copy-button")).toHaveTextContent("Copied!");
    });

    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await waitFor(() => {
      expect(screen.getByTestId("diff-viewer-copy-button")).toHaveTextContent("Copy");
    });
  });

  it("renders node-scoped focus states, fallback banner, and dark theme styling", () => {
    mockGetPreferredTheme.mockReturnValue("github-dark");

    const { unmount } = render(createElement(DiffViewer, {
      ...defaultProps,
      oldCode: "one\ntwo\nthree",
      newCode: "one\nupdated two\nthree",
      oldFocusRange: { startLine: 2, endLine: 2 },
      newFocusRange: { startLine: 2, endLine: 2 },
      scopedMode: "focused",
      isNodeScoped: true,
      nodeDiffFallbackReason: "Node-scoped diff fell back to full file.",
      themeMode: "dark"
    }));

    expect(screen.getByTestId("diff-viewer-node-scoped-badge")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-node-diff-fallback")).toHaveTextContent(
      "Node-scoped diff fell back to full file."
    );
    expect(screen.getByTestId("diff-viewer-summary").getAttribute("style")).toContain("rgb(13, 17, 23)");
    expect(screen.getByTestId("diff-line-removed")).toHaveAttribute("data-in-focus", "true");
    expect(screen.getByTestId("diff-line-added")).toHaveAttribute("data-in-focus", "true");

    unmount();
  });
});
