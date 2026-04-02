import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaAnalysis, FigmaAnalysisAppShellSignal, FigmaAnalysisFrameVariantGroup } from "./figma-analysis.js";
import { applyAppShellsToDesignIr } from "./ir-app-shells.js";
import type { DesignIR, ScreenElementIR, ScreenIR } from "./types-ir.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const createScreen = ({
  id,
  name,
  children
}: {
  id: string;
  name: string;
  children: ScreenElementIR[];
}): ScreenIR => ({
  id,
  name,
  layoutMode: "VERTICAL",
  gap: 16,
  padding: { top: 16, right: 16, bottom: 16, left: 16 },
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

const createIr = ({ screens }: { screens: ScreenIR[] }): DesignIR => ({
  sourceName: "Variant Shell Demo",
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
  sourceName: "Variant Shell Demo",
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

test("applyAppShellsToDesignIr derives one shared shell from grouped variant frames", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-brand-1", name: "Markenbühne" }),
          createContainerNode({ id: "shell-header-1", name: "Header + Titel" }),
          createTextNode({ id: "content-1", name: "SeitenContent", text: "Offen" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-brand-2", name: "Markenbühne" }),
          createContainerNode({ id: "shell-header-2", name: "Header + Titel" }),
          createTextNode({ id: "content-2", name: "SeitenContent", text: "Fertig" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-1",
        groupId: "group-1",
        role: "frame",
        fingerprint: "brand",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-brand-1", "shell-brand-2"],
        confidence: 1,
        reasons: []
      },
      {
        signalId: "group-1-shell-2",
        groupId: "group-1",
        role: "header",
        fingerprint: "header",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-header-1", "shell-header-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.deepEqual(result.appShells, [
    {
      id: "group-1",
      sourceScreenId: "frame-1",
      screenIds: ["frame-1", "frame-2"],
      shellNodeIds: ["shell-brand-1", "shell-header-1"],
      slotIndex: 2,
      signalIds: ["group-1-shell-1", "group-1-shell-2"]
    }
  ]);
  assert.deepEqual(result.screens[0]?.appShell, {
    id: "group-1",
    contentNodeIds: ["content-1"]
  });
  assert.deepEqual(result.screens[1]?.appShell, {
    id: "group-1",
    contentNodeIds: ["content-2"]
  });
});

test("applyAppShellsToDesignIr skips shell extraction when a signal is not top-level in every grouped screen", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-brand-1", name: "Markenbühne" }),
          createContainerNode({ id: "shell-header-1", name: "Header + Titel" }),
          createContainerNode({ id: "content-1", name: "SeitenContent" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-brand-2", name: "Markenbühne" }),
          createContainerNode({
            id: "content-2",
            name: "SeitenContent",
            children: [createTextNode({ id: "nested-header-2", name: "Header + Titel", text: "Nested" })]
          })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-1",
        groupId: "group-1",
        role: "frame",
        fingerprint: "brand",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-brand-1", "shell-brand-2"],
        confidence: 1,
        reasons: []
      },
      {
        signalId: "group-1-shell-2",
        groupId: "group-1",
        role: "header",
        fingerprint: "header",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-header-1", "nested-header-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.equal(result.appShells, undefined);
  assert.equal(result.screens.every((screen) => screen.appShell === undefined), true);
});

test("applyAppShellsToDesignIr filters out signals with confidence below 1", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-brand-1", name: "Markenbühne" }),
          createTextNode({ id: "content-1", name: "SeitenContent", text: "Offen" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-brand-2", name: "Markenbühne" }),
          createTextNode({ id: "content-2", name: "SeitenContent", text: "Fertig" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-1",
        groupId: "group-1",
        role: "frame",
        fingerprint: "brand",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-brand-1", "shell-brand-2"],
        confidence: 0.7,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.equal(result.appShells, undefined);
  assert.equal(result.screens.every((screen) => screen.appShell === undefined), true);
});

test("applyAppShellsToDesignIr handles multiple independent variant groups", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Group A Screen 1",
        children: [
          createContainerNode({ id: "shell-a-1", name: "Shell A" }),
          createTextNode({ id: "content-a-1", name: "Content", text: "A1" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Group A Screen 2",
        children: [
          createContainerNode({ id: "shell-a-2", name: "Shell A" }),
          createTextNode({ id: "content-a-2", name: "Content", text: "A2" })
        ]
      }),
      createScreen({
        id: "frame-3",
        name: "Group B Screen 1",
        children: [
          createContainerNode({ id: "shell-b-1", name: "Shell B" }),
          createTextNode({ id: "content-b-1", name: "Content", text: "B1" })
        ]
      }),
      createScreen({
        id: "frame-4",
        name: "Group B Screen 2",
        children: [
          createContainerNode({ id: "shell-b-2", name: "Shell B" }),
          createTextNode({ id: "content-b-2", name: "Content", text: "B2" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-a",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Group A Screen 1", "Group A Screen 2"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      },
      {
        groupId: "group-b",
        frameIds: ["frame-3", "frame-4"],
        frameNames: ["Group B Screen 1", "Group B Screen 2"],
        canonicalFrameId: "frame-3",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-a-shell",
        groupId: "group-a",
        role: "frame",
        fingerprint: "shell-a",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-a-1", "shell-a-2"],
        confidence: 1,
        reasons: []
      },
      {
        signalId: "group-b-shell",
        groupId: "group-b",
        role: "header",
        fingerprint: "shell-b",
        frameIds: ["frame-3", "frame-4"],
        nodeIds: ["shell-b-1", "shell-b-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.equal(result.appShells?.length, 2);
  assert.equal(result.appShells?.[0]?.id, "group-a");
  assert.equal(result.appShells?.[1]?.id, "group-b");
  assert.deepEqual(result.screens[0]?.appShell, { id: "group-a", contentNodeIds: ["content-a-1"] });
  assert.deepEqual(result.screens[2]?.appShell, { id: "group-b", contentNodeIds: ["content-b-1"] });
});

test("applyAppShellsToDesignIr is idempotent — applying twice produces the same result", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-brand-1", name: "Markenbühne" }),
          createTextNode({ id: "content-1", name: "SeitenContent", text: "Offen" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-brand-2", name: "Markenbühne" }),
          createTextNode({ id: "content-2", name: "SeitenContent", text: "Fertig" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-1",
        groupId: "group-1",
        role: "frame",
        fingerprint: "brand",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-brand-1", "shell-brand-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const first = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });
  const second = applyAppShellsToDesignIr({ ir: first, figmaAnalysis: analysis });

  assert.deepEqual(first, second);
});

test("applyAppShellsToDesignIr rejects non-contiguous shell nodes in grouped screens", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-header-1", name: "Header" }),
          createTextNode({ id: "content-1", name: "Content", text: "Middle" }),
          createContainerNode({ id: "shell-footer-1", name: "Footer" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-header-2", name: "Header" }),
          createTextNode({ id: "content-2", name: "Content", text: "Middle" }),
          createContainerNode({ id: "shell-footer-2", name: "Footer" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-header",
        groupId: "group-1",
        role: "header",
        fingerprint: "header",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-header-1", "shell-header-2"],
        confidence: 1,
        reasons: []
      },
      {
        signalId: "group-1-shell-footer",
        groupId: "group-1",
        role: "navigation",
        fingerprint: "footer",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-footer-1", "shell-footer-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.equal(result.appShells, undefined);
  assert.equal(result.screens.every((screen) => screen.appShell === undefined), true);
});

test("applyAppShellsToDesignIr skips shell extraction when screens would lose all content nodes", () => {
  const ir = createIr({
    screens: [
      createScreen({
        id: "frame-1",
        name: "Status A",
        children: [
          createContainerNode({ id: "shell-brand-1", name: "Markenbühne" }),
          createContainerNode({ id: "shell-header-1", name: "Header + Titel" })
        ]
      }),
      createScreen({
        id: "frame-2",
        name: "Status B",
        children: [
          createContainerNode({ id: "shell-brand-2", name: "Markenbühne" }),
          createContainerNode({ id: "shell-header-2", name: "Header + Titel" })
        ]
      })
    ]
  });
  const analysis = createAnalysis({
    frameVariantGroups: [
      {
        groupId: "group-1",
        frameIds: ["frame-1", "frame-2"],
        frameNames: ["Status A", "Status B"],
        canonicalFrameId: "frame-1",
        confidence: 1,
        similarityReasons: [],
        fallbackReasons: [],
        variantAxes: []
      }
    ],
    appShellSignals: [
      {
        signalId: "group-1-shell-1",
        groupId: "group-1",
        role: "frame",
        fingerprint: "brand",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-brand-1", "shell-brand-2"],
        confidence: 1,
        reasons: []
      },
      {
        signalId: "group-1-shell-2",
        groupId: "group-1",
        role: "header",
        fingerprint: "header",
        frameIds: ["frame-1", "frame-2"],
        nodeIds: ["shell-header-1", "shell-header-2"],
        confidence: 1,
        reasons: []
      }
    ]
  });

  const result = applyAppShellsToDesignIr({ ir, figmaAnalysis: analysis });

  assert.equal(result.appShells, undefined);
  assert.equal(result.screens.every((screen) => screen.appShell === undefined), true);
});

// ---------------------------------------------------------------------------
// validateDesignIR — appShell cross-reference validation
// ---------------------------------------------------------------------------

import { validateDesignIR } from "./types-ir.js";

test("validateDesignIR rejects appShells referencing non-existent sourceScreenId", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "screen-1", name: "Screen 1", children: [createTextNode({ id: "n1", name: "N", text: "T" })] })
    ]
  });
  ir.appShells = [
    {
      id: "shell-1",
      sourceScreenId: "non-existent",
      screenIds: ["screen-1"],
      shellNodeIds: ["n1"],
      slotIndex: 1,
      signalIds: ["s1"]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_APP_SHELL_MISSING_SOURCE_SCREEN"));
  }
});

test("validateDesignIR rejects appShells referencing non-existent screenIds", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "screen-1", name: "Screen 1", children: [createTextNode({ id: "n1", name: "N", text: "T" })] })
    ]
  });
  ir.appShells = [
    {
      id: "shell-1",
      sourceScreenId: "screen-1",
      screenIds: ["screen-1", "ghost-screen"],
      shellNodeIds: ["n1"],
      slotIndex: 1,
      signalIds: ["s1"]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => e.code === "IR_APP_SHELL_MISSING_SCREEN"));
  }
});

test("validateDesignIR accepts valid appShells with existing screen references", () => {
  const ir = createIr({
    screens: [
      createScreen({ id: "screen-1", name: "Screen 1", children: [createTextNode({ id: "n1", name: "N", text: "T" })] }),
      createScreen({ id: "screen-2", name: "Screen 2", children: [createTextNode({ id: "n2", name: "N", text: "T" })] })
    ]
  });
  ir.appShells = [
    {
      id: "shell-1",
      sourceScreenId: "screen-1",
      screenIds: ["screen-1", "screen-2"],
      shellNodeIds: ["n1"],
      slotIndex: 1,
      signalIds: ["s1"]
    }
  ];

  const result = validateDesignIR(ir);

  assert.equal(result.valid, true);
});
