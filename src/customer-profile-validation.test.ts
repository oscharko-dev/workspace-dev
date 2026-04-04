import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCustomerProfileConfig } from "./customer-profile.js";
import { applyCustomerProfileToTemplate } from "./customer-profile-template.js";
import {
  validateCustomerProfileComponentApiComponentMatchReport,
  validateCustomerProfileComponentMatchReport,
  validateGeneratedProjectCustomerProfile,
  validateGeneratedProjectStorybookStyles
} from "./customer-profile-validation.js";
import {
  STORYBOOK_PUBLIC_EXTENSION_KEY,
  type ComponentMatchReportArtifact,
  type ComponentMatchReportEntry,
  type StorybookEvidenceArtifact,
  type StorybookPublicThemesArtifact,
  type StorybookPublicTokensArtifact
} from "./storybook/types.js";

const createCustomerProfile = () => {
  const parsed = parseCustomerProfileConfig({
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
          storybookThemes: {
            light: "sparkasse-light",
            dark: "sparkasse-dark"
          }
        }
      ],
      imports: {
        components: {
          Button: {
            family: "Components",
            package: "@customer/components",
            export: "PrimaryButton",
            importAlias: "CustomerButton"
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
      template: {
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        importAliases: {
          "@customer/ui": "@customer/components"
        }
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!parsed) {
    throw new Error("Failed to create customer profile test fixture.");
  }
  return parsed;
};

const createCustomerProfileWithInput = (input: Record<string, unknown>) => {
  const parsed = parseCustomerProfileConfig({ input });
  if (!parsed) {
    throw new Error("Failed to create customer profile test fixture.");
  }
  return parsed;
};

const createCustomerProfileForStyleValidation = ({
  tokenPolicy = "error"
}: {
  tokenPolicy?: "off" | "warn" | "error";
} = {}) => {
  return createCustomerProfileWithInput({
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
        storybookThemes: {
          light: "sparkasse-light",
          dark: "sparkasse-dark"
        }
      }
    ],
    imports: {
      components: {
        Button: {
          family: "Components",
          package: "@customer/components",
          export: "PrimaryButton",
          importAlias: "CustomerButton"
        }
      }
    },
    fallbacks: {
      mui: {
        defaultPolicy: "deny"
      }
    },
    template: {
      dependencies: {
        "@customer/components": "^1.2.3"
      },
      importAliases: {}
    },
    strictness: {
      match: "warn",
      token: tokenPolicy,
      import: "off"
    }
  });
};

const seedGeneratedProject = async ({
  generatedProjectDir,
  sourceContent
}: {
  generatedProjectDir: string;
  sourceContent: string;
}): Promise<void> => {
  await mkdir(path.join(generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {},
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          moduleResolution: "bundler",
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(generatedProjectDir, "vite.config.ts"),
    `import { defineConfig } from "vitest/config";

const normalizedBasePath = "./";

export default defineConfig({
  base: normalizedBasePath,
  test: {
    globals: true
  }
});
`,
    "utf8"
  );
  await writeFile(path.join(generatedProjectDir, "src", "App.tsx"), sourceContent, "utf8");
};

const createStorybookEvidenceArtifactFixture = ({
  evidence
}: {
  evidence: StorybookEvidenceArtifact["evidence"];
}): StorybookEvidenceArtifact => {
  const byType = {
    story_componentPath: 0,
    story_argTypes: 0,
    story_args: 0,
    story_design_link: 0,
    theme_bundle: 0,
    css: 0,
    mdx_link: 0,
    docs_image: 0,
    docs_text: 0
  } satisfies StorybookEvidenceArtifact["stats"]["byType"];
  for (const item of evidence) {
    byType[item.type] += 1;
  }
  return {
    artifact: "storybook.evidence",
    version: 1,
    buildRoot: "/tmp/storybook-static",
    iframeBundlePath: "/tmp/storybook-static/iframe.html",
    stats: {
      entryCount: evidence.length,
      evidenceCount: evidence.length,
      byType,
      byReliability: {
        authoritative: evidence.filter((item) => item.reliability === "authoritative").length,
        reference_only: evidence.filter((item) => item.reliability === "reference_only").length,
        derived: evidence.filter((item) => item.reliability === "derived").length
      }
    },
    evidence
  };
};

const createStorybookTokensArtifactFixture = ({
  diagnostics = []
}: {
  diagnostics?: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
    themeId?: string;
    tokenPath?: string[];
  }>;
} = {}): StorybookPublicTokensArtifact => {
  return {
    $schema: "https://www.designtokens.org/TR/2025.10/format/",
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.tokens",
        version: 3,
        stats: {
          tokenCount: 0,
          themeCount: 1,
          byType: {
            color: 0,
            dimension: 0,
            fontFamily: 0,
            fontWeight: 0,
            number: 0,
            typography: 0
          },
          diagnosticCount: diagnostics.length,
          errorCount: diagnostics.filter((item) => item.severity === "error").length
        },
        diagnostics,
        themes: [
          {
            id: "sparkasse-light",
            name: "Sparkasse Light",
            context: "default",
            categories: [],
            tokenCount: 0
          }
        ],
        provenance: {}
      }
    }
  } as unknown as StorybookPublicTokensArtifact;
};

