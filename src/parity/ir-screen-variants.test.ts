import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { FigmaAnalysis, FigmaAnalysisAppShellSignal, FigmaAnalysisFrameVariantGroup } from "./figma-analysis.js";
import { resolveEmittedScreenTargets } from "./emitted-screen-targets.js";
import { applyScreenVariantFamiliesToDesignIr } from "./ir-screen-variants.js";
import { validateDesignIR } from "./types-ir.js";
import type { DesignIR, ScreenElementIR, ScreenIR, ScreenVariantFamilyIR } from "./types-ir.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = path.join(MODULE_DIR, "fixtures", "golden", "rocket", "variant-shell-signals", "expected");

const createScreen = ({
  id,
  name,
  children,
  appShell
}: {
  id: string;
  name: string;
  children: ScreenElementIR[];
  appShell?: ScreenIR["appShell"];
}): ScreenIR => ({
  id,
  name,
  layoutMode: "VERTICAL",
  gap: 16,
  padding: { top: 16, right: 16, bottom: 16, left: 16 },
  ...(appShell ? { appShell } : {}),
  children
});

const createTextNode = ({ id, name, text }: { id: string; name: string; text: string }): ScreenElementIR => ({
  id,
  name,
  nodeType: "TEXT",
  type: "text",
  text
});

const createContainerNode = ({ id, name, children = [] }: { id: string; name: string; children?: ScreenElementIR[] }): ScreenElementIR => ({
  id,
  name,
  nodeType: "FRAME",
  type: "container",
  children
});

const createInputNode = ({
  id,
  name,
  x,
  y,
  strokeColor,
  children = []
}: {
  id: string;
  name: string;
  x?: number;
  y?: number;
  strokeColor?: string;
  children?: ScreenElementIR[];
}): ScreenElementIR => ({
  id,
  name,
  nodeType: "FRAME",
  type: "input",
  x,
  y,
  width: 320,
  height: 56,
  ...(strokeColor ? { strokeColor } : {}),
  children
});

const createIr = ({ screens }: { screens: ScreenIR[] }): DesignIR => ({
  sourceName: "Variant Screen Demo",
  screens,
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#00aa55",
      background: "#fafafa",
      text: "#222222",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#2222221f",
      action: {
        active: "#2222228a",
        hover: "#ee00000a",
        selected: "#ee000014",
        disabled: "#22222242",
        disabledBackground: "#2222221f",
        focus: "#ee00001f"
      }
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16
    })
  }
});

const createAnalysis = ({
  frameVariantGroups,
  appShellSignals
}: {
  frameVariantGroups: FigmaAnalysisFrameVariantGroup[];
  appShellSignals: FigmaAnalysisAppShellSignal[];
}): FigmaAnalysis => ({
  artifactVersion: 1,
  sourceName: "Variant Screen Demo",
  summary: {
    pageCount: 1,
    sectionCount: 0,
    topLevelFrameCount: frameVariantGroups.flatMap((group) => group.frameIds).length,
    totalNodeCount: 0,
    totalInstanceCount: 0,
    localComponentCount: 0,
    localStyleCount: 0,
    externalComponentCount: 0
  },
  tokenSignals: {
    boundVariableIds: [],
    variableModeIds: [],
    styleReferences: {
      allStyleIds: [],
      byType: {
        fill: [],
        stroke: [],
        effect: [],
        text: [],
        generic: []
      },
      localStyleIds: [],
      linkedStyleIds: []
    }
  },
  layoutGraph: {
    pages: [],
    sections: [],
    frames: [],
    edges: []
  },
  componentFamilies: [],
  externalComponents: [],
  frameVariantGroups,
  appShellSignals,
  componentDensity: {
    boardDominantFamilies: [],
    byFrame: [],
    hotspots: []
  },
  diagnostics: []
});

