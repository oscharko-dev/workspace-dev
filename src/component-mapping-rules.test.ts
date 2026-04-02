import assert from "node:assert/strict";
import test from "node:test";
import { resolveComponentMappingRules, validateComponentMappingRule } from "./component-mapping-rules.js";
import type { WorkspaceComponentMappingRule } from "./contracts/index.js";
import type { FigmaLibraryResolutionArtifact } from "./job-engine/figma-library-resolution.js";
import type { FigmaAnalysis } from "./parity/figma-analysis.js";
import type { DesignIR } from "./parity/types-ir.js";
import type { ComponentMatchReportArtifact } from "./storybook/types.js";

const createResolverIr = ({
  includeSecondFamily = false
}: {
  includeSecondFamily?: boolean;
} = {}): DesignIR =>
  ({
    sourceName: "resolver-test",
    screens: [
      {
        id: "screen-1",
        name: "Screen 1",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "button-node-1",
            name: "Primary CTA",
            nodeType: "FRAME",
            type: "button",
            semanticType: "button",
            children: []
          },
          ...(includeSecondFamily
            ? [
                {
                  id: "card-node-1",
                  name: "Offer Card",
                  nodeType: "FRAME",
                  type: "button",
                  semanticType: "button",
                  children: []
                }
              ]
            : [])
        ]
      }
    ]
  }) as unknown as DesignIR;

const createResolverFigmaAnalysis = ({
  includeSecondFamily = false
}: {
  includeSecondFamily?: boolean;
} = {}): FigmaAnalysis =>
  ({
    artifactVersion: 1,
    sourceName: "resolver-test",
    componentFamilies: [
      {
        familyKey: "button-family",
        familyName: "Button",
        componentIds: ["1:100"],
        componentSetIds: ["1:200"],
        referringNodeIds: ["button-node-1"],
        nodeCount: 1,
        variantProperties: []
      },
      ...(includeSecondFamily
        ? [
            {
              familyKey: "card-family",
              familyName: "Card",
              componentIds: ["1:300"],
              componentSetIds: ["1:400"],
              referringNodeIds: ["card-node-1"],
              nodeCount: 1,
              variantProperties: []
            }
          ]
        : [])
    ]
  }) as unknown as FigmaAnalysis;

const createResolverComponentMatchReport = ({
  includeSecondFamily = false
}: {
  includeSecondFamily?: boolean;
} = {}): ComponentMatchReportArtifact =>
  ({
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: includeSecondFamily ? 2 : 1,
      storybookFamilyCount: includeSecondFamily ? 2 : 1,
      storybookEntryCount: includeSecondFamily ? 2 : 1,
      matched: includeSecondFamily ? 2 : 1,
      ambiguous: 0,
      unmatched: 0,
      libraryResolution: {
        byStatus: {
          resolved_import: 0,
          mui_fallback_allowed: includeSecondFamily ? 2 : 1,
          mui_fallback_denied: 0,
          not_applicable: 0
        },
        byReason: {
          profile_import_resolved: 0,
          profile_import_missing: includeSecondFamily ? 2 : 1,
          profile_import_family_mismatch: 0,
          profile_family_unresolved: 0,
          match_ambiguous: 0,
          match_unmatched: 0
        }
      },
      iconResolution: {
        byStatus: {
          resolved_import: 0,
          wrapper_fallback_allowed: 0,
          wrapper_fallback_denied: 0,
          unresolved: 0,
          ambiguous: 0,
          not_applicable: includeSecondFamily ? 2 : 1
        },
        byReason: {
          profile_icon_import_resolved: 0,
          profile_icon_import_missing: 0,
          profile_icon_wrapper_allowed: 0,
          profile_icon_wrapper_denied: 0,
          profile_icon_wrapper_missing: 0,
          match_ambiguous: 0,
          match_unmatched: 0,
          not_icon_family: includeSecondFamily ? 2 : 1
        }
      }
    },
    entries: [
      {
        figma: {
          familyKey: "button-family",
          familyName: "Button",
          nodeCount: 1,
          variantProperties: []
        },
        match: {
          status: "matched",
          confidence: "high",
          confidenceScore: 100
        },
        usedEvidence: [],
        rejectionReasons: [],
        fallbackReasons: [],
        libraryResolution: {
          status: "mui_fallback_allowed",
          reason: "profile_import_missing",
          storybookTier: "Components",
          profileFamily: "Components",
          componentKey: "Button"
        },
        storybookFamily: {
          familyId: "storybook-button-family",
          title: "Components/Button",
          name: "Button",
          tier: "Components",
          storyCount: 1
        },
        storyVariant: {
          entryId: "button--primary",
          storyName: "Primary"
        },
        resolvedApi: {
          status: "not_applicable",
          allowedProps: [],
          defaultProps: [],
          children: { policy: "unknown" },
          slots: { policy: "not_used", props: [] },
          diagnostics: []
        },
        resolvedProps: {
          status: "not_applicable",
          props: [],
          omittedProps: [],
          omittedDefaults: [],
          children: { policy: "unknown" },
          slots: { policy: "not_used", props: [] },
          codegenCompatible: false,
          diagnostics: []
        }
      },
      ...(includeSecondFamily
        ? [
            {
              figma: {
                familyKey: "card-family",
                familyName: "Card",
                nodeCount: 1,
                variantProperties: []
              },
              match: {
                status: "matched",
                confidence: "high",
                confidenceScore: 100
              },
              usedEvidence: [],
              rejectionReasons: [],
              fallbackReasons: [],
              libraryResolution: {
                status: "mui_fallback_allowed",
                reason: "profile_import_missing",
                storybookTier: "Components",
                profileFamily: "Components",
                componentKey: "Card"
              },
              storybookFamily: {
                familyId: "storybook-card-family",
                title: "Components/Card",
                name: "Card",
                tier: "Components",
                storyCount: 1
              },
              storyVariant: {
                entryId: "card--default",
                storyName: "Default"
              },
              resolvedApi: {
                status: "not_applicable",
                allowedProps: [],
                defaultProps: [],
                children: { policy: "unknown" },
                slots: { policy: "not_used", props: [] },
                diagnostics: []
              },
              resolvedProps: {
                status: "not_applicable",
                props: [],
                omittedProps: [],
                omittedDefaults: [],
                children: { policy: "unknown" },
                slots: { policy: "not_used", props: [] },
                codegenCompatible: false,
                diagnostics: []
              }
            }
          ]
        : [])
    ]
  }) as unknown as ComponentMatchReportArtifact;

