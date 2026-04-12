import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseStorybookComponentVisualCatalogArtifact,
  parseStorybookComponentsArtifact
} from "../src/storybook/artifact-validation.js";
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

const normalizeDynamicGoldenArtifact = (
  relativePath: string,
  content: string,
  validationSummaryPath: string,
): string => {
  if (relativePath !== validationSummaryPath) {
    return content;
  }
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => redact(entry));
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value).map(([key, nested]) => [
        key,
        key === "generatedAt" && typeof nested === "string"
          ? "<normalized-generated-at>"
          : redact(nested),
      ]);
      return Object.fromEntries(entries);
    }
    return value;
  };
  return JSON.stringify(redact(JSON.parse(content)), null, 2);
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
  const committedComponents = committedBundle.files.get(manifest.derived.storybookComponents);
  assert.ok(committedComponents, "Committed storybook components fixture must exist.");
  assert.equal(
    committedComponents.content.includes('"componentPath"'),
    false,
    "Committed storybook components fixture must not expose componentPath."
  );
  assertCustomerBoardPublicArtifactSanitized({
    label: manifest.derived.storybookComponents,
    value: JSON.parse(committedComponents.content) as unknown
  });
  parseStorybookComponentsArtifact({
    input: committedComponents.content
  });
  const committedComponentVisualCatalog = committedBundle.files.get(manifest.derived.componentVisualCatalog);
  assert.ok(committedComponentVisualCatalog, "Committed component visual catalog fixture must exist.");
  const committedComponentVisualCatalogValue = JSON.parse(committedComponentVisualCatalog.content) as unknown;
  assertCustomerBoardPublicArtifactSanitized({
    label: manifest.derived.componentVisualCatalog,
    value: committedComponentVisualCatalogValue
  });
  parseStorybookComponentVisualCatalogArtifact({
    input: committedComponentVisualCatalog.content
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
    const normalizedFirst = normalizeDynamicGoldenArtifact(
      relativePath,
      firstContent,
      manifest.expected.validationSummary,
    );
    const normalizedSecond = normalizeDynamicGoldenArtifact(
      relativePath,
      secondOutputs.get(relativePath) ?? "",
      manifest.expected.validationSummary,
    );
    const normalizedCommitted = normalizeDynamicGoldenArtifact(
      relativePath,
      committedBundle.files.get(relativePath)?.content ?? "",
      manifest.expected.validationSummary,
    );
    assert.equal(
      normalizedSecond,
      normalizedFirst,
      `Deterministic rerun mismatch for customer-board fixture artifact '${relativePath}'.`
    );
    if (relativePath === manifest.expected.validationSummary) {
      // Validation summary is runtime-observed status output and may evolve as
      // diagnostics/schema improve; we only enforce deterministic reruns here.
      continue;
    }
    assert.equal(
      normalizedCommitted,
      normalizedFirst,
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
      test?: { args?: string[]; attempt?: number; command?: string; outputCaptureKey?: string; status?: string; timedOut?: boolean };
      status?: string;
    };
    storybook?: {
      status?: string;
      artifacts?: {
        catalog?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        components?: { status?: string };
        componentVisualCatalog?: { status?: string };
      };
    };
    mapping?: {
      status?: string;
      figmaLibraryResolution?: { status?: string };
      componentMatchReport?: { status?: string };
      customerProfileMatch?: {
        counts?: {
          byReason?: {
            profile_import_resolved?: number;
          };
          byStatus?: {
            resolved_import?: number;
          };
          iconByReason?: {
            profile_icon_import_resolved?: number;
          };
          iconByStatus?: {
            resolved_import?: number;
          };
        };
        status?: string;
        issueCount?: number;
      };
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
          validatedComponentNames?: string[];
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
    uiA11y?: {
      status?: string;
      reportPath?: string;
      visualDiffCount?: number;
      a11yViolationCount?: number;
      interactionViolationCount?: number;
      checks?: Array<{ name: string; status: string; count: number; details?: string }>;
      summary?: string;
    };
    visualQuality?: {
      status?: string;
      referenceSource?: string;
      capturedAt?: string;
      overallScore?: number;
      dimensions?: Array<{ name?: string; score?: number }>;
      diffImagePath?: string;
    };
  };
  const componentMatchReport = JSON.parse(committedBundle.files.get(manifest.derived.componentMatchReport)?.content ?? "null") as {
    entries?: Array<{
      figma?: {
        familyKey?: string;
        familyName?: string;
      };
      iconResolution?: {
        byKey?: Record<
          string,
          {
            status?: string;
            import?: {
              localName?: string;
              package?: string;
            };
          }
        >;
      };
      match?: {
        status?: string;
      };
      storybookFamily?: {
        title?: string;
      };
    }>;
  };

  assert.ok(validationSummary.storybook, "validation-summary.storybook must be present");
  assert.ok(validationSummary.mapping, "validation-summary.mapping must be present");
  assert.ok(validationSummary.style, "validation-summary.style must be present");
  assert.ok(validationSummary.import, "validation-summary.import must be present");
  assert.ok(componentMatchReport.entries, "component-match-report entries must be present");
  assert.equal(validationSummary.storybook?.artifacts?.catalog?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.tokens?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.themes?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.components?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.componentVisualCatalog?.status, "ok");
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
  assert.equal((validationSummary.mapping?.customerProfileMatch?.counts?.byReason?.profile_import_resolved ?? 0) > 0, true);
  assert.equal((validationSummary.mapping?.customerProfileMatch?.counts?.byStatus?.resolved_import ?? 0) > 0, true);
  assert.equal(
    (validationSummary.mapping?.customerProfileMatch?.counts?.iconByReason?.profile_icon_import_resolved ?? 0) > 0,
    true
  );
  assert.equal((validationSummary.mapping?.customerProfileMatch?.counts?.iconByStatus?.resolved_import ?? 0) > 0, true);
  assert.equal("filePath" in (validationSummary.style?.storybook?.evidence ?? {}), false);
  assert.equal(validationSummary.style?.storybook?.tokens?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.themes?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.componentMatchReport?.status, "ok");
  assert.equal((validationSummary.style?.diagnostics?.componentMatchReport?.resolvedCustomerComponentCount ?? 0) > 0, true);
  assert.deepEqual(validationSummary.style?.diagnostics?.componentMatchReport?.validatedComponentNames ?? [], [
    "Chip",
    "Divider",
    "IconButton",
    "Typography"
  ]);
  assert.equal((validationSummary.style?.diagnostics?.tokens?.diagnosticCount ?? 0) > 0, true);
  assert.equal((validationSummary.style?.diagnostics?.themes?.diagnosticCount ?? 0) > 0, true);
  assert.equal(validationSummary.style?.issueCount ?? 0, 0);
  assert.deepEqual(validationSummary.style?.issues ?? [], []);
  assert.equal(validationSummary.import?.customerProfile?.import?.issueCount ?? 0, 0);
  assert.equal(validationSummary.generatedApp?.install?.status, "completed");
  assert.equal(validationSummary.generatedApp?.status, "ok");
  assert.equal(validationSummary.generatedApp?.attempts, 1);
  assert.equal(JSON.stringify(validationSummary.generatedApp).includes("attempt-2"), false);
  assert.equal(
    validationSummary.generatedApp?.install?.command?.outputCaptureKey?.includes("validate.project") ?? false,
    true
  );

  // #812 — uiA11y gate: the offline fixture runs with enableUiValidation=true.
  // The validate-ui-report.mjs script performs static analysis (no browser required)
  // and produces a report with a11y, interaction, and visual-diff checks.
  assert.ok(validationSummary.uiA11y, "validation-summary.uiA11y must be present");
  assert.equal(validationSummary.uiA11y?.status, "ok", "validation-summary.uiA11y.status must be 'ok'");
  assert.equal(validationSummary.uiA11y?.a11yViolationCount, 0, "Expected zero accessibility violations");
  assert.equal(validationSummary.uiA11y?.interactionViolationCount, 0, "Expected zero interaction violations");
  assert.equal(validationSummary.uiA11y?.visualDiffCount, 0, "Expected zero visual diffs on first run");
  assert.ok(
    Array.isArray(validationSummary.uiA11y?.checks) && validationSummary.uiA11y.checks.length > 0,
    "Expected uiA11y.checks to be a non-empty array"
  );
  assert.ok(
    validationSummary.uiA11y?.checks?.every((check) => check.status === "passed"),
    "Expected every uiA11y check to pass"
  );
  assert.ok(
    typeof validationSummary.uiA11y?.a11yViolationCount === "number",
    "Expected uiA11y.a11yViolationCount to be a number"
  );
  assert.ok(validationSummary.visualQuality, "validation-summary.visualQuality must be present");
  assert.equal(
    validationSummary.visualQuality?.referenceSource,
    "frozen_fixture",
    "validation-summary.visualQuality.referenceSource must be 'frozen_fixture'"
  );
  assert.equal(
    validationSummary.visualQuality?.capturedAt,
    "<timestamp>",
    "validation-summary.visualQuality.capturedAt must be normalized in the fixture output"
  );
  assert.ok(
    validationSummary.visualQuality?.status === "completed" || validationSummary.visualQuality?.status === "failed",
    `validation-summary.visualQuality.status must be 'completed' or 'failed', got '${String(validationSummary.visualQuality?.status)}'`
  );

  // #815 — generatedApp.test gate: the offline fixture runs with enableUnitTestValidation=true
  // and unitTestIgnoreFailure=true. The generated project's tests are executed by the validation
  // pipeline; results are recorded regardless of pass/fail to prove the test bootstrap ran.
  assert.ok(validationSummary.generatedApp?.test, "validation-summary.generatedApp.test must be present");
  assert.equal(
    typeof validationSummary.generatedApp?.test?.status === "string",
    true,
    "generatedApp.test.status must be a string"
  );
  assert.equal(validationSummary.generatedApp?.test?.command, "pnpm", "generatedApp.test.command must be 'pnpm'");
  assert.deepEqual(validationSummary.generatedApp?.test?.args, ["run", "test"], "generatedApp.test.args must be ['run', 'test']");
  assert.equal(validationSummary.generatedApp?.test?.timedOut, false, "generatedApp.test must not have timed out");

  const resolvedComponentNames = new Set(
    validationSummary.style?.diagnostics?.componentMatchReport?.validatedComponentNames ?? []
  );
  for (const name of ["Chip", "Divider", "IconButton", "Typography"]) {
    assert.equal(resolvedComponentNames.has(name), true, `Expected validated component names to include '${name}'.`);
  }

  const screenFile = firstOutputs.get(getExpectedOutput(manifest, "src/screens/SeitenContent.tsx"));
  const patternContextFile = firstOutputs.get(getExpectedOutput(manifest, "src/context/SeitenContentPatternContext.tsx"));
  const generatedPackageJson = JSON.parse(
    await readFile(`${first.executionContext.paths.generatedProjectDir}/package.json`, "utf8")
  ) as {
    dependencies?: Record<string, string>;
  };
  const generatedTsconfig = JSON.parse(
    await readFile(`${first.executionContext.paths.generatedProjectDir}/tsconfig.json`, "utf8")
  ) as {
    compilerOptions?: {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
  };
  const generatedViteConfig = await readFile(`${first.executionContext.paths.generatedProjectDir}/vite.config.ts`, "utf8");
  assert.ok(screenFile, "Generated SeitenContent screen must exist.");
  assert.ok(patternContextFile, "Generated pattern context file must exist.");
  assert.equal(generatedPackageJson.dependencies?.["@customer/icons"], "npm:@mui/icons-material@^7.3.9");
  assert.equal(generatedPackageJson.dependencies?.["@customer/ui"], "npm:@mui/material@^7.3.9");
  assert.equal(generatedTsconfig.compilerOptions?.baseUrl, ".");
  assert.deepEqual(generatedTsconfig.compilerOptions?.paths?.["@customer/icons"], ["@mui/icons-material"]);
  assert.deepEqual(generatedTsconfig.compilerOptions?.paths?.["@customer/ui"], ["@mui/material"]);
  assert.equal(generatedViteConfig.includes('"@customer/icons": "@mui/icons-material"'), true);
  assert.equal(generatedViteConfig.includes('"@customer/ui": "@mui/material"'), true);
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
  assert.equal(screenFile?.includes('import { Chip, Divider, IconButton } from "@customer/ui";'), false);
  assert.equal(
    screenFile?.includes("import { Alert, Avatar, Button, Card, CardContent, Chip, Container, Divider"),
    true
  );
  assert.equal(screenFile?.includes("SeitenContentPatternContextProvider"), true);

  const resolvedCustomerIcons = (componentMatchReport.entries ?? []).flatMap((entry) =>
    Object.values(entry.iconResolution?.byKey ?? {}).filter(
      (resolution) => resolution.status === "resolved_import" && resolution.import?.package === "@customer/icons"
    )
  );
  assert.equal(resolvedCustomerIcons.length > 0, true, "Expected customer-board fixture to resolve at least one exact customer icon import.");
  assert.equal(
    resolvedCustomerIcons.some((resolution) => resolution.import?.localName === "CustomerDocsIcon"),
    true,
    "Expected customer-board fixture to resolve the docs icon via CustomerDocsIcon."
  );

  // #784 — Verify the generated test file's content is structurally correct.
  // The file exists in the golden bundle but was never content-verified before.
  const generatedTestFile = firstOutputs.get(getExpectedOutput(manifest, "src/screens/__tests__/SeitenContent.test.tsx"));
  assert.ok(generatedTestFile, "Generated SeitenContent.test.tsx must exist in fixture outputs.");
  assert.equal(
    generatedTestFile?.includes('import { axe } from "jest-axe"'),
    true,
    "Generated test must import axe from jest-axe for accessibility testing."
  );
  assert.equal(
    generatedTestFile?.includes("toHaveNoViolations"),
    true,
    "Generated test must assert toHaveNoViolations for accessibility coverage."
  );
  assert.equal(
    generatedTestFile?.includes('describe("SeitenContentScreen"'),
    true,
    "Generated test must contain the SeitenContentScreen describe block."
  );
  assert.equal(
    generatedTestFile?.includes("has no detectable accessibility violations"),
    true,
    "Generated test must include the accessibility violation test case."
  );

  // #816 — form context validation-rule inference regression assertions.
  // Verify that the generated form context matches the expected validation structure
  // produced by the merged validation-rule inference pipeline (field.validationRules + classifyValidationEvidence).
  const formContextFile = firstOutputs.get(getExpectedOutput(manifest, "src/context/SeitenContentFormContext.tsx"));
  assert.ok(formContextFile, "Generated SeitenContentFormContext.tsx must exist in fixture outputs.");

  // All 7 fields must be non-required (no variant evidence triggers required detection).
  assert.equal(
    (formContextFile?.match(/"required":\s*false/g) ?? []).length,
    7,
    "All 7 fieldSchemaSpecs entries must have required: false."
  );
  assert.equal(
    formContextFile?.includes('"required": true'),
    false,
    "No fieldSchemaSpecs entry must be required: true — no error-frame evidence triggers required detection."
  );

  // No validationRules key in fieldSchemaSpecs (no evidence-inferred rules for this fixture).
  assert.equal(
    formContextFile?.includes('"validationRules":'),
    false,
    "fieldSchemaSpecs must not contain validationRules — the fixture has no error-frame evidence to infer rules."
  );

  // defaultValues must contain the expected pre-populated values.
  assert.equal(formContextFile?.includes('"Person"'), true, "defaultValues must contain the Person select default.");
  assert.equal(formContextFile?.includes('"EUR"'), true, "defaultValues must contain the EUR currency default.");
  assert.equal(formContextFile?.includes('"10000"'), true, "defaultValues must contain the 10000 amount default.");

  // selectOptions must be present for the 3 select fields.
  assert.equal(
    (formContextFile?.match(/"selectOptions":\s*\[/g) ?? []).length >= 3,
    true,
    "At least 3 fieldSchemaSpecs entries must have non-empty selectOptions arrays."
  );

  // formSchema must register all 7 fields via z.object.
  assert.equal(
    formContextFile?.includes("z.object("),
    true,
    "Generated form context must define a Zod formSchema using z.object."
  );

  // The createFieldSchema function must contain the rule-inference priority logic.
  assert.equal(
    formContextFile?.includes("spec.validationRules"),
    true,
    "createFieldSchema must reference spec.validationRules for rule-inference priority."
  );
  assert.equal(
    formContextFile?.includes("spec.required"),
    true,
    "createFieldSchema must reference spec.required for the fallback required check."
  );

  const issue783Families = new Map(
    (componentMatchReport.entries ?? [])
      .filter((entry) =>
        entry.figma?.familyName === "<Button>" ||
        entry.figma?.familyName === "<Divider>" ||
        entry.figma?.familyName === "<Dynamic Typography> (headlines)"
      )
      .map((entry) => [
        entry.figma?.familyKey ?? "unknown",
        {
          familyName: entry.figma?.familyName,
          status: entry.match?.status,
          storybookTitle: entry.storybookFamily?.title
        }
      ])
  );

  assert.equal(issue783Families.size, 5, "Expected customer-board fixture to include all Issue #783 family entries.");
  assert.deepEqual(
    [...issue783Families.values()].map((entry) => entry.status),
    ["matched", "matched", "matched", "matched", "matched"],
    "Issue #783 families must no longer remain ambiguous in the customer-board fixture."
  );
});
