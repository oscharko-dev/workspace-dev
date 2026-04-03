import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceJobInput,
  WorkspaceJobStageName
} from "../../contracts/index.js";
import { parseCustomerProfileConfig } from "../../customer-profile.js";
import { applyCustomerProfileToTemplate } from "../../customer-profile-template.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { toDeterministicScreenPath } from "../../parity/generator-artifacts.js";
import { buildTypographyScaleFromAliases } from "../../parity/typography-tokens.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "../../storybook/types.js";
import { createStageRuntimeContext, type PipelineExecutionContext, type StageRuntimeContext } from "../pipeline/context.js";
import { loadPreviousSnapshot, saveCurrentSnapshot, type GenerationDiffContext } from "../generation-diff.js";
import { computeContentHash, computeOptionsHash, saveCachedIr } from "../ir-cache.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso } from "../stage-state.js";
import type { JobEngineRuntime, JobRecord } from "../types.js";
import type { ProjectValidationResult } from "../validation.js";
import { createCodegenGenerateService } from "./codegen-generate-service.js";
import { FigmaSourceService } from "./figma-source-service.js";
import { createGitPrService } from "./git-pr-service.js";
import { IrDeriveService } from "./ir-derive-service.js";
import { ReproExportService } from "./repro-export-service.js";
import { TemplatePrepareService } from "./template-prepare-service.js";
import { createValidateProjectService } from "./validate-project-service.js";

const createLocalFigmaPayload = () => ({
  name: "Stage Service Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Screen 1",
            absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 240 },
            children: [
              {
                id: "title-1",
                type: "TEXT",
                name: "Title",
                characters: "Hello",
                absoluteBoundingBox: { x: 16, y: 16, width: 128, height: 20 }
              }
            ]
          }
        ]
      }
    ]
  }
});