const createStorybookThemesArtifactFixture = ({
  diagnostics = []
}: {
  diagnostics?: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
    themeId?: string;
    tokenPath?: string[];
  }>;
} = {}): StorybookPublicThemesArtifact => {
  return {
    $schema: "https://www.designtokens.org/TR/2025.10/resolver/",
    name: "storybook.themes",
    version: "2025.10",
    sets: {
      "sparkasse-light": {
        sources: [{ $ref: "./tokens.json#/theme/sparkasse-light" }]
      }
    },
    modifiers: {
      theme: {
        default: "default",
        contexts: {
          default: [{ $ref: "#/sets/sparkasse-light" }]
        }
      }
    },
    resolutionOrder: [{ $ref: "#/modifiers/theme" }],
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.themes",
        version: 3,
        stats: {
          themeCount: 1,
          contextCount: 1,
          diagnosticCount: diagnostics.length,
          errorCount: diagnostics.filter((item) => item.severity === "error").length
        },
        diagnostics,
        themes: [
          {
            id: "sparkasse-light",
            name: "Sparkasse Light",
            context: "default",
            categories: [],
            tokenCount: 0
          }
        ],
        provenance: {}
      }
    }
  } as unknown as StorybookPublicThemesArtifact;
};

test("validateGeneratedProjectCustomerProfile fails when dependencies, aliases, and MUI fallback policy are violated", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-"));
  const customerProfile = createCustomerProfile();

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Button } from "@mui/material";
export const App = () => <Button>Continue</Button>;
`
    });

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.import.issueCount >= 3, true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_MUI_FALLBACK"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile returns warn when import policy is warn and src is absent", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-warn-"));
  const customerProfile = createCustomerProfileWithInput({
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
        storybookThemes: {
          light: "sparkasse-light",
          dark: "sparkasse-dark"
        }
      }
    ],
    imports: {
      components: {}
    },
    fallbacks: {
      mui: {
        defaultPolicy: "allow"
      }
    },
    template: {
      dependencies: {
        "@customer/components": "^1.2.3"
      },
      importAliases: {}
    },
    strictness: {
      match: "warn",
      token: "off",
      import: "warn"
    }
  });

  try {
    await writeFile(
      path.join(generatedProjectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {},
          devDependencies: {}
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(path.join(generatedProjectDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(path.join(generatedProjectDir, "vite.config.ts"), "export default {};\n", "utf8");

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "warn");
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile keeps status ok when import policy is off and project shapes are nonstandard", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-off-"));
  const customerProfile = createCustomerProfileWithInput({
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
        storybookThemes: {
          light: "sparkasse-light",
          dark: "sparkasse-dark"
        }
      }
    ],
    imports: {
      components: {
        Button: {
          family: "Components",
          package: "@customer/components",
          export: "PrimaryButton",
          importAlias: "CustomerButton"
        }
      }
    },
    fallbacks: {
      mui: {
        defaultPolicy: "deny"
      }
    },
    template: {
      dependencies: {
        "@customer/components": "^1.2.3"
      },
      devDependencies: {
        "@types/customer-components": "^1.0.0"
      },
      importAliases: {
        "@customer/ui": "@customer/components"
      }
    },
    strictness: {
      match: "warn",
      token: "off",
      import: "off"
    }
  });

  try {
    await mkdir(path.join(generatedProjectDir, "src", "nested"), { recursive: true });
    await writeFile(
      path.join(generatedProjectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: [],
          devDependencies: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "vite.config.ts"),
      `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  }
});
`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "src", "nested", "App.js"),
      `import { UnknownThing } from "@customer/ui";
export const App = () => UnknownThing;
`,
      "utf8"
    );
    await writeFile(path.join(generatedProjectDir, "src", "nested", "README.md"), "# ignored\n", "utf8");

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_IMPORT_EXPORT"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile passes after template profile adaptation and explicit allowed fallback", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-pass-"));
  const customerProfile = createCustomerProfile();

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Card } from "@mui/material";
import { PrimaryButton as CustomerButton } from "@customer/ui";
export const App = () => (
  <>
    <Card />
    <CustomerButton />
  </>
);
`
    });
    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.import.issueCount, 0);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

