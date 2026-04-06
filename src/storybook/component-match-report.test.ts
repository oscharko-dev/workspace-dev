import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerProfileConfig } from "../customer-profile.js";
import type { ResolvedStorybookTheme } from "./theme-resolver.js";
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
  StorybookCatalogJsonValue,
  StorybookCatalogSignalReferences,
  StorybookEvidenceArtifact,
  StorybookEvidenceItem,
  StorybookPublicComponentsArtifact
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
  assetKind,
  assetKeys,
  type = "story"
}: {
  id: string;
  title: string;
  name: string;
  familyId: string;
  componentPath?: string;
  args?: Record<string, StorybookCatalogJsonValue>;
  argTypes?: Record<string, unknown>;
  designUrls?: string[];
  assetKind?: "icon" | "illustration";
  assetKeys?: string[];
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
    },
    assetKeys: assetKeys ?? [],
    ...(assetKind ? { assetKind } : {})
  }
});

const createCatalogFamily = ({
  id,
  title,
  name,
  entryIds,
  storyEntryIds,
  componentPath,
  designUrls = [],
  propKeys = [],
  assetKind,
  assetKeys
}: {
  id: string;
  title: string;
  name: string;
  entryIds: string[];
  storyEntryIds: string[];
  componentPath?: string;
  designUrls?: string[];
  propKeys?: string[];
  assetKind?: "icon" | "illustration";
  assetKeys?: string[];
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
  propKeys,
  hasDesignReference: designUrls.length > 0,
  ...(componentPath ? { componentPath } : {}),
  signalReferences: createEmptySignalReferences(),
  metadata: {
    designUrls,
    mdxLinks: {
      internal: [],
      external: []
    },
    assetKeys: assetKeys ?? [],
    ...(assetKind ? { assetKind } : {})
  }
});

const createComponentsArtifact = ({
  components
}: {
  components: Array<{
    name: string;
    title: string;
    componentPath: string;
    propKeys: string[];
  }>;
}): StorybookPublicComponentsArtifact => ({
  artifact: "storybook.components",
  version: 1,
  stats: {
    entryCount: components.length,
    componentCount: components.length,
    componentWithDesignReferenceCount: 0,
    propKeyCount: new Set(components.flatMap((component) => component.propKeys)).size
  },
  components: components.map((component, index) => ({
    id: `component-${index + 1}`,
    name: component.name,
    title: component.title,
    componentPath: component.componentPath,
    propKeys: component.propKeys,
    storyCount: 1,
    hasDesignReference: false
  }))
});

