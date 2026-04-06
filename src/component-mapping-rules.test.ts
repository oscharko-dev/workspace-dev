import assert from "node:assert/strict";
import test from "node:test";
import {
  describeComponentMappingRule,
  normalizeComponentMappingRule,
  resolveComponentMappingRules,
  validateComponentMappingRule
} from "./component-mapping-rules.js";
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
  includeSecondFamily = false,
  includeFigmaLibraryResolution = false
}: {
  includeSecondFamily?: boolean;
  includeFigmaLibraryResolution?: boolean;
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
          profile_family_unresolved: 0,
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
          variantProperties: [],
          ...(includeFigmaLibraryResolution
            ? {
                figmaLibraryResolution: {
                  status: "resolved",
                  resolutionSource: "cache",
                  originFileKey: "library-file-key",
                  canonicalFamilyName: "Button",
                  canonicalFamilyNameSource: "published_component_set",
                  issues: [],
                  designLinks: [
                    {
                      fileKey: "library-file-key",
                      nodeId: "button-node-1"
                    }
                  ]
                }
              }
            : {})
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
                variantProperties: [],
                ...(includeFigmaLibraryResolution
                  ? {
                      figmaLibraryResolution: {
                        status: "resolved",
                        resolutionSource: "cache",
                        originFileKey: "library-file-key",
                        canonicalFamilyName: "Card",
                        canonicalFamilyNameSource: "published_component_set",
                        issues: [],
                        designLinks: [
                          {
                            fileKey: "library-file-key",
                            nodeId: "card-node-1"
                          }
                        ]
                      }
                    }
                  : {})
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
    componentMatchReportArtifact: createResolverComponentMatchReport({
      includeFigmaLibraryResolution: true
    })
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

test("resolveComponentMappingRules warns when a pattern rule is disabled", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        canonicalComponentName: "Button",
        componentName: "DisabledButton",
        enabled: false
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings.length, 0);
  assert.equal(resolved.mappingWarnings[0]?.code, "W_COMPONENT_MAPPING_DISABLED");
  assert.match(String(resolved.mappingWarnings[0]?.message ?? ""), /disabled/);
});

test("resolveComponentMappingRules emits W_COMPONENT_MAPPING_DISABLED for exact rules with enabled: false", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        nodeId: "button-node-1",
        componentName: "DisabledExactButton",
        enabled: false
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings.length, 0);
  assert.equal(resolved.mappingWarnings.length, 1);
  assert.equal(resolved.mappingWarnings[0]?.code, "W_COMPONENT_MAPPING_DISABLED");
  assert.match(String(resolved.mappingWarnings[0]?.message ?? ""), /disabled/);
  assert.match(String(resolved.mappingWarnings[0]?.message ?? ""), /Exact/);
});

test("resolveComponentMappingRules matches nodeNamePattern regex against node names", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        nodeNamePattern: "^primary",
        componentName: "RegexButton"
      })
    ],
    ir: createResolverIr(),
    figmaAnalysis: createResolverFigmaAnalysis(),
    componentMatchReportArtifact: createResolverComponentMatchReport()
  });

  assert.equal(resolved.componentMappings.length, 1);
  assert.equal(resolved.componentMappings[0]?.componentName, "RegexButton");
  assert.equal(resolved.componentMappings[0]?.nodeId, "button-node-1");
});

test("component mapping rules reject nested quantifier patterns (ReDoS)", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "(a+)+"
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /nested quantifiers/);
    assert.equal(result.field, "nodeNamePattern");
  }
});

test("component mapping rules reject alternation group followed by quantifier (ReDoS)", () => {
  const result1 = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "(a|a)+"
    })
  });
  assert.equal(result1.ok, false);
  if (!result1.ok) {
    assert.match(result1.message, /alternation groups followed by quantifiers/);
    assert.equal(result1.field, "nodeNamePattern");
  }

  const result2 = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "(foo|fo)+"
    })
  });
  assert.equal(result2.ok, false);
  if (!result2.ok) {
    assert.match(result2.message, /alternation groups followed by quantifiers/);
  }
});

test("component mapping rules accept alternation groups without trailing quantifier", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "(a|b)"
    })
  });
  assert.equal(result.ok, true);
});