const createLocalFigmaPayloadWithExternalComponent = () => ({
  name: "Stage Service Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": {
      key: "cmp-key",
      name: "Button/Primary",
      componentSetId: "1:200",
      remote: true
    }
  },
  componentSets: {
    "1:200": {
      key: "set-key",
      name: "Button",
      remote: true
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Screen 1",
            absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 240 },
            children: [
              {
                id: "instance-1",
                type: "INSTANCE",
                name: "Button",
                componentId: "1:100",
                componentSetId: "1:200",
                componentProperties: {
                  State: {
                    type: "VARIANT",
                    value: "Primary"
                  }
                },
                absoluteBoundingBox: { x: 16, y: 16, width: 120, height: 40 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createLocalFigmaPayloadWithMatchFamilies = () => ({
  name: "Stage Service Match Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": { key: "cmp-button", name: "Button/Primary", componentSetId: "1:200", remote: false },
    "1:101": { key: "cmp-text-field", name: "TextField/Default", componentSetId: "1:201", remote: false },
    "1:102": { key: "cmp-date-picker", name: "DatePicker/Single", componentSetId: "1:202", remote: false },
    "1:103": { key: "cmp-accordion", name: "Accordion/Collapsed", componentSetId: "1:203", remote: false },
    "1:104": { key: "cmp-typography", name: "Typography/Heading", componentSetId: "1:204", remote: false },
    "1:105": { key: "cmp-icon", name: "Icon/Medium", componentSetId: "1:205", remote: false }
  },
  componentSets: {
    "1:200": { key: "set-button", name: "Button", remote: false },
    "1:201": { key: "set-text-field", name: "TextField", remote: false },
    "1:202": { key: "set-date-picker", name: "DatePicker", remote: false },
    "1:203": { key: "set-accordion", name: "Accordion", remote: false },
    "1:204": { key: "set-typography", name: "Typography", remote: false },
    "1:205": { key: "set-icon", name: "Icon", remote: false }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Component Match Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 900 },
            children: [
              {
                id: "instance-button",
                type: "INSTANCE",
                name: "Button, Variant=Primary, Size=Large",
                componentId: "1:100",
                componentSetId: "1:200",
                componentProperties: {
                  Variant: { type: "VARIANT", value: "Primary" },
                  Size: { type: "VARIANT", value: "Large" }
                },
                absoluteBoundingBox: { x: 16, y: 16, width: 160, height: 48 },
                children: []
              },
              {
                id: "instance-text-field",
                type: "INSTANCE",
                name: "TextField, State=Default",
                componentId: "1:101",
                componentSetId: "1:201",
                componentProperties: {
                  State: { type: "VARIANT", value: "Default" }
                },
                absoluteBoundingBox: { x: 16, y: 96, width: 240, height: 56 },
                children: []
              },
              {
                id: "instance-date-picker",
                type: "INSTANCE",
                name: "DatePicker, State=Single",
                componentId: "1:102",
                componentSetId: "1:202",
                componentProperties: {
                  State: { type: "VARIANT", value: "Single" }
                },
                absoluteBoundingBox: { x: 16, y: 176, width: 240, height: 56 },
                children: []
              },
              {
                id: "instance-accordion",
                type: "INSTANCE",
                name: "Accordion, State=Collapsed",
                componentId: "1:103",
                componentSetId: "1:203",
                componentProperties: {
                  State: { type: "VARIANT", value: "Collapsed" }
                },
                absoluteBoundingBox: { x: 16, y: 256, width: 320, height: 64 },
                children: []
              },
              {
                id: "instance-typography",
                type: "INSTANCE",
                name: "Typography, Level=Heading",
                componentId: "1:104",
                componentSetId: "1:204",
                componentProperties: {
                  Level: { type: "VARIANT", value: "Heading" }
                },
                absoluteBoundingBox: { x: 16, y: 352, width: 240, height: 40 },
                children: []
              },
              {
                id: "instance-icon",
                type: "INSTANCE",
                name: "Icon, Size=Medium",
                componentId: "1:105",
                componentSetId: "1:205",
                componentProperties: {
                  Size: { type: "VARIANT", value: "Medium" }
                },
                absoluteBoundingBox: { x: 16, y: 424, width: 40, height: 40 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createComponentMatchStorybookBuild = async (): Promise<string> => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-storybook-match-"));
  const assetsDir = path.join(buildDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const storyDefinitions = [
    {
      id: "components-button--primary-large",
      title: "Components/Button",
      name: "Primary Large",
      importPath: "./src/components/Button/Button.stories.tsx",
      componentPath: "./src/components/Button/Button.tsx",
      args: { appearance: "primary", size: "large", children: "Continue" }
    },
    {
      id: "forms-text-field--default",
      title: "Forms/TextField",
      name: "Default",
      importPath: "./src/components/TextField/TextField.stories.tsx",
      componentPath: "./src/components/TextField/TextField.tsx",
      args: { state: "default" }
    },
    {
      id: "forms-date-picker--single",
      title: "Forms/DatePicker",
      name: "Single",
      importPath: "./src/components/DatePicker/DatePicker.stories.tsx",
      componentPath: "./src/components/DatePicker/DatePicker.tsx",
      args: { state: "single" }
    },
    {
      id: "content-accordion--collapsed",
      title: "Content/Accordion",
      name: "Collapsed",
      importPath: "./src/components/Accordion/Accordion.stories.tsx",
      componentPath: "./src/components/Accordion/Accordion.tsx",
      args: { state: "collapsed", children: "Details" }
    },
    {
      id: "foundations-typography--heading",
      title: "Foundations/Typography",
      name: "Heading",
      importPath: "./src/components/Typography/Typography.stories.tsx",
      componentPath: "./src/components/Typography/Typography.tsx",
      args: { level: "heading" }
    },
    {
      id: "assets-icon--medium",
      title: "Assets/Icon",
      name: "Medium",
      importPath: "./src/components/Icon/Icon.stories.tsx",
      componentPath: "./src/components/Icon/Icon.tsx",
      args: { size: "medium" }
    }
  ] as const;

  const indexJson = {
    v: 5,
    entries: Object.fromEntries(
      storyDefinitions.map((definition) => [
        definition.id,
        {
          id: definition.id,
          title: definition.title,
          name: definition.name,
          importPath: definition.importPath,
          storiesImports: [],
          type: "story",
          tags: ["dev", "test"],
          componentPath: definition.componentPath
        }
      ])
    )
  };

  const iframeHtml = `
    <!doctype html>
    <html>
      <body>
        <script type="module" crossorigin src="./assets/iframe-test.js"></script>
      </body>
    </html>
  `;

  const iframeEntries = storyDefinitions
    .map(
      (definition, index) =>
        `"${definition.importPath}": n(() => c0(() => import("./story-${index + 1}.js"), true ? __vite__mapDeps([${index + 1}]) : void 0, import.meta.url), "${definition.importPath}")`
    )
    .join(",\n      ");
  const iframeBundle = `
    const gq0 = {
      ${iframeEntries}
    };
  `;

  const sharedThemeBundle = `
    const FONT_DATA = "data:application/font-ttf;base64,${"A".repeat(1500)}";
    const keepName = ((fn, name) => fn);
    const createFont = keepName((family, weight, src) => ({
      fontFamily: \`\${family}\`,
      fontWeight: weight,
      src: \`url('\${src}') format('truetype')\`
    }), "createFont");
    const regular = createFont("Brand Sans", 400, FONT_DATA);
    const bold = createFont("Brand Sans Bold", 700, FONT_DATA);
    const appTheme = createTheme({
      spacing: 8,
      shape: { borderRadius: 12 },
      palette: {
        primary: { main: "#ff0000", contrastText: "#ffffff" },
        warning: { main: "#ffc900" },
        text: { primary: "#444444" }
      },
      typography: {
        fontFamily: "Brand Sans, sans-serif",
        fontSize: 16,
        body1: { fontSize: 14, lineHeight: 1.5, fontFamily: "Brand Sans" },
        h1: { fontSize: 30, lineHeight: 1.2, fontFamily: "Brand Sans Bold" }
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            "@font-face": [regular],
            fallbacks: [{ "@font-face": [bold] }]
          }
        }
      },
      zIndex: { drawer: 1200 }
    });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;

  const cssText = `
    :root {
      --fi-space-base: 8px;
    }
  `;

  await writeFile(path.join(buildDir, "index.json"), `${JSON.stringify(indexJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(buildDir, "iframe.html"), iframeHtml, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.js"), iframeBundle, "utf8");
  await writeFile(path.join(assetsDir, "shared-theme.js"), sharedThemeBundle, "utf8");
  await writeFile(path.join(assetsDir, "iframe-test.css"), cssText, "utf8");

  for (const [index, definition] of storyDefinitions.entries()) {
    const storyBundle = `
      const meta = {
        title: "${definition.title}",
        args: ${JSON.stringify(definition.args)},
        argTypes: ${JSON.stringify(
          Object.fromEntries(Object.keys(definition.args).map((key) => [key, { control: { type: "select" } }]))
        )}
      };
    `;
    await writeFile(path.join(assetsDir, `story-${index + 1}.js`), storyBundle, "utf8");
  }

  return buildDir;
};

const createMinimalIr = (): DesignIR =>
  ({
    sourceName: "test",
    screens: [
      {
        id: "screen-1",
        name: "Screen 1",
        route: "/",
        layoutMode: "VERTICAL",
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: []
      }
    ],
    tokens: {
      palette: {
        primary: "#1976d2",
        secondary: "#9c27b0",
        background: "#ffffff",
        text: "#111111",
        success: "#2e7d32",
        warning: "#ed6c02",
        error: "#d32f2f",
        info: "#0288d1",
        divider: "#e0e0e0",
        action: {
          active: "#1976d2",
          hover: "#1976d21a",
          selected: "#1976d214",
          disabled: "#00000042",
          disabledBackground: "#0000001f",
          focus: "#1976d21f"
        }
      },
      borderRadius: 4,
      spacingBase: 8,
      fontFamily: "Roboto",
      headingSize: 24,
      bodySize: 14,
      typography: buildTypographyScaleFromAliases({
        fontFamily: "Roboto",
        headingSize: 24,
        bodySize: 14
      })
    }
  }) as DesignIR;

const createSuccessfulValidationResult = ({
  attempts = 1,
  includeUiValidation = false
}: {
  attempts?: number;
  includeUiValidation?: boolean;
} = {}): ProjectValidationResult => {
  return {
    attempts,
    install: {
      status: "skipped",
      strategy: "reused_seeded_node_modules"
    },
    lintAutofix: {
      status: "completed",
      command: "pnpm",
      args: ["lint", "--fix"],
      attempt: attempts,
      timedOut: false,
      changedFiles: ["src/App.tsx"]
    },
    lint: {
      status: "passed",
      command: "pnpm",
      args: ["lint"],
      attempt: attempts,
      timedOut: false
    },
    typecheck: {
      status: "passed",
      command: "pnpm",
      args: ["typecheck"],
      attempt: attempts,
      timedOut: false
    },
    build: {
      status: "passed",
      command: "pnpm",
      args: ["build"],
      attempt: attempts,
      timedOut: false
    },
    ...(includeUiValidation
      ? {
          validateUi: {
            status: "passed" as const,
            command: "pnpm" as const,
            args: ["run", "validate:ui"],
            attempt: attempts,
            timedOut: false
          }
        }
      : {})
  };
};

const createCustomerProfileForStageServices = () => {
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
  if (!customerProfile) {
    throw new Error("Failed to create stage-service customer profile fixture.");
  }
  return customerProfile;
};

const createStorybookMatchCustomerProfileForStageServices = ({
  matchPolicy = "warn",
  tokenPolicy = "off",
  fallbackComponents
}: {
  matchPolicy?: "off" | "warn" | "error";
  tokenPolicy?: "off" | "warn" | "error";
  fallbackComponents?: Record<string, "allow" | "deny">;
} = {}) => {
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
        },
        {
          id: "ReactUI",
          tierPriority: 20,
          aliases: {
            figma: ["Forms"],
            storybook: ["forms"],
            code: ["@customer/forms"]
          }
        },
        {
          id: "Reactlib",
          tierPriority: 30,
          aliases: {
            figma: ["Content"],
            storybook: ["content"],
            code: ["@customer/content"]
          }
        },
        {
          id: "IF-Components",
          tierPriority: 40,
          aliases: {
            figma: ["Foundations"],
            storybook: ["foundations"],
            code: ["@customer/foundations"]
          }
        },
        {
          id: "OSPlus_neo-Components",
          tierPriority: 50,
          aliases: {
            figma: ["Assets"],
            storybook: ["assets"],
            code: ["@customer/assets"]
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
            importAlias: "CustomerButton",
            propMappings: {
              variant: "appearance"
            }
          },
          TextField: {
            family: "ReactUI",
            package: "@customer/forms",
            export: "CustomerTextField"
          },
          Accordion: {
            family: "Reactlib",
            package: "@customer/content",
            export: "CustomerAccordion"
          }
        }
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          components: {
            Icon: "allow",
            ...(fallbackComponents ?? {})
          }
        }
      },
      template: {
        dependencies: {
          "@customer/components": "^1.2.3"
        }
      },
      strictness: {
        match: matchPolicy,
        token: tokenPolicy,
        import: "error"
      }
    }
  });
  if (!customerProfile) {
    throw new Error("Failed to create stage-service storybook match customer profile fixture.");
  }
  return customerProfile;
};

const createIssue693CustomerProfileForStageServices = () => {
  const customerProfile = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [
        {
          id: "Forms",
          tierPriority: 10,
          aliases: {
            figma: ["Forms"],
            storybook: ["forms"],
            code: ["@customer/forms"]
          }
        },
        {
          id: "Typography",
          tierPriority: 20,
          aliases: {
            figma: ["Typography"],
            storybook: ["typography"],
            code: ["@customer/typography"]
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
        components: {
          DatePicker: {
            family: "Forms",
            package: "@customer/forms",
            export: "CustomerDatePicker"
          },
          InputIBAN: {
            family: "Forms",
            package: "@customer/forms",
            export: "CustomerIbanInput"
          },
          Typography: {
            family: "Typography",
            package: "@customer/typography",
            export: "CustomerTypography"
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
          "@customer/forms": "^1.0.0",
          "@customer/typography": "^1.0.0",
          "@customer/date-provider": "^1.0.0"
        },
        providers: {
          datePicker: {
            package: "@customer/date-provider",
            export: "CustomerDatePickerProvider",
            adapter: {
              package: "@customer/date-provider",
              export: "CustomerDateAdapter"
            },
            props: {
              adapterLocale: "de"
            }
          }
        }
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!customerProfile) {
    throw new Error("Failed to create Issue #693 stage-service customer profile fixture.");
  }
  return customerProfile;
};

const createIssue693IrForStageServices = (): DesignIR =>
  ({
    sourceName: "issue-693",
    screens: [
      {
        id: "screen-issue-693",
        name: "Issue 693 Screen",
        route: "/",
        layoutMode: "VERTICAL",
        gap: 16,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        children: [
          {
            id: "dynamic-typography",
            name: "<Dynamic Typography>",
            nodeType: "TEXT",
            type: "text",
            semanticType: "DynamicTypography",
            text: "Payment Schedule",
            fontFamily: "Brand Sans",
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 40
          },
          {
            id: "iban-field",
            name: "IBAN field",
            nodeType: "FRAME",
            type: "input",
            semanticType: "InputIBAN",
            width: 320,
            height: 56,
            children: [
              {
                id: "iban-label",
                name: "IBAN label",
                nodeType: "TEXT",
                type: "text",
                text: "IBAN",
                y: 0
              },
              {
                id: "iban-value",
                name: "IBAN value",
                nodeType: "TEXT",
                type: "text",
                text: "DE89 3704 0044 0532 0130 00",
                y: 28
              }
            ]
          },
          {
            id: "date-field",
            name: "Date field",
            nodeType: "FRAME",
            type: "input",
            semanticType: "DatePicker",
            width: 320,
            height: 56,
            y: 88,
            children: [
              {
                id: "date-label",
                name: "Date label",
                nodeType: "TEXT",
                type: "text",
                text: "Execution date",
                y: 88
              },
              {
                id: "date-value",
                name: "Date value",
                nodeType: "TEXT",
                type: "text",
                text: "2026-04-02",
                y: 116
              }
            ]
          }
        ]
      }
    ],
    tokens: {
      palette: {
        primary: "#dd0000",
        secondary: "#9c27b0",
        background: "#ffffff",
        text: "#111111",
        success: "#2e7d32",
        warning: "#ed6c02",
        error: "#d32f2f",
        info: "#0288d1",
        divider: "#e0e0e0",
        action: {
          active: "#dd0000",
          hover: "#dd00001a",
          selected: "#dd000014",
          disabled: "#00000042",
          disabledBackground: "#0000001f",
          focus: "#dd00001f"
        }
      },
      borderRadius: 12,
      spacingBase: 8,
      fontFamily: "Brand Sans",
      headingSize: 32,
      bodySize: 16,
      typography: buildTypographyScaleFromAliases({
        fontFamily: "Brand Sans",
        headingSize: 32,
        bodySize: 16
      })
    }
  }) as DesignIR;

const createIssue693ComponentMatchReportArtifactForStageServices = () => ({
  artifact: "component.match_report" as const,
  version: 1 as const,
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
        familyKey: "date-picker-family",
        familyName: "DatePicker",
        nodeCount: 1,
        variantProperties: []
      },
      match: {
        status: "matched" as const,
        confidence: "high" as const,
        confidenceScore: 100
      },
      usedEvidence: [],
      rejectionReasons: [],
      fallbackReasons: [],
      libraryResolution: {
        status: "resolved_import" as const,
        reason: "profile_import_resolved" as const,
        storybookTier: "Forms",
        profileFamily: "Forms",
        componentKey: "DatePicker",
        import: {
          package: "@customer/forms",
          exportName: "CustomerDatePicker",
          localName: "CustomerDatePicker"
        }
      },
      storybookFamily: {
        familyId: "storybook-date-picker",
        title: "Forms/DatePicker",
        name: "DatePicker",
        tier: "Forms",
        storyCount: 1
      },
      storyVariant: {
        entryId: "datepicker--default",
        storyName: "Default"
      },
      resolvedApi: {
        status: "resolved" as const,
        componentKey: "DatePicker",
        import: {
          package: "@customer/forms",
          exportName: "CustomerDatePicker",
          localName: "CustomerDatePicker"
        },
        allowedProps: [
          { name: "label", kind: "string" as const },
          { name: "value", kind: "string" as const },
          { name: "onChange", kind: "unknown" as const },
          { name: "onBlur", kind: "unknown" as const },
          { name: "error", kind: "boolean" as const },
          { name: "helperText", kind: "string" as const },
          { name: "required", kind: "boolean" as const },
          { name: "aria-label", kind: "string" as const },
          { name: "aria-describedby", kind: "string" as const },
          { name: "sx", kind: "object" as const },
          { name: "slotProps", kind: "object" as const }
        ],
        defaultProps: [],
        children: { policy: "not_used" as const },
        slots: { policy: "supported" as const, props: ["slotProps"] },
        diagnostics: []
      },
      resolvedProps: {
        status: "resolved" as const,
        fallbackPolicy: "deny" as const,
        props: [],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "not_used" as const },
        slots: { policy: "supported" as const, props: ["slotProps"] },
        codegenCompatible: true,
        diagnostics: []
      }
    },
    {
      figma: {
        familyKey: "iban-family",
        familyName: "InputIBAN",
        nodeCount: 1,
        variantProperties: []
      },
      match: {
        status: "matched" as const,
        confidence: "high" as const,
        confidenceScore: 100
      },
      usedEvidence: [],
      rejectionReasons: [],
      fallbackReasons: [],
      libraryResolution: {
        status: "resolved_import" as const,
        reason: "profile_import_resolved" as const,
        storybookTier: "Forms",
        profileFamily: "Forms",
        componentKey: "InputIBAN",
        import: {
          package: "@customer/forms",
          exportName: "CustomerIbanInput",
          localName: "CustomerIbanInput"
        }
      },
      storybookFamily: {
        familyId: "storybook-input-iban",
        title: "Forms/InputIBAN",
        name: "InputIBAN",
        tier: "Forms",
        storyCount: 1
      },
      storyVariant: {
        entryId: "inputiban--default",
        storyName: "Default"
      },
      resolvedApi: {
        status: "resolved" as const,
        componentKey: "InputIBAN",
        import: {
          package: "@customer/forms",
          exportName: "CustomerIbanInput",
          localName: "CustomerIbanInput"
        },
        allowedProps: [
          { name: "label", kind: "string" as const },
          { name: "value", kind: "string" as const },
          { name: "onChange", kind: "unknown" as const },
          { name: "onBlur", kind: "unknown" as const },
          { name: "error", kind: "boolean" as const },
          { name: "helperText", kind: "string" as const },
          { name: "required", kind: "boolean" as const },
          { name: "placeholder", kind: "string" as const },
          { name: "type", kind: "string" as const },
          { name: "autoComplete", kind: "string" as const },
          { name: "aria-label", kind: "string" as const },
          { name: "aria-describedby", kind: "string" as const },
          { name: "sx", kind: "object" as const },
          { name: "slotProps", kind: "object" as const }
        ],
        defaultProps: [],
        children: { policy: "not_used" as const },
        slots: { policy: "supported" as const, props: ["slotProps"] },
        diagnostics: []
      },
      resolvedProps: {
        status: "resolved" as const,
        fallbackPolicy: "deny" as const,
        props: [],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "not_used" as const },
        slots: { policy: "supported" as const, props: ["slotProps"] },
        codegenCompatible: true,
        diagnostics: []
      }
    },
    {
      figma: {
        familyKey: "typography-family",
        familyName: "Typography",
        nodeCount: 1,
        variantProperties: []
      },
      match: {
        status: "matched" as const,
        confidence: "high" as const,
        confidenceScore: 100
      },
      usedEvidence: [],
      rejectionReasons: [],
      fallbackReasons: [],
      libraryResolution: {
        status: "resolved_import" as const,
        reason: "profile_import_resolved" as const,
        storybookTier: "Typography",
        profileFamily: "Typography",
        componentKey: "Typography",
        import: {
          package: "@customer/typography",
          exportName: "CustomerTypography",
          localName: "CustomerTypography"
        }
      },
      storybookFamily: {
        familyId: "storybook-typography",
        title: "Typography/Typography",
        name: "Typography",
        tier: "Typography",
        storyCount: 1
      },
      storyVariant: {
        entryId: "typography--default",
        storyName: "Default"
      },
      resolvedApi: {
        status: "resolved" as const,
        componentKey: "Typography",
        import: {
          package: "@customer/typography",
          exportName: "CustomerTypography",
          localName: "CustomerTypography"
        },
        allowedProps: [
          { name: "variant", kind: "string" as const },
          { name: "component", kind: "string" as const },
          { name: "sx", kind: "object" as const }
        ],
        defaultProps: [],
        children: { policy: "supported" as const },
        slots: { policy: "not_used" as const, props: [] },
        diagnostics: []
      },
      resolvedProps: {
        status: "resolved" as const,
        fallbackPolicy: "deny" as const,
        props: [],
        omittedProps: [],
        omittedDefaults: [],
        children: { policy: "supported" as const },
        slots: { policy: "not_used" as const, props: [] },
        codegenCompatible: true,
        diagnostics: []
      }
    }
  ]
});

const createComponentMatchReportArtifactForStageServices = ({
  matchStatus = "matched",
  libraryResolutionStatus = "resolved_import",
  libraryResolutionReason = "profile_import_resolved"
}: {
  matchStatus?: "matched" | "ambiguous" | "unmatched";
  libraryResolutionStatus?: "resolved_import" | "mui_fallback_allowed" | "mui_fallback_denied" | "not_applicable";
  libraryResolutionReason?:
    | "profile_import_resolved"
    | "profile_import_missing"
    | "profile_import_family_mismatch"
    | "profile_family_unresolved"
    | "match_ambiguous"
    | "match_unmatched";
} = {}) => {
  return {
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: 1,
      storybookFamilyCount: 1,
      storybookEntryCount: 1,
      matched: matchStatus === "matched" ? 1 : 0,
      ambiguous: matchStatus === "ambiguous" ? 1 : 0,
      unmatched: matchStatus === "unmatched" ? 1 : 0,
      libraryResolution: {
        byStatus: {
          resolved_import: libraryResolutionStatus === "resolved_import" ? 1 : 0,
          mui_fallback_allowed: libraryResolutionStatus === "mui_fallback_allowed" ? 1 : 0,
          mui_fallback_denied: libraryResolutionStatus === "mui_fallback_denied" ? 1 : 0,
          not_applicable: libraryResolutionStatus === "not_applicable" ? 1 : 0
        },
        byReason: {
          profile_import_resolved: libraryResolutionReason === "profile_import_resolved" ? 1 : 0,
          profile_import_missing: libraryResolutionReason === "profile_import_missing" ? 1 : 0,
          profile_import_family_mismatch: libraryResolutionReason === "profile_import_family_mismatch" ? 1 : 0,
          profile_family_unresolved: libraryResolutionReason === "profile_family_unresolved" ? 1 : 0,
          match_ambiguous: libraryResolutionReason === "match_ambiguous" ? 1 : 0,
          match_unmatched: libraryResolutionReason === "match_unmatched" ? 1 : 0
        }
      },
      iconResolution: {
        byStatus: {
          resolved_import: 0,
          wrapper_fallback_allowed: 0,
          wrapper_fallback_denied: 0,
          unresolved: 0,
          ambiguous: 0,
          not_applicable: 1
        },
        byReason: {
          profile_icon_import_resolved: 0,
          profile_icon_import_missing: 0,
          profile_icon_wrapper_allowed: 0,
          profile_icon_wrapper_denied: 0,
          profile_icon_wrapper_missing: 0,
          match_ambiguous: 0,
          match_unmatched: 0,
          not_icon_family: 1
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
          status: matchStatus,
          confidence: matchStatus === "matched" ? "high" : matchStatus === "ambiguous" ? "medium" : "none",
          confidenceScore: matchStatus === "matched" ? 100 : matchStatus === "ambiguous" ? 55 : 0
        },
        usedEvidence: [],
        rejectionReasons: [],
        fallbackReasons: [],
        libraryResolution: {
          status: libraryResolutionStatus,
          reason: libraryResolutionReason,
          storybookTier: "Components",
          profileFamily: "Components",
          componentKey: "Button",
          ...(libraryResolutionStatus === "resolved_import"
            ? {
                import: {
                  package: "@customer/components",
                  exportName: "PrimaryButton",
                  localName: "CustomerButton"
                }
              }
            : {})
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
        resolvedApi:
          libraryResolutionStatus === "resolved_import"
            ? {
                status: "resolved",
                componentKey: "Button",
                import: {
                  package: "@customer/components",
                  exportName: "PrimaryButton",
                  localName: "CustomerButton"
                },
                allowedProps: [
                  {
                    name: "children",
                    kind: "string"
                  },
                  {
                    name: "variant",
                    kind: "enum",
                    allowedValues: ["primary"]
                  }
                ],
                defaultProps: [],
                children: {
                  policy: "supported"
                },
                slots: {
                  policy: "not_used",
                  props: []
                },
                diagnostics: []
              }
            : {
                status: "not_applicable",
                allowedProps: [],
                defaultProps: [],
                children: {
                  policy: "unknown"
                },
                slots: {
                  policy: "not_used",
                  props: []
                },
                diagnostics: []
              },
        resolvedProps:
          libraryResolutionStatus === "resolved_import"
            ? {
                status: "resolved",
                fallbackPolicy: "deny",
                props: [
                  {
                    sourceProp: "variant",
                    targetProp: "variant",
                    kind: "enum",
                    values: ["primary"]
                  }
                ],
                omittedProps: [],
                omittedDefaults: [],
                children: {
                  policy: "supported"
                },
                slots: {
                  policy: "not_used",
                  props: []
                },
                codegenCompatible: true,
                diagnostics: []
              }
            : {
                status: "not_applicable",
                props: [],
                omittedProps: [],
                omittedDefaults: [],
                children: {
                  policy: "unknown"
                },
                slots: {
                  policy: "not_used",
                  props: []
                },
                codegenCompatible: true,
                diagnostics: []
              }
      }
    ]
  };
};

const createStorybookEvidenceArtifactForStageServices = ({
  evidence
}: {
  evidence: Array<{
    id: string;
    type:
      | "story_componentPath"
      | "story_argTypes"
      | "story_args"
      | "story_design_link"
      | "theme_bundle"
      | "css"
      | "mdx_link"
      | "docs_image"
      | "docs_text";
    reliability: "authoritative" | "reference_only" | "derived";
    source: Record<string, string>;
    usage: {
      canDriveTokens: boolean;
      canDriveProps: boolean;
      canDriveImports: boolean;
      canDriveStyling: boolean;
      canProvideMatchHints: boolean;
    };
    summary: Record<string, string | string[]>;
  }>;
}) => {
  return {
    artifact: "storybook.evidence",
    version: 1,
    buildRoot: "/tmp/storybook-static",
    iframeBundlePath: "/tmp/storybook-static/iframe.html",
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
  };
};

const createStorybookTokensArtifactForStageServices = ({
  diagnostics = []
}: {
  diagnostics?: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
    themeId?: string;
    tokenPath?: string[];
  }>;
} = {}) => {
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
  };
};

const createStorybookThemesArtifactForStageServices = ({
  diagnostics = []
}: {
  diagnostics?: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
    themeId?: string;
    tokenPath?: string[];
  }>;
} = {}) => {
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
  };
};

