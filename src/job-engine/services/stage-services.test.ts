import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import packageJson from "../../../package.json" with { type: "json" };
import { PNG } from "pngjs";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  BusinessTestIntentIr,
  WorkspaceJobStageName
} from "../../contracts/index.js";
import { CONTRACT_VERSION } from "../../contracts/index.js";
import { parseCustomerProfileConfig } from "../../customer-profile.js";
import { applyCustomerProfileToTemplate } from "../../customer-profile-template.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { toDeterministicScreenPath } from "../../parity/generator-artifacts.js";
import { buildTypographyScaleFromAliases } from "../../parity/typography-tokens.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "../../storybook/types.js";
import { createStageRuntimeContext, type PipelineExecutionContext, type StageRuntimeContext } from "../pipeline/context.js";
import { syncPublicJobProjection } from "../pipeline/public-job-projection.js";
import { loadPreviousSnapshot, saveCurrentSnapshot, type GenerationDiffContext } from "../generation-diff.js";
import { computeContentHash, computeOptionsHash, saveCachedIr } from "../ir-cache.js";
import { JobDiskTracker } from "../disk-tracker.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { createPasteFingerprintStore } from "../paste-fingerprint-store.js";
import { buildFingerprintNodes } from "../paste-tree-diff.js";
import type { SubmissionJobInput } from "../types.js";
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
import { createPipelineError } from "../errors.js";

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