const createResolvedStorybookThemeFixture = (): ResolvedStorybookTheme =>
  ({
    customerBrandId: "sparkasse",
    brandMappingId: "sparkasse",
    includeThemeModeToggle: false,
    light: {
      themeId: "sparkasse-light",
      palette: {
        primary: {
          main: "#dd0000"
        },
        text: {
          primary: "#111111"
        },
        background: {
          default: "#ffffff",
          paper: "#ffffff"
        }
      },
      spacingBase: 8,
      borderRadius: 12,
      typography: {
        fontFamily: "Brand Sans",
        base: {},
        variants: {}
      },
      components: {
        MuiButton: {
          defaultProps: {
            size: "small"
          }
        },
        MuiTextField: {
          defaultProps: {
            size: "medium"
          }
        }
      }
    },
    tokensDocument: {
      customerBrandId: "sparkasse",
      brandMappingId: "sparkasse",
      includeThemeModeToggle: false,
      light: {
        themeId: "sparkasse-light",
        palette: {
          primary: {
            main: "#dd0000"
          },
          text: {
            primary: "#111111"
          },
          background: {
            default: "#ffffff",
            paper: "#ffffff"
          }
        },
        spacingBase: 8,
        borderRadius: 12,
        typography: {
          fontFamily: "Brand Sans",
          base: {},
          variants: {}
        },
        components: {}
      }
    }
  }) as ResolvedStorybookTheme;

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
  iconImports,
  fallbackComponents,
  fallbackIcons,
  iconWrapper
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
  iconImports?: Record<
    string,
    {
      package: string;
      export: string;
      importAlias?: string;
    }
  >;
  fallbackComponents?: Record<string, "allow" | "deny">;
  fallbackIcons?: Record<string, "allow" | "deny">;
  iconWrapper?: {
    package: string;
    export: string;
    importAlias?: string;
    iconProp?: string;
  };
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
        components: imports,
        icons: iconImports ?? {}
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          ...(fallbackComponents ? { components: fallbackComponents } : {})
        },
        icons: {
          defaultPolicy: "deny",
          ...(fallbackIcons ? { icons: fallbackIcons } : {}),
          ...(iconWrapper ? { wrapper: iconWrapper } : {})
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
  assert.deepEqual(entry?.rejectionReasons, ["insufficient_primary_lead", "insufficient_total_score"]);
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
  assert.deepEqual(entry?.figma.figmaLibraryResolution, {
    status: "resolved",
    resolutionSource: "cache",
    originFileKey: "workspace-board",
    canonicalFamilyName: "Button",
    canonicalFamilyNameSource: "published_component_set",
    issues: [],
    designLinks: [
      {
        fileKey: "lib-file",
        nodeId: "11:22"
      }
    ]
  });
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

test("buildComponentMatchReportArtifact preserves structured prop object semantics for resolved imports", () => {
  const entries = [
    createCatalogEntry({
      id: "alert--default",
      title: "Components/Alert",
      name: "Default",
      familyId: "family-alert",
      componentPath: "./src/components/Alert.tsx",
      designUrls: ["https://www.figma.com/design/lib-file/Alert?node-id=10-20"],
      args: {
        severity: "error",
        sx: {
          mt: 2
        }
      },
      argTypes: {
        severity: {
          options: ["Error", "Warning"]
        }
      }
    })
  ];

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "alert-family",
          familyName: "Alert",
          variantProperties: [
            { property: "Severity", values: ["Error"] },
            { property: "sx", values: ["{}"] }
          ]
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-alert",
          title: "Components/Alert",
          name: "Alert",
          entryIds: ["alert--default"],
          storyEntryIds: ["alert--default"],
          componentPath: "./src/components/Alert.tsx",
          designUrls: ["https://www.figma.com/design/lib-file/Alert?node-id=10-20"],
          propKeys: ["children", "severity", "sx"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "alert-design-link",
          type: "story_design_link",
          entryId: "alert--default",
          url: "https://www.figma.com/design/lib-file/Alert?node-id=10-20"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "alert-family",
      canonicalFamilyName: "Alert",
      fileKey: "lib-file",
      nodeId: "10:20",
      variantProperties: [
        { property: "Severity", values: ["Error"] },
        { property: "sx", values: ["{}"] }
      ]
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests({
      imports: {
        Alert: {
          family: "Components",
          package: "@customer/feedback",
          export: "CustomerAlert"
        }
      }
    })
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.resolvedApi?.status, "resolved");
  const sxAllowedProp = entry?.resolvedApi?.allowedProps.find((prop) => prop.name === "sx");
  assert.equal(sxAllowedProp?.kind, "object");
  assert.equal(sxAllowedProp?.allowedValues, undefined);
  const sxResolvedProp = entry?.resolvedProps?.props.find((prop) => prop.sourceProp === "sx");
  assert.equal(sxResolvedProp?.kind, "object");
  assert.equal(sxResolvedProp?.values, undefined);
});

test("buildComponentMatchReportArtifact resolves exact customer icon imports per normalized icon key", () => {
  const entries = [
    createCatalogEntry({
      id: "icons-mail--default",
      title: "Assets/Icons/Icon",
      name: "Mail",
      familyId: "family-mail-icon",
      assetKind: "icon",
      assetKeys: ["mail"],
      designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=5-9"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "mail-icon-family",
          familyName: "Icon",
          variantProperties: [{ property: "Name", values: ["MailOutlined"] }]
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-mail-icon",
          title: "Assets/Icons/Icon",
          name: "Icon",
          entryIds: ["icons-mail--default"],
          storyEntryIds: ["icons-mail--default"],
          assetKind: "icon",
          assetKeys: ["mail"],
          designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=5-9"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "mail-icon-design-link",
          type: "story_design_link",
          entryId: "icons-mail--default",
          url: "https://www.figma.com/design/lib-file/Icon?node-id=5-9"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "mail-icon-family",
      canonicalFamilyName: "Icon",
      fileKey: "lib-file",
      nodeId: "5:9",
      variantProperties: [{ property: "Name", values: ["MailOutlined"] }]
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests({
      iconImports: {
        mail: {
          package: "@customer/icons",
          export: "MailIcon",
          importAlias: "CustomerMailIcon"
        }
      }
    })
  });

  assert.deepEqual(artifact.entries[0]?.iconResolution, {
    assetKind: "icon",
    iconKeys: ["mail"],
    byKey: {
      mail: {
        iconKey: "mail",
        status: "resolved_import",
        reason: "profile_icon_import_resolved",
        import: {
          package: "@customer/icons",
          exportName: "MailIcon",
          localName: "CustomerMailIcon"
        }
      }
    },
    counts: {
      exactImportResolved: 1,
      wrapperFallbackAllowed: 0,
      wrapperFallbackDenied: 0,
      unresolved: 0,
      ambiguous: 0
    }
  });
  assert.equal(artifact.summary.iconResolution.byStatus.resolved_import, 1);
  assert.equal(artifact.summary.iconResolution.byReason.profile_icon_import_resolved, 1);
});

test("buildComponentMatchReportArtifact records allowed generic icon wrapper fallback", () => {
  const entries = [
    createCatalogEntry({
      id: "icons-search--default",
      title: "Assets/Icons/Icon",
      name: "Search",
      familyId: "family-search-icon",
      assetKind: "icon",
      assetKeys: ["search"],
      designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=7-11"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "search-icon-family",
          familyName: "Icon",
          variantProperties: [{ property: "iconName", values: ["Search"] }]
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-search-icon",
          title: "Assets/Icons/Icon",
          name: "Icon",
          entryIds: ["icons-search--default"],
          storyEntryIds: ["icons-search--default"],
          assetKind: "icon",
          assetKeys: ["search"],
          designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=7-11"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "search-icon-design-link",
          type: "story_design_link",
          entryId: "icons-search--default",
          url: "https://www.figma.com/design/lib-file/Icon?node-id=7-11"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "search-icon-family",
      canonicalFamilyName: "Icon",
      fileKey: "lib-file",
      nodeId: "7:11",
      variantProperties: [{ property: "iconName", values: ["Search"] }]
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests({
      fallbackIcons: {
        search: "allow"
      },
      iconWrapper: {
        package: "@customer/icons",
        export: "Icon",
        importAlias: "CustomerIcon",
        iconProp: "name"
      }
    })
  });

  assert.equal(artifact.entries[0]?.iconResolution?.byKey.search?.status, "wrapper_fallback_allowed");
  assert.deepEqual(artifact.entries[0]?.iconResolution?.byKey.search?.wrapper, {
    package: "@customer/icons",
    exportName: "Icon",
    localName: "CustomerIcon",
    iconPropName: "name"
  });
  assert.equal(artifact.summary.iconResolution.byStatus.wrapper_fallback_allowed, 1);
});

test("buildComponentMatchReportArtifact records denied icon wrapper fallback when exact icon import is missing", () => {
  const entries = [
    createCatalogEntry({
      id: "icons-search--default",
      title: "Assets/Icons/Icon",
      name: "Search",
      familyId: "family-search-icon",
      assetKind: "icon",
      assetKeys: ["search"],
      designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=7-11"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "search-icon-family",
          familyName: "Icon",
          variantProperties: [{ property: "Name", values: ["Search"] }]
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-search-icon",
          title: "Assets/Icons/Icon",
          name: "Icon",
          entryIds: ["icons-search--default"],
          storyEntryIds: ["icons-search--default"],
          assetKind: "icon",
          assetKeys: ["search"],
          designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=7-11"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "search-icon-design-link",
          type: "story_design_link",
          entryId: "icons-search--default",
          url: "https://www.figma.com/design/lib-file/Icon?node-id=7-11"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "search-icon-family",
      canonicalFamilyName: "Icon",
      fileKey: "lib-file",
      nodeId: "7:11",
      variantProperties: [{ property: "Name", values: ["Search"] }]
    }),
    resolvedCustomerProfile: createCustomerProfileForComponentMatchTests()
  });

  assert.equal(artifact.entries[0]?.iconResolution?.byKey.search?.status, "wrapper_fallback_denied");
  assert.equal(artifact.entries[0]?.iconResolution?.byKey.search?.reason, "profile_icon_wrapper_denied");
  assert.equal(artifact.summary.iconResolution.byStatus.wrapper_fallback_denied, 1);
});

test("buildComponentMatchReportArtifact treats unmatched ic_* families as unresolved icon outcomes", () => {
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "ic-mail-family",
          familyName: "ic_mail"
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries: [],
      families: []
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: []
    })
  });

  assert.equal(artifact.entries[0]?.match.status, "unmatched");
  assert.deepEqual(artifact.entries[0]?.iconResolution, {
    assetKind: "icon",
    iconKeys: ["mail"],
    byKey: {
      mail: {
        iconKey: "mail",
        status: "unresolved",
        reason: "match_unmatched"
      }
    },
    counts: {
      exactImportResolved: 0,
      wrapperFallbackAllowed: 0,
      wrapperFallbackDenied: 0,
      unresolved: 1,
      ambiguous: 0
    }
  });
  assert.equal(artifact.summary.iconResolution.byStatus.unresolved, 1);
  assert.equal(artifact.summary.iconResolution.byReason.match_unmatched, 1);
});