test("applyScreenVariantFamiliesToDesignIr derives the ID-003 stateful family from the golden fixture", async () => {
  const ir = JSON.parse(await readFile(path.join(GOLDEN_ROOT, "design-ir.json"), "utf8")) as DesignIR;
  const figmaAnalysis = JSON.parse(await readFile(path.join(GOLDEN_ROOT, "figma-analysis.json"), "utf8")) as FigmaAnalysis;

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });

  assert.equal(result.screenVariantFamilies?.length, 1);
  const family = result.screenVariantFamilies?.[0];
  assert.ok(family);
  assert.equal(family.familyId, "id-003-1-fehlermeldungen-5");
  assert.equal(family.canonicalScreenId, "1:66050");
  assert.deepEqual(family.axes, ["expansion-state", "pricing-mode", "validation-state"]);
  assert.deepEqual(family.memberScreenIds, ["1:63230", "1:64644", "1:66050", "1:67464", "1:68884"]);

  const bruttoScenario = family.scenarios.find((scenario) => scenario.screenId === "1:63230");
  assert.ok(bruttoScenario);
  assert.equal(bruttoScenario.contentScreenId, "1:66050");
  assert.equal(bruttoScenario.initialState.pricingMode, "brutto");
  assert.equal(bruttoScenario.initialState.expansionState, "collapsed");
  assert.equal(bruttoScenario.shellTextOverrides?.["1:66050-mode"], "Brutto");

  const expandedScenario = family.scenarios.find((scenario) => scenario.screenId === "1:64644");
  assert.ok(expandedScenario);
  assert.equal(expandedScenario.contentScreenId, "1:64644");
  assert.equal(expandedScenario.initialState.expansionState, "expanded");
  assert.equal(expandedScenario.initialState.pricingMode, "netto");

  const errorScenario = family.scenarios.find((scenario) => scenario.screenId === "1:68884");
  assert.ok(errorScenario);
  assert.equal(errorScenario.contentScreenId, "1:66050");
  assert.equal(errorScenario.initialState.validationState, "error");
  assert.deepEqual(errorScenario.screenLevelErrorEvidence, [
    {
      message: "Fehler bei der Validierung",
      severity: "error",
      sourceNodeId: "1:68884-error"
    }
  ]);
});

