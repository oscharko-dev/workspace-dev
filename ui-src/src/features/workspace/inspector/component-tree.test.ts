/**
 * Unit tests for ComponentTree component.
 *
 * Covers tree rendering, search/filter with parent path preservation,
 * node selection, expand/collapse, and keyboard navigation.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/385
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import { createElement } from "react";
import { ComponentTree, type TreeNode } from "./component-tree";
import { filterTree } from "./component-tree-utils";

// jsdom does not implement scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
});

const SEARCH_DEBOUNCE_ASSERT_DELAY_MS = 140;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeScreens(): TreeNode[] {
  return [
    {
      id: "screen-home",
      name: "Home",
      type: "screen",
      children: [
        {
          id: "header-bar",
          name: "HeaderBar",
          type: "appbar",
          children: [
            { id: "logo", name: "Logo", type: "image" },
            { id: "nav-menu", name: "NavMenu", type: "navigation" },
          ],
        },
        {
          id: "price-card",
          name: "PriceCard",
          type: "card",
          children: [
            { id: "amount", name: "Amount", type: "text" },
            { id: "label", name: "Label", type: "text" },
          ],
        },
        { id: "submit-btn", name: "SubmitButton", type: "button" },
      ],
    },
    {
      id: "screen-details",
      name: "Details",
      type: "screen",
      children: [{ id: "detail-title", name: "DetailTitle", type: "text" }],
    },
  ];
}

function makeLargeScreens(nodeCount: number): TreeNode[] {
  return [
    {
      id: "screen-large",
      name: "Large Screen",
      type: "screen",
      children: Array.from({ length: nodeCount }, (_, index) => ({
        id: `large-node-${String(index + 1)}`,
        name: `Leaf ${String(index + 1).padStart(4, "0")}`,
        type: "text",
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// filterTree (pure function)
// ---------------------------------------------------------------------------

describe("filterTree", () => {
  const screens = makeScreens();

  it("returns all nodes when query is empty", () => {
    expect(filterTree(screens, "")).toBe(screens);
    expect(filterTree(screens, "  ")).toBe(screens);
  });

  it("filters by name (case-insensitive)", () => {
    const result = filterTree(screens, "logo");
    // Should keep Home > HeaderBar > Logo path
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Home");
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.name).toBe("HeaderBar");
    expect(result[0]!.children![0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.children![0]!.name).toBe("Logo");
  });

  it("preserves parent path for deep matches", () => {
    const result = filterTree(screens, "Amount");
    expect(result).toHaveLength(1);
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.name).toBe("PriceCard");
    expect(result[0]!.children![0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.children![0]!.name).toBe("Amount");
  });

  it("includes all children when parent matches", () => {
    const result = filterTree(screens, "HeaderBar");
    expect(result).toHaveLength(1);
    const headerBar = result[0]!.children![0]!;
    expect(headerBar.name).toBe("HeaderBar");
    // Should include all children of HeaderBar since parent matched directly
    expect(headerBar.children).toHaveLength(2);
  });

  it("matches across multiple screens", () => {
    const result = filterTree(screens, "title");
    // Should match DetailTitle in Details screen
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Details");
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.name).toBe("DetailTitle");
  });

  it("returns empty array when no nodes match", () => {
    const result = filterTree(screens, "zzzzz");
    expect(result).toHaveLength(0);
  });

  it("matches screen-level nodes directly", () => {
    const result = filterTree(screens, "home");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Home");
    // All children preserved since screen matched directly
    expect(result[0]!.children).toHaveLength(3);
  });

  it("handles multiple sibling matches at the same level", () => {
    // Both Logo and Label contain 'l'
    const result = filterTree(screens, "Label");
    expect(result).toHaveLength(1);
    const priceCard = result[0]!.children![0]!;
    expect(priceCard.name).toBe("PriceCard");
    expect(priceCard.children).toHaveLength(1);
    expect(priceCard.children![0]!.name).toBe("Label");
  });

  it("excludes skeleton descendants from direct parent search matches", () => {
    const result = filterTree(
      [
        {
          id: "screen-live",
          name: "Live Screen",
          type: "screen",
          children: [
            { id: "skeleton-1", name: "", type: "skeleton" },
            { id: "real-1", name: "Header", type: "text" },
          ],
        },
      ],
      "live",
    );

    expect(result[0]!.children).toEqual([
      { id: "real-1", name: "Header", type: "text" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ComponentTree rendering
// ---------------------------------------------------------------------------

describe("ComponentTree", () => {
  const defaultProps = {
    screens: makeScreens(),
    selectedId: null,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };

  it("renders the component tree with screen nodes", () => {
    render(createElement(ComponentTree, defaultProps));
    expect(screen.getByTestId("component-tree")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("renders the search input", () => {
    render(createElement(ComponentTree, defaultProps));
    const searchInput = screen.getByTestId("tree-search-input");
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute("placeholder", "Search components…");
  });

  it("renders child nodes when screen is expanded by default", () => {
    render(createElement(ComponentTree, defaultProps));
    expect(screen.getByText("HeaderBar")).toBeInTheDocument();
    expect(screen.getByText("PriceCard")).toBeInTheDocument();
    expect(screen.getByText("SubmitButton")).toBeInTheDocument();
  });

  it("preserves deterministic pre-order row ordering", () => {
    render(createElement(ComponentTree, defaultProps));
    const orderedIds = screen
      .getAllByRole("treeitem")
      .map((node) => node.getAttribute("data-node-id"));
    expect(orderedIds.slice(0, 6)).toEqual([
      "screen-home",
      "header-bar",
      "price-card",
      "submit-btn",
      "screen-details",
      "detail-title",
    ]);
  });

  it("renders type badges on nodes", () => {
    render(createElement(ComponentTree, defaultProps));
    // Check that badge with title "button" exists on SubmitButton's row
    const submitNode = screen.getByTestId("tree-node-submit-btn");
    const badge = within(submitNode).getByTitle("button");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("B");
  });

  it("highlights selected node", () => {
    render(
      createElement(ComponentTree, {
        ...defaultProps,
        selectedId: "submit-btn",
      }),
    );
    const node = screen.getByTestId("tree-node-submit-btn");
    expect(node).toHaveAttribute("aria-selected", "true");
  });

  it("calls onSelect when node is clicked", () => {
    const onSelect = vi.fn();
    render(createElement(ComponentTree, { ...defaultProps, onSelect }));
    // SubmitButton is a direct child of Home screen (expanded by default)
    fireEvent.click(screen.getByTestId("tree-node-submit-btn"));
    expect(onSelect).toHaveBeenCalledWith("submit-btn");
  });

  it("moves DOM focus to the clicked row for follow-up keyboard shortcuts", () => {
    render(createElement(ComponentTree, defaultProps));

    const node = screen.getByTestId("tree-node-submit-btn");
    fireEvent.click(node);

    expect(node).toHaveFocus();
  });

  it("collapses a screen when chevron is clicked", () => {
    render(createElement(ComponentTree, defaultProps));
    // HeaderBar should be visible (Home is expanded by default)
    expect(screen.getByText("HeaderBar")).toBeInTheDocument();

    // Click collapse on first screen
    const homeScreen = screen.getByTestId("tree-screen-screen-home");
    const collapseBtn = within(homeScreen).getByLabelText("Collapse");
    fireEvent.click(collapseBtn);

    // HeaderBar should no longer be visible
    expect(screen.queryByText("HeaderBar")).not.toBeInTheDocument();
  });

  it("shows collapsed state with expand button", () => {
    render(createElement(ComponentTree, { ...defaultProps, collapsed: true }));
    expect(screen.queryByTestId("component-tree")).not.toBeInTheDocument();
    expect(screen.getByTestId("tree-expand-button")).toBeInTheDocument();
  });

  it("calls onToggleCollapsed when collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(
      createElement(ComponentTree, { ...defaultProps, onToggleCollapsed }),
    );
    fireEvent.click(screen.getByTestId("tree-collapse-button"));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Search interaction
// ---------------------------------------------------------------------------

describe("ComponentTree search", () => {
  const defaultProps = {
    screens: makeScreens(),
    selectedId: null,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };

  it("filters nodes when typing in search input", () => {
    render(createElement(ComponentTree, defaultProps));
    const searchInput = screen.getByTestId("tree-search-input");
    fireEvent.change(searchInput, { target: { value: "Logo" } });

    return waitFor(() => {
      // Logo should still be visible
      expect(screen.getByText("Logo")).toBeInTheDocument();
      // PriceCard should not be visible (no match)
      expect(screen.queryByText("PriceCard")).not.toBeInTheDocument();
      // SubmitButton should not be visible
      expect(screen.queryByText("SubmitButton")).not.toBeInTheDocument();
      // Details screen should not be visible (no matching children)
      expect(screen.queryByText("Details")).not.toBeInTheDocument();
    });
  });

  it("shows 'No matching components' when search has no results", () => {
    render(createElement(ComponentTree, defaultProps));
    const searchInput = screen.getByTestId("tree-search-input");
    fireEvent.change(searchInput, { target: { value: "zzzzz" } });
    return waitFor(() => {
      expect(screen.getByText("No matching components")).toBeInTheDocument();
    });
  });

  it("restores full tree when search is cleared", async () => {
    render(createElement(ComponentTree, defaultProps));
    const searchInput = screen.getByTestId("tree-search-input");

    // Filter
    fireEvent.change(searchInput, { target: { value: "Logo" } });
    await waitFor(() => {
      expect(screen.queryByText("PriceCard")).not.toBeInTheDocument();
    });

    // Clear
    fireEvent.change(searchInput, { target: { value: "" } });
    // Screens are expanded by default, so top-level children are visible
    await waitFor(() => {
      expect(screen.getByText("PriceCard")).toBeInTheDocument();
      expect(screen.getByText("HeaderBar")).toBeInTheDocument();
    });
  });

  it("search is case-insensitive", () => {
    render(createElement(ComponentTree, defaultProps));
    const searchInput = screen.getByTestId("tree-search-input");
    fireEvent.change(searchInput, { target: { value: "logo" } });
    return waitFor(() => {
      expect(screen.getByText("Logo")).toBeInTheDocument();
    });
  });

  it("debounces search input before applying filter", async () => {
    vi.useFakeTimers();
    render(createElement(ComponentTree, defaultProps));

    const searchInput = screen.getByTestId("tree-search-input");
    fireEvent.change(searchInput, { target: { value: "Logo" } });

    // No immediate filter pass before debounce delay.
    expect(screen.getByText("PriceCard")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_ASSERT_DELAY_MS);
    });

    expect(screen.queryByText("PriceCard")).not.toBeInTheDocument();
    expect(screen.getByText("Logo")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe("ComponentTree keyboard navigation", () => {
  const defaultProps = {
    screens: makeScreens(),
    selectedId: null,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };

  it("navigates with ArrowDown and selects with Enter", () => {
    const onSelect = vi.fn();
    render(createElement(ComponentTree, { ...defaultProps, onSelect }));

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);

    // Arrow down once from Home
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // Arrow down again
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // Select current node
    fireEvent.keyDown(tree, { key: "Enter" });

    expect(onSelect).toHaveBeenCalled();
  });

  it("Space key also selects a node", () => {
    const onSelect = vi.fn();
    render(createElement(ComponentTree, { ...defaultProps, onSelect }));

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);
    fireEvent.keyDown(tree, { key: " " });

    expect(onSelect).toHaveBeenCalled();
  });

  it("ArrowLeft collapses an expanded node before moving focus", () => {
    render(createElement(ComponentTree, defaultProps));

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    const headerBar = screen.getByTestId("tree-node-header-bar");
    expect(headerBar).toHaveAttribute("tabIndex", "0");
    expect(headerBar).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(headerBar).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(headerBar).toHaveAttribute("aria-expanded", "false");
    expect(headerBar).toHaveAttribute("tabIndex", "0");
  });

  it("ArrowLeft moves focus to the parent when the current node is a leaf", () => {
    render(createElement(ComponentTree, defaultProps));

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    const logoNode = screen.getByTestId("tree-node-logo");
    const headerBar = screen.getByTestId("tree-node-header-bar");

    expect(logoNode).toHaveAttribute("tabIndex", "0");
    expect(headerBar).toHaveAttribute("tabIndex", "-1");

    fireEvent.keyDown(tree, { key: "ArrowLeft" });

    expect(headerBar).toHaveAttribute("tabIndex", "0");
    expect(logoNode).toHaveAttribute("tabIndex", "-1");
  });

  it("virtualizes large trees and keeps keyboard navigation selectable", () => {
    const onSelect = vi.fn();
    render(
      createElement(ComponentTree, {
        screens: makeLargeScreens(1_500),
        selectedId: null,
        onSelect,
        collapsed: false,
        onToggleCollapsed: vi.fn(),
      }),
    );

    const totalCount = Number.parseInt(
      screen.getByTestId("component-tree-total-count").textContent ?? "0",
      10,
    );
    expect(totalCount).toBe(1_501);

    // Virtualization should keep mounted rows far below total node count.
    const mountedRows = screen.getAllByRole("treeitem").length;
    expect(mountedRows).toBeLessThan(200);

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);
    for (let index = 0; index < 60; index += 1) {
      fireEvent.keyDown(tree, { key: "ArrowDown" });
    }
    fireEvent.keyDown(tree, { key: "Enter" });

    expect(onSelect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Progressive streaming — skeleton placeholders & mapping badges (Issue #1005)
// ---------------------------------------------------------------------------

function makeStreamingScreens(child: TreeNode): TreeNode[] {
  return [
    {
      id: "screen-1",
      name: "TestScreen",
      type: "screen",
      children: [child],
    },
  ];
}

describe("ComponentTree skeleton nodes", () => {
  const skeletonNode: TreeNode = { id: "skel-1", name: "", type: "skeleton" };

  const defaultProps = {
    screens: makeStreamingScreens(skeletonNode),
    selectedId: null,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };

  it("renders shimmer placeholder for skeleton-type nodes (no visible name text)", () => {
    render(createElement(ComponentTree, defaultProps));

    const row = screen.getByTestId("tree-node-skel-1");
    // Shimmer span is aria-hidden and has an animate-pulse class.
    const shimmer = row.querySelector("span[aria-hidden='true'].animate-pulse");
    expect(shimmer).not.toBeNull();
    // No `name` text should be rendered for the empty skeleton name.
    // (The screen-level parent label should still be there though.)
    expect(within(row).queryByText(/./)).toBeNull();
  });

  it("skeleton nodes have aria-disabled=true", () => {
    render(createElement(ComponentTree, defaultProps));
    const row = screen.getByTestId("tree-node-skel-1");
    expect(row).toHaveAttribute("aria-disabled", "true");
  });

  it("clicking a skeleton node does NOT call onSelect", () => {
    const onSelect = vi.fn();
    render(createElement(ComponentTree, { ...defaultProps, onSelect }));
    fireEvent.click(screen.getByTestId("tree-node-skel-1"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("double-clicking a skeleton node does NOT call onEnterScope", () => {
    const onEnterScope = vi.fn();
    render(
      createElement(ComponentTree, {
        ...defaultProps,
        onEnterScope,
      }),
    );
    fireEvent.doubleClick(screen.getByTestId("tree-node-skel-1"));
    expect(onEnterScope).not.toHaveBeenCalled();
  });

  it("keyboard activation does NOT select skeleton nodes", () => {
    const onSelect = vi.fn();
    render(createElement(ComponentTree, { ...defaultProps, onSelect }));

    const tree = screen.getByRole("tree");
    fireEvent.focus(tree);
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("skeleton nodes show no TypeBadge", () => {
    render(createElement(ComponentTree, defaultProps));
    const row = screen.getByTestId("tree-node-skel-1");
    // TypeBadge renders a span with a `title` attribute (e.g. title="button").
    // For a skeleton node, no such TypeBadge should be present.
    expect(row.querySelector("[title]")).toBeNull();
    // Defensive second check: the skeleton-type badge must not be present.
    expect(row.querySelector("[title='skeleton']")).toBeNull();
  });
});

describe("ComponentTree mapping badges", () => {
  const matchedNode: TreeNode = {
    id: "matched-1",
    name: "Button",
    type: "button",
    mappingStatus: "matched",
  };
  const suggestedNode: TreeNode = {
    id: "suggested-1",
    name: "Tooltip",
    type: "tooltip",
    mappingStatus: "suggested",
  };
  const unmappedNode: TreeNode = {
    id: "unmapped-1",
    name: "Card",
    type: "card",
    mappingStatus: "unmapped",
  };
  const errorNode: TreeNode = {
    id: "error-1",
    name: "Nav",
    type: "navigation",
    mappingStatus: "error",
  };
  const plainNode: TreeNode = {
    id: "plain-1",
    name: "Plain",
    type: "text",
  };

  const baseProps = {
    selectedId: null,
    onSelect: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };

  it("shows green badge for matched mappingStatus", () => {
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(matchedNode),
      }),
    );
    const row = screen.getByTestId("tree-node-matched-1");
    const badge = within(row).getByLabelText("Component matched");
    expect(badge).toBeInTheDocument();
    // The "matched" variant uses the green accent color.
    expect(badge.className).toContain("bg-[#4eba87]");
  });

  it("shows yellow badge for suggested mappingStatus", () => {
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(suggestedNode),
      }),
    );
    const row = screen.getByTestId("tree-node-suggested-1");
    const badge = within(row).getByLabelText("Component suggested");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-amber-400");
  });

  it("shows grey badge for unmapped mappingStatus", () => {
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(unmappedNode),
      }),
    );
    const row = screen.getByTestId("tree-node-unmapped-1");
    const badge = within(row).getByLabelText("Component unmapped");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-white/25");
  });

  it("shows red badge for error mappingStatus", () => {
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(errorNode),
      }),
    );
    const row = screen.getByTestId("tree-node-error-1");
    const badge = within(row).getByLabelText("Component error");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("bg-rose-500");
  });

  it("shows no badge when mappingStatus is undefined", () => {
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(plainNode),
      }),
    );
    const row = screen.getByTestId("tree-node-plain-1");
    expect(within(row).queryByLabelText(/Component /)).toBeNull();
  });

  it("skeleton nodes never show mapping badge even when mappingStatus is set", () => {
    const skeletonWithStatus: TreeNode = {
      id: "skel-mapping",
      name: "",
      type: "skeleton",
      mappingStatus: "matched",
    };
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(skeletonWithStatus),
      }),
    );
    const row = screen.getByTestId("tree-node-skel-mapping");
    expect(within(row).queryByLabelText(/Component /)).toBeNull();
  });

  it("blocks node selection when selectionEnabled is false", () => {
    const onSelect = vi.fn();
    render(
      createElement(ComponentTree, {
        ...baseProps,
        screens: makeStreamingScreens(matchedNode),
        onSelect,
        selectionEnabled: false,
      }),
    );

    fireEvent.click(screen.getByTestId("tree-node-matched-1"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