const createJobRecord = ({
  runtime,
  jobDir,
  requestOverrides
}: {
  runtime: JobEngineRuntime;
  jobDir: string;
  requestOverrides?: Partial<JobRecord["request"]>;
}): JobRecord => {
  return {
    jobId: "job-stage-test",
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
      ...requestOverrides
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs
    }
  };
};

const createExecutionContext = async ({
  mode = "submission",
  input,
  runtimeOverrides,
  requestOverrides,
  rootDir,
  jobId = "job-stage-test"
}: {
  mode?: "submission" | "regeneration";
  input?: WorkspaceJobInput;
  runtimeOverrides?: Partial<Parameters<typeof resolveRuntimeSettings>[0]>;
  requestOverrides?: Partial<JobRecord["request"]>;
  rootDir?: string;
  jobId?: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}> => {
  const root = rootDir ?? (await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-")));
  const jobsRoot = path.join(root, "jobs");
  const jobDir = path.join(jobsRoot, jobId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: true,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    ...runtimeOverrides
  });
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });

  const job = createJobRecord({
    runtime,
    jobDir,
    requestOverrides
  });
  const artifactStore = new StageArtifactStore({ jobDir });
  const resolvedBrandTheme = (job.request.brandTheme ?? "derived") as WorkspaceBrandTheme;
  const resolvedFigmaSourceMode = (job.request.figmaSourceMode ?? "local_json") as WorkspaceFigmaSourceMode;
  const resolvedFormHandlingMode = (job.request.formHandlingMode ?? "react_hook_form") as WorkspaceFormHandlingMode;

  const executionContext: PipelineExecutionContext = {
    mode,
    job,
    ...(input ? { input } : {}),
    runtime,
    resolvedPaths: {
      outputRoot: root,
      jobsRoot,
      reprosRoot: path.join(root, "repros")
    },
    resolvedWorkspaceRoot: root,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: runtime.fetchImpl,
    paths: {
      jobDir,
      generatedProjectDir,
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir: path.join(root, "repros", jobId),
      iconMapFilePath: path.join(root, "icon-map.json"),
      designSystemFilePath: path.join(root, "design-system.json"),
      irCacheDir: path.join(root, "cache", "ir"),
      templateRoot: path.join(root, "template"),
      templateCopyFilter: () => true
    },
    artifactStore,
    resolvedBrandTheme,
    resolvedFigmaSourceMode,
    resolvedFormHandlingMode,
    ...(runtime.customerProfile ? { resolvedCustomerProfile: runtime.customerProfile } : {}),
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op for service contract tests
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // no-op for service contract tests
    }
  };

  return {
    executionContext,
    stageContextFor: (stage) => createStageRuntimeContext({ executionContext, stage })
  };
};

const seedRegenerationArtifacts = async ({
  executionContext,
  sourceJobId,
  sourceIrFile,
  sourceAnalysisFile,
  overrides = []
}: {
  executionContext: PipelineExecutionContext;
  sourceJobId: string;
  sourceIrFile?: string;
  sourceAnalysisFile?: string;
  overrides?: Array<{ field: string; nodeId: string; value: unknown }>;
}): Promise<void> => {
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.regenerationSourceIr,
    stage: "ir.derive",
    value: {
      sourceJobId,
      ...(sourceIrFile ? { sourceIrFile } : {}),
      ...(sourceAnalysisFile ? { sourceAnalysisFile } : {})
    }
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.regenerationOverrides,
    stage: "ir.derive",
    value: overrides
  });
};

test("FigmaSourceService writes cleaned artifacts for local_json mode", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );

  assert.ok(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaRaw));
  assert.ok(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaCleaned));
  assert.ok(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics));
  assert.ok(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.figmaCleanedReport));
});

test("FigmaSourceService maps missing local_json path to E_FIGMA_LOCAL_JSON_PATH", async () => {
  const { stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });

  await assert.rejects(
    async () => {
      await FigmaSourceService.execute({}, stageContextFor("figma.source"));
    },
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "E_FIGMA_LOCAL_JSON_PATH"
  );
});

test("IrDeriveService writes design.ir and figma.analysis for cleaned local_json input", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), executionContext.paths.designIrFile);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService persists screenVariantFamilies together with appShells for the variant-shell fixture", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "variant-shell-fixture.json");
  const fixturePayload = await readFile(
    path.resolve(process.cwd(), "src/parity/fixtures/golden/variant-shell-signals/figma.json"),
    "utf8"
  );
  await writeFile(localPayloadPath, fixturePayload, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const derivedIr = JSON.parse(await readFile(executionContext.paths.designIrFile, "utf8")) as DesignIR;
  assert.equal(derivedIr.appShells?.length, 1);
  assert.equal(derivedIr.screenVariantFamilies?.length, 1);
  assert.equal(derivedIr.screenVariantFamilies?.[0]?.canonicalScreenId, "1:66050");
});

test("IrDeriveService writes and registers figma.library_resolution for external local_json components", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma-library.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayloadWithExternalComponent(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const libraryResolutionPath = await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution);
  assert.equal(
    libraryResolutionPath,
    path.join(executionContext.paths.jobDir, "storybook", "public", "figma-library-resolution.json")
  );
  const artifact = JSON.parse(await readFile(libraryResolutionPath as string, "utf8")) as {
    artifact: string;
    summary: {
      total: number;
      partial: number;
      resolved: number;
      error: number;
      cacheHit: number;
      offlineReused: number;
    };
  };
  assert.equal(artifact.artifact, "figma.library_resolution");
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.resolved, 0);
  assert.equal(artifact.summary.partial, 1);
  assert.equal(artifact.summary.error, 0);
  assert.equal(artifact.summary.cacheHit, 0);
  assert.equal(artifact.summary.offlineReused, 0);
});

