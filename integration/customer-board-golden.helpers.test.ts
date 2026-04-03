import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCustomerBoardPublicArtifactSanitized,
  loadCustomerBoardGoldenManifest,
  normalizeCustomerBoardFixtureValue
} from "./customer-board-golden.helpers.js";

test("customer-board helper rejects unsupported generated artifact kinds in the manifest", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-manifest-kind-"));
  const manifestPath = path.join(tempRoot, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        fixtureId: "customer-board-golden",
        inputs: {
          figma: "inputs/figma.json",
          customerProfile: "inputs/customer-profile.json"
        },
        derived: {
          storybookCatalog: "derived/storybook.catalog.json",
          storybookTokens: "derived/storybook.tokens.json",
          storybookThemes: "derived/storybook.themes.json",
          storybookComponents: "derived/storybook.components.json",
          figmaAnalysis: "derived/figma-analysis.json",
          figmaLibraryResolution: "derived/figma-library-resolution.json",
          componentMatchReport: "derived/component-match-report.json"
        },
        expected: {
          validationSummary: "expected/validation-summary.json",
          generated: [
            {
              name: "app",
              kind: "binary",
              actual: "src/App.tsx",
              expected: "expected/generated/src/App.tsx"
            }
          ]
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await assert.rejects(
    async () => {
      await loadCustomerBoardGoldenManifest({
        manifestPath
      });
    },
    /unsupported kind 'binary'/
  );

  await rm(tempRoot, { recursive: true, force: true });
});

test("customer-board helper rejects manifest paths that leak forbidden fixture segments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-manifest-path-"));
  const manifestPath = path.join(tempRoot, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        fixtureId: "customer-board-golden",
        inputs: {
          figma: "inputs/figma.json",
          customerProfile: "storybook-static/customer-profile.json"
        },
        derived: {
          storybookCatalog: "derived/storybook.catalog.json",
          storybookTokens: "derived/storybook.tokens.json",
          storybookThemes: "derived/storybook.themes.json",
          storybookComponents: "derived/storybook.components.json",
          figmaAnalysis: "derived/figma-analysis.json",
          figmaLibraryResolution: "derived/figma-library-resolution.json",
          componentMatchReport: "derived/component-match-report.json"
        },
        expected: {
          validationSummary: "expected/validation-summary.json",
          generated: [
            {
              name: "app",
              kind: "text",
              actual: "src/App.tsx",
              expected: "expected/generated/src/App.tsx"
            }
          ]
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await assert.rejects(
    async () => {
      await loadCustomerBoardGoldenManifest({
        manifestPath
      });
    },
    /forbidden segment 'storybook-static'/
  );

  await rm(tempRoot, { recursive: true, force: true });
});

test("customer-board helper normalization strips volatile runtime metadata and preserves semantic fields", () => {
  const normalized = normalizeCustomerBoardFixtureValue({
    value: {
      jobId: "job-123",
      submittedAt: "2026-04-03T10:00:00.000Z",
      filePath: "/tmp/workspace-dev/job-123/generated-app/src/App.tsx",
      reportPath: "/workspace/reports/customer-board.json",
      catalogPath: "/workspace/integration/fixtures/customer-board-golden/derived/storybook.catalog.json",
      status: "ok",
      details: {
        outputDir: "/workspace/out/job-123",
        semanticCode: "mapping_ok"
      }
    },
    jobDir: "/tmp/workspace-dev/job-123",
    fixtureRoot: "/workspace/integration/fixtures/customer-board-golden",
    workspaceRoot: "/workspace"
  });

  assert.deepEqual(normalized, {
    catalogPath: "<fixture-root>/derived/storybook.catalog.json",
    details: {
      outputDir: "<workspace-root>/out/job-123",
      semanticCode: "mapping_ok"
    },
    filePath: "<job-dir>/generated-app/src/App.tsx",
    jobId: "<job-id>",
    reportPath: "<workspace-root>/reports/customer-board.json",
    status: "ok",
    submittedAt: "<timestamp>"
  });
});

test("customer-board helper rejects public artifact leaks for internal Storybook paths and embedded payloads", () => {
  assert.throws(
    () => {
      assertCustomerBoardPublicArtifactSanitized({
        label: "storybook.catalog",
        value: {
          bundlePath: "storybook-static/storybook-static/assets/iframe.js"
        }
      });
    },
    /forbidden public artifact leakage/
  );

  assert.throws(
    () => {
      assertCustomerBoardPublicArtifactSanitized({
        label: "storybook.tokens",
        value: {
          fontFace: "data:application/font-ttf;base64,AAAA"
        }
      });
    },
    /forbidden public artifact leakage/
  );
});