test("buildComponentMatchReportArtifact reports profile_family_unresolved for icon resolution when no customer profile is provided", () => {
  const entries = [
    createCatalogEntry({
      id: "icons-mail--default",
      title: "Assets/Icons/Icon",
      name: "Mail",
      familyId: "family-mail-icon",
      assetKind: "icon",
      assetKeys: ["mail"],
      designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=5-9"]
    })
  ];
  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [
        createFigmaFamily({
          familyKey: "mail-icon-family",
          familyName: "Icon",
          variantProperties: [{ property: "Name", values: ["MailOutlined"] }]
        })
      ]
    }),
    catalogArtifact: createCatalogArtifact({
      entries,
      families: [
        createCatalogFamily({
          id: "family-mail-icon",
          title: "Assets/Icons/Icon",
          name: "Icon",
          entryIds: ["icons-mail--default"],
          storyEntryIds: ["icons-mail--default"],
          assetKind: "icon",
          assetKeys: ["mail"],
          designUrls: ["https://www.figma.com/design/lib-file/Icon?node-id=5-9"]
        })
      ]
    }),
    evidenceArtifact: createEvidenceArtifact({
      evidence: [
        createEvidenceItem({
          id: "mail-icon-design-link",
          type: "story_design_link",
          entryId: "icons-mail--default",
          url: "https://www.figma.com/design/lib-file/Icon?node-id=5-9"
        })
      ]
    }),
    figmaLibraryResolutionArtifact: createLibraryResolutionArtifact({
      familyKey: "mail-icon-family",
      canonicalFamilyName: "Icon",
      fileKey: "lib-file",
      nodeId: "5:9",
      variantProperties: [{ property: "Name", values: ["MailOutlined"] }]
    })
  });

  assert.equal(artifact.entries[0]?.match.status, "matched");
  assert.equal(artifact.entries[0]?.iconResolution?.byKey.mail?.status, "unresolved");
  assert.equal(artifact.entries[0]?.iconResolution?.byKey.mail?.reason, "profile_family_unresolved");
  assert.equal(artifact.summary.iconResolution.byStatus.unresolved, 1);
  assert.equal(artifact.summary.iconResolution.byReason.profile_family_unresolved, 1);
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

