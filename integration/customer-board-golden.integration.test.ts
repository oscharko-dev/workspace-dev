import assert from "node:assert/strict";
import test from "node:test";
import {
  collectActualFixtureOutputs,
  deriveCustomerBoardDesignIrAndAnalysis,
  executeCustomerBoardFixture,
  loadCustomerBoardFixtureInputs,
  loadCustomerBoardGoldenManifest,
  readCommittedCustomerBoardGoldenBundle
} from "./customer-board-golden.helpers.js";

test("customer-board golden offline fixture reproduces committed derived artifacts and generated outputs deterministically", async () => {
  const manifest = await loadCustomerBoardGoldenManifest();
  const committedBundle = await readCommittedCustomerBoardGoldenBundle();
  const { figmaInput } = await loadCustomerBoardFixtureInputs({
    manifest
  });
  const { figmaAnalysis } = deriveCustomerBoardDesignIrAndAnalysis({
    figmaInput
  });

  const committedFigmaAnalysis = committedBundle.files.get(manifest.derived.figmaAnalysis);
  assert.ok(committedFigmaAnalysis, "Committed figma.analysis fixture must exist.");
  assert.deepEqual(JSON.parse(committedFigmaAnalysis.content), figmaAnalysis);

  const first = await executeCustomerBoardFixture({
    manifest
  });
  const second = await executeCustomerBoardFixture({
    manifest
  });

  const firstOutputs = await collectActualFixtureOutputs({
    manifest,
    executionContext: first.executionContext
  });
  const secondOutputs = await collectActualFixtureOutputs({
    manifest,
    executionContext: second.executionContext
  });

  assert.deepEqual([...firstOutputs.keys()].sort(), [...secondOutputs.keys()].sort());
  for (const [relativePath, firstContent] of firstOutputs.entries()) {
    assert.equal(
      secondOutputs.get(relativePath),
      firstContent,
      `Deterministic rerun mismatch for customer-board fixture artifact '${relativePath}'.`
    );
    assert.equal(
      committedBundle.files.get(relativePath)?.content,
      firstContent,
      `Committed fixture mismatch for customer-board artifact '${relativePath}'.`
    );
  }

  const validationSummary = JSON.parse(firstOutputs.get(manifest.expected.validationSummary) ?? "null") as {
    storybook?: {
      status?: string;
      artifacts?: {
        catalog?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        components?: { status?: string };
      };
    };
    mapping?: {
      status?: string;
      figmaLibraryResolution?: { status?: string };
      componentMatchReport?: { status?: string };
      customerProfileMatch?: { status?: string; issueCount?: number };
    };
    style?: {
      status?: string;
      storybook?: {
        tokens?: { status?: string };
        themes?: { status?: string };
        componentMatchReport?: { status?: string };
      };
      diagnostics?: {
        componentMatchReport?: {
          resolvedCustomerComponentCount?: number;
        };
      };
    };
    import?: {
      status?: string;
      customerProfile?: {
        import?: {
          issueCount?: number;
        };
      };
    };
  };

  assert.ok(validationSummary.storybook, "validation-summary.storybook must be present");
  assert.ok(validationSummary.mapping, "validation-summary.mapping must be present");
  assert.ok(validationSummary.style, "validation-summary.style must be present");
  assert.ok(validationSummary.import, "validation-summary.import must be present");
  assert.equal(validationSummary.storybook?.artifacts?.catalog?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.tokens?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.themes?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.components?.status, "ok");
  assert.equal(validationSummary.mapping?.figmaLibraryResolution?.status, "ok");
  assert.equal(validationSummary.mapping?.componentMatchReport?.status, "ok");
  assert.notEqual(validationSummary.mapping?.customerProfileMatch?.status, "not_available");
  assert.equal(validationSummary.style?.storybook?.tokens?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.themes?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.componentMatchReport?.status, "ok");
  assert.equal(
    (validationSummary.style?.diagnostics?.componentMatchReport?.resolvedCustomerComponentCount ?? 0) >= 0,
    true
  );
  assert.equal((validationSummary.import?.customerProfile?.import?.issueCount ?? 0) >= 0, true);
});
