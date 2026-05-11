import assert from "node:assert/strict";
import test from "node:test";
import { buildComponentMatchReportArtifact } from "./component-match-report.js";
import {
  buildStorybookComponentVisualCatalogArtifact,
  serializeStorybookComponentVisualCatalogArtifact
} from "./component-visual-catalog.js";
import { parseStorybookComponentVisualCatalogArtifact } from "./artifact-validation.js";
import type {
  FigmaAnalysis,
  FigmaAnalysisComponentFamily,
  FigmaAnalysisVariantProperty
} from "../parity/figma-analysis.js";
import type { FigmaLibraryResolutionArtifact } from "../job-engine/figma-library-resolution.js";
import type {
  ComponentMatchReportArtifact,
  ComponentMatchReportEntry,
  ComponentMatchReportFigmaReferenceNode,
  StorybookCatalogArtifact,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookCatalogSignalReferences,
  StorybookEvidenceArtifact,
  StorybookEvidenceItem
} from "./types.js";

const createEmptySignalReferences = (): StorybookCatalogSignalReferences => ({
  componentPath: [],
  args: [],
  argTypes: [],
  designLinks: [],
  mdxLinks: [],
  docsImages: [],
  docsText: [],
  themeBundles: [],
  css: []
});

const createFigmaFamily = ({
  familyKey,
  familyName,
  variantProperties = [],
  nodeCount = 1
}: {
  familyKey: string;
  familyName: string;
  variantProperties?: FigmaAnalysisVariantProperty[];
  nodeCount?: number;
}): FigmaAnalysisComponentFamily => ({
  familyKey,
  familyName,
  componentIds: [`${familyKey}-component`],
  componentSetIds: [`${familyKey}-set`],
  referringNodeIds: [`${familyKey}-node`],
  nodeCount,
  variantProperties
});

const createFigmaAnalysis = ({
  componentFamilies
}: {
  componentFamilies: FigmaAnalysisComponentFamily[];
}): FigmaAnalysis => ({
  artifactVersion: 1,
  sourceName: "Storybook Component Visual Catalog Test",
  summary: {
    pageCount: 1,
    sectionCount: 0,
    topLevelFrameCount: 1,
    totalNodeCount: 1,
    totalInstanceCount: componentFamilies.length,
    localComponentCount: componentFamilies.length,
    localStyleCount: 0,
    externalComponentCount: 0
  },
  tokenSignals: {
    boundVariableIds: [],
    variableModeIds: [],
    styleReferences: {
      allStyleIds: [],
      byType: {
        fill: [],
        stroke: [],
        effect: [],
        text: [],
        generic: []
      },
      localStyleIds: [],
      linkedStyleIds: []
    }
  },
  layoutGraph: {
    pages: [],
    sections: [],
    frames: [],
    edges: []
  },
  componentFamilies,
  externalComponents: [],
  frameVariantGroups: [],
  appShellSignals: [],
  componentDensity: {
    boardDominantFamilies: [],
    byFrame: [],
    hotspots: []
  },
  diagnostics: []
});

const createCatalogEntry = ({
  id,
  title,
  name,
  familyId,
  type = "story",
  args,
  argTypes
}: {
  id: string;
  title: string;
  name: string;
  familyId: string;
  type?: "story" | "docs";
  args?: Record<string, unknown>;
  argTypes?: Record<string, unknown>;
}): StorybookCatalogEntry => ({
  id,
  title,
  name,
  type,
  tier: title.split("/")[0] ?? title,
  tags: ["test"],
  importPath: `./stories/${id}.tsx`,
  storiesImports: [],
  docsAttachment: type === "story" ? "not_applicable" : "attached",
  familyId,
  familyTitle: title,
  isDocsOnlyTier: type === "docs",
  signalReferences: createEmptySignalReferences(),
  metadata: {
    ...(args ? { args } : {}),
    ...(argTypes ? { argTypes } : {}),
    designUrls: [],
    mdxLinks: {
      internal: [],
      external: []
    },
    assetKeys: []
  }
});

const createCatalogFamily = ({
  id,
  title,
  name,
  entryIds,
  storyEntryIds,
  docsEntryIds,
  isDocsOnlyTier = false
}: {
  id: string;
  title: string;
  name: string;
  entryIds: string[];
  storyEntryIds: string[];
  docsEntryIds?: string[];
  isDocsOnlyTier?: boolean;
}): StorybookCatalogFamily => ({
  id,
  title,
  name,
  tier: title.split("/")[0] ?? title,
  isDocsOnlyTier,
  entryIds,
  storyEntryIds,
  docsEntryIds: docsEntryIds ?? entryIds.filter((entryId) => !storyEntryIds.includes(entryId)),
  storyCount: storyEntryIds.length,
  propKeys: [],
  hasDesignReference: false,
  signalReferences: createEmptySignalReferences(),
  metadata: {
    designUrls: [],
    mdxLinks: {
      internal: [],
      external: []
    },
    assetKeys: []
  }
});