test("component mapping rules reject non-capturing alternation groups with quantifier (ReDoS)", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "(?:a|b)+"
    })
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /alternation groups followed by quantifiers/);
  }
});

test("component mapping rules reject excessively long nodeNamePattern", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "a".repeat(300)
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /must not exceed/);
  }
});

test("describeComponentMappingRule formats exact rules by nodeId", () => {
  const description = describeComponentMappingRule({
    rule: { boardKey: "b", nodeId: " node-1 " }
  });
  assert.equal(description, "node 'node-1'");
});

test("describeComponentMappingRule formats pattern rules by selectors", () => {
  const description = describeComponentMappingRule({
    rule: {
      boardKey: "b",
      canonicalComponentName: "Button",
      storybookTier: "Components"
    }
  });
  assert.equal(description, "canonicalComponentName='Button', storybookTier='Components'");
});

test("describeComponentMappingRule falls back to boardKey when no selectors", () => {
  const description = describeComponentMappingRule({
    rule: { boardKey: "my-board" }
  });
  assert.equal(description, "board 'my-board'");
});

test("normalizeComponentMappingRule trims and normalizes all fields", () => {
  const normalized = normalizeComponentMappingRule({
    rule: createRule({
      boardKey: " board-1 ",
      componentName: " MyButton ",
      importPath: " @my/ui ",
      nodeId: " node-1 ",
      canonicalComponentName: " Button ",
      storybookTier: " Components ",
      figmaLibrary: " lib-key ",
      semanticType: " button ",
      createdAt: " 2026-01-01 ",
      updatedAt: " 2026-01-02 "
    })
  });

  assert.equal(normalized.boardKey, "board-1");
  assert.equal(normalized.componentName, "MyButton");
  assert.equal(normalized.importPath, "@my/ui");
  assert.equal(normalized.nodeId, "node-1");
  assert.equal(normalized.canonicalComponentName, "Button");
  assert.equal(normalized.storybookTier, "Components");
  assert.equal(normalized.figmaLibrary, "lib-key");
  assert.equal(normalized.semanticType, "button");
  assert.equal(normalized.createdAt, "2026-01-01");
  assert.equal(normalized.updatedAt, "2026-01-02");
});

test("component mapping rules reject rules with neither nodeId nor pattern selectors", () => {
  const result = validateComponentMappingRule({
    rule: createRule({})
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /must define at least one selector/);
  }
});

test("component mapping rules reject nodeNamePattern with excessive quantifiers", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "\\d+\\d+\\d+\\d+"
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.message.includes("quantifiers"));
    assert.equal(result.field, "nodeNamePattern");
  }
});

test("component mapping rules accept nodeNamePattern with up to 3 quantifiers", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "Button/\\w+/\\w+/\\d+"
    })
  });

  assert.equal(result.ok, true);
});

test("component mapping rules reject nodeNamePattern with excessive brace repeat count", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "a{2000}"
    })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.message.includes("brace quantifier"));
    assert.equal(result.field, "nodeNamePattern");
  }
});

test("component mapping rules accept nodeNamePattern with reasonable brace repeat count", () => {
  const result = validateComponentMappingRule({
    rule: createRule({
      nodeNamePattern: "a{5,10}"
    })
  });

  assert.equal(result.ok, true);
});

test("resolveComponentMappingRules emits W_COMPONENT_MAPPING_DISABLED for disabled broad-pattern rule", () => {
  const resolved = resolveComponentMappingRules({
    componentMappings: [
      createRule({
        storybookTier: "Components",
        semanticType: "button",
        componentName: "DisabledBroadButton",
        enabled: false
      })
    ],
    ir: createResolverIr({ includeSecondFamily: true }),
    figmaAnalysis: createResolverFigmaAnalysis({ includeSecondFamily: true }),
    componentMatchReportArtifact: createResolverComponentMatchReport({ includeSecondFamily: true })
  });

  assert.equal(resolved.componentMappings.length, 0);
  assert.equal(resolved.mappingWarnings.length, 1);
  assert.equal(resolved.mappingWarnings[0]?.code, "W_COMPONENT_MAPPING_DISABLED");
  assert.match(String(resolved.mappingWarnings[0]?.message ?? ""), /disabled/);
});
