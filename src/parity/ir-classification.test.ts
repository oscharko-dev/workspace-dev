// ---------------------------------------------------------------------------
// ir-classification.test.ts — Tests for the data-driven classification engine
// Validates declarative rule evaluation, priority ordering, and behavioral parity
// ---------------------------------------------------------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasAnySubstring,
  hasAnyWord,
  isIconLikeNodeName,
  classifyElementTypeFromNode,
  classifyElementTypeFromSemanticHint,
  NODE_CLASSIFICATION_RULES,
  SEMANTIC_CLASSIFICATION_RULES
} from "./ir-classification.js";
import type {
  ClassificationRule,
  SemanticClassificationRule
} from "./ir-classification.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestNodeInput {
  type?: string;
  name?: string;
  children?: TestNodeInput[];
  characters?: string;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  cornerRadius?: number;
}

interface TestNode extends TestNodeInput {
  id: string;
  type: string;
}

const makeNode = (overrides: TestNodeInput = {}): TestNode => ({
  id: "test-node-1",
  type: overrides.type ?? "FRAME",
  ...overrides
});

const NO_FILL_DEPS = {
  hasSolidFill: () => false,
  hasGradientFill: () => false,
  hasImageFill: () => false,
  hasVisibleShadow: () => false,
  hasStroke: () => false
};

const WITH_SOLID_FILL = {
  ...NO_FILL_DEPS,
  hasSolidFill: () => true
};

const WITH_IMAGE_FILL = {
  ...NO_FILL_DEPS,
  hasImageFill: () => true
};

const WITH_STROKE = {
  ...NO_FILL_DEPS,
  hasStroke: () => true
};

const WITH_SHADOW = {
  ...NO_FILL_DEPS,
  hasVisibleShadow: () => true
};

const classify = (node: TestNode, deps = NO_FILL_DEPS) =>
  classifyElementTypeFromNode({ node, dependencies: deps });

// ---------------------------------------------------------------------------
// String matching utilities
// ---------------------------------------------------------------------------

describe("hasAnySubstring", () => {
  it("returns true when value contains a token", () => {
    assert.equal(hasAnySubstring("muibuttonbase", ["button", "cta"]), true);
  });

  it("returns false when no token matches", () => {
    assert.equal(hasAnySubstring("headertext", ["button", "cta"]), false);
  });

  it("returns false for empty tokens", () => {
    assert.equal(hasAnySubstring("anything", []), false);
  });
});

describe("hasAnyWord", () => {
  it("matches whole words", () => {
    assert.equal(hasAnyWord("my button element", ["button"]), true);
  });

  it("does not match partial words", () => {
    assert.equal(hasAnyWord("buttonbase", ["button"]), false);
  });

  it("is case-insensitive", () => {
    assert.equal(hasAnyWord("My Button", ["button"]), true);
  });
});

describe("isIconLikeNodeName", () => {
  it("detects muisvgiconroot", () => {
    assert.equal(isIconLikeNodeName("muisvgiconroot"), true);
  });

  it("detects icon prefix patterns", () => {
    assert.equal(isIconLikeNodeName("ic_home"), true);
    assert.equal(isIconLikeNodeName("icon/menu"), true);
    assert.equal(isIconLikeNodeName("icons/close"), true);
    assert.equal(isIconLikeNodeName("icon-arrow"), true);
    assert.equal(isIconLikeNodeName("icon_search"), true);
  });

  it("detects word boundary 'icon'", () => {
    assert.equal(isIconLikeNodeName("my icon element"), true);
  });

  it("rejects non-icon names", () => {
    assert.equal(isIconLikeNodeName("imageholder"), false);
  });
});

// ---------------------------------------------------------------------------
// Rule data structure validation
// ---------------------------------------------------------------------------

