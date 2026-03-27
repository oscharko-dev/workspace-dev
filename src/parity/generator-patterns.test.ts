import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPatternExtractionPlan,
  toFormContextHookName,
  toFormContextProviderName,
  toPatternContextHookName,
  toPatternContextProviderName
} from "./generator-patterns.js";
import type { IconFallbackResolver, VirtualParent } from "./generator-render.js";
import type { ScreenElementIR, ScreenIR } from "./types.js";

const emptyIconResolver: IconFallbackResolver = {
  entries: [],
  byIconName: new Map(),
  exactAliasMap: new Map(),
  tokenIndex: new Map(),
  synonymMap: new Map()
};

const rootParent: VirtualParent = {
  x: 0,
  y: 0,
  width: 390,
  height: 844,
  layoutMode: "VERTICAL"
};

const makeText = ({
  id,
  text,
  y
}: {
  id: string;
  text: string;
  y: number;
}): ScreenElementIR =>
  ({
    id,
    type: "text",
    nodeType: "TEXT",
    name: id,
    text,
    x: 0,
    y
  }) as ScreenElementIR;

const makeNode = ({
  id,
  type,
  name = id,
  children,
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  children?: ScreenElementIR[];
} & Omit<Partial<ScreenElementIR>, "children" | "id" | "name" | "type">): ScreenElementIR =>
  ({
    id,
    type,
    nodeType: "FRAME",
    name,
    ...(children ? { children } : {}),
    ...overrides
  }) as ScreenElementIR;

const makePromoCard = ({
  id,
  title,
  body,
  imageId,
  y
}: {
  id: string;
  title: string;
  body: string;
  imageId: string;
  y: number;
}): ScreenElementIR =>
  makeNode({
    id,
    type: "card",
    name: "Promo Card",
    layoutMode: "VERTICAL",
    x: 0,
    y,
    width: 320,
    height: 220,
    children: [
      makeNode({
        id: imageId,
        type: "image",
        name: "Hero Image",
        width: 320,
        height: 120,
        y: 0
      }),
      makeText({
        id: `${id}-title`,
        text: title,
        y: 136
      }),
      makeText({
        id: `${id}-body`,
        text: body,
        y: 168
      })
    ]
  });

test("pattern context and form context naming helpers stay deterministic", () => {
  assert.equal(toPatternContextProviderName("CheckoutScreen"), "CheckoutScreenPatternContextProvider");
  assert.equal(toPatternContextHookName("CheckoutScreen"), "useCheckoutScreenPatternContext");
  assert.equal(toFormContextProviderName("CheckoutScreen"), "CheckoutScreenFormContextProvider");
  assert.equal(toFormContextHookName("CheckoutScreen"), "useCheckoutScreenFormContext");
});

test("buildPatternExtractionPlan returns an empty plan when extraction is disabled or insufficient", () => {
  const screen = {
    id: "screen-1",
    name: "Catalog",
    layoutMode: "VERTICAL",
    width: 390,
    height: 844,
    children: []
  } as ScreenIR;

  const disabled = buildPatternExtractionPlan({
    enablePatternExtraction: false,
    screen,
    screenComponentName: "CatalogScreen",
    roots: [],
    rootParent,
    generationLocale: "en-US",
    spacingBase: 8,
    tokens: undefined,
    iconResolver: emptyIconResolver,
    imageAssetMap: {},
    routePathByScreenId: new Map(),
    mappingByNodeId: new Map(),
    pageBackgroundColorNormalized: "#ffffff"
  });
  assert.deepEqual(disabled.componentFiles, []);
  assert.deepEqual(disabled.contextFiles, []);
  assert.deepEqual(disabled.componentImports, []);
  assert.equal(disabled.invocationByRootNodeId.size, 0);

  const insufficient = buildPatternExtractionPlan({
    enablePatternExtraction: true,
    screen,
    screenComponentName: "CatalogScreen",
    roots: [
      makeNode({
        id: "single-card",
        type: "card",
        children: [makeText({ id: "single-card-title", text: "Only one", y: 0 })]
      }),
      makeNode({
        id: "second-card",
        type: "card",
        children: [makeText({ id: "second-card-title", text: "Only two", y: 0 })]
      })
    ],
    rootParent,
    generationLocale: "en-US",
    spacingBase: 8,
    tokens: undefined,
    iconResolver: emptyIconResolver,
    imageAssetMap: {},
    routePathByScreenId: new Map(),
    mappingByNodeId: new Map(),
    pageBackgroundColorNormalized: "#ffffff"
  });
  assert.deepEqual(insufficient.componentFiles, []);
  assert.equal(insufficient.invocationByRootNodeId.size, 0);
});

test("buildPatternExtractionPlan extracts repeated cards into a shared component and pattern context", () => {
  const roots = [
    makePromoCard({
      id: "promo-1",
      title: "Premium Checking",
      body: "Open an account in minutes.",
      imageId: "promo-image-1",
      y: 0
    }),
    makePromoCard({
      id: "promo-2",
      title: "Travel Rewards",
      body: "Collect miles on every purchase.",
      imageId: "promo-image-2",
      y: 240
    }),
    makePromoCard({
      id: "promo-3",
      title: "Mortgage Advice",
      body: "Talk to an expert about rates.",
      imageId: "promo-image-3",
      y: 480
    })
  ];
  const screen = {
    id: "screen-1",
    name: "Catalog",
    layoutMode: "VERTICAL",
    width: 390,
    height: 844,
    children: roots
  } as ScreenIR;

  const plan = buildPatternExtractionPlan({
    enablePatternExtraction: true,
    screen,
    screenComponentName: "CatalogScreen",
    roots,
    rootParent,
    generationLocale: "en-US",
    spacingBase: 8,
    tokens: undefined,
    iconResolver: emptyIconResolver,
    imageAssetMap: {
      "promo-image-1": "assets/promo-1.png",
      "promo-image-2": "assets/promo-2.png",
      "promo-image-3": "assets/promo-3.png"
    },
    routePathByScreenId: new Map(),
    mappingByNodeId: new Map(),
    pageBackgroundColorNormalized: "#ffffff"
  });

  assert.equal(plan.componentFiles.length, 1);
  assert.equal(plan.contextFiles.length, 1);
  assert.equal(plan.componentImports.length, 1);
  assert.equal(plan.invocationByRootNodeId.size, 3);
  assert.equal(
    [...plan.invocationByRootNodeId.values()].every((entry) => entry.usesPatternContext),
    true
  );
  assert.match(plan.componentFiles[0]?.content ?? "", /export function/);
  assert.match(plan.contextFiles[0]?.content ?? "", /createContext/);
  assert.match(plan.contextFiles[0]?.content ?? "", /CatalogScreenPattern1/);
});