test("applyScreenVariantFamiliesToDesignIr collapses validation-only field errors and attaches them to a single field", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-default",
        name: "Default",
        children: [
          createContainerNode({
            id: "form-root-default",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-default",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-default",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-default",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#9ca3af"
                      }
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }),
      createScreen({
        id: "frame-error",
        name: "Error",
        children: [
          createContainerNode({
            id: "form-root-error",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-error",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-error",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-error",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  }),
                  createTextNode({
                    id: "email-error-text",
                    name: "Error Text",
                    text: "Please enter a valid email address."
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "validation-family",
        frameIds: ["frame-default", "frame-error"],
        frameNames: ["Default", "Error"],
        canonicalFrameId: "frame-default",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });
  const scenario = result.screenVariantFamilies?.[0]?.scenarios.find((entry) => entry.screenId === "frame-error");
  assert.ok(scenario);
  assert.equal(scenario.contentScreenId, "frame-default");
  assert.deepEqual(scenario.fieldErrorEvidenceByFieldKey, {
    email_field_email_field_default: {
      message: "Please enter a valid email address.",
      visualError: true,
      sourceNodeId: "email-error-text"
    }
  });
  assert.equal(scenario.screenLevelErrorEvidence, undefined);
});

test("applyScreenVariantFamiliesToDesignIr collapses wrapped validation-only messages into field evidence", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-default",
        name: "Default",
        children: [
          createContainerNode({
            id: "form-root-default",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-default",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-default",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-default",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#9ca3af"
                      }
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }),
      createScreen({
        id: "frame-error",
        name: "Error",
        children: [
          createContainerNode({
            id: "form-root-error",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-error",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-error",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-error",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  }),
                  createContainerNode({
                    id: "email-error-wrapper",
                    name: "Helper Wrapper",
                    children: [
                      createTextNode({
                        id: "email-error-text",
                        name: "Error Text",
                        text: "Please enter a valid email address."
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "validation-family",
        frameIds: ["frame-default", "frame-error"],
        frameNames: ["Default", "Error"],
        canonicalFrameId: "frame-default",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });
  const scenario = result.screenVariantFamilies?.[0]?.scenarios.find((entry) => entry.screenId === "frame-error");
  assert.ok(scenario);
  assert.equal(scenario.contentScreenId, "frame-default");
  assert.deepEqual(scenario.fieldErrorEvidenceByFieldKey, {
    email_field_email_field_default: {
      message: "Please enter a valid email address.",
      visualError: true,
      sourceNodeId: "email-error-text"
    }
  });
  assert.equal(scenario.screenLevelErrorEvidence, undefined);
});

test("applyScreenVariantFamiliesToDesignIr keeps ambiguous validation copy at screen level", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "ambiguous-default",
        name: "Default",
        children: [
          createContainerNode({
            id: "form-root-default",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-default",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-default",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-default",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#9ca3af"
                      }
                    ]
                  })
                ]
              }),
              createInputNode({
                id: "password-field-default",
                name: "Password Field",
                x: 0,
                y: 120,
                children: [
                  createContainerNode({
                    id: "password-outline-default",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "password-border-default",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#9ca3af"
                      }
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }),
      createScreen({
        id: "ambiguous-error",
        name: "Error",
        children: [
          createContainerNode({
            id: "form-root-error",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-error",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-error",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-error",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  })
                ]
              }),
              createInputNode({
                id: "password-field-error",
                name: "Password Field",
                x: 0,
                y: 120,
                children: [
                  createContainerNode({
                    id: "password-outline-error",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "password-border-error",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  })
                ]
              }),
              {
                id: "form-error-text",
                name: "Error Summary",
                nodeType: "TEXT",
                type: "text",
                text: "Please review the highlighted fields.",
                x: 0,
                y: 72
              }
            ]
          })
        ]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "validation-family",
        frameIds: ["ambiguous-default", "ambiguous-error"],
        frameNames: ["Default", "Error"],
        canonicalFrameId: "ambiguous-default",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });
  const scenario = result.screenVariantFamilies?.[0]?.scenarios.find((entry) => entry.screenId === "ambiguous-error");
  assert.ok(scenario);
  assert.equal(scenario.contentScreenId, "ambiguous-default");
  assert.deepEqual(scenario.fieldErrorEvidenceByFieldKey, {
    email_field_email_field_default: {
      message: "",
      visualError: true,
      sourceNodeId: "email-field-error"
    },
    password_field_password_field_default: {
      message: "",
      visualError: true,
      sourceNodeId: "password-field-error"
    }
  });
  assert.deepEqual(scenario.screenLevelErrorEvidence, [
    {
      message: "Please review the highlighted fields.",
      severity: "error",
      sourceNodeId: "form-error-text"
    }
  ]);
});

test("applyScreenVariantFamiliesToDesignIr falls back when shell matching is ambiguous", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "State A",
        appShell: {
          id: "group-1",
          contentNodeIds: ["content-1"]
        },
        children: [
          createContainerNode({
            id: "shell-1",
            name: "Header",
            children: [createTextNode({ id: "shell-title-1", name: "Title", text: "Netto" })]
          }),
          createContainerNode({ id: "content-1", name: "Body" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "State B",
        appShell: {
          id: "group-1",
          contentNodeIds: ["content-2"]
        },
        children: [
          createContainerNode({
            id: "shell-2",
            name: "Header",
            children: [
              createTextNode({ id: "shell-title-2", name: "Title", text: "Brutto" }),
              createTextNode({ id: "shell-extra-2", name: "Extra", text: "Ambiguous" })
            ]
          }),
          createContainerNode({ id: "content-2", name: "Body" })
        ]
      })
    ]
  });
  ir.appShells = [
    {
      id: "group-1",
      sourceScreenId: "frame-1",
      screenIds: ["frame-1", "frame-2"],
      shellNodeIds: ["shell-1"],
      slotIndex: 1,
      signalIds: ["signal-1"]
    }
  ];

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["State A", "State B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "pricing-mode",
            values: ["brutto", "netto"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: [
      {
        signalId: "signal-1",
        groupId: "group-1",
        role: "header",
        fingerprint: "header",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-1", "shell-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });

  assert.equal(result.screenVariantFamilies, undefined);
});

test("applyScreenVariantFamiliesToDesignIr keeps collision-prone groups as separate families when group ids are unique", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "alpha-brutto",
        name: "Alpha Brutto",
        children: [createTextNode({ id: "alpha-brutto-text", name: "Mode", text: "Brutto" })]
      }),
      createScreen({
        id: "alpha-netto",
        name: "Alpha Netto",
        children: [createTextNode({ id: "alpha-netto-text", name: "Mode", text: "Netto" })]
      }),
      createScreen({
        id: "beta-brutto",
        name: "Beta Brutto",
        children: [createTextNode({ id: "beta-brutto-text", name: "Mode", text: "Brutto" })]
      }),
      createScreen({
        id: "beta-netto",
        name: "Beta Netto",
        children: [createTextNode({ id: "beta-netto-text", name: "Mode", text: "Netto" })]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "loan-flow-1-error-2-a1b2c3d4",
        frameIds: ["alpha-brutto", "alpha-netto"],
        frameNames: ["Loan Flow 1 Error", "Loan Flow 2 Default"],
        canonicalFrameId: "alpha-netto",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "pricing-mode",
            values: ["brutto", "netto"],
            source: "text"
          }
        ]
      },
      {
        groupId: "loan-flow-1-error-2-e5f6a7b8",
        frameIds: ["beta-brutto", "beta-netto"],
        frameNames: ["Loan Flow 1 Error", "Loan Flow 2 Default"],
        canonicalFrameId: "beta-netto",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "pricing-mode",
            values: ["brutto", "netto"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });

  assert.deepEqual(
    result.screenVariantFamilies?.map((family) => family.familyId).sort(),
    ["loan-flow-1-error-2-a1b2c3d4", "loan-flow-1-error-2-e5f6a7b8"]
  );
});

