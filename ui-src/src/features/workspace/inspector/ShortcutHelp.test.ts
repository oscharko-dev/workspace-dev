/**
 * Unit tests for ShortcutHelp overlay component.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/436
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { ShortcutHelp } from "./ShortcutHelp";

vi.mock("../../../lib/shiki-shared", () => ({
  getPreferredTheme: vi.fn().mockReturnValue("github-light")
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();

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

describe("ShortcutHelp", () => {
  const mockOnClose = vi.fn();

  it("returns null when not open", () => {
    const { container } = render(createElement(ShortcutHelp, { open: false, onClose: mockOnClose }));
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay when open", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    expect(screen.getByTestId("shortcut-help-overlay")).toBeTruthy();
  });

  it("renders dialog panel with heading", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    expect(screen.getByTestId("shortcut-help-panel")).toBeTruthy();
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
  });

  it("has correct ARIA attributes", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const overlay = screen.getByTestId("shortcut-help-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBe("Keyboard shortcuts");
  });

  it("renders all five shortcut categories", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    expect(screen.getByTestId("shortcut-category-component-tree")).toBeTruthy();
    expect(screen.getByTestId("shortcut-category-code-viewer")).toBeTruthy();
    expect(screen.getByTestId("shortcut-category-pane-layout")).toBeTruthy();
    expect(screen.getByTestId("shortcut-category-edit-history")).toBeTruthy();
    expect(screen.getByTestId("shortcut-category-inspector-tool")).toBeTruthy();
  });

  it("renders kbd elements for shortcut keys", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const panel = screen.getByTestId("shortcut-help-panel");
    const kbdElements = panel.querySelectorAll("kbd");
    expect(kbdElements.length).toBeGreaterThan(10);
  });

  it("calls onClose when close button is clicked", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    fireEvent.click(screen.getByTestId("shortcut-help-close"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const overlay = screen.getByTestId("shortcut-help-overlay");
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const overlay = screen.getByTestId("shortcut-help-overlay");
    fireEvent.click(overlay);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the panel", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const panel = screen.getByTestId("shortcut-help-panel");
    fireEvent.click(panel);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("includes shortcut descriptions", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    expect(screen.getByText("Navigate between nodes")).toBeTruthy();
    expect(screen.getByText("Open find in file")).toBeTruthy();
    expect(screen.getByText("Resize pane (24 px)")).toBeTruthy();
    expect(screen.getByText("Undo edit action")).toBeTruthy();
    expect(screen.getByText("Redo edit action")).toBeTruthy();
    expect(screen.getByText("Create draft snapshot")).toBeTruthy();
    expect(screen.getByText("Toggle this shortcut help")).toBeTruthy();
    expect(screen.getByText("Set overlay opacity to 0%, 50%, or 100%")).toBeTruthy();
  });

  it("uses platform-aware modifier key (Ctrl in jsdom)", () => {
    // jsdom navigator.platform is empty string, not Mac — so should show "Ctrl"
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const panel = screen.getByTestId("shortcut-help-panel");
    const kbdElements = Array.from(panel.querySelectorAll("kbd"));
    const hasCtrlF = kbdElements.some((el) => el.textContent?.includes("Ctrl+F"));
    expect(hasCtrlF).toBe(true);
  });

  it("renders close button with aria-label", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    const closeBtn = screen.getByTestId("shortcut-help-close");
    expect(closeBtn.getAttribute("aria-label")).toBe("Close keyboard shortcuts");
  });

  it("moves focus to the close button when opened", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));
    expect(screen.getByTestId("shortcut-help-close")).toHaveFocus();
  });

  it("traps Tab and Shift+Tab focus inside the overlay", () => {
    render(createElement(ShortcutHelp, { open: true, onClose: mockOnClose }));

    const overlay = screen.getByTestId("shortcut-help-overlay");
    const closeBtn = screen.getByTestId("shortcut-help-close");
    closeBtn.focus();

    fireEvent.keyDown(overlay, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    fireEvent.keyDown(overlay, { key: "Tab", shiftKey: true });
    expect(closeBtn).toHaveFocus();
  });
});