test("IrDeriveService writes and registers component.match_report for local_json inputs with Storybook artifacts", async () => {
  const storybookBuildDir = await createComponentMatchStorybookBuild();
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    requestOverrides: {
      storybookStaticDir: storybookBuildDir
    }
  });
  executionContext.requestedStorybookStaticDir = storybookBuildDir;
  executionContext.resolvedStorybookStaticDir = storybookBuildDir;
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const localPayloadPath = path.join(executionContext.paths.jobDir, "local-figma-component-match.json");
  await writeFile(localPayloadPath, `${JSON.stringify(createLocalFigmaPayloadWithMatchFamilies(), null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: localPayloadPath
    },
    stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const componentMatchReportPath = await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
  assert.equal(
    componentMatchReportPath,
    path.join(executionContext.paths.jobDir, "storybook", "public", "component-match-report.json")
  );
  const artifact = JSON.parse(await readFile(componentMatchReportPath as string, "utf8")) as {
    artifact: string;
    summary: {
      totalFigmaFamilies: number;
      matched: number;
      ambiguous: number;
      unmatched: number;
      libraryResolution: {
        byStatus: Record<string, number>;
        byReason: Record<string, number>;
      };
    };
    entries: Array<{
      storybookFamily?: { name?: string };
      libraryResolution?: { status?: string; reason?: string; componentKey?: string; import?: { package?: string } };
      resolvedApi?: { status?: string; allowedProps?: Array<{ name?: string }> };
      resolvedProps?: { status?: string; codegenCompatible?: boolean };
    }>;
  };
  assert.equal(artifact.artifact, "component.match_report");
  assert.equal(artifact.summary.totalFigmaFamilies, 6);
  assert.equal(artifact.summary.matched, 6);
  assert.equal(artifact.summary.ambiguous, 0);
  assert.equal(artifact.summary.unmatched, 0);
  assert.equal(artifact.summary.libraryResolution.byStatus.resolved_import, 3);
  assert.equal(artifact.summary.libraryResolution.byStatus.mui_fallback_denied, 2);
  assert.equal(artifact.summary.libraryResolution.byStatus.mui_fallback_allowed, 1);
  const buttonEntry = artifact.entries.find((entry) => entry.storybookFamily?.name === "Button");
  assert.equal(buttonEntry?.libraryResolution?.status, "resolved_import");
  assert.equal(buttonEntry?.libraryResolution?.componentKey, "Button");
  assert.equal(buttonEntry?.libraryResolution?.import?.package, "@customer/components");
  assert.equal(buttonEntry?.resolvedApi?.status, "resolved");
  assert.equal(buttonEntry?.resolvedProps?.status, "resolved");
  assert.equal(buttonEntry?.resolvedProps?.codegenCompatible, true);
  assert.equal(buttonEntry?.resolvedApi?.allowedProps?.some((prop) => prop.name === "appearance"), true);
});

test("IrDeriveService cache hits still write and register figma.analysis", async () => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-cache-"));
  const first = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-cache-seed"
  });
  const second = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-cache-hit"
  });
  const payload = createLocalFigmaPayload();
  const firstLocalPayloadPath = path.join(first.executionContext.paths.jobDir, "local-figma.json");
  const secondLocalPayloadPath = path.join(second.executionContext.paths.jobDir, "local-figma.json");
  await writeFile(firstLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(secondLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: firstLocalPayloadPath
    },
    first.stageContextFor("figma.source")
  );
  const cleanedFile = JSON.parse(await readFile(first.executionContext.paths.figmaJsonFile, "utf8")) as unknown;
  await saveCachedIr({
    cacheDir: first.executionContext.paths.irCacheDir,
    contentHash: computeContentHash(cleanedFile),
    optionsHash: computeOptionsHash({
      screenElementBudget: first.executionContext.runtime.figmaScreenElementBudget,
      screenElementMaxDepth: first.executionContext.runtime.figmaScreenElementMaxDepth,
      brandTheme: first.executionContext.resolvedBrandTheme,
      figmaSourceMode: first.executionContext.resolvedFigmaSourceMode
    }),
    ttlMs: first.executionContext.runtime.irCacheTtlMs,
    ir: createMinimalIr(),
    onLog: () => {
      // no-op for cache seeding in tests
    }
  });

  await FigmaSourceService.execute(
    {
      figmaJsonPath: secondLocalPayloadPath
    },
    second.stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, second.stageContextFor("ir.derive"));

  assert.equal(await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), second.executionContext.paths.designIrFile);
  assert.equal(
    await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    second.executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(second.executionContext.paths.designIrFile, "utf8")).includes("Screen 1"), true);
  assert.equal((await readFile(second.executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService cache hits still write and register figma.library_resolution", async () => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-library-cache-hit-"));
  const first = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-library-cache-seed"
  });
  const second = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    rootDir: sharedRoot,
    jobId: "job-stage-library-cache-hit"
  });
  const payload = createLocalFigmaPayloadWithExternalComponent();
  const firstLocalPayloadPath = path.join(first.executionContext.paths.jobDir, "local-figma-library.json");
  const secondLocalPayloadPath = path.join(second.executionContext.paths.jobDir, "local-figma-library.json");
  await writeFile(firstLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(secondLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: firstLocalPayloadPath
    },
    first.stageContextFor("figma.source")
  );
  const cleanedFile = JSON.parse(await readFile(first.executionContext.paths.figmaJsonFile, "utf8")) as unknown;
  await saveCachedIr({
    cacheDir: first.executionContext.paths.irCacheDir,
    contentHash: computeContentHash(cleanedFile),
    optionsHash: computeOptionsHash({
      screenElementBudget: first.executionContext.runtime.figmaScreenElementBudget,
      screenElementMaxDepth: first.executionContext.runtime.figmaScreenElementMaxDepth,
      brandTheme: first.executionContext.resolvedBrandTheme,
      figmaSourceMode: first.executionContext.resolvedFigmaSourceMode
    }),
    ttlMs: first.executionContext.runtime.irCacheTtlMs,
    ir: createMinimalIr(),
    onLog: () => {
      // no-op for cache seeding in tests
    }
  });

  await FigmaSourceService.execute(
    {
      figmaJsonPath: secondLocalPayloadPath
    },
    second.stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, second.stageContextFor("ir.derive"));

  const libraryResolutionPath = await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution);
  assert.equal(
    libraryResolutionPath,
    path.join(second.executionContext.paths.jobDir, "storybook", "public", "figma-library-resolution.json")
  );
  const artifact = JSON.parse(await readFile(libraryResolutionPath as string, "utf8")) as {
    summary: { total: number; partial: number };
  };
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.partial, 1);
});

test("IrDeriveService cache hits still write and register component.match_report", async () => {
  const storybookBuildDir = await createComponentMatchStorybookBuild();
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-component-match-cache-hit-"));
  const first = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    requestOverrides: {
      storybookStaticDir: storybookBuildDir
    },
    rootDir: sharedRoot,
    jobId: "job-stage-component-match-cache-seed"
  });
  const second = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    requestOverrides: {
      storybookStaticDir: storybookBuildDir
    },
    rootDir: sharedRoot,
    jobId: "job-stage-component-match-cache-hit"
  });
  first.executionContext.requestedStorybookStaticDir = storybookBuildDir;
  first.executionContext.resolvedStorybookStaticDir = storybookBuildDir;
  second.executionContext.requestedStorybookStaticDir = storybookBuildDir;
  second.executionContext.resolvedStorybookStaticDir = storybookBuildDir;

  const payload = createLocalFigmaPayloadWithMatchFamilies();
  const firstLocalPayloadPath = path.join(first.executionContext.paths.jobDir, "local-figma-component-match.json");
  const secondLocalPayloadPath = path.join(second.executionContext.paths.jobDir, "local-figma-component-match.json");
  await writeFile(firstLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(secondLocalPayloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  await FigmaSourceService.execute(
    {
      figmaJsonPath: firstLocalPayloadPath
    },
    first.stageContextFor("figma.source")
  );
  const cleanedFile = JSON.parse(await readFile(first.executionContext.paths.figmaJsonFile, "utf8")) as unknown;
  await saveCachedIr({
    cacheDir: first.executionContext.paths.irCacheDir,
    contentHash: computeContentHash(cleanedFile),
    optionsHash: computeOptionsHash({
      screenElementBudget: first.executionContext.runtime.figmaScreenElementBudget,
      screenElementMaxDepth: first.executionContext.runtime.figmaScreenElementMaxDepth,
      brandTheme: first.executionContext.resolvedBrandTheme,
      figmaSourceMode: first.executionContext.resolvedFigmaSourceMode
    }),
    ttlMs: first.executionContext.runtime.irCacheTtlMs,
    ir: createMinimalIr(),
    onLog: () => {
      // no-op for cache seeding in tests
    }
  });

  await FigmaSourceService.execute(
    {
      figmaJsonPath: secondLocalPayloadPath
    },
    second.stageContextFor("figma.source")
  );
  await IrDeriveService.execute(undefined, second.stageContextFor("ir.derive"));

  const componentMatchReportPath = await second.executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
  assert.equal(
    componentMatchReportPath,
    path.join(second.executionContext.paths.jobDir, "storybook", "public", "component-match-report.json")
  );
  const artifact = JSON.parse(await readFile(componentMatchReportPath as string, "utf8")) as {
    summary: { totalFigmaFamilies: number; matched: number };
  };
  assert.equal(artifact.summary.totalFigmaFamilies, 6);
  assert.equal(artifact.summary.matched, 6);
});

test("IrDeriveService regeneration reads seeded artifacts and writes design.ir and figma.analysis", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-figma-analysis.json");
  const sourceAnalysis = {
    artifactVersion: 1,
    sourceName: "test",
    summary: { topLevelFrameCount: 1 },
    diagnostics: [
      {
        code: "SOURCE_ANALYSIS_PRESERVED",
        severity: "info",
        message: "Preserve this analysis",
        reasons: []
      }
    ]
  };
  await writeFile(sourceIrPath, `${JSON.stringify(createMinimalIr(), null, 2)}\n`, "utf8");
  await writeFile(sourceAnalysisPath, `${JSON.stringify(sourceAnalysis, null, 2)}\n`, "utf8");
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr), executionContext.paths.designIrFile);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaAnalysis),
    executionContext.paths.figmaAnalysisFile
  );
  assert.equal((await readFile(executionContext.paths.designIrFile, "utf8")).includes("Screen 1"), true);
  assert.deepEqual(JSON.parse(await readFile(executionContext.paths.figmaAnalysisFile, "utf8")), sourceAnalysis);
});

test("IrDeriveService regeneration emits fallback figma.analysis when applied overrides would stale the source analysis", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-stale-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-stale-figma-analysis.json");
  const sourceIr = createMinimalIr();
  sourceIr.screens[0]!.children = [
    {
      id: "box-1",
      name: "Box",
      nodeType: "FRAME",
      type: "container",
      width: 320,
      height: 180,
      children: []
    }
  ];
  await writeFile(sourceIrPath, `${JSON.stringify(sourceIr, null, 2)}\n`, "utf8");
  await writeFile(
    sourceAnalysisPath,
    `${JSON.stringify(
      {
        artifactVersion: 1,
        sourceName: "stale-analysis",
        frameVariantGroups: [
          {
            groupId: "stale-group",
            frameIds: ["stale-screen"],
            frameNames: ["Stale Screen"],
            canonicalFrameId: "stale-screen",
            confidence: 1,
            similarityReasons: [],
            fallbackReasons: [],
            variantAxes: []
          }
        ],
        diagnostics: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath,
    overrides: [
      {
        nodeId: "box-1",
        field: "width",
        value: 440
      }
    ]
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const regeneratedAnalysis = JSON.parse(await readFile(executionContext.paths.figmaAnalysisFile, "utf8")) as {
    diagnostics?: Array<{ code?: string }>;
    frameVariantGroups?: unknown[];
  };
  assert.deepEqual(regeneratedAnalysis.frameVariantGroups, []);
  assert.equal(
    regeneratedAnalysis.diagnostics?.some((entry) => entry.code === "REGEN_SOURCE_ANALYSIS_STALE"),
    true
  );
});

test("IrDeriveService regeneration strips affected screenVariantFamilies when overrides touch a family member", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-family-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-family-analysis.json");
  const sourceIr = createMinimalIr();
  sourceIr.screens = [
    {
      id: "family-brutto",
      name: "Pricing Brutto",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-brutto-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Brutto"
        }
      ]
    },
    {
      id: "family-canonical",
      name: "Pricing Netto",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-canonical-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Netto"
        }
      ]
    }
  ];
  sourceIr.screenVariantFamilies = [
    {
      familyId: "family-1",
      canonicalScreenId: "family-canonical",
      memberScreenIds: ["family-brutto", "family-canonical"],
      axes: ["pricing-mode"],
      scenarios: [
        {
          screenId: "family-brutto",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "brutto"
          }
        },
        {
          screenId: "family-canonical",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "netto"
          }
        }
      ]
    }
  ];
  await writeFile(sourceIrPath, `${JSON.stringify(sourceIr, null, 2)}\n`, "utf8");
  await writeFile(sourceAnalysisPath, `${JSON.stringify({ artifactVersion: 1, sourceName: "test" }, null, 2)}\n`, "utf8");
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath,
    overrides: [
      {
        nodeId: "family-brutto-copy",
        field: "fontSize",
        value: 18
      }
    ]
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const regeneratedIr = JSON.parse(await readFile(executionContext.paths.designIrFile, "utf8")) as DesignIR;
  assert.equal(regeneratedIr.screenVariantFamilies?.length ?? 0, 0);
});

test("IrDeriveService regeneration emits fallback figma.analysis when source analysis is invalid", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-invalid-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-invalid-figma-analysis.json");
  await writeFile(sourceIrPath, `${JSON.stringify(createMinimalIr(), null, 2)}\n`, "utf8");
  await writeFile(sourceAnalysisPath, "{invalid-json\n", "utf8");
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const regeneratedAnalysis = JSON.parse(await readFile(executionContext.paths.figmaAnalysisFile, "utf8")) as {
    artifactVersion: number;
    diagnostics?: Array<{ code?: string }>;
  };
  assert.equal(regeneratedAnalysis.artifactVersion, 1);
  assert.equal(
    regeneratedAnalysis.diagnostics?.some((entry) => entry.code === "REGEN_SOURCE_ANALYSIS_INVALID"),
    true
  );
  assert.equal(
    regeneratedAnalysis.diagnostics?.some((entry) => entry.code === "SOURCE_ANALYSIS_PRESERVED"),
    false
  );
});

test("IrDeriveService regeneration emits fallback figma.analysis when source analysis is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-missing-analysis-ir.json");
  await writeFile(sourceIrPath, `${JSON.stringify(createMinimalIr(), null, 2)}\n`, "utf8");
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const regeneratedAnalysis = JSON.parse(await readFile(executionContext.paths.figmaAnalysisFile, "utf8")) as {
    artifactVersion: number;
    diagnostics?: Array<{ code?: string }>;
    frameVariantGroups?: unknown[];
    appShellSignals?: unknown[];
  };
  assert.equal(regeneratedAnalysis.artifactVersion, 1);
  assert.deepEqual(regeneratedAnalysis.frameVariantGroups, []);
  assert.deepEqual(regeneratedAnalysis.appShellSignals, []);
  assert.equal(
    regeneratedAnalysis.diagnostics?.some((entry) => entry.code === "REGEN_SOURCE_ANALYSIS_UNAVAILABLE"),
    true
  );
});

test("IrDeriveService maps missing source design IR to E_REGEN_SOURCE_IR_MISSING", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "missing-source"
  });

  await assert.rejects(
    async () => {
      await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    },
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "E_REGEN_SOURCE_IR_MISSING"
  );
});

test("TemplatePrepareService copies template and stores generated.project artifact", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await mkdir(executionContext.paths.templateRoot, { recursive: true });
  await writeFile(path.join(executionContext.paths.templateRoot, "template.txt"), "template\n", "utf8");

  await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));

  assert.equal(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "template.txt"), "utf8"),
    "template\n"
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
});

