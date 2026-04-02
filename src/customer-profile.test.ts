import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectCustomerProfileImportIssuesFromSource,
  getCustomerProfileFamiliesByPriority,
  isCustomerProfileMuiFallbackAllowed,
  loadCustomerProfileConfigFile,
  parseCustomerProfileConfig,
  resolveCustomerProfileBrandMapping,
  resolveCustomerProfileComponentImport,
  resolveCustomerProfileFamily,
  safeParseCustomerProfileConfig,
  toCustomerProfileConfigSnapshot,
  toCustomerProfileDesignSystemConfigFromComponentMatchReport,
  toCustomerProfileDesignSystemConfig
} from "./customer-profile.js";
import type { ComponentMatchReportArtifact } from "./storybook/types.js";

const createRawCustomerProfile = () => ({
  version: 1,
  families: [
    {
      id: "ReactUI",
      tierPriority: 20,
      aliases: {
        figma: [" React UI "],
        storybook: ["React-UI"],
        code: ["@customer/react-ui"]
      }
    },
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
      aliases: [" Sparkasse ", "SK"],
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
        importAlias: "CustomerButton",
        propMappings: {
          variant: "appearance"
        }
      },
      Card: {
        family: "ReactUI",
        package: "@customer/react-ui",
        export: "ContentCard"
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
    import: "error"
  }
});

const createResolvedApiFixture = ({
  componentKey,
  importEntry,
  allowedProps,
  defaultProps = [],
  childrenPolicy = "supported",
  slotPolicy = "not_used",
}: {
  componentKey: string;
  importEntry: {
    package: string;
    exportName: string;
    localName: string;
    propMappings?: Record<string, string>;
  };
  allowedProps: Array<{
    name: string;
    kind: "enum" | "boolean" | "string" | "number" | "object" | "unknown";
    allowedValues?: Array<boolean | number | string>;
  }>;
  defaultProps?: Array<{
    name: string;
    value: boolean | number | string;
    source: "storybook_theme_defaultProps";
  }>;
  childrenPolicy?: "supported" | "unsupported" | "not_used" | "unknown";
  slotPolicy?: "supported" | "unsupported" | "not_used";
}) => ({
  status: "resolved" as const,
  componentKey,
  import: importEntry,
  allowedProps,
  defaultProps,
  children: {
    policy: childrenPolicy
  },
  slots: {
    policy: slotPolicy,
    props: slotPolicy === "not_used" ? [] : ["slotProps"]
  },
  diagnostics: []
});

const createResolvedPropsFixture = ({
  props,
  omittedProps = [],
  omittedDefaults = [],
  fallbackPolicy = "deny",
  childrenPolicy = "supported",
  slotPolicy = "not_used",
  codegenCompatible = true,
  diagnostics = []
}: {
  props: Array<{
    sourceProp: string;
    targetProp: string;
    kind: "enum" | "boolean" | "string" | "number" | "object" | "unknown";
    values?: Array<boolean | number | string>;
  }>;
  omittedProps?: Array<{
    sourceProp: string;
    targetProp: string;
  }>;
  omittedDefaults?: Array<{
    sourceProp: string;
    targetProp: string;
    value: boolean | number | string;
    source: "storybook_theme_defaultProps";
  }>;
  fallbackPolicy?: "allow" | "deny";
  childrenPolicy?: "supported" | "unsupported" | "not_used" | "unknown";
  slotPolicy?: "supported" | "unsupported" | "not_used";
  codegenCompatible?: boolean;
  diagnostics?: Array<{
    severity: "warning" | "error";
    code: "component_api_children_unsupported" | "component_api_prop_unsupported" | "component_api_slot_unsupported";
    message: string;
    sourceProp?: string;
    targetProp?: string;
  }>;
}) => ({
  status: codegenCompatible ? ("resolved" as const) : ("incompatible" as const),
  fallbackPolicy,
  props,
  omittedProps,
  omittedDefaults,
  children: {
    policy: childrenPolicy
  },
  slots: {
    policy: slotPolicy,
    props: slotPolicy === "not_used" ? [] : ["slotProps"]
  },
  codegenCompatible,
  diagnostics
});