const createCatalogArtifact = ({
  entries,
  families
}: {
  entries: StorybookCatalogEntry[];
  families: StorybookCatalogFamily[];
}): StorybookCatalogArtifact => ({
  artifact: "storybook.catalog",
  version: 1,
  stats: {
    entryCount: entries.length,
    familyCount: families.length,
    byEntryType: {
      story: entries.filter((entry) => entry.type === "story").length,
      docs: entries.filter((entry) => entry.type === "docs").length
    },
    byTier: Object.fromEntries(
      [...new Set(entries.map((entry) => entry.tier))]
        .sort((left, right) => left.localeCompare(right))
        .map((tier) => [tier, entries.filter((entry) => entry.tier === tier).length])
    ),
    byDocsAttachment: {
      attached: entries.filter((entry) => entry.docsAttachment === "attached").length,
      unattached: entries.filter((entry) => entry.docsAttachment === "unattached").length,
      not_applicable: entries.filter((entry) => entry.docsAttachment === "not_applicable").length
    },
    docsOnlyTiers: families.filter((family) => family.isDocsOnlyTier).map((family) => family.tier),
    byReferencedSignal: {
      componentPath: 0,
      args: 0,
      argTypes: 0,
      designLinks: 0,
      mdxLinks: 0,
      docsImages: 0,
      docsText: 0,
      themeBundles: 0,
      css: 0
    }
  },
  entries,
  families
});

const createEvidenceItem = ({
  id,
  entryId,
  reliability = "authoritative"
}: {
  id: string;
  entryId: string;
  reliability?: StorybookEvidenceItem["reliability"];
}): StorybookEvidenceItem => ({
  id,
  type: "story_args",
  reliability,
  source: {
    entryId,
    entryType: "story",
    title: entryId
  },
  usage: {
    canDriveTokens: false,
    canDriveProps: true,
    canDriveImports: false,
    canDriveStyling: false,
    canProvideMatchHints: true
  },
  summary: {}
});

const createEvidenceArtifact = ({
  evidence
}: {
  evidence: StorybookEvidenceItem[];
}): StorybookEvidenceArtifact => ({
  artifact: "storybook.evidence",
  version: 1,
  buildRoot: "storybook-static",
  iframeBundlePath: "assets/iframe.js",
  stats: {
    entryCount: evidence.length,
    evidenceCount: evidence.length,
    byType: {
      story_componentPath: 0,
      story_argTypes: 0,
      story_args: evidence.length,
      story_design_link: 0,
      theme_bundle: 0,
      css: 0,
      mdx_link: 0,
      docs_image: 0,
      docs_text: 0
    },
    byReliability: {
      authoritative: evidence.filter((entry) => entry.reliability === "authoritative").length,
      reference_only: evidence.filter((entry) => entry.reliability === "reference_only").length,
      derived: evidence.filter((entry) => entry.reliability === "derived").length
    }
  },
  evidence
});

const createReferenceNode = ({
  fileKey,
  nodeId,
  source = "published_component",
  nodeName,
  variantProperties = []
}: {
  fileKey: string;
  nodeId: string;
  source?: ComponentMatchReportFigmaReferenceNode["source"];
  nodeName?: string;
  variantProperties?: Array<{ property: string; values: string[] }>;
}): ComponentMatchReportFigmaReferenceNode => ({
  fileKey,
  nodeId,
  source,
  variantProperties,
  ...(nodeName ? { nodeName } : {})
});

