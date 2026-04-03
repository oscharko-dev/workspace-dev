import assert from "node:assert/strict";
import test from "node:test";
import { buildFigmaAnalysis } from "./figma-analysis.js";

const createTextNode = ({
  id,
  name,
  characters,
  x,
  y,
  width = 240,
  height = 24,
  textStyleId
}: {
  id: string;
  name: string;
  characters: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  textStyleId?: string;
}) => ({
  id,
  type: "TEXT",
  name,
  characters,
  absoluteBoundingBox: { x, y, width, height },
  ...(textStyleId ? { textStyleId } : {})
});

const createInstanceNode = ({
  id,
  name,
  componentId,
  componentSetId,
  x,
  y,
  width,
  height,
  properties,
  fillStyleId,
  boundVariables,
  children
}: {
  id: string;
  name: string;
  componentId: string;
  componentSetId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: Record<string, string>;
  fillStyleId?: string;
  boundVariables?: Record<string, unknown>;
  children?: unknown[];
}) => ({
  id,
  type: "INSTANCE",
  name,
  componentId,
  ...(componentSetId ? { componentSetId } : {}),
  absoluteBoundingBox: { x, y, width, height },
  ...(fillStyleId ? { fillStyleId } : {}),
  ...(boundVariables ? { boundVariables } : {}),
  ...(properties
    ? {
        componentProperties: Object.fromEntries(
          Object.entries(properties).map(([key, value]) => [key, { type: "VARIANT", value }])
        )
      }
    : {}),
  ...(children ? { children } : {})
});

const createFrame = ({
  id,
  name,
  x,
  y,
  height,
  pricingText,
  accordionState,
  withErrors
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  height: number;
  pricingText: string;
  accordionState: "Expanded" | "Collapsed";
  withErrors?: boolean;
}) => ({
  id,
  type: "FRAME",
  name,
  layoutMode: "VERTICAL",
  absoluteBoundingBox: { x, y, width: 1336, height },
  children: [
    {
      id: `${id}-header`,
      type: "FRAME",
      name: "Header",
      layoutMode: "HORIZONTAL",
      absoluteBoundingBox: { x, y, width: 1336, height: 128 },
      children: [
        createTextNode({
          id: `${id}-title`,
          name: "Title",
          characters: "Bedarfsermittlung Investitionskredit",
          x: x + 32,
          y: y + 24,
          width: 520,
          height: 36,
          textStyleId: "style-local-text"
        }),
        createTextNode({
          id: `${id}-mode`,
          name: "Mode",
          characters: pricingText,
          x: x + 32,
          y: y + 72,
          width: 320,
          height: 24
        })
      ]
    },
    {
      id: `${id}-body`,
      type: "FRAME",
      name: "Form Body",
      layoutMode: "VERTICAL",
      absoluteBoundingBox: { x: x + 24, y: y + 152, width: 1288, height: height - 176 },
      fillStyleId: "style-linked-fill",
      boundVariables: {
        fills: {
          color: {
            id: "120:1",
            resolvedModeId: "20708:1"
          }
        }
      },
      children: [
        createInstanceNode({
          id: `${id}-card-1`,
          name: "Card / Summary",
          componentId: "component-card",
          x: x + 32,
          y: y + 176,
          width: 1240,
          height: 192,
          fillStyleId: "style-linked-card"
        }),
        createInstanceNode({
          id: `${id}-accordion-1`,
          name: `Accordion, State=${accordionState}`,
          componentId: "component-accordion-expanded",
          componentSetId: "set-accordion",
          x: x + 32,
          y: y + 392,
          width: 1240,
          height: accordionState === "Expanded" ? 680 : 320,
          properties: {
            State: accordionState
          },
          children: [
            createInstanceNode({
              id: `${id}-accordion-card-a`,
              name: "Card / Detail",
              componentId: "component-card",
              x: x + 48,
              y: y + 432,
              width: 1180,
              height: 128
            }),
            createInstanceNode({
              id: `${id}-accordion-card-b`,
              name: "Card / Detail",
              componentId: "component-card",
              x: x + 48,
              y: y + 576,
              width: 1180,
              height: 128
            }),
            createInstanceNode({
              id: `${id}-accordion-card-c`,
              name: "Card / Detail",
              componentId: "component-card",
              x: x + 48,
              y: y + 720,
              width: 1180,
              height: 128
            })
          ]
        }),
        ...(withErrors
          ? [
              createTextNode({
                id: `${id}-error`,
                name: "Error Text",
                characters: "Fehler bei der Validierung",
                x: x + 32,
                y: y + height - 96,
                width: 420,
                height: 24
              })
            ]
          : [])
      ]
    }
  ]
});