test("resolveEmittedScreenTargets emits one canonical screen target and preserves alias routes", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "family-brutto", name: "Family Brutto", children: [] }),
      createScreen({ id: "family-canonical", name: "Family Canonical", children: [] }),
      createScreen({ id: "standalone", name: "Standalone", children: [] })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-1",
      canonicalScreenId: "family-canonical",
      memberScreenIds: ["family-brutto", "family-canonical"],
      axes: ["pricing-mode"],
      scenarios: [
        {
          screenId: "family-brutto",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "brutto"
          },
          shellTextOverrides: {
            mode: "Brutto"
          }
        },
        {
          screenId: "family-canonical",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "netto"
          }
        }
      ]
    }
  ];

  const resolution = resolveEmittedScreenTargets({ ir });

  assert.deepEqual(
    resolution.emittedScreens.map((screen) => screen.id),
    ["family-canonical", "standalone"]
  );
  assert.deepEqual(
    resolution.routeEntries.map((entry) => ({
      routeScreenId: entry.routeScreenId,
      emittedScreenId: entry.emittedScreenId,
      initialVariantId: entry.initialVariantId
    })),
    [
      {
        routeScreenId: "family-canonical",
        emittedScreenId: "family-canonical",
        initialVariantId: undefined
      },
      {
        routeScreenId: "family-brutto",
        emittedScreenId: "family-canonical",
        initialVariantId: "family-brutto"
      },
      {
        routeScreenId: "standalone",
        emittedScreenId: "standalone",
        initialVariantId: undefined
      }
    ]
  );
  assert.equal(resolution.emittedIdentitiesByScreenId.get("family-canonical")?.filePath.includes("Family_Canonical"), true);
});

test("applyScreenVariantFamiliesToDesignIr skips single-frame variant groups", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "solo-frame",
        name: "Solo Frame",
        children: [createTextNode({ id: "solo-text", name: "Label", text: "Hello" })]
      })
    ]
  });
  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "solo-group",
        frameIds: ["solo-frame"],
        frameNames: ["Solo Frame"],
        canonicalFrameId: "solo-frame",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });

  assert.equal(result.screenVariantFamilies, undefined);
});