const createComponentMatchReportEntry = ({
  familyKey,
  familyName,
  matchStatus,
  familyId,
  storyEntryId,
  referenceNodes = []
}: {
  familyKey: string;
  familyName: string;
  matchStatus: ComponentMatchReportEntry["match"]["status"];
  familyId?: string;
  storyEntryId?: string;
  referenceNodes?: ComponentMatchReportFigmaReferenceNode[];
}): ComponentMatchReportEntry => ({
  figma: {
    familyKey,
    familyName,
    nodeCount: Math.max(1, referenceNodes.length),
    variantProperties: [],
    ...(referenceNodes.length > 0 ? { referenceNodes } : {})
  },
  match: {
    status: matchStatus,
    confidence: matchStatus === "matched" ? "high" : "none",
    confidenceScore: matchStatus === "matched" ? 75 : 0
  },
  usedEvidence: [],
  rejectionReasons: [],
  fallbackReasons: [],
  libraryResolution: {
    status: "not_applicable",
    reason: matchStatus === "matched" ? "match_unmatched" : matchStatus === "ambiguous" ? "match_ambiguous" : "match_unmatched"
  },
  ...(familyId
    ? {
        storybookFamily: {
          familyId,
          title: familyName,
          name: familyName,
          tier: familyName,
          storyCount: 0
        }
      }
    : {}),
  ...(storyEntryId ? { storyVariant: { entryId: storyEntryId, storyName: storyEntryId } } : {})
});

const createComponentMatchReportArtifact = ({
  entries
}: {
  entries: ComponentMatchReportEntry[];
}): ComponentMatchReportArtifact => ({
  artifact: "component.match_report",
  version: 1,
  summary: {
    totalFigmaFamilies: entries.length,
    storybookFamilyCount: entries.filter((entry) => entry.storybookFamily).length,
    storybookEntryCount: entries.filter((entry) => entry.storyVariant).length,
    matched: entries.filter((entry) => entry.match.status === "matched").length,
    ambiguous: entries.filter((entry) => entry.match.status === "ambiguous").length,
    unmatched: entries.filter((entry) => entry.match.status === "unmatched").length,
    libraryResolution: {
      byStatus: {
        resolved_import: 0,
        mui_fallback_allowed: 0,
        mui_fallback_denied: 0,
        not_applicable: entries.length
      },
      byReason: {
        profile_import_resolved: 0,
        profile_import_missing: 0,
        profile_import_family_mismatch: 0,
        profile_family_unresolved: 0,
        match_ambiguous: entries.filter((entry) => entry.match.status === "ambiguous").length,
        match_unmatched: entries.filter((entry) => entry.match.status !== "ambiguous").length
      }
    },
    iconResolution: {
      byStatus: {
        resolved_import: 0,
        wrapper_fallback_allowed: 0,
        wrapper_fallback_denied: 0,
        unresolved: 0,
        ambiguous: 0,
        not_applicable: entries.length
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
        not_icon_family: entries.length
      }
    }
  },
  entries
});