const createAnalysisFixture = () => ({
  name: "Sample Board",
  styles: {
    "style-local-text": {
      name: "Typography / Heading",
      styleType: "TEXT"
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        name: "Page 1",
        children: [
          {
            id: "1:100",
            type: "SECTION",
            name: "Bedarfsermittlung Investitionskredit Flow ID-003",
            children: [
              createFrame({
                id: "1:63230",
                name: "ID-003.5 Brutto + Betriebsmittel, alle Cluster eingeklappt",
                x: 0,
                y: 0,
                height: 2354,
                pricingText: "Brutto",
                accordionState: "Collapsed"
              }),
              createFrame({
                id: "1:64644",
                name: "ID-003.4 Netto + Betriebsmittel, alle Cluster expanded",
                x: 1400,
                y: 0,
                height: 3718,
                pricingText: "Netto",
                accordionState: "Expanded"
              }),
              createFrame({
                id: "1:66050",
                name: "ID-003.3 Netto + Betriebsmittel, alle Cluster eingeklappt",
                x: 2800,
                y: 0,
                height: 2378,
                pricingText: "Netto",
                accordionState: "Collapsed"
              }),
              createFrame({
                id: "1:67464",
                name: "ID-003.2 Netto + Betriebsmittel, alle Cluster eingeklappt v1",
                x: 4200,
                y: 0,
                height: 2134,
                pricingText: "Netto",
                accordionState: "Collapsed"
              }),
              createFrame({
                id: "1:68884",
                name: "ID-003.1 Fehlermeldungen",
                x: 5600,
                y: 0,
                height: 2406,
                pricingText: "Netto",
                accordionState: "Collapsed",
                withErrors: true
              })
            ]
          }
        ]
      }
    ]
  }
});

test("buildFigmaAnalysis collects token, style, component, and diagnostic signals", () => {
  const analysis = buildFigmaAnalysis({
    file: createAnalysisFixture()
  });

  assert.equal(analysis.summary.pageCount, 1);
  assert.equal(analysis.summary.sectionCount, 1);
  assert.equal(analysis.summary.topLevelFrameCount, 5);
  assert.equal(analysis.summary.localStyleCount, 1);
  assert.equal(analysis.summary.localComponentCount, 0);
  assert.equal(analysis.summary.externalComponentCount > 0, true);

  assert.deepEqual(analysis.tokenSignals.boundVariableIds, ["120:1"]);
  assert.deepEqual(analysis.tokenSignals.variableModeIds, ["20708:1"]);
  assert.deepEqual(analysis.tokenSignals.styleReferences.localStyleIds, ["style-local-text"]);
  assert.equal(analysis.tokenSignals.styleReferences.linkedStyleIds.includes("style-linked-fill"), true);
  assert.equal(analysis.tokenSignals.styleReferences.linkedStyleIds.includes("style-linked-card"), true);

  const accordionFamily = analysis.componentFamilies.find((entry) => entry.familyKey === "component-set:set-accordion");
  assert.ok(accordionFamily);
  assert.deepEqual(accordionFamily?.variantProperties, [
    {
      property: "state",
      values: ["Collapsed", "Expanded"]
    }
  ]);

  const diagnosticCodes = analysis.diagnostics.map((entry) => entry.code);
  assert.equal(diagnosticCodes.includes("MISSING_LOCAL_COMPONENTS"), true);
  assert.equal(diagnosticCodes.includes("MISSING_LOCAL_STYLES"), true);
});

test("buildFigmaAnalysis groups variant frames, detects shell signals and density hotspots deterministically", () => {
  const fixture = createAnalysisFixture();
  const first = buildFigmaAnalysis({ file: fixture });
  const second = buildFigmaAnalysis({ file: fixture });

  assert.deepEqual(first, second);
  assert.equal(first.frameVariantGroups.length, 1);
  assert.equal(first.frameVariantGroups[0]?.frameIds.length, 5);
  assert.equal(first.frameVariantGroups[0]?.variantAxes.some((entry) => entry.axis === "pricing-mode"), true);
  assert.equal(first.frameVariantGroups[0]?.variantAxes.some((entry) => entry.axis === "validation-state"), true);
  assert.equal(first.frameVariantGroups[0]?.variantAxes.some((entry) => entry.axis === "expansion-state"), true);
  assert.equal(first.appShellSignals.length > 0, true);
  assert.equal(first.appShellSignals.some((entry) => entry.role === "header"), true);
  assert.equal(first.componentDensity.byFrame.length, 5);
  assert.equal(first.componentDensity.hotspots.length > 0, true);
  assert.equal(first.componentDensity.boardDominantFamilies[0]?.familyKey, "component:component-card");
});

test("buildFigmaAnalysis prefers canonical variant properties over data aliases regardless of property order", () => {
  const createDuplicateVariantFixture = (componentProperties: Record<string, { type: string; value: string }>) => ({
    name: "Duplicate Variant Fixture",
    styles: {},
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              id: "1:1",
              type: "FRAME",
              name: "Frame",
              layoutMode: "VERTICAL",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 320 },
              children: [
                {
                  id: "1:2",
                  type: "INSTANCE",
                  name: "Variant=Contained, Data-variant=SpaceAround",
                  componentId: "button-primary",
                  absoluteBoundingBox: { x: 16, y: 16, width: 160, height: 48 },
                  componentProperties
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const first = buildFigmaAnalysis({
    file: createDuplicateVariantFixture({
      "Data-variant": { type: "VARIANT", value: "SpaceAround" },
      Variant: { type: "VARIANT", value: "Contained" }
    })
  });
  const second = buildFigmaAnalysis({
    file: createDuplicateVariantFixture({
      Variant: { type: "VARIANT", value: "Contained" },
      "Data-variant": { type: "VARIANT", value: "SpaceAround" }
    })
  });

  const firstFamily = first.componentFamilies.find((entry) => entry.familyKey === "component:button-primary");
  const secondFamily = second.componentFamilies.find((entry) => entry.familyKey === "component:button-primary");
  assert.equal(firstFamily?.variantProperties.find((entry) => entry.property === "variant")?.values[0], "Contained");
  assert.equal(secondFamily?.variantProperties.find((entry) => entry.property === "variant")?.values[0], "Contained");
  assert.deepEqual(first, second);
});