describe("NODE_CLASSIFICATION_RULES data integrity", () => {
  it("has no duplicate priorities", () => {
    const priorities = NODE_CLASSIFICATION_RULES.map((r) => r.priority);
    const unique = new Set(priorities);
    assert.equal(unique.size, priorities.length, "Each rule must have a unique priority");
  });

  it("every rule has at least one matching condition", () => {
    for (const rule of NODE_CLASSIFICATION_RULES) {
      const hasCondition =
        rule.nodeTypes !== undefined ||
        rule.keywords !== undefined ||
        rule.words !== undefined ||
        rule.requires !== undefined;
      assert.ok(hasCondition, `Rule type=${rule.type} priority=${rule.priority} has no matching condition`);
    }
  });

  it("covers all expected element types", () => {
    const ruleTypes = new Set(NODE_CLASSIFICATION_RULES.map((r) => r.type));
    const expectedTypes = [
      "text", "select", "slider", "rating", "skeleton", "input",
      "switch", "checkbox", "radio", "chip", "tab", "progress",
      "avatar", "badge", "divider", "appbar", "drawer", "breadcrumbs",
      "tooltip", "table", "navigation", "snackbar", "dialog", "stepper",
      "list", "grid", "card", "paper", "stack", "button", "image"
    ];
    for (const expected of expectedTypes) {
      assert.ok(ruleTypes.has(expected as ClassificationRule["type"]), `Missing rule for type: ${expected}`);
    }
  });

  it("rules are JSON-serializable", () => {
    const serialized = JSON.stringify(NODE_CLASSIFICATION_RULES);
    const deserialized = JSON.parse(serialized) as ClassificationRule[];
    assert.equal(deserialized.length, NODE_CLASSIFICATION_RULES.length);
  });
});

describe("SEMANTIC_CLASSIFICATION_RULES data integrity", () => {
  it("has no duplicate priorities", () => {
    const priorities = SEMANTIC_CLASSIFICATION_RULES.map((r) => r.priority);
    const unique = new Set(priorities);
    assert.equal(unique.size, priorities.length, "Each rule must have a unique priority");
  });

  it("every rule has a name matching condition", () => {
    for (const rule of SEMANTIC_CLASSIFICATION_RULES) {
      const hasCondition = rule.keywords !== undefined || rule.words !== undefined;
      assert.ok(hasCondition, `Semantic rule type=${rule.type} priority=${rule.priority} has no matching condition`);
    }
  });

  it("rules are JSON-serializable", () => {
    const serialized = JSON.stringify(SEMANTIC_CLASSIFICATION_RULES);
    const deserialized = JSON.parse(serialized) as SemanticClassificationRule[];
    assert.equal(deserialized.length, SEMANTIC_CLASSIFICATION_RULES.length);
  });
});

// ---------------------------------------------------------------------------
// Node classification — primitive types
// ---------------------------------------------------------------------------

