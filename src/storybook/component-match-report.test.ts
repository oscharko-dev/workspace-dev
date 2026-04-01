import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerProfileConfig } from "../customer-profile.js";
import {
  buildComponentMatchReportArtifact,
  serializeComponentMatchReportArtifact
} from "./component-match-report.js";
import type {
  FigmaAnalysis,
  FigmaAnalysisComponentFamily,
  FigmaAnalysisVariantProperty
} from "../parity/figma-analysis.js";
import type { FigmaLibraryResolutionArtifact } from "../job-engine/figma-library-resolution.js";
import type {
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
  sourceName: "Storybook Match Report Test",
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
  componentPath,
  args,
  argTypes,
  designUrls = [],
  type = "story"
}: {
  id: string;
  title: string;
  name: string;
  familyId: string;
  componentPath?: string;
  args?: Record<string, string>;
  argTypes?: Record<string, unknown>;
  designUrls?: string[];
  type?: "story" | "docs";
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
  ...(componentPath ? { componentPath } : {}),
  signalReferences: createEmptySignalReferences(),
  metadata: {
    ...(args ? { args } : {}),
    ...(argTypes ? { argTypes } : {}),
    designUrls,
    mdxLinks: {
      internal: [],
      external: []
    }
  }
});

const createCatalogFamily = ({
  id,
  title,
  name,
  entryIds,
  storyEntryIds,
  componentPath,
  designUrls = []
}: {
  id: string;
  title: string;
  name: string;
  entryIds: string[];
  storyEntryIds: string[];
  componentPath?: string;
  designUrls?: string[];
}): StorybookCatalogFamily => ({
  id,
  title,
  name,
  tier: title.split("/")[0] ?? title,
  isDocsOnlyTier: false,
  entryIds,
  storyEntryIds,
  docsEntryIds: entryIds.filter((entryId) => !storyEntryIds.includes(entryId)),
  storyCount: storyEntryIds.length,
  propKeys: [],
  hasDesignReference: designUrls.length > 0,
  ...(componentPath ? { componentPath } : {}),
  signalReferences: createEmptySignalReferences(),
  metadata: {
    designUrls,
    mdxLinks: {
      internal: [],
      external: []
    }
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
      [...new Set(families.map((family) => family.tier))]
        .sort((left, right) => left.localeCompare(right))
        .map((tier) => [tier, entries.filter((entry) => entry.tier === tier).length])
    ),
    byDocsAttachment: {
      attached: entries.filter((entry) => entry.docsAttachment === "attached").length,
      unattached: entries.filter((entry) => entry.docsAttachment === "unattached").length,
      not_applicable: entries.filter((entry) => entry.docsAttachment === "not_applicable").length
    },
    docsOnlyTiers: [],
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

const createEvidenceArtifact = ({
  evidence
}: {
  evidence: StorybookEvidenceItem[];
}): StorybookEvidenceArtifact => ({
  artifact: "storybook.evidence",
  version: 1,
  buildRoot: "storybook-static",
  iframeBundlePath: "assets/iframe-test.js",
  stats: {
    entryCount: evidence.length,
    evidenceCount: evidence.length,
    byType: {
      story_componentPath: evidence.filter((item) => item.type === "story_componentPath").length,
      story_argTypes: evidence.filter((item) => item.type === "story_argTypes").length,
      story_args: evidence.filter((item) => item.type === "story_args").length,
      story_design_link: evidence.filter((item) => item.type === "story_design_link").length,
      theme_bundle: evidence.filter((item) => item.type === "theme_bundle").length,
      css: evidence.filter((item) => item.type === "css").length,
      mdx_link: evidence.filter((item) => item.type === "mdx_link").length,
      docs_image: evidence.filter((item) => item.type === "docs_image").length,
      docs_text: evidence.filter((item) => item.type === "docs_text").length
    },
    byReliability: {
      authoritative: evidence.filter((item) => item.reliability === "authoritative").length,
      reference_only: evidence.filter((item) => item.reliability === "reference_only").length,
      derived: evidence.filter((item) => item.reliability === "derived").length
    }
  },
  evidence
});

const createEvidenceItem = ({
  id,
  type,
  entryId,
  text,
  imagePath,
  url
}: {
  id: string;
  type: StorybookEvidenceItem["type"];
  entryId: string;
  text?: string;
  imagePath?: string;
  url?: string;
}): StorybookEvidenceItem => ({
  id,
  type,
  reliability:
    type === "story_componentPath" || type === "story_argTypes" || type === "story_args" || type === "theme_bundle" || type === "css"
      ? "authoritative"
      : type === "mdx_link" || type === "docs_image" || type === "docs_text" || type === "story_design_link"
        ? "reference_only"
        : "derived",
  source: {
    entryId,
    entryType: type === "docs_image" || type === "docs_text" || type === "mdx_link" ? "docs" : "story",
    title: entryId
  },
  usage: {
    canDriveTokens: false,
    canDriveProps: false,
    canDriveImports: false,
    canDriveStyling: false,
    canProvideMatchHints: true
  },
  summary: {
    ...(text ? { text } : {}),
    ...(imagePath ? { imagePath } : {}),
    ...(url ? { url } : {})
  }
});

const createLibraryResolutionArtifact = ({
  familyKey,
  canonicalFamilyName,
  fileKey,
  nodeId,
  variantProperties = []
}: {
  familyKey: string;
  canonicalFamilyName: string;
  fileKey: string;
  nodeId: string;
  variantProperties?: FigmaAnalysisVariantProperty[];
}): FigmaLibraryResolutionArtifact => ({
  artifact: "figma.library_resolution",
  version: 1,
  figmaSourceMode: "local_json",
  fingerprint: "fixture",
  fileKey: "workspace-board",
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
      resolutionSource: "cache",
      componentId: `${familyKey}-component`,
      componentKey: `${familyKey}-component-key`,
      componentSetId: `${familyKey}-set`,
      componentSetKey: `${familyKey}-set-key`,
      familyKey,
      heuristicFamilyName: canonicalFamilyName,
      canonicalFamilyName,
      canonicalFamilyNameSource: "published_component_set",
      referringNodeIds: [`${familyKey}-node`],
      variantProperties,
      originFileKey: "workspace-board",
      publishedComponentSet: {
        key: `${familyKey}-published-set-key`,
        fileKey,
        nodeId,
        name: canonicalFamilyName
      }
    }
  ]
});