test("TemplatePrepareService applies customer profile template dependencies and aliases when configured", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      customerProfile: createCustomerProfileForStageServices()
    }
  });
  await mkdir(executionContext.paths.templateRoot, { recursive: true });
  await writeFile(
    path.join(executionContext.paths.templateRoot, "package.json"),
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
    path.join(executionContext.paths.templateRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.templateRoot, "vite.config.ts"),
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

  await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));

  const packageJson = JSON.parse(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  assert.equal(packageJson.dependencies?.["@customer/components"], "^1.2.3");

  const tsconfig = JSON.parse(
    await readFile(path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"), "utf8")
  ) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  assert.equal(tsconfig.compilerOptions?.baseUrl, ".");
  assert.deepEqual(tsconfig.compilerOptions?.paths?.["@customer/ui"], ["@customer/components"]);

  const viteConfig = await readFile(path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"), "utf8");
  assert.equal(viteConfig.includes('"@customer/ui": "@customer/components"'), true);
});

test("TemplatePrepareService maps missing template to E_TEMPLATE_MISSING", async () => {
  const { stageContextFor } = await createExecutionContext({});

  await assert.rejects(
    async () => {
      await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));
    },
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code: string }).code === "E_TEMPLATE_MISSING"
  );
});

test("CodegenGenerateService reads design.ir and stores summary, manifest, metrics, and diff context", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json"), "{}\n", "utf8");
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      yield { type: "progress", screenIndex: 1, screenCount: 1, screenName: "Screen 1" } as const;
      return { generatedPaths: ["generation-metrics.json"] };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary), {
    generatedPaths: ["generation-metrics.json"]
  });
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationMetrics),
    path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json")
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentManifest),
    path.join(executionContext.paths.generatedProjectDir, "component-manifest.json")
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiffContext), {
    boardKey: resolveBoardKey("demo-board")
  });
  assert.equal(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiff), undefined);
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile), undefined);
});

test("CodegenGenerateService builds the component manifest from emitted canonical screens only", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  ir.screens = [
    {
      id: "family-brutto",
      name: "Pricing Brutto",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: []
    },
    {
      id: "family-canonical",
      name: "Pricing Netto",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: []
    },
    {
      id: "standalone",
      name: "Standalone",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: []
    }
  ];
  ir.screenVariantFamilies = [
    {
      familyId: "family-1",
      canonicalScreenId: "family-canonical",
      memberScreenIds: ["family-brutto", "family-canonical"],
      axes: ["pricing-mode"],
      scenarios: [
        {
          screenId: "family-brutto",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "brutto"
          }
        },
        {
          screenId: "family-canonical",
          contentScreenId: "family-canonical",
          initialState: {
            pricingMode: "netto"
          }
        }
      ]
    }
  ];
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });

  let manifestScreenIds: string[] = [];
  let manifestIdentityKeys: string[] = [];
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      return { generatedPaths: [] };
    },
    buildComponentManifestFn: async ({ screens, identitiesByScreenId }) => {
      manifestScreenIds = screens.map((screen) => screen.id);
      manifestIdentityKeys = [...(identitiesByScreenId?.keys() ?? [])];
      return { screens: [] };
    }
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.deepEqual(manifestScreenIds, ["family-canonical", "standalone"]);
  assert.deepEqual(manifestIdentityKeys.sort(), ["family-canonical", "standalone"]);
});

test("CodegenGenerateService accepts all streaming artifact event variants without special-case handling", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json"), "{}\n", "utf8");

  const generationSummary = {
    generatedPaths: [
      "src/theme/tokens.json",
      "src/theme/theme.ts",
      "src/ErrorBoundary.tsx",
      "src/screens/Screen.tsx",
      "src/App.tsx",
      "generation-metrics.json"
    ],
    generationMetrics: {
      fetchedNodes: 0,
      skippedHidden: 0,
      skippedPlaceholders: 0,
      screenElementCounts: [],
      truncatedScreens: [],
      degradedGeometryNodes: [],
      prototypeNavigationDetected: 0,
      prototypeNavigationResolved: 0,
      prototypeNavigationUnresolved: 0,
      prototypeNavigationRendered: 0
    },
    themeApplied: false,
    screenApplied: 0,
    screenTotal: 1,
    screenRejected: [],
    llmWarnings: [],
    mappingCoverage: {
      usedMappings: 0,
      fallbackNodes: 0,
      totalCandidateNodes: 0
    },
    mappingDiagnostics: {
      missingMappingCount: 0,
      contractMismatchCount: 0,
      disabledMappingCount: 0
    },
    mappingWarnings: []
  };

  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      yield {
        type: "theme",
        files: [
          { path: "src/theme/tokens.json", content: "{}" },
          { path: "src/theme/theme.ts", content: "export const theme = {};\n" }
        ]
      } as const;
      yield {
        type: "screen",
        screenName: "Screen 1",
        files: [{ path: "src/screens/Screen.tsx", content: "export function Screen() { return null; }\n" }]
      } as const;
      yield { type: "progress", screenIndex: 1, screenCount: 1, screenName: "Screen 1" } as const;
      yield { type: "app", file: { path: "src/App.tsx", content: "export default function App() { return null; }\n" } } as const;
      yield { type: "metrics", file: { path: "generation-metrics.json", content: "{}\n" } } as const;
      return generationSummary;
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
    executionContext.paths.generatedProjectDir
  );
  assert.deepEqual(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary), generationSummary);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationMetrics),
    path.join(executionContext.paths.generatedProjectDir, "generation-metrics.json")
  );
  assert.ok(
    executionContext.job.logs.some((entry) => entry.message.includes("Screen 1/1 completed: 'Screen 1'")),
    "progress events should still be logged"
  );
});

test("CodegenGenerateService resolves and forwards Storybook-first theme payloads", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  let forwardedGeneratorCount = 0;
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(createComponentMatchReportArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });
  executionContext.resolvedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: { fontFamily: "Brand Sans" },
            variants: {}
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: { fontFamily: "Brand Sans" },
              variants: {}
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    generateArtifactsStreamingFn: async function* (input) {
      forwardedGeneratorCount += 1;
      assert.equal(input.resolvedStorybookTheme?.brandMappingId, "sparkasse");
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 0,
          fallbackNodes: 0,
          totalCandidateNodes: 0
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(forwardedGeneratorCount, 1);
});

test("CodegenGenerateService derives storybook-first customer profile mappings from component.match_report", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      {
        ...createComponentMatchReportArtifactForStageServices(),
        summary: {
          totalFigmaFamilies: 2,
          storybookFamilyCount: 2,
          storybookEntryCount: 2,
          matched: 2,
          ambiguous: 0,
          unmatched: 0,
          libraryResolution: {
            byStatus: {
              resolved_import: 1,
              mui_fallback_allowed: 1,
              mui_fallback_denied: 0,
              not_applicable: 0
            },
            byReason: {
              profile_import_resolved: 1,
              profile_import_missing: 1,
              profile_import_family_mismatch: 0,
              profile_family_unresolved: 0,
              match_ambiguous: 0,
              match_unmatched: 0
            }
          },
          iconResolution: {
            byStatus: {
              resolved_import: 1,
              wrapper_fallback_allowed: 0,
              wrapper_fallback_denied: 0,
              unresolved: 0,
              ambiguous: 0,
              not_applicable: 1
            },
            byReason: {
              profile_icon_import_resolved: 1,
              profile_icon_import_missing: 0,
              profile_icon_wrapper_allowed: 0,
              profile_icon_wrapper_denied: 0,
              profile_icon_wrapper_missing: 0,
              match_ambiguous: 0,
              match_unmatched: 0,
              not_icon_family: 1
            }
          }
        },
        entries: [
          {
            ...createComponentMatchReportArtifactForStageServices().entries[0],
            iconResolution: {
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
            }
          },
          {
            ...createComponentMatchReportArtifactForStageServices().entries[0],
            figma: {
              familyKey: "card-family",
              familyName: "Card",
              nodeCount: 1,
              variantProperties: []
            },
            libraryResolution: {
              status: "mui_fallback_allowed",
              reason: "profile_import_missing",
              storybookTier: "Components",
              profileFamily: "Components",
              componentKey: "Card"
            },
            storybookFamily: {
              familyId: "family-card",
              title: "Components/Card",
              name: "Card",
              tier: "Components",
              storyCount: 1
            },
            storyVariant: {
              entryId: "card--default",
              storyName: "Default"
            }
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });
  executionContext.resolvedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: { fontFamily: "Brand Sans" },
            variants: {}
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: { fontFamily: "Brand Sans" },
              variants: {}
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    generateArtifactsStreamingFn: async function* (input) {
      assert.deepEqual(input.customerProfileDesignSystemConfig, {
        library: "__customer_profile__",
        mappings: {
          Button: {
            import: "@customer/components",
            export: "PrimaryButton",
            component: "CustomerButton",
            omittedProps: ["sx"]
          }
        }
      });
      assert.equal(input.storybookFirstIconLookup?.get("mail")?.status, "resolved_import");
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 0,
          fallbackNodes: 0,
          totalCandidateNodes: 0
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-match-board"
    },
    stageContextFor("codegen.generate")
  );
});

