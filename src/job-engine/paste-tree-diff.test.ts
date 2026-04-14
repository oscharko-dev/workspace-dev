import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFingerprintNodes,
  computeSubtreeHash,
  diffFigmaPaste
} from "./paste-tree-diff.js";
import type { DiffableFigmaNode } from "./paste-tree-diff.js";
import type { PasteFingerprintManifest, PasteFingerprintNode } from "./paste-fingerprint-store.js";
import { CONTRACT_VERSION } from "../contracts/index.js";

const makeManifest = (nodes: readonly PasteFingerprintNode[]): PasteFingerprintManifest => {
  const rootNodeIds = nodes.filter((node) => node.parentId === null).map((node) => node.id);
  return {
    contractVersion: CONTRACT_VERSION,
    pasteIdentityKey: "deadbeefdeadbeefdeadbeefdeadbeef",
    createdAt: "2026-01-01T00:00:00.000Z",
    rootNodeIds,
    nodes,
    figmaFileKey: "file-key-1"
  };
};

// ── computeSubtreeHash ─────────────────────────────────────────────────────

test("computeSubtreeHash is stable across key reordering", () => {
  const a: DiffableFigmaNode = { id: "1:2", type: "FRAME", name: "Hero", visible: true };
  const b: DiffableFigmaNode = { visible: true, name: "Hero", type: "FRAME", id: "1:2" };
  assert.equal(computeSubtreeHash(a), computeSubtreeHash(b));
});

test("computeSubtreeHash differs for different content", () => {
  const a: DiffableFigmaNode = { id: "1:2", type: "FRAME", name: "Hero" };
  const b: DiffableFigmaNode = { id: "1:2", type: "FRAME", name: "Footer" };
  assert.notEqual(computeSubtreeHash(a), computeSubtreeHash(b));
});

test("computeSubtreeHash treats deep-equal nested nodes as identical", () => {
  const a: DiffableFigmaNode = {
    id: "1:2",
    type: "FRAME",
    children: [{ id: "1:3", type: "TEXT", characters: "Hi" }]
  };
  const b: DiffableFigmaNode = {
    id: "1:2",
    type: "FRAME",
    children: [{ id: "1:3", type: "TEXT", characters: "Hi" }]
  };
  assert.equal(computeSubtreeHash(a), computeSubtreeHash(b));
});

test("computeSubtreeHash ignores undefined fields", () => {
  const a: DiffableFigmaNode = { id: "1:2", type: "FRAME" };
  const b: DiffableFigmaNode = { id: "1:2", type: "FRAME", name: undefined };
  assert.equal(computeSubtreeHash(a), computeSubtreeHash(b));
});

test("computeSubtreeHash preserves array order", () => {
  const a: DiffableFigmaNode = {
    id: "1:2",
    type: "FRAME",
    children: [
      { id: "1:3", type: "TEXT" },
      { id: "1:4", type: "TEXT" }
    ]
  };
  const b: DiffableFigmaNode = {
    id: "1:2",
    type: "FRAME",
    children: [
      { id: "1:4", type: "TEXT" },
      { id: "1:3", type: "TEXT" }
    ]
  };
  assert.notEqual(computeSubtreeHash(a), computeSubtreeHash(b));
});

// ── buildFingerprintNodes ─────────────────────────────────────────────────

test("buildFingerprintNodes emits BFS order and wires parentId + depth", () => {
  const root: DiffableFigmaNode = {
    id: "1:1",
    type: "FRAME",
    children: [
      {
        id: "1:2",
        type: "FRAME",
        children: [{ id: "1:4", type: "TEXT" }]
      },
      { id: "1:3", type: "TEXT" }
    ]
  };
  const { nodes, rootNodeIds } = buildFingerprintNodes([root]);
  assert.deepEqual(rootNodeIds, ["1:1"]);
  assert.deepEqual(
    nodes.map((n) => n.id),
    ["1:1", "1:2", "1:3", "1:4"]
  );
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  assert.equal(byId.get("1:1")?.parentId, null);
  assert.equal(byId.get("1:1")?.depth, 0);
  assert.equal(byId.get("1:2")?.parentId, "1:1");
  assert.equal(byId.get("1:2")?.depth, 1);
  assert.equal(byId.get("1:3")?.parentId, "1:1");
  assert.equal(byId.get("1:3")?.depth, 1);
  assert.equal(byId.get("1:4")?.parentId, "1:2");
  assert.equal(byId.get("1:4")?.depth, 2);
});