const createCustomerProfileForComponentMatchTests = ({
  imports = {
    Button: {
      family: "Components",
      package: "@customer/components",
      export: "PrimaryButton",
      importAlias: "CustomerButton",
      propMappings: {
        variant: "appearance"
      }
    }
  },
  fallbackComponents
}: {
  imports?: Record<
    string,
    {
      family: string;
      package: string;
      export: string;
      importAlias?: string;
      propMappings?: Record<string, string>;
    }
  >;
  fallbackComponents?: Record<string, "allow" | "deny">;
} = {}) => {
  const profile = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [
        {
          id: "Components",
          tierPriority: 10,
          aliases: {
            figma: ["Components"],
            storybook: ["components"],
            code: ["@customer/components"]
          }
        },
        {
          id: "ReactUI",
          tierPriority: 20,
          aliases: {
            figma: ["ReactUI"],
            storybook: ["reactui"],
            code: ["@customer/react-ui"]
          }
        }
      ],
      brandMappings: [
        {
          id: "sparkasse",
          aliases: ["sparkasse"],
          brandTheme: "sparkasse",
          storybookThemes: {
            light: "sparkasse-light"
          }
        }
      ],
      imports: {
        components: imports
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          ...(fallbackComponents ? { components: fallbackComponents } : {})
        }
      },
      template: {
        dependencies: {}
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!profile) {
    throw new Error("Failed to create component match customer profile fixture.");
  }
  return profile;
};

test("buildComponentMatchReportArtifact marks exact design-link and canonical-family matches as high confidence", () => {
  const figmaAnalysis = createFigmaAnalysis({
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
  });
  const entries = [
    createCatalogEntry({
      id: "button--primary-large",
      title: "Components/Button",
      name: "Primary Large",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      args: {
        variant: "primary",
        size: "large"
      },
      argTypes: {
        variant: { control: { type: "select" } }
      },
      designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries,
    families: [
      createCatalogFamily({
        id: "family-button",
        title: "Components/Button",
        name: "Button",
        entryIds: entries.map((entry) => entry.id),
        storyEntryIds: entries.map((entry) => entry.id),
        componentPath: "./src/components/Button.tsx",
        designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
      })
    ]
  });
  const evidenceArtifact = createEvidenceArtifact({
    evidence: [
      createEvidenceItem({
        id: "story-design-link",
        type: "story_design_link",
        entryId: "button--primary-large",
        url: "https://www.figma.com/design/lib-file/Button?node-id=11-22"
      })
    ]
  });

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact,
    evidenceArtifact,
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "button-family",
      canonicalFamilyName: "Button",
      fileKey: "lib-file",
      nodeId: "11:22",
      variantProperties: [{ property: "variant", values: ["Primary"] }]
    })
  });

  assert.equal(artifact.summary.matched, 1);
  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "matched");
  assert.equal(entry?.match.confidence, "high");
  assert.equal(entry?.match.confidenceScore, 100);
  assert.equal(entry?.storybookFamily?.title, "Components/Button");
  assert.equal(entry?.storyVariant?.entryId, "button--primary-large");
});

