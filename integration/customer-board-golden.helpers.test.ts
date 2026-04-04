import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCustomerBoardBundlesEqual,
  assertCustomerBoardPublicArtifactSanitized,
  createCustomerBoardHybridLiveRuntimeSettings,
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
          storybookEvidence: "derived/storybook.evidence.json",
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
          storybookEvidence: "derived/storybook.evidence.json",
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

test("customer-board helper configures hybrid live runtime with MCP enrichment loader", () => {
  const runtime = createCustomerBoardHybridLiveRuntimeSettings();

  assert.ok(
    runtime.figmaMcpEnrichmentLoader,
    "Hybrid live runtime must configure figmaMcpEnrichmentLoader for low-fidelity recovery."
  );
});

test("customer-board bundle equality ignores volatile figma library resolution live metadata", async () => {
  const expected = {
    manifest: {
      version: 1,
      fixtureId: "customer-board-golden",
      inputs: {
        figma: "inputs/figma.json",
        customerProfile: "inputs/customer-profile.json"
      },
      derived: {
        storybookEvidence: "derived/storybook.evidence.json",
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
        generated: []
      }
    },
    files: new Map([
      [
        "derived/figma-library-resolution.json",
        {
          kind: "json" as const,
          content: JSON.stringify({
            artifact: "figma.library_resolution",
            version: 1,
            figmaSourceMode: "hybrid",
            fingerprint: "abc123",
            summary: {
              total: 1,
              resolved: 1,
              partial: 0,
              error: 0,
              cacheHit: 0,
              offlineReused: 0
            },
            entries: [
              {
                status: "resolved",
                resolutionSource: "live",
                componentId: "1:2",
                componentKey: "component-key",
                familyKey: "component:1:2",
                heuristicFamilyName: "<Divider>",
                canonicalFamilyName: "Orientation=Horizontal, TextAlign=-",
                canonicalFamilyNameSource: "published_component",
                originFileKey: "NVm3Wm7ZwjXnrhoCQ9enV7",
                publishedComponent: {
                  fileKey: "NVm3Wm7ZwjXnrhoCQ9enV7",
                  nodeId: "6641:130",
                  key: "component-key",
                  name: "Orientation=Horizontal, TextAlign=-",
                  thumbnailUrl: "https://example.test/thumb.png",
                  updatedAt: "2026-04-04T10:00:00.000Z",
                  createdAt: "2025-04-09T07:32:21.807Z"
                },
                localComponent: {
                  componentSetId: "1:1",
                  key: "component-key",
                  name: "Orientation=Horizontal, TextAlign=-",
                  remote: true
                },
                referringNodeIds: ["1:65835", "1:65900"],
                variantProperties: [
                  {
                    property: "orientation",
                    values: ["Horizontal"]
                  }
                ]
              }
            ]
          })
        }
      ]
    ])
  };

  const actual = {
    ...expected,
    files: new Map([
      [
        "derived/figma-library-resolution.json",
        {
          kind: "json" as const,
          content: JSON.stringify({
            artifact: "figma.library_resolution",
            version: 1,
            figmaSourceMode: "hybrid",
            fingerprint: "abc123",
            summary: {
              total: 1,
              resolved: 0,
              partial: 0,
              error: 1,
              cacheHit: 0,
              offlineReused: 0
            },
            entries: [
              {
                status: "error",
                resolutionSource: "live",
                componentId: "1:2",
                componentKey: "component-key",
                familyKey: "component:1:2",
                heuristicFamilyName: "<Divider>",
                canonicalFamilyName: "<Divider>",
                canonicalFamilyNameSource: "analysis",
                issues: [
                  {
                    code: "E_LIBRARY_ASSET_HTTP",
                    message: "Published component metadata failed with HTTP 429.",
                    scope: "component",
                    retriable: true
                  }
                ],
                localComponent: {
                  componentSetId: "1:1",
                  key: "component-key",
                  name: "Orientation=Horizontal, TextAlign=-",
                  remote: true
                },
                referringNodeIds: ["1:65900", "1:65835"],
                variantProperties: [
                  {
                    property: "orientation",
                    values: ["Horizontal"]
                  }
                ]
              }
            ]
          })
        }
      ]
    ])
  };

  await assert.doesNotReject(async () => {
    await assertCustomerBoardBundlesEqual({
      actual,
      expected
    });
  });
});