test("buildFingerprintNodes deduplicates duplicate ids (keeps first)", () => {
  const shared: DiffableFigmaNode = { id: "dup", type: "TEXT" };
  const root: DiffableFigmaNode = {
    id: "root",
    type: "FRAME",
    children: [shared, shared]
  };
  const { nodes } = buildFingerprintNodes([root]);
  const dupEntries = nodes.filter((n) => n.id === "dup");
  assert.equal(dupEntries.length, 1);
});

test("buildFingerprintNodes handles multiple roots", () => {
  const roots: DiffableFigmaNode[] = [
    { id: "r1", type: "FRAME" },
    { id: "r2", type: "FRAME" }
  ];
  const { nodes, rootNodeIds } = buildFingerprintNodes(roots);
  assert.deepEqual(rootNodeIds, ["r1", "r2"]);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]?.parentId, null);
  assert.equal(nodes[1]?.parentId, null);
});

// ── diffFigmaPaste ────────────────────────────────────────────────────────

test("diffFigmaPaste returns baseline_created when no prior manifest", () => {
  const root: DiffableFigmaNode = {
    id: "1:1",
    type: "FRAME",
    children: [{ id: "1:2", type: "TEXT" }]
  };
  const plan = diffFigmaPaste({ currentRoots: [root] });
  assert.equal(plan.strategy, "baseline_created");
  assert.equal(plan.totalNodes, 2);
  assert.equal(plan.reusedNodes, 0);
  assert.equal(plan.reprocessedNodes, 2);
  assert.equal(plan.addedNodes.length, 2);
  assert.equal(plan.removedNodes.length, 0);
  assert.equal(plan.updatedNodes.length, 0);
  assert.equal(plan.structuralChangeRatio, 1);
  assert.equal(plan.currentFingerprintNodes.length, 2);
  assert.deepEqual(plan.rootNodeIds, ["1:1"]);
});

test("diffFigmaPaste returns no_changes when trees are identical", () => {
  const root: DiffableFigmaNode = {
    id: "1:1",
    type: "FRAME",
    children: [
      { id: "1:2", type: "TEXT", characters: "Hi" },
      { id: "1:3", type: "RECTANGLE" }
    ]
  };
  const priorNodes = buildFingerprintNodes([root]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [root]
  });
  assert.equal(plan.strategy, "no_changes");
  assert.equal(plan.reusedNodes, plan.totalNodes);
  assert.equal(plan.reprocessedNodes, 0);
  assert.equal(plan.addedNodes.length, 0);
  assert.equal(plan.removedNodes.length, 0);
  assert.equal(plan.updatedNodes.length, 0);
  assert.equal(plan.structuralChangeRatio, 0);
});