test("buildComponentMatchReportArtifact ignores reference-only docs when no authoritative evidence exists", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [createFigmaFamily({ familyKey: "button-family", familyName: "Button" })]
  });
  const entries = [
    createCatalogEntry({
      id: "text-field--docs",
      title: "Forms/TextField",
      name: "Docs",
      familyId: "family-text-field",
      type: "docs"
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries,
    families: [
      createCatalogFamily({
        id: "family-text-field",
        title: "Forms/TextField",
        name: "TextField",
        entryIds: entries.map((entry) => entry.id),
        storyEntryIds: []
      })
    ]
  });
  const evidenceArtifact = createEvidenceArtifact({
    evidence: [
      createEvidenceItem({
        id: "text-field-docs-text",
        type: "docs_text",
        entryId: "text-field--docs",
        text: "Button usage guidance and examples"
      }),
      createEvidenceItem({
        id: "text-field-docs-image",
        type: "docs_image",
        entryId: "text-field--docs",
        imagePath: "static/assets/button-reference.png"
      })
    ]
  });

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact,
    evidenceArtifact
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "unmatched");
  assert.deepEqual(entry?.rejectionReasons, ["no_candidates"]);
  assert.equal(entry?.usedEvidence.some((usedEvidence) => usedEvidence.class === "reference_only_docs"), false);
});

test("buildComponentMatchReportArtifact marks equal authoritative candidates as ambiguous with a stable winner", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [createFigmaFamily({ familyKey: "dialog-family", familyName: "Dialog" })]
  });
  const entries = [
    createCatalogEntry({
      id: "components-dialog--default",
      title: "Components/Dialog",
      name: "Default",
      familyId: "family-components-dialog",
      componentPath: "./src/components/Dialog.tsx"
    }),
    createCatalogEntry({
      id: "patterns-dialog--default",
      title: "Patterns/Dialog",
      name: "Default",
      familyId: "family-patterns-dialog",
      componentPath: "./src/patterns/Dialog.tsx"
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries,
    families: [
      createCatalogFamily({
        id: "family-components-dialog",
        title: "Components/Dialog",
        name: "Dialog",
        entryIds: ["components-dialog--default"],
        storyEntryIds: ["components-dialog--default"],
        componentPath: "./src/components/Dialog.tsx"
      }),
      createCatalogFamily({
        id: "family-patterns-dialog",
        title: "Patterns/Dialog",
        name: "Dialog",
        entryIds: ["patterns-dialog--default"],
        storyEntryIds: ["patterns-dialog--default"],
        componentPath: "./src/patterns/Dialog.tsx"
      })
    ]
  });
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact,
    evidenceArtifact: createEvidenceArtifact({ evidence: [] })
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "ambiguous");
  assert.equal(entry?.storybookFamily?.title, "Components/Dialog");
  assert.deepEqual(entry?.rejectionReasons, ["insufficient_authoritative_lead", "insufficient_total_score"]);
});

test("buildComponentMatchReportArtifact selects the best story variant from Figma variant values", () => {
  const figmaAnalysis = createFigmaAnalysis({
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
  });
  const entries = [
    createCatalogEntry({
      id: "button--default",
      title: "Components/Button",
      name: "Default",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      args: {
        variant: "secondary",
        size: "medium"
      }
    }),
    createCatalogEntry({
      id: "button--primary-large",
      title: "Components/Button",
      name: "Primary Large",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      args: {
        variant: "primary",
        size: "large"
      }
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries,
    families: [
      createCatalogFamily({
        id: "family-button",
        title: "Components/Button",
        name: "Button",
        entryIds: entries.map((entry) => entry.id),
        storyEntryIds: entries.map((entry) => entry.id),
        componentPath: "./src/components/Button.tsx"
      })
    ]
  });

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact,
    evidenceArtifact: createEvidenceArtifact({ evidence: [] })
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.storybookFamily?.title, "Components/Button");
  assert.equal(entry?.storyVariant?.entryId, "button--primary-large");
  assert.equal(
    entry?.usedEvidence.some(
      (usedEvidence) => usedEvidence.class === "variant_or_prop_overlap" && usedEvidence.role === "story_variant_selection"
    ),
    true
  );
});