const createFigmaLibraryResolverFetchImpl = (): typeof fetch => {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);

    if (url === "https://api.figma.com/v1/components/cmp-key") {
      return new Response(
        JSON.stringify({
          meta: {
            key: "cmp-key",
            file_key: "library-file",
            node_id: "10:20",
            name: "Button, Variant=Primary, State=Default"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (url === "https://api.figma.com/v1/component_sets/set-key") {
      return new Response(
        JSON.stringify({
          meta: {
            key: "set-key",
            file_key: "library-file",
            node_id: "10:10",
            name: "Button, Variant=Primary, State=Default"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };
};

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
  includeUiValidation = false,
  includePerfValidation = false
}: {
  attempts?: number;
  includeUiValidation?: boolean;
  includePerfValidation?: boolean;
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
      : {}),
    ...(includePerfValidation
      ? {
          perfAssert: {
            status: "passed" as const,
            command: "pnpm" as const,
            args: ["run", "perf:assert"],
            attempt: attempts,
            timedOut: false
          }
        }
      : {})
  };
};

const createSolidPngBuffer = ({
  width = 4,
  height = 4,
  rgba = [255, 255, 255, 255]
}: {
  width?: number;
  height?: number;
  rgba?: [number, number, number, number];
} = {}): Buffer => {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = rgba[0];
    png.data[index + 1] = rgba[1];
    png.data[index + 2] = rgba[2];
    png.data[index + 3] = rgba[3];
  }
  return PNG.sync.write(png);
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
          profile_family_unresolved: 0,
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

const createStorybookCatalogArtifactForStageServices = () => {
  return {
    artifact: "storybook.catalog",
    version: 1,
    stats: {
      entryCount: 0,
      familyCount: 0,
      byEntryType: {
        story: 0,
        docs: 0
      },
      byTier: {},
      byDocsAttachment: {
        attached: 0,
        unattached: 0,
        not_applicable: 0
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
    entries: [],
    families: []
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

const createStorybookComponentsArtifactForStageServices = () => {
  return {
    artifact: "storybook.components",
    version: 1,
    stats: {
      entryCount: 0,
      componentCount: 0,
      componentWithDesignReferenceCount: 0,
      propKeyCount: 0
    },
    components: []
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
      enableVisualQualityValidation: false,
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
  input?: SubmissionJobInput;
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
  const diskTracker = new JobDiskTracker({
    roots: [jobDir, path.join(root, "repros", jobId)],
    limitBytes: runtime.maxJobDiskBytes,
    limits: runtime.pipelineDiagnosticLimits
  });
  await diskTracker.sync();
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
    diskTracker,
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

test("FigmaSourceService rejects local_json traversal and absolute paths outside the workspace root", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const outsidePath = path.join(path.dirname(executionContext.resolvedWorkspaceRoot), "outside-figma.json");

  for (const figmaJsonPath of ["../outside-figma.json", outsidePath]) {
    await assert.rejects(
      () =>
        FigmaSourceService.execute(
          {
            figmaJsonPath
          },
          stageContextFor("figma.source")
        ),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const typed = error as Error & { code?: string };
        assert.equal(typed.code, "E_FIGMA_LOCAL_JSON_PATH");
        assert.equal(typed.message.includes(figmaJsonPath), false);
        assert.match(typed.message, /workspace root/i);
        return true;
      }
    );
  }
});

test("FigmaSourceService rejects local_json paths containing null bytes", async () => {
  const { stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });

  await assert.rejects(
    () =>
      FigmaSourceService.execute(
        {
          figmaJsonPath: "local-figma.json\0evil"
        },
        stageContextFor("figma.source")
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & { code?: string };
      assert.equal(typed.code, "E_FIGMA_LOCAL_JSON_PATH");
      assert.match(typed.message, /null byte/i);
      return true;
    }
  );
});

test("FigmaSourceService keeps missing local_json read errors free of workspace path leakage", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  const missingPath = path.join(executionContext.resolvedWorkspaceRoot, "missing-figma.json");

  await assert.rejects(
    () =>
      FigmaSourceService.execute(
        {
          figmaJsonPath: missingPath
        },
        stageContextFor("figma.source")
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & { code?: string };
      assert.equal(typed.code, "E_FIGMA_LOCAL_JSON_READ");
      assert.equal(typed.message.includes(missingPath), false);
      assert.equal(typed.message.includes(executionContext.resolvedWorkspaceRoot), false);
      assert.match(typed.message, /Could not read local Figma JSON file/i);
      return true;
    }
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
  const businessTestIntentIrPath = path.join(
    executionContext.paths.jobDir,
    "business-test-intent-ir.json"
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.businessTestIntentIr),
    businessTestIntentIrPath
  );
  const businessTestIntentIr = JSON.parse(
    await readFile(businessTestIntentIrPath, "utf8")
  ) as BusinessTestIntentIr;
  assert.equal(businessTestIntentIr.source.kind, "figma_local_json");
  assert.equal(businessTestIntentIr.screens[0]?.screenId, "screen-1");
  assert.equal(businessTestIntentIr.detectedFields[0]?.trace.nodeId, "title-1");
  assert.equal((await readFile(executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
});

test("IrDeriveService maps structured parity no-screen errors to E_IR_EMPTY", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    }
  });
  await writeFile(
    executionContext.paths.figmaJsonFile,
    `${JSON.stringify(
      {
        name: "Empty Derived Board",
        document: { id: "0:0", type: "DOCUMENT", children: [] }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaCleaned,
    stage: "figma.source",
    absolutePath: executionContext.paths.figmaJsonFile
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
    stage: "figma.source",
    value: {
      sourceMode: "local-json",
      fetchedNodes: 0,
      degradedGeometryNodes: []
    }
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.figmaCleanedReport,
    stage: "figma.source",
    value: {
      inputNodeCount: 1,
      outputNodeCount: 1,
      removedHiddenNodes: 0,
      removedPlaceholderNodes: 0,
      removedHelperNodes: 0,
      removedInvalidNodes: 0,
      removedPropertyCount: 0,
      screenCandidateCount: 1
    }
  });

  await assert.rejects(
    async () => {
      await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    },
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & {
        code?: string;
        stage?: string;
        diagnostics?: Array<{ code?: string }>;
      };
      assert.equal(typed.code, "E_IR_EMPTY");
      assert.equal(typed.stage, "ir.derive");
      assert.equal(typed.message, "No screen found in IR.");
      assert.equal(
        typed.diagnostics?.some((entry) => entry.code === "E_IR_EMPTY"),
        true
      );
      return true;
    }
  );
});

test("IrDeriveService records Sparkasse token diagnostics for an invalid configured source", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json"
    },
    requestOverrides: {
      brandTheme: "sparkasse"
    },
    runtimeOverrides: {
      sparkasseTokensFilePath: "/definitely/missing/sparkasse-tokens.json"
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

  const designIr = JSON.parse(await readFile(executionContext.paths.designIrFile, "utf8")) as DesignIR;
  assert.equal(
    designIr.metrics?.nodeDiagnostics?.some((entry) => entry.category === "sparkasse-theme-load-failure"),
    true
  );
  assert.equal(designIr.tokens.palette.primary, "#EE0000");
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

test("IrDeriveService local_json reuses seeded figma.library_resolution cache entries end-to-end", async () => {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-stage-service-library-cache-hit-"));
  const fetchImpl = createFigmaLibraryResolverFetchImpl();
  const first = await createExecutionContext({
    runtimeOverrides: {
      fetchImpl
    },
    rootDir: sharedRoot,
    jobId: "job-stage-library-cache-seed"
  });
  const second = await createExecutionContext({
    requestOverrides: {
      figmaSourceMode: "local_json"
    },
    runtimeOverrides: {
      fetchImpl
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
  first.executionContext.resolvedFigmaSourceMode = "rest";
  await IrDeriveService.execute(
    {
      figmaFileKey: "board-key",
      figmaAccessToken: "token"
    },
    first.stageContextFor("ir.derive")
  );

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
    entries: Array<{
      status?: string;
      resolutionSource?: string;
      originFileKey?: string;
      canonicalFamilyNameSource?: string;
      variantProperties?: Array<{ property?: string; values?: string[] }>;
    }>;
    summary: {
      total: number;
      resolved: number;
      partial: number;
      cacheHit: number;
      offlineReused: number;
    };
  };
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.resolved, 1);
  assert.equal(artifact.summary.partial, 0);
  assert.equal(artifact.summary.cacheHit, 1);
  assert.equal(artifact.summary.offlineReused, 1);
  assert.equal(artifact.entries[0]?.status, "resolved");
  assert.equal(artifact.entries[0]?.resolutionSource, "cache");
  assert.equal(artifact.entries[0]?.originFileKey, "library-file");
  assert.equal(artifact.entries[0]?.canonicalFamilyNameSource, "published_component_set");
  assert.deepEqual(artifact.entries[0]?.variantProperties, [
    {
      property: "state",
      values: ["Default", "Primary"]
    },
    {
      property: "variant",
      values: ["Primary"]
    }
  ]);
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

test("IrDeriveService regeneration strips only the affected family when duplicate family ids are carried forward", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-duplicate-family-id-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-duplicate-family-id-analysis.json");
  const sourceIr = createMinimalIr();
  sourceIr.screens = [
    {
      id: "family-a-member",
      name: "Family A Member",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-a-member-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Family A Member"
        }
      ]
    },
    {
      id: "family-a-canonical",
      name: "Family A Canonical",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-a-canonical-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Family A Canonical"
        }
      ]
    },
    {
      id: "family-b-member",
      name: "Family B Member",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-b-member-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Family B Member"
        }
      ]
    },
    {
      id: "family-b-canonical",
      name: "Family B Canonical",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "family-b-canonical-copy",
          name: "Copy",
          nodeType: "TEXT",
          type: "text",
          text: "Family B Canonical"
        }
      ]
    }
  ];
  sourceIr.screenVariantFamilies = [
    {
      familyId: "family-duplicate",
      canonicalScreenId: "family-a-canonical",
      memberScreenIds: ["family-a-member", "family-a-canonical"],
      axes: ["pricing-mode"],
      scenarios: [
        {
          screenId: "family-a-member",
          contentScreenId: "family-a-canonical",
          initialState: {
            pricingMode: "member"
          }
        },
        {
          screenId: "family-a-canonical",
          contentScreenId: "family-a-canonical",
          initialState: {
            pricingMode: "canonical"
          }
        }
      ]
    },
    {
      familyId: "family-duplicate",
      canonicalScreenId: "family-b-canonical",
      memberScreenIds: ["family-b-member", "family-b-canonical"],
      axes: ["pricing-mode"],
      scenarios: [
        {
          screenId: "family-b-member",
          contentScreenId: "family-b-canonical",
          initialState: {
            pricingMode: "member"
          }
        },
        {
          screenId: "family-b-canonical",
          contentScreenId: "family-b-canonical",
          initialState: {
            pricingMode: "canonical"
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
        nodeId: "family-a-member-copy",
        field: "fontSize",
        value: 18
      }
    ]
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const regeneratedIr = JSON.parse(await readFile(executionContext.paths.designIrFile, "utf8")) as DesignIR;
  assert.equal(regeneratedIr.screenVariantFamilies?.length ?? 0, 1);
  assert.equal(regeneratedIr.screenVariantFamilies?.[0]?.canonicalScreenId, "family-b-canonical");
});

test("IrDeriveService regeneration logs validation warnings for invalid carried-forward appShell IR", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    mode: "regeneration"
  });
  const sourceIrPath = path.join(executionContext.paths.jobDir, "source-invalid-app-shell-ir.json");
  const sourceAnalysisPath = path.join(executionContext.paths.jobDir, "source-invalid-app-shell-analysis.json");
  const sourceIr = createMinimalIr();
  sourceIr.appShells = [
    {
      id: "app-shell-1",
      sourceScreenId: "screen-1",
      screenIds: ["screen-1"],
      shellNodeIds: ["missing-shell-node"],
      slotIndex: 1,
      signalIds: ["signal-1"]
    }
  ];
  await writeFile(sourceIrPath, `${JSON.stringify(sourceIr, null, 2)}\n`, "utf8");
  await writeFile(sourceAnalysisPath, `${JSON.stringify({ artifactVersion: 1, sourceName: "test" }, null, 2)}\n`, "utf8");
  await seedRegenerationArtifacts({
    executionContext,
    sourceJobId: "source-job",
    sourceIrFile: sourceIrPath,
    sourceAnalysisFile: sourceAnalysisPath
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  assert.equal(
    executionContext.job.logs.some((entry) =>
      entry.level === "warn" &&
      entry.message.includes("AppShell IR validation warnings after derivation:") &&
      entry.message.includes("IR_APP_SHELL_INVALID_SHELL_NODE")
    ),
    true
  );
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

test("FigmaSourceService keeps summary but disables reuse when figmaFileKey is unavailable", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    input: {
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      figmaJsonPath: "",
      pasteDeltaSeed: {
        pasteIdentityKey: "paste-no-file-key",
        requestedMode: "auto",
      },
    } as SubmissionJobInput,
  });
  const payloadPath = path.join(executionContext.paths.jobDir, "payload.json");
  const payload = createLocalFigmaPayload();
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  executionContext.input = {
    ...executionContext.input!,
    figmaJsonPath: payloadPath,
    pasteDeltaSeed: {
      ...executionContext.input!.pasteDeltaSeed!,
      provisionalSummary: {
        mode: "auto_resolved_to_full",
        strategy: "baseline_created",
        totalNodes: 2,
        nodesReused: 0,
        nodesReprocessed: 2,
        structuralChangeRatio: 1,
        pasteIdentityKey: "paste-no-file-key",
        priorManifestMissing: false,
      },
      sourceJobId: "source-job-1",
    },
  };
  const roots = [payload.document.children[0]! as Record<string, unknown>];
  const fingerprints = buildFingerprintNodes(roots as never);
  const store = createPasteFingerprintStore({
    rootDir: path.join(executionContext.resolvedPaths.outputRoot, "paste-fingerprints"),
  });
  await store.save({
    contractVersion: CONTRACT_VERSION,
    pasteIdentityKey: "paste-no-file-key",
    createdAt: "2026-04-14T00:00:00.000Z",
    rootNodeIds: fingerprints.rootNodeIds,
    nodes: fingerprints.nodes,
    sourceJobId: "source-job-1",
  });

  await FigmaSourceService.execute(
    {
      figmaJsonPath: payloadPath,
    },
    stageContextFor("figma.source"),
  );

  const deltaExecution = await executionContext.artifactStore.getValue(
    STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
  );
  assert.equal(
    (deltaExecution as { summary: { strategy: string; mode: string } }).summary.strategy,
    "baseline_created",
  );
  assert.equal(
    (deltaExecution as { summary: { strategy: string; mode: string } }).summary.mode,
    "auto_resolved_to_full",
  );
  assert.equal(
    (deltaExecution as { eligibleForReuse: boolean }).eligibleForReuse,
    false,
  );
});

test("IrDeriveService reuses source IR for no-change delta executions", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const payloadPath = path.join(executionContext.paths.jobDir, "payload.json");
  await writeFile(
    payloadPath,
    `${JSON.stringify(createLocalFigmaPayload(), null, 2)}\n`,
    "utf8",
  );

  await FigmaSourceService.execute(
    {
      figmaJsonPath: payloadPath,
    },
    stageContextFor("figma.source"),
  );

  const sourceJobDir = path.join(
    executionContext.resolvedPaths.jobsRoot,
    "source-no-change",
  );
  await mkdir(sourceJobDir, { recursive: true });
  const sourceIr = createMinimalIr();
  const sourceIrPath = path.join(sourceJobDir, "design-ir.json");
  await writeFile(sourceIrPath, `${JSON.stringify(sourceIr, null, 2)}\n`, "utf8");
  executionContext.sourceJob = {
    ...createJobRecord({
      runtime: executionContext.runtime,
      jobDir: sourceJobDir,
    }),
    jobId: "source-no-change",
    artifacts: {
      ...createJobRecord({
        runtime: executionContext.runtime,
        jobDir: sourceJobDir,
      }).artifacts,
      designIrFile: sourceIrPath,
    },
  };
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    stage: "figma.source",
    value: {
      pasteIdentityKey: "paste-1",
      requestedMode: "auto",
      summary: {
        mode: "auto_resolved_to_delta",
        strategy: "no_changes",
        totalNodes: 2,
        nodesReused: 2,
        nodesReprocessed: 0,
        structuralChangeRatio: 0,
        pasteIdentityKey: "paste-1",
        priorManifestMissing: false,
      },
      currentFingerprintNodes: [],
      rootNodeIds: ["screen-1"],
      changedNodeIds: [],
      changedRootNodeIds: [],
      sourceJobId: "source-no-change",
      eligibleForReuse: true,
    },
  });

  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));

  const derived = JSON.parse(
    await readFile(executionContext.paths.designIrFile, "utf8"),
  ) as DesignIR;
  assert.deepEqual(derived, sourceIr);
});

test("TemplatePrepareService seeds the prior generated project for eligible delta reuse", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  await mkdir(executionContext.paths.templateRoot, { recursive: true });
  await writeFile(
    path.join(executionContext.paths.templateRoot, "template-only.txt"),
    "template\n",
    "utf8",
  );

  const sourceJobDir = path.join(
    executionContext.resolvedPaths.jobsRoot,
    "source-template-seed",
  );
  const sourceGeneratedProjectDir = path.join(sourceJobDir, "generated-app");
  await mkdir(sourceGeneratedProjectDir, { recursive: true });
  await writeFile(
    path.join(sourceGeneratedProjectDir, "seeded.txt"),
    "seeded\n",
    "utf8",
  );

  executionContext.sourceJob = {
    ...createJobRecord({
      runtime: executionContext.runtime,
      jobDir: sourceJobDir,
    }),
    jobId: "source-template-seed",
    artifacts: {
      ...createJobRecord({
        runtime: executionContext.runtime,
        jobDir: sourceJobDir,
      }).artifacts,
      generatedProjectDir: sourceGeneratedProjectDir,
    },
  };
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    stage: "figma.source",
    value: {
      pasteIdentityKey: "paste-2",
      requestedMode: "auto",
      summary: {
        mode: "auto_resolved_to_delta",
        strategy: "no_changes",
        totalNodes: 2,
        nodesReused: 2,
        nodesReprocessed: 0,
        structuralChangeRatio: 0,
        pasteIdentityKey: "paste-2",
        priorManifestMissing: false,
      },
      currentFingerprintNodes: [],
      rootNodeIds: ["screen-1"],
      changedNodeIds: [],
      changedRootNodeIds: [],
      sourceJobId: "source-template-seed",
      eligibleForReuse: true,
    },
  });

  await TemplatePrepareService.execute(
    undefined,
    stageContextFor("template.prepare"),
  );

  assert.equal(
    await readFile(
      path.join(executionContext.paths.generatedProjectDir, "seeded.txt"),
      "utf8",
    ),
    "seeded\n",
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

test("CodegenGenerateService skips generator work for no-change delta reuse", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(
    executionContext.paths.designIrFile,
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile,
  });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "existing.txt"),
    "existing\n",
    "utf8",
  );
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    stage: "figma.source",
    value: {
      pasteIdentityKey: "paste-3",
      requestedMode: "auto",
      summary: {
        mode: "auto_resolved_to_delta",
        strategy: "no_changes",
        totalNodes: 2,
        nodesReused: 2,
        nodesReprocessed: 0,
        structuralChangeRatio: 0,
        pasteIdentityKey: "paste-3",
        priorManifestMissing: false,
      },
      currentFingerprintNodes: [],
      rootNodeIds: ["screen-1"],
      changedNodeIds: [],
      changedRootNodeIds: [],
      sourceJobId: "source-codegen-no-change",
      eligibleForReuse: true,
    },
  });

  let generatorCalled = false;
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      generatorCalled = true;
      return { generatedPaths: [] };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
      }) as Awaited<
        ReturnType<
          typeof import("../../parity/component-manifest.js").buildComponentManifest
        >
      >,
  });

  await service.execute(
    {
      boardKeySeed: "demo-board",
    },
    stageContextFor("codegen.generate"),
  );

  assert.equal(generatorCalled, false);
  assert.deepEqual(
    await executionContext.artifactStore.getValue(
      STAGE_ARTIFACT_KEYS.codegenSummary,
    ),
    {
      generatedPaths: ["component-manifest.json", "existing.txt"],
    },
  );
});

test("CodegenGenerateService maps changed node ids to affected emitted targets for delta runs", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  ir.screens = [
    {
      id: "screen-1",
      name: "Screen 1",
      route: "/screen-1",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "title-1",
          name: "Title 1",
          type: "text",
          children: [],
        } as never,
      ],
    },
    {
      id: "screen-2",
      name: "Screen 2",
      route: "/screen-2",
      layoutMode: "VERTICAL",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "title-2",
          name: "Title 2",
          type: "text",
          children: [],
        } as never,
      ],
    },
  ];
  await writeFile(
    executionContext.paths.designIrFile,
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile,
  });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "component-manifest.json"),
    `${JSON.stringify(
      {
        screens: [
          {
            screenId: "screen-1",
            screenName: "Screen 1",
            file: toDeterministicScreenPath("Screen 1"),
            components: [
              {
                irNodeId: "title-1",
                irNodeName: "Title 1",
                irNodeType: "TEXT",
                file: toDeterministicScreenPath("Screen 1"),
                startLine: 1,
                endLine: 2,
              },
            ],
          },
          {
            screenId: "screen-2",
            screenName: "Screen 2",
            file: toDeterministicScreenPath("Screen 2"),
            components: [
              {
                irNodeId: "title-2",
                irNodeName: "Title 2",
                irNodeType: "TEXT",
                file: toDeterministicScreenPath("Screen 2"),
                startLine: 1,
                endLine: 2,
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    stage: "figma.source",
    value: {
      pasteIdentityKey: "paste-4",
      requestedMode: "auto",
      summary: {
        mode: "auto_resolved_to_delta",
        strategy: "delta",
        totalNodes: 4,
        nodesReused: 2,
        nodesReprocessed: 2,
        structuralChangeRatio: 0.5,
        pasteIdentityKey: "paste-4",
        priorManifestMissing: false,
      },
      currentFingerprintNodes: [],
      rootNodeIds: ["screen-1", "screen-2"],
      changedNodeIds: ["title-1"],
      changedRootNodeIds: ["screen-1"],
      sourceJobId: "source-codegen-delta",
      eligibleForReuse: true,
    },
  });

  let generatedScreenIds: string[] = [];
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* ({ ir: generationIr }) {
      generatedScreenIds = generationIr.screens.map((screen) => screen.id);
      return { generatedPaths: [] };
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
      }) as Awaited<
        ReturnType<
          typeof import("../../parity/component-manifest.js").buildComponentManifest
        >
      >,
  });

  await service.execute(
    {
      boardKeySeed: "demo-board",
    },
    stageContextFor("codegen.generate"),
  );

  assert.deepEqual(generatedScreenIds, ["screen-1"]);
});

test("CodegenGenerateService removes carried-forward files for removed delta targets", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(
    executionContext.paths.designIrFile,
    `${JSON.stringify(ir, null, 2)}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile,
  });
  await mkdir(
    path.join(executionContext.paths.generatedProjectDir, "src", "screens"),
    { recursive: true },
  );
  await writeFile(
    path.join(
      executionContext.paths.generatedProjectDir,
      toDeterministicScreenPath("Screen 1"),
    ),
    "retained\n",
    "utf8",
  );
  await writeFile(
    path.join(
      executionContext.paths.generatedProjectDir,
      toDeterministicScreenPath("Removed Screen"),
    ),
    "stale\n",
    "utf8",
  );
  await writeFile(
    path.join(
      executionContext.paths.generatedProjectDir,
      "component-manifest.json",
    ),
    `${JSON.stringify(
      {
        screens: [
          {
            screenId: "screen-1",
            screenName: "Screen 1",
            file: toDeterministicScreenPath("Screen 1"),
            components: [],
          },
          {
            screenId: "screen-removed",
            screenName: "Removed Screen",
            file: toDeterministicScreenPath("Removed Screen"),
            components: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    stage: "figma.source",
    value: {
      pasteIdentityKey: "paste-removed",
      requestedMode: "auto",
      summary: {
        mode: "auto_resolved_to_delta",
        strategy: "delta",
        totalNodes: 2,
        nodesReused: 1,
        nodesReprocessed: 1,
        structuralChangeRatio: 0.5,
        pasteIdentityKey: "paste-removed",
        priorManifestMissing: false,
      },
      currentFingerprintNodes: [],
      rootNodeIds: ["screen-1"],
      changedNodeIds: ["screen-removed"],
      changedRootNodeIds: [],
      sourceJobId: "source-codegen-removed",
      eligibleForReuse: true,
    },
  });

  let generatorCalled = false;
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      generatorCalled = true;
      return { generatedPaths: [] };
    },
    buildComponentManifestFn: async ({
      screens,
      identitiesByScreenId,
    }) => ({
      screens: screens.map((screen) => ({
        screenId: screen.id,
        screenName: screen.name,
        file: identitiesByScreenId.get(screen.id)?.filePath ?? "",
        components: [],
      })),
    }) as Awaited<
      ReturnType<
        typeof import("../../parity/component-manifest.js").buildComponentManifest
      >
    >,
  });

  await service.execute(
    {
      boardKeySeed: "demo-board",
    },
    stageContextFor("codegen.generate"),
  );

  assert.equal(generatorCalled, false);
  await assert.rejects(
    readFile(
      path.join(
        executionContext.paths.generatedProjectDir,
        toDeterministicScreenPath("Removed Screen"),
      ),
      "utf8",
    ),
  );
  assert.equal(
    await readFile(
      path.join(
        executionContext.paths.generatedProjectDir,
        toDeterministicScreenPath("Screen 1"),
      ),
      "utf8",
    ),
    "retained\n",
  );
  assert.deepEqual(
    await executionContext.artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary),
    {
      generatedPaths: [
        "component-manifest.json",
        toDeterministicScreenPath("Screen 1"),
      ].sort((left, right) => left.localeCompare(right)),
    },
  );
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
  let associatedNodeIdsByScreenId: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      return { generatedPaths: [] };
    },
    buildComponentManifestFn: async ({ screens, identitiesByScreenId, associatedNodeIdsByScreenId: associatedNodeIds }) => {
      manifestScreenIds = screens.map((screen) => screen.id);
      manifestIdentityKeys = [...(identitiesByScreenId?.keys() ?? [])];
      associatedNodeIdsByScreenId = associatedNodeIds;
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
  assert.deepEqual(
    [...(associatedNodeIdsByScreenId?.get("family-canonical") ?? [])].sort(),
    ["family-brutto", "family-canonical"]
  );
  assert.deepEqual(
    [...(associatedNodeIdsByScreenId?.get("standalone") ?? [])].sort(),
    ["standalone"]
  );
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

test("CodegenGenerateService publishes progressive generated-project and manifest artifacts while streaming is still running", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });

  let syncCount = 0;
  executionContext.syncPublicJobProjection = async () => {
    syncCount += 1;
    await syncPublicJobProjection({
      job: executionContext.job,
      artifactStore: executionContext.artifactStore
    });
  };

  const service = createCodegenGenerateService({
    exportImageAssetsFromFigmaFn: async () => ({ imageAssetMap: {} }),
    generateArtifactsStreamingFn: async function* () {
      const themePath = path.join(executionContext.paths.generatedProjectDir, "src", "theme", "theme.ts");
      await mkdir(path.dirname(themePath), { recursive: true });
      await writeFile(themePath, "export const theme = {};\n", "utf8");
      yield {
        type: "theme",
        files: [{ path: "src/theme/theme.ts", content: "export const theme = {};\n" }]
      } as const;

      assert.equal(
        await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject),
        executionContext.paths.generatedProjectDir
      );
      assert.equal(executionContext.job.artifacts.generatedProjectDir, executionContext.paths.generatedProjectDir);

      const screenPath = path.join(
        executionContext.paths.generatedProjectDir,
        toDeterministicScreenPath("Screen 1")
      );
      await mkdir(path.dirname(screenPath), { recursive: true });
      await writeFile(
        screenPath,
        [
          "export function Screen1() {",
          "  return (",
          "    <section>",
          "      {/* @ir:start title-1 Title TEXT */}",
          '      <span data-ir-id=\"title-1\">Hello</span>',
          "      {/* @ir:end title-1 */}",
          "    </section>",
          "  );",
          "}",
          ""
        ].join("\n"),
        "utf8"
      );
      yield {
        type: "screen",
        screenName: "Screen 1",
        files: [{ path: toDeterministicScreenPath("Screen 1"), content: await readFile(screenPath, "utf8") }]
      } as const;

      const componentManifestPath = path.join(
        executionContext.paths.generatedProjectDir,
        "component-manifest.json"
      );
      assert.equal(
        await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentManifest),
        componentManifestPath
      );
      assert.equal(executionContext.job.artifacts.componentManifestFile, componentManifestPath);

      const manifest = JSON.parse(await readFile(componentManifestPath, "utf8")) as {
        screens: Array<{ screenId: string; file: string; components: Array<{ irNodeId: string }> }>;
      };
      assert.deepEqual(
        manifest.screens.map((screen) => screen.screenId),
        ["screen-1"]
      );
      assert.deepEqual(
        manifest.screens[0]?.components.map((component) => component.irNodeId),
        ["title-1"]
      );

      return {
        generatedPaths: ["src/theme/theme.ts", toDeterministicScreenPath("Screen 1")],
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
    }
  });

  await service.execute(
    {
      boardKeySeed: "demo-board"
    },
    stageContextFor("codegen.generate")
  );

  assert.equal(syncCount, 2);
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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

test("CodegenGenerateService fails hard before generation when Storybook-first theme artifacts are insufficient", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  let generationStarted = false;

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(
    tokensPath,
    `${JSON.stringify(
      {
        ...createStorybookTokensArtifactForStageServices(),
        theme: {
          "sparkasse-light": {
            color: {
              primary: {
                main: { $type: "color", $value: "#dd0000" },
                "contrast-text": { $type: "color", $value: "#ffffff" }
              },
              text: {
                primary: { $type: "color", $value: "#111111" }
              },
              background: {
                default: { $type: "color", $value: "#f8f8f8" }
              }
            },
            spacing: {
              base: { $type: "dimension", $value: { value: 8, unit: "px" } }
            },
            radius: {
              shape: {
                "border-radius": { $type: "dimension", $value: { value: 12, unit: "px" } }
              }
            },
            typography: {
              base: {
                $type: "typography",
                $value: {
                  fontFamily: "Brand Sans",
                  fontSize: { value: 16, unit: "px" },
                  fontWeight: 400,
                  lineHeight: 1.5
                }
              }
            }
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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
  executionContext.resolvedCustomerProfile = createIssue693CustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* () {
      generationStarted = true;
      throw new Error("generateArtifactsStreamingFn must not run when Storybook-first theme resolution fails.");
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await assert.rejects(
    async () => {
      await service.execute(
        {
          boardKeySeed: "storybook-theme-failure"
        },
        stageContextFor("codegen.generate")
      );
    },
    (
      error: Error & {
        code?: string;
        diagnostics?: Array<{ code?: string; message?: string; details?: Record<string, unknown> }>;
      }
    ) => {
      assert.equal(error.code, "E_STORYBOOK_THEME_REQUIRED_TOKEN_MISSING");
      assert.equal(
        error.diagnostics?.some((diagnostic) => diagnostic.code === "E_STORYBOOK_THEME_REQUIRED_TOKEN_MISSING"),
        true
      );
      assert.equal(error.message.includes("palette.background.paper"), true);
      return true;
    }
  );

  assert.equal(generationStarted, false);
});

test("CodegenGenerateService rejects structurally invalid storybook theme artifacts before resolver execution", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  const ir = createMinimalIr();
  const tokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const themesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  let generationStarted = false;
  let resolverStarted = false;

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(
    themesPath,
    `${JSON.stringify(
      {
        ...createStorybookThemesArtifactForStageServices(),
        $extensions: {
          [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
            ...createStorybookThemesArtifactForStageServices().$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY],
            version: 2
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
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
  executionContext.resolvedCustomerProfile = createIssue693CustomerProfileForStageServices();

  const service = createCodegenGenerateService({
    generateArtifactsStreamingFn: async function* () {
      generationStarted = true;
      throw new Error("generateArtifactsStreamingFn must not run when Storybook theme artifacts are invalid.");
    },
    resolveStorybookThemeFn: () => {
      resolverStarted = true;
      throw new Error("resolveStorybookThemeFn must not run when Storybook theme artifacts are invalid.");
    },
    buildComponentManifestFn: async () =>
      ({
        screens: [],
        generatedAt: new Date().toISOString()
      }) as Awaited<ReturnType<typeof import("../../parity/component-manifest.js").buildComponentManifest>>
  });

  await assert.rejects(
    async () => {
      await service.execute(
        {
          boardKeySeed: "storybook-theme-artifact-invalid"
        },
        stageContextFor("codegen.generate")
      );
    },
    (error: Error & { code?: string }) => {
      assert.equal(error.code, "E_STORYBOOK_THEME_ARTIFACT_INVALID");
      assert.equal(error.message, "Storybook theme artifacts are unreadable or malformed.");
      return true;
    }
  );

  assert.equal(resolverStarted, false);
  assert.equal(generationStarted, false);
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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
              profile_family_unresolved: 0,
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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

test("CodegenGenerateService marks empty Storybook-first customer profile configs as authoritative", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
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
  const componentMatchReportArtifact = {
    ...createComponentMatchReportArtifactForStageServices(),
    entries: [
      {
        ...createComponentMatchReportArtifactForStageServices().entries[0],
        resolvedProps: {
          ...createComponentMatchReportArtifactForStageServices().entries[0].resolvedProps,
          status: "incompatible" as const,
          fallbackPolicy: "allow" as const,
          codegenCompatible: false
        }
      }
    ]
  };

  await writeFile(executionContext.paths.designIrFile, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(figmaAnalysisPath, `${JSON.stringify({ artifactVersion: 1, componentFamilies: [] }, null, 2)}\n`, "utf8");
  await writeFile(componentMatchReportPath, `${JSON.stringify(componentMatchReportArtifact, null, 2)}\n`, "utf8");
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
      assert.deepEqual(input.customerProfileDesignSystemConfig, {
        library: "__customer_profile__",
        mappings: {}
      });
      assert.equal(input.customerProfileDesignSystemConfigSource, "storybook_first");
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
      boardKeySeed: "storybook-first-empty"
    },
    stageContextFor("codegen.generate")
  );
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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
  await writeFile(tokensPath, `${JSON.stringify(createStorybookTokensArtifactForStageServices(), null, 2)}\n`, "utf8");
  await writeFile(themesPath, `${JSON.stringify(createStorybookThemesArtifactForStageServices(), null, 2)}\n`, "utf8");
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
      assert.deepEqual(input.customerProfileDesignSystemConfig, {
        library: "__customer_profile__",
        mappings: {}
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
    visualAudit?: { status?: string };
    visualQuality?: { status?: string };
    compositeQuality?: { status?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.generatedApp?.status, "ok");
  assert.equal(summary?.visualAudit?.status, "not_requested");
  assert.equal(summary?.visualQuality?.status, "not_requested");
  assert.equal(summary?.compositeQuality?.status, "not_requested");
  assert.deepEqual(summary?.generatedApp?.lint?.args, ["lint"]);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
  assert.deepEqual(executionContext.job.visualAudit, { status: "not_requested" });
});

test("ValidateProjectService uses per-runtime validation policy instead of process env", async () => {
  const previousLintAutofix = process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
  const previousWorkspacePerf = process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION;
  const previousLegacyPerf = process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;

  process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX = "false";
  process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION = "false";
  process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION = "false";

  try {
    const first = await createExecutionContext({
      runtimeOverrides: {
        enableLintAutofix: true,
        enablePerfValidation: false
      }
    });
    const second = await createExecutionContext({
      runtimeOverrides: {
        enableLintAutofix: false,
        enablePerfValidation: true
      },
      jobId: "job-stage-test-second"
    });

    await first.executionContext.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.generatedProject,
      stage: "template.prepare",
      absolutePath: first.executionContext.paths.generatedProjectDir
    });
    await first.executionContext.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.generationDiffContext,
      stage: "codegen.generate",
      value: {
        boardKey: "test-board-first"
      } satisfies GenerationDiffContext
    });
    await second.executionContext.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.generatedProject,
      stage: "template.prepare",
      absolutePath: second.executionContext.paths.generatedProjectDir
    });
    await second.executionContext.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.generationDiffContext,
      stage: "codegen.generate",
      value: {
        boardKey: "test-board-second"
      } satisfies GenerationDiffContext
    });

    const capturedPolicies: Array<{ enableLintAutofix?: boolean; enablePerfValidation?: boolean }> = [];
    const service = createValidateProjectService({
      runProjectValidationFn: async (input) => {
        capturedPolicies.push({
          enableLintAutofix: input.enableLintAutofix,
          enablePerfValidation: input.enablePerfValidation
        });
        return createSuccessfulValidationResult({
          includePerfValidation: input.enablePerfValidation
        });
      }
    });

    await service.execute(undefined, first.stageContextFor("validate.project"));
    await service.execute(undefined, second.stageContextFor("validate.project"));

    assert.deepEqual(capturedPolicies, [
      {
        enableLintAutofix: true,
        enablePerfValidation: false
      },
      {
        enableLintAutofix: false,
        enablePerfValidation: true
      }
    ]);
  } finally {
    if (previousLintAutofix === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX = previousLintAutofix;
    }
    if (previousWorkspacePerf === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION = previousWorkspacePerf;
    }
    if (previousLegacyPerf === undefined) {
      delete process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;
    } else {
      process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION = previousLegacyPerf;
    }
  }
});

test("ValidateProjectService confidence uses collected diagnostics, generation screen inventory, and manifest ownership", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.getCollectedDiagnostics = () => [
    {
      code: "TEST_WARNING",
      message: "test warning",
      suggestion: "fix",
      stage: "validate.project",
      severity: "warning",
    },
  ];
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir,
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-confidence-screen-inventory",
    } satisfies GenerationDiffContext,
  });
  const generationMetricsPath = path.join(
    executionContext.paths.generatedProjectDir,
    "generation-metrics.json",
  );
  await writeFile(
    generationMetricsPath,
    `${JSON.stringify(
      {
        fetchedNodes: 200,
        skippedHidden: 0,
        skippedPlaceholders: 0,
        screenElementCounts: [
          { screenId: "home", screenName: "Home", elements: 120 },
          { screenId: "settings", screenName: "Settings", elements: 90 },
        ],
        truncatedScreens: [
          {
            screenId: "home",
            screenName: "Home",
            originalElements: 120,
            retainedElements: 80,
          },
        ],
        depthTruncatedScreens: [],
        degradedGeometryNodes: [],
        classificationFallbacks: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generationMetrics,
    stage: "codegen.generate",
    absolutePath: generationMetricsPath,
  });

  const componentManifestPath = path.join(
    executionContext.paths.generatedProjectDir,
    "component-manifest.json",
  );
  await writeFile(
    componentManifestPath,
    `${JSON.stringify(
      {
        screens: [
          {
            screenId: "home",
            screenName: "Home",
            file: "src/screens/Home.tsx",
            components: [
              {
                irNodeId: "node-home-button",
                irNodeName: "Button",
                irNodeType: "button",
                file: "src/screens/Home.tsx",
                startLine: 1,
                endLine: 10,
              },
            ],
          },
          {
            screenId: "settings",
            screenName: "Settings",
            file: "src/screens/Settings.tsx",
            components: [
              {
                irNodeId: "node-settings-card",
                irNodeName: "Card",
                irNodeType: "card",
                file: "src/screens/Settings.tsx",
                startLine: 1,
                endLine: 10,
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentManifest,
    stage: "codegen.generate",
    absolutePath: componentManifestPath,
  });

  const matchArtifact = createComponentMatchReportArtifactForStageServices();
  matchArtifact.summary.totalFigmaFamilies = 2;
  matchArtifact.summary.storybookFamilyCount = 2;
  matchArtifact.summary.storybookEntryCount = 2;
  matchArtifact.summary.matched = 2;
  matchArtifact.entries.push({
    ...structuredClone(matchArtifact.entries[0]),
    figma: {
      familyKey: "card-family",
      familyName: "Card",
      nodeCount: 1,
      variantProperties: [],
    },
    libraryResolution: {
      ...matchArtifact.entries[0].libraryResolution,
      componentKey: "Card",
    },
    storybookFamily: {
      familyId: "family-card",
      title: "Components/Card",
      name: "Card",
      tier: "Components",
      storyCount: 1,
    },
    resolvedApi: {
      ...matchArtifact.entries[0].resolvedApi,
      status: "resolved",
      componentKey: "Card",
    },
  });
  const componentMatchReportPath = path.join(
    executionContext.paths.jobDir,
    "component-match-report.json",
  );
  await writeFile(
    componentMatchReportPath,
    `${JSON.stringify(matchArtifact, null, 2)}\n`,
    "utf8",
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportPath,
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult(),
  });
  await service.execute(undefined, stageContextFor("validate.project"));

  const confidence = await executionContext.artifactStore.getValue<{
    status?: string;
    contributors?: Array<{ signal?: string; value?: number }>;
    screens?: Array<{
      screenId?: string;
      components?: Array<{ componentName?: string }>;
    }>;
  }>(STAGE_ARTIFACT_KEYS.confidenceResult);
  assert.equal(confidence?.status, "completed");
  assert.equal(
    confidence?.contributors?.find(
      (contributor) => contributor.signal === "diagnostic_severity",
    )?.value,
    0.95,
  );
  assert.deepEqual(
    (confidence?.screens ?? []).map((screen) => screen.screenId).sort(),
    ["home", "settings"],
  );
  assert.deepEqual(
    confidence?.screens?.find((screen) => screen.screenId === "home")?.components?.map(
      (component) => component.componentName,
    ),
    ["Button"],
  );
  assert.deepEqual(
    confidence?.screens?.find((screen) => screen.screenId === "settings")?.components?.map(
      (component) => component.componentName,
    ),
    ["Card"],
  );
});

test("ValidateProjectService runs visual audit against the built dist bundle and persists visual artifacts", async () => {
  const baselineRelativePath = path.join("fixtures", "visual-baseline.png");
  const { executionContext, stageContextFor } = await createExecutionContext({
    requestOverrides: {
      visualAudit: {
        baselineImagePath: baselineRelativePath,
        capture: {
          viewport: {
            width: 4,
            height: 4,
            deviceScaleFactor: 1
          }
        },
        diff: {
          threshold: 0.2
        },
        regions: [
          {
            name: "full",
            x: 0,
            y: 0,
            width: 4,
            height: 4
          }
        ]
      }
    }
  });
  const baselineAbsolutePath = path.join(executionContext.resolvedWorkspaceRoot, baselineRelativePath);
  const baselineBuffer = createSolidPngBuffer({
    rgba: [255, 255, 255, 255]
  });
  const actualBuffer = createSolidPngBuffer({
    rgba: [240, 240, 240, 255]
  });
  const diffBuffer = createSolidPngBuffer({
    rgba: [255, 0, 0, 255]
  });
  await mkdir(path.dirname(baselineAbsolutePath), { recursive: true });
  await writeFile(baselineAbsolutePath, baselineBuffer);
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-visual-audit"
    } satisfies GenerationDiffContext
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>visual</body></html>\n", "utf8");

  let capturedProjectDir: string | undefined;
  let comparedThreshold: number | undefined;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult(),
    captureFromProjectFn: async (input) => {
      capturedProjectDir = input.projectDir;
      return {
        screenshotBuffer: actualBuffer,
        width: 4,
        height: 4,
        viewport: {
          width: 4,
          height: 4,
          deviceScaleFactor: 1
        }
      };
    },
    comparePngBuffersFn: (input) => {
      comparedThreshold = input.config?.threshold;
      assert.deepEqual(input.referenceBuffer, baselineBuffer);
      assert.deepEqual(input.testBuffer, actualBuffer);
      assert.deepEqual(input.regions, [
        {
          name: "full",
          x: 0,
          y: 0,
          width: 4,
          height: 4
        }
      ]);
      return {
        diffImageBuffer: diffBuffer,
        similarityScore: 87.5,
        diffPixelCount: 2,
        totalPixels: 16,
        regions: [
          {
            name: "full",
            x: 0,
            y: 0,
            width: 4,
            height: 4,
            diffPixelCount: 2,
            totalPixels: 16,
            deviationPercent: 12.5
          }
        ],
        width: 4,
        height: 4
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const referenceImagePath = path.join(executionContext.paths.jobDir, "visual-audit", "reference.png");
  const actualImagePath = path.join(executionContext.paths.jobDir, "visual-audit", "actual.png");
  const diffImagePath = path.join(executionContext.paths.jobDir, "visual-audit", "diff.png");
  const reportPath = path.join(executionContext.paths.jobDir, "visual-audit", "report.json");
  assert.equal(capturedProjectDir, distDir);
  assert.equal(comparedThreshold, 0.2);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.visualAuditReferenceImage),
    referenceImagePath
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.visualAuditActualImage),
    actualImagePath
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.visualAuditDiffImage),
    diffImagePath
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.visualAuditReport),
    reportPath
  );
  const visualAudit = await executionContext.artifactStore.getValue<{
    status?: string;
    baselineImagePath?: string;
    reportPath?: string;
    diffPixelCount?: number;
    warnings?: string[];
  }>(STAGE_ARTIFACT_KEYS.visualAuditResult);
  assert.equal(visualAudit?.status, "warn");
  assert.equal(visualAudit?.baselineImagePath, baselineRelativePath);
  assert.equal(visualAudit?.reportPath, reportPath);
  assert.equal(visualAudit?.diffPixelCount, 2);
  assert.match(visualAudit?.warnings?.[0] ?? "", /differing pixel/);
  const summary = await executionContext.artifactStore.getValue<{
    visualAudit?: { status?: string; reportPath?: string; actualImagePath?: string };
    visualQuality?: { overallScore?: number; interpretation?: string };
    compositeQuality?: {
      status?: string;
      warnings?: string[];
      composite?: { includedDimensions?: string[] };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.visualAudit?.status, "warn");
  assert.equal(summary?.visualAudit?.reportPath, reportPath);
  assert.equal(summary?.visualAudit?.actualImagePath, actualImagePath);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    overallScore?: number;
    diffImagePath?: string;
    dimensions?: Array<{ name?: string; score?: number }>;
    hotspots?: Array<{ region?: string; deviationPercent?: number }>;
    metadata?: {
      comparedAt?: string;
      diffPixelCount?: number;
      viewport?: { width?: number; height?: number; deviceScaleFactor?: number };
      versions?: { packageVersion?: string; contractVersion?: string };
    };
  };
  assert.equal(report.overallScore, 87.5);
  assert.equal(report.diffImagePath, diffImagePath);
  assert.equal(report.dimensions?.length, 5);
  assert.equal(report.dimensions?.[0]?.name, "Layout Accuracy");
  assert.equal(report.dimensions?.[0]?.score, 87.5);
  assert.equal(report.hotspots?.length, 1);
  assert.equal(report.hotspots?.[0]?.region, "full");
  assert.equal(report.hotspots?.[0]?.deviationPercent, 12.5);
  assert.match(report.metadata?.comparedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(report.metadata?.diffPixelCount, 2);
  assert.deepEqual(report.metadata?.viewport, {
    width: 4,
    height: 4,
    deviceScaleFactor: 1
  });
  assert.deepEqual(report.metadata?.versions, {
    packageVersion: packageJson.version,
    contractVersion: CONTRACT_VERSION
  });
  assert.equal(executionContext.job.artifacts.visualAuditReferenceImageFile, referenceImagePath);
  assert.equal(executionContext.job.artifacts.visualAuditActualImageFile, actualImagePath);
  assert.equal(executionContext.job.artifacts.visualAuditDiffImageFile, diffImagePath);
  assert.equal(executionContext.job.artifacts.visualAuditReportFile, reportPath);
  assert.equal(executionContext.job.visualAudit?.status, "warn");
  const visualQualityArtifact = await executionContext.artifactStore.getValue<{
    overallScore?: number;
    interpretation?: string;
    dimensions?: unknown[];
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);
  assert.ok(visualQualityArtifact !== undefined, "Expected visualQualityResult artifact");
  assert.equal(typeof visualQualityArtifact?.overallScore, "number");
  assert.ok(summary?.visualQuality !== undefined, "Expected visualQuality in summary");
  assert.equal(typeof summary?.visualQuality?.overallScore, "number");
  assert.equal(summary?.compositeQuality?.status, "completed");
  assert.deepEqual(summary?.compositeQuality?.composite?.includedDimensions, ["visual"]);
  assert.match(summary?.compositeQuality?.warnings?.[0] ?? "", /performance:/i);
  assert.ok(executionContext.job.visualQuality !== undefined, "Expected visualQuality on job record");
  assert.equal(typeof executionContext.job.visualQuality?.overallScore, "number");
  assert.equal(executionContext.job.compositeQuality?.status, "completed");
  assert.deepEqual(executionContext.job.compositeQuality?.composite?.includedDimensions, ["visual"]);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.compositeQualityReport),
    path.join(executionContext.paths.jobDir, "composite-quality", "report.json")
  );
});

test("ValidateProjectService fails with a structured error when the visual audit baseline is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    requestOverrides: {
      visualAudit: {
        baselineImagePath: path.join("fixtures", "missing-visual-baseline.png")
      }
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
      boardKey: "test-board-missing-visual-baseline"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult()
  });

  await assert.rejects(async () => {
    await service.execute(undefined, stageContextFor("validate.project"));
  }, (error: unknown) => {
    assert.equal((error as { code?: string }).code, "E_VISUAL_AUDIT_BASELINE_MISSING");
    assert.match(String((error as { message?: string }).message), /baseline .*missing or unreadable/i);
    return true;
  });

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    visualAudit?: { status?: string; baselineImagePath?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.visualAudit?.status, "failed");
  assert.equal(summary?.visualAudit?.baselineImagePath, path.join("fixtures", "missing-visual-baseline.png"));
  assert.equal(executionContext.job.visualAudit?.status, "failed");
});