test("buildComponentMatchReportArtifact reports family mismatches while preserving figma provenance and omitting private path data", () => {
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
  assert.equal(serialized.includes("figmaLibraryResolution"), true);
  assert.equal(serialized.includes("originFileKey"), true);
  assert.equal(serialized.includes("lib-file"), true);
  assert.equal(serialized.includes("11:22"), true);
});

test("serializeComponentMatchReportArtifact is byte-stable and preserves figma provenance without leaking private source details", () => {
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
  assert.equal(firstBytes.includes("figmaLibraryResolution"), true);
  assert.equal(firstBytes.includes("originFileKey"), true);
  assert.equal(firstBytes.includes("lib-file"), true);
  assert.equal(firstBytes.includes("11:22"), true);
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

test("buildComponentMatchReportArtifact uses MUI fallback when Storybook tier is not in customer profile families", () => {
  const customerProfile = parseCustomerProfileConfig({
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
        }
      ],
      brandMappings: [
        {
          id: "sparkasse",
          aliases: ["sparkasse"],
          brandTheme: "sparkasse",
          storybookThemes: { light: "sparkasse-light" }
        }
      ],
      imports: {
        components: {
          Button: {
            family: "Components",
            package: "@customer/components",
            export: "PrimaryButton"
          }
        }
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          components: {
            Card: "allow"
          }
        }
      },
      template: { dependencies: {} },
      strictness: { match: "warn", token: "off", import: "off" }
    }
  });
  assert.notEqual(customerProfile, undefined);

  const designUrl = "https://www.figma.com/design/ABC123/MyFile?node-id=10:20";
  const entries = [
    createCatalogEntry({
      id: "card--default",
      title: "UnknownTier/Card",
      name: "Card",
      familyId: "family-card",
      componentPath: "src/components/Card.tsx",
      designUrls: [designUrl],
      args: { variant: "outlined", elevation: "0" }
    })
  ];
  const families = [
    createCatalogFamily({
      id: "family-card",
      title: "UnknownTier/Card",
      name: "Card",
      entryIds: ["card--default"],
      storyEntryIds: ["card--default"],
      componentPath: "src/components/Card.tsx",
      designUrls: [designUrl]
    })
  ];

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis: createFigmaAnalysis({
      componentFamilies: [createFigmaFamily({ familyKey: "card-family", familyName: "Card" })]
    }),
    catalogArtifact: createCatalogArtifact({ entries, families }),
    evidenceArtifact: createEvidenceArtifact({ evidence: [] }),
    resolvedCustomerProfile: customerProfile,
    figmaLibraryResolutionArtifact: {
      artifact: "figma.library_resolution",
      version: 1,
      entries: [
        {
          componentId: "card-family-component",
          componentSetId: "card-family-set",
          familyKey: "card-family",
          status: "resolved",
          canonicalFamilyName: "Card",
          canonicalFamilyNameSource: "published_component",
          variantProperties: [],
          publishedComponent: {
            fileKey: "ABC123",
            nodeId: "10:20",
            name: "Card",
            description: ""
          }
        }
      ]
    }
  });

  const entry = artifact.entries[0];
  assert.equal(entry?.match.status, "matched");
  assert.equal(entry?.libraryResolution.reason, "profile_family_unresolved");
  assert.equal(entry?.libraryResolution.status, "mui_fallback_allowed");
  assert.equal(entry?.libraryResolution.componentKey, "Card");
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