test("customer-board bundle equality ignores volatile component match report evidence derived from live library lookups", async () => {
  const expected = {
    manifest: {
      version: 1,
      fixtureId: "customer-board-golden",
      inputs: {
        figma: "inputs/figma.json",
        customerProfile: "inputs/customer-profile.json"
      },
      derived: {
        storybookEvidence: "derived/storybook.evidence.json",
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
        generated: []
      }
    },
    files: new Map([
      [
        "derived/component-match-report.json",
        {
          kind: "json" as const,
          content: JSON.stringify({
            artifact: "component.match_report",
            version: 1,
            summary: {
              totalFigmaFamilies: 1,
              matched: 1
            },
            entries: [
              {
                fallbackReasons: ["used_library_resolution_canonical_name"],
                figma: {
                  familyKey: "component:1:54808",
                  familyName: "<Alert>",
                  canonicalFamilyName: "Severity*=Info*, variant=filled",
                  nodeCount: 1,
                  figmaLibraryResolution: {
                    status: "resolved",
                    canonicalFamilyName: "Severity*=Info*, variant=filled",
                    canonicalFamilyNameSource: "published_component",
                    resolutionSource: "live",
                    designLinks: [
                      {
                        fileKey: "NVm3Wm7ZwjXnrhoCQ9enV7",
                        nodeId: "1857:134905"
                      }
                    ]
                  },
                  variantProperties: [
                    {
                      property: "severity",
                      values: ["Info"]
                    }
                  ]
                },
                match: {
                  status: "matched",
                  confidence: "medium",
                  confidenceScore: 65
                },
                storybookFamily: {
                  familyId: "family:a69b3fb0341c2384",
                  name: "Alert",
                  storyCount: 2,
                  tier: "Components",
                  title: "Components/Feedback/Alert"
                },
                usedEvidence: [
                  {
                    class: "design_link",
                    reliability: "derived",
                    role: "candidate_selection"
                  }
                ]
              }
            ]
          })
        }
      ]
    ])
  };

  const actual = {
    ...expected,
    files: new Map([
      [
        "derived/component-match-report.json",
        {
          kind: "json" as const,
          content: JSON.stringify({
            artifact: "component.match_report",
            version: 1,
            summary: {
              totalFigmaFamilies: 1,
              ambiguous: 1
            },
            entries: [
              {
                fallbackReasons: ["used_figma_analysis_family_name"],
                figma: {
                  familyKey: "component:1:54808",
                  familyName: "<Alert>",
                  canonicalFamilyName: "<Alert>",
                  nodeCount: 1,
                  figmaLibraryResolution: {
                    status: "error",
                    canonicalFamilyName: "<Alert>",
                    canonicalFamilyNameSource: "analysis",
                    resolutionSource: "live",
                    designLinks: [],
                    issues: [
                      {
                        code: "E_LIBRARY_ASSET_HTTP",
                        message: "Published component metadata failed with HTTP 429.",
                        scope: "component",
                        retriable: true
                      }
                    ]
                  },
                  variantProperties: [
                    {
                      property: "severity",
                      values: ["Info"]
                    }
                  ]
                },
                match: {
                  status: "ambiguous",
                  confidence: "none",
                  confidenceScore: 36
                },
                storybookFamily: {
                  familyId: "family:a69b3fb0341c2384",
                  name: "Alert",
                  storyCount: 2,
                  tier: "Components",
                  title: "Components/Feedback/Alert"
                },
                usedEvidence: [
                  {
                    class: "canonical_family_name",
                    reliability: "derived",
                    role: "candidate_selection"
                  }
                ]
              }
            ]
          })
        }
      ]
    ])
  };

  await assert.doesNotReject(async () => {
    await assertCustomerBoardBundlesEqual({
      actual,
      expected
    });
  });
});