test("safeParseCustomerProfileConfig normalizes valid profile data and exposes resolvers", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const profile = parsed.config;
  assert.equal(getCustomerProfileFamiliesByPriority({ profile })[0]?.id, "Components");
  assert.equal(resolveCustomerProfileFamily({ profile, candidate: "react ui" })?.id, "ReactUI");
  assert.equal(resolveCustomerProfileBrandMapping({ profile, candidate: "sk" })?.brandTheme, "sparkasse");
  assert.equal(resolveCustomerProfileComponentImport({ profile, componentKey: "Button" })?.localName, "CustomerButton");
  assert.equal(isCustomerProfileMuiFallbackAllowed({ profile, componentKey: "Card" }), true);
  assert.equal(isCustomerProfileMuiFallbackAllowed({ profile, componentKey: "Button" }), false);

  assert.deepEqual(toCustomerProfileDesignSystemConfig({ profile }), {
    library: "__customer_profile__",
    mappings: {
      Button: {
        import: "@customer/components",
        export: "PrimaryButton",
        component: "CustomerButton",
        propMappings: {
          variant: "appearance"
        }
      },
      Card: {
        import: "@customer/react-ui",
        export: "ContentCard",
        component: "ContentCard"
      }
    }
  });
});

test("resolveCustomerProfileComponentImport supports family-gated resolution", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  assert.equal(
    resolveCustomerProfileComponentImport({
      profile: parsed.config,
      componentKey: "Button",
      familyId: "Components"
    })?.localName,
    "CustomerButton"
  );
  assert.equal(
    resolveCustomerProfileComponentImport({
      profile: parsed.config,
      componentKey: "Button",
      familyId: "ReactUI"
    }),
    undefined
  );
});

test("safeParseCustomerProfileConfig rejects duplicate aliases and duplicate import bindings", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      ...createRawCustomerProfile(),
      families: [
        {
          id: "Components",
          tierPriority: 10,
          aliases: {
            figma: ["shared"],
            storybook: [],
            code: []
          }
        },
        {
          id: "ReactUI",
          tierPriority: 20,
          aliases: {
            figma: ["shared"],
            storybook: [],
            code: []
          }
        }
      ],
      imports: {
        components: {
          Button: {
            family: "Components",
            package: "@customer/components",
            export: "PrimaryButton"
          },
          ButtonAlias: {
            family: "ReactUI",
            package: "@customer/components",
            export: "PrimaryButton"
          }
        }
      }
    }
  });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("Expected duplicate aliases and bindings to fail parsing.");
  }
  assert.equal(parsed.issues.some((issue) => issue.message.includes("already assigned")), true);
  assert.equal(parsed.issues.some((issue) => issue.message.includes("Import binding")), true);
});

test("safeParseCustomerProfileConfig rejects invalid section shapes", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      version: 1,
      families: {},
      brandMappings: {},
      imports: [],
      fallbacks: [],
      template: [],
      strictness: []
    }
  });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("Expected malformed section shapes to fail parsing.");
  }

  assert.equal(parsed.issues.some((issue) => issue.path === "families"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "brandMappings"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "imports"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "imports.components"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "fallbacks"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "fallbacks.mui"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "template"), true);
  assert.equal(parsed.issues.some((issue) => issue.path === "strictness"), true);
});

