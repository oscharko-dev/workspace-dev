/**
 * Unit tests for the Breadcrumb component and findNodePath utility.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/435
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { Breadcrumb } from "./Breadcrumb";
import { findNodePath, type BreadcrumbSegment } from "./component-tree-utils";
import type { TreeNode } from "./component-tree";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeTree(): TreeNode[] {
  return [
    {
      id: "screen-1",
      name: "HomeScreen",
      type: "screen",
      children: [
        {
          id: "frame-1",
          name: "Header",
          type: "appbar",
          children: [
            { id: "logo", name: "Logo", type: "image" },
            {
              id: "nav",
              name: "Navigation",
              type: "navigation",
              children: [
                { id: "btn-home", name: "HomeBtn", type: "button" },
                { id: "btn-about", name: "AboutBtn", type: "button" }
              ]
            }
          ]
        },
        {
          id: "body",
          name: "Body",
          type: "container",
          children: [
            { id: "card-1", name: "ProductCard", type: "card" }
          ]
        }
      ]
    },
    {
      id: "screen-2",
      name: "SettingsScreen",
      type: "screen",
      children: [
        { id: "toggle-1", name: "DarkMode", type: "switch" }
      ]
    }
  ];
}

// ---------------------------------------------------------------------------
// findNodePath tests
// ---------------------------------------------------------------------------

describe("findNodePath", () => {
  const tree = makeTree();

  it("returns empty array for non-existent node", () => {
    expect(findNodePath(tree, "does-not-exist")).toEqual([]);
  });

  it("returns single segment for root screen", () => {
    const path = findNodePath(tree, "screen-1");
    expect(path).toHaveLength(1);
    expect(path[0]!.id).toBe("screen-1");
    expect(path[0]!.name).toBe("HomeScreen");
    expect(path[0]!.type).toBe("screen");
  });

  it("returns full path for deeply nested node", () => {
    const path = findNodePath(tree, "btn-home");
    expect(path).toHaveLength(4);
    expect(path.map((s) => s.id)).toEqual(["screen-1", "frame-1", "nav", "btn-home"]);
  });

  it("returns correct path for sibling in different subtree", () => {
    const path = findNodePath(tree, "card-1");
    expect(path.map((s) => s.id)).toEqual(["screen-1", "body", "card-1"]);
  });

  it("returns path for node in second screen", () => {
    const path = findNodePath(tree, "toggle-1");
    expect(path.map((s) => s.id)).toEqual(["screen-2", "toggle-1"]);
  });

  it("returns empty array for empty tree", () => {
    expect(findNodePath([], "any")).toEqual([]);
  });

  it("preserves name and type for all segments", () => {
    const path = findNodePath(tree, "logo");
    expect(path).toHaveLength(3);
    expect(path[0]).toEqual({ id: "screen-1", name: "HomeScreen", type: "screen" });
    expect(path[1]).toEqual({ id: "frame-1", name: "Header", type: "appbar" });
    expect(path[2]).toEqual({ id: "logo", name: "Logo", type: "image" });
  });
});

// ---------------------------------------------------------------------------
// Breadcrumb component tests
// ---------------------------------------------------------------------------

describe("Breadcrumb", () => {
  const mockOnSelect = vi.fn();
  const mockOnEnterScope = vi.fn();
  const mockOnExitScope = vi.fn();

  it("returns null when path is empty", () => {
    const { container } = render(createElement(Breadcrumb, { path: [], onSelect: mockOnSelect }));
    expect(container.innerHTML).toBe("");
  });

  it("renders nav landmark with aria-label", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "c1", name: "Card", type: "card" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    const nav = screen.getByTestId("inspector-breadcrumb");
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Component path");
  });

  it("renders all segments with correct test ids", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "h1", name: "Header", type: "appbar" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    expect(screen.getByTestId("breadcrumb-segment-s1")).toBeTruthy();
    expect(screen.getByTestId("breadcrumb-segment-h1")).toBeTruthy();
    expect(screen.getByTestId("breadcrumb-segment-b1")).toBeTruthy();
  });

  it("marks the last segment with aria-current=location", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    const lastSegment = screen.getByTestId("breadcrumb-segment-b1");
    expect(lastSegment.getAttribute("aria-current")).toBe("location");
  });

  it("does not mark non-last segments with aria-current", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    const firstSegment = screen.getByTestId("breadcrumb-segment-s1");
    expect(firstSegment.getAttribute("aria-current")).toBeNull();
  });

  it("calls onSelect when a segment is clicked", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "h1", name: "Header", type: "appbar" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    fireEvent.click(screen.getByTestId("breadcrumb-segment-s1"));
    expect(mockOnSelect).toHaveBeenCalledWith("s1");
  });

  it("shows overflow toggle when path exceeds MAX_VISIBLE_SEGMENTS", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "a1", name: "Level1", type: "container" },
      { id: "a2", name: "Level2", type: "container" },
      { id: "a3", name: "Level3", type: "container" },
      { id: "a4", name: "Level4", type: "card" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    expect(screen.getByTestId("breadcrumb-overflow-toggle")).toBeTruthy();
  });

  it("does not show overflow when path is short", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    expect(screen.queryByTestId("breadcrumb-overflow-toggle")).toBeNull();
  });

  it("opens overflow menu on toggle click", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "a1", name: "Level1", type: "container" },
      { id: "a2", name: "Level2", type: "container" },
      { id: "a3", name: "Level3", type: "container" },
      { id: "a4", name: "Level4", type: "card" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    fireEvent.click(screen.getByTestId("breadcrumb-overflow-toggle"));
    expect(screen.getByTestId("breadcrumb-overflow-menu")).toBeTruthy();
  });

  it("calls onSelect when clicking an overflow menu item", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "a1", name: "Level1", type: "container" },
      { id: "a2", name: "Level2", type: "container" },
      { id: "a3", name: "Level3", type: "container" },
      { id: "a4", name: "Level4", type: "card" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    fireEvent.click(screen.getByTestId("breadcrumb-overflow-toggle"));
    fireEvent.click(screen.getByTestId("breadcrumb-overflow-item-a1"));
    expect(mockOnSelect).toHaveBeenCalledWith("a1");
  });

  it("displays type badge for non-screen segments", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "MyButton", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect }));
    // The button type should have a badge with "B" abbreviation
    const segment = screen.getByTestId("breadcrumb-segment-b1");
    expect(segment.textContent).toContain("B");
    expect(segment.textContent).toContain("MyButton");
  });

  it("renders and triggers enter scope for the last segment", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, { path, onSelect: mockOnSelect, onEnterScope: mockOnEnterScope }));

    const button = screen.getByTestId("breadcrumb-enter-scope");
    expect(button.textContent).toBe("Enter scope");
    fireEvent.click(button);
    expect(mockOnEnterScope).toHaveBeenCalledWith("b1");
  });

  it("renders level-up button when scope is active", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, {
      path,
      onSelect: mockOnSelect,
      hasActiveScope: true,
      onExitScope: mockOnExitScope
    }));

    const button = screen.getByTestId("breadcrumb-exit-scope");
    expect(button.textContent).toBe("Level up");
    fireEvent.click(button);
    expect(mockOnExitScope).toHaveBeenCalledTimes(1);
  });

  it("hides level-up button when no scope is active", () => {
    const path: BreadcrumbSegment[] = [
      { id: "s1", name: "Screen", type: "screen" },
      { id: "b1", name: "Button", type: "button" }
    ];
    render(createElement(Breadcrumb, {
      path,
      onSelect: mockOnSelect,
      hasActiveScope: false,
      onExitScope: mockOnExitScope
    }));

    expect(screen.queryByTestId("breadcrumb-exit-scope")).toBeNull();
  });
});
