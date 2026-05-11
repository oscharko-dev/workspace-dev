import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildComponentManifest, parseIrMarkersFromSource } from "./component-manifest.js";
import type { ScreenElementIR, ScreenIR } from "./types-ir.js";

const createContainerElement = ({
  id,
  name,
  children
}: {
  id: string;
  name: string;
  children?: ScreenElementIR[];
}): ScreenElementIR => ({
  id,
  name,
  nodeType: "FRAME",
  type: "container",
  ...(children ? { children } : {})
});

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
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children
});

const writeProjectFile = async ({
  projectDir,
  relativePath,
  content
}: {
  projectDir: string;
  relativePath: string;
  content: string;
}): Promise<void> => {
  const absolutePath = path.join(projectDir, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
};

test("parseIrMarkersFromSource returns empty for content without markers", () => {
  const content = `import React from "react";\nexport default function App() { return <div />; }\n`;
  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});

test("parseIrMarkersFromSource parses a single marker pair", () => {
  const content = [
    `import React from "react";`,
    `{/* @ir:start node-1 MyButton INSTANCE */}`,
    `<Button>Click</Button>`,
    `{/* @ir:end node-1 */}`,
    ``
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    irNodeId: "node-1",
    irNodeName: "MyButton",
    irNodeType: "INSTANCE",
    file: "src/screens/Home.tsx",
    startLine: 2,
    endLine: 4
  });
});