test("buildComponentMatchReportArtifact resolves customer-profile imports for matched Storybook families", () => {
  const entries = [
    createCatalogEntry({
      id: "button--primary",
      title: "Components/Button",
      name: "Primary",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"],
      args: {
        variant: "primary"
      }
    })
  ];

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [createFigmaFamily({ familyKey: "button-family", familyName: "Button" })]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-button",
          title: "Components/Button",
          name: "Button",
          entryIds: ["button--primary"],
          storyEntryIds: ["button--primary"],
          componentPath: "./src/components/Button.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "button-design-link",
          type: "story_design_link",
          entryId: "button--primary",
          url: "https://www.figma.com/design/lib-file/Button?node-id=11-22"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "button-family",
      canonicalFamilyName: "Button",
      fileKey: "lib-file",
      nodeId: "11:22"
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests()
  });

  const entry = artifact.entries[0];
  assert.deepEqual(entry?.libraryResolution, {
    status: "resolved_import",
    reason: "profile_import_resolved",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "Button",
    import: {
      package: "@customer/components",
      exportName: "PrimaryButton",
      localName: "CustomerButton",
      propMappings: {
        variant: "appearance"
      }
    }
  });
  assert.deepEqual(artifact.summary.libraryResolution.byStatus, {
    resolved_import: 1,
    mui_fallback_allowed: 0,
    mui_fallback_denied: 0,
    not_applicable: 0
  });
  assert.deepEqual(artifact.summary.libraryResolution.byReason, {
    profile_import_resolved: 1,
    profile_import_missing: 0,
    profile_import_family_mismatch: 0,
    profile_family_unresolved: 0,
    match_ambiguous: 0,
    match_unmatched: 0
  });
});

test("buildComponentMatchReportArtifact marks allowed MUI fallbacks when profile imports are missing", () => {
  const entries = [
    createCatalogEntry({
      id: "card--default",
      title: "Components/Card",
      name: "Default",
      familyId: "family-card",
      componentPath: "./src/components/Card.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Card?node-id=2-4"]
    })
  ];

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [createFigmaFamily({ familyKey: "card-family", familyName: "Card" })]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-card",
          title: "Components/Card",
          name: "Card",
          entryIds: ["card--default"],
          storyEntryIds: ["card--default"],
          componentPath: "./src/components/Card.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Card?node-id=2-4"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "card-design-link",
          type: "story_design_link",
          entryId: "card--default",
          url: "https://www.figma.com/design/lib-file/Card?node-id=2-4"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "card-family",
      canonicalFamilyName: "Card",
      fileKey: "lib-file",
      nodeId: "2:4"
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests({
      fallbackComponents: {
        Card: "allow"
      }
    })
  });

  assert.deepEqual(artifact.entries[0]?.libraryResolution, {
    status: "mui_fallback_allowed",
    reason: "profile_import_missing",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "Card"
  });
});

test("buildComponentMatchReportArtifact marks denied MUI fallbacks when profile imports are missing", () => {
  const entries = [
    createCatalogEntry({
      id: "text-field--default",
      title: "Components/TextField",
      name: "Default",
      familyId: "family-text-field",
      componentPath: "./src/components/TextField.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/TextField?node-id=3-6"]
    })
  ];

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [createFigmaFamily({ familyKey: "text-field-family", familyName: "TextField" })]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-text-field",
          title: "Components/TextField",
          name: "TextField",
          entryIds: ["text-field--default"],
          storyEntryIds: ["text-field--default"],
          componentPath: "./src/components/TextField.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/TextField?node-id=3-6"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "text-field-design-link",
          type: "story_design_link",
          entryId: "text-field--default",
          url: "https://www.figma.com/design/lib-file/TextField?node-id=3-6"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "text-field-family",
      canonicalFamilyName: "TextField",
      fileKey: "lib-file",
      nodeId: "3:6"
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests()
  });

  assert.deepEqual(artifact.entries[0]?.libraryResolution, {
    status: "mui_fallback_denied",
    reason: "profile_import_missing",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "TextField"
  });
});