const createMatchReportEntry = (
  overrides: Partial<ComponentMatchReportEntry> & {
    familyKey: string;
    familyName: string;
    libraryResolution: ComponentMatchReportEntry["libraryResolution"];
  }
): ComponentMatchReportEntry => ({
  figma: {
    familyKey: overrides.familyKey,
    familyName: overrides.familyName,
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
  libraryResolution: overrides.libraryResolution,
  ...("iconResolution" in overrides ? { iconResolution: overrides.iconResolution } : {}),
  ...("storybookFamily" in overrides ? { storybookFamily: overrides.storybookFamily } : {}),
  ...("resolvedApi" in overrides ? { resolvedApi: overrides.resolvedApi } : {}),
  ...("resolvedProps" in overrides ? { resolvedProps: overrides.resolvedProps } : {})
});

const createMatchReportArtifact = (entries: ComponentMatchReportEntry[]): ComponentMatchReportArtifact => ({
  artifact: "component.match_report",
  version: 1,
  summary: {
    totalFigmaFamilies: entries.length,
    storybookFamilyCount: entries.length,
    storybookEntryCount: entries.length,
    matched: entries.length,
    ambiguous: 0,
    unmatched: 0,
    libraryResolution: {
      byStatus: {
        resolved_import: entries.filter((e) => e.libraryResolution.status === "resolved_import").length,
        mui_fallback_allowed: entries.filter((e) => e.libraryResolution.status === "mui_fallback_allowed").length,
        mui_fallback_denied: entries.filter((e) => e.libraryResolution.status === "mui_fallback_denied").length,
        not_applicable: entries.filter((e) => e.libraryResolution.status === "not_applicable").length
      },
      byReason: {
        profile_import_resolved: entries.filter((e) => e.libraryResolution.reason === "profile_import_resolved").length,
        profile_import_missing: entries.filter((e) => e.libraryResolution.reason === "profile_import_missing").length,
        profile_import_family_mismatch: entries.filter((e) => e.libraryResolution.reason === "profile_import_family_mismatch").length,
        profile_family_unresolved: entries.filter((e) => e.libraryResolution.reason === "profile_family_unresolved").length,
        match_ambiguous: entries.filter((e) => e.libraryResolution.reason === "match_ambiguous").length,
        match_unmatched: entries.filter((e) => e.libraryResolution.reason === "match_unmatched").length
      }
    },
    iconResolution: {
      byStatus: {
        resolved_import: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.status === "resolved_import").length,
        wrapper_fallback_allowed: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.status === "wrapper_fallback_allowed").length,
        wrapper_fallback_denied: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.status === "wrapper_fallback_denied").length,
        unresolved: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.status === "unresolved").length,
        ambiguous: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.status === "ambiguous").length,
        not_applicable: entries.filter((entry) => !entry.iconResolution).length
      },
      byReason: {
        profile_icon_import_resolved: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "profile_icon_import_resolved").length,
        profile_icon_import_missing: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "profile_icon_import_missing").length,
        profile_icon_wrapper_allowed: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "profile_icon_wrapper_allowed").length,
        profile_icon_wrapper_denied: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "profile_icon_wrapper_denied").length,
        profile_icon_wrapper_missing: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "profile_icon_wrapper_missing").length,
        match_ambiguous: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "match_ambiguous").length,
        match_unmatched: entries.flatMap((entry) => Object.values(entry.iconResolution?.byKey ?? {})).filter((item) => item.reason === "match_unmatched").length,
        not_icon_family: entries.filter((entry) => !entry.iconResolution).length
      }
    }
  },
  entries
});