test("ValidateProjectService runs standalone visual quality in frozen_fixture mode and honors the configured viewport width", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-frozen-"));
  const fixtureRoot = path.join(root, "fixtures", "customer-board");
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const referenceImagePath = path.join(fixtureRoot, "visual-quality", "reference.png");
  const referenceMetadataPath = path.join(fixtureRoot, "visual-quality", "reference.metadata.json");
  await mkdir(path.dirname(customerProfilePath), { recursive: true });
  await mkdir(path.dirname(referenceImagePath), { recursive: true });
  await writeFile(customerProfilePath, JSON.stringify({ brandId: "customer-board" }), "utf8");
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        visualQuality: {
          frozenReferenceImage: "visual-quality/reference.png",
          frozenReferenceMetadata: "visual-quality/reference.metadata.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    referenceImagePath,
    createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [255, 255, 255, 255]
    })
  );
  await writeFile(
    referenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "1:2",
          nodeName: "Fixture Screen",
          lastModified: "2026-04-08T00:00:00.000Z"
        },
        viewport: {
          width: 8,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
    },
    requestOverrides: {
      customerProfilePath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
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
      boardKey: "test-board-visual-quality-frozen"
    } satisfies GenerationDiffContext
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>visual quality</body></html>\n", "utf8");

  const actualBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [248, 248, 248, 255]
  });
  const diffBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 0, 0, 255]
  });
  let captureViewport:
    | {
        width?: number;
        height?: number;
        deviceScaleFactor?: number;
      }
    | undefined;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async (input) => {
      captureViewport = input.config?.viewport;
      return {
        screenshotBuffer: actualBuffer,
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        }
      };
    },
    comparePngBuffersFn: () => {
      return {
        diffImageBuffer: diffBuffer,
        similarityScore: 91.25,
        diffPixelCount: 4,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    referenceSource?: string;
    capturedAt?: string;
    overallScore?: number;
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    visualQuality?: {
      status?: string;
      referenceSource?: string;
      capturedAt?: string;
      overallScore?: number;
    };
    compositeQuality?: {
      status?: string;
      warnings?: string[];
      composite?: { includedDimensions?: string[] };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  const compositeQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    weights?: { visual?: number; performance?: number };
    composite?: { includedDimensions?: string[] };
    warnings?: string[];
  }>(STAGE_ARTIFACT_KEYS.compositeQualityResult);

  assert.equal(captureViewport?.width, 8);
  assert.equal(captureViewport?.deviceScaleFactor, 1);
  assert.ok((captureViewport?.height ?? 0) > 0);
  assert.equal(visualQuality?.status, "completed");
  assert.equal(visualQuality?.referenceSource, "frozen_fixture");
  assert.equal(visualQuality?.capturedAt, "2026-04-09T00:00:00.000Z");
  assert.equal(typeof visualQuality?.overallScore, "number");
  assert.equal(summary?.status, "warn");
  assert.equal(summary?.visualQuality?.status, "completed");
  assert.equal(summary?.visualQuality?.referenceSource, "frozen_fixture");
  assert.equal(summary?.visualQuality?.capturedAt, "2026-04-09T00:00:00.000Z");
  assert.equal(typeof summary?.visualQuality?.overallScore, "number");
  assert.equal(summary?.compositeQuality?.status, "completed");
  assert.deepEqual(summary?.compositeQuality?.composite?.includedDimensions, ["visual"]);
  assert.match(summary?.compositeQuality?.warnings?.[0] ?? "", /performance:/i);
  assert.equal(compositeQuality?.status, "completed");
  assert.equal(compositeQuality?.weights?.visual, 0.6);
  assert.equal(compositeQuality?.weights?.performance, 0.4);
  assert.deepEqual(compositeQuality?.composite?.includedDimensions, ["visual"]);
  assert.match(compositeQuality?.warnings?.[0] ?? "", /performance:/i);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.visualQualityReport),
    path.join(executionContext.paths.jobDir, "visual-quality", "report.json")
  );
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.compositeQualityReport),
    path.join(executionContext.paths.jobDir, "composite-quality", "report.json")
  );
  assert.equal(executionContext.job.visualQuality?.status, "completed");
  assert.equal(executionContext.job.visualQuality?.referenceSource, "frozen_fixture");
});