test("buildStorybookComponentVisualCatalogArtifact selects storyVariant first and resolves the best reference node overlap", () => {
  const catalogEntries = [
    createCatalogEntry({
      id: "button--primary-large",
      title: "Components/Button",
      name: "Primary Large",
      familyId: "family-button",
      args: {
        variant: "Primary",
        size: "Large"
      }
    }),
    createCatalogEntry({
      id: "button--secondary-small",
      title: "Components/Button",
      name: "Secondary Small",
      familyId: "family-button",
      args: {
        variant: "Secondary",
        size: "Small"
      }
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries: catalogEntries,
    families: [
      createCatalogFamily({
        id: "family-button",
        title: "Components/Button",
        name: "Button",
        entryIds: catalogEntries.map((entry) => entry.id),
        storyEntryIds: catalogEntries.map((entry) => entry.id)
      })
    ]
  });
  const evidenceArtifact = createEvidenceArtifact({
    evidence: [
      createEvidenceItem({ id: "evidence-1", entryId: "button--primary-large" }),
      createEvidenceItem({ id: "evidence-2", entryId: "button--secondary-small" })
    ]
  });
  const figmaLibraryResolutionArtifact: FigmaLibraryResolutionArtifact = {
    artifact: "figma.library_resolution",
    version: 1,
    figmaSourceMode: "local_json",
    fingerprint: "component-visual-catalog-test",
    summary: {
      total: 3,
      resolved: 3,
      partial: 0,
      error: 0,
      cacheHit: 0,
      offlineReused: 0
    },
    entries: [
      {
        status: "resolved",
        resolutionSource: "cache",
        componentId: "button-family-primary",
        componentSetId: "button-family-set",
        familyKey: "button-family",
        heuristicFamilyName: "Button",
        canonicalFamilyName: "Button",
        canonicalFamilyNameSource: "published_component_set",
        referringNodeIds: ["button-node-1"],
        variantProperties: [
          { property: "variant", values: ["Primary"] },
          { property: "size", values: ["Large"] }
        ],
        publishedComponent: {
          fileKey: "lib-file",
          nodeId: "10:20",
          name: "Button/Variant=Primary, Size=Large"
        },
        publishedComponentSet: {
          fileKey: "lib-file",
          nodeId: "10:00",
          name: "Button"
        }
      },
      {
        status: "resolved",
        resolutionSource: "cache",
        componentId: "button-family-secondary",
        componentSetId: "button-family-set",
        familyKey: "button-family",
        heuristicFamilyName: "Button",
        canonicalFamilyName: "Button",
        canonicalFamilyNameSource: "published_component_set",
        referringNodeIds: ["button-node-2"],
        variantProperties: [
          { property: "variant", values: ["Secondary"] },
          { property: "size", values: ["Small"] }
        ],
        publishedComponent: {
          fileKey: "lib-file",
          nodeId: "10:21",
          name: "Button/Variant=Secondary, Size=Small"
        }
      }
    ]
  };

  const componentMatchReportArtifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "button-family",
          familyName: "Button",
          variantProperties: [
            { property: "variant", values: ["Primary"] },
            { property: "size", values: ["Large"] }
          ]
        })
      ]
    }),
    catalogArtifact,
    evidenceArtifact,
    figmaLibraryResolutionArtifact
  });

  const matchEntry = componentMatchReportArtifact.entries[0];
  assert.ok(matchEntry);
  assert.deepEqual(
    matchEntry?.figma.referenceNodes?.map((node) => node.nodeId),
    ["10:00", "10:20", "10:21"]
  );

  const artifact = buildStorybookComponentVisualCatalogArtifact({
    componentMatchReportArtifact,
    catalogArtifact,
    evidenceArtifact
  });
  const entry = artifact.entries[0];
  assert.ok(entry);
  assert.equal(entry?.comparisonStatus, "ready");
  assert.equal(entry?.componentId, "button-family::button--primary-large");
  assert.equal(entry?.storyEntryId, "button--primary-large");
  assert.equal(entry?.storyTitle, "Components/Button/Primary Large");
  assert.equal(entry?.iframeId, "button--primary-large");
  assert.equal(entry?.referenceFileKey, "lib-file");
  assert.equal(entry?.referenceNodeId, "10:20");
  assert.equal(entry?.captureStrategy, "storybook_root_union");
  assert.deepEqual(entry?.baselineCanvas, { padding: 16 });
  assert.deepEqual(entry?.warnings, []);

  const serialized = serializeStorybookComponentVisualCatalogArtifact({ artifact });
  const parsed = parseStorybookComponentVisualCatalogArtifact({ input: serialized });
  assert.deepEqual(parsed.entries, artifact.entries);
});