test("safeParseCustomerProfileConfig rejects malformed values across sections", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      version: 2,
      families: [
        123,
        {
          id: "",
          tierPriority: "high",
          aliases: null
        },
        {
          id: "Shared",
          tierPriority: 1,
          aliases: {
            figma: ["Shared", " shared ", ""],
            storybook: ["Story"],
            code: ["@customer/shared"]
          }
        }
      ],
      brandMappings: [
        456,
        {
          id: "",
          aliases: ["Story"],
          brandTheme: "unknown",
          storybookThemes: {
            light: ""
          }
        }
      ],
      imports: {
        components: {
          "bad key": 5,
          Button: {
            family: "Missing",
            package: "bad package!",
            export: "",
            importAlias: "123Invalid",
            propMappings: ["bad"]
          },
          Card: {
            family: "Shared",
            package: "@customer/shared",
            export: "SharedCard"
          }
        }
      },
      fallbacks: {
        mui: {
          defaultPolicy: "block",
          components: {
            "bad key": "allow",
            Card: "maybe"
          }
        }
      },
      template: {
        dependencies: {
          "bad package!": "^1.0.0",
          "@customer/shared": ""
        },
        devDependencies: [],
        importAliases: {
          "bad alias key": "123Invalid"
        }
      },
      strictness: {
        match: "loud",
        token: 123,
        import: "error"
      }
    }
  });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("Expected malformed customer profile values to fail parsing.");
  }

  const messages = parsed.issues.map((issue) => issue.message);
  assert.equal(messages.some((message) => message.includes("version must be 1")), true);
  assert.equal(messages.some((message) => message.includes("Family entry must be an object")), true);
  assert.equal(messages.some((message) => message.includes("Family id must match")), true);
  assert.equal(messages.some((message) => message.includes("tierPriority must be a finite integer")), true);
  assert.equal(messages.some((message) => message.includes("aliases must be an object")), true);
  assert.equal(messages.some((message) => message.includes("Aliases must be non-empty strings")), true);
  assert.equal(messages.some((message) => message.includes("Brand mapping entry must be an object")), true);
  assert.equal(messages.some((message) => message.includes("brandTheme must be one of")), true);
  assert.equal(messages.some((message) => message.includes("already assigned")), true);
  assert.equal(messages.some((message) => message.includes("Component key must be a valid identifier")), true);
  assert.equal(messages.some((message) => message.includes("Unknown family")), true);
  assert.equal(messages.some((message) => message.includes("package must be a valid package name")), true);
  assert.equal(messages.some((message) => message.includes("export must be a valid identifier")), true);
  assert.equal(messages.some((message) => message.includes("importAlias must be a valid identifier")), true);
  assert.equal(messages.some((message) => message.includes("Expected an object with string values")), true);
  assert.equal(messages.some((message) => message.includes("Fallback policy must be one of")), true);
  assert.equal(messages.some((message) => message.includes("Fallback component key must be a valid identifier")), true);
  assert.equal(messages.some((message) => message.includes("Dependency name must be a valid package name")), true);
  assert.equal(messages.some((message) => message.includes("Dependency version must be a non-empty string")), true);
  assert.equal(messages.some((message) => message.includes("Expected an object with dependency versions")), true);
  assert.equal(messages.some((message) => message.includes("Strictness must be one of")), true);
  assert.equal(messages.some((message) => message.includes("storybookThemes.light must be a non-empty string")), true);
});

test("safeParseCustomerProfileConfig requires explicit storybook theme mappings for each brand", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      ...createRawCustomerProfile(),
      brandMappings: [
        {
          id: "sparkasse",
          aliases: ["sparkasse"],
          brandTheme: "sparkasse"
        }
      ]
    }
  });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("Expected missing storybookThemes to fail parsing.");
  }
  assert.deepEqual(
    parsed.issues.filter((issue) => issue.path.startsWith("brandMappings[0].storybookThemes")).map((issue) => issue.path),
    ["brandMappings[0].storybookThemes", "brandMappings[0].storybookThemes.light"]
  );
});