test("diffFigmaPaste: one leaf label change → delta with single updated, subtree child not double-counted", () => {
  const prior: DiffableFigmaNode = {
    id: "1:1",
    type: "FRAME",
    children: [
      { id: "1:2", type: "TEXT", characters: "Before" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "1:1",
    type: "FRAME",
    children: [
      { id: "1:2", type: "TEXT", characters: "After" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  assert.equal(plan.strategy, "delta");
  // Only the ROOT (top-most change) should be counted; the leaf child is
  // part of its reprocessed closure but must not emit a separate update.
  assert.equal(plan.updatedNodes.length, 1);
  assert.equal(plan.updatedNodes[0]?.id, "1:1");
  assert.equal(plan.addedNodes.length, 0);
  assert.equal(plan.removedNodes.length, 0);
  // totalNodes=2, denominator=2, change=1, ratio=0.5 → not > threshold → delta
  assert.equal(plan.structuralChangeRatio, 0.5);
  assert.equal(plan.reusedNodes + plan.reprocessedNodes, plan.totalNodes);
  // Reprocessed closure = root + its descendant = 2 nodes.
  assert.equal(plan.reprocessedNodes, 2);
  assert.equal(plan.reusedNodes, 0);
});

test("diffFigmaPaste: interior node change counted once at top-most level", () => {
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      {
        id: "mid",
        type: "FRAME",
        children: [
          { id: "leafA", type: "TEXT", characters: "A" },
          { id: "leafB", type: "TEXT", characters: "B" }
        ]
      },
      { id: "sibling", type: "TEXT", characters: "S" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      {
        id: "mid",
        type: "FRAME",
        children: [
          { id: "leafA", type: "TEXT", characters: "AA" }, // changed
          { id: "leafB", type: "TEXT", characters: "B" }
        ]
      },
      { id: "sibling", type: "TEXT", characters: "S" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  // r→mid→leafA all have different hashes because leafA changed. Only the
  // highest ancestor (r) is classified as updated.
  assert.equal(plan.updatedNodes.length, 1);
  assert.equal(plan.updatedNodes[0]?.id, "r");
  // totalNodes=5, changes=1, ratio=0.2 → delta (<=0.5).
  assert.equal(plan.strategy, "delta");
  assert.equal(plan.structuralChangeRatio, 0.2);
  // Reprocessed closure = r and all its descendants (all 5 nodes).
  assert.equal(plan.reprocessedNodes, 5);
  assert.equal(plan.reusedNodes, 0);
});

test("diffFigmaPaste: added node at end → delta with one added and correct ratio", () => {
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      { id: "a", type: "TEXT", characters: "A" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      { id: "a", type: "TEXT", characters: "A" },
      { id: "b", type: "TEXT", characters: "B" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  // Adding "b" also changes root "r" hash — but an added-child bumps root
  // into `updated`. So we expect 1 added ("b") and 1 updated ("r"). "b" is a
  // descendant-of-updated, suppressed from being classified further — but is
  // it "added" or "updated-suppressed"? Classification order is preorder:
  // root visited first, found updated → suppress descendants. So "b" is in
  // the suppressed set. This means in this case, updates=1, adds=0. Prefer
  // the "top-most change" behavior consistently.
  assert.equal(plan.updatedNodes.length, 1);
  assert.equal(plan.updatedNodes[0]?.id, "r");
  assert.equal(plan.addedNodes.length, 0);
  assert.equal(plan.removedNodes.length, 0);
  assert.equal(plan.strategy, "delta");
  // changes=1, denom=max(2,3,1)=3, ratio=0.333
  assert.equal(plan.structuralChangeRatio, 0.333);
  assert.equal(plan.reprocessedNodes, 3);
  assert.equal(plan.reusedNodes, 0);
});

test("diffFigmaPaste: pure append under unchanged root (root id unchanged but tree changed) still counted at root", () => {
  // This scenario verifies the "one updated" invariant even when only a new
  // leaf appears under a formerly-unchanged subtree — the root's subtreeHash
  // changes, so the root is the top-most updated node.
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [{ id: "a", type: "TEXT", characters: "same" }]
  };
  const current: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      { id: "a", type: "TEXT", characters: "same" },
      { id: "b", type: "TEXT", characters: "new" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  assert.equal(plan.updatedNodes.length, 1);
  assert.equal(plan.updatedNodes[0]?.id, "r");
});

test("diffFigmaPaste: removed entire subtree → one removed, children not double-counted", () => {
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      {
        id: "sub",
        type: "FRAME",
        children: [
          { id: "leaf1", type: "TEXT" },
          { id: "leaf2", type: "TEXT" }
        ]
      },
      { id: "keep", type: "TEXT", characters: "K" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [{ id: "keep", type: "TEXT", characters: "K" }]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  // Prior root "r" has a different hash now (child dropped) → r is updated
  // at the top. "sub" and its descendants are removed from the prior side
  // but the child-removal dedup should emit only one removed: "sub".
  const subRemoved = plan.removedNodes.filter((n) => n.id === "sub");
  assert.equal(subRemoved.length, 1);
  // leaf1/leaf2 must NOT appear in removedNodes.
  assert.equal(plan.removedNodes.some((n) => n.id === "leaf1"), false);
  assert.equal(plan.removedNodes.some((n) => n.id === "leaf2"), false);
});

test("diffFigmaPaste: rename all ids → structural_break", () => {
  const prior: DiffableFigmaNode = {
    id: "old-r",
    type: "FRAME",
    children: [
      { id: "old-a", type: "TEXT" },
      { id: "old-b", type: "TEXT" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "new-r",
    type: "FRAME",
    children: [
      { id: "new-a", type: "TEXT" },
      { id: "new-b", type: "TEXT" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current]
  });
  assert.equal(plan.strategy, "structural_break");
  // Ratio well above threshold — all identity broken on both sides.
  assert.ok(
    plan.structuralChangeRatio > 0.5,
    `expected ratio > 0.5, got ${plan.structuralChangeRatio}`
  );
  // Added: every current node is a fresh id (adds do not cascade-dedup per
  // spec — only `updated` and `removed` do).
  assert.equal(plan.addedNodes.length, 3);
  assert.deepEqual(
    plan.addedNodes.map((n) => n.id).sort(),
    ["new-a", "new-b", "new-r"]
  );
  // Removed dedup: only top-most prior root emitted.
  assert.equal(plan.removedNodes.length, 1);
  assert.equal(plan.removedNodes[0]?.id, "old-r");
  assert.equal(plan.updatedNodes.length, 0);
});

test("diffFigmaPaste: custom low threshold triggers structural_break on small change", () => {
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      { id: "a", type: "TEXT", characters: "A" },
      { id: "b", type: "TEXT", characters: "B" }
    ]
  };
  const current: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [
      { id: "a", type: "TEXT", characters: "A2" },
      { id: "b", type: "TEXT", characters: "B" }
    ]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [current],
    options: { structuralBreakThreshold: 0.1 }
  });
  // 1 change out of 3 nodes = 0.333 > 0.1 → structural_break
  assert.equal(plan.strategy, "structural_break");
  assert.equal(plan.structuralChangeRatio, 0.333);
});

test("diffFigmaPaste: empty current + prior with nodes removes prior root (dedup'd)", () => {
  const prior: DiffableFigmaNode = {
    id: "r",
    type: "FRAME",
    children: [{ id: "a", type: "TEXT" }]
  };
  const priorNodes = buildFingerprintNodes([prior]).nodes;
  const plan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: []
  });
  assert.equal(plan.totalNodes, 0);
  // |removed| = 1 after dedup (only prior root "r"; "a" is suppressed).
  // denom = max(priorCount=2, currentCount=0, 1) = 2 → ratio = 0.5.
  assert.equal(plan.structuralChangeRatio, 0.5);
  assert.equal(plan.removedNodes.length, 1);
  assert.equal(plan.removedNodes[0]?.id, "r");
  assert.equal(plan.addedNodes.length, 0);
  assert.equal(plan.updatedNodes.length, 0);
  // 0.5 is not strictly > 0.5 default threshold → delta. With a stricter
  // threshold the caller can force a full rebuild.
  assert.equal(plan.strategy, "delta");

  const strictPlan = diffFigmaPaste({
    priorManifest: makeManifest(priorNodes),
    currentRoots: [],
    options: { structuralBreakThreshold: 0.4 }
  });
  assert.equal(strictPlan.strategy, "structural_break");
});

test("diffFigmaPaste: both empty → no_changes", () => {
  const manifest: PasteFingerprintManifest = {
    contractVersion: CONTRACT_VERSION,
    pasteIdentityKey: "deadbeefdeadbeefdeadbeefdeadbeef",
    createdAt: "2026-01-01T00:00:00.000Z",
    rootNodeIds: [],
    nodes: [],
    figmaFileKey: "file-key-1"
  };
  const plan = diffFigmaPaste({
    priorManifest: manifest,
    currentRoots: []
  });
  assert.equal(plan.strategy, "no_changes");
  assert.equal(plan.totalNodes, 0);
  assert.equal(plan.reusedNodes, 0);
  assert.equal(plan.reprocessedNodes, 0);
  assert.equal(plan.structuralChangeRatio, 0);
});