test("validateGeneratedProjectStorybookStyles fails when only reference-only Storybook evidence is available", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-reference-only-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { CustomerButton } from "@customer/components";

export const App = () => <CustomerButton>{"Weiter"}</CustomerButton>;
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "docs-image-1",
            type: "docs_image",
            reliability: "reference_only",
            source: {
              entryId: "button--docs",
              entryType: "docs",
              title: "Components/Button"
            },
            usage: {
              canDriveTokens: false,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: false,
              canProvideMatchHints: true
            },
            summary: {
              imagePath: "docs/button.png"
            }
          },
          {
            id: "docs-text-1",
            type: "docs_text",
            reliability: "reference_only",
            source: {
              entryId: "button--docs",
              entryType: "docs",
              title: "Components/Button"
            },
            usage: {
              canDriveTokens: false,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: false,
              canProvideMatchHints: true
            },
            summary: {
              text: "Use the red primary brand button."
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([
        createMatchReportEntry({
          familyKey: "button-primary",
          familyName: "Button",
          libraryResolution: {
            status: "resolved_import",
            reason: "profile_import_resolved",
            storybookTier: "Components",
            profileFamily: "Components",
            componentKey: "Button",
            import: {
              package: "@customer/components",
              exportName: "PrimaryButton",
              localName: "CustomerButton"
            }
          },
          resolvedApi: {
            status: "resolved",
            componentKey: "Button",
            import: {
              package: "@customer/components",
              exportName: "PrimaryButton",
              localName: "CustomerButton"
            },
            allowedProps: [{ name: "children", kind: "string" }],
            defaultProps: [],
            children: { policy: "supported" },
            slots: { policy: "not_used", props: [] },
            diagnostics: []
          },
          resolvedProps: {
            status: "resolved",
            fallbackPolicy: "deny",
            props: [],
            omittedProps: [],
            omittedDefaults: [],
            children: { policy: "supported" },
            slots: { policy: "not_used", props: [] },
            codegenCompatible: true,
            diagnostics: []
          }
        })
      ])
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.issues.some((issue) => issue.category === "missing_authoritative_styling_evidence"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "reference_only_styling_evidence"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles reports raw color, spacing, typography, and stylesheet output", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-raw-style-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "warn"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => (
  <Box
    sx={{
      color: "#ffffff",
      gap: "16px",
      fontSize: 16
    }}
  />
);
`
    });
    await mkdir(path.join(generatedProjectDir, "src", "styles"), { recursive: true });
    await writeFile(path.join(generatedProjectDir, "src", "styles", "generated.css"), ".root { color: red; }\n", "utf8");

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "story-args-1",
            type: "story_args",
            reliability: "authoritative",
            source: {
              entryId: "button--primary",
              entryType: "story",
              title: "Components/Button"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: true,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              keys: ["variant"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(summary.status, "warn");
    assert.equal(summary.issues.some((issue) => issue.category === "hard_coded_color_literal"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "raw_spacing_literal"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "raw_typography_declaration"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "forbidden_generated_stylesheet"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles resolves identifier-based sx objects and flags hard style literals", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-identifier-sx-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

const sharedSx = {
  color: "#ffffff",
  gap: "16px",
  fontFamily: "Arial"
} as const;

export const App = () => <Box sx={sharedSx} />;
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "story-args-1",
            type: "story_args",
            reliability: "authoritative",
            source: {
              entryId: "button--primary",
              entryType: "story",
              title: "Components/Button"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: true,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              keys: ["variant"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.issues.some((issue) => issue.category === "hard_coded_color_literal"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "raw_spacing_literal"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "raw_typography_declaration"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles fails when Storybook artifacts exist but component.match_report is missing", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-missing-match-report-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => <Box sx={{ color: "#ffffff" }} />;
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture()
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.issues.some((issue) => issue.category === "missing_component_match_report"), true);
    assert.equal(summary.issues.some((issue) => issue.category === "hard_coded_color_literal"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles rejects inline style objects", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-inline-style-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `export const App = () => <div style={{ color: "#fff" }} />;
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.issues.some((issue) => issue.category === "forbidden_inline_style"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles detects named CSS colors as hard-coded color literals", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-named-color-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => (
  <Box sx={{ color: "orange", backgroundColor: "pink" }} />
);
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(summary.status, "failed");
    assert.equal(
      summary.issues.filter((issue) => issue.category === "hard_coded_color_literal").length,
      2,
      "Expected two hard-coded named color violations (orange and pink)"
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles allows Storybook-derived theme outputs", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-theme-output-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `export const App = () => null;
`
    });
    await mkdir(path.join(generatedProjectDir, "src", "theme"), { recursive: true });
    await writeFile(
      path.join(generatedProjectDir, "src", "theme", "theme.ts"),
      `export const theme = {
  palette: {
    primary: {
      main: "#dd0000"
    }
  },
  typography: {
    fontFamily: "Brand Sans",
    fontSize: 16
  }
};
`,
      "utf8"
    );
    await writeFile(path.join(generatedProjectDir, "src", "theme", "tokens.json"), "{\n  \"theme\": {}\n}\n", "utf8");

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.issueCount, 0);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles flags disallowed customer component props including sx", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-customer-props-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { CustomerButton } from "@customer/components";

export const App = () => (
  <CustomerButton appearance={"primary"} sx={{ color: "#fff" }}>
    {"Weiter"}
  </CustomerButton>
);
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "story-args-1",
            type: "story_args",
            reliability: "authoritative",
            source: {
              entryId: "button--primary",
              entryType: "story",
              title: "Components/Button"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: true,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              keys: ["appearance"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([
        createMatchReportEntry({
          familyKey: "button-primary",
          familyName: "Button",
          libraryResolution: {
            status: "resolved_import",
            reason: "profile_import_resolved",
            storybookTier: "Components",
            profileFamily: "Components",
            componentKey: "Button",
            import: {
              package: "@customer/components",
              exportName: "PrimaryButton",
              localName: "CustomerButton"
            }
          },
          resolvedApi: {
            status: "resolved",
            componentKey: "Button",
            import: {
              package: "@customer/components",
              exportName: "PrimaryButton",
              localName: "CustomerButton"
            },
            allowedProps: [{ name: "children", kind: "string" }],
            defaultProps: [],
            children: { policy: "supported" },
            slots: { policy: "not_used", props: [] },
            diagnostics: []
          },
          resolvedProps: {
            status: "resolved",
            fallbackPolicy: "deny",
            props: [],
            omittedProps: [],
            omittedDefaults: [],
            children: { policy: "supported" },
            slots: { policy: "not_used", props: [] },
            codegenCompatible: true,
            diagnostics: []
          }
        })
      ])
    });

    assert.equal(summary.status, "failed");
    assert.equal(
      summary.issues.some(
        (issue) => issue.category === "disallowed_customer_component_prop" && issue.propName === "appearance"
      ),
      true
    );
    assert.equal(
      summary.issues.some((issue) => issue.category === "disallowed_customer_component_prop" && issue.propName === "sx"),
      true
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles respects token strictness off, warn, and error", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-token-policy-"));

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => <Box sx={{ color: "#ffffff" }} />;
`
    });

    const evidenceArtifact = createStorybookEvidenceArtifactFixture({
      evidence: [
        {
          id: "theme-bundle-1",
          type: "theme_bundle",
          reliability: "authoritative",
          source: {
            bundlePath: "storybook/theme-bundle.js"
          },
          usage: {
            canDriveTokens: true,
            canDriveProps: false,
            canDriveImports: false,
            canDriveStyling: true,
            canProvideMatchHints: true
          },
          summary: {
            themeMarkers: ["createTheme"]
          }
        }
      ]
    });
    const tokensArtifact = createStorybookTokensArtifactFixture({
      diagnostics: [
        {
          severity: "warning",
          code: "STORYBOOK_THEME_GAP",
          message: "Theme gap detected for primary palette."
        }
      ]
    });
    const themesArtifact = createStorybookThemesArtifactFixture();

    const offSummary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile: createCustomerProfileForStyleValidation({ tokenPolicy: "off" }),
      storybookEvidenceArtifact: evidenceArtifact,
      storybookTokensArtifact: tokensArtifact,
      storybookThemesArtifact: themesArtifact,
      componentMatchReportArtifact: createMatchReportArtifact([])
    });
    const warnSummary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile: createCustomerProfileForStyleValidation({ tokenPolicy: "warn" }),
      storybookEvidenceArtifact: evidenceArtifact,
      storybookTokensArtifact: tokensArtifact,
      storybookThemesArtifact: themesArtifact,
      componentMatchReportArtifact: createMatchReportArtifact([])
    });
    const errorSummary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile: createCustomerProfileForStyleValidation({ tokenPolicy: "error" }),
      storybookEvidenceArtifact: evidenceArtifact,
      storybookTokensArtifact: tokensArtifact,
      storybookThemesArtifact: themesArtifact,
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    assert.equal(offSummary.issueCount > 0, true);
    assert.equal(offSummary.status, "ok");
    assert.equal(warnSummary.status, "warn");
    assert.equal(errorSummary.status, "failed");
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles allows explicit theme/token typography references", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-typo-string-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => (
  <Box
    sx={{
      fontFamily: "theme.typography.body1.fontFamily",
      fontSize: "theme.typography.body1.fontSize",
      fontWeight: "theme.typography.body1.fontWeight",
      lineHeight: "inherit"
    }}
  />
);
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    const typographyIssues = summary.issues.filter(
      (issue) => issue.category === "raw_typography_declaration"
    );
    assert.equal(
      typographyIssues.length,
      0,
      "Theme/token typography references must not be flagged as raw typography declarations"
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles flags raw typography string literals", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-typo-string-raw-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => (
  <Box
    sx={{
      fontFamily: "Arial",
      fontWeight: "bold"
    }}
  />
);
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    const typographyIssues = summary.issues.filter(
      (issue) => issue.category === "raw_typography_declaration"
    );
    assert.ok(
      typographyIssues.length >= 2,
      `Expected at least 2 raw typography issues (fontFamily/fontWeight), got ${typographyIssues.length}`
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles flags raw numeric typography literals", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-typo-numeric-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Box } from "@mui/material";

export const App = () => (
  <Box
    sx={{
      fontSize: 16,
      fontWeight: "400",
      lineHeight: "1.5"
    }}
  />
);
`
    });

    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      storybookEvidenceArtifact: createStorybookEvidenceArtifactFixture({
        evidence: [
          {
            id: "theme-bundle-1",
            type: "theme_bundle",
            reliability: "authoritative",
            source: {
              bundlePath: "storybook/theme-bundle.js"
            },
            usage: {
              canDriveTokens: true,
              canDriveProps: false,
              canDriveImports: false,
              canDriveStyling: true,
              canProvideMatchHints: true
            },
            summary: {
              themeMarkers: ["createTheme"]
            }
          }
        ]
      }),
      storybookTokensArtifact: createStorybookTokensArtifactFixture(),
      storybookThemesArtifact: createStorybookThemesArtifactFixture(),
      componentMatchReportArtifact: createMatchReportArtifact([])
    });

    const typographyIssues = summary.issues.filter(
      (issue) => issue.category === "raw_typography_declaration"
    );
    assert.ok(
      typographyIssues.length >= 3,
      `Expected at least 3 raw typography issues (fontSize: 16, fontWeight: "400", lineHeight: "1.5"), got ${typographyIssues.length}`
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateCustomerProfileComponentMatchReport returns ok when all entries are resolved_import", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "button-primary",
      familyName: "Button",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Button"
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "ok");
  assert.equal(result.issueCount, 0);
  assert.equal(result.counts.byStatus.resolved_import, 1);
});

test("validateCustomerProfileComponentMatchReport returns warn for issues when match policy is warn", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "dialog-primary",
      familyName: "Dialog",
      libraryResolution: {
        status: "mui_fallback_denied",
        reason: "profile_import_missing",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Dialog"
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "warn");
  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.reason, "profile_import_missing");
  assert.equal(result.issues[0]?.message.includes("Dialog"), true);
  assert.equal(result.counts.byStatus.mui_fallback_denied, 1);
  assert.equal(result.counts.byReason.profile_import_missing, 1);
});

test("validateCustomerProfileComponentMatchReport aggregates icon outcomes separately and reports unresolved icons", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "icon-search",
      familyName: "Icon",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Button"
      },
      iconResolution: {
        assetKind: "icon",
        iconKeys: ["search"],
        byKey: {
          search: {
            iconKey: "search",
            status: "wrapper_fallback_denied",
            reason: "profile_icon_wrapper_denied"
          }
        },
        counts: {
          exactImportResolved: 0,
          wrapperFallbackAllowed: 0,
          wrapperFallbackDenied: 1,
          unresolved: 0,
          ambiguous: 0
        }
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "warn");
  assert.equal(result.counts.iconByStatus.wrapper_fallback_denied, 1);
  assert.equal(result.counts.iconByReason.profile_icon_wrapper_denied, 1);
  assert.equal(result.issues.some((issue) => issue.kind === "icon" && issue.iconKey === "search"), true);
});

test("validateCustomerProfileComponentMatchReport includes unresolved ic_* icon outcomes in issue summary", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "ic-mail-family",
      familyName: "ic_mail",
      libraryResolution: {
        status: "not_applicable",
        reason: "match_unmatched"
      },
      iconResolution: {
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
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "warn");
  assert.equal(result.counts.iconByStatus.unresolved, 1);
  assert.equal(result.counts.iconByReason.match_unmatched, 1);
  assert.equal(
    result.issues.some((issue) => issue.kind === "icon" && issue.iconKey === "mail" && issue.reason === "match_unmatched"),
    true
  );
});

test("validateCustomerProfileComponentMatchReport returns failed when match policy is error", () => {
  const customerProfile = createCustomerProfileWithInput({
    version: 1,
    families: [
      {
        id: "Components",
        tierPriority: 10,
        aliases: { figma: ["Components"], storybook: ["components"], code: ["@customer/components"] }
      }
    ],
    brandMappings: [
      { id: "sparkasse", aliases: ["sparkasse"], brandTheme: "sparkasse", storybookThemes: { light: "sparkasse-light" } }
    ],
    imports: { components: {} },
    fallbacks: { mui: { defaultPolicy: "deny" } },
    template: { dependencies: {} },
    strictness: { match: "error", token: "off", import: "off" }
  });
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "unknown-component",
      familyName: "Unknown",
      libraryResolution: {
        status: "not_applicable",
        reason: "match_unmatched"
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "failed");
  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.reason, "match_unmatched");
});

test("validateCustomerProfileComponentMatchReport skips resolved_import and mui_fallback_allowed entries", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "button-primary",
      familyName: "Button",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Button"
      }
    }),
    createMatchReportEntry({
      familyKey: "card-primary",
      familyName: "Card",
      libraryResolution: {
        status: "mui_fallback_allowed",
        reason: "profile_family_unresolved",
        storybookTier: "Unknown",
        componentKey: "Card"
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.status, "ok");
  assert.equal(result.issueCount, 0);
  assert.equal(result.counts.byStatus.resolved_import, 1);
  assert.equal(result.counts.byStatus.mui_fallback_allowed, 1);
});

test("validateCustomerProfileComponentMatchReport reports all issue reasons with sorted output", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "z-widget",
      familyName: "ZWidget",
      libraryResolution: {
        status: "not_applicable",
        reason: "match_ambiguous",
        storybookTier: "Components",
        componentKey: "ZWidget"
      }
    }),
    createMatchReportEntry({
      familyKey: "a-dialog",
      familyName: "ADialog",
      libraryResolution: {
        status: "mui_fallback_denied",
        reason: "profile_import_family_mismatch",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "ADialog"
      }
    })
  ]);

  const result = validateCustomerProfileComponentMatchReport({ artifact, customerProfile });
  assert.equal(result.issueCount, 2);
  assert.equal(result.issues[0]?.figmaFamilyName, "ADialog");
  assert.equal(result.issues[1]?.figmaFamilyName, "ZWidget");
  assert.equal(result.issues[0]?.reason, "profile_import_family_mismatch");
  assert.equal(result.issues[1]?.reason, "match_ambiguous");
});

test("validateCustomerProfileComponentApiComponentMatchReport warns when fallback-allowed contracts are incompatible", () => {
  const customerProfile = createCustomerProfileWithInput({
    version: 1,
    families: [
      {
        id: "Components",
        tierPriority: 10,
        aliases: { figma: ["Components"], storybook: ["components"], code: ["@customer/components"] }
      }
    ],
    brandMappings: [
      { id: "sparkasse", aliases: ["sparkasse"], brandTheme: "sparkasse", storybookThemes: { light: "sparkasse-light" } }
    ],
    imports: {
      components: {
        DatePicker: {
          family: "Components",
          package: "@customer/forms",
          export: "CustomerDatePicker"
        }
      }
    },
    fallbacks: { mui: { defaultPolicy: "deny", components: { DatePicker: "allow" } } },
    template: { dependencies: {} },
    strictness: { match: "warn", token: "off", import: "off" }
  });
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "datepicker-default",
      familyName: "DatePicker",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "DatePicker",
        import: {
          package: "@customer/forms",
          exportName: "CustomerDatePicker",
          localName: "CustomerDatePicker"
        }
      },
      resolvedApi: {
        status: "resolved",
        componentKey: "DatePicker",
        import: {
          package: "@customer/forms",
          exportName: "CustomerDatePicker",
          localName: "CustomerDatePicker"
        },
        allowedProps: [{ name: "label", kind: "string" }],
        defaultProps: [],
        children: { policy: "not_used" },
        slots: { policy: "unsupported", props: ["slotProps"] },
        diagnostics: [
          {
            severity: "warning",
            code: "component_api_slot_unsupported",
            message: "Resolved component 'DatePicker' does not expose 'slotProps'.",
            sourceProp: "slotProps",
            targetProp: "slotProps"
          }
        ]
      },
      resolvedProps: {
        status: "incompatible",
        fallbackPolicy: "allow",
        props: [],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "not_used" },
        slots: { policy: "unsupported", props: ["slotProps"] },
        codegenCompatible: false,
        diagnostics: [
          {
            severity: "warning",
            code: "component_api_slot_unsupported",
            message: "Resolved component 'DatePicker' does not expose 'slotProps'.",
            sourceProp: "slotProps",
            targetProp: "slotProps"
          }
        ]
      }
    })
  ]);

  const result = validateCustomerProfileComponentApiComponentMatchReport({
    artifact,
    customerProfile
  });

  assert.equal(result.status, "warn");
  assert.equal(result.issueCount, 1);
  assert.equal(result.counts.byReason.component_api_slot_unsupported, 1);
  assert.equal(result.issues[0]?.severity, "warning");
});

test("validateCustomerProfileComponentApiComponentMatchReport fails when incompatible contracts deny fallback or signatures conflict", () => {
  const customerProfile = createCustomerProfile();
  const artifact = createMatchReportArtifact([
    createMatchReportEntry({
      familyKey: "button-primary",
      familyName: "Button",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Button",
        import: {
          package: "@customer/components",
          exportName: "PrimaryButton",
          localName: "CustomerButton"
        }
      },
      resolvedApi: {
        status: "resolved",
        componentKey: "Button",
        import: {
          package: "@customer/components",
          exportName: "PrimaryButton",
          localName: "CustomerButton"
        },
        allowedProps: [{ name: "children", kind: "string" }],
        defaultProps: [],
        children: { policy: "unsupported" },
        slots: { policy: "not_used", props: [] },
        diagnostics: [
          {
            severity: "error",
            code: "component_api_children_unsupported",
            message: "Resolved component 'Button' does not expose 'children'.",
            targetProp: "children"
          }
        ]
      },
      resolvedProps: {
        status: "incompatible",
        fallbackPolicy: "deny",
        props: [],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "unsupported" },
        slots: { policy: "not_used", props: [] },
        codegenCompatible: false,
        diagnostics: [
          {
            severity: "error",
            code: "component_api_children_unsupported",
            message: "Resolved component 'Button' does not expose 'children'.",
            targetProp: "children"
          }
        ]
      }
    }),
    createMatchReportEntry({
      familyKey: "button-secondary",
      familyName: "Button",
      libraryResolution: {
        status: "resolved_import",
        reason: "profile_import_resolved",
        storybookTier: "Components",
        profileFamily: "Components",
        componentKey: "Button",
        import: {
          package: "@customer/components",
          exportName: "PrimaryButton",
          localName: "CustomerButton"
        }
      },
      resolvedApi: {
        status: "resolved",
        componentKey: "Button",
        import: {
          package: "@customer/components",
          exportName: "PrimaryButton",
          localName: "CustomerButton"
        },
        allowedProps: [{ name: "appearance", kind: "enum", allowedValues: ["primary"] }],
        defaultProps: [],
        children: { policy: "supported" },
        slots: { policy: "not_used", props: [] },
        diagnostics: []
      },
      resolvedProps: {
        status: "resolved",
        fallbackPolicy: "deny",
        props: [{ sourceProp: "variant", targetProp: "appearance", kind: "enum", values: ["primary"] }],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "supported" },
        slots: { policy: "not_used", props: [] },
        codegenCompatible: true,
        diagnostics: []
      }
    })
  ]);

  const result = validateCustomerProfileComponentApiComponentMatchReport({
    artifact,
    customerProfile
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issueCount >= 2, true);
  assert.equal(result.counts.byReason.component_api_children_unsupported, 1);
  assert.equal(result.counts.byReason.component_api_signature_conflict, 1);
});

test("validateGeneratedProjectStorybookStyles populates diagnostics when isStorybookFirstRequested and artifacts are missing", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-missing-artifacts-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      isStorybookFirstRequested: true
    });

    assert.equal(summary.status, "not_available");
    assert.equal(summary.issueCount, 0);
    assert.equal(summary.diagnostics.tokens.diagnosticCount, 3);
    assert.equal(summary.diagnostics.tokens.diagnostics.length, 3);
    assert.equal(
      summary.diagnostics.tokens.diagnostics.every((d) => d.code === "STORYBOOK_STYLE_ARTIFACT_MISSING"),
      true
    );
    assert.equal(
      summary.diagnostics.tokens.diagnostics.every((d) => d.severity === "warning"),
      true
    );
    assert.equal(
      summary.diagnostics.tokens.diagnostics.some((d) => d.message.includes("evidence")),
      true
    );
    assert.equal(
      summary.diagnostics.tokens.diagnostics.some((d) => d.message.includes("tokens")),
      true
    );
    assert.equal(
      summary.diagnostics.tokens.diagnostics.some((d) => d.message.includes("themes")),
      true
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectStorybookStyles returns empty diagnostics when isStorybookFirstRequested is false and artifacts are missing", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-style-validation-not-requested-"));
  const customerProfile = createCustomerProfileForStyleValidation({
    tokenPolicy: "error"
  });

  try {
    const summary = await validateGeneratedProjectStorybookStyles({
      generatedProjectDir,
      customerProfile,
      isStorybookFirstRequested: false
    });

    assert.equal(summary.status, "not_available");
    assert.equal(summary.issueCount, 0);
    assert.equal(summary.diagnostics.tokens.diagnosticCount, 0);
    assert.equal(summary.diagnostics.tokens.diagnostics.length, 0);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