test("loadCustomerProfileConfigFile returns undefined for missing and invalid files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-"));
  const missingPath = path.join(tempDir, "missing.json");
  const invalidPath = path.join(tempDir, "invalid.json");
  const logs: string[] = [];

  try {
    await writeFile(invalidPath, JSON.stringify({ version: 2 }), "utf8");

    assert.equal(
      await loadCustomerProfileConfigFile({
        customerProfileFilePath: missingPath,
        onLog: (message) => logs.push(message)
      }),
      undefined
    );
    assert.equal(
      await loadCustomerProfileConfigFile({
        customerProfileFilePath: invalidPath,
        onLog: (message) => logs.push(message)
      }),
      undefined
    );
    assert.equal(logs.some((entry) => entry.includes("is invalid")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("parseCustomerProfileConfig returns undefined for invalid input and helpers return undefined for unknown lookups", () => {
  assert.equal(parseCustomerProfileConfig({ input: null }), undefined);

  const parsed = parseCustomerProfileConfig({
    input: {
      ...createRawCustomerProfile(),
      imports: {
        components: {}
      }
    }
  });
  assert.notEqual(parsed, undefined);
  if (!parsed) {
    assert.fail("Expected profile without component imports to parse successfully.");
  }

  assert.equal(resolveCustomerProfileFamily({ profile: parsed, candidate: "missing family" }), undefined);
  assert.equal(resolveCustomerProfileBrandMapping({ profile: parsed, candidate: "missing brand" }), undefined);
  assert.equal(resolveCustomerProfileComponentImport({ profile: parsed, componentKey: "MissingComponent" }), undefined);
  assert.equal(toCustomerProfileDesignSystemConfig({ profile: parsed }), undefined);
});

test("loadCustomerProfileConfigFile loads valid profiles and logs malformed json errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-load-"));
  const validPath = path.join(tempDir, "valid.json");
  const malformedPath = path.join(tempDir, "malformed.json");
  const logs: string[] = [];

  try {
    await writeFile(validPath, JSON.stringify(createRawCustomerProfile()), "utf8");
    await writeFile(malformedPath, "{", "utf8");

    const loaded = await loadCustomerProfileConfigFile({
      customerProfileFilePath: validPath,
      onLog: (message) => logs.push(message)
    });
    const malformed = await loadCustomerProfileConfigFile({
      customerProfileFilePath: malformedPath,
      onLog: (message) => logs.push(message)
    });

    assert.notEqual(loaded, undefined);
    assert.equal(loaded?.strictness.import, "error");
    assert.equal(malformed, undefined);
    assert.equal(logs.some((entry) => entry.includes("Failed to load customer profile config")), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("toCustomerProfileConfigSnapshot round-trips resolved profiles through safeParseCustomerProfileConfig", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const reparsed = safeParseCustomerProfileConfig({
    input: toCustomerProfileConfigSnapshot({
      profile: parsed.config
    })
  });

  assert.equal(reparsed.success, true);
  if (!reparsed.success) {
    assert.fail("Expected serialized customer profile snapshot to parse successfully.");
  }
  assert.equal(reparsed.config.strictness.import, parsed.config.strictness.import);
  assert.equal(reparsed.config.imports.components.Button.package, parsed.config.imports.components.Button.package);
});

test("safeParseCustomerProfileConfig parses and snapshots explicit DatePicker provider metadata", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      ...createRawCustomerProfile(),
      template: {
        ...createRawCustomerProfile().template,
        providers: {
          datePicker: {
            package: "@customer/date-provider",
            export: "CustomerDatePickerProvider",
            importAlias: "DatePickerProvider",
            adapter: {
              package: "@customer/date-provider",
              export: "CustomerDateAdapter"
            },
            props: {
              adapterLocale: "de",
              disableFuture: true
            }
          }
        }
      }
    }
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected explicit DatePicker provider metadata to parse successfully.");
  }

  assert.deepEqual(parsed.config.template.providers.datePicker, {
    package: "@customer/date-provider",
    exportName: "CustomerDatePickerProvider",
    localName: "DatePickerProvider",
    adapter: {
      package: "@customer/date-provider",
      exportName: "CustomerDateAdapter",
      localName: "CustomerDateAdapter",
      propName: "dateAdapter"
    },
    props: {
      adapterLocale: "de",
      disableFuture: true
    }
  });

  const snapshot = toCustomerProfileConfigSnapshot({
    profile: parsed.config
  });
  assert.deepEqual(snapshot.template.providers, {
    datePicker: {
      package: "@customer/date-provider",
      export: "CustomerDatePickerProvider",
      importAlias: "DatePickerProvider",
      adapter: {
        package: "@customer/date-provider",
        export: "CustomerDateAdapter"
      },
      props: {
        adapterLocale: "de",
        disableFuture: true
      }
    }
  });
});

test("collectCustomerProfileImportIssuesFromSource reports disallowed MUI fallbacks and unknown exports", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const issues = collectCustomerProfileImportIssuesFromSource({
    content: `import { Button, Card } from "@mui/material";
import { UnknownThing } from "@customer/components";
import { PrimaryButton as CustomerButton } from "@customer/ui";
`,
    filePath: "src/screens/Profile.tsx",
    profile: parsed.config
  });

  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["E_CUSTOMER_PROFILE_MUI_FALLBACK", "E_CUSTOMER_PROFILE_IMPORT_EXPORT"]
  );
});

test("collectCustomerProfileImportIssuesFromSource ignores default imports, empty named clauses, and valid aliased specifiers", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const issues = collectCustomerProfileImportIssuesFromSource({
    content: `import CustomerComponents from "@customer/components";
import { type PrimaryButton as PrimaryButtonType, PrimaryButton as CustomerButton, Invalid-Specifier } from "@customer/ui";
import { } from "@mui/material";
import { useState } from "react";
`,
    filePath: "src/screens/Profile.tsx",
    profile: parsed.config
  });

  assert.deepEqual(issues, []);
});