test("parseIrMarkersFromSource parses nested marker pairs", () => {
  const content = [
    `{/* @ir:start parent-1 Container FRAME */}`,
    `<div>`,
    `  {/* @ir:start child-1 Label TEXT */}`,
    `  <span>Hello</span>`,
    `  {/* @ir:end child-1 */}`,
    `</div>`,
    `{/* @ir:end parent-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 2);

  const child = entries.find((e) => e.irNodeId === "child-1");
  assert.ok(child);
  assert.equal(child.irNodeName, "Label");
  assert.equal(child.irNodeType, "TEXT");
  assert.equal(child.startLine, 3);
  assert.equal(child.endLine, 5);

  const parent = entries.find((e) => e.irNodeId === "parent-1");
  assert.ok(parent);
  assert.equal(parent.startLine, 1);
  assert.equal(parent.endLine, 7);
});

test("parseIrMarkersFromSource detects extracted components", () => {
  const content = [
    `{/* @ir:start comp-1 CardPattern INSTANCE extracted */}`,
    `<Card />`,
    `{/* @ir:end comp-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.extractedComponent, true);
});

test("parseIrMarkersFromSource handles names with spaces", () => {
  const content = [
    `{/* @ir:start id-1 My Long Component Name FRAME */}`,
    `<div />`,
    `{/* @ir:end id-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.irNodeName, "My Long Component Name");
  assert.equal(entries[0]!.irNodeType, "FRAME");
});

test("parseIrMarkersFromSource ignores unmatched start markers", () => {
  const content = [
    `{/* @ir:start orphan-1 Orphan FRAME */}`,
    `<div />`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});

test("parseIrMarkersFromSource ignores unmatched end markers", () => {
  const content = [
    `<div />`,
    `{/* @ir:end ghost-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});

test("buildComponentManifest associates extracted components and context files with the owning screen", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-component-manifest-"));
  const screens: ScreenIR[] = [
    createScreen({
      id: "screen-offers",
      name: "Offers",
      children: [
        createContainerElement({
          id: "offers-stack",
          name: "Offers Stack",
          children: [
            createContainerElement({
              id: "offer-card-a",
              name: "Offer Card"
            }),
            createContainerElement({
              id: "offer-form",
              name: "Offer Form"
            })
          ]
        })
      ]
    })
  ];

  await writeProjectFile({
    projectDir,
    relativePath: "src/screens/Offers.tsx",
    content: [
      `{/* @ir:start offers-stack Offers Stack FRAME */}`,
      `<section />`,
      `{/* @ir:end offers-stack */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/components/OffersPattern1.tsx",
    content: [
      `{/* @ir:start offer-card-a Offer Card INSTANCE extracted */}`,
      `<article />`,
      `{/* @ir:end offer-card-a */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/context/OffersPatternContext.tsx",
    content: [
      `{/* @ir:start offer-form Offer Form FRAME */}`,
      `<Provider />`,
      `{/* @ir:end offer-form */}`,
      ``
    ].join("\n")
  });

  const manifest = await buildComponentManifest({ projectDir, screens });
  assert.equal(manifest.screens.length, 1);

  const offersScreen = manifest.screens[0]!;
  assert.equal(offersScreen.file, "src/screens/Offers.tsx");
  assert.deepEqual(
    offersScreen.components.map((entry) => entry.file).sort(),
    ["src/components/OffersPattern1.tsx", "src/context/OffersPatternContext.tsx", "src/screens/Offers.tsx"]
  );

  const extractedComponent = offersScreen.components.find((entry) => entry.file === "src/components/OffersPattern1.tsx");
  assert.ok(extractedComponent);
  assert.equal(extractedComponent.extractedComponent, true);

  const contextEntry = offersScreen.components.find((entry) => entry.file === "src/context/OffersPatternContext.tsx");
  assert.ok(contextEntry);
  assert.equal(contextEntry.extractedComponent, undefined);
});

test("buildComponentManifest does not cross-associate unrelated component and context artifacts", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-component-manifest-multi-"));
  const screens: ScreenIR[] = [
    createScreen({
      id: "screen-offers",
      name: "Offers",
      children: [
        createContainerElement({
          id: "offer-card-a",
          name: "Offer Card"
        }),
        createContainerElement({
          id: "offer-form",
          name: "Offer Form"
        })
      ]
    }),
    createScreen({
      id: "screen-billing",
      name: "Billing",
      children: [
        createContainerElement({
          id: "billing-card-a",
          name: "Billing Card"
        }),
        createContainerElement({
          id: "billing-form",
          name: "Billing Form"
        })
      ]
    })
  ];

  await writeProjectFile({
    projectDir,
    relativePath: "src/screens/Offers.tsx",
    content: [
      `{/* @ir:start offer-card-a Offer Card FRAME */}`,
      `<section />`,
      `{/* @ir:end offer-card-a */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/screens/Billing.tsx",
    content: [
      `{/* @ir:start billing-card-a Billing Card FRAME */}`,
      `<section />`,
      `{/* @ir:end billing-card-a */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/components/OffersPattern1.tsx",
    content: [
      `{/* @ir:start offer-card-a Offer Card INSTANCE extracted */}`,
      `<article />`,
      `{/* @ir:end offer-card-a */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/context/OffersPatternContext.tsx",
    content: [
      `{/* @ir:start offer-form Offer Form FRAME */}`,
      `<Provider />`,
      `{/* @ir:end offer-form */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/components/BillingPattern1.tsx",
    content: [
      `{/* @ir:start billing-card-a Billing Card INSTANCE extracted */}`,
      `<article />`,
      `{/* @ir:end billing-card-a */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/context/BillingPatternContext.tsx",
    content: [
      `{/* @ir:start billing-form Billing Form FRAME */}`,
      `<Provider />`,
      `{/* @ir:end billing-form */}`,
      ``
    ].join("\n")
  });

  const manifest = await buildComponentManifest({ projectDir, screens });

  const offersScreen = manifest.screens.find((screen) => screen.screenId === "screen-offers");
  assert.ok(offersScreen);
  assert.deepEqual(
    offersScreen.components.map((entry) => entry.file).sort(),
    ["src/components/OffersPattern1.tsx", "src/context/OffersPatternContext.tsx", "src/screens/Offers.tsx"]
  );

  const billingScreen = manifest.screens.find((screen) => screen.screenId === "screen-billing");
  assert.ok(billingScreen);
  assert.deepEqual(
    billingScreen.components.map((entry) => entry.file).sort(),
    ["src/components/BillingPattern1.tsx", "src/context/BillingPatternContext.tsx", "src/screens/Billing.tsx"]
  );
});

test("buildComponentManifest can associate scenario-only artifacts with a canonical emitted screen", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-component-manifest-family-"));
  const screens: ScreenIR[] = [
    createScreen({
      id: "family-canonical",
      name: "Pricing Netto",
      children: [
        createContainerElement({
          id: "canonical-copy",
          name: "Canonical Copy"
        })
      ]
    })
  ];

  await writeProjectFile({
    projectDir,
    relativePath: "src/screens/PricingNetto.tsx",
    content: [
      `{/* @ir:start canonical-copy Canonical Copy FRAME */}`,
      `<section />`,
      `{/* @ir:end canonical-copy */}`,
      ``
    ].join("\n")
  });
  await writeProjectFile({
    projectDir,
    relativePath: "src/components/PricingModePattern.tsx",
    content: [
      `{/* @ir:start family-brutto-copy Brutto Copy FRAME extracted */}`,
      `<article />`,
      `{/* @ir:end family-brutto-copy */}`,
      ``
    ].join("\n")
  });

  const manifest = await buildComponentManifest({
    projectDir,
    screens,
    associatedNodeIdsByScreenId: new Map([
      [
        "family-canonical",
        new Set<string>(["family-canonical", "canonical-copy", "family-brutto", "family-brutto-copy"])
      ]
    ])
  });

  assert.equal(manifest.screens.length, 1);
  assert.deepEqual(
    manifest.screens[0]?.components.map((entry) => entry.file).sort(),
    ["src/components/PricingModePattern.tsx", "src/screens/PricingNetto.tsx"]
  );
});