test("ValidateProjectService persists composite quality with perf data and request-level weight overrides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-composite-quality-perf-"));
  const fixtureRoot = path.join(root, "fixtures", "customer-board");
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const referenceImagePath = path.join(fixtureRoot, "visual-quality", "reference.png");
  const referenceMetadataPath = path.join(fixtureRoot, "visual-quality", "reference.metadata.json");
  await mkdir(path.dirname(customerProfilePath), { recursive: true });
  await mkdir(path.dirname(referenceImagePath), { recursive: true });
  await writeFile(customerProfilePath, JSON.stringify({ brandId: "customer-board" }), "utf8");
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        visualQuality: {
          frozenReferenceImage: "visual-quality/reference.png",
          frozenReferenceMetadata: "visual-quality/reference.metadata.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    referenceImagePath,
    createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [255, 255, 255, 255]
    })
  );
  await writeFile(
    referenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-11T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "1:2",
          nodeName: "Fixture Screen",
          lastModified: "2026-04-10T00:00:00.000Z"
        },
        viewport: {
          width: 8,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    input: {
      compositeQualityWeights: {
        visual: 0.75,
        performance: 0.25
      }
    },
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
    },
    requestOverrides: {
      customerProfilePath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8,
      compositeQualityWeights: {
        visual: 0.75,
        performance: 0.25
      }
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
      boardKey: "test-board-composite-quality"
    } satisfies GenerationDiffContext
  });

  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  const perfArtifactDir = path.join(executionContext.paths.generatedProjectDir, ".figmapipe", "performance");
  await mkdir(distDir, { recursive: true });
  await mkdir(perfArtifactDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>composite quality</body></html>\n", "utf8");
  await writeFile(
    path.join(perfArtifactDir, "lighthouse-home-mobile.json"),
    JSON.stringify(
      {
        report: {
          lhr: {
            categories: {
              performance: {
                score: 0.94
              }
            },
            audits: {
              "first-contentful-paint": { numericValue: 1200 },
              "largest-contentful-paint": { numericValue: 1800 },
              "cumulative-layout-shift": { numericValue: 0.02 },
              "total-blocking-time": { numericValue: 40 },
              "speed-index": { numericValue: 1500 }
            }
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(perfArtifactDir, "perf-assert-report.json"),
    JSON.stringify(
      {
        samples: [
          {
            profile: "mobile",
            route: "/",
            artifacts: {
              lighthouseReport: "./lighthouse-home-mobile.json"
            }
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const service = createValidateProjectService({
    runProjectValidationFn: async () =>
      createSuccessfulValidationResult({ includeUiValidation: true, includePerfValidation: true }),
    captureFromProjectFn: async () => {
      return {
        screenshotBuffer: createSolidPngBuffer({
          width: 8,
          height: 6,
          rgba: [248, 248, 248, 255]
        }),
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        }
      };
    },
    comparePngBuffersFn: () => {
      return {
        diffImageBuffer: createSolidPngBuffer({
          width: 8,
          height: 6,
          rgba: [255, 0, 0, 255]
        }),
        similarityScore: 90,
        diffPixelCount: 4,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const compositeQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    weights?: { visual?: number; performance?: number };
    performance?: {
      score?: number | null;
      sampleCount?: number;
      sourcePath?: string;
      aggregateMetrics?: { lcp_ms?: number | null };
    };
    composite?: { score?: number | null; includedDimensions?: string[] };
    warnings?: string[];
  }>(STAGE_ARTIFACT_KEYS.compositeQualityResult);
  const summary = await executionContext.artifactStore.getValue<{
    compositeQuality?: {
      status?: string;
      weights?: { visual?: number; performance?: number };
      composite?: { score?: number | null; includedDimensions?: string[] };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);

  assert.equal(compositeQuality?.status, "completed");
  assert.equal(compositeQuality?.weights?.visual, 0.75);
  assert.equal(compositeQuality?.weights?.performance, 0.25);
  assert.equal(compositeQuality?.performance?.score, 94);
  assert.equal(compositeQuality?.performance?.sampleCount, 1);
  assert.equal(compositeQuality?.performance?.aggregateMetrics?.lcp_ms, 1800);
  assert.match(compositeQuality?.performance?.sourcePath ?? "", /perf-assert-report\.json$/);
  assert.deepEqual(compositeQuality?.composite?.includedDimensions, ["visual", "performance"]);
  assert.equal(typeof compositeQuality?.composite?.score, "number");
  assert.deepEqual(compositeQuality?.warnings, []);
  assert.equal(summary?.compositeQuality?.status, "completed");
  assert.equal(summary?.compositeQuality?.weights?.visual, 0.75);
  assert.deepEqual(summary?.compositeQuality?.composite?.includedDimensions, ["visual", "performance"]);
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.compositeQualityReport),
    path.join(executionContext.paths.jobDir, "composite-quality", "report.json")
  );
  assert.equal(
    executionContext.job.artifacts.compositeQualityReportFile,
    path.join(executionContext.paths.jobDir, "composite-quality", "report.json")
  );
  assert.equal(executionContext.job.compositeQuality?.weights?.visual, 0.75);
});

test("ValidateProjectService emits browser-aware standalone visual quality reports and artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-browsers-"));
  const fixtureRoot = path.join(root, "fixtures", "customer-board");
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const referenceImagePath = path.join(fixtureRoot, "visual-quality", "reference.png");
  const referenceMetadataPath = path.join(fixtureRoot, "visual-quality", "reference.metadata.json");
  await mkdir(path.dirname(customerProfilePath), { recursive: true });
  await mkdir(path.dirname(referenceImagePath), { recursive: true });
  await writeFile(customerProfilePath, JSON.stringify({ brandId: "customer-board" }), "utf8");
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        visualQuality: {
          frozenReferenceImage: "visual-quality/reference.png",
          frozenReferenceMetadata: "visual-quality/reference.metadata.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    referenceImagePath,
    createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [255, 255, 255, 255]
    })
  );
  await writeFile(
    referenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "1:2",
          nodeName: "Fixture Screen",
          lastModified: "2026-04-08T00:00:00.000Z"
        },
        viewport: {
          width: 8,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8,
      visualQualityBrowsers: ["chromium", "firefox", "webkit"]
    },
    requestOverrides: {
      customerProfilePath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8,
      visualQualityBrowsers: ["chromium", "firefox", "webkit"]
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
      boardKey: "test-board-visual-quality-browsers"
    } satisfies GenerationDiffContext
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>visual quality browsers</body></html>\n", "utf8");

  const browserBuffers = {
    chromium: createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [254, 254, 254, 255]
    }),
    firefox: createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [248, 248, 248, 255]
    }),
    webkit: createSolidPngBuffer({
      width: 8,
      height: 6,
      rgba: [240, 240, 240, 255]
    })
  } as const;
  const referenceBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 255, 255, 255]
  });
  const captureBrowsers: string[] = [];
  const identifyBuffer = (buffer: Buffer): "reference" | "chromium" | "firefox" | "webkit" | "unknown" => {
    if (buffer.equals(referenceBuffer)) {
      return "reference";
    }
    if (buffer.equals(browserBuffers.chromium)) {
      return "chromium";
    }
    if (buffer.equals(browserBuffers.firefox)) {
      return "firefox";
    }
    if (buffer.equals(browserBuffers.webkit)) {
      return "webkit";
    }
    return "unknown";
  };

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async (input) => {
      const browser = input.browser ?? "chromium";
      captureBrowsers.push(browser);
      return {
        screenshotBuffer: browserBuffers[browser],
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        },
        browser
      };
    },
    comparePngBuffersFn: ({ referenceBuffer, testBuffer }) => {
      const left = identifyBuffer(referenceBuffer);
      const right = identifyBuffer(testBuffer);
      const same = referenceBuffer.equals(testBuffer);
      const pairScoreMap: Record<string, number> = {
        "reference->chromium": 100,
        "reference->firefox": 96,
        "reference->webkit": 92,
        "chromium->firefox": 94,
        "chromium->webkit": 90,
        "firefox->webkit": 95,
        "firefox->chromium": 94,
        "webkit->chromium": 90,
        "webkit->firefox": 95
      };
      const similarityScore = same
        ? 100
        : (pairScoreMap[`${left}->${right}`] ?? 88);
      return {
        diffImageBuffer: createSolidPngBuffer({
          width: 8,
          height: 6,
          rgba: same ? [0, 0, 0, 255] : [255, 0, 0, 255]
        }),
        similarityScore,
        diffPixelCount: same ? 0 : 4,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    browserBreakdown?: Record<string, number>;
    crossBrowserConsistency?: {
      browsers: string[];
      pairwiseDiffs: Array<{ diffImagePath?: string }>;
    };
    perBrowser?: Array<{
      browser: string;
      actualImagePath?: string;
      diffImagePath?: string;
      reportPath?: string;
    }>;
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);
  const reportPath = await executionContext.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.visualQualityReport,
  );

  assert.deepEqual(captureBrowsers, ["chromium", "firefox", "webkit"]);
  assert.equal(visualQuality?.status, "completed");
  assert.deepEqual(Object.keys(visualQuality?.browserBreakdown ?? {}).sort(), [
    "chromium",
    "firefox",
    "webkit"
  ]);
  assert.deepEqual(
    visualQuality?.perBrowser?.map((entry) => entry.browser),
    ["chromium", "firefox", "webkit"],
  );
  assert.deepEqual(visualQuality?.crossBrowserConsistency?.browsers, [
    "chromium",
    "firefox",
    "webkit"
  ]);
  assert.equal(visualQuality?.crossBrowserConsistency?.pairwiseDiffs.length, 3);
  assert.equal(
    reportPath,
    path.join(executionContext.paths.jobDir, "visual-quality", "report.json")
  );
  assert.ok(visualQuality?.perBrowser?.every((entry) => entry.actualImagePath && entry.diffImagePath && entry.reportPath));
  assert.ok(
    visualQuality?.crossBrowserConsistency?.pairwiseDiffs.every(
      (entry) => typeof entry.diffImagePath === "string",
    ),
  );

  await readFile(path.join(executionContext.paths.jobDir, "visual-quality", "actual.png"));
  await readFile(path.join(executionContext.paths.jobDir, "visual-quality", "diff.png"));
  for (const entry of visualQuality?.perBrowser ?? []) {
    await readFile(entry.actualImagePath!);
    await readFile(entry.diffImagePath!);
    await readFile(entry.reportPath!, "utf8");
  }
  for (const entry of visualQuality?.crossBrowserConsistency?.pairwiseDiffs ?? []) {
    await readFile(entry.diffImagePath!);
  }
});