test("CodegenGenerateService resolves pattern componentMappings into exact node mappings without mutating component.match_report", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      componentMappings: [
        {
          boardKey: "storybook-board",
          canonicalComponentName: " Button ",
          componentName: " ManualButton ",
          importPath: " @manual/ui ",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]
    }
  });
  const ir = {
    ...createMinimalIr(),
    screens: [
      {
        id: "screen-1",
        name: "Screen 1",
        route: "/",
        layoutMode: "VERTICAL" as const,
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "instance-1",
            name: "Primary CTA",
            nodeType: "FRAME",
            type: "button" as const,
            semanticType: "button",
            text: "Weiter",
            children: []
          }
        ]
      }
    ]
  } as DesignIR;
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const figmaAnalysisPath = path.join(executionContext.paths.jobDir, "figma.analysis.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  const componentMatchReportArtifact = createComponentMatchReportArtifactForStageServices();
  const componentMatchReportContent = `${JSON.stringify(componentMatchReportArtifact, null, 2)}\n`;

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(
    figmaAnalysisPath,
    `${JSON.stringify(
      {
        artifactVersion: 1,
        sourceName: "stage-services-test",
        summary: {
          pageCount: 1,
          sectionCount: 0,
          topLevelFrameCount: 1,
          totalNodeCount: 1,
          totalInstanceCount: 1,
          localComponentCount: 0,
          localStyleCount: 0,
          externalComponentCount: 1
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
        componentFamilies: [
          {
            familyKey: "button-family",
            familyName: "Button",
            componentIds: ["1:100"],
            componentSetIds: ["1:200"],
            referringNodeIds: ["instance-1"],
            nodeCount: 1,
            variantProperties: []
          }
        ],
        externalComponents: [],
        frameVariantGroups: [],
        appShellSignals: [],
        componentDensity: {
          boardDominantFamilies: [],
          byFrame: [],
          hotspots: []
        },
        diagnostics: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(componentMatchReportPath, componentMatchReportContent, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
    stage: "ir.derive",
    absolutePath: figmaAnalysisPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });
  executionContext.resolvedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: { fontFamily: "Brand Sans" },
            variants: {}
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: { fontFamily: "Brand Sans" },
              variants: {}
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    generateArtifactsStreamingFn: async function* (input) {
      assert.deepEqual(input.componentMappings, [
        {
          boardKey: "storybook-board",
          nodeId: "instance-1",
          componentName: "ManualButton",
          importPath: "@manual/ui",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]);
      assert.deepEqual(input.customerProfileDesignSystemConfig, {
        library: "__customer_profile__",
        mappings: {
          Button: {
            import: "@customer/components",
            export: "PrimaryButton",
            component: "CustomerButton",
            omittedProps: ["sx"]
          }
        }
      });
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 1,
          fallbackNodes: 0,
          totalCandidateNodes: 1
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0,
          broadPatternCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-board",
      componentMappings: executionContext.input?.componentMappings
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(await readFile(componentMatchReportPath, "utf8"), componentMatchReportContent);
});

test("CodegenGenerateService warns on componentMappings boardKey mismatches but still applies exact overrides", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      componentMappings: [
        {
          boardKey: "other-board",
          nodeId: "instance-1",
          componentName: "ManualButton",
          importPath: "@manual/ui",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]
    }
  });
  const ir = createMinimalIr();
  ir.screens = [
    {
      id: "screen-1",
      name: "Screen 1",
      route: "/",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "instance-1",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter",
          children: []
        }
      ]
    }
  ];
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });

  const currentBoardKey = resolveBoardKey("storybook-board");
  const expectedWarning =
    `Component mapping rule node 'instance-1' declares boardKey 'other-board' ` +
    `but current generation boardKey is '${currentBoardKey}'; applying override for compatibility.`;

  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* (input) {
      assert.deepEqual(input.componentMappings, [
        {
          boardKey: "other-board",
          nodeId: "instance-1",
          componentName: "ManualButton",
          importPath: "@manual/ui",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]);
      assert.deepEqual(input.initialMappingWarnings, [
        {
          code: "W_COMPONENT_MAPPING_BOARD_KEY_MISMATCH",
          message: expectedWarning
        }
      ]);
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 1,
          fallbackNodes: 0,
          totalCandidateNodes: 1
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0,
          broadPatternCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-board",
      componentMappings: executionContext.input?.componentMappings
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(executionContext.job.logs.some((entry) => entry.message === expectedWarning), true);
});

test("CodegenGenerateService skips boardKey mismatch warnings when componentMappings boardKey matches the current generation target", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      componentMappings: [
        {
          boardKey: "storybook-board",
          nodeId: "instance-1",
          componentName: "ManualButton",
          importPath: "@manual/ui",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]
    }
  });
  const ir = createMinimalIr();
  ir.screens = [
    {
      id: "screen-1",
      name: "Screen 1",
      route: "/",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "instance-1",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter",
          children: []
        }
      ]
    }
  ];
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });

  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* (input) {
      assert.deepEqual(input.componentMappings, [
        {
          boardKey: "storybook-board",
          nodeId: "instance-1",
          componentName: "ManualButton",
          importPath: "@manual/ui",
          priority: 0,
          source: "local_override",
          enabled: true
        }
      ]);
      assert.equal(input.initialMappingWarnings, undefined);
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 1,
          fallbackNodes: 0,
          totalCandidateNodes: 1
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0,
          broadPatternCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-board",
      componentMappings: executionContext.input?.componentMappings
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(executionContext.job.logs.some((entry) => entry.message.includes("declares boardKey")), false);
  assert.equal(executionContext.job.logs.some((entry) => entry.message.includes("applying override for compatibility")), false);
});

test("CodegenGenerateService generates Issue #693 customer form specializations in storybook-first mode", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createIssue693IrForStageServices();
  const tokensPath = path.join(executionContext.paths.jobDir, "issue-693-storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "issue-693-storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "issue-693-component-match-report.json");

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(createIssue693ComponentMatchReportArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });
  executionContext.resolvedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createIssue693CustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: {
              fontFamily: "Brand Sans",
              fontSizePx: 16,
              fontWeight: 400,
              lineHeight: 1.5
            },
            variants: {
              displayLg: {
                fontFamily: "Brand Sans",
                fontSizePx: 32,
                fontWeight: 700,
                lineHeight: 40,
                letterSpacing: "0em"
              },
              bodyMd: {
                fontFamily: "Brand Sans",
                fontSizePx: 16,
                fontWeight: 400,
                lineHeight: 24,
                letterSpacing: "0em"
              }
            }
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: {
                fontFamily: "Brand Sans",
                fontSizePx: 16,
                fontWeight: 400,
                lineHeight: 1.5
              },
              variants: {
                displayLg: {
                  fontFamily: "Brand Sans",
                  fontSizePx: 32,
                  fontWeight: 700,
                  lineHeight: 40,
                  letterSpacing: "0em"
                },
                bodyMd: {
                  fontFamily: "Brand Sans",
                  fontSizePx: 16,
                  fontWeight: 400,
                  lineHeight: 24,
                  letterSpacing: "0em"
                }
              }
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "issue-693-storybook-board"
    },
    stageContextFor("codegen.generate")
  );

  const screenContent = await readFile(
    path.join(executionContext.paths.generatedProjectDir, toDeterministicScreenPath("Issue 693 Screen")),
    "utf8"
  );

  assert.match(screenContent, /import \{ CustomerDatePicker \} from "@customer\/forms";/);
  assert.match(screenContent, /import \{ CustomerIbanInput \} from "@customer\/forms";/);
  assert.match(screenContent, /import \{ CustomerTypography \} from "@customer\/typography";/);
  assert.match(screenContent, /import \{ CustomerDatePickerProvider \} from "@customer\/date-provider";/);
  assert.match(screenContent, /import \{ CustomerDateAdapter \} from "@customer\/date-provider";/);
  assert.match(screenContent, /<CustomerTypography[\s\S]*variant=\{"displayLg"\}/);
  assert.match(screenContent, /<CustomerIbanInput/);
  assert.match(screenContent, /<CustomerDatePicker/);
  assert.match(
    screenContent,
    /<Issue693ScreenFormContextProvider>[\s\S]*<CustomerDatePickerProvider adapterLocale=\{"de"\} dateAdapter=\{CustomerDateAdapter\}>[\s\S]*<Issue693ScreenScreenContent \/>[\s\S]*<\/CustomerDatePickerProvider>[\s\S]*<\/Issue693ScreenFormContextProvider>/
  );
});

test("CodegenGenerateService applies Issue #693 customer form specializations without storybook-first mode", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createIssue693IrForStageServices();
  const dynamicTypographyNode = ir.screens[0]?.children[0];
  if (dynamicTypographyNode && dynamicTypographyNode.type === "text") {
    dynamicTypographyNode.name = "headline-medium";
  }

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  executionContext.resolvedCustomerProfile = createIssue693CustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "issue-693-non-storybook-board"
    },
    stageContextFor("codegen.generate")
  );

  const screenContent = await readFile(
    path.join(executionContext.paths.generatedProjectDir, toDeterministicScreenPath("Issue 693 Screen")),
    "utf8"
  );

  assert.match(screenContent, /import \{ CustomerDatePicker \} from "@customer\/forms";/);
  assert.match(screenContent, /import \{ CustomerIbanInput \} from "@customer\/forms";/);
  assert.match(screenContent, /import \{ CustomerTypography \} from "@customer\/typography";/);
  assert.match(screenContent, /import \{ CustomerDatePickerProvider \} from "@customer\/date-provider";/);
  assert.match(screenContent, /import \{ CustomerDateAdapter \} from "@customer\/date-provider";/);
  assert.match(screenContent, /<CustomerTypography[\s\S]*variant=\{"h5"\}/);
  assert.match(screenContent, /<CustomerIbanInput/);
  assert.match(screenContent, /<CustomerDatePicker/);
});

test("CodegenGenerateService treats requestedStorybookStaticDir as storybook-first intent when resolved path is unavailable", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(componentMatchReportPath, `${JSON.stringify(createComponentMatchReportArtifactForStageServices(), null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  executionContext.requestedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  delete executionContext.resolvedStorybookStaticDir;
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: { fontFamily: "Brand Sans" },
            variants: {}
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: { fontFamily: "Brand Sans" },
              variants: {}
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    generateArtifactsStreamingFn: async function* (input) {
      assert.deepEqual(input.customerProfileDesignSystemConfig, {
        library: "__customer_profile__",
        mappings: {
          Button: {
            import: "@customer/components",
            export: "PrimaryButton",
            component: "CustomerButton",
            omittedProps: ["sx"]
          }
        }
      });
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 0,
          fallbackNodes: 0,
          totalCandidateNodes: 0
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-match-board-requested-only"
    },
    stageContextFor("codegen.generate")
  );
});

test("CodegenGenerateService maps invalid design.ir JSON to E_IR_EMPTY", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await writeFile(executionContext.paths.designIrFile, "{", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* () {
      return { generatedPaths: [] };
    }
  });

  await assert.rejects(
    async () => {
      await service.execute({ boardKeySeed: "demo-board" }, stageContextFor("codegen.generate"));
    },
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "E_IR_EMPTY"
  );
});

test("CodegenGenerateService excludes incompatible storybook-first mappings from component.match_report", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, "{}\n", "utf8");
  await writeFile(themesPath, "{}\n", "utf8");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      {
        ...createComponentMatchReportArtifactForStageServices(),
        entries: [
          {
            ...createComponentMatchReportArtifactForStageServices().entries[0],
            resolvedApi: {
              status: "resolved",
              componentKey: "Button",
              import: {
                package: "@customer/components",
                exportName: "PrimaryButton",
                localName: "CustomerButton"
              },
              allowedProps: [
                {
                  name: "variant",
                  kind: "enum",
                  allowedValues: ["primary"]
                }
              ],
              defaultProps: [],
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
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
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
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
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: tokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: themesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });
  executionContext.resolvedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedCustomerBrandId = "sparkasse";
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    resolveStorybookThemeFn: ({ customerBrandId }) =>
      ({
        customerBrandId: customerBrandId ?? "sparkasse",
        brandMappingId: "sparkasse",
        includeThemeModeToggle: false,
        light: {
          themeId: "sparkasse-light",
          palette: {
            primary: { main: "#dd0000" },
            text: { primary: "#111111" },
            background: { default: "#f8f8f8", paper: "#ffffff" }
          },
          spacingBase: 8,
          borderRadius: 12,
          typography: {
            fontFamily: "Brand Sans",
            base: { fontFamily: "Brand Sans" },
            variants: {}
          },
          components: {}
        },
        tokensDocument: {
          customerBrandId: customerBrandId ?? "sparkasse",
          brandMappingId: "sparkasse",
          includeThemeModeToggle: false,
          light: {
            themeId: "sparkasse-light",
            palette: {
              primary: { main: "#dd0000" },
              text: { primary: "#111111" },
              background: { default: "#f8f8f8", paper: "#ffffff" }
            },
            spacingBase: 8,
            borderRadius: 12,
            typography: {
              fontFamily: "Brand Sans",
              base: { fontFamily: "Brand Sans" },
              variants: {}
            },
            components: {}
          }
        }
      }) as ReturnType<typeof import("../../storybook/theme-resolver.js").resolveStorybookTheme>,
    generateArtifactsStreamingFn: async function* (input) {
      assert.equal(input.customerProfileDesignSystemConfig, undefined);
      return {
        generatedPaths: [],
        generationMetrics: {
          fetchedNodes: 0,
          skippedHidden: 0,
          skippedPlaceholders: 0,
          screenElementCounts: [],
          truncatedScreens: [],
          degradedGeometryNodes: [],
          prototypeNavigationDetected: 0,
          prototypeNavigationResolved: 0,
          prototypeNavigationUnresolved: 0,
          prototypeNavigationRendered: 0
        },
        themeApplied: false,
        screenApplied: 0,
        screenTotal: 1,
        screenRejected: [],
        llmWarnings: [],
        mappingCoverage: {
          usedMappings: 0,
          fallbackNodes: 0,
          totalCandidateNodes: 0
        },
        mappingDiagnostics: {
          missingMappingCount: 0,
          contractMismatchCount: 0,
          disabledMappingCount: 0
        },
        mappingWarnings: []
      };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await service.execute(
    {
      boardKeySeed: "storybook-match-board"
    },
    stageContextFor("codegen.generate")
  );
});

test("ValidateProjectService reads generated.project and writes validation.summary", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      commandStdoutMaxBytes: 12_345,
      commandStderrMaxBytes: 54_321
    }
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });
  let calledInput:
    | {
        generatedProjectDir: string;
        jobDir?: string;
        commandStdoutMaxBytes?: number;
        commandStderrMaxBytes?: number;
      }
    | undefined;
  const service = createValidateProjectService({
    runProjectValidationFn: async (input) => {
      calledInput = {
        generatedProjectDir: input.generatedProjectDir,
        jobDir: input.jobDir,
        commandStdoutMaxBytes: input.commandStdoutMaxBytes,
        commandStderrMaxBytes: input.commandStderrMaxBytes
      };
      return createSuccessfulValidationResult();
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(calledInput?.generatedProjectDir, executionContext.paths.generatedProjectDir);
  assert.equal(calledInput?.jobDir, executionContext.paths.jobDir);
  assert.equal(calledInput?.commandStdoutMaxBytes, 12_345);
  assert.equal(calledInput?.commandStderrMaxBytes, 54_321);
  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    generatedApp?: { status?: string; lint?: { args?: string[] } };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.generatedApp?.status, "ok");
  assert.deepEqual(summary?.generatedApp?.lint?.args, ["lint"]);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
});

test("ValidateProjectService persists uiA11y summary when UI validation report is available", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      enableUiValidation: true
    }
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-ui-a11y-ok"
    } satisfies GenerationDiffContext
  });
  const uiGateReportPath = path.join(executionContext.paths.jobDir, "ui-gate", "ui-gate-report.json");
  await mkdir(path.dirname(uiGateReportPath), { recursive: true });
  await writeFile(
    uiGateReportPath,
    `${JSON.stringify(
      {
        visualDiffCount: 0,
        a11yViolationCount: 0,
        interactionViolationCount: 0,
        artifacts: ["ui-gate-a11y-findings.json", "ui-gate-interaction-findings.json"],
        summary: "UI gate clean",
        checks: [
          {
            name: "a11y-static",
            status: "passed",
            count: 0
          },
          {
            name: "interaction-static",
            status: "passed",
            count: 0
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      return createSuccessfulValidationResult({
        includeUiValidation: true
      });
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    uiA11y?: {
      status?: string;
      reportPath?: string;
      visualDiffCount?: number;
      a11yViolationCount?: number;
      interactionViolationCount?: number;
      checks?: Array<{ name?: string; status?: string; count?: number }>;
      artifacts?: string[];
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.uiA11y?.status, "ok");
  assert.equal(summary?.uiA11y?.reportPath, uiGateReportPath);
  assert.equal(summary?.uiA11y?.visualDiffCount, 0);
  assert.equal(summary?.uiA11y?.a11yViolationCount, 0);
  assert.equal(summary?.uiA11y?.interactionViolationCount, 0);
  assert.equal(summary?.uiA11y?.checks?.every((entry) => entry.status === "passed"), true);
  assert.deepEqual(summary?.uiA11y?.artifacts, ["ui-gate-a11y-findings.json", "ui-gate-interaction-findings.json"]);
});

test("ValidateProjectService marks uiA11y as warn when UI validation report contains violations", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      enableUiValidation: true
    }
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-ui-a11y-warn"
    } satisfies GenerationDiffContext
  });
  const uiGateReportPath = path.join(executionContext.paths.jobDir, "ui-gate", "ui-gate-report.json");
  await mkdir(path.dirname(uiGateReportPath), { recursive: true });
  await writeFile(
    uiGateReportPath,
    `${JSON.stringify(
      {
        visualDiffCount: 1,
        a11yViolationCount: 2,
        interactionViolationCount: 0,
        artifacts: ["ui-gate-a11y-findings.json"],
        summary: "UI gate violations found",
        checks: [
          {
            name: "visual-baseline",
            status: "failed",
            count: 1
          },
          {
            name: "a11y-static",
            status: "failed",
            count: 2
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      return createSuccessfulValidationResult({
        includeUiValidation: true
      });
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    uiA11y?: {
      status?: string;
      visualDiffCount?: number;
      a11yViolationCount?: number;
      checks?: Array<{ status?: string }>;
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.uiA11y?.status, "warn");
  assert.equal(summary?.uiA11y?.visualDiffCount, 1);
  assert.equal(summary?.uiA11y?.a11yViolationCount, 2);
  assert.equal(summary?.uiA11y?.checks?.some((entry) => entry.status === "failed"), true);
  assert.equal(summary?.status, "warn");
});

test("ValidateProjectService marks uiA11y as warn when the UI validation report is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      enableUiValidation: true
    }
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-ui-a11y-missing"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      return createSuccessfulValidationResult({
        includeUiValidation: true
      });
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    uiA11y?: {
      status?: string;
      diagnostics?: string[];
      summary?: string;
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.uiA11y?.status, "warn");
  assert.equal((summary?.uiA11y?.diagnostics?.length ?? 0) > 0, true);
  assert.match(summary?.uiA11y?.summary ?? "", /missing|unreadable/i);
  assert.equal(summary?.status, "warn");
});