test("resolveValidationBaselineScenario prefers the canonical scenario when multiple non-error candidates match", () => {
  // Build a family with one error scenario and two non-error scenarios that
  // share the same non-error signature. The canonical scenario should win.
  const buildField = ({
    id,
    strokeColor
  }: {
    id: string;
    strokeColor?: string;
  }): ScreenElementIR =>
    createInputNode({
      id,
      name: "Email Field",
      x: 0,
      y: 0,
      ...(strokeColor ? { strokeColor } : {}),
      children: [
        createContainerNode({
          id: `${id}-outline`,
          name: "MuiOutlinedInputRoot",
          children: [
            {
              id: `${id}-border`,
              name: "MuiNotchedOutlined",
              nodeType: "FRAME",
              type: "divider",
              ...(strokeColor ? { strokeColor } : {})
            }
          ]
        })
      ]
    });

  const ir = createIr({
    screens: [
      createScreen({
        id: "first-default",
        name: "First Default",
        children: [buildField({ id: "first-default-field" })]
      }),
      createScreen({
        id: "canonical-default",
        name: "Canonical Default",
        children: [buildField({ id: "canonical-default-field" })]
      }),
      createScreen({
        id: "canonical-error",
        name: "Canonical Error",
        children: [buildField({ id: "canonical-error-field", strokeColor: "#d32f2f" })]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "family-canonical-preference",
        frameIds: ["first-default", "canonical-default", "canonical-error"],
        frameNames: ["First Default", "Canonical Default", "Canonical Error"],
        canonicalFrameId: "canonical-default",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });

  const errorScenario = result.screenVariantFamilies?.[0]?.scenarios.find(
    (scenario) => scenario.screenId === "canonical-error"
  );
  assert.ok(errorScenario);
  // The error scenario's `contentScreenId` should point at the canonical
  // scenario's content (canonical-default), not at the earlier first-default,
  // because canonical preference breaks the tie deterministically.
  assert.equal(errorScenario.contentScreenId, "canonical-default");
});

test("applyScreenVariantFamiliesToDesignIr drops the family when an error variant has structural non-validation diffs", () => {
  // Canonical has two fields; error variant drops the second field. This
  // structural change should disqualify the pair from being treated as a
  // validation-only diff. The error variant still carries an explicit error
  // token in the node tree so validationState resolves to "error".
  const ir = createIr({
    screens: [
      createScreen({
        id: "canonical",
        name: "Default",
        children: [
          createContainerNode({
            id: "canonical-form",
            name: "Form",
            children: [
              createInputNode({ id: "canonical-email-field", name: "Email Field", x: 0, y: 0 }),
              createInputNode({ id: "canonical-password-field", name: "Password Field", x: 0, y: 120 })
            ]
          })
        ]
      }),
      createScreen({
        id: "error",
        name: "Error",
        children: [
          createContainerNode({
            id: "error-form",
            name: "Error Form",
            children: [
              createInputNode({
                id: "error-email-field",
                name: "Email Field",
                x: 0,
                y: 0,
                strokeColor: "#d32f2f",
                children: [
                  createContainerNode({
                    id: "error-email-outline",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "error-email-border",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  })
                ]
              }),
              createTextNode({
                id: "error-summary",
                name: "Error Summary",
                text: "Please review the highlighted fields."
              })
              // password field intentionally removed
            ]
          })
        ]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "field-removal-family",
        frameIds: ["canonical", "error"],
        frameNames: ["Default", "Error"],
        canonicalFrameId: "canonical",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });
  assert.equal(result.screenVariantFamilies, undefined);
  assert.equal(validateDesignIR(result).valid, true);
});

test("extractValidationOnlyDiffEvidence preserves first-matched message and sourceNodeId when multiple messages match the same field", () => {
  // Build a family where the error variant adds TWO error text nodes next to
  // the same field. The sort order (by path) determines which wins. The test
  // asserts that the first-in-sort-order message wins for BOTH the message
  // text AND the sourceNodeId — previously sourceNodeId was last-wins.
  const ir = createIr({
    screens: [
      createScreen({
        id: "multi-default",
        name: "Default",
        children: [
          createContainerNode({
            id: "form-root-default",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-default",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-default",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-default",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#9ca3af"
                      }
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }),
      createScreen({
        id: "multi-error",
        name: "Error",
        children: [
          createContainerNode({
            id: "form-root-error",
            name: "Form Root",
            children: [
              createInputNode({
                id: "email-field-error",
                name: "Email Field",
                x: 0,
                y: 24,
                children: [
                  createContainerNode({
                    id: "email-outline-error",
                    name: "MuiOutlinedInputRoot",
                    children: [
                      {
                        id: "email-border-error",
                        name: "MuiNotchedOutlined",
                        nodeType: "FRAME",
                        type: "divider",
                        strokeColor: "#d32f2f"
                      }
                    ]
                  }),
                  createTextNode({
                    id: "email-error-text-a",
                    name: "Error Text A",
                    text: "Please enter a valid email address."
                  }),
                  createTextNode({
                    id: "email-error-text-b",
                    name: "Error Text B",
                    text: "Email is required."
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  const figmaAnalysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "multi-message-family",
        frameIds: ["multi-default", "multi-error"],
        frameNames: ["Default", "Error"],
        canonicalFrameId: "multi-default",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: [
          {
            axis: "validation-state",
            values: ["default", "error"],
            source: "text"
          }
        ]
      }
    ],
    appShellSignals: []
  });

  const result = applyScreenVariantFamiliesToDesignIr({ ir, figmaAnalysis });
  const errorScenario = result.screenVariantFamilies?.[0]?.scenarios.find(
    (scenario) => scenario.screenId === "multi-error"
  );
  assert.ok(errorScenario);
  const fieldEvidence = errorScenario.fieldErrorEvidenceByFieldKey;
  assert.ok(fieldEvidence);
  const entries = Object.values(fieldEvidence);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  // First in sort order wins for BOTH message text and sourceNodeId. This is
  // the regression guard for audit finding F-01 — `sourceNodeId` used to be
  // last-wins while `message` was first-wins, producing inconsistent
  // traceability when multiple messages associated with the same field.
  assert.equal(entry.message, "Please enter a valid email address.");
  assert.equal(entry.sourceNodeId, "email-error-text-a");
});

// ---------------------------------------------------------------------------
// validateDesignIR — screenVariantFamilies cross-family / axis / scenario checks
// ---------------------------------------------------------------------------

const createFamily = (overrides: Partial<ScreenVariantFamilyIR> & { canonicalScreenId: string; memberScreenIds: string[] }): ScreenVariantFamilyIR => ({
  familyId: "family-1",
  axes: ["validation-state"],
  scenarios: overrides.memberScreenIds.map((screenId) => ({
    screenId,
    contentScreenId: screenId,
    initialState: { validationState: "default" }
  })),
  ...overrides
});

test("validateDesignIR rejects two families sharing the same canonicalScreenId", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    createFamily({ familyId: "family-a", canonicalScreenId: "s1", memberScreenIds: ["s1", "s2"] }),
    createFamily({ familyId: "family-b", canonicalScreenId: "s1", memberScreenIds: ["s1"] })
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_CANONICAL_COLLISION"));
  }
});

test("validateDesignIR rejects the same screen appearing as a member in two families", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] }),
      createScreen({ id: "s3", name: "S3", children: [createTextNode({ id: "t3", name: "T", text: "C" })] })
    ]
  });
  ir.screenVariantFamilies = [
    createFamily({ familyId: "family-a", canonicalScreenId: "s1", memberScreenIds: ["s1", "s2"] }),
    createFamily({ familyId: "family-b", canonicalScreenId: "s3", memberScreenIds: ["s3", "s2"] })
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_MEMBER_COLLISION"));
  }
});

test("validateDesignIR rejects families with an empty axes array", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    createFamily({
      familyId: "family-empty-axes",
      canonicalScreenId: "s1",
      memberScreenIds: ["s1", "s2"],
      axes: []
    })
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_EMPTY_AXES"));
  }
});

test("validateDesignIR rejects duplicate scenario.screenId within a family", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-duplicates",
      canonicalScreenId: "s1",
      memberScreenIds: ["s1", "s2"],
      axes: ["validation-state"],
      scenarios: [
        { screenId: "s1", contentScreenId: "s1", initialState: { validationState: "default" } },
        { screenId: "s2", contentScreenId: "s2", initialState: { validationState: "default" } },
        { screenId: "s2", contentScreenId: "s2", initialState: { validationState: "error" } }
      ]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_SCENARIO_DUPLICATE"));
  }
});

test("validateDesignIR rejects families whose memberScreenIds contain duplicates", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    createFamily({
      familyId: "family-duplicate-member",
      canonicalScreenId: "s1",
      memberScreenIds: ["s1", "s2", "s2"]
    })
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_MEMBER"));
  }
});

test("validateDesignIR rejects families whose canonicalScreenId has no corresponding scenario", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-missing-canonical-scenario",
      canonicalScreenId: "s1",
      memberScreenIds: ["s1", "s2"],
      axes: ["validation-state"],
      scenarios: [
        { screenId: "s2", contentScreenId: "s2", initialState: { validationState: "default" } }
      ]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_CANONICAL_NOT_IN_SCENARIOS"));
  }
});

test("validateDesignIR rejects families whose members do not all have corresponding scenarios", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-missing-member-scenario",
      canonicalScreenId: "s1",
      memberScreenIds: ["s1", "s2"],
      axes: ["validation-state"],
      scenarios: [
        { screenId: "s1", contentScreenId: "s1", initialState: { validationState: "default" } }
      ]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_MEMBER_NOT_IN_SCENARIOS"));
  }
});

