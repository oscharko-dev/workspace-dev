import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaFile } from "./ir-helpers.js";
import {
  DEFAULT_DARK_TEXT_COLOR,
  applyMcpEnrichmentToIr,
  clampUnitInterval,
  deriveThemeAnalysis,
  isHexColorLiteral,
  mixHexColors,
  parseHexColorRgb,
  resolveBestContrastCandidate,
  resolveMostFrequentColor
} from "./ir-tokens.js";
import type { DesignIR, DesignTokens, FigmaMcpEnrichment, ScreenElementIR, ScreenIR } from "./types.js";

const makeScreen = ({
  id,
  name,
  fillColor,
  children
}: {
  id: string;
  name: string;
  fillColor?: string;
  children?: ScreenElementIR[];
}): ScreenIR =>
  ({
    id,
    name,
    layoutMode: "VERTICAL",
    width: 390,
    height: 844,
    ...(fillColor ? { fillColor } : {}),
    children: children ?? []
  }) as ScreenIR;

const makeElement = ({
  id,
  type,
  name = id,
  nodeType = "FRAME",
  children,
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  nodeType?: string;
  children?: ScreenElementIR[];
} & Omit<Partial<ScreenElementIR>, "children" | "id" | "name" | "nodeType" | "type">): ScreenElementIR =>
  ({
    id,
    type,
    name,
    nodeType,
    ...(children ? { children } : {}),
    ...overrides
  }) as ScreenElementIR;

const baseTokens = {
  palette: {
    primary: "#1976d2",
    secondary: "#9c27b0",
    success: "#2e7d32",
    warning: "#ed6c02",
    error: "#d32f2f",
    info: "#0288d1",
    background: "#ffffff",
    surface: "#ffffff",
    text: "#111111",
    divider: "#d0d7de"
  }
} as unknown as DesignTokens;

test("token color helpers parse, clamp, mix, and rank colors deterministically", () => {
  assert.equal(isHexColorLiteral("#123456"), true);
  assert.equal(isHexColorLiteral("#12345678"), true);
  assert.equal(isHexColorLiteral("#12345"), false);

  assert.deepEqual(parseHexColorRgb("#123456"), {
    r: 18,
    g: 52,
    b: 86
  });
  assert.deepEqual(parseHexColorRgb("#12345678"), {
    r: 18,
    g: 52,
    b: 86
  });
  assert.equal(parseHexColorRgb("blue"), undefined);

  assert.equal(clampUnitInterval(-0.2), 0);
  assert.equal(clampUnitInterval(1.2), 1);
  assert.equal(clampUnitInterval(0.4), 0.4);

  assert.equal(mixHexColors({ left: "#000000", right: "#ffffff", amount: 0.5 }), "#808080");
  assert.equal(mixHexColors({ left: "#112233", right: "invalid", amount: 0.5 }), "#112233");

  assert.equal(resolveMostFrequentColor([]), undefined);
  assert.equal(resolveMostFrequentColor(["#222222", "#111111", "#111111", "#222222"]), "#111111");

  assert.equal(
    resolveBestContrastCandidate({
      backgroundColor: "#111111",
      candidates: []
    }),
    DEFAULT_DARK_TEXT_COLOR
  );
  assert.equal(
    resolveBestContrastCandidate({
      backgroundColor: "#111111",
      candidates: ["invalid", "#eeeeee", "#ffffff"]
    }),
    "#ffffff"
  );
});