test("ValidateProjectService reports uiA11y.status as not_requested when UI validation is disabled", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-ui-a11y-not-requested"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    uiA11y?: {
      status?: string;
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.uiA11y?.status, "not_requested");
  assert.equal(summary?.status, "ok");
});

test("ValidateProjectService persists failed customer profile import policy before project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      customerProfile: createCustomerProfileForStageServices()
    }
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
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
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'import { Button } from "@mui/material";\nexport const App = () => <Button />;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Customer profile import policy failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    import?: {
      status?: string;
      customerProfile?: { import?: { issueCount?: number } };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.import?.status, "failed");
  assert.equal((summary?.import?.customerProfile?.import?.issueCount ?? 0) > 0, true);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
});

test("ValidateProjectService persists ok customer profile summaries when storybook-first imports agree with the profile", async () => {
  const customerProfile = createCustomerProfileForStageServices();
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      customerProfile
    }
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
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
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'import { PrimaryButton as CustomerButton } from "@customer/ui";\nexport const App = () => <CustomerButton />;\n',
    "utf8"
  );
  await applyCustomerProfileToTemplate({
    generatedProjectDir: executionContext.paths.generatedProjectDir,
    customerProfile
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-match-policy-ok"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(createComponentMatchReportArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(validationInvoked, true);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    mapping?: {
      status?: string;
      customerProfileMatch?: {
        status?: string;
        issueCount?: number;
      };
    };
    import?: {
      status?: string;
      customerProfile?: {
        status?: string;
        import?: {
          issueCount?: number;
        };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.mapping?.status, "ok");
  assert.equal(summary?.mapping?.customerProfileMatch?.status, "ok");
  assert.equal(summary?.mapping?.customerProfileMatch?.issueCount, 0);
  assert.equal(summary?.import?.status, "ok");
  assert.equal(summary?.import?.customerProfile?.status, "ok");
  assert.equal(summary?.import?.customerProfile?.import?.issueCount, 0);
});

test("ValidateProjectService surfaces unresolved icon mappings in validation.summary", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    matchPolicy: "warn"
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'export const App = () => null;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-icon-match-policy"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  const artifact = createComponentMatchReportArtifactForStageServices();
  artifact.entries[0] = {
    ...artifact.entries[0],
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
  };
  artifact.summary.iconResolution = {
    byStatus: {
      resolved_import: 0,
      wrapper_fallback_allowed: 0,
      wrapper_fallback_denied: 1,
      unresolved: 0,
      ambiguous: 0,
      not_applicable: 0
    },
    byReason: {
      profile_icon_import_resolved: 0,
      profile_icon_import_missing: 0,
      profile_icon_wrapper_allowed: 0,
      profile_icon_wrapper_denied: 1,
      profile_icon_wrapper_missing: 0,
      match_ambiguous: 0,
      match_unmatched: 0,
      not_icon_family: 0
    }
  };
  await writeFile(componentMatchReportPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });
  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    mapping?: {
      customerProfileMatch?: {
        status?: string;
        counts?: {
          iconByStatus?: Record<string, number>;
        };
        issues?: Array<{ kind?: string; iconKey?: string }>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.mapping?.customerProfileMatch?.status, "warn");
  assert.equal(summary?.mapping?.customerProfileMatch?.counts?.iconByStatus?.wrapper_fallback_denied, 1);
  assert.equal(summary?.mapping?.customerProfileMatch?.issues?.some((issue) => issue.kind === "icon" && issue.iconKey === "search"), true);
});

test("ValidateProjectService persists failed customer profile match policy before project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    matchPolicy: "error"
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-match-policy"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      createComponentMatchReportArtifactForStageServices({
        libraryResolutionStatus: "mui_fallback_denied",
        libraryResolutionReason: "profile_import_missing"
      }),
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Customer profile match policy failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    mapping?: {
      status?: string;
      customerProfileMatch?: {
        status?: string;
        issueCount?: number;
        issues?: Array<{ reason?: string }>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.mapping?.status, "failed");
  assert.equal(summary?.mapping?.customerProfileMatch?.status, "failed");
  assert.equal(summary?.mapping?.customerProfileMatch?.issueCount, 1);
  assert.equal(summary?.mapping?.customerProfileMatch?.issues?.[0]?.reason, "profile_import_missing");
});

test("ValidateProjectService marks mapping as warn and continues when customer profile match policy is warn", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    matchPolicy: "warn"
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'export const App = () => null;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-match-policy-warn"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      createComponentMatchReportArtifactForStageServices({
        matchStatus: "ambiguous",
        libraryResolutionStatus: "not_applicable",
        libraryResolutionReason: "match_ambiguous"
      }),
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(validationInvoked, true);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    mapping?: {
      status?: string;
      customerProfileMatch?: {
        status?: string;
        issueCount?: number;
        issues?: Array<{ reason?: string }>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "warn");
  assert.equal(summary?.mapping?.status, "warn");
  assert.equal(summary?.mapping?.customerProfileMatch?.status, "warn");
  assert.equal(summary?.mapping?.customerProfileMatch?.issueCount, 1);
  assert.equal(summary?.mapping?.customerProfileMatch?.issues?.[0]?.reason, "match_ambiguous");
});

test("ValidateProjectService marks mapping.componentApi as warn and continues when fallback is allowed", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    fallbackComponents: {
      Button: "allow"
    }
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'export const App = () => null;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-component-api-warn"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      {
        ...createComponentMatchReportArtifactForStageServices(),
        entries: [
          {
            ...createComponentMatchReportArtifactForStageServices().entries[0],
            resolvedApi: {
              status: "resolved",
              componentKey: "Button",
              import: {
                package: "@customer/components",
                exportName: "PrimaryButton",
                localName: "CustomerButton"
              },
              allowedProps: [
                {
                  name: "variant",
                  kind: "enum",
                  allowedValues: ["primary"]
                }
              ],
              defaultProps: [],
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
              diagnostics: [
                {
                  severity: "warning",
                  code: "component_api_children_unsupported",
                  message: "Resolved component 'Button' does not expose 'children'.",
                  targetProp: "children"
                }
              ]
            },
            resolvedProps: {
              status: "incompatible",
              fallbackPolicy: "allow",
              props: [],
              omittedProps: [],
              omittedDefaults: [],
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
              codegenCompatible: false,
              diagnostics: [
                {
                  severity: "warning",
                  code: "component_api_children_unsupported",
                  message: "Resolved component 'Button' does not expose 'children'.",
                  targetProp: "children"
                }
              ]
            }
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(validationInvoked, true);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    mapping?: {
      status?: string;
      componentApi?: {
        status?: string;
        issueCount?: number;
        issues?: Array<{ code?: string }>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "warn");
  assert.equal(summary?.mapping?.status, "warn");
  assert.equal(summary?.mapping?.componentApi?.status, "warn");
  assert.equal(summary?.mapping?.componentApi?.issueCount, 1);
  assert.equal(summary?.mapping?.componentApi?.issues?.[0]?.code, "component_api_children_unsupported");
});

test("ValidateProjectService persists failed component API policy before project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    matchPolicy: "warn"
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
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
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    'export const App = () => null;\n',
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-component-api-failed"
    } satisfies GenerationDiffContext
  });
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(
      {
        ...createComponentMatchReportArtifactForStageServices(),
        entries: [
          {
            ...createComponentMatchReportArtifactForStageServices().entries[0],
            resolvedApi: {
              status: "resolved",
              componentKey: "Button",
              import: {
                package: "@customer/components",
                exportName: "PrimaryButton",
                localName: "CustomerButton"
              },
              allowedProps: [
                {
                  name: "variant",
                  kind: "enum",
                  allowedValues: ["primary"]
                }
              ],
              defaultProps: [],
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
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
              children: {
                policy: "unsupported"
              },
              slots: {
                policy: "not_used",
                props: []
              },
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
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Customer profile component API gate failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    mapping?: {
      status?: string;
      componentApi?: {
        status?: string;
        issueCount?: number;
        issues?: Array<{ code?: string }>;
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.mapping?.status, "failed");
  assert.equal(summary?.mapping?.componentApi?.status, "failed");
  assert.equal(summary?.mapping?.componentApi?.issueCount, 1);
  assert.equal(summary?.mapping?.componentApi?.issues?.[0]?.code, "component_api_children_unsupported");
});

test("ValidateProjectService persists a failed style summary and aborts before project validation when token policy is error", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    tokenPolicy: "error"
  });

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
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
    path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"),
    `export default {};
`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    `import { CustomerButton } from "@customer/components";

export const App = () => <CustomerButton sx={{ color: "#ffffff" }}>{"Weiter"}</CustomerButton>;
`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-style-failed"
    } satisfies GenerationDiffContext
  });

  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(
      createStorybookEvidenceArtifactForStageServices({
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
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    storybookTokensPath,
    `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookThemesPath,
    `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(createComponentMatchReportArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "figma.source",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: storybookThemesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Storybook-first style guard failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    style?: {
      status?: string;
      issueCount?: number;
      issues?: Array<{ category?: string; propName?: string }>;
      storybook?: {
        evidence?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        componentMatchReport?: { status?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.style?.status, "failed");
  assert.equal(summary?.style?.issueCount, 2);
  assert.equal(
    summary?.style?.issues?.some(
      (issue) => issue.category === "disallowed_customer_component_prop" && issue.propName === "sx"
    ),
    true
  );
  assert.equal(summary?.style?.storybook?.evidence?.status, "ok");
  assert.equal(summary?.style?.storybook?.tokens?.status, "ok");
  assert.equal(summary?.style?.storybook?.themes?.status, "ok");
  assert.equal(summary?.style?.storybook?.componentMatchReport?.status, "ok");
});

test("ValidateProjectService persists a warn style summary and continues into project validation when token policy is warn", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    tokenPolicy: "warn"
  });

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    `import { PrimaryButton as CustomerButton } from "@customer/components";

export const App = () => <CustomerButton variant={"primary"} sx={{ color: "#ffffff" }}>{"Weiter"}</CustomerButton>;
`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-style-warn"
    } satisfies GenerationDiffContext
  });

  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(
      createStorybookEvidenceArtifactForStageServices({
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
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    storybookTokensPath,
    `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookThemesPath,
    `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(createComponentMatchReportArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "figma.source",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: storybookThemesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.equal(validationInvoked, true);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    style?: {
      status?: string;
      issueCount?: number;
      issues?: Array<{ category?: string }>;
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "warn");
  assert.equal(summary?.style?.status, "warn");
  assert.equal((summary?.style?.issueCount ?? 0) >= 2, true);
  assert.equal(summary?.style?.issues?.some((issue) => issue.category === "hard_coded_color_literal"), true);
});

test("ValidateProjectService fails style validation when Storybook artifacts exist but component.match_report is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    tokenPolicy: "error"
  });

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"),
    `import { Box } from "@mui/material";

export const App = () => <Box sx={{ color: "#ffffff" }} />;
`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-style-missing-match-report"
    } satisfies GenerationDiffContext
  });

  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(
      createStorybookEvidenceArtifactForStageServices({
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
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    storybookTokensPath,
    `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookThemesPath,
    `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "figma.source",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "figma.source",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "figma.source",
    absolutePath: storybookThemesPath
  });

  let validationInvoked = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      validationInvoked = true;
      return createSuccessfulValidationResult();
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /Storybook-first style guard failed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    style?: {
      status?: string;
      issueCount?: number;
      issues?: Array<{ category?: string }>;
      storybook?: {
        componentMatchReport?: { status?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.style?.status, "failed");
  assert.equal(summary?.style?.issues?.some((issue) => issue.category === "missing_component_match_report"), true);
  assert.equal(summary?.style?.issues?.some((issue) => issue.category === "hard_coded_color_literal"), true);
  assert.equal(summary?.style?.storybook?.componentMatchReport?.status, "not_available");
});

test("ValidateProjectService reports style.status as not_available for non-Storybook validation runs", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.resolvedCustomerProfile = createStorybookMatchCustomerProfileForStageServices({
    tokenPolicy: "warn"
  });

  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-style-not-available"
    } satisfies GenerationDiffContext
  });
  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"), "export const App = () => null;\n", "utf8");

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    style?: {
      status?: string;
      issueCount?: number;
      storybook?: {
        evidence?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.style?.status, "not_available");
  assert.equal(summary?.style?.issueCount, 0);
  assert.equal(summary?.style?.storybook?.evidence?.status, "not_available");
  assert.equal(summary?.style?.storybook?.tokens?.status, "not_available");
  assert.equal(summary?.style?.storybook?.themes?.status, "not_available");
});