test("buildComponentMatchReportArtifact reports family mismatches without leaking private path data", () => {
  const entries = [
    createCatalogEntry({
      id: "button--default",
      title: "Components/Button",
      name: "Default",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [createFigmaFamily({ familyKey: "button-family", familyName: "Button" })]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-button",
          title: "Components/Button",
          name: "Button",
          entryIds: ["button--default"],
          storyEntryIds: ["button--default"],
          componentPath: "./src/components/Button.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "button-design-link",
          type: "story_design_link",
          entryId: "button--default",
          url: "https://www.figma.com/design/lib-file/Button?node-id=11-22"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "button-family",
      canonicalFamilyName: "Button",
      fileKey: "lib-file",
      nodeId: "11:22"
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests({
      imports: {
        Button: {
          family: "ReactUI",
          package: "@customer/react-ui",
          export: "SharedButton",
          importAlias: "CustomerButton"
        }
      }
    })
  });

  assert.deepEqual(artifact.entries[0]?.libraryResolution, {
    status: "mui_fallback_denied",
    reason: "profile_import_family_mismatch",
    storybookTier: "Components",
    profileFamily: "Components",
    componentKey: "Button"
  });

  const serialized = serializeComponentMatchReportArtifact({ artifact });
  assert.equal(serialized.includes("importPath"), false);
  assert.equal(serialized.includes("componentPath"), false);
  assert.equal(serialized.includes("https://www.figma.com"), false);
  assert.equal(serialized.includes("lib-file"), false);
  assert.equal(serialized.includes("11:22"), false);
});

test("serializeComponentMatchReportArtifact is byte-stable and excludes raw private source details", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [createFigmaFamily({ familyKey: "button-family", familyName: "Button" })]
  });
  const entries = [
    createCatalogEntry({
      id: "button--default",
      title: "Components/Button",
      name: "Default",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-button",
          title: "Components/Button",
          name: "Button",
          entryIds: ["button--default"],
          storyEntryIds: ["button--default"],
          componentPath: "./src/components/Button.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Button?node-id=11-22"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "button-design-link",
          type: "story_design_link",
          entryId: "button--default",
          url: "https://www.figma.com/design/lib-file/Button?node-id=11-22"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "button-family",
      canonicalFamilyName: "Button",
      fileKey: "lib-file",
      nodeId: "11:22"
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests()
  });

  const firstBytes = serializeComponentMatchReportArtifact({ artifact });
  const secondBytes = serializeComponentMatchReportArtifact({ artifact });

  assert.equal(firstBytes, secondBytes);
  assert.equal(firstBytes.includes("importPath"), false);
  assert.equal(firstBytes.includes("bundlePath"), false);
  assert.equal(firstBytes.includes("iframeBundlePath"), false);
  assert.equal(firstBytes.includes("buildRoot"), false);
  assert.equal(firstBytes.includes("https://www.figma.com"), false);
  assert.equal(firstBytes.includes("lib-file"), false);
  assert.equal(firstBytes.includes("11:22"), false);
  assert.equal(firstBytes.includes("componentPath"), false);
});

test("buildComponentMatchReportArtifact classifies design_link evidence as derived, not reference_only", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [
      createFigmaFamily({
        familyKey: "chip-family",
        familyName: "Chip"
      })
    ]
  });
  const entries = [
    createCatalogEntry({
      id: "chip--default",
      title: "Components/Chip",
      name: "Default",
      familyId: "family-chip",
      componentPath: "./src/components/Chip.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Chip?node-id=5-10"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-chip",
          title: "Components/Chip",
          name: "Chip",
          entryIds: ["chip--default"],
          storyEntryIds: ["chip--default"],
          componentPath: "./src/components/Chip.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Chip?node-id=5-10"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({ evidence: [] }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "chip-family",
      canonicalFamilyName: "Chip",
      fileKey: "lib-file",
      nodeId: "5:10"
    })
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "matched");
  const designLinkEvidence = entry?.usedEvidence.find((evidence) => evidence.class === "design_link");
  assert.ok(designLinkEvidence, "design_link evidence should be present");
  assert.equal(designLinkEvidence.reliability, "derived");
  assert.notEqual(designLinkEvidence.reliability, "reference_only");
});

test("buildComponentMatchReportArtifact produces unmatched when no Storybook families exist", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [
      createFigmaFamily({ familyKey: "orphan-family", familyName: "OrphanWidget" })
    ]
  });
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact: createCatalogArtifact({ entries: [], families: [] }),
    evidenceArtifact: createEvidenceArtifact({ evidence: [] })
  });

  assert.equal(artifact.summary.totalFigmaFamilies, 1);
  assert.equal(artifact.summary.unmatched, 1);
  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "unmatched");
  assert.equal(entry?.match.confidence, "none");
  assert.deepEqual(entry?.rejectionReasons, ["no_candidates"]);
});
