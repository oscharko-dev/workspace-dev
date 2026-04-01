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
import type { DesignIR } from "../../parity/types-ir.js";
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
      typography: {}
    }
  }) as DesignIR;

const createSuccessfulValidationResult = ({
  attempts = 1
}: {
  attempts?: number;
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
    }
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
  fallbackComponents
}: {
  matchPolicy?: "off" | "warn" | "error";
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
        token: "off",
        import: "error"
      }
    }
  });
  if (!customerProfile) {
    throw new Error("Failed to create stage-service storybook match customer profile fixture.");
  }
  return customerProfile;
};

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
  await writeFile(sourceIrPath, `${JSON.stringify(createMinimalIr(), null, 2)}\n`, "utf8");
  await writeFile(
    sourceAnalysisPath,
    `${JSON.stringify({ artifactVersion: 1, sourceName: "test", summary: { topLevelFrameCount: 1 } }, null, 2)}\n`,
    "utf8"
  );
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
  assert.equal((await readFile(executionContext.paths.figmaAnalysisFile, "utf8")).includes("\"artifactVersion\": 1"), true);
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
            component: "CustomerButton"
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
      boardKeySeed: "storybook-match-board"
    },
    stageContextFor("codegen.generate")
  );
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
            component: "CustomerButton"
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
  await writeFile(componentMatchReportPath, '{ "artifact": "component.match_report" }\n', "utf8");
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
