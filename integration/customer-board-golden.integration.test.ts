import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCustomerBoardPublicArtifactSanitized,
  collectActualFixtureOutputs,
  deriveCustomerBoardDesignIrAndAnalysis,
  executeCustomerBoardFixture,
  loadCustomerBoardFixtureInputs,
  loadCustomerBoardGoldenManifest,
  readCommittedCustomerBoardGoldenBundle
} from "./customer-board-golden.helpers.js";

const assertAttemptOneStage = (
  stage: { attempt?: number; outputCaptureKey?: string; status?: string } | undefined,
  label: string,
  expectedStatus: string
): void => {
  assert.ok(stage, `${label} must be present`);
  assert.equal(stage?.attempt, 1, `${label} must run on attempt 1`);
  assert.equal(stage?.status, expectedStatus, `${label} must report status '${expectedStatus}'`);
  assert.ok(stage?.outputCaptureKey?.includes("attempt-1"), `${label} must reference attempt-1 in outputCaptureKey`);
};

const getExpectedOutput = (
  manifest: { expected: { generated: Array<{ actual: string; expected: string }> } },
  actualPath: string
): string => {
  const artifact = manifest.expected.generated.find((entry) => entry.actual === actualPath);
  assert.ok(artifact, `Expected manifest entry for '${actualPath}' to exist.`);
  return artifact.expected;
};

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
  assert.equal(committedBundle.files.has("derived/storybook.evidence.json"), false);
  const committedEvidenceHints = committedBundle.files.get(manifest.derived.storybookEvidenceHints);
  assert.ok(committedEvidenceHints, "Committed storybook evidence hints fixture must exist.");
  assertCustomerBoardPublicArtifactSanitized({
    label: manifest.derived.storybookEvidenceHints,
    value: JSON.parse(committedEvidenceHints.content) as unknown
  });

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
    generatedApp?: {
      attempts?: number;
      install?: {
        command?: { attempt?: number; outputCaptureKey?: string; status?: string };
        status?: string;
      };
      lintAutofix?: { attempt?: number; outputCaptureKey?: string; status?: string };
      lint?: { attempt?: number; outputCaptureKey?: string; status?: string };
      build?: { attempt?: number; outputCaptureKey?: string; status?: string };
      typecheck?: { attempt?: number; outputCaptureKey?: string; status?: string };
      status?: string;
    };
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
  assert.equal("requestedPath" in (validationSummary.storybook ?? {}), false);
  assert.equal("filePath" in (validationSummary.storybook?.artifacts?.evidence ?? {}), false);
  assert.ok(validationSummary.generatedApp, "validation-summary.generatedApp must be present");
  assert.equal(validationSummary.generatedApp?.attempts, 1);
  assert.equal(validationSummary.generatedApp?.status, "ok");
  assertAttemptOneStage(validationSummary.generatedApp?.lintAutofix, "validation-summary.generatedApp.lintAutofix", "completed");
  assertAttemptOneStage(validationSummary.generatedApp?.lint, "validation-summary.generatedApp.lint", "passed");
  assertAttemptOneStage(validationSummary.generatedApp?.build, "validation-summary.generatedApp.build", "passed");
  assertAttemptOneStage(validationSummary.generatedApp?.typecheck, "validation-summary.generatedApp.typecheck", "passed");
  assert.equal(validationSummary.generatedApp?.install?.command?.attempt, 1);
  assert.equal(validationSummary.generatedApp?.install?.status, "completed");
  assert.equal(validationSummary.mapping?.figmaLibraryResolution?.status, "ok");
  assert.equal(validationSummary.mapping?.componentMatchReport?.status, "ok");
  assert.notEqual(validationSummary.mapping?.customerProfileMatch?.status, "not_available");
  assert.equal("filePath" in (validationSummary.style?.storybook?.evidence ?? {}), false);
  assert.equal(validationSummary.style?.storybook?.tokens?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.themes?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.componentMatchReport?.status, "ok");
  assert.equal(
    (validationSummary.style?.diagnostics?.componentMatchReport?.resolvedCustomerComponentCount ?? 0) >= 0,
    true
  );
  assert.equal((validationSummary.import?.customerProfile?.import?.issueCount ?? 0) >= 0, true);

  const screenFile = firstOutputs.get(getExpectedOutput(manifest, "src/screens/SeitenContent.tsx"));
  const patternContextFile = firstOutputs.get(getExpectedOutput(manifest, "src/context/SeitenContentPatternContext.tsx"));
  assert.ok(screenFile, "Generated SeitenContent screen must exist.");
  assert.ok(patternContextFile, "Generated pattern context file must exist.");
  assert.equal(
    screenFile?.includes("import { SeitenContentPattern1 }"),
    false,
    "Generated SeitenContent screen must not import the unused extracted component."
  );
  assert.equal(
    screenFile?.includes("SeitenContentPatternContextProvider"),
    true,
    "Generated SeitenContent screen must still use the pattern context provider."
  );
  assert.equal(
    screenFile?.includes("type SeitenContentPatternContextState"),
    true,
    "Generated SeitenContent screen must still import the pattern context state type."
  );
  assert.equal(
    patternContextFile?.includes("SeitenContentPattern1State"),
    true,
    "Generated pattern context file must still define the extracted pattern state."
  );
  assert.equal(
    patternContextFile?.includes("SeitenContentPatternContextProvider"),
    true,
    "Generated pattern context file must still expose the pattern context provider."
  );
  assert.equal(JSON.stringify(validationSummary.generatedApp).includes("attempt-2"), false);
});