test("buildComponentMatchReportArtifact resolves sanitized component APIs across dominant Storybook families", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [
      createFigmaFamily({
        familyKey: "button-family",
        familyName: "Button",
        variantProperties: [
          { property: "Variant", values: ["Primary"] },
          { property: "Size", values: ["Small"] }
        ]
      }),
      createFigmaFamily({
        familyKey: "textfield-family",
        familyName: "TextField",
        variantProperties: [
          { property: "Variant", values: ["Outlined"] },
          { property: "Error", values: ["true"] }
        ]
      }),
      createFigmaFamily({
        familyKey: "select-family",
        familyName: "Select",
        variantProperties: [{ property: "Orientation", values: ["Horizontal"] }]
      }),
      createFigmaFamily({
        familyKey: "datepicker-family",
        familyName: "DatePicker",
        variantProperties: [{ property: "Disabled", values: ["true"] }]
      }),
      createFigmaFamily({
        familyKey: "accordion-family",
        familyName: "Accordion",
        variantProperties: [{ property: "Expanded", values: ["true"] }]
      }),
      createFigmaFamily({
        familyKey: "icon-family",
        familyName: "Icon",
        variantProperties: [{ property: "Color", values: ["Primary"] }]
      }),
      createFigmaFamily({
        familyKey: "typography-family",
        familyName: "Typography",
        variantProperties: [{ property: "Variant", values: ["H1"] }]
      })
    ]
  });
  const entries = [
    createCatalogEntry({
      id: "button--primary",
      title: "Components/Button",
      name: "Primary",
      familyId: "family-button",
      componentPath: "./src/components/Button.tsx",
      args: {
        appearance: "primary",
        children: "Continue",
        size: "small"
      },
      argTypes: {
        appearance: {
          options: ["primary", "secondary"]
        }
      }
    }),
    createCatalogEntry({
      id: "textfield--default",
      title: "Components/TextField",
      name: "Default",
      familyId: "family-textfield",
      componentPath: "./src/components/TextField.tsx",
      args: {
        error: true,
        label: "Email",
        slotProps: { input: { endAdornment: "mail" } },
        variant: "outlined"
      }
    }),
    createCatalogEntry({
      id: "select--default",
      title: "Components/Select",
      name: "Default",
      familyId: "family-select",
      componentPath: "./src/components/Select.tsx",
      args: {
        children: "Option A",
        orientation: "horizontal"
      },
      argTypes: {
        orientation: {
          options: ["horizontal", "vertical"]
        }
      }
    }),
    createCatalogEntry({
      id: "datepicker--default",
      title: "Components/DatePicker",
      name: "Default",
      familyId: "family-datepicker",
      componentPath: "./src/components/DatePicker.tsx",
      args: {
        label: "Birthday",
        slotProps: { textField: { helperText: "Pick a date" } }
      }
    }),
    createCatalogEntry({
      id: "accordion--default",
      title: "Components/Accordion",
      name: "Default",
      familyId: "family-accordion",
      componentPath: "./src/components/Accordion.tsx",
      args: {
        expanded: true
      }
    }),
    createCatalogEntry({
      id: "icon--default",
      title: "Components/Icon",
      name: "Default",
      familyId: "family-icon",
      componentPath: "./src/components/Icon.tsx",
      args: {
        color: "primary"
      },
      argTypes: {
        fontSize: {
          options: ["small", "medium"]
        }
      }
    }),
    createCatalogEntry({
      id: "typography--default",
      title: "Components/Typography",
      name: "Default",
      familyId: "family-typography",
      componentPath: "./src/components/Typography.tsx",
      args: {
        children: "Heading",
        variant: "h1"
      }
    })
  ];
  const families = [
    createCatalogFamily({
      id: "family-button",
      title: "Components/Button",
      name: "Button",
      entryIds: ["button--primary"],
      storyEntryIds: ["button--primary"],
      componentPath: "./src/components/Button.tsx",
      propKeys: ["appearance", "children", "size"]
    }),
    createCatalogFamily({
      id: "family-textfield",
      title: "Components/TextField",
      name: "TextField",
      entryIds: ["textfield--default"],
      storyEntryIds: ["textfield--default"],
      componentPath: "./src/components/TextField.tsx",
      propKeys: ["error", "label", "slotProps", "variant"]
    }),
    createCatalogFamily({
      id: "family-select",
      title: "Components/Select",
      name: "Select",
      entryIds: ["select--default"],
      storyEntryIds: ["select--default"],
      componentPath: "./src/components/Select.tsx",
      propKeys: ["children", "orientation"]
    }),
    createCatalogFamily({
      id: "family-datepicker",
      title: "Components/DatePicker",
      name: "DatePicker",
      entryIds: ["datepicker--default"],
      storyEntryIds: ["datepicker--default"],
      componentPath: "./src/components/DatePicker.tsx",
      propKeys: ["label"]
    }),
    createCatalogFamily({
      id: "family-accordion",
      title: "Components/Accordion",
      name: "Accordion",
      entryIds: ["accordion--default"],
      storyEntryIds: ["accordion--default"],
      componentPath: "./src/components/Accordion.tsx",
      propKeys: ["expanded"]
    }),
    createCatalogFamily({
      id: "family-icon",
      title: "Components/Icon",
      name: "Icon",
      entryIds: ["icon--default"],
      storyEntryIds: ["icon--default"],
      componentPath: "./src/components/Icon.tsx",
      propKeys: ["color", "fontSize"]
    }),
    createCatalogFamily({
      id: "family-typography",
      title: "Components/Typography",
      name: "Typography",
      entryIds: ["typography--default"],
      storyEntryIds: ["typography--default"],
      componentPath: "./src/components/Typography.tsx",
      propKeys: ["children", "variant"]
    })
  ];
  const customerProfile = createCustomerProfileForComponentMatchTests({
    imports: {
      Button: {
        family: "Components",
        package: "@customer/components",
        export: "PrimaryButton",
        importAlias: "CustomerButton",
        propMappings: {
          variant: "appearance"
        }
      },
      TextField: {
        family: "Components",
        package: "@customer/forms",
        export: "CustomerTextField"
      },
      Select: {
        family: "Components",
        package: "@customer/forms",
        export: "CustomerSelect"
      },
      DatePicker: {
        family: "Components",
        package: "@customer/forms",
        export: "CustomerDatePicker"
      },
      Accordion: {
        family: "Components",
        package: "@customer/content",
        export: "CustomerAccordion"
      },
      Icon: {
        family: "Components",
        package: "@customer/icons",
        export: "CustomerIcon"
      },
      Typography: {
        family: "Components",
        package: "@customer/typography",
        export: "CustomerTypography"
      }
    }
  });

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact: createCatalogArtifact({ entries, families }),
    evidenceArtifact: createEvidenceArtifact({ evidence: [] }),
    componentsArtifact: createComponentsArtifact({
      components: families
        .filter((family): family is StorybookCatalogFamily & { componentPath: string } => typeof family.componentPath === "string")
        .map((family) => ({
          name: family.name,
          title: family.title,
          componentPath: family.componentPath,
          propKeys: family.propKeys
        }))
    }),
    resolvedCustomerProfile: customerProfile,
    resolvedStorybookTheme: createResolvedStorybookThemeFixture()
  });

  const buttonEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Button");
  assert.equal(buttonEntry?.resolvedApi?.status, "resolved");
  assert.equal(buttonEntry?.resolvedProps?.status, "resolved");
  assert.deepEqual(buttonEntry?.resolvedProps?.omittedDefaults, [
    {
      source: "storybook_theme_defaultProps",
      sourceProp: "size",
      targetProp: "size",
      value: "small"
    }
  ]);
  assert.equal(buttonEntry?.resolvedApi?.allowedProps.some((prop) => prop.name === "appearance"), true);

  const textFieldEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "TextField");
  assert.equal(textFieldEntry?.resolvedProps?.codegenCompatible, true);
  assert.equal(textFieldEntry?.resolvedProps?.slots.policy, "supported");

  const selectEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Select");
  assert.equal(selectEntry?.resolvedProps?.codegenCompatible, true);

  const datePickerEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "DatePicker");
  assert.notEqual(datePickerEntry, undefined);
  assert.equal(datePickerEntry?.match.status, "matched");
  assert.equal(datePickerEntry?.match.confidence, "low");

  const accordionEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Accordion");
  assert.notEqual(accordionEntry, undefined);
  assert.equal(accordionEntry?.match.status, "matched");

  const iconEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Icon");
  assert.equal(iconEntry?.resolvedProps?.codegenCompatible, true);

  const typographyEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Typography");
  assert.equal(typographyEntry?.resolvedProps?.codegenCompatible, true);
  assert.equal(typographyEntry?.resolvedProps?.children.policy, "supported");
  assert.equal(typographyEntry?.match.status, "matched");
  assert.equal(typographyEntry?.match.confidence !== "none", true);
});