test("ValidateProjectService frozen_fixture mode uses visualQualityFrozenReference override when provided", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-frozen-override-"));
  const fixtureRoot = path.join(root, "fixtures", "customer-board");
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const defaultReferenceImagePath = path.join(fixtureRoot, "visual-quality", "reference.png");
  const defaultReferenceMetadataPath = path.join(fixtureRoot, "visual-quality", "reference.metadata.json");
  const overrideReferenceImagePath = path.join(fixtureRoot, "screens", "2_10001", "reference.png");
  const overrideReferenceMetadataPath = path.join(fixtureRoot, "screens", "2_10001", "reference.metadata.json");
  await mkdir(path.dirname(customerProfilePath), { recursive: true });
  await mkdir(path.dirname(defaultReferenceImagePath), { recursive: true });
  await mkdir(path.dirname(overrideReferenceImagePath), { recursive: true });
  await writeFile(customerProfilePath, JSON.stringify({ brandId: "customer-board" }), "utf8");
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        visualQuality: {
          frozenReferenceImage: "visual-quality/reference.png",
          frozenReferenceMetadata: "visual-quality/reference.metadata.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    defaultReferenceImagePath,
    createSolidPngBuffer({ width: 8, height: 6, rgba: [255, 255, 255, 255] })
  );
  await writeFile(
    defaultReferenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-08T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "1:2",
          nodeName: "Default Fixture Screen",
          lastModified: "2026-04-08T00:00:00.000Z"
        },
        viewport: {
          width: 8,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    overrideReferenceImagePath,
    createSolidPngBuffer({ width: 8, height: 6, rgba: [240, 240, 240, 255] })
  );
  await writeFile(
    overrideReferenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-10T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "2:10001",
          nodeName: "Override Screen",
          lastModified: "2026-04-10T00:00:00.000Z"
        },
        viewport: {
          width: 8,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
    },
    requestOverrides: {
      customerProfilePath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8,
      visualQualityFrozenReference: {
        imagePath: "screens/2_10001/reference.png",
        metadataPath: "screens/2_10001/reference.metadata.json"
      }
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
      boardKey: "test-board-visual-quality-frozen-override"
    } satisfies GenerationDiffContext
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>visual quality override</body></html>\n", "utf8");

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async () => {
      return {
        screenshotBuffer: createSolidPngBuffer({ width: 8, height: 6, rgba: [248, 248, 248, 255] }),
        width: 8,
        height: 6,
        viewport: { width: 8, height: 6, deviceScaleFactor: 1 }
      };
    },
    comparePngBuffersFn: () => {
      return {
        diffImageBuffer: createSolidPngBuffer({ width: 8, height: 6, rgba: [255, 0, 0, 255] }),
        similarityScore: 90,
        diffPixelCount: 4,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    referenceSource?: string;
    capturedAt?: string;
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);

  assert.equal(visualQuality?.status, "completed");
  assert.equal(visualQuality?.referenceSource, "frozen_fixture");
  assert.equal(visualQuality?.capturedAt, "2026-04-10T00:00:00.000Z");
});

