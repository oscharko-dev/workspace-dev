import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";

const createResponsiveScreenExtractionFixture = () => ({
  name: "Responsive Screen Extraction Fixture",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "hidden-canvas",
        type: "CANVAS",
        visible: false,
        children: [
          {
            id: "hidden-root",
            type: "FRAME",
            name: "Hidden root",
            absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 80 },
            children: [
              {
                id: "hidden-leaf",
                type: "TEXT",
                name: "Hidden leaf",
                characters: "Hidden",
                absoluteBoundingBox: { x: 4, y: 4, width: 40, height: 20 }
              }
            ]
          }
        ]
      },
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "profile-xs",
            type: "FRAME",
            name: "Profile - Mobile",
            layoutMode: "VERTICAL",
            itemSpacing: 8,
            absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              {
                id: "profile-xs-main",
                type: "FRAME",
                name: "Profile Main",
                absoluteBoundingBox: { x: 16, y: 120, width: 358, height: 220 },
                children: []
              },
              {
                id: "profile-xs-hidden",
                type: "FRAME",
                name: "Hidden Helper",
                visible: false,
                absoluteBoundingBox: { x: 16, y: 360, width: 100, height: 80 },
                children: []
              }
            ]
          },
          {
            id: "profile-sm",
            type: "FRAME",
            name: "Profile - Tablet",
            layoutMode: "VERTICAL",
            itemSpacing: 12,
            absoluteBoundingBox: { x: 440, y: 0, width: 768, height: 1024 },
            children: [
              {
                id: "profile-sm-main",
                type: "FRAME",
                name: "Profile Main",
                absoluteBoundingBox: { x: 496, y: 144, width: 656, height: 220 },
                children: []
              },
              {
                id: "profile-sm-hidden",
                type: "FRAME",
                name: "Hidden Helper",
                visible: false,
                absoluteBoundingBox: { x: 496, y: 380, width: 100, height: 80 },
                children: []
              }
            ]
          },
          {
            id: "checkout-lg-area",
            type: "FRAME",
            name: "Checkout - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 20,
            absoluteBoundingBox: { x: 1300, y: 0, width: 1400, height: 900 },
            children: [
              {
                id: "checkout-area-main",
                type: "FRAME",
                name: "Checkout Hero",
                absoluteBoundingBox: { x: 1360, y: 120, width: 1280, height: 280 },
                children: []
              },
              {
                id: "checkout-area-hidden",
                type: "FRAME",
                name: "Hidden Helper",
                visible: false,
                absoluteBoundingBox: { x: 1360, y: 420, width: 120, height: 40 },
                children: []
              }
            ]
          },
          {
            id: "checkout-lg-elements",
            type: "FRAME",
            name: "Checkout - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 20,
            absoluteBoundingBox: { x: 2750, y: 0, width: 1200, height: 760 },
            children: [
              {
                id: "checkout-elements-main",
                type: "FRAME",
                name: "Checkout Main",
                absoluteBoundingBox: { x: 2810, y: 120, width: 760, height: 280 },
                children: [
                  {
                    id: "checkout-elements-deep-group",
                    type: "FRAME",
                    name: "Deep Group",
                    absoluteBoundingBox: { x: 2820, y: 130, width: 300, height: 120 },
                    children: [
                      {
                        id: "checkout-elements-deep-label",
                        type: "TEXT",
                        name: "Deep Label",
                        characters: "Checkout",
                        absoluteBoundingBox: { x: 2830, y: 140, width: 120, height: 24 }
                      }
                    ]
                  }
                ]
              },
              {
                id: "checkout-elements-secondary",
                type: "FRAME",
                name: "Checkout Secondary",
                absoluteBoundingBox: { x: 3590, y: 120, width: 280, height: 280 },
                children: []
              }
            ]
          },
          {
            id: "report-lg-z",
            type: "FRAME",
            name: "Report - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 16,
            absoluteBoundingBox: { x: 4010, y: 0, width: 1180, height: 820 },
            children: [
              {
                id: "report-z-main",
                type: "FRAME",
                name: "Report Main",
                absoluteBoundingBox: { x: 4070, y: 120, width: 1060, height: 220 },
                children: []
              },
              {
                id: "report-z-hidden",
                type: "FRAME",
                name: "Hidden Helper",
                visible: false,
                absoluteBoundingBox: { x: 4070, y: 360, width: 100, height: 60 },
                children: []
              }
            ]
          },
          {
            id: "report-lg-a",
            type: "FRAME",
            name: "Report - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 16,
            absoluteBoundingBox: { x: 5230, y: 0, width: 1180, height: 820 },
            children: [
              {
                id: "report-a-main",
                type: "FRAME",
                name: "Report Main",
                absoluteBoundingBox: { x: 5290, y: 120, width: 1060, height: 220 },
                children: []
              },
              {
                id: "report-a-hidden",
                type: "FRAME",
                name: "Hidden Helper",
                visible: false,
                absoluteBoundingBox: { x: 5290, y: 360, width: 100, height: 60 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

test("figmaToDesignIrWithOptions keeps responsive winner precedence and fallback base breakpoint", () => {
  const ir = figmaToDesignIrWithOptions(createResponsiveScreenExtractionFixture() as any);
  const screenById = new Map(ir.screens.map((screen) => [screen.id, screen]));

  assert.equal(screenById.has("checkout-lg-elements"), true);
  assert.equal(screenById.has("checkout-lg-area"), false);
  assert.equal(screenById.has("report-lg-a"), true);
  assert.equal(screenById.has("report-lg-z"), false);

  const profileBase = screenById.get("profile-sm");
  assert.ok(profileBase?.responsive);
  assert.equal(profileBase?.responsive?.baseBreakpoint, "sm");
  assert.deepEqual(
    profileBase?.responsive?.variants.map((variant) => variant.breakpoint),
    ["xs", "sm"]
  );
});

test("figmaToDesignIrWithOptions keeps responsive winner extraction deterministic", () => {
  const first = figmaToDesignIrWithOptions(createResponsiveScreenExtractionFixture() as any);
  const second = figmaToDesignIrWithOptions(createResponsiveScreenExtractionFixture() as any);
  const summarize = (ir: ReturnType<typeof figmaToDesignIrWithOptions>) =>
    ir.screens
      .map((screen) => ({
        id: screen.id,
        name: screen.name,
        baseBreakpoint: screen.responsive?.baseBreakpoint,
        variants: screen.responsive?.variants.map((variant) => `${variant.breakpoint}:${variant.nodeId}:${variant.isBase}`)
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(summarize(first), summarize(second));
  assert.deepEqual(first.metrics?.screenElementCounts, second.metrics?.screenElementCounts);
});

test("figmaToDesignIrWithOptions keeps hidden, truncation, and depth metrics stable for responsive extraction", () => {
  const first = figmaToDesignIrWithOptions(createResponsiveScreenExtractionFixture() as any, {
    screenElementBudget: 1,
    screenElementMaxDepth: 1
  });
  const second = figmaToDesignIrWithOptions(createResponsiveScreenExtractionFixture() as any, {
    screenElementBudget: 1,
    screenElementMaxDepth: 1
  });

  assert.deepEqual(first.metrics?.screenElementCounts, second.metrics?.screenElementCounts);
  assert.deepEqual(first.metrics?.truncatedScreens, second.metrics?.truncatedScreens);
  assert.deepEqual(first.metrics?.depthTruncatedScreens, second.metrics?.depthTruncatedScreens);
  assert.equal((first.metrics?.skippedHidden ?? 0) >= 3, true);

  const truncated = first.metrics?.truncatedScreens.find((entry) => entry.screenId === "checkout-lg-elements");
  assert.ok(truncated);
  assert.equal(truncated?.budget, 1);
  assert.equal((truncated?.retainedElements ?? 0) <= 1, true);

  const depthTruncated = first.metrics?.depthTruncatedScreens.find((entry) => entry.screenId === "checkout-lg-elements");
  assert.ok(depthTruncated);
  assert.equal(depthTruncated?.maxDepth, 1);
  assert.equal((depthTruncated?.truncatedBranchCount ?? 0) >= 1, true);
});