test("buildComponentMatchReportArtifact uses customer profile tierPriority as tiebreaker when candidate scores are identical", () => {
  const figmaAnalysis = createFigmaAnalysis({
    componentFamilies: [
      createFigmaFamily({
        familyKey: "card-family",
        familyName: "Card"
      })
    ]
  });
  const entries = [
    createCatalogEntry({
      id: "reactui-card--default",
      title: "ReactUI/Card",
      name: "Default",
      familyId: "family-reactui-card",
      componentPath: "./src/reactui/Card.tsx"
    }),
    createCatalogEntry({
      id: "components-card--default",
      title: "Components/Card",
      name: "Default",
      familyId: "family-components-card",
      componentPath: "./src/components/Card.tsx"
    })
  ];
  const catalogArtifact = createCatalogArtifact({
    entries,
    families: [
      createCatalogFamily({
        id: "family-reactui-card",
        title: "ReactUI/Card",
        name: "Card",
        entryIds: ["reactui-card--default"],
        storyEntryIds: ["reactui-card--default"],
        componentPath: "./src/reactui/Card.tsx"
      }),
      createCatalogFamily({
        id: "family-components-card",
        title: "Components/Card",
        name: "Card",
        entryIds: ["components-card--default"],
        storyEntryIds: ["components-card--default"],
        componentPath: "./src/components/Card.tsx"
      })
    ]
  });
  const evidenceArtifact = createEvidenceArtifact({
    evidence: [
      createEvidenceItem({
        id: "ev-reactui-card-componentpath",
        type: "story_componentPath",
        entryId: "reactui-card--default"
      }),
      createEvidenceItem({
        id: "ev-components-card-componentpath",
        type: "story_componentPath",
        entryId: "components-card--default"
      })
    ]
  });
  const componentsArtifact = createComponentsArtifact({
    components: [
      { name: "Card", title: "ReactUI/Card", componentPath: "./src/reactui/Card.tsx", propKeys: [] },
      { name: "Card", title: "Components/Card", componentPath: "./src/components/Card.tsx", propKeys: [] }
    ]
  });
  const customerProfile = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [
        {
          id: "Components",
          tierPriority: 20,
          aliases: { figma: ["Components"], storybook: ["components"], code: ["@customer/components"] }
        },
        {
          id: "ReactUI",
          tierPriority: 5,
          aliases: { figma: ["ReactUI"], storybook: ["reactui"], code: ["@customer/react-ui"] }
        }
      ],
      brandMappings: [
        { id: "sparkasse", aliases: ["sparkasse"], brandTheme: "sparkasse", storybookThemes: { light: "sparkasse-light" } }
      ],
      imports: { components: {}, icons: {} },
      fallbacks: { mui: { defaultPolicy: "deny" }, icons: { defaultPolicy: "deny" } },
      template: { dependencies: {} },
      strictness: { match: "warn", token: "off", import: "error" }
    }
  });
  assert.notEqual(customerProfile, undefined);

  const artifact = buildComponentMatchReportArtifact({
    figmaAnalysis,
    catalogArtifact,
    evidenceArtifact,
    componentsArtifact,
    resolvedCustomerProfile: customerProfile!,
    resolvedStorybookTheme: createResolvedStorybookThemeFixture()
  });

  const cardEntry = artifact.entries.find((entry) => entry.figma.familyName === "Card");
  assert.notEqual(cardEntry, undefined);
  assert.equal(
    cardEntry?.storybookFamily?.tier,
    "ReactUI",
    "ReactUI (tierPriority 5) should win over Components (tierPriority 20) despite alphabetical order"
  );
  assert.equal(
    cardEntry?.fallbackReasons.includes("used_customer_profile_tier_priority_tiebreaker"),
    true,
    "Expected tier priority tiebreaker to be recorded in fallback reasons"
  );
  assert.equal(
    cardEntry?.fallbackReasons.includes("used_customer_profile_tier_priority"),
    true,
    "Expected tier priority score bonus to be recorded in fallback reasons"
  );
  assert.equal(
    cardEntry?.match.status,
    "matched",
    "Tier priority resolution should promote tied candidates to matched status"
  );
});