test("safeParseCustomerProfileConfig rejects invalid import alias targets with descriptive messages", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: {
      ...createRawCustomerProfile(),
      template: {
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        importAliases: {
          "@customer/ui": "",
          "bad alias!": "@customer/components"
        }
      }
    }
  });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    assert.fail("Expected invalid import aliases to fail parsing.");
  }

  const messages = parsed.issues.map((issue) => issue.message);
  assert.equal(messages.some((message) => message.includes("Import alias target must be a valid non-empty package name")), true);
  assert.equal(messages.some((message) => message.includes("Import alias key must be a valid package name")), true);
  assert.equal(messages.every((message) => !message.includes("Dependency version")), true);
  assert.equal(messages.every((message) => !message.includes("Dependency name")), true);
});

test("collectCustomerProfileImportIssuesFromSource handles multiline imports correctly", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const issues = collectCustomerProfileImportIssuesFromSource({
    content: `import {
  Button,
  Card
} from "@mui/material";
`,
    filePath: "src/screens/Dashboard.tsx",
    profile: parsed.config
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "E_CUSTOMER_PROFILE_MUI_FALLBACK");
  assert.equal(issues[0]?.message.includes("Button"), true);
});

test("toCustomerProfileDesignSystemConfig includes propMappings only when non-empty", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  const config = toCustomerProfileDesignSystemConfig({ profile: parsed.config });
  assert.notEqual(config, undefined);
  if (!config) {
    assert.fail("Expected design system config to be defined.");
  }

  assert.notEqual(config.mappings.Button?.propMappings, undefined);
  assert.equal(config.mappings.Card?.propMappings, undefined);
});

