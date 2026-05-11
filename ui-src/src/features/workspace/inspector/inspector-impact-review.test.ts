import { describe, expect, it } from "vitest";
import { deriveInspectorImpactReviewModel } from "./inspector-impact-review";

describe("deriveInspectorImpactReviewModel", () => {
  it("returns empty state for drafts without overrides", () => {
    const model = deriveInspectorImpactReviewModel({
      entries: [],
      manifest: {
        screens: [
          {
            screenId: "screen-home",
            screenName: "Home",
            file: "src/screens/Home.tsx",
            components: []
          }
        ]
      }
    });

    expect(model.empty).toBe(true);
    expect(model.summary).toEqual({
      totalOverrides: 0,
      affectedFiles: 0,
      mappedOverrides: 0,
      unmappedOverrides: 0,
      categories: {
        visual: 0,
        layout: 0,
        validation: 0,
        other: 0
      }
    });
    expect(model.files).toEqual([]);
    expect(model.unmapped).toEqual([]);
  });

  it("groups mixed visual, layout, and validation overrides at file level and tracks unmapped entries", () => {
    const model = deriveInspectorImpactReviewModel({
      entries: [
        { nodeId: "node-a", field: "fillColor" },
        { nodeId: "node-a", field: "validationMessage" },
        { nodeId: "screen-home", field: "gap" },
        { nodeId: "node-a", field: "width" },
        { nodeId: "node-missing", field: "opacity" }
      ],
      manifest: {
        screens: [
          {
            screenId: "screen-home",
            screenName: "Home",
            file: "src/screens/Home.tsx",
            components: [
              {
                irNodeId: "node-a",
                irNodeName: "Title",
                irNodeType: "text",
                file: "src/screens/Home.tsx"
              }
            ]
          }
        ]
      }
    });

    expect(model.empty).toBe(false);
    expect(model.summary).toEqual({
      totalOverrides: 5,
      affectedFiles: 1,
      mappedOverrides: 4,
      unmappedOverrides: 1,
      categories: {
        visual: 2,
        layout: 2,
        validation: 1,
        other: 0
      }
    });
    expect(model.files).toHaveLength(1);
    expect(model.files[0]).toEqual({
      filePath: "src/screens/Home.tsx",
      overrideCount: 4,
      categories: {
        visual: 1,
        layout: 2,
        validation: 1,
        other: 0
      },
      overrides: [
        {
          nodeId: "node-a",
          nodeName: "Title",
          nodeType: "text",
          field: "fillColor",
          category: "visual"
        },
        {
          nodeId: "node-a",
          nodeName: "Title",
          nodeType: "text",
          field: "validationMessage",
          category: "validation"
        },
        {
          nodeId: "node-a",
          nodeName: "Title",
          nodeType: "text",
          field: "width",
          category: "layout"
        },
        {
          nodeId: "screen-home",
          nodeName: "Home",
          nodeType: "screen",
          field: "gap",
          category: "layout"
        }
      ]
    });
    expect(model.unmapped).toEqual([
      {
        nodeId: "node-missing",
        field: "opacity",
        category: "visual"
      }
    ]);
  });

  it("sorts file groups and entries deterministically", () => {
    const model = deriveInspectorImpactReviewModel({
      entries: [
        { nodeId: "node-b", field: "fontWeight" },
        { nodeId: "node-a", field: "fillColor" },
        { nodeId: "node-a", field: "cornerRadius" },
        { nodeId: "node-z", field: "required" },
        { nodeId: "node-z", field: "unknownField" }
      ],
      manifest: {
        screens: [
          {
            screenId: "screen-home",
            screenName: "Home",
            file: "src/screens/Home.tsx",
            components: [
              {
                irNodeId: "node-a",
                irNodeName: "A",
                irNodeType: "text",
                file: "src/screens/Home.tsx"
              },
              {
                irNodeId: "node-b",
                irNodeName: "B",
                irNodeType: "button",
                file: "src/screens/Home.tsx"
              }
            ]
          },
          {
            screenId: "screen-settings",
            screenName: "Settings",
            file: "src/screens/Settings.tsx",
            components: [
              {
                irNodeId: "node-z",
                irNodeName: "Zip",
                irNodeType: "input",
                file: "src/screens/Settings.tsx"
              }
            ]
          }
        ]
      }
    });

    expect(model.files.map((group) => group.filePath)).toEqual([
      "src/screens/Home.tsx",
      "src/screens/Settings.tsx"
    ]);
    expect(model.files[0]?.overrides.map((entry) => `${entry.nodeId}:${entry.field}`)).toEqual([
      "node-a:cornerRadius",
      "node-a:fillColor",
      "node-b:fontWeight"
    ]);
    expect(model.files[1]?.overrides.map((entry) => `${entry.nodeId}:${entry.field}`)).toEqual([
      "node-z:required",
      "node-z:unknownField"
    ]);
    expect(model.summary.categories).toEqual({
      visual: 3,
      layout: 0,
      validation: 1,
      other: 1
    });
  });
});