test("buildStorybookComponentVisualCatalogArtifact persists deterministic skip coverage and authoritative-story fallback selection", () => {
  const catalogEntries = [
    createCatalogEntry({
      id: "ready-story",
      title: "Components/Ready",
      name: "Ready Story",
      familyId: "family-ready",
      args: {
        variant: "Primary"
      }
    }),
    createCatalogEntry({
      id: "docs-only-page",
      title: "Docs/Only",
      name: "Docs Only",
      familyId: "family-docs-only",
      type: "docs"
    }),
    createCatalogEntry({
      id: "non-authoritative-story",
      title: "Components/Missing Authoritative",
      name: "No Authoritative Story",
      familyId: "family-missing-authoritative"
    }),
    createCatalogEntry({
      id: "fallback-story-a",
      title: "Components/Fallback",
      name: "Fallback Story A",
      familyId: "family-fallback"
    }),
    createCatalogEntry({
      id: "fallback-story-b",
      title: "Components/Fallback",
      name: "Fallback Story B",
      familyId: "family-fallback"
    }),
    createCatalogEntry({
      id: "reference-missing-story",
      title: "Components/Missing Reference",
      name: "Reference Missing Story",
      familyId: "family-missing-reference"
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries: catalogEntries,
    families: [
      createCatalogFamily({
        id: "family-ready",
        title: "Components/Ready",
        name: "Ready",
        entryIds: ["ready-story"],
        storyEntryIds: ["ready-story"]
      }),
      createCatalogFamily({
        id: "family-docs-only",
        title: "Docs/Only",
        name: "Docs Only",
        entryIds: ["docs-only-page"],
        storyEntryIds: [],
        docsEntryIds: ["docs-only-page"],
        isDocsOnlyTier: true
      }),
      createCatalogFamily({
        id: "family-missing-authoritative",
        title: "Components/Missing Authoritative",
        name: "Missing Authoritative",
        entryIds: ["non-authoritative-story"],
        storyEntryIds: ["non-authoritative-story"]
      }),
      createCatalogFamily({
        id: "family-fallback",
        title: "Components/Fallback",
        name: "Fallback",
        entryIds: ["fallback-story-a", "fallback-story-b"],
        storyEntryIds: ["fallback-story-a", "fallback-story-b"]
      }),
      createCatalogFamily({
        id: "family-missing-reference",
        title: "Components/Missing Reference",
        name: "Missing Reference",
        entryIds: ["reference-missing-story"],
        storyEntryIds: ["reference-missing-story"]
      })
    ]
  });
  const evidenceArtifact = createEvidenceArtifact({
    evidence: [
      createEvidenceItem({ id: "evidence-ready", entryId: "ready-story" }),
      createEvidenceItem({ id: "evidence-fallback", entryId: "fallback-story-a" }),
      createEvidenceItem({
        id: "evidence-missing-reference",
        entryId: "reference-missing-story",
      }),
    ]
  });
  const componentMatchReportArtifact = createComponentMatchReportArtifact({
    entries: [
      createComponentMatchReportEntry({
        familyKey: "ambiguous-family",
        familyName: "Ambiguous",
        matchStatus: "ambiguous",
        familyId: "family-ready"
      }),
      createComponentMatchReportEntry({
        familyKey: "docs-only-family",
        familyName: "Docs Only",
        matchStatus: "matched",
        familyId: "family-docs-only"
      }),
      createComponentMatchReportEntry({
        familyKey: "fallback-family",
        familyName: "Fallback",
        matchStatus: "matched",
        familyId: "family-fallback",
        referenceNodes: [
          createReferenceNode({
            fileKey: "lib-file",
            nodeId: "10:30",
            nodeName: "Fallback Default",
            variantProperties: [{ property: "variant", values: ["Primary"] }]
          })
        ]
      }),
      createComponentMatchReportEntry({
        familyKey: "missing-authoritative-family",
        familyName: "Missing Authoritative",
        matchStatus: "matched",
        familyId: "family-missing-authoritative",
        referenceNodes: [
          createReferenceNode({
            fileKey: "lib-file",
            nodeId: "10:40"
          })
        ]
      }),
      createComponentMatchReportEntry({
        familyKey: "missing-reference-family",
        familyName: "Missing Reference",
        matchStatus: "matched",
        familyId: "family-missing-reference"
      }),
      createComponentMatchReportEntry({
        familyKey: "missing-story-family",
        familyName: "Missing Story",
        matchStatus: "matched",
        familyId: "family-ready",
        storyEntryId: "missing-story-entry",
        referenceNodes: [
          createReferenceNode({
            fileKey: "lib-file",
            nodeId: "10:50"
          })
        ]
      }),
      createComponentMatchReportEntry({
        familyKey: "unmatched-family",
        familyName: "Unmatched",
        matchStatus: "unmatched"
      })
    ]
  });

  const artifact = buildStorybookComponentVisualCatalogArtifact({
    componentMatchReportArtifact,
    catalogArtifact,
    evidenceArtifact
  });

  assert.equal(artifact.stats.totalCount, 7);
  assert.equal(artifact.stats.readyCount, 1);
  assert.equal(artifact.stats.skippedCount, 6);
  assert.deepEqual(artifact.stats.bySkipReason, {
    unmatched: 1,
    ambiguous: 1,
    docs_only: 1,
    missing_story: 1,
    missing_reference_node: 1,
    missing_authoritative_story: 1
  });

  const fallbackEntry = artifact.entries.find((entry) => entry.figmaFamilyKey === "fallback-family");
  assert.ok(fallbackEntry);
  assert.equal(fallbackEntry?.comparisonStatus, "ready");
  assert.equal(fallbackEntry?.storyEntryId, "fallback-story-a");
  assert.equal(fallbackEntry?.referenceNodeId, "10:30");
  assert.deepEqual(fallbackEntry?.warnings, ["story_selected_from_authoritative_fallback"]);

  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "docs-only-family")?.skipReason,
    "docs_only"
  );
  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "missing-authoritative-family")?.skipReason,
    "missing_authoritative_story"
  );
  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "missing-reference-family")?.skipReason,
    "missing_reference_node"
  );
  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "missing-story-family")?.skipReason,
    "missing_story"
  );
  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "ambiguous-family")?.skipReason,
    "ambiguous"
  );
  assert.equal(
    artifact.entries.find((entry) => entry.figmaFamilyKey === "unmatched-family")?.skipReason,
    "unmatched"
  );
});