test("ValidateProjectService runs standalone visual quality in figma_api mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-figma-"));
  const referenceBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 255, 255, 255]
  });
  const actualBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [250, 250, 250, 255]
  });
  const diffBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 0, 0, 255]
  });
  const fetchCalls: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    if (url.includes("/v1/files/test-file/nodes?")) {
      assert.deepEqual(init?.headers, {
        "X-Figma-Token": "test-token"
      });
      return new Response(
        JSON.stringify({
          lastModified: "2026-04-08T00:00:00.000Z",
          nodes: {
            "1:2": {
              document: {
                id: "1:2",
                name: "Screen 1",
                absoluteBoundingBox: {
                  width: 4,
                  height: 3
                }
              }
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    if (url.includes("/v1/images/test-file?")) {
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.searchParams.get("ids"), "1:2");
      assert.equal(parsedUrl.searchParams.get("format"), "png");
      assert.equal(parsedUrl.searchParams.get("scale"), "2");
      assert.deepEqual(init?.headers, {
        "X-Figma-Token": "test-token"
      });
      return new Response(
        JSON.stringify({
          images: {
            "1:2": "https://example.test/reference.png"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
    if (url === "https://example.test/reference.png") {
      return new Response(referenceBuffer, {
        status: 200,
        headers: {
          "content-type": "image/png"
        }
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    input: {
      figmaAccessToken: "test-token"
    },
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "figma_api",
      visualQualityViewportWidth: 8,
      fetchImpl: mockFetch,
      figmaMaxRetries: 0
    },
    requestOverrides: {
      figmaFileKey: "test-file",
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "figma_api",
      visualQualityViewportWidth: 8
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
      boardKey: "test-board-visual-quality-figma"
    } satisfies GenerationDiffContext
  });
  await writeFile(
    executionContext.paths.figmaJsonFile,
    JSON.stringify({
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
                id: "1:2",
                type: "FRAME",
                name: "Screen 1",
                absoluteBoundingBox: {
                  x: 0,
                  y: 0,
                  width: 4,
                  height: 3
                }
              }
            ]
          }
        ]
      }
    }),
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaCleaned,
    stage: "figma.source",
    absolutePath: executionContext.paths.figmaJsonFile
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>figma visual quality</body></html>\n", "utf8");

  let captureViewport:
    | {
        width?: number;
        height?: number;
        deviceScaleFactor?: number;
      }
    | undefined;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async (input) => {
      captureViewport = input.config?.viewport;
      return {
        screenshotBuffer: actualBuffer,
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        }
      };
    },
    comparePngBuffersFn: () => {
      return {
        diffImageBuffer: diffBuffer,
        similarityScore: 95,
        diffPixelCount: 1,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    referenceSource?: string;
    capturedAt?: string;
    overallScore?: number;
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);
  assert.equal(fetchCalls.length, 3);
  assert.equal(captureViewport?.width, 8);
  assert.equal(captureViewport?.deviceScaleFactor, 1);
  assert.ok((captureViewport?.height ?? 0) > 0);
  assert.equal(visualQuality?.status, "completed");
  assert.equal(visualQuality?.referenceSource, "figma_api");
  assert.match(visualQuality?.capturedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof visualQuality?.overallScore, "number");
  assert.equal(executionContext.job.visualQuality?.referenceSource, "figma_api");
});

test("ValidateProjectService standalone visual quality reuses IR-derived Figma screenshot references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-screenshot-reference-"));
  const referenceBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 255, 255, 255]
  });
  const actualBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [250, 250, 250, 255]
  });
  const diffBuffer = createSolidPngBuffer({
    width: 8,
    height: 6,
    rgba: [255, 0, 0, 255]
  });
  const fetchCalls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    fetchCalls.push(input instanceof Request ? input.url : String(input));
    throw new Error("live Figma fetch should not be called");
  };

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    input: {
      figmaAccessToken: "test-token"
    },
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "figma_api",
      visualQualityViewportWidth: 8,
      fetchImpl: mockFetch
    },
    requestOverrides: {
      figmaFileKey: "test-file",
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "figma_api",
      visualQualityViewportWidth: 8
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
      boardKey: "test-board-visual-quality-screenshot-reference"
    } satisfies GenerationDiffContext
  });
  await writeFile(
    executionContext.paths.figmaJsonFile,
    JSON.stringify({
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
                id: "1:2",
                type: "FRAME",
                name: "Screen 1",
                absoluteBoundingBox: {
                  x: 0,
                  y: 0,
                  width: 4,
                  height: 3
                }
              },
              {
                id: "9:9",
                type: "FRAME",
                name: "Screen 2",
                absoluteBoundingBox: {
                  x: 0,
                  y: 0,
                  width: 20,
                  height: 3
                }
              }
            ]
          }
        ]
      }
    }),
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaCleaned,
    stage: "figma.source",
    absolutePath: executionContext.paths.figmaJsonFile
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
    stage: "figma.source",
    value: {
      sourceMode: "mcp",
      nodeHints: [],
      metadataHints: [],
      screenshots: [
        {
          nodeId: "1:2",
          url: "https://api.figma.com/v1/images/test-file?ids=1%3A2",
          purpose: "quality-gate"
        }
      ],
      assets: [],
      diagnostics: [],
      toolNames: ["figma_mcp"]
    }
  });
  const referenceImagePath = path.join(executionContext.paths.jobDir, "visual-references", "reference.png");
  await mkdir(path.dirname(referenceImagePath), { recursive: true });
  await writeFile(referenceImagePath, referenceBuffer);
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.figmaScreenshotReferences,
    stage: "ir.derive",
    value: {
      "1:2": path.relative(executionContext.paths.jobDir, referenceImagePath)
    }
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>figma visual quality</body></html>\n", "utf8");

  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async () => {
      return {
        screenshotBuffer: actualBuffer,
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        }
      };
    },
    comparePngBuffersFn: ({ referenceBuffer: comparedReferenceBuffer }) => {
      assert.deepEqual(comparedReferenceBuffer, referenceBuffer);
      return {
        diffImageBuffer: diffBuffer,
        similarityScore: 95,
        diffPixelCount: 1,
        totalPixels: 48,
        regions: [],
        width: 8,
        height: 6
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    referenceSource?: string;
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);
  assert.deepEqual(fetchCalls, []);
  assert.equal(visualQuality?.status, "completed");
  assert.equal(visualQuality?.referenceSource, "figma_api");
});

