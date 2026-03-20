/**
 * Tests for ir-tree.ts — tree traversal and structural analysis utilities.
 *
 * Includes both unit tests (synthetic data) and an E2E test that fetches a
 * real Figma file and exercises all traversal functions against it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  countSubtreeNodes,
  collectNodes,
  analyzeDepthPressure,
  shouldTruncateChildrenByDepth,
  hasMeaningfulNodeText,
  isDepthSemanticNode,
  DEFAULT_SCREEN_ELEMENT_BUDGET,
  DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
  DEPTH_SEMANTIC_TYPES,
  DEPTH_SEMANTIC_NAME_HINTS
} from "./ir-tree.js";
import type { TreeFigmaNode, ScreenDepthBudgetContext } from "./ir-tree.js";
import type { ScreenElementIR } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const node = (
  id: string,
  type: string,
  overrides?: Partial<TreeFigmaNode> & { children?: TreeFigmaNode[] }
): TreeFigmaNode => ({
  id,
  type,
  ...overrides
});

const stubDetermineElementType = (n: TreeFigmaNode): ScreenElementIR["type"] => {
  const name = (n.name ?? "").toLowerCase();
  if (n.type === "TEXT") return "text";
  if (name.includes("button")) return "button";
  if (name.includes("input")) return "input";
  return "container";
};

// ── Unit: Constants ──────────────────────────────────────────────────────────

test("DEFAULT_SCREEN_ELEMENT_BUDGET is 1200", () => {
  assert.equal(DEFAULT_SCREEN_ELEMENT_BUDGET, 1_200);
});

test("DEFAULT_SCREEN_ELEMENT_MAX_DEPTH is 14", () => {
  assert.equal(DEFAULT_SCREEN_ELEMENT_MAX_DEPTH, 14);
});

test("DEPTH_SEMANTIC_TYPES contains expected element types", () => {
  assert.ok(DEPTH_SEMANTIC_TYPES.has("text"));
  assert.ok(DEPTH_SEMANTIC_TYPES.has("button"));
  assert.ok(DEPTH_SEMANTIC_TYPES.has("input"));
  assert.ok(!DEPTH_SEMANTIC_TYPES.has("container"));
});

test("DEPTH_SEMANTIC_NAME_HINTS is a non-empty array of strings", () => {
  assert.ok(DEPTH_SEMANTIC_NAME_HINTS.length > 0);
  assert.ok(DEPTH_SEMANTIC_NAME_HINTS.every((hint) => typeof hint === "string"));
});

// ── Unit: countSubtreeNodes ──────────────────────────────────────────────────

test("countSubtreeNodes returns 1 for a leaf node", () => {
  assert.equal(countSubtreeNodes(node("1:1", "TEXT")), 1);
});

test("countSubtreeNodes counts all descendants", () => {
  const root = node("1:0", "FRAME", {
    children: [
      node("1:1", "TEXT"),
      node("1:2", "FRAME", {
        children: [node("1:3", "TEXT"), node("1:4", "TEXT")]
      })
    ]
  });
  assert.equal(countSubtreeNodes(root), 5);
});

test("countSubtreeNodes counts hidden nodes (no visibility check)", () => {
  const root = node("1:0", "FRAME", {
    children: [node("1:1", "TEXT", { visible: false })]
  });
  assert.equal(countSubtreeNodes(root), 2);
});

// ── Unit: collectNodes ───────────────────────────────────────────────────────

test("collectNodes returns matching nodes", () => {
  const root = node("1:0", "FRAME", {
    children: [
      node("1:1", "TEXT"),
      node("1:2", "FRAME", {
        children: [node("1:3", "TEXT")]
      })
    ]
  });
  const textNodes = collectNodes(root, (n) => n.type === "TEXT");
  assert.equal(textNodes.length, 2);
  assert.deepEqual(
    textNodes.map((n) => n.id),
    ["1:1", "1:3"]
  );
});

test("collectNodes skips hidden subtrees", () => {
  const root = node("1:0", "FRAME", {
    children: [
      node("1:1", "TEXT"),
      node("1:2", "FRAME", {
        visible: false,
        children: [node("1:3", "TEXT")]
      })
    ]
  });
  const textNodes = collectNodes(root, (n) => n.type === "TEXT");
  assert.equal(textNodes.length, 1);
  assert.equal(textNodes[0].id, "1:1");
});

test("collectNodes returns empty array for hidden root", () => {
  const root = node("1:0", "FRAME", {
    visible: false,
    children: [node("1:1", "TEXT")]
  });
  assert.deepEqual(collectNodes(root, () => true), []);
});

// ── Unit: hasMeaningfulNodeText ──────────────────────────────────────────────

test("hasMeaningfulNodeText returns true for real text", () => {
  assert.ok(hasMeaningfulNodeText(node("1:1", "TEXT", { characters: "Hello World" })));
});

test("hasMeaningfulNodeText returns false for empty text", () => {
  assert.ok(!hasMeaningfulNodeText(node("1:1", "TEXT", { characters: "" })));
  assert.ok(!hasMeaningfulNodeText(node("1:1", "TEXT", { characters: "  " })));
});

test("hasMeaningfulNodeText returns false for missing characters", () => {
  assert.ok(!hasMeaningfulNodeText(node("1:1", "TEXT")));
});

// ── Unit: isDepthSemanticNode ────────────────────────────────────────────────

test("isDepthSemanticNode returns true for TEXT with meaningful text", () => {
  const n = node("1:1", "TEXT", { characters: "Submit" });
  assert.ok(isDepthSemanticNode(n, stubDetermineElementType));
});

test("isDepthSemanticNode returns false for hidden node", () => {
  const n = node("1:1", "TEXT", { visible: false, characters: "Submit" });
  assert.ok(!isDepthSemanticNode(n, stubDetermineElementType));
});

test("isDepthSemanticNode returns true for button-named node", () => {
  const n = node("1:1", "FRAME", { name: "Primary Button" });
  assert.ok(isDepthSemanticNode(n, stubDetermineElementType));
});

test("isDepthSemanticNode returns false for generic container", () => {
  const n = node("1:1", "FRAME", { name: "Container" });
  assert.ok(!isDepthSemanticNode(n, stubDetermineElementType));
});

// ── Unit: analyzeDepthPressure ───────────────────────────────────────────────

test("analyzeDepthPressure builds depth maps", () => {
  const nodes: TreeFigmaNode[] = [
    node("1:1", "FRAME", {
      children: [
        node("1:2", "TEXT", { characters: "Hello" }),
        node("1:3", "FRAME", {
          children: [node("1:4", "TEXT", { characters: "World" })]
        })
      ]
    })
  ];

  const analysis = analyzeDepthPressure(nodes, stubDetermineElementType);
  assert.ok(analysis.nodeCountByDepth.get(0)! >= 1);
  assert.ok(analysis.nodeCountByDepth.get(1)! >= 2);
  assert.ok(analysis.subtreeHasSemanticById.get("1:1"));
});

test("analyzeDepthPressure skips hidden nodes", () => {
  const nodes: TreeFigmaNode[] = [
    node("1:1", "FRAME", {
      visible: false,
      children: [node("1:2", "TEXT", { characters: "Hidden" })]
    })
  ];

  const analysis = analyzeDepthPressure(nodes, stubDetermineElementType);
  assert.equal(analysis.nodeCountByDepth.size, 0);
});

// ── Unit: shouldTruncateChildrenByDepth ──────────────────────────────────────

const makeContext = (overrides: Partial<ScreenDepthBudgetContext> = {}): ScreenDepthBudgetContext => ({
  screenElementBudget: DEFAULT_SCREEN_ELEMENT_BUDGET,
  configuredMaxDepth: DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
  mappedElementCount: 0,
  nodeCountByDepth: new Map(),
  semanticCountByDepth: new Map(),
  subtreeHasSemanticById: new Map(),
  truncatedBranchCount: 0,
  ...overrides
});

test("shouldTruncateChildrenByDepth returns false for leaf node", () => {
  assert.ok(
    !shouldTruncateChildrenByDepth({
      node: node("1:1", "TEXT"),
      depth: 0,
      elementType: "text",
      context: makeContext()
    })
  );
});

test("shouldTruncateChildrenByDepth returns false within budget at normal depth", () => {
  const n = node("1:1", "FRAME", {
    children: [node("1:2", "TEXT")]
  });
  assert.ok(
    !shouldTruncateChildrenByDepth({
      node: n,
      depth: 5,
      elementType: "container",
      context: makeContext()
    })
  );
});

test("shouldTruncateChildrenByDepth returns true beyond max depth with no budget", () => {
  const n = node("1:1", "FRAME", {
    children: [node("1:2", "TEXT")]
  });
  assert.ok(
    shouldTruncateChildrenByDepth({
      node: n,
      depth: DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
      elementType: "container",
      context: makeContext({ mappedElementCount: DEFAULT_SCREEN_ELEMENT_BUDGET })
    })
  );
});

test("shouldTruncateChildrenByDepth preserves semantic nodes beyond max depth with remaining budget", () => {
  const n = node("1:1", "FRAME", {
    children: [node("1:2", "TEXT", { characters: "Important" })]
  });
  const context = makeContext({
    subtreeHasSemanticById: new Map([["1:1", true]]),
    nodeCountByDepth: new Map([[DEFAULT_SCREEN_ELEMENT_MAX_DEPTH + 1, 5]])
  });
  assert.ok(
    !shouldTruncateChildrenByDepth({
      node: n,
      depth: DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
      elementType: "text",
      context
    })
  );
});

// ── E2E: Figma file round-trip ───────────────────────────────────────────────

const FIGMA_BOARD_KEY = process.env.FIGMA_BOARD_KEY ?? "";
const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN ?? "";

const shouldRunE2E = FIGMA_BOARD_KEY.length > 0 && FIGMA_ACCESS_TOKEN.length > 0;

test("E2E: tree traversal functions work on real Figma file", { skip: !shouldRunE2E }, async () => {
  const url = `https://api.figma.com/v1/files/${FIGMA_BOARD_KEY}?geometry=paths`;
  const response = await fetch(url, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  });

  assert.ok(response.ok, `Figma API responded with ${response.status}`);
  const figmaFile = (await response.json()) as { document: TreeFigmaNode };

  // countSubtreeNodes: the document should have at least some nodes
  const totalNodes = countSubtreeNodes(figmaFile.document);
  assert.ok(totalNodes >= 1, `Expected at least 1 node, got ${totalNodes}`);

  // collectNodes: should find at least the root node
  const allNodes = collectNodes(figmaFile.document, () => true);
  assert.ok(allNodes.length >= 1, `Expected at least 1 visible node, got ${allNodes.length}`);

  // collectNodes: TEXT nodes should be a subset of all
  const textNodes = collectNodes(figmaFile.document, (n) => n.type === "TEXT");
  assert.ok(textNodes.length <= allNodes.length);

  // analyzeDepthPressure: should produce valid analysis
  const pages = figmaFile.document.children ?? [];
  if (pages.length > 0) {
    const firstPage = pages[0];
    const screenCandidates = (firstPage.children ?? []).filter(
      (child) => child.type === "FRAME" || child.type === "COMPONENT" || child.type === "SECTION"
    );
    if (screenCandidates.length > 0) {
      const firstScreen = screenCandidates[0];
      const analysis = analyzeDepthPressure(firstScreen.children ?? [], stubDetermineElementType);

      assert.ok(analysis.nodeCountByDepth instanceof Map);
      assert.ok(analysis.semanticCountByDepth instanceof Map);
      assert.ok(analysis.subtreeHasSemanticById instanceof Map);

      // depth 0 should have entries if there are children
      if ((firstScreen.children ?? []).length > 0) {
        assert.ok(
          (analysis.nodeCountByDepth.get(0) ?? 0) > 0,
          "Expected depth-0 node count > 0"
        );
      }

      // shouldTruncateChildrenByDepth: with full budget, should not truncate
      const result = shouldTruncateChildrenByDepth({
        node: firstScreen,
        depth: 0,
        elementType: "container",
        context: {
          screenElementBudget: DEFAULT_SCREEN_ELEMENT_BUDGET,
          configuredMaxDepth: DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
          mappedElementCount: 0,
          nodeCountByDepth: analysis.nodeCountByDepth,
          semanticCountByDepth: analysis.semanticCountByDepth,
          subtreeHasSemanticById: analysis.subtreeHasSemanticById,
          truncatedBranchCount: 0
        }
      });
      // At depth 0 with full budget, truncation should not happen
      assert.equal(result, false, "Should not truncate at depth 0 with full budget");
    }
  }

  // Verify constants are consistent
  assert.equal(DEFAULT_SCREEN_ELEMENT_BUDGET, 1_200);
  assert.equal(DEFAULT_SCREEN_ELEMENT_MAX_DEPTH, 14);
});

// ── Stress: deep tree does not cause stack overflow ──────────────────────────

const buildDeepChain = (depth: number): TreeFigmaNode => {
  let current: TreeFigmaNode = { id: `n:${depth}`, type: "TEXT", characters: "Leaf" };
  for (let i = depth - 1; i >= 0; i--) {
    current = { id: `n:${i}`, type: "FRAME", name: i === 0 ? "Button Root" : `Frame-${i}`, children: [current] };
  }
  return current;
};

test("countSubtreeNodes handles 10 000-deep tree without stack overflow", () => {
  const root = buildDeepChain(10_000);
  assert.equal(countSubtreeNodes(root), 10_001);
});

test("collectNodes handles 10 000-deep tree without stack overflow", () => {
  const root = buildDeepChain(10_000);
  const textNodes = collectNodes(root, (n) => n.type === "TEXT");
  assert.equal(textNodes.length, 1);
  assert.equal(textNodes[0].id, "n:10000");
});

test("analyzeDepthPressure handles 10 000-deep tree without stack overflow", () => {
  const root = buildDeepChain(10_000);
  const analysis = analyzeDepthPressure([root], stubDetermineElementType);
  assert.ok(analysis.nodeCountByDepth.size > 0);
  assert.ok(analysis.subtreeHasSemanticById.get("n:0"), "Root subtree should have semantic (leaf TEXT)");
  assert.ok(analysis.subtreeHasSemanticById.get("n:10000"), "Leaf TEXT node should be semantic");
});