describe("classifyElementTypeFromNode", () => {
  describe("text nodes", () => {
    it("classifies TEXT node type as text", () => {
      assert.equal(classify(makeNode({ type: "TEXT" })), "text");
    });

    it("classifies TEXT regardless of name", () => {
      assert.equal(classify(makeNode({ type: "TEXT", name: "button" })), "text");
    });
  });

  // ---------------------------------------------------------------------------
  // Form controls
  // ---------------------------------------------------------------------------

  describe("select", () => {
    it("classifies by semantic keyword + field sizing", () => {
      assert.equal(
        classify(makeNode({
          name: "muiselect-root",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 }
        })),
        "select"
      );
    });

    it("classifies by word match + children", () => {
      assert.equal(
        classify(makeNode({
          name: "my select field",
          children: [{ id: "c1", type: "TEXT" }]
        })),
        "select"
      );
    });

    it("classifies dropdown keyword", () => {
      assert.equal(
        classify(makeNode({
          name: "dropdown menu",
          children: [{ id: "c1", type: "TEXT" }]
        })),
        "select"
      );
    });
  });

  describe("input", () => {
    it("classifies by semantic keyword + field sizing", () => {
      assert.equal(
        classify(makeNode({
          name: "muiformcontrolroot",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 }
        })),
        "input"
      );
    });

    it("classifies by word match + children", () => {
      assert.equal(
        classify(makeNode({
          name: "text input field",
          children: [{ id: "c1", type: "TEXT" }]
        })),
        "input"
      );
    });
  });

  describe("slider", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muislider-thumb" })), "slider");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "volume slider" })), "slider");
    });
  });

  describe("rating", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muirating-root" })), "rating");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "star rating component" })), "rating");
    });
  });

  describe("skeleton", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muiskeleton" })), "skeleton");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "loading skeleton" })), "skeleton");
    });
  });

  describe("switch", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muiswitch-root" })), "switch");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "dark mode toggle" })), "switch");
    });
  });

  describe("checkbox", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muicheckbox" })), "checkbox");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "agree checkbox" })), "checkbox");
    });
  });

  describe("radio", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muiradio" })), "radio");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "option radio" })), "radio");
    });
  });

  // ---------------------------------------------------------------------------
  // Simple keyword components
  // ---------------------------------------------------------------------------

  describe("chip", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muichip-label" })), "chip");
    });
  });

  describe("tab", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muitabs-root" })), "tab");
    });
  });

  describe("progress", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muicircularprogress" })), "progress");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "loading spinner" })), "progress");
    });
  });

  describe("avatar", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muiavatar" })), "avatar");
    });
  });

  describe("badge", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muibadge" })), "badge");
    });
  });

  // ---------------------------------------------------------------------------
  // Layout & structural components
  // ---------------------------------------------------------------------------

  describe("divider", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muidivider" })), "divider");
    });

    it("classifies by geometry (horizontal line)", () => {
      assert.equal(
        classify(
          makeNode({
            name: "line",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 1 }
          }),
          WITH_SOLID_FILL
        ),
        "divider"
      );
    });

    it("classifies by geometry (vertical line)", () => {
      assert.equal(
        classify(
          makeNode({
            name: "separator-v",
            absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 100 }
          }),
          WITH_SOLID_FILL
        ),
        "divider"
      );
    });
  });

  describe("appbar", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muiappbar" })), "appbar");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "main toolbar" })), "appbar");
    });
  });

  describe("drawer", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muidrawer" })), "drawer");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "navigation sidebar" })), "drawer");
    });
  });

  describe("breadcrumbs", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muibreadcrumbs" })), "breadcrumbs");
    });
  });

  describe("tooltip", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muitooltip" })), "tooltip");
    });
  });

  describe("table", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "data table view" })), "table");
    });

    it("classifies by structural analysis", () => {
      assert.equal(
        classify(makeNode({
          name: "data-container",
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
          children: [
            { id: "r1", type: "FRAME", children: [{ id: "c1", type: "TEXT" }, { id: "c2", type: "TEXT" }] },
            { id: "r2", type: "FRAME", children: [{ id: "c3", type: "TEXT" }, { id: "c4", type: "TEXT" }] }
          ]
        })),
        "table"
      );
    });
  });

  describe("navigation", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "bottomnavigation" })), "navigation");
    });
  });

  describe("snackbar", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muisnackbar" })), "snackbar");
    });

    it("classifies by word", () => {
      assert.equal(classify(makeNode({ name: "toast notification" })), "snackbar");
    });
  });

  describe("dialog", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muidialog" })), "dialog");
    });
  });

  describe("stepper", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muistepper" })), "stepper");
    });
  });

  describe("list", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muilist" })), "list");
    });

    it("classifies by child name heuristic", () => {
      assert.equal(
        classify(makeNode({
          name: "menu-items",
          children: [
            { id: "li1", type: "FRAME", name: "listitem-1" },
            { id: "li2", type: "FRAME", name: "listitem-2" }
          ]
        })),
        "list"
      );
    });

    it("classifies by structural list analysis", () => {
      assert.equal(
        classify(makeNode({
          name: "content-section",
          layoutMode: "VERTICAL",
          children: [
            { id: "t1", type: "TEXT", characters: "Item 1" },
            { id: "t2", type: "TEXT", characters: "Item 2" },
            { id: "t3", type: "TEXT", characters: "Item 3" }
          ]
        })),
        "list"
      );
    });
  });

  describe("grid", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muigrid-container" })), "grid");
    });

    it("classifies by structural grid analysis", () => {
      assert.equal(
        classify(makeNode({
          name: "items",
          layoutMode: "HORIZONTAL",
          children: [
            { id: "g1", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } },
            { id: "g2", type: "FRAME", absoluteBoundingBox: { x: 120, y: 0, width: 100, height: 100 } },
            { id: "g3", type: "FRAME", absoluteBoundingBox: { x: 0, y: 120, width: 100, height: 100 } },
            { id: "g4", type: "FRAME", absoluteBoundingBox: { x: 120, y: 120, width: 100, height: 100 } }
          ]
        })),
        "grid"
      );
    });
  });

  describe("card", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muicard-root" })), "card");
    });

    it("classifies by geometry heuristic (rounded + visual surface + children)", () => {
      assert.equal(
        classify(
          makeNode({
            name: "content-block",
            cornerRadius: 12,
            absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
            children: [{ id: "c1", type: "TEXT" }]
          }),
          WITH_SOLID_FILL
        ),
        "card"
      );
    });
  });

  describe("paper", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muipaper" })), "paper");
    });

    it("classifies visual surface container (not card)", () => {
      assert.equal(
        classify(
          makeNode({
            name: "section",
            children: [{ id: "c1", type: "TEXT" }]
          }),
          WITH_SOLID_FILL
        ),
        "paper"
      );
    });

    it("excludes containers with 'card' in name from paper fallback", () => {
      const result = classify(
        makeNode({
          name: "my card container",
          children: [{ id: "c1", type: "TEXT" }]
        }),
        WITH_SOLID_FILL
      );
      assert.equal(result, "card");
    });
  });

  describe("stack", () => {
    it("classifies by keyword", () => {
      assert.equal(classify(makeNode({ name: "muistack" })), "stack");
    });

    it("classifies layout container without visual surface", () => {
      assert.equal(
        classify(makeNode({
          name: "layout-wrapper",
          layoutMode: "VERTICAL",
          children: [{ id: "c1", type: "TEXT" }]
        })),
        "stack"
      );
    });

    it("does not classify as stack when visual surface present", () => {
      const result = classify(
        makeNode({
          name: "styled-container",
          layoutMode: "VERTICAL",
          children: [{ id: "c1", type: "TEXT" }]
        }),
        WITH_SOLID_FILL
      );
      assert.notEqual(result, "stack");
    });
  });

  // ---------------------------------------------------------------------------
  // Button
  // ---------------------------------------------------------------------------

  describe("button", () => {
    it("classifies CTA keyword", () => {
      assert.equal(classify(makeNode({ name: "primary-cta-action" })), "button");
    });

    it("classifies button keyword + visual surface", () => {
      assert.equal(
        classify(
          makeNode({ name: "submit button" }),
          WITH_SOLID_FILL
        ),
        "button"
      );
    });

    it("classifies button keyword + stroke", () => {
      assert.equal(
        classify(
          makeNode({ name: "outlined button" }),
          WITH_STROKE
        ),
        "button"
      );
    });

    it("classifies button keyword + rounded corners", () => {
      assert.equal(
        classify(makeNode({ name: "submit button", cornerRadius: 12 })),
        "button"
      );
    });

    it("classifies button keyword + label hint", () => {
      assert.equal(
        classify(makeNode({ name: "button zur übersicht" })),
        "button"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Image
  // ---------------------------------------------------------------------------

  describe("image", () => {
    it("classifies RECTANGLE with image fill", () => {
      assert.equal(
        classify(
          makeNode({ type: "RECTANGLE", name: "photo-bg" }),
          WITH_IMAGE_FILL
        ),
        "image"
      );
    });

    it("classifies FRAME with image fill (no children)", () => {
      assert.equal(
        classify(
          makeNode({ type: "FRAME", name: "hero-bg" }),
          WITH_IMAGE_FILL
        ),
        "image"
      );
    });

    it("does not classify icon-named nodes as image", () => {
      assert.notEqual(
        classify(
          makeNode({ type: "VECTOR", name: "icon-arrow" }),
          WITH_IMAGE_FILL
        ),
        "image"
      );
    });

    it("classifies by strong image name", () => {
      assert.equal(
        classify(makeNode({ type: "RECTANGLE", name: "hero image banner" })),
        "image"
      );
    });

    it("does not classify VECTOR with image name as image when icon-like", () => {
      assert.notEqual(
        classify(makeNode({ type: "VECTOR", name: "icon illustration" })),
        "image"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Default fallback
  // ---------------------------------------------------------------------------

  describe("fallback", () => {
    it("returns container for unrecognized nodes", () => {
      assert.equal(classify(makeNode({ name: "unknown-element" })), "container");
    });

    it("returns container for empty FRAME", () => {
      assert.equal(classify(makeNode({ type: "FRAME", name: "wrapper" })), "container");
    });
  });

  // ---------------------------------------------------------------------------
  // Priority ordering
  // ---------------------------------------------------------------------------

  describe("priority ordering", () => {
    it("text takes priority over button keyword in name", () => {
      assert.equal(classify(makeNode({ type: "TEXT", name: "button-label" })), "text");
    });

    it("select takes priority over input when both keywords present", () => {
      assert.equal(
        classify(makeNode({
          name: "muiselect input field",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 }
        })),
        "select"
      );
    });

    it("card keyword takes priority over card geometry", () => {
      assert.equal(
        classify(
          makeNode({
            name: "product card",
            cornerRadius: 12,
            absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
            children: [{ id: "c1", type: "TEXT" }]
          }),
          WITH_SOLID_FILL
        ),
        "card"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Semantic hint classification
// ---------------------------------------------------------------------------

describe("classifyElementTypeFromSemanticHint", () => {
  it("returns undefined for empty hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: undefined, semanticType: undefined }), undefined);
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "", semanticType: "" }), undefined);
  });

  it("classifies text hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "headline", semanticType: undefined }), "text");
  });

  it("classifies input hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "textfield", semanticType: undefined }), "input");
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "email input", semanticType: undefined }), "input");
  });

  it("classifies select hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "country select", semanticType: undefined }), "select");
  });

  it("classifies button hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: undefined, semanticType: "button" }), "button");
  });

  it("classifies card hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "product card", semanticType: undefined }), "card");
  });

  it("classifies table hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "data table", semanticType: undefined }), "table");
  });

  it("classifies dialog hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "confirm dialog", semanticType: undefined }), "dialog");
  });

  it("classifies image hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "profile photo", semanticType: undefined }), "image");
  });

  it("classifies appbar by keyword match", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "main appbar", semanticType: undefined }), "appbar");
  });

  it("classifies appbar by word match (toolbar)", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "toolbar", semanticType: undefined }), "appbar");
  });

  it("combines semanticName and semanticType", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "confirm", semanticType: "dialog" }), "dialog");
  });

  it("returns undefined for non-matching hints", () => {
    assert.equal(classifyElementTypeFromSemanticHint({ semanticName: "wrapper", semanticType: "container" }), undefined);
  });
});

// ---------------------------------------------------------------------------
// Rule extensibility validation
// ---------------------------------------------------------------------------

describe("rule extensibility", () => {
  it("rules can be spread and extended", () => {
    const customRules: ClassificationRule[] = [
      ...NODE_CLASSIFICATION_RULES,
      { type: "card", priority: 999, words: ["custom-widget"] }
    ];
    assert.ok(customRules.length > NODE_CLASSIFICATION_RULES.length);
  });

  it("semantic rules can be spread and extended", () => {
    const customRules: SemanticClassificationRule[] = [
      ...SEMANTIC_CLASSIFICATION_RULES,
      { type: "chip", priority: 999, words: ["tag"] }
    ];
    assert.ok(customRules.length > SEMANTIC_CLASSIFICATION_RULES.length);
  });
});