test("deriveThemeAnalysis reports dark mode only when signals or authoritative palette hints exist", () => {
  const lightFile: FigmaFile = {
    name: "Workspace Board",
    document: {
      id: "doc",
      type: "DOCUMENT",
      children: []
    }
  };

  assert.deepEqual(
    deriveThemeAnalysis({
      file: lightFile,
      screens: [makeScreen({ id: "screen-1", name: "Overview", fillColor: "#fafafa" })],
      tokens: baseTokens
    }),
    {
      darkModeDetected: false,
      signals: {
        luminance: false,
        naming: false,
        lightDarkPair: false
      }
    }
  );

  const darkAnalysis = deriveThemeAnalysis({
    file: {
      ...lightFile,
      name: "Dark Workspace"
    },
    screens: [
      makeScreen({
        id: "screen-dark",
        name: "Dark Dashboard",
        fillColor: "#101418"
      }),
      makeScreen({
        id: "screen-light",
        name: "Overview",
        fillColor: "#f5f7fb"
      })
    ],
    tokens: baseTokens
  });

  assert.equal(darkAnalysis.darkModeDetected, true);
  assert.equal(darkAnalysis.signals.naming, true);
  assert.equal(darkAnalysis.signals.lightDarkPair, true);
  assert.equal(typeof darkAnalysis.darkPaletteHints?.background?.default, "string");
  assert.equal(typeof darkAnalysis.darkPaletteHints?.text?.primary, "string");
});

test("applyMcpEnrichmentToIr augments diagnostics once and rewrites hinted screen elements", () => {
  const ir = {
    screens: [
      makeScreen({
        id: "screen-1",
        name: "Main Screen",
        children: [
          makeElement({
            id: "hero",
            type: "container",
            name: "Container",
            children: [
              makeElement({
                id: "caption",
                type: "container",
                name: "Vector",
                text: "Old title"
              })
            ]
          })
        ]
      })
    ],
    metrics: {
      nodeDiagnostics: [
        {
          nodeId: "__mcp:assets",
          category: "asset-fallback",
          reason: "Existing diagnostic"
        }
      ]
    }
  } as unknown as DesignIR;

  const enrichment: FigmaMcpEnrichment = {
    sourceMode: "hybrid",
    toolNames: ["metadata"],
    nodeHints: [
      {
        nodeId: "caption",
        semanticName: "Headline",
        semanticType: "text",
        sourceTools: ["metadata"]
      }
    ],
    metadataHints: [
      {
        nodeId: "hero",
        semanticName: "Primary CTA",
        semanticType: "button",
        sourceTools: ["metadata"]
      }
    ],
    variables: [],
    styleCatalog: [],
    codeConnectMappings: [],
    designSystemMappings: [],
    assets: [
      {
        nodeId: "hero",
        source: "/assets/hero.png",
        kind: "image",
        alt: "Hero illustration"
      }
    ],
    diagnostics: [
      {
        code: "partial",
        message: "Loader returned partial MCP coverage.",
        severity: "warning",
        source: "loader"
      }
    ]
  };

  const enriched = applyMcpEnrichmentToIr(ir, enrichment);
  const nodeDiagnostics = enriched.metrics?.nodeDiagnostics ?? [];

  assert.equal(
    nodeDiagnostics.some((entry) => entry.nodeId === "__mcp:variables" && entry.category === "missing-variable-enrichment"),
    true
  );
  assert.equal(
    nodeDiagnostics.some((entry) => entry.nodeId === "__mcp:styles" && entry.category === "missing-style-enrichment"),
    true
  );
  assert.equal(
    nodeDiagnostics.some((entry) => entry.nodeId === "__mcp:code-connect" && entry.category === "missing-code-connect-enrichment"),
    true
  );
  assert.equal(
    nodeDiagnostics.some((entry) => entry.nodeId === "__mcp:design-system" && entry.reason.includes("design-system suggestions")),
    true
  );
  assert.equal(
    nodeDiagnostics.some((entry) => entry.nodeId === "__mcp:loader" && entry.category === "hybrid-fallback"),
    true
  );
  assert.equal(
    nodeDiagnostics.filter((entry) => entry.nodeId === "__mcp:assets" && entry.category === "asset-fallback").length,
    1
  );

  const transformedHero = enriched.screens[0]?.children[0];
  const transformedCaption = transformedHero?.children?.[0];
  assert.equal(transformedHero?.type, "button");
  assert.equal(transformedHero?.name, "Primary CTA");
  assert.deepEqual(transformedHero?.asset, {
    source: "/assets/hero.png",
    kind: "image",
    alt: "Hero illustration"
  });
  assert.equal(transformedCaption?.type, "text");
  assert.equal(transformedCaption?.text, "Old title");
  assert.equal(transformedCaption?.name, "Headline");
});