const createResolverFigmaLibraryResolution = (): FigmaLibraryResolutionArtifact =>
  ({
    artifact: "figma.library_resolution",
    version: 1,
    figmaSourceMode: "rest",
    fingerprint: "resolver-library-fingerprint",
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
        resolutionSource: "local_catalog",
        componentId: "1:100",
        componentSetId: "1:200",
        familyKey: "button-family",
        heuristicFamilyName: "Button",
        canonicalFamilyName: "Button",
        canonicalFamilyNameSource: "analysis",
        referringNodeIds: ["button-node-1"],
        variantProperties: [],
        originFileKey: "library-file-key"
      }
    ]
  }) as FigmaLibraryResolutionArtifact;

const createRule = (overrides: Partial<WorkspaceComponentMappingRule> = {}): WorkspaceComponentMappingRule => ({
  boardKey: "board-1",
  componentName: "ManualButton",
  importPath: "@manual/ui",
  priority: 0,
  source: "local_override",
  enabled: true,
  ...overrides
});

test("component mapping rules reject mixed exact and pattern selectors", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeId: "button-node-1",
      canonicalComponentName: "Button"
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /either exact \(nodeId only\) or pattern-based/);
  }
});

test("component mapping rules reject invalid nodeNamePattern regex sources", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "["
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "nodeNamePattern must be a valid regular expression source.");
  }
});

test("resolveComponentMappingRules keeps exact rules ahead of pattern rules", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        componentName: "PatternButton",
        importPath: "@pattern/ui",
        canonicalComponentName: "Button",
        priority: 0
      }),
      createRule({
        nodeId: "button-node-1",
        componentName: "ExactButton",
        importPath: "@exact/ui",
        priority: 99
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.deepEqual(resolved.componentMappings, [
    {
      boardKey: "board-1",
      nodeId: "button-node-1",
      componentName: "ExactButton",
      importPath: "@exact/ui",
      priority: 99,
      source: "local_override",
      enabled: true
    }
  ]);
});

test("resolveComponentMappingRules applies the highest-priority matching pattern rule", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        componentName: "LowerPriorityButton",
        importPath: "@low/ui",
        canonicalComponentName: "Button",
        priority: 5
      }),
      createRule({
        componentName: "HigherPriorityButton",
        importPath: "@high/ui",
        nodeNamePattern: "primary\\s+cta",
        priority: 0
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings[0]?.componentName, "HigherPriorityButton");
  assert.equal(resolved.componentMappings[0]?.importPath, "@high/ui");
});

test("resolveComponentMappingRules matches canonicalComponentName case-insensitively", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        canonicalComponentName: " button ",
        componentName: "CanonicalButton"
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings[0]?.nodeId, "button-node-1");
  assert.equal(resolved.componentMappings[0]?.componentName, "CanonicalButton");
});

test("resolveComponentMappingRules matches combined storybookTier and semanticType selectors", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        storybookTier: " components ",
        semanticType: " BUTTON ",
        componentName: "TierSemanticButton"
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings[0]?.nodeId, "button-node-1");
  assert.equal(resolved.componentMappings[0]?.componentName, "TierSemanticButton");
});

test("resolveComponentMappingRules only matches figmaLibrary selectors when library resolution is available", () => {
  const withoutLibraryResolution = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        figmaLibrary: "library-file-key",
        componentName: "LibraryButton"
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });
  assert.equal(withoutLibraryResolution.componentMappings.length, 0);
  assert.equal(withoutLibraryResolution.mappingWarnings[0]?.code, "W_COMPONENT_MAPPING_MISSING");

  const withLibraryResolution = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        figmaLibrary: "library-file-key",
        componentName: "LibraryButton"
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport(),
    figmaLibraryResolutionArtifact: createResolverFigmaLibraryResolution()
  });
  assert.equal(withLibraryResolution.componentMappings[0]?.nodeId, "button-node-1");
  assert.equal(withLibraryResolution.componentMappings[0]?.componentName, "LibraryButton");
});

test("resolveComponentMappingRules warns when a pattern spans multiple Figma families", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        storybookTier: "Components",
        semanticType: "button",
        componentName: "BroadPatternButton"
      })
    ],
    ir: createResolverIr({ includeSecondFamily: true }),
    figmaAnalysis: createResolverFigmaAnalysis({ includeSecondFamily: true }),
    componentMatchReportArtifact: createResolverComponentMatchReport({ includeSecondFamily: true })
  });

  assert.equal(resolved.componentMappings.length, 0);
  assert.equal(resolved.mappingWarnings[0]?.code, "W_COMPONENT_MAPPING_BROAD_PATTERN");
  assert.match(String(resolved.mappingWarnings[0]?.message ?? ""), /matched 2 component families/);
});