test("ValidateProjectService records standalone visual quality failures without failing validate.project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-quality-failure-"));
  const fixtureRoot = path.join(root, "fixtures", "customer-board");
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const referenceImagePath = path.join(fixtureRoot, "visual-quality", "reference.png");
  const referenceMetadataPath = path.join(fixtureRoot, "visual-quality", "reference.metadata.json");
  await mkdir(path.dirname(customerProfilePath), { recursive: true });
  await mkdir(path.dirname(referenceImagePath), { recursive: true });
  await writeFile(customerProfilePath, JSON.stringify({ brandId: "customer-board" }), "utf8");
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify(
      {
        version: 3,
        visualQuality: {
          frozenReferenceImage: "visual-quality/reference.png",
          frozenReferenceMetadata: "visual-quality/reference.metadata.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    referenceImagePath,
    createSolidPngBuffer({
      width: 6,
      height: 6,
      rgba: [255, 255, 255, 255]
    })
  );
  await writeFile(
    referenceMetadataPath,
    JSON.stringify(
      {
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "fixture-file",
          nodeId: "1:2",
          nodeName: "Fixture Screen",
          lastModified: "2026-04-08T00:00:00.000Z"
        },
        viewport: {
          width: 6,
          height: 6
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const { executionContext, stageContextFor } = await createExecutionContext({
    rootDir: root,
    runtimeOverrides: {
      enableUiValidation: true,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
    },
    requestOverrides: {
      customerProfilePath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: 8
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
      boardKey: "test-board-visual-quality-failure"
    } satisfies GenerationDiffContext
  });
  const distDir = path.join(executionContext.paths.generatedProjectDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><html><body>visual quality failure</body></html>\n", "utf8");

  let captureCalled = false;
  const service = createValidateProjectService({
    runProjectValidationFn: async () => createSuccessfulValidationResult({ includeUiValidation: true }),
    captureFromProjectFn: async () => {
      captureCalled = true;
      return {
        screenshotBuffer: createSolidPngBuffer({
          width: 8,
          height: 6,
          rgba: [255, 255, 255, 255]
        }),
        width: 8,
        height: 6,
        viewport: {
          width: 8,
          height: 6,
          deviceScaleFactor: 1
        }
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    visualQuality?: {
      status?: string;
      referenceSource?: string;
      message?: string;
      warnings?: string[];
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  const visualQuality = await executionContext.artifactStore.getValue<{
    status?: string;
    referenceSource?: string;
    message?: string;
    warnings?: string[];
  }>(STAGE_ARTIFACT_KEYS.visualQualityResult);

  assert.equal(captureCalled, false);
  assert.equal(summary?.status, "warn");
  assert.equal(summary?.visualQuality?.status, "failed");
  assert.equal(summary?.visualQuality?.referenceSource, "frozen_fixture");
  assert.match(summary?.visualQuality?.message ?? "", /does not match requested viewport width/i);
  assert.equal(visualQuality?.status, "failed");
  assert.equal(visualQuality?.referenceSource, "frozen_fixture");
  assert.match(visualQuality?.warnings?.[0] ?? "", /does not match requested viewport width/i);
});

test("ValidateProjectService persists failure summary with generatedApp.status='failed' when runProjectValidationFn throws for build failure", async () => {
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
      boardKey: "test-board-build-fail"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      throw createPipelineError({
        code: "E_VALIDATE_PROJECT",
        stage: "validate.project",
        message: "build failed: simulated build error",
        diagnostics: [
          {
            code: "E_VALIDATE_PROJECT",
            message: "build failed.",
            suggestion: "Resolve generated-project validation diagnostics and rerun the pipeline.",
            stage: "validate.project",
            severity: "error",
            details: {
              command: "build",
              output: "simulated build error",
              generatedProjectDir: executionContext.paths.generatedProjectDir
            }
          }
        ]
      });
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /build failed/
  );

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    generatedApp?: { status?: string; failedCommand?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.generatedApp?.status, "failed");
  assert.equal(summary?.generatedApp?.failedCommand, "build");
  assert.equal(
    await executionContext.artifactStore.getPath(STAGE_ARTIFACT_KEYS.validationSummaryFile),
    path.join(executionContext.paths.jobDir, "validation-summary.json")
  );
});

test("ValidateProjectService captures typecheck failure in generatedApp.failedCommand", async () => {
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
      boardKey: "test-board-typecheck-fail"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async () => {
      throw createPipelineError({
        code: "E_VALIDATE_PROJECT",
        stage: "validate.project",
        message: "typecheck failed: TS2345",
        diagnostics: [
          {
            code: "E_VALIDATE_PROJECT",
            message: "typecheck failed.",
            suggestion: "Resolve generated-project validation diagnostics and rerun the pipeline.",
            stage: "validate.project",
            severity: "error",
            details: {
              command: "typecheck",
              output: "TS2345",
              generatedProjectDir: executionContext.paths.generatedProjectDir
            }
          }
        ]
      });
    }
  });

  await assert.rejects(
    async () => {
      await service.execute(undefined, stageContextFor("validate.project"));
    },
    /typecheck failed/
  );

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    generatedApp?: { status?: string; failedCommand?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.generatedApp?.status, "failed");
  assert.equal(summary?.generatedApp?.failedCommand, "typecheck");
});

test("ValidateProjectService populates generatedApp.test when enableUnitTestValidation is enabled", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({
    runtimeOverrides: {
      enableUnitTestValidation: true
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
      boardKey: "test-board-unit-test"
    } satisfies GenerationDiffContext
  });

  const service = createValidateProjectService({
    runProjectValidationFn: async (): Promise<ProjectValidationResult> => {
      return {
        attempts: 1,
        install: {
          status: "skipped",
          strategy: "reused_seeded_node_modules"
        },
        lint: {
          status: "passed",
          command: "pnpm",
          args: ["lint"],
          attempt: 1,
          timedOut: false
        },
        typecheck: {
          status: "passed",
          command: "pnpm",
          args: ["typecheck"],
          attempt: 1,
          timedOut: false
        },
        build: {
          status: "passed",
          command: "pnpm",
          args: ["build"],
          attempt: 1,
          timedOut: false
        },
        test: {
          status: "passed",
          command: "pnpm",
          args: ["run", "test"],
          attempt: 1,
          timedOut: false
        }
      };
    }
  });

  await service.execute(undefined, stageContextFor("validate.project"));

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    generatedApp?: {
      status?: string;
      typecheck?: { args?: string[] };
      build?: { args?: string[] };
      test?: { args?: string[] };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "ok");
  assert.equal(summary?.generatedApp?.status, "ok");
  assert.deepEqual(summary?.generatedApp?.typecheck?.args, ["typecheck"]);
  assert.deepEqual(summary?.generatedApp?.build?.args, ["build"]);
  assert.deepEqual(summary?.generatedApp?.test?.args, ["run", "test"]);
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

test("ValidateProjectService keeps storybook-first mapping and token summaries ok when resolved imports and allowed MUI fallbacks coexist (issue #1009)", async () => {
  const customerProfile = createStorybookMatchCustomerProfileForStageServices({
    matchPolicy: "error",
    tokenPolicy: "error",
    fallbackComponents: {
      Card: "allow"
    }
  });
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
    `import { Card } from "@mui/material";
import { PrimaryButton as CustomerButton } from "@customer/components";

export const App = () => (
  <>
    <Card />
    <CustomerButton variant={"primary"}>{"Weiter"}</CustomerButton>
  </>
);
`,
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
      boardKey: "test-board-issue-1009-storybook-first-policy-ok"
    } satisfies GenerationDiffContext
  });

  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const componentMatchReportPath = path.join(executionContext.paths.jobDir, "component-match-report.json");
  const componentMatchReportArtifact = {
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
          resolved_import: 0,
          wrapper_fallback_allowed: 0,
          wrapper_fallback_denied: 0,
          unresolved: 0,
          ambiguous: 0,
          not_applicable: 2
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
          not_icon_family: 2
        }
      }
    },
    entries: [
      createComponentMatchReportArtifactForStageServices().entries[0],
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
        },
        resolvedApi: {
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
        resolvedProps: {
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
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(
      createStorybookEvidenceArtifactForStageServices({
        evidence: [
          {
            id: "theme-bundle-issue-1009",
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
          },
          {
            id: "story-args-issue-1009",
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
  await writeFile(componentMatchReportPath, `${JSON.stringify(componentMatchReportArtifact, null, 2)}\n`, "utf8");
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
    style?: {
      status?: string;
      issueCount?: number;
      storybook?: {
        evidence?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        componentMatchReport?: { status?: string };
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
  assert.equal(summary?.style?.status, "ok");
  assert.equal(summary?.style?.issueCount, 0);
  assert.equal(summary?.style?.storybook?.evidence?.status, "ok");
  assert.equal(summary?.style?.storybook?.tokens?.status, "ok");
  assert.equal(summary?.style?.storybook?.themes?.status, "ok");
  assert.equal(summary?.style?.storybook?.componentMatchReport?.status, "ok");
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
      profile_family_unresolved: 0,
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

test("ValidateProjectService hard-fails when a required Storybook artifact is missing", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.requestedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedStorybookStaticDir = executionContext.requestedStorybookStaticDir;

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify({ name: "generated-app", private: true }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"), "export const App = () => null;\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-storybook-missing-artifact"
    } satisfies GenerationDiffContext
  });

  const storybookCatalogPath = path.join(executionContext.paths.jobDir, "storybook.catalog.json");
  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  await writeFile(
    storybookCatalogPath,
    `${JSON.stringify(createStorybookCatalogArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(createStorybookEvidenceArtifactForStageServices({ evidence: [] }), null, 2)}\n`,
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
    key: STAGE_ARTIFACT_KEYS.storybookCatalog,
    stage: "ir.derive",
    absolutePath: storybookCatalogPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "ir.derive",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "ir.derive",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "ir.derive",
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
    /Storybook validation gate failed because required artifacts are missing or invalid/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    storybook?: {
      status?: string;
      artifacts?: {
        components?: { status?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.storybook?.status, "failed");
  assert.equal(summary?.storybook?.artifacts?.components?.status, "missing");
});

test("ValidateProjectService rejects malformed storybook.components artifacts", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.requestedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedStorybookStaticDir = executionContext.requestedStorybookStaticDir;

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify({ name: "generated-app", private: true }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"), "export const App = () => null;\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-storybook-invalid-components"
    } satisfies GenerationDiffContext
  });

  const storybookCatalogPath = path.join(executionContext.paths.jobDir, "storybook.catalog.json");
  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const storybookComponentsPath = path.join(executionContext.paths.jobDir, "storybook.components.json");
  await writeFile(
    storybookCatalogPath,
    `${JSON.stringify(createStorybookCatalogArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(createStorybookEvidenceArtifactForStageServices({ evidence: [] }), null, 2)}\n`,
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
    storybookComponentsPath,
    `${JSON.stringify(
      {
        ...createStorybookComponentsArtifactForStageServices(),
        components: [
          {
            id: 123,
            name: "Button",
            title: "Button",
            propKeys: [],
            storyCount: 1,
            hasDesignReference: true
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookCatalog,
    stage: "ir.derive",
    absolutePath: storybookCatalogPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "ir.derive",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "ir.derive",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "ir.derive",
    absolutePath: storybookThemesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    stage: "ir.derive",
    absolutePath: storybookComponentsPath
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
    /Storybook artifacts are unreadable or malformed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    storybook?: {
      status?: string;
      artifacts?: {
        components?: { status?: string; filePath?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.storybook?.status, "failed");
  assert.equal(summary?.storybook?.artifacts?.components?.status, "invalid");
  assert.equal(summary?.storybook?.artifacts?.components?.filePath, storybookComponentsPath);
});

test("ValidateProjectService rejects storybook.components artifacts that expose componentPath", async () => {
  const { executionContext, stageContextFor } = await createExecutionContext({});
  executionContext.requestedStorybookStaticDir = path.join(executionContext.resolvedWorkspaceRoot, "storybook-static");
  executionContext.resolvedStorybookStaticDir = executionContext.requestedStorybookStaticDir;

  await mkdir(path.join(executionContext.paths.generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "package.json"),
    `${JSON.stringify({ name: "generated-app", private: true }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(executionContext.paths.generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(executionContext.paths.generatedProjectDir, "src", "App.tsx"), "export const App = () => null;\n", "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: executionContext.paths.generatedProjectDir
  });
  await executionContext.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiffContext,
    stage: "codegen.generate",
    value: {
      boardKey: "test-board-storybook-component-path"
    } satisfies GenerationDiffContext
  });

  const storybookCatalogPath = path.join(executionContext.paths.jobDir, "storybook.catalog.json");
  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const storybookComponentsPath = path.join(executionContext.paths.jobDir, "storybook.components.json");
  await writeFile(
    storybookCatalogPath,
    `${JSON.stringify(createStorybookCatalogArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(createStorybookEvidenceArtifactForStageServices({ evidence: [] }), null, 2)}\n`,
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
    storybookComponentsPath,
    `${JSON.stringify(
      {
        ...createStorybookComponentsArtifactForStageServices(),
        stats: {
          entryCount: 1,
          componentCount: 1,
          componentWithDesignReferenceCount: 1,
          propKeyCount: 0
        },
        components: [
          {
            id: "component:button",
            name: "Button",
            title: "Button",
            propKeys: [],
            storyCount: 1,
            hasDesignReference: true,
            componentPath: "@customer/ui/Button"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookCatalog,
    stage: "ir.derive",
    absolutePath: storybookCatalogPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "ir.derive",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "ir.derive",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "ir.derive",
    absolutePath: storybookThemesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    stage: "ir.derive",
    absolutePath: storybookComponentsPath
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
    /Storybook artifacts are unreadable or malformed/
  );

  assert.equal(validationInvoked, false);
  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    storybook?: {
      status?: string;
      artifacts?: {
        components?: { status?: string; filePath?: string };
      };
    };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.storybook?.status, "failed");
  assert.equal(summary?.storybook?.artifacts?.components?.status, "invalid");
  assert.equal(summary?.storybook?.artifacts?.components?.filePath, storybookComponentsPath);
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
        byReason: { profile_icon_import_resolved: 0, profile_icon_import_missing: 0, profile_icon_wrapper_allowed: 0, profile_icon_wrapper_denied: 0, profile_icon_wrapper_missing: 0, profile_family_unresolved: 0, match_ambiguous: 0, match_unmatched: 0, not_icon_family: 0 }
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

  const summary = await executionContext.artifactStore.getValue<{
    status?: string;
    generatedApp?: { status?: string; failedCommand?: string };
  }>(STAGE_ARTIFACT_KEYS.validationSummary);
  assert.equal(summary?.status, "failed");
  assert.equal(summary?.generatedApp?.status, "failed");
  assert.equal(summary?.generatedApp?.failedCommand, "unknown");
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
  const storybookCatalogPath = path.join(executionContext.paths.jobDir, "storybook.catalog.json");
  const storybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.json");
  const storybookTokensPath = path.join(executionContext.paths.jobDir, "storybook.tokens.json");
  const storybookThemesPath = path.join(executionContext.paths.jobDir, "storybook.themes.json");
  const storybookComponentsPath = path.join(executionContext.paths.jobDir, "storybook.components.json");
  await writeFile(
    storybookCatalogPath,
    `${JSON.stringify(createStorybookCatalogArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    storybookEvidencePath,
    `${JSON.stringify(createStorybookEvidenceArtifactForStageServices({ evidence: [] }), null, 2)}\n`,
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
    storybookComponentsPath,
    `${JSON.stringify(createStorybookComponentsArtifactForStageServices(), null, 2)}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookCatalog,
    stage: "ir.derive",
    absolutePath: storybookCatalogPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "ir.derive",
    absolutePath: storybookEvidencePath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "ir.derive",
    absolutePath: storybookTokensPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "ir.derive",
    absolutePath: storybookThemesPath
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    stage: "ir.derive",
    absolutePath: storybookComponentsPath
  });
  const storybookComponentVisualCatalogPath = path.join(
    executionContext.paths.jobDir,
    "storybook.component-visual-catalog.json"
  );
  await writeFile(
    storybookComponentVisualCatalogPath,
    `${JSON.stringify(
      {
        artifact: "storybook.component-visual-catalog",
        version: 1,
        stats: {
          totalCount: 1,
          readyCount: 1,
          skippedCount: 0,
          byMatchStatus: {
            matched: 1,
            ambiguous: 0,
            unmatched: 0
          },
          bySkipReason: {
            unmatched: 0,
            ambiguous: 0,
            docs_only: 0,
            missing_story: 0,
            missing_reference_node: 0,
            missing_authoritative_story: 0
          }
        },
        entries: [
          {
            componentId: "Button",
            figmaFamilyKey: "button-primary",
            figmaFamilyName: "Button",
            matchStatus: "matched",
            comparisonStatus: "ready",
            warnings: [],
            familyId: "button",
            storyEntryId: "button--primary",
            storyTitle: "Button / Primary",
            iframeId: "storybook-preview-iframe",
            referenceFileKey: "fixture-file",
            referenceNodeId: "1:2",
            captureStrategy: "storybook_root_union",
            baselineCanvas: { padding: 16 }
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentVisualCatalog,
    stage: "ir.derive",
    absolutePath: storybookComponentVisualCatalogPath
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