test("validateDesignIR rejects duplicate family ids across families", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "s1", name: "S1", children: [createTextNode({ id: "t1", name: "T", text: "A" })] }),
      createScreen({ id: "s2", name: "S2", children: [createTextNode({ id: "t2", name: "T", text: "B" })] }),
      createScreen({ id: "s3", name: "S3", children: [createTextNode({ id: "t3", name: "T", text: "C" })] })
    ]
  });
  ir.screenVariantFamilies = [
    createFamily({ familyId: "family-duplicate-id", canonicalScreenId: "s1", memberScreenIds: ["s1", "s2"] }),
    createFamily({ familyId: "family-duplicate-id", canonicalScreenId: "s3", memberScreenIds: ["s3"] })
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_SCREEN_VARIANT_FAMILY_DUPLICATE_ID"));
  }
});

test("validateDesignIR rejects fieldErrorEvidence with empty sourceNodeId", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "screen-1",
        name: "Screen 1",
        children: [createInputNode({ id: "field-1", name: "Email" })]
      }),
      createScreen({
        id: "screen-2",
        name: "Screen 2",
        children: [createInputNode({ id: "field-2", name: "Email" })]
      })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-1",
      canonicalScreenId: "screen-1",
      memberScreenIds: ["screen-1", "screen-2"],
      axes: ["validation-state"],
      scenarios: [
        {
          screenId: "screen-1",
          contentScreenId: "screen-1",
          initialState: { validationState: "default" }
        },
        {
          screenId: "screen-2",
          contentScreenId: "screen-2",
          initialState: { validationState: "error" },
          fieldErrorEvidenceByFieldKey: {
            email: {
              message: "Invalid email",
              visualError: true,
              sourceNodeId: "   "
            }
          }
        }
      ]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.errors.some(
        (error) =>
          error.code === "IR_INVALID_SCREEN_VARIANT_SCENARIO" &&
          error.message.includes("fieldErrorEvidenceByFieldKey")
      )
    );
  }
});

test("validateDesignIR rejects error-state scenarios with no evidence", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "screen-1",
        name: "Screen 1",
        children: [createInputNode({ id: "field-1", name: "Email" })]
      }),
      createScreen({
        id: "screen-2",
        name: "Screen 2",
        children: [createInputNode({ id: "field-2", name: "Email" })]
      })
    ]
  });
  ir.screenVariantFamilies = [
    {
      familyId: "family-1",
      canonicalScreenId: "screen-1",
      memberScreenIds: ["screen-1", "screen-2"],
      axes: ["validation-state"],
      scenarios: [
        {
          screenId: "screen-1",
          contentScreenId: "screen-1",
          initialState: { validationState: "default" }
        },
        {
          screenId: "screen-2",
          contentScreenId: "screen-2",
          initialState: { validationState: "error" }
          // deliberately no fieldErrorEvidenceByFieldKey, no screenLevelErrorEvidence
        }
      ]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((error) => error.code === "IR_SCREEN_VARIANT_SCENARIO_ERROR_STATE_MISSING_EVIDENCE"));
  }
});