test("toCustomerProfileDesignSystemConfigFromComponentMatchReport keeps only stable resolved imports", () => {
  const artifact: ComponentMatchReportArtifact = {
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: 4,
      storybookFamilyCount: 4,
      storybookEntryCount: 4,
      matched: 4,
      ambiguous: 0,
      unmatched: 0,
      libraryResolution: {
        byStatus: {
          resolved_import: 3,
          mui_fallback_allowed: 0,
          mui_fallback_denied: 0,
          not_applicable: 1
        },
        byReason: {
          profile_import_resolved: 3,
          profile_import_missing: 0,
          profile_import_family_mismatch: 0,
          profile_family_unresolved: 0,
          match_ambiguous: 1,
          match_unmatched: 0
        }
      }
    },
    entries: [
      {
        figma: {
          familyKey: "button-primary",
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
        },
        storybookFamily: {
          familyId: "family-button",
          title: "Components/Button",
          name: "Button",
          tier: "Components",
          storyCount: 1
        },
        storyVariant: {
          entryId: "button--primary",
          storyName: "Primary"
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "Button",
          importEntry: {
            package: "@customer/components",
            exportName: "PrimaryButton",
            localName: "CustomerButton",
            propMappings: {
              variant: "appearance"
            }
          },
          allowedProps: [
            {
              name: "appearance",
              kind: "enum",
              allowedValues: ["primary", "secondary"]
            },
            {
              name: "children",
              kind: "string"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [
            {
              sourceProp: "variant",
              targetProp: "appearance",
              kind: "enum",
              values: ["primary"]
            }
          ]
        })
      },
      {
        figma: {
          familyKey: "button-secondary",
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
        },
        storybookFamily: {
          familyId: "family-button",
          title: "Components/Button",
          name: "Button",
          tier: "Components",
          storyCount: 1
        },
        storyVariant: {
          entryId: "button--secondary",
          storyName: "Secondary"
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "Button",
          importEntry: {
            package: "@customer/components",
            exportName: "PrimaryButton",
            localName: "CustomerButton",
            propMappings: {
              variant: "appearance"
            }
          },
          allowedProps: [
            {
              name: "appearance",
              kind: "enum",
              allowedValues: ["primary", "secondary"]
            },
            {
              name: "children",
              kind: "string"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [
            {
              sourceProp: "variant",
              targetProp: "appearance",
              kind: "enum",
              values: ["secondary"]
            }
          ]
        })
      },
      {
        figma: {
          familyKey: "card-primary",
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
          status: "resolved_import",
          reason: "profile_import_resolved",
          storybookTier: "ReactUI",
          profileFamily: "ReactUI",
          componentKey: "Card",
          import: {
            package: "@customer/react-ui",
            exportName: "ContentCard",
            localName: "CustomerCard"
          }
        },
        storybookFamily: {
          familyId: "family-card",
          title: "ReactUI/Card",
          name: "Card",
          tier: "ReactUI",
          storyCount: 1
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "Card",
          importEntry: {
            package: "@customer/react-ui",
            exportName: "ContentCard",
            localName: "CustomerCard"
          },
          allowedProps: [
            {
              name: "children",
              kind: "string"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: []
        })
      },
      {
        figma: {
          familyKey: "card-secondary",
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
          status: "resolved_import",
          reason: "profile_import_resolved",
          storybookTier: "ReactUI",
          profileFamily: "ReactUI",
          componentKey: "Card",
          import: {
            package: "@customer/react-ui-v2",
            exportName: "ContentCard",
            localName: "CustomerCard"
          }
        },
        storybookFamily: {
          familyId: "family-card",
          title: "ReactUI/Card",
          name: "Card",
          tier: "ReactUI",
          storyCount: 1
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "Card",
          importEntry: {
            package: "@customer/react-ui-v2",
            exportName: "ContentCard",
            localName: "CustomerCard"
          },
          allowedProps: [
            {
              name: "children",
              kind: "string"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: []
        })
      }
    ]
  };

  const result = toCustomerProfileDesignSystemConfigFromComponentMatchReport({
    artifact
  });

  assert.deepEqual(result.config, {
    library: "__customer_profile__",
    mappings: {
      Button: {
        import: "@customer/components",
        export: "PrimaryButton",
        component: "CustomerButton",
        propMappings: {
          variant: "appearance"
        }
      }
    }
  });
  assert.deepEqual(result.warnings, [
    "Component match report resolved multiple customer-profile imports for component key 'Card'; excluding it from storybook-first design-system mappings."
  ]);
});

test("toCustomerProfileDesignSystemConfigFromComponentMatchReport excludes incompatible or conflicting component APIs", () => {
  const artifact: ComponentMatchReportArtifact = {
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: 3,
      storybookFamilyCount: 3,
      storybookEntryCount: 3,
      matched: 3,
      ambiguous: 0,
      unmatched: 0,
      libraryResolution: {
        byStatus: {
          resolved_import: 3,
          mui_fallback_allowed: 0,
          mui_fallback_denied: 0,
          not_applicable: 0
        },
        byReason: {
          profile_import_resolved: 3,
          profile_import_missing: 0,
          profile_import_family_mismatch: 0,
          profile_family_unresolved: 0,
          match_ambiguous: 0,
          match_unmatched: 0
        }
      }
    },
    entries: [
      {
        figma: {
          familyKey: "textfield-valid",
          familyName: "TextField",
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
          status: "resolved_import",
          reason: "profile_import_resolved",
          storybookTier: "Components",
          profileFamily: "Components",
          componentKey: "TextField",
          import: {
            package: "@customer/forms",
            exportName: "CustomerTextField",
            localName: "CustomerTextField"
          }
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "TextField",
          importEntry: {
            package: "@customer/forms",
            exportName: "CustomerTextField",
            localName: "CustomerTextField"
          },
          allowedProps: [
            {
              name: "label",
              kind: "string"
            },
            {
              name: "slotProps",
              kind: "object"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [
            {
              sourceProp: "label",
              targetProp: "label",
              kind: "string",
              values: ["Email"]
            }
          ]
        })
      },
      {
        figma: {
          familyKey: "textfield-incompatible",
          familyName: "TextField",
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
          status: "resolved_import",
          reason: "profile_import_resolved",
          storybookTier: "Components",
          profileFamily: "Components",
          componentKey: "TextField",
          import: {
            package: "@customer/forms",
            exportName: "CustomerTextField",
            localName: "CustomerTextField"
          }
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "TextField",
          importEntry: {
            package: "@customer/forms",
            exportName: "CustomerTextField",
            localName: "CustomerTextField"
          },
          allowedProps: [
            {
              name: "label",
              kind: "string"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [],
          fallbackPolicy: "deny",
          slotPolicy: "unsupported",
          codegenCompatible: false,
          diagnostics: [
            {
              severity: "error",
              code: "component_api_slot_unsupported",
              message: "Resolved component 'TextField' does not expose 'slotProps'.",
              sourceProp: "slotProps",
              targetProp: "slotProps"
            }
          ]
        })
      },
      {
        figma: {
          familyKey: "button-conflict",
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
        resolvedApi: createResolvedApiFixture({
          componentKey: "Button",
          importEntry: {
            package: "@customer/components",
            exportName: "PrimaryButton",
            localName: "CustomerButton"
          },
          allowedProps: [
            {
              name: "appearance",
              kind: "enum",
              allowedValues: ["primary"]
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [
            {
              sourceProp: "variant",
              targetProp: "appearance",
              kind: "enum",
              values: ["primary"]
            }
          ]
        })
      }
    ]
  };

  const result = toCustomerProfileDesignSystemConfigFromComponentMatchReport({
    artifact
  });

  assert.deepEqual(result.config, {
    library: "__customer_profile__",
    mappings: {
      Button: {
        import: "@customer/components",
        export: "PrimaryButton",
        component: "CustomerButton"
      }
    }
  });
  assert.deepEqual(result.warnings, [
    "Component match report found incompatible component-api contracts for component key 'TextField'; excluding it from storybook-first design-system mappings."
  ]);
});

test("toCustomerProfileDesignSystemConfigFromComponentMatchReport writes omitted props and default props from resolved APIs", () => {
  const artifact: ComponentMatchReportArtifact = {
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: 1,
      storybookFamilyCount: 1,
      storybookEntryCount: 1,
      matched: 1,
      ambiguous: 0,
      unmatched: 0,
      libraryResolution: {
        byStatus: {
          resolved_import: 1,
          mui_fallback_allowed: 0,
          mui_fallback_denied: 0,
          not_applicable: 0
        },
        byReason: {
          profile_import_resolved: 1,
          profile_import_missing: 0,
          profile_import_family_mismatch: 0,
          profile_family_unresolved: 0,
          match_ambiguous: 0,
          match_unmatched: 0
        }
      }
    },
    entries: [
      {
        figma: {
          familyKey: "button-defaulted",
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
        },
        resolvedApi: createResolvedApiFixture({
          componentKey: "Button",
          importEntry: {
            package: "@customer/components",
            exportName: "PrimaryButton",
            localName: "CustomerButton",
            propMappings: {
              variant: "appearance"
            }
          },
          allowedProps: [
            {
              name: "appearance",
              kind: "enum",
              allowedValues: ["primary", "secondary"]
            }
          ],
          defaultProps: [
            {
              name: "size",
              value: "small",
              source: "storybook_theme_defaultProps"
            }
          ]
        }),
        resolvedProps: createResolvedPropsFixture({
          props: [
            {
              sourceProp: "variant",
              targetProp: "appearance",
              kind: "enum",
              values: ["primary"]
            }
          ],
          omittedProps: [
            {
              sourceProp: "disabled",
              targetProp: "disabled"
            }
          ],
          omittedDefaults: [
            {
              sourceProp: "size",
              targetProp: "size",
              value: "small",
              source: "storybook_theme_defaultProps"
            }
          ]
        })
      }
    ]
  };

  const result = toCustomerProfileDesignSystemConfigFromComponentMatchReport({
    artifact
  });

  assert.deepEqual(result.config, {
    library: "__customer_profile__",
    mappings: {
      Button: {
        import: "@customer/components",
        export: "PrimaryButton",
        component: "CustomerButton",
        propMappings: {
          variant: "appearance"
        },
        omittedProps: ["disabled"],
        defaultProps: {
          size: "small"
        }
      }
    }
  });
});

test("resolveCustomerProfileFamily is case-insensitive and trims whitespace", () => {
  const parsed = safeParseCustomerProfileConfig({
    input: createRawCustomerProfile()
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    assert.fail("Expected customer profile to parse successfully.");
  }

  assert.equal(resolveCustomerProfileFamily({ profile: parsed.config, candidate: "  REACT UI  " })?.id, "ReactUI");
  assert.equal(resolveCustomerProfileFamily({ profile: parsed.config, candidate: "components" })?.id, "Components");
  assert.equal(resolveCustomerProfileFamily({ profile: parsed.config, candidate: "@CUSTOMER/REACT-UI" })?.id, "ReactUI");
});