test("ValidateProjectService forwards aborted signal to project validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  executionContext.jobAbortController.abort();
  const service = createValidateProjectService({
    runProjectValidationFn: async (input) => {
      assert.equal(input.abortSignal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    (error: unknown) => error instanceof DOMException && error.name === "AbortError"
  );
});

test("ReproExportService copies dist output and writes repro.path", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: { enablePreview: true }
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<html></html>\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });

  await ReproExportService.execute(undefined, stageContextFor("repro.export"));

  assert.equal(await readFile(path.join(executionContext.paths.reproDir, "index.html"), "utf8"), "<html></html>\n");
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.reproPath), executionContext.paths.reproDir);
});

test("GitPrService reads generation diff from the store and writes git.pr.status", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "codegen.generate",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiff,
    stage: "codegen.generate",
    value: {
      summary: "diff ready"
    }
  });
  let receivedGenerationDiff: unknown;
  const service = createGitPrService({
    runGitPrFlowFn: async (input) => {
      receivedGenerationDiff = input.generationDiff;
      return {
        status: "executed",
        prUrl: "https://example.invalid/pr/1",
        branchName: "feature/test",
        scopePath: "src",
        changedFiles: 3
      };
    }
  });

  await service.execute(
    {
      enableGitPr: true,
      repoUrl: "https://example.invalid/repo.git"
    },
    stageContextFor("git.pr")
  );

  assert.deepEqual(receivedGenerationDiff, { summary: "diff ready" });
  const gitStatus = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.gitPrStatus);
  assert.equal(gitStatus?.status, "executed");
});

test("ValidateProjectService recomputes generation diff after validation", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  let diffCallArgs: { boardKey: string; jobId: string } | undefined;
  const updatedDiff = {
    boardKey: "test-board-abc1234567",
    currentJobId: "job-stage-test",
    previousJobId: null,
    generatedAt: new Date().toISOString(),
    added: ["src/App.tsx"],
    modified: [{ file: "src/App.tsx", previousHash: "aaa", currentHash: "bbb" }],
    removed: [],
    unchanged: [],
    summary: "1 file modified, 1 added"
  };

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      // simulate lint --fix mutating a file
      return createSuccessfulValidationResult();
    },
    prepareGenerationDiffFn: async (input) => {
      diffCallArgs = { boardKey: input.boardKey, jobId: input.jobId };
      return {
        report: updatedDiff,
        snapshot: {
          boardKey: input.boardKey,
          jobId: input.jobId,
          generatedAt: new Date().toISOString(),
          files: []
        }
      };
    },
    writeGenerationDiffReportFn: async ({ jobDir }) => {
      return path.join(jobDir, "generation-diff.json");
    },
    saveCurrentSnapshotFn: async () => {
      // no-op for this contract test
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  assert.ok(diffCallArgs);
  assert.equal(diffCallArgs.boardKey, "test-board-abc1234567");
  assert.equal(diffCallArgs.jobId, "job-stage-test");

  const storedDiff = await executionContext.artifactStore.getValue<{ summary: string }>(STAGE_ARTIFACT_KEYS.generationDiff);
  assert.equal(storedDiff?.summary, "1 file modified, 1 added");

  const diffFilePath = await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile);
  assert.equal(diffFilePath, path.join(executionContext.paths.jobDir, "generation-diff.json"));
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
});

test("ValidateProjectService fails when generation diff context is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /generation\.diff\.context/
  );

  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    generatedApp?: { status?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.generatedApp?.status, "ok");
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
});

test("ValidateProjectService marks mapping as partial when only figma.library_resolution is available", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-library-resolution"
    } satisfies GenerationDiffContext
  });
  const libraryResolutionPath = path.join(
    executionContext.paths.jobDir,
    "storybook",
    "public",
    "figma-library-resolution.json"
  );
  await mkdir(path.dirname(libraryResolutionPath), { recursive: true });
  await writeFile(libraryResolutionPath, '{ "artifact": "figma.library_resolution" }\n', "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    stage: "ir.derive",
    absolutePath: libraryResolutionPath
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    mapping?: {
      status?: string;
      figmaLibraryResolution?: { status?: string };
      componentMatchReport?: { status?: string };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.mapping?.status, "partial");
  assert.equal(summary?.mapping?.figmaLibraryResolution?.status, "ok");
  assert.equal(summary?.mapping?.componentMatchReport?.status, "not_available");
});

test("ValidateProjectService marks mapping as ok when component.match_report is available", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-component-match-report"
    } satisfies GenerationDiffContext
  });
  const storybookPublicDir = path.join(executionContext.paths.jobDir, "storybook", "public");
  const libraryResolutionPath = path.join(storybookPublicDir, "figma-library-resolution.json");
  const componentMatchReportPath = path.join(storybookPublicDir, "component-match-report.json");
  await mkdir(storybookPublicDir, { recursive: true });
  await writeFile(libraryResolutionPath, '{ "artifact": "figma.library_resolution" }\n', "utf8");
  await writeFile(componentMatchReportPath, JSON.stringify({
    artifact: "component.match_report",
    version: 1,
    summary: {
      totalFigmaFamilies: 0,
      storybookFamilyCount: 0,
      storybookEntryCount: 0,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      libraryResolution: {
        byStatus: { resolved_import: 0, mui_fallback_allowed: 0, mui_fallback_denied: 0, not_applicable: 0 },
        byReason: { profile_import_resolved: 0, profile_import_missing: 0, profile_import_family_mismatch: 0, profile_family_unresolved: 0, match_ambiguous: 0, match_unmatched: 0 }
      },
      iconResolution: {
        byStatus: { resolved_import: 0, wrapper_fallback_allowed: 0, wrapper_fallback_denied: 0, unresolved: 0, ambiguous: 0, not_applicable: 0 },
        byReason: { profile_icon_import_resolved: 0, profile_icon_import_missing: 0, profile_icon_wrapper_allowed: 0, profile_icon_wrapper_denied: 0, profile_icon_wrapper_missing: 0, match_ambiguous: 0, match_unmatched: 0, not_icon_family: 0 }
      }
    },
    entries: []
  }) + "\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    stage: "ir.derive",
    absolutePath: libraryResolutionPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    mapping?: {
      status?: string;
      figmaLibraryResolution?: { status?: string };
      componentMatchReport?: { status?: string };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.mapping?.status, "ok");
  assert.equal(summary?.mapping?.figmaLibraryResolution?.status, "ok");
  assert.equal(summary?.mapping?.componentMatchReport?.status, "ok");
});

test("ValidateProjectService failure preserves the previous successful diff baseline", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });
  await saveCurrentSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    snapshot: {
      boardKey: "test-board-abc1234567",
      jobId: "job-previous-success",
      generatedAt: new Date().toISOString(),
      files: [{ relativePath: "src/App.tsx", sha256: "aaa", sizeBytes: 1 }]
    }
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      throw new Error("lint failed");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /lint failed/
  );

  const summary = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary, undefined);
  const preservedSnapshot = await loadPreviousSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    boardKey: "test-board-abc1234567"
  });
  assert.ok(preservedSnapshot !== null);
  assert.equal(preservedSnapshot.jobId, "job-previous-success");
});

test("ValidateProjectService fails fast when final diff persistence fails", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-abc1234567"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult(),
    prepareGenerationDiffFn: async (input) => {
      return {
        report: {
          boardKey: input.boardKey,
          currentJobId: input.jobId,
          previousJobId: "job-previous-success",
          generatedAt: new Date().toISOString(),
          added: ["src/App.tsx"],
          modified: [],
          removed: [],
          unchanged: [],
          summary: "1 added"
        },
        snapshot: {
          boardKey: input.boardKey,
          jobId: input.jobId,
          generatedAt: new Date().toISOString(),
          files: []
        }
      };
    },
    writeGenerationDiffReportFn: async () => {
      throw new Error("disk full");
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /disk full/
  );

  const summary = await executionContext.artifactStore.getValue<{ status: string }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
  assert.equal(await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.generationDiff), undefined);
  assert.equal(await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile), undefined);
});

test("GitPrService receives the final validation-owned generation diff", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const boardKey = "test-board-final-diff";
  const generatedProjectDir = executionContext.paths.generatedProjectDir;
  const utilsFile = path.join(generatedProjectDir, "src", "utils.ts");

  await mkdir(path.dirname(utilsFile), { recursive: true });
  await writeFile(path.join(generatedProjectDir, "src", "App.tsx"), "export default function App() {}\n", "utf8");
  await writeFile(utilsFile, "export const add = (a: number, b: number) => a + b;\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: { boardKey } satisfies GenerationDiffContext
  });
  await saveCurrentSnapshot({
    outputRoot: executionContext.resolvedPaths.outputRoot,
    snapshot: {
      boardKey,
      jobId: "job-previous-success",
      generatedAt: new Date().toISOString(),
      files: [{ relativePath: "src/utils.ts", sha256: "old-utils", sizeBytes: 1 }]
    }
  });

  const validateService = createValidateProjectService({
    runProjectValidationFn: async () => {
      await writeFile(utilsFile, "export const add = (a: number, b: number): number => a + b;\n", "utf8");
      return createSuccessfulValidationResult();
    }
  });
  await validateService.execute(undefined, stageContextFor("validate.project"));

  let receivedGenerationDiff: unknown;
  const gitPrService = createGitPrService({
    runGitPrFlowFn: async (input) => {
      receivedGenerationDiff = input.generationDiff;
      return {
        status: "executed",
        branchName: "feature/final-diff",
        scopePath: "src",
        changedFiles: 2
      };
    }
  });
  await gitPrService.execute(
    {
      enableGitPr: true,
      repoUrl: "https://example.invalid/repo.git"
    },
    stageContextFor("git.pr")
  );

  assert.ok(receivedGenerationDiff);
  assert.deepEqual(receivedGenerationDiff, {
    boardKey,
    currentJobId: executionContext.job.jobId,
    previousJobId: "job-previous-success",
    generatedAt: (receivedGenerationDiff as { generatedAt: string }).generatedAt,
    added: ["src/App.tsx"],
    modified: [
      {
        file: "src/utils.ts",
        previousHash: "old-utils",
        currentHash: (receivedGenerationDiff as { modified: Array<{ currentHash: string }> }).modified[0]?.currentHash
      }
    ],
    removed: [],
    unchanged: [],
    summary: "1 file modified, 1 added"
  });
});

test("ValidateProjectService treats partial mapping status as warn in overall summary", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-partial-mapping"
    } satisfies GenerationDiffContext
  });
  const figmaLibResolutionPath = path.join(executionContext.paths.jobDir, "figma-library-resolution.json");
  await writeFile(figmaLibResolutionPath, "{}", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    stage: "ir.derive",
    absolutePath: figmaLibResolutionPath
  });
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    mapping?: { status?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.mapping?.status, "partial");
  assert.equal(summary?.status, "warn");
});

test("ValidateProjectService includes Storybook composition coverage in summary when match report exists", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.requestedStorybookStaticDir = "/tmp/storybook-static";
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-composition-coverage"
    } satisfies GenerationDiffContext
  });
  const artifact = createComponentMatchReportArtifactForStageServices({ matchStatus: "matched" });
  artifact.entries[0].usedEvidence = [
    {
      class: "reference_only_docs" as const,
      reliability: "reference_only" as const,
      role: "candidate_selection" as const
    }
  ];
  const matchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(matchReportPath, JSON.stringify(artifact), "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: matchReportPath
  });
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status: string;
    storybook?: {
      status?: string;
      composition?: {
        totalFigmaFamilies: number;
        matched: number;
        ambiguous: number;
        unmatched: number;
        docsOnlyReferenceCount: number;
        docsOnlyFamilyNames: string[];
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.ok(summary?.storybook?.composition, "composition coverage should be present");
  assert.equal(summary.storybook.composition.totalFigmaFamilies, 1);
  assert.equal(summary.storybook.composition.matched, 1);
  assert.equal(summary.storybook.composition.unmatched, 0);
  assert.equal(summary.storybook.composition.docsOnlyReferenceCount, 1);
  assert.deepEqual(summary.storybook.composition.docsOnlyFamilyNames, ["Button"]);
});

test("ValidateProjectService logs composition gap diagnostics without customer profile", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-composition-diagnostics"
    } satisfies GenerationDiffContext
  });
  const artifact = createComponentMatchReportArtifactForStageServices({ matchStatus: "unmatched" });
  artifact.summary.matched = 0;
  artifact.summary.unmatched = 1;
  const matchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  await writeFile(matchReportPath, JSON.stringify(artifact), "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: matchReportPath
  });
  const logMessages: string[] = [];
  const service = createValidateProjectService({
    runProjectValidationFn: async (input) => {
      input.onLog("validation");
      return createSuccessfulValidationResult();
    }
  });

  const ctx = stageContextFor("validate.project");
  const originalLog = ctx.log.bind(ctx);
  ctx.log = (entry: { level: string; message: string }) => {
    logMessages.push(entry.message);
    originalLog(entry);
  };
  await service.execute(undefined, ctx);

  const compositionLog = logMessages.find((m) => m.includes("Storybook composition:") && m.includes("no Storybook match"));
  assert.ok(compositionLog, "should log unmatched composition gap diagnostic");
  assert.ok(compositionLog.includes("1 of 1"), "should report correct counts");
});
