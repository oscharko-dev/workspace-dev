import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeterministicAppFile,
  createDeterministicScreenFile,
  createDeterministicThemeFile,
  deriveSelectOptions,
  generateArtifacts,
  generateArtifactsStreaming,
  toDeterministicScreenPath,
  detectFormGroups,
  normalizeIconImports,
  isDeepIconImport,
  extractSharedSxConstantsFromScreenContent
} from "./generator-core.js";
import { validateGeneratedSourceFile } from "./generated-source-validation.js";
import { figmaToDesignIr } from "./ir.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";
import { parseCustomerProfileConfig } from "../customer-profile.js";
import type { ResolvedStorybookTheme } from "../storybook/theme-resolver.js";

const toRgba = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  const payload = normalized.length >= 6 ? normalized.slice(0, 6) : normalized;
  if (!/^[0-9a-f]{6}$/i.test(payload)) {
    throw new Error(`Invalid hex color '${hex}'`);
  }
  return {
    r: Number.parseInt(payload.slice(0, 2), 16),
    g: Number.parseInt(payload.slice(2, 4), 16),
    b: Number.parseInt(payload.slice(4, 6), 16)
  };
};

const toFigmaColor = (hex: string): { r: number; g: number; b: number; a: number } => {
  const { r, g, b } = toRgba(hex);
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255,
    a: 1
  };
};

const toLuminance = (hex: string): number => {
  const { r, g, b } = toRgba(hex);
  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = toLuminance(foreground);
  const backgroundLuminance = toLuminance(background);
  const brighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (brighter + 0.05) / (darker + 0.05);
};

const extractThemeHex = ({
  themeContent,
  scheme,
  token
}: {
  themeContent: string;
  scheme: "light" | "dark";
  token: "primary" | "secondary" | "success" | "warning" | "error" | "info" | "background" | "divider";
}): string => {
  const pattern =
    token === "background"
      ? new RegExp(`${scheme}: \\{[\\s\\S]*?background: \\{ default: "(#[0-9a-f]+)"`, "i")
      : token === "divider"
        ? new RegExp(`${scheme}: \\{[\\s\\S]*?divider: "(#[0-9a-f]+)"`, "i")
        : new RegExp(`${scheme}: \\{[\\s\\S]*?${token}: \\{ main: "(#[0-9a-f]+)"`, "i");
  const match = themeContent.match(pattern);
  assert.ok(match?.[1], `Expected ${scheme}.${token} hex in generated theme.`);
  return match[1];
};

const countOccurrences = (source: string, token: string): number => source.split(token).length - 1;

const assertValidTsx = ({
  content,
  filePath
}: {
  content: string;
  filePath: string;
}): void => {
  validateGeneratedSourceFile({
    filePath,
    content
  });
};

const GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL = Symbol.for("workspace-dev.parity.generateArtifacts.runtimeAdapters");

const writeGeneratedFileFromRuntimeAdapter = async ({
  rootDir,
  relativePath,
  content
}: {
  rootDir: string;
  relativePath: string;
  content: string;
}): Promise<void> => {
  const absolutePath = path.resolve(rootDir, relativePath);
  const normalizedRootDir = path.resolve(rootDir);
  if (!absolutePath.startsWith(`${normalizedRootDir}${path.sep}`)) {
    throw new Error(`LLM attempted path traversal: ${relativePath}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
};

const createCustomerProfileForGeneratorTests = () => {
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
            importAlias: "CustomerButton",
            propMappings: {
              variant: "appearance"
            }
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
    throw new Error("Failed to create customer profile generator test fixture.");
  }
  return customerProfile;
};

const createIssue693CustomerProfileForGeneratorTests = () => {
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
          id: "Forms",
          tierPriority: 20,
          aliases: {
            figma: ["Forms"],
            storybook: ["forms"],
            code: ["@customer/forms"]
          }
        },
        {
          id: "Typography",
          tierPriority: 30,
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
            light: "sparkasse-light",
            dark: "sparkasse-dark"
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
          "@customer/typography": "^1.0.0"
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
    throw new Error("Failed to create Issue #693 customer profile generator test fixture.");
  }
  return customerProfile;
};

const createResolvedStorybookTheme = ({
  includeDark = true
}: {
  includeDark?: boolean;
} = {}): ResolvedStorybookTheme => {
  return {
    customerBrandId: "sparkasse-retail",
    brandMappingId: "sparkasse-retail",
    includeThemeModeToggle: includeDark,
    light: {
      themeId: "sparkasse-light",
      palette: {
        primary: {
          main: "#aa0000",
          contrastText: "#ffffff"
        },
        text: {
          primary: "#1f1f1f"
        },
        background: {
          default: "#f8f8f8",
          paper: "#ffffff"
        },
        divider: "#dddddd"
      },
      spacingBase: 10,
      borderRadius: 14,
      typography: {
        fontFamily: "Storybook Sans",
        base: {
          fontFamily: "Storybook Sans",
          fontSizePx: 16,
          fontWeight: 400,
          lineHeight: 1.5
        },
        variants: {
          h1: {
            fontFamily: "Storybook Sans",
            fontSizePx: 30,
            fontWeight: 700,
            lineHeight: 1.2
          },
          body1: {
            fontFamily: "Storybook Sans",
            fontSizePx: 16,
            fontWeight: 400,
            lineHeight: 1.5
          }
        }
      },
      components: {
        MuiButton: {
          rootStyleOverrides: {
            textTransform: "capitalize",
            padding: "12px"
          }
        }
      }
    },
    ...(includeDark
      ? {
          dark: {
            themeId: "sparkasse-dark",
            palette: {
              primary: {
                main: "#ff6666",
                contrastText: "#111111"
              },
              text: {
                primary: "#f4f4f4"
              },
              background: {
                default: "#121212",
                paper: "#1f1f1f"
              }
            },
            spacingBase: 10,
            borderRadius: 14,
            typography: {
              fontFamily: "Storybook Sans",
              base: {
                fontFamily: "Storybook Sans",
                fontSizePx: 16,
                fontWeight: 400,
                lineHeight: 1.5
              },
              variants: {}
            },
            components: {}
          }
        }
      : {}),
    tokensDocument: {
      customerBrandId: "sparkasse-retail",
      brandMappingId: "sparkasse-retail",
      includeThemeModeToggle: includeDark,
      light: {
        themeId: "sparkasse-light",
        palette: {
          primary: {
            main: "#aa0000",
            contrastText: "#ffffff"
          },
          text: {
            primary: "#1f1f1f"
          },
          background: {
            default: "#f8f8f8",
            paper: "#ffffff"
          },
          divider: "#dddddd"
        },
        spacingBase: 10,
        borderRadius: 14,
        typography: {
          fontFamily: "Storybook Sans",
          base: {
            fontFamily: "Storybook Sans",
            fontSizePx: 16,
            fontWeight: 400,
            lineHeight: 1.5
          },
          variants: {
            h1: {
              fontFamily: "Storybook Sans",
              fontSizePx: 30,
              fontWeight: 700,
              lineHeight: 1.2
            },
            body1: {
              fontFamily: "Storybook Sans",
              fontSizePx: 16,
              fontWeight: 400,
              lineHeight: 1.5
            }
          }
        },
        components: {
          MuiButton: {
            rootStyleOverrides: {
              textTransform: "capitalize",
              padding: "12px"
            }
          }
        }
      },
      ...(includeDark
        ? {
            dark: {
              themeId: "sparkasse-dark",
              palette: {
                primary: {
                  main: "#ff6666",
                  contrastText: "#111111"
                },
                text: {
                  primary: "#f4f4f4"
                },
                background: {
                  default: "#121212",
                  paper: "#1f1f1f"
                }
              },
              spacingBase: 10,
              borderRadius: 14,
              typography: {
                fontFamily: "Storybook Sans",
                base: {
                  fontFamily: "Storybook Sans",
                  fontSizePx: 16,
                  fontWeight: 400,
                  lineHeight: 1.5
                },
                variants: {}
              },
              components: {}
            }
          }
        : {})
    }
  };
};

const collectDeterministicSnapshot = async ({
  projectDir,
  screenName
}: {
  projectDir: string;
  screenName: string;
}): Promise<{
  appContent: string;
  screenContent: string;
  themeContent: string;
  tokensContent: string;
  metricsContent: string;
}> => {
  return {
    appContent: await readFile(path.join(projectDir, "src", "App.tsx"), "utf8"),
    screenContent: await readFile(path.join(projectDir, toDeterministicScreenPath(screenName)), "utf8"),
    themeContent: await readFile(path.join(projectDir, "src", "theme", "theme.ts"), "utf8"),
    tokensContent: await readFile(path.join(projectDir, "src", "theme", "tokens.json"), "utf8"),
    metricsContent: await readFile(path.join(projectDir, "generation-metrics.json"), "utf8")
  };
};

const readGeneratedStringArrayLiteral = ({
  source,
  variableName
}: {
  source: string;
  variableName: string;
}): string[] => {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`const ${escapedName}: string\\[] = (\\[[\\s\\S]*?\\]);`));
  assert.ok(match?.[1], `Expected array literal declaration for '${variableName}'.`);
  return JSON.parse(match?.[1] ?? "[]") as string[];
};

const readGeneratedStringArrayMapLiteral = ({
  source,
  variableName
}: {
  source: string;
  variableName: string;
}): Record<string, string[]> => {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`const ${escapedName}: Record<string, string\\[]> = (\\{[\\s\\S]*?\\});`));
  assert.ok(match?.[1], `Expected map literal declaration for '${variableName}'.`);
  return JSON.parse(match?.[1] ?? "{}") as Record<string, string[]>;
};

const createIr = () => ({
  sourceName: "Demo",
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#00aa55",
      background: "#fafafa",
      text: "#222222",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#2222221f",
      action: {
        active: "#2222228a",
        hover: "#ee00000a",
        selected: "#ee000014",
        disabled: "#22222242",
        disabledBackground: "#2222221f",
        focus: "#ee00001f"
      }
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16
    })
  },
  screens: [
    {
      id: "screen-1",
      name: "Übersicht",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "n1",
          name: "Titel",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Willkommen"
        },
        {
          id: "n2",
          name: "Konto Input",
          nodeType: "FRAME",
          type: "input" as const,
          text: "Kontonummer"
        },
        {
          id: "n3",
          name: "Weiter Button",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ]
});

const createMixedFallbackStageIr = () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "mixed-stage-screen",
      name: "Mixed Fallback Stage",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "mixed-stage-title",
          name: "Header Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Dashboard"
        },
        {
          id: "mixed-stage-nav",
          name: "Open Details",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Open Details",
          prototypeNavigation: {
            targetScreenId: "mixed-stage-target-screen",
            mode: "replace" as const
          }
        },
        {
          id: "mixed-stage-search-icon",
          name: "ic_search",
          nodeType: "INSTANCE",
          type: "container" as const,
          width: 24,
          height: 24,
          children: []
        },
        {
          id: "mixed-stage-input",
          name: "Kontonummer Input",
          nodeType: "FRAME",
          type: "input" as const,
          text: "Kontonummer"
        },
        {
          id: "mixed-offer-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "mixed-offer-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "mixed-offer-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "mixed-offer-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "mixed-offer-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "mixed-offer-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "mixed-offer-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "mixed-offer-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    },
    {
      id: "mixed-stage-target-screen",
      name: "Mixed Stage Target",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "mixed-stage-target-title",
          name: "Target Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Destination"
        }
      ]
    }
  ];
  return ir;
};

const mixedFallbackStageImageAssetMap = {
  "mixed-offer-image-a": "/images/mixed-offer-a.png",
  "mixed-offer-image-b": "/images/mixed-offer-b.png",
  "mixed-offer-image-c": "/images/mixed-offer-c.png"
};

const createRegressionScreen = () => ({
  id: "reg-screen-1",
  name: "Material UI View Nachbauen",
  layoutMode: "NONE" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "reg-title",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Bauen oder kaufen",
      x: 0,
      y: 0,
      fillColor: "#222222",
      fontFamily: "Roboto",
      fontWeight: 700,
      fontSize: 21
    },
    {
      id: "reg-input",
      name: "Styled(div)",
      nodeType: "FRAME",
      type: "container" as const,
      x: 0,
      y: 40,
      width: 560,
      height: 66,
      strokeColor: "#c8c8c8",
      cornerRadius: 8,
      children: [
        {
          id: "reg-input-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Monatliche Sparrate (optional)",
          x: 12,
          y: 50,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 12
        },
        {
          id: "reg-input-value-wrapper",
          name: "MuiInputBaseRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 12,
          y: 72,
          width: 300,
          height: 20,
          children: [
            {
              id: "reg-input-value",
              name: "MuiInputBaseInput",
              nodeType: "TEXT",
              type: "text" as const,
              text: "50,00",
              x: 12,
              y: 72,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "reg-input-currency",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "€",
          x: 530,
          y: 72,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 15
        }
      ]
    },
    {
      id: "reg-select",
      name: "Styled(div)",
      nodeType: "FRAME",
      type: "container" as const,
      x: 0,
      y: 120,
      width: 560,
      height: 66,
      strokeColor: "#c8c8c8",
      cornerRadius: 8,
      children: [
        {
          id: "reg-select-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Zu welchem Monat soll die Besparung starten?",
          x: 12,
          y: 130,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 12
        },
        {
          id: "reg-select-value-root",
          name: "MuiInputRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 12,
          y: 152,
          width: 320,
          height: 20,
          children: [
            {
              id: "reg-select-value",
              name: "MuiSelectSelect",
              nodeType: "TEXT",
              type: "text" as const,
              text: "April 2026",
              x: 12,
              y: 152,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "reg-select-icon",
          name: "MuiSvgIconRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 530,
          y: 150,
          width: 20,
          height: 20
        }
      ]
    },
    {
      id: "reg-button",
      name: "MuiButtonBaseRoot",
      nodeType: "FRAME",
      type: "button" as const,
      x: 0,
      y: 210,
      width: 280,
      height: 52,
      fillColor: "#3cf00f",
      cornerRadius: 4995,
      children: [
        {
          id: "reg-button-label",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Weiter",
          x: 120,
          y: 222,
          fillColor: "#ffffff",
          fontFamily: "Roboto",
          fontSize: 16,
          fontWeight: 700
        },
        {
          id: "reg-button-end-icon",
          name: "MuiButtonEndIcon",
          nodeType: "FRAME",
          type: "container" as const,
          x: 160,
          y: 220,
          width: 20,
          height: 20
        }
      ]
    }
  ]
});

const createStepperIconNode = ({
  id,
  x,
  y,
  fillColor
}: {
  id: string;
  x: number;
  y: number;
  fillColor: string;
}): any => ({
  id,
  name: "MuiSvgIconRoot",
  nodeType: "FRAME",
  type: "container" as const,
  x,
  y,
  width: 24,
  height: 24,
  fillColor,
  vectorPaths: [
    "M0 0L24 0L24 24L0 24L0 0Z",
    "M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2Z"
  ]
});

const createStepperConnectorNode = ({
  id,
  x,
  y,
  fillColor
}: {
  id: string;
  x: number;
  y: number;
  fillColor: string;
}): any => ({
  id,
  name: "Step Connector",
  nodeType: "RECTANGLE",
  type: "divider" as const,
  x,
  y,
  width: 20,
  height: 2,
  fillColor
});

const createSliderSectionNode = ({
  id,
  x,
  y
}: {
  id: string;
  x: number;
  y: number;
}): any => ({
  id,
  name: "Slider Section",
  nodeType: "FRAME",
  type: "container" as const,
  x,
  y,
  width: 260,
  height: 92,
  layoutMode: "VERTICAL" as const,
  gap: 8,
  children: [
    {
      id: `${id}-label`,
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "In wie viel Jahren planen Sie den Bau / Kauf?",
      x,
      y,
      fillColor: "#222222",
      fontFamily: "Roboto",
      fontSize: 14,
      fontWeight: 500
    },
    {
      id: `${id}-value`,
      name: "MuiInputBaseRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "12",
      x: x + 220,
      y,
      fillColor: "#222222",
      fontFamily: "Roboto",
      fontSize: 15,
      fontWeight: 500
    },
    {
      id: `${id}-slider`,
      name: "MuiSliderRoot",
      nodeType: "FRAME",
      type: "slider" as const,
      x,
      y: y + 32,
      width: 240,
      height: 24,
      children: [
        {
          id: `${id}-rail`,
          name: "MuiSliderRail",
          nodeType: "FRAME",
          type: "container" as const,
          x,
          y: y + 42,
          width: 240,
          height: 4
        },
        {
          id: `${id}-track`,
          name: "MuiSliderTrack",
          nodeType: "FRAME",
          type: "container" as const,
          x,
          y: y + 42,
          width: 96,
          height: 4
        },
        {
          id: `${id}-thumb`,
          name: "MuiSliderThumb",
          nodeType: "FRAME",
          type: "container" as const,
          x: x + 96,
          y: y + 34,
          width: 16,
          height: 16
        }
      ]
    },
    {
      id: `${id}-min`,
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "3",
      x,
      y: y + 72,
      fillColor: "#6e6e6e",
      fontFamily: "Roboto",
      fontSize: 12
    },
    {
      id: `${id}-max`,
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "25",
      x: x + 224,
      y: y + 72,
      fillColor: "#6e6e6e",
      fontFamily: "Roboto",
      fontSize: 12
    }
  ]
});

const createMuiBoardRegressionScreen = () => ({
  id: "mui-board-regression-screen",
  name: "Material UI Board Regression",
  layoutMode: "NONE" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "mui-board-title",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Bauen oder kaufen",
      x: 0,
      y: 0,
      fillColor: "#222222",
      fontFamily: "Roboto",
      fontWeight: 700,
      fontSize: 21
    },
    {
      id: "mui-board-stepper",
      name: "Progress Strip",
      nodeType: "FRAME",
      type: "container" as const,
      x: 0,
      y: 32,
      width: 136,
      height: 24,
      layoutMode: "HORIZONTAL" as const,
      gap: 8,
      children: [
        createStepperIconNode({ id: "mui-board-step-1", x: 0, y: 32, fillColor: "#4da36c" }),
        createStepperConnectorNode({ id: "mui-board-connector-1", x: 32, y: 43, fillColor: "#1f1f1f" }),
        createStepperIconNode({ id: "mui-board-step-2", x: 56, y: 32, fillColor: "#d7d7d7" }),
        createStepperConnectorNode({ id: "mui-board-connector-2", x: 88, y: 43, fillColor: "#d7d7d7" }),
        createStepperIconNode({ id: "mui-board-step-3", x: 112, y: 32, fillColor: "#d7d7d7" })
      ]
    },
    {
      id: "mui-board-form-table",
      name: "Form Layout Table",
      nodeType: "FRAME",
      type: "table" as const,
      x: 0,
      y: 80,
      width: 760,
      height: 280,
      layoutMode: "VERTICAL" as const,
      gap: 16,
      children: [
        {
          id: "mui-board-row-1",
          name: "Row 1",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 80,
          width: 760,
          height: 92,
          layoutMode: "HORIZONTAL" as const,
          gap: 20,
          children: [createRegressionScreen().children[1], createRegressionScreen().children[2]]
        },
        {
          id: "mui-board-row-2",
          name: "Row 2",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 188,
          width: 760,
          height: 120,
          layoutMode: "HORIZONTAL" as const,
          gap: 20,
          children: [
            createSliderSectionNode({ id: "mui-board-slider-section", x: 0, y: 188 }),
            {
              id: "mui-board-image",
              name: "Image (Bauen oder kaufen)",
              nodeType: "FRAME",
              type: "image" as const,
              x: 320,
              y: 188,
              width: 240,
              height: 160,
              asset: {
                source: "/images/bauen-oder-kaufen.png",
                kind: "image" as const
              }
            }
          ]
        }
      ]
    }
  ]
});

const createDetachedMuiFieldRegressionScreen = () => ({
  id: "mui-detached-field-regression-screen",
  name: "Detached Mui Fields",
  layoutMode: "NONE" as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  fillColor: "#ffffff",
  children: [
    {
      id: "detached-helper-text",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum.",
      x: 32,
      y: 8,
      fillColor: "#6e6e6e",
      fontFamily: "Roboto",
      fontSize: 12
    },
    {
      id: "detached-label-1",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Monatliche Sparrate (optional)",
      x: 32,
      y: 32,
      fillColor: "#6e6e6e",
      fontFamily: "Roboto",
      fontSize: 12
    },
    {
      id: "detached-input-1",
      name: "MuiInputBaseRoot",
      nodeType: "FRAME",
      type: "input" as const,
      x: 32,
      y: 56,
      width: 360,
      height: 22,
      children: [
        {
          id: "detached-input-1-value-root",
          name: "MuiInputBaseInput",
          nodeType: "FRAME",
          type: "input" as const,
          x: 32,
          y: 56,
          width: 320,
          height: 22,
          vectorPaths: ["M0 0L320 0L320 22L0 22L0 0Z"],
          children: [
            {
              id: "detached-input-1-value",
              name: "50,00",
              nodeType: "TEXT",
              type: "text" as const,
              text: "50,00",
              x: 32,
              y: 56,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "detached-input-1-suffix",
          name: "MuiTypographyRoot",
          nodeType: "TEXT",
          type: "text" as const,
          text: "€",
          x: 376,
          y: 56,
          fillColor: "#6e6e6e",
          fontFamily: "Roboto",
          fontSize: 15
        }
      ]
    },
    {
      id: "detached-label-2",
      name: "MuiTypographyRoot",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Zu welchem Monat soll die Besparung starten?",
      x: 32,
      y: 112,
      fillColor: "#6e6e6e",
      fontFamily: "Roboto",
      fontSize: 12
    },
    {
      id: "detached-input-2",
      name: "MuiInputRoot",
      nodeType: "FRAME",
      type: "input" as const,
      x: 32,
      y: 136,
      width: 360,
      height: 24,
      children: [
        {
          id: "detached-input-2-select",
          name: "MuiSelectSelect",
          nodeType: "FRAME",
          type: "select" as const,
          x: 32,
          y: 136,
          width: 320,
          height: 22,
          vectorPaths: ["M0 0L320 0L320 22L0 22L0 0Z"],
          children: [
            {
              id: "detached-input-2-value",
              name: "April 2026",
              nodeType: "TEXT",
              type: "text" as const,
              text: "April 2026",
              x: 32,
              y: 136,
              fillColor: "#222222",
              fontFamily: "Roboto",
              fontSize: 15,
              fontWeight: 500
            }
          ]
        },
        {
          id: "detached-input-2-icon",
          name: "MuiSvgIconRoot",
          nodeType: "FRAME",
          type: "container" as const,
          x: 368,
          y: 136,
          width: 23.993057250976562,
          height: 23.993057250976562,
          vectorPaths: ["M0 0L23.9931 0L23.9931 23.9931L0 23.9931L0 0Z"],
          children: [
            {
              id: "detached-input-2-icon-vector",
              name: "Vector",
              nodeType: "VECTOR",
              type: "container" as const,
              x: 374,
              y: 144,
              width: 11.996528625488281,
              height: 7.407856464385986,
              fillColor: "#6e6e6e",
              vectorPaths: ["M1.40959 0L5.99826 4.57868L10.5869 0L11.9965 1.40959L5.99826 7.40786L0 1.40959L1.40959 0Z"]
            }
          ]
        }
      ]
    },
    {
      id: "detached-image",
      name: "Image (Bauen oder kaufen)",
      nodeType: "FRAME",
      type: "image" as const,
      x: 432,
      y: 32,
      width: 280,
      height: 210,
      asset: {
        source: "/images/bauen-oder-kaufen.png",
        kind: "image" as const
      }
    }
  ]
});

const extractMuiIconImportLines = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^import\s+\w+\s+from\s+"@mui\/icons-material/.test(line));
};

const hasMuiIconBarrelImport = (content: string): boolean => {
  return /from\s+"@mui\/icons-material";/.test(content);
};

const extractContainerMaxWidth = (content: string): "sm" | "md" | "lg" | "xl" | undefined => {
  const match = content.match(/<Container\b[^>]*\bmaxWidth="(sm|md|lg|xl)"/);
  if (!match) {
    return undefined;
  }
  const value = match[1];
  if (value === "sm" || value === "md" || value === "lg" || value === "xl") {
    return value;
  }
  return undefined;
};

const findRenderedButtonLine = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const line = content
    .split("\n")
    .find((entry) => entry.includes("<Button ") && entry.includes(`{"${label}"}`));
  assert.ok(line, `Expected rendered Button line for label '${label}'`);
  return line ?? "";
};

const findRenderedTextFieldBlock = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const textFieldBlocks = content.match(/<TextField[\s\S]*?\/>/g) ?? [];
  const block = textFieldBlocks.find((entry) => entry.includes(`label={"${label}"}`));
  assert.ok(block, `Expected rendered TextField block for label '${label}'`);
  return block ?? "";
};

const findRenderedFormControlBlock = ({
  content,
  label
}: {
  content: string;
  label: string;
}): string => {
  const formControlBlocks = content.match(/<FormControl[\s\S]*?<\/FormControl>/g) ?? [];
  const block = formControlBlocks.find((entry) => entry.includes(`label={"${label}"}`));
  assert.ok(block, `Expected rendered FormControl block for label '${label}'`);
  return block ?? "";
};

const findThemeComponentBlock = ({
  themeContent,
  componentName
}: {
  themeContent: string;
  componentName: string;
}): string => {
  const marker = `    ${componentName}: {`;
  const startIndex = themeContent.indexOf(marker);
  assert.ok(startIndex >= 0, `Expected theme component block for '${componentName}'.`);
  const openingBraceIndex = themeContent.indexOf("{", startIndex);
  assert.ok(openingBraceIndex >= 0, `Expected opening brace for '${componentName}'.`);
  let depth = 0;
  for (let index = openingBraceIndex; index < themeContent.length; index += 1) {
    const char = themeContent[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return themeContent.slice(startIndex, index + 1);
      }
    }
  }
  assert.fail(`Failed to parse theme component block for '${componentName}'.`);
};

const findRenderedTypographyLine = ({
  content,
  text
}: {
  content: string;
  text: string;
}): string => {
  const line = content
    .split("\n")
    .find((entry) => entry.includes("<Typography") && entry.includes(`{"${text}"}`));
  assert.ok(line, `Expected rendered Typography line for text '${text}'`);
  return line ?? "";
};

const assertMarkersInOrder = ({
  content,
  markers
}: {
  content: string;
  markers: string[];
}): void => {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    assert.ok(index >= 0, `Expected marker '${marker}' to be present in output.`);
    assert.ok(index > previousIndex, `Expected marker '${marker}' to appear after previous markers.`);
    previousIndex = index;
  }
};

const createSemanticInputNode = ({
  id,
  name,
  label,
  placeholder,
  width = 320,
  height = 72
}: {
  id: string;
  name: string;
  label?: string;
  placeholder?: string;
  width?: number;
  height?: number;
}): any => {
  const children: any[] = [];
  if (label) {
    children.push({
      id: `${id}-label`,
      name: "Label",
      nodeType: "TEXT",
      type: "text" as const,
      text: label,
      y: 0
    });
  }
  if (placeholder) {
    children.push({
      id: `${id}-placeholder`,
      name: "Placeholder",
      nodeType: "TEXT",
      type: "text" as const,
      text: placeholder,
      textRole: "placeholder" as const,
      y: label ? 24 : 0
    });
  }

  return {
    id,
    name,
    nodeType: "FRAME",
    type: "input" as const,
    layoutMode: "VERTICAL" as const,
    gap: 4,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    width,
    height,
    children
  };
};

const createSemanticSelectInputNode = ({
  id,
  label,
  value
}: {
  id: string;
  label: string;
  value: string;
}): any => {
  return {
    id,
    name: "Styled(div)",
    nodeType: "FRAME",
    type: "input" as const,
    width: 320,
    height: 72,
    children: [
      {
        id: `${id}-label`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text: label,
        y: 0
      },
      {
        id: `${id}-value`,
        name: "MuiSelectSelect",
        nodeType: "TEXT",
        type: "text" as const,
        text: value,
        y: 24
      }
    ]
  };
};

test("deterministic file helpers create expected paths and content", () => {
  const ir = createIr();
  const screen = ir.screens[0];
  const themeContent = createDeterministicThemeFile(ir).content;
  const appContent = createDeterministicAppFile(ir.screens).content;

  assert.equal(toDeterministicScreenPath("Kredit Übersicht"), "src/screens/Kredit_bersicht.tsx");
  assert.equal(createDeterministicThemeFile(ir).path, "src/theme/theme.ts");
  assert.equal(createDeterministicScreenFile(screen).path.startsWith("src/screens/"), true);
  assert.equal(createDeterministicAppFile(ir.screens).path, "src/App.tsx");
  assert.ok(themeContent.includes('import { extendTheme } from "@mui/material/styles"'));
  assert.ok(themeContent.includes("extendTheme({"));
  assert.equal(themeContent.includes("cssVariables"), false);
  assert.ok(themeContent.includes("colorSchemes: {"));
  assert.ok(themeContent.includes("light: {"));
  assert.ok(themeContent.includes("dark: {"));
  assert.equal(themeContent.includes('palette: {\n    mode: "light"'), false);
  assert.ok(themeContent.includes('success: { main: "#16a34a" }'));
  assert.ok(themeContent.includes('warning: { main: "#d97706" }'));
  assert.ok(themeContent.includes('error: { main: "#dc2626" }'));
  assert.ok(themeContent.includes('info: { main: "#0288d1" }'));
  assert.ok(themeContent.includes('divider: "#2222221f"'));
  assert.ok(themeContent.includes('focus: "#ee00001f"'));
  assert.ok(themeContent.includes('background: { default: "#121212", paper: "#1e1e1e" }'));
  assert.ok(themeContent.includes('divider: "#f5f7fb1f"'));
  assert.ok(themeContent.includes('subtitle1: { fontSize:'));
  assert.ok(themeContent.includes('button: { fontSize:'));
  assert.ok(themeContent.includes('overline: { fontSize:'));
  assert.ok(themeContent.includes('letterSpacing: "0.08em"'));
  assert.ok(themeContent.includes('textTransform: "none"'));
  assert.equal(themeContent.includes("breakpoints: {"), false);
  assert.ok(appContent.includes('import { useColorScheme } from "@mui/material/styles";'));
  assert.ok(appContent.includes('import ErrorBoundary from "./components/ErrorBoundary";'));
  assert.ok(appContent.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appContent.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appContent.includes('data-testid="theme-mode-toggle"'));
  assert.ok(appContent.includes("element={<ErrorBoundary><"));
  assert.ok(appContent.includes('window.matchMedia("(prefers-color-scheme: dark)")'));
  assert.ok(appContent.includes('setMode(nextMode)'));
});

test("createDeterministicThemeFile derives deterministic component overrides from IR samples", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-defaults-screen",
      name: "Theme Defaults Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "theme-card-a",
          name: "Card A",
          nodeType: "FRAME",
          type: "card" as const,
          x: 0,
          y: 0,
          width: 280,
          height: 160,
          cornerRadius: 18,
          elevation: 7,
          children: [{ id: "theme-card-a-text", name: "Card A Text", nodeType: "TEXT", type: "text" as const, text: "A" }]
        },
        {
          id: "theme-card-b",
          name: "Card B",
          nodeType: "FRAME",
          type: "card" as const,
          x: 0,
          y: 180,
          width: 280,
          height: 160,
          cornerRadius: 18,
          elevation: 7,
          children: [{ id: "theme-card-b-text", name: "Card B Text", nodeType: "TEXT", type: "text" as const, text: "B" }]
        },
        {
          id: "theme-input",
          name: "Styled(div)",
          nodeType: "FRAME",
          type: "input" as const,
          x: 0,
          y: 360,
          width: 280,
          height: 56,
          cornerRadius: 10,
          children: [{ id: "theme-input-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "IBAN" }]
        },
        {
          id: "theme-chip",
          name: "Status Chip",
          nodeType: "FRAME",
          type: "chip" as const,
          x: 0,
          y: 436,
          width: 120,
          height: 24,
          cornerRadius: 14,
          children: [{ id: "theme-chip-text", name: "Chip Label", nodeType: "TEXT", type: "text" as const, text: "Neu" }]
        },
        {
          id: "theme-paper",
          name: "Info Paper",
          nodeType: "FRAME",
          type: "paper" as const,
          x: 0,
          y: 480,
          width: 280,
          height: 120,
          elevation: 3,
          children: [{ id: "theme-paper-text", name: "Paper Text", nodeType: "TEXT", type: "text" as const, text: "Info" }]
        },
        {
          id: "theme-appbar",
          name: "Top AppBar",
          nodeType: "FRAME",
          type: "appbar" as const,
          x: 0,
          y: 620,
          width: 320,
          height: 64,
          fillColor: "#123456",
          children: [{ id: "theme-appbar-text", name: "AppBar Text", nodeType: "TEXT", type: "text" as const, text: "Übersicht" }]
        },
        {
          id: "theme-divider",
          name: "Divider",
          nodeType: "RECTANGLE",
          type: "divider" as const,
          x: 0,
          y: 704,
          width: 280,
          height: 1,
          fillColor: "#d4d4d4"
        },
        {
          id: "theme-avatar",
          name: "Avatar",
          nodeType: "FRAME",
          type: "avatar" as const,
          x: 0,
          y: 725,
          width: 42,
          height: 42,
          cornerRadius: 21,
          children: [{ id: "theme-avatar-text", name: "Avatar Text", nodeType: "TEXT", type: "text" as const, text: "AB" }]
        }
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const orderedComponents = ["MuiButton", "MuiCard", "MuiTextField", "MuiChip", "MuiPaper", "MuiAppBar", "MuiDivider", "MuiAvatar"];
  let previousIndex = -1;
  for (const componentName of orderedComponents) {
    const currentIndex = themeContent.indexOf(`${componentName}: {`);
    assert.ok(currentIndex > previousIndex, `Expected '${componentName}' in deterministic component order.`);
    previousIndex = currentIndex;
  }
  const cardBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiCard"
  });
  const chipBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiChip"
  });
  assert.ok(themeContent.includes("defaultProps: { elevation: 7 }"));
  assert.ok(cardBlock.includes('borderRadius: "18px"'));
  assert.ok(themeContent.includes('"\\u0026 .MuiOutlinedInput-root"'));
  assert.ok(themeContent.includes('borderRadius: "10px"'));
  assert.ok(themeContent.includes('defaultProps: { size: "small" }'));
  assert.ok(chipBlock.includes('borderRadius: "14px"'));
  assert.ok(themeContent.includes("MuiPaper: {"));
  assert.ok(themeContent.includes("defaultProps: { elevation: 3 }"));
  assert.ok(themeContent.includes('backgroundColor: "#123456"'));
  assert.ok(themeContent.includes('borderColor: "#d4d4d4"'));
  assert.ok(themeContent.includes('width: "42px"'));
  assert.ok(themeContent.includes('height: "42px"'));
  assert.ok(themeContent.includes('borderRadius: "21px"'));
});

test("createDeterministicThemeFile derives C1 sx overrides at 70% threshold and keeps extraction conservative", () => {
  const createButtonNode = ({
    id,
    y,
    fillColor
  }: {
    id: string;
    y: number;
    fillColor: string;
  }) => ({
    id,
    name: `Button ${id}`,
    nodeType: "FRAME",
    type: "button" as const,
    x: 0,
    y,
    width: 220,
    height: 48,
    fillColor,
    children: [{ id: `${id}-label`, name: "Label", nodeType: "TEXT", type: "text" as const, text: "Weiter" }]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-threshold-screen",
      name: "Theme C1 Threshold",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        createButtonNode({ id: "c1-button-a", y: 0, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-b", y: 64, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-c", y: 128, fillColor: "#1357AA" }),
        createButtonNode({ id: "c1-button-d", y: 192, fillColor: "#226699" })
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const buttonBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiButton"
  });

  assert.ok(buttonBlock.includes('textTransform: "none"'));
  assert.ok(buttonBlock.includes('backgroundColor: "#1357aa"'));
  assert.equal(buttonBlock.includes("left:"), false);
  assert.equal(buttonBlock.includes("top:"), false);
  assert.equal(buttonBlock.includes("width:"), false);
  assert.equal(buttonBlock.includes("px:"), false);
});

test("createDeterministicThemeFile does not derive C1 overrides below minimum sample size", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-min-samples-screen",
      name: "Theme C1 Min Samples",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "c1-min-button-a",
          name: "Button A",
          nodeType: "FRAME",
          type: "button" as const,
          x: 0,
          y: 0,
          width: 220,
          height: 48,
          fillColor: "#0f4c81",
          children: [{ id: "c1-min-button-a-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Speichern" }]
        },
        {
          id: "c1-min-button-b",
          name: "Button B",
          nodeType: "FRAME",
          type: "button" as const,
          x: 0,
          y: 64,
          width: 220,
          height: 48,
          fillColor: "#0f4c81",
          children: [{ id: "c1-min-button-b-text", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Speichern" }]
        }
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const buttonBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiButton"
  });
  assert.equal(buttonBlock.includes("backgroundColor"), false);
});

test("createDeterministicThemeFile keeps deterministic ordering for C1-only component overrides", () => {
  const makeIconOnlyButton = ({ id, y }: { id: string; y: number }) => ({
    id,
    name: `Icon Button ${id}`,
    nodeType: "FRAME",
    type: "button" as const,
    x: 0,
    y,
    width: 40,
    height: 40,
    fillColor: "#f1f1f1",
    children: [{ id: `${id}-icon`, name: "ic_bookmark_outline", nodeType: "INSTANCE", type: "container" as const, width: 24, height: 24 }]
  });
  const makeSemanticSelectInputNode = ({
    id,
    y
  }: {
    id: string;
    y: number;
  }) => ({
    id,
    name: "Styled(div)",
    nodeType: "FRAME",
    type: "input" as const,
    x: 0,
    y,
    width: 320,
    height: 72,
    fillColor: "#f5f5f5",
    children: [
      {
        id: `${id}-label`,
        name: "Label",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Kontotyp",
        y
      },
      {
        id: `${id}-value`,
        name: "MuiSelectSelect",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Privat",
        y: y + 24
      }
    ]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-order-screen",
      name: "Theme C1 Order",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        makeSemanticSelectInputNode({ id: "c1-select-a", y: 0 }),
        makeSemanticSelectInputNode({ id: "c1-select-b", y: 84 }),
        makeSemanticSelectInputNode({ id: "c1-select-c", y: 168 }),
        makeIconOnlyButton({ id: "c1-icon-a", y: 260 }),
        makeIconOnlyButton({ id: "c1-icon-b", y: 320 }),
        makeIconOnlyButton({ id: "c1-icon-c", y: 380 })
      ]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const formControlIndex = themeContent.indexOf("MuiFormControl: {");
  const iconButtonIndex = themeContent.indexOf("MuiIconButton: {");
  assert.ok(formControlIndex >= 0);
  assert.ok(iconButtonIndex > formControlIndex);
});

test("createDeterministicThemeFile does not allow C1 to override A3 component defaults", () => {
  const createCardNode = ({ id, y }: { id: string; y: number }) => ({
    id,
    name: `Card ${id}`,
    nodeType: "FRAME",
    type: "card" as const,
    x: 0,
    y,
    width: 300,
    height: 160,
    cornerRadius: 12,
    elevation: 3,
    children: [{ id: `${id}-text`, name: "Text", nodeType: "TEXT", type: "text" as const, text: "Info" }]
  });

  const ir = createIr();
  ir.screens = [
    {
      id: "theme-c1-a3-precedence-screen",
      name: "Theme C1 A3 Precedence",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [createCardNode({ id: "c1-card-a", y: 0 }), createCardNode({ id: "c1-card-b", y: 176 }), createCardNode({ id: "c1-card-c", y: 352 })]
    }
  ];

  const themeContent = createDeterministicThemeFile(ir).content;
  const cardBlock = findThemeComponentBlock({
    themeContent,
    componentName: "MuiCard"
  });
  assert.ok(cardBlock.includes('borderRadius: "12px"'));
  assert.equal(/borderRadius:\s*1(?!\d)/.test(cardBlock), false);
});

test("createDeterministicThemeFile keeps fallback-safe deterministic output when component samples are invalid", () => {
  const ir = createIr();
  ir.screens = [
    {
      id: "theme-invalid-screen",
      name: "Theme Invalid Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "theme-invalid-card",
          name: "Invalid Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 140,
          cornerRadius: Number.NaN,
          elevation: Number.POSITIVE_INFINITY,
          children: [{ id: "theme-invalid-card-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Invalid" }]
        },
        {
          id: "theme-invalid-paper",
          name: "Invalid Paper",
          nodeType: "FRAME",
          type: "paper" as const,
          width: 280,
          height: 120,
          elevation: Number.NaN,
          children: [{ id: "theme-invalid-paper-text", name: "Text", nodeType: "TEXT", type: "text" as const, text: "Invalid" }]
        },
        {
          id: "theme-invalid-avatar",
          name: "Invalid Avatar",
          nodeType: "FRAME",
          type: "avatar" as const,
          width: Number.POSITIVE_INFINITY,
          height: Number.NaN,
          cornerRadius: Number.NaN,
          children: [{ id: "theme-invalid-avatar-text", name: "Avatar Text", nodeType: "TEXT", type: "text" as const, text: "AV" }]
        }
      ]
    }
  ];

  const firstTheme = createDeterministicThemeFile(ir).content;
  const secondTheme = createDeterministicThemeFile(ir).content;

  assert.equal(firstTheme, secondTheme);
  assert.ok(firstTheme.includes("MuiButton: {"));
  assert.equal(firstTheme.includes("MuiCard: {"), false);
  assert.equal(firstTheme.includes("MuiTextField: {"), false);
  assert.equal(firstTheme.includes("MuiChip: {"), false);
  assert.equal(firstTheme.includes("MuiPaper: {"), false);
  assert.equal(firstTheme.includes("MuiAppBar: {"), false);
  assert.equal(firstTheme.includes("MuiDivider: {"), false);
  assert.equal(firstTheme.includes("MuiAvatar: {"), false);
});

test("deterministic theme dark palette remains byte-stable and accessible on dark surfaces", () => {
  const ir = createIr();
  const firstTheme = createDeterministicThemeFile(ir).content;
  const secondTheme = createDeterministicThemeFile(ir).content;

  assert.equal(firstTheme, secondTheme);

  const darkBackground = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "background"
  });
  const darkPrimary = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "primary"
  });
  const darkSecondary = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "secondary"
  });
  const darkSuccess = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "success"
  });
  const darkWarning = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "warning"
  });
  const darkError = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "error"
  });
  const darkInfo = extractThemeHex({
    themeContent: firstTheme,
    scheme: "dark",
    token: "info"
  });

  for (const color of [darkPrimary, darkSecondary, darkSuccess, darkWarning, darkError, darkInfo]) {
    assert.ok(contrastRatio(color, darkBackground) >= 4.5);
  }
});

test("deterministic screen rendering uses a single root Container without unnecessary Box import", () => {
  const screen = {
    id: "single-root-container-screen",
    name: "Single Root Container",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-root-container-text",
        name: "Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Hello Container"
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const materialImportLine = content
    .split("\n")
    .find((line) => line.startsWith("import { ") && line.endsWith(' } from "@mui/material";'));
  assert.ok(materialImportLine);
  assert.ok(materialImportLine?.includes("Container"));
  assert.ok(materialImportLine?.includes("Typography"));
  assert.equal(materialImportLine?.includes("Box"), false);
  assert.equal((content.match(/<Container /g) ?? []).length, 1);
  assert.equal(content.includes('<Box sx={{ minHeight: "100vh"'), false);
  assert.ok(content.includes('sx={{ position: "relative", width: "100%", minHeight: "max(100vh, 320px)"'));
});

test("generateArtifacts simplify wrapper promotes deep GROUP multi-child containers and logs stats", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-group-deep-"));
  const logs: string[] = [];
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-group-deep-screen",
      name: "Simplify Group Deep",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "group-depth-root",
          name: "Depth Root",
          nodeType: "FRAME",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 360,
          height: 280,
          fillColor: "#ffffff",
          children: [
            {
              id: "group-depth-inner",
              name: "Depth Inner",
              nodeType: "FRAME",
              type: "container" as const,
              x: 16,
              y: 16,
              width: 320,
              height: 220,
              fillColor: "#f8fafc",
              children: [
                {
                  id: "group-depth-target",
                  name: "Promotable Group",
                  nodeType: "GROUP",
                  type: "container" as const,
                  x: 24,
                  y: 24,
                  width: 280,
                  height: 100,
                  children: [
                    {
                      id: "group-depth-text-a",
                      name: "Group Text A",
                      nodeType: "TEXT",
                      type: "text" as const,
                      text: "Erster Eintrag",
                      x: 24,
                      y: 24
                    },
                    {
                      id: "group-depth-text-b",
                      name: "Group Text B",
                      nodeType: "TEXT",
                      type: "text" as const,
                      text: "Zweiter Eintrag",
                      x: 24,
                      y: 56
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 1);
  assert.equal(result.generationMetrics.simplification?.screens[0]?.promotedGroupMultiChild, 1);
  assert.ok(logs.some((entry) => entry.includes("Simplify stats:")));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as {
    simplification?: {
      aggregate?: { promotedGroupMultiChild?: number };
      screens?: Array<{ promotedGroupMultiChild?: number }>;
    };
  };
  assert.equal(metrics.simplification?.aggregate?.promotedGroupMultiChild, 1);
  assert.equal(metrics.simplification?.screens?.[0]?.promotedGroupMultiChild, 1);
});

test("generateArtifacts simplify wrapper does not promote shallow GROUP multi-child containers", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-group-shallow-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-group-shallow-screen",
      name: "Simplify Group Shallow",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "group-shallow-target",
          name: "Shallow Group",
          nodeType: "GROUP",
          type: "container" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          children: [
            {
              id: "group-shallow-a",
              name: "Shallow A",
              nodeType: "TEXT",
              type: "text" as const,
              text: "A"
            },
            {
              id: "group-shallow-b",
              name: "Shallow B",
              nodeType: "TEXT",
              type: "text" as const,
              text: "B"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 0);
  assert.equal(result.generationMetrics.simplification?.screens[0]?.promotedGroupMultiChild, 0);
});

test("generateArtifacts simplify wrapper does not promote non-GROUP multi-child flex wrappers", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-frame-multi-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-frame-multi-screen",
      name: "Simplify Frame Multi",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "frame-multi-target",
          name: "Frame Multi Wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          layoutMode: "HORIZONTAL" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          children: [
            {
              id: "frame-multi-a",
              name: "Frame Multi A",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Element A"
            },
            {
              id: "frame-multi-b",
              name: "Frame Multi B",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Element B"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedGroupMultiChild, 0);
  assert.equal(result.generationMetrics.simplification?.aggregate.promotedSingleChild, 0);
});

test("deterministic screen rendering simplify wrapper merges parent margin and padding into promoted single child", () => {
  const screen = {
    id: "single-child-spacing-merge-screen",
    name: "Single Child Spacing Merge",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "single-child-spacing-wrapper",
        name: "Spacing Wrapper",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        margin: { top: 8, right: 16, bottom: 24, left: 32 },
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        children: [
          {
            id: "single-child-spacing-target",
            name: "Promoted Target",
            nodeType: "FRAME",
            type: "container" as const,
            x: 0,
            y: 0,
            width: 280,
            height: 120,
            fillColor: "#ffffff",
            margin: { top: 8, right: 8, bottom: 8, left: 8 },
            children: [
              {
                id: "single-child-spacing-text",
                name: "Spacing Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Spacing merged"
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("mt: 3"));
  assert.ok(content.includes("mr: 4"));
  assert.ok(content.includes("mb: 5"));
  assert.ok(content.includes("ml: 6"));
});

test("generateArtifacts simplify wrapper guardrails keep navigation and icon wrappers from promotion", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-simplify-guardrails-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "simplify-guardrails-screen",
      name: "Simplify Guardrails",
      layoutMode: "NONE" as const,
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "guardrail-nav-wrapper",
          name: "Navigation Wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          prototypeNavigation: {
            targetScreenId: "screen-1",
            mode: "push" as const
          },
          children: [
            {
              id: "guardrail-nav-text",
              name: "Navigation Text",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Open destination"
            }
          ]
        },
        {
          id: "guardrail-icon-wrapper",
          name: "icon/wrapper",
          nodeType: "FRAME",
          type: "container" as const,
          children: [
            {
              id: "guardrail-icon-text",
              name: "Icon Label",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Icon wrapper text"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generationMetrics.simplification?.aggregate.promotedSingleChild, 0);
  assert.equal((result.generationMetrics.simplification?.aggregate.guardedSkips ?? 0) >= 2, true);
});

test("deterministic screen rendering omits redundant boxSizing and visible overflow defaults", () => {
  const screen = {
    id: "no-redundant-defaults-screen",
    name: "No Redundant Defaults",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "defaults-container",
        name: "Defaults Container",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        fillColor: "#ffffff",
        children: [
          {
            id: "defaults-text",
            name: "Defaults Text",
            nodeType: "TEXT",
            type: "text" as const,
            x: 16,
            y: 16,
            width: 160,
            height: 20,
            text: "Kontostand"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assert.equal(content.includes('boxSizing: "border-box"'), false);
  assert.equal(content.includes('overflow: "visible"'), false);
  assert.match(content, /<Container\b[^>]*\bmaxWidth=/);
});

test("sortChildren visual hierarchy keeps row grouping for layout NONE with x interleaving", () => {
  const screen = {
    id: "sortchildren-row-grouping-screen",
    name: "SortChildren Row Grouping",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "row-grouping-container",
        name: "Row Grouping Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 220,
        children: [
          {
            id: "row-bottom-left",
            name: "Bottom Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bottom Left Item",
            x: 20,
            y: 120
          },
          {
            id: "row-top-right",
            name: "Top Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Top Right Item",
            x: 250,
            y: 10
          },
          {
            id: "row-bottom-right",
            name: "Bottom Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Bottom Right Item",
            x: 260,
            y: 120
          },
          {
            id: "row-top-left",
            name: "Top Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Top Left Item",
            x: 10,
            y: 10
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Top Left Item"}', '{"Top Right Item"}', '{"Bottom Left Item"}', '{"Bottom Right Item"}']
  });
});

test("sortChildren visual hierarchy preserves overlap order via source index", () => {
  const screen = {
    id: "sortchildren-overlap-screen",
    name: "SortChildren Overlap",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "overlap-container",
        name: "Overlap Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 180,
        children: [
          {
            id: "overlap-first",
            name: "First Layer",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Overlap First Layer",
            x: 120,
            y: 24,
            width: 160,
            height: 28
          },
          {
            id: "overlap-second",
            name: "Second Layer",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Overlap Second Layer",
            x: 80,
            y: 24,
            width: 160,
            height: 28
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Overlap First Layer"}', '{"Overlap Second Layer"}']
  });
});

test("sortChildren visual hierarchy orders row semantics as header navigation content decorative", () => {
  const screen = {
    id: "sortchildren-semantic-screen",
    name: "SortChildren Semantic",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "semantic-container",
        name: "Semantic Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 420,
        height: 200,
        children: [
          {
            id: "semantic-content",
            name: "Body Copy",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Content",
            x: 20,
            y: 20
          },
          {
            id: "semantic-divider",
            name: "Decorative Divider",
            nodeType: "FRAME",
            type: "divider" as const,
            x: 140,
            y: 20,
            width: 200,
            height: 1,
            fillColor: "#e5e7eb"
          },
          {
            id: "semantic-navigation",
            name: "Main Navigation",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Navigation",
            x: 220,
            y: 20
          },
          {
            id: "semantic-header",
            name: "Page Heading",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Semantic Header",
            x: 320,
            y: 20,
            fontSize: 30,
            fontWeight: 700
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Semantic Header"}', '{"Semantic Navigation"}', '{"Semantic Content"}', '<Divider data-ir-id="semantic-divider"']
  });
});

test("sortChildren visual hierarchy supports rtl locale x ordering for NONE rows", () => {
  const screen = {
    id: "sortchildren-rtl-screen",
    name: "SortChildren RTL",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "rtl-container",
        name: "RTL Container",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "NONE" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        children: [
          {
            id: "rtl-left",
            name: "Left Item",
            nodeType: "TEXT",
            type: "text" as const,
            text: "RTL Left",
            x: 20,
            y: 24
          },
          {
            id: "rtl-right",
            name: "Right Item",
            nodeType: "TEXT",
            type: "text" as const,
            text: "RTL Right",
            x: 220,
            y: 24
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { generationLocale: "ar-EG" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"RTL Right"}', '{"RTL Left"}']
  });
});

test("sortChildren regression keeps HORIZONTAL and VERTICAL ordering unchanged", () => {
  const screen = {
    id: "sortchildren-regression-screen",
    name: "SortChildren Regression",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "horizontal-container",
        name: "Horizontal",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "HORIZONTAL" as const,
        x: 0,
        y: 0,
        width: 360,
        height: 80,
        children: [
          {
            id: "horizontal-right",
            name: "Horizontal Right",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Right",
            x: 240,
            y: 10
          },
          {
            id: "horizontal-left",
            name: "Horizontal Left",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Left",
            x: 20,
            y: 10
          },
          {
            id: "horizontal-middle",
            name: "Horizontal Middle",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Horizontal Middle",
            x: 140,
            y: 10
          }
        ]
      },
      {
        id: "vertical-container",
        name: "Vertical",
        nodeType: "FRAME",
        type: "container" as const,
        layoutMode: "VERTICAL" as const,
        x: 0,
        y: 120,
        width: 360,
        height: 140,
        children: [
          {
            id: "vertical-bottom",
            name: "Vertical Bottom",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Bottom",
            x: 0,
            y: 90
          },
          {
            id: "vertical-top",
            name: "Vertical Top",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Top",
            x: 0,
            y: 10
          },
          {
            id: "vertical-middle",
            name: "Vertical Middle",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vertical Middle",
            x: 0,
            y: 50
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assertMarkersInOrder({
    content,
    markers: ['{"Horizontal Left"}', '{"Horizontal Middle"}', '{"Horizontal Right"}']
  });
  assertMarkersInOrder({
    content,
    markers: ['{"Vertical Top"}', '{"Vertical Middle"}', '{"Vertical Bottom"}']
  });
});

test("deterministic screen rendering maps container maxWidth boundaries from content width", () => {
  const buildScreen = (width: number) => ({
    id: `container-width-${width}`,
    name: `Container Width ${width}`,
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: `paper-width-${width}`,
        name: `Paper ${width}`,
        nodeType: "FRAME",
        type: "paper" as const,
        x: 0,
        y: 0,
        width,
        height: 80,
        fillColor: "#ffffff",
        children: []
      }
    ]
  });

  const cases: Array<{ width: number; expected: "sm" | "md" | "lg" | "xl" }> = [
    { width: 600, expected: "sm" },
    { width: 601, expected: "md" },
    { width: 900, expected: "md" },
    { width: 901, expected: "lg" },
    { width: 1200, expected: "lg" },
    { width: 1201, expected: "xl" },
    { width: 1536, expected: "xl" },
    { width: 1537, expected: "xl" }
  ];

  for (const testCase of cases) {
    const content = createDeterministicScreenFile(buildScreen(testCase.width)).content;
    assert.equal(
      extractContainerMaxWidth(content),
      testCase.expected,
      `Expected width ${testCase.width} to map to maxWidth=${testCase.expected}`
    );
  }
});

test("generateArtifacts writes deterministic output and mapping diagnostics", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-"));
  const logs: string[] = [];

  const result = await generateArtifacts({
    projectDir,
    ir: createIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => {
      logs.push(message);
    },
    componentMappings: [
      {
        boardKey: "board-a",
        nodeId: "n2",
        componentName: "MappedInput",
        importPath: "@acme/ui",
        priority: 1,
        source: "local_override",
        enabled: true
      },
      {
        boardKey: "board-a",
        nodeId: "n1",
        componentName: "",
        importPath: "@acme/ui",
        priority: 2,
        source: "code_connect_import",
        enabled: true
      },
      {
        boardKey: "board-a",
        nodeId: "n3",
        componentName: "Disabled",
        importPath: "@acme/ui",
        priority: 3,
        source: "code_connect_import",
        enabled: false
      },
      {
        boardKey: "board-a",
        nodeId: "unknown-node",
        componentName: "Unknown",
        importPath: "@acme/ui",
        priority: 4,
        source: "code_connect_import",
        enabled: true
      }
    ]
  });

  assert.equal(result.themeApplied, false);
  assert.equal(result.screenApplied, 0);
  assert.equal(result.screenTotal, 1);
  assert.deepEqual(result.screenRejected, []);
  assert.deepEqual(result.llmWarnings, []);
  assert.equal(result.generatedPaths.includes("src/App.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/components/ErrorBoundary.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/components/ScreenSkeleton.tsx"), true);
  assert.equal(result.generatedPaths.includes("generation-metrics.json"), true);
  assert.equal(result.generationMetrics.fetchedNodes, 0);
  assert.equal(result.mappingCoverage?.usedMappings, 1);
  assert.equal(result.mappingCoverage?.fallbackNodes, 3);
  assert.equal(result.mappingCoverage?.totalCandidateNodes, 4);
  assert.equal(result.mappingDiagnostics.missingMappingCount, 1);
  assert.equal(result.mappingDiagnostics.contractMismatchCount, 1);
  assert.equal(result.mappingDiagnostics.disabledMappingCount, 1);
  assert.ok(logs.some((entry) => entry.includes("deterministic")));

  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");
  assert.ok(appContent.includes("BrowserRouter"));
  assert.equal(appContent.includes("HashRouter"), false);
  assert.ok(appContent.includes("Suspense"));
  assert.ok(appContent.includes('import ErrorBoundary from "./components/ErrorBoundary";'));
  assert.ok(appContent.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appContent.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appContent.includes("element={<ErrorBoundary><"));

  const errorBoundaryContent = await readFile(path.join(projectDir, "src", "components", "ErrorBoundary.tsx"), "utf8");
  assert.ok(errorBoundaryContent.includes("class ErrorBoundary extends Component"));
  assert.ok(errorBoundaryContent.includes("static getDerivedStateFromError"));
  assert.ok(errorBoundaryContent.includes("handleRetry"));
  assert.ok(errorBoundaryContent.includes("Try again"));

  const screenSkeletonContent = await readFile(path.join(projectDir, "src", "components", "ScreenSkeleton.tsx"), "utf8");
  assert.ok(screenSkeletonContent.includes("function ScreenSkeleton"));
  assert.ok(screenSkeletonContent.includes("LinearProgress"));
  assert.ok(screenSkeletonContent.includes("Skeleton"));

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(generatedScreenContent.includes('import MappedInput from "@acme/ui";'));
  assert.ok(generatedScreenContent.includes("<MappedInput"));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as { skippedHidden?: number; truncatedScreens?: unknown[] };
  assert.equal(typeof metrics.skippedHidden, "number");
  assert.equal(Array.isArray(metrics.truncatedScreens), true);
});

test("generateArtifacts caps representative screen test targets and keeps test output deterministic", async () => {
  const createTargetRichIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "target-rich-screen",
        name: "Target Rich Screen",
        layoutMode: "VERTICAL" as const,
        gap: 8,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        children: [
          ...Array.from({ length: 9 }, (_, index) => ({
            id: `target-rich-text-${index + 1}`,
            name: `Headline ${index + 1}`,
            nodeType: "TEXT" as const,
            type: "text" as const,
            text: `Headline ${String(index + 1).padStart(2, "0")}`
          })),
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `target-rich-button-${index + 1}`,
            name: `Action ${index + 1}`,
            nodeType: "FRAME" as const,
            type: "button" as const,
            width: 220,
            height: 48,
            fillColor: "#d4001a",
            children: [
              {
                id: `target-rich-button-${index + 1}-label`,
                name: "Label",
                nodeType: "TEXT" as const,
                type: "text" as const,
                text: `Action ${index + 1}`,
                fillColor: "#ffffff"
              }
            ]
          })),
          ...Array.from({ length: 7 }, (_, index) =>
            createSemanticInputNode({
              id: `target-rich-input-${index + 1}`,
              name: `Input Field ${index + 1}`,
              label: `Input ${index + 1}`
            })
          ),
          ...Array.from({ length: 7 }, (_, index) => ({
            id: `target-rich-select-${index + 1}`,
            name: `Select Field ${index + 1}`,
            nodeType: "FRAME" as const,
            type: "select" as const,
            layoutMode: "VERTICAL" as const,
            gap: 4,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            width: 320,
            height: 72,
            children: [
              {
                id: `target-rich-select-${index + 1}-label`,
                name: "Label",
                nodeType: "TEXT" as const,
                type: "text" as const,
                text: `Select ${index + 1}`
              }
            ]
          }))
        ]
      }
    ];
    return ir;
  };

  const firstRunDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-screen-tests-caps-a-"));
  const secondRunDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-screen-tests-caps-b-"));
  const firstResult = await generateArtifacts({
    projectDir: firstRunDir,
    ir: createTargetRichIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const secondResult = await generateArtifacts({
    projectDir: secondRunDir,
    ir: createTargetRichIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const firstTestPath = firstResult.generatedPaths.find(
    (entry) => entry.startsWith("src/screens/__tests__/") && entry.endsWith(".test.tsx")
  );
  const secondTestPath = secondResult.generatedPaths.find(
    (entry) => entry.startsWith("src/screens/__tests__/") && entry.endsWith(".test.tsx")
  );
  assert.ok(firstTestPath, "Expected test file path for first run.");
  assert.ok(secondTestPath, "Expected test file path for second run.");

  const firstContent = await readFile(path.join(firstRunDir, firstTestPath ?? ""), "utf8");
  const secondContent = await readFile(path.join(secondRunDir, secondTestPath ?? ""), "utf8");
  assert.equal(firstContent, secondContent);
  assert.ok(firstContent.includes('import { render, screen } from "@testing-library/react";'));
  assert.ok(firstContent.includes('import userEvent from "@testing-library/user-event";'));
  assert.ok(firstContent.includes('import { axe } from "jest-axe";'));
  assert.ok(firstContent.includes("<ThemeProvider theme={appTheme} defaultMode=\"system\" noSsr>"));
  assert.ok(firstContent.includes("<MemoryRouter>"));
  assert.ok(firstContent.includes('it("renders without crashing"'));
  assert.ok(firstContent.includes('it("renders representative text content"'));
  assert.ok(firstContent.includes('it("keeps representative controls interactive"'));
  assert.ok(firstContent.includes('it("has no detectable accessibility violations"'));
  assert.ok(firstContent.includes("const normalizeTextForAssertion = (value: string): string => {"));
  assert.ok(firstContent.includes("const expectTextToBePresent = ({ container, expectedText }"));
  assert.ok(firstContent.includes('const axeConfig = {'));
  assert.ok(firstContent.includes('"heading-order": { enabled: false }'));
  assert.ok(firstContent.includes('"landmark-banner-is-top-level": { enabled: false }'));
  assert.ok(firstContent.includes("expectTextToBePresent({ container, expectedText });"));
  assert.ok(firstContent.includes("const results = await axe(container, axeConfig);"));
  assert.ok(firstContent.includes("expect(results).toHaveNoViolations();"));

  const expectedTexts = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedTexts"
  });
  const expectedButtonLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedButtonLabels"
  });
  const expectedInputLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedTextInputLabels"
  });
  const expectedSelectLabels = readGeneratedStringArrayLiteral({
    source: firstContent,
    variableName: "expectedSelectLabels"
  });

  assert.deepEqual(expectedTexts, [
    "Headline 01",
    "Headline 02",
    "Headline 03",
    "Headline 04",
    "Headline 05",
    "Headline 06",
    "Headline 07",
    "Headline 08"
  ]);
  assert.deepEqual(expectedButtonLabels, ["Action 1", "Action 2", "Action 3", "Action 4", "Action 5", "Action 6"]);
  assert.deepEqual(expectedInputLabels, [
    "Input Field 1",
    "Input Field 2",
    "Input Field 3",
    "Input Field 4",
    "Input Field 5",
    "Input Field 6"
  ]);
  assert.deepEqual(expectedSelectLabels, ["Select 1", "Select 2", "Select 3", "Select 4", "Select 5", "Select 6"]);
});

test("generateArtifacts extracts repeated screen-local card patterns into reusable component files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-extract-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "offers-screen",
      name: "Offers",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "offer-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "offer-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "offer-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "offer-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "offer-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "offer-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    imageAssetMap: {
      "offer-image-a": "/images/offer-a.png",
      "offer-image-b": "/images/offer-b.png",
      "offer-image-c": "/images/offer-c.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/OffersPattern1.tsx"), true);
  assert.equal(result.generatedPaths.includes("src/context/OffersPatternContext.tsx"), true);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Offers")), "utf8");
  assert.ok(screenContent.includes('import { OffersPattern1 } from "../components/OffersPattern1";'));
  assert.ok(screenContent.includes('import { OffersPatternContextProvider, type OffersPatternContextState } from "../context/OffersPatternContext";'));
  assert.ok(screenContent.includes("const patternContextInitialState: OffersPatternContextState = {"));
  assert.ok(screenContent.includes("<OffersPatternContextProvider initialState={patternContextInitialState}>"));
  assert.equal(countOccurrences(screenContent, "<OffersPattern1"), 3);
  assert.equal(screenContent.includes("<Card"), false);
  assert.ok(screenContent.includes('instanceId={"offer-card-a"}'));
  assert.ok(screenContent.includes('"Starter Paket"'));
  assert.equal(screenContent.includes('offerTitleText={"Starter Paket"}'), false);
  assert.equal(screenContent.includes('offerImageSrc={"/images/offer-a.png"}'), false);

  const componentContent = await readFile(path.join(projectDir, "src", "components", "OffersPattern1.tsx"), "utf8");
  assert.ok(componentContent.includes("interface OffersPattern1Props"));
  assert.ok(componentContent.includes("instanceId: string;"));
  assert.ok(componentContent.includes("sx?: SxProps<Theme>;"));
  assert.ok(componentContent.includes('import { styled, type SxProps, type Theme } from "@mui/material/styles";'));
  assert.ok(componentContent.includes('import { useOffersPatternContext } from "../context/OffersPatternContext";'));
  assert.ok(componentContent.includes("const patternContext = useOffersPatternContext();"));
  assert.equal(componentContent.includes("offerTitleText: string;"), false);
  assert.equal(componentContent.includes("offerImageSrc: string;"), false);
  assert.ok(componentContent.includes("const OffersPattern1Root = styled(Card)(({ theme }) => theme.unstable_sx({"));
  assert.ok(componentContent.includes("theme.unstable_sx({"));
  assert.match(componentContent, /<OffersPattern1Root\b[^>]*\bsx=\{sx\}[^>]*>/);
  assert.equal(componentContent.includes("sx={[{"), false);
  assert.equal(componentContent.includes("/images/offer-a.png"), false);
  assert.ok(componentContent.includes("return (\n    <>"));
  assertValidTsx({
    content: componentContent,
    filePath: path.join(projectDir, "src", "components", "OffersPattern1.tsx")
  });

  const patternContextContent = await readFile(path.join(projectDir, "src", "context", "OffersPatternContext.tsx"), "utf8");
  assert.ok(patternContextContent.includes("export interface OffersPattern1State"));
  assert.ok(patternContextContent.includes("offerTitleText: string;"));
  assert.ok(patternContextContent.includes("offerImageSrc: string;"));
  assert.ok(patternContextContent.includes("export function OffersPatternContextProvider"));
});

test("generateArtifacts keeps pattern and form provider wrapping order stable when both are present", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-provider-order-"));
  const ir = createMixedFallbackStageIr();

  await generateArtifacts({
    projectDir,
    ir,
    imageAssetMap: mixedFallbackStageImageAssetMap,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Mixed Fallback Stage")), "utf8");
  const patternProviderMatch = screenContent.match(
    /import \{ ([A-Za-z0-9_]+PatternContextProvider), type [^}]+ \} from "\.\.\/context\/[^"]+";/
  );
  const formProviderMatch = screenContent.match(
    /import \{ ([A-Za-z0-9_]+FormContextProvider), [^}]+ \} from "\.\.\/context\/[^"]+";/
  );
  const screenContentComponentMatch = screenContent.match(/function ([A-Za-z0-9_]+ScreenContent)\(\)/);
  assert.ok(patternProviderMatch?.[1], "Expected pattern context provider import.");
  assert.ok(formProviderMatch?.[1], "Expected form context provider import.");
  assert.ok(screenContentComponentMatch?.[1], "Expected screen content function.");

  const patternProvider = patternProviderMatch?.[1] ?? "";
  const formProvider = formProviderMatch?.[1] ?? "";
  const screenContentComponent = screenContentComponentMatch?.[1] ?? "";
  const patternStart = screenContent.indexOf(`<${patternProvider} initialState={patternContextInitialState}>`);
  const formStart = screenContent.indexOf(`<${formProvider}>`);
  const contentStart = screenContent.indexOf(`<${screenContentComponent} />`);
  const formEnd = screenContent.indexOf(`</${formProvider}>`);
  const patternEnd = screenContent.indexOf(`</${patternProvider}>`);

  assert.ok(patternStart >= 0, "Expected pattern context wrapper.");
  assert.ok(formStart >= 0, "Expected form context wrapper.");
  assert.ok(contentStart >= 0, "Expected screen content wrapper.");
  assert.ok(formEnd >= 0, "Expected closing form context wrapper.");
  assert.ok(patternEnd >= 0, "Expected closing pattern context wrapper.");
  assert.ok(patternStart < formStart);
  assert.ok(formStart < contentStart);
  assert.ok(contentStart < formEnd);
  assert.ok(formEnd < patternEnd);
  assert.ok(screenContent.includes("import { Link as RouterLink } from \"react-router-dom\";"));
  assert.ok(screenContent.includes('import SearchIcon from "@mui/icons-material/Search";'));
});

test("generateArtifacts keeps mixed fallback files byte-stable across repeated generation runs", async () => {
  const firstProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-byte-stable-first-"));
  const secondProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-fallback-byte-stable-second-"));
  const ir = createMixedFallbackStageIr();

  const generateAndCollect = async (projectDir: string) => {
    await generateArtifacts({
      projectDir,
      ir,
      imageAssetMap: mixedFallbackStageImageAssetMap,
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      }
    });
    const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Mixed Fallback Stage")), "utf8");
    const componentImportMatches = Array.from(screenContent.matchAll(/from "\.\.\/components\/([^"]+)";/g));
    const contextImportMatches = Array.from(screenContent.matchAll(/from "\.\.\/context\/([^"]+)";/g));

    const componentContents = (
      await Promise.all(
        componentImportMatches.map(async (match) => {
          const moduleName = match[1] ?? "";
          const content = await readFile(path.join(projectDir, "src", "components", `${moduleName}.tsx`), "utf8");
          return {
            moduleName,
            content
          };
        })
      )
    ).sort((left, right) => left.moduleName.localeCompare(right.moduleName));

    const contextContents = (
      await Promise.all(
        contextImportMatches.map(async (match) => {
          const moduleName = match[1] ?? "";
          const content = await readFile(path.join(projectDir, "src", "context", `${moduleName}.tsx`), "utf8");
          return {
            moduleName,
            content
          };
        })
      )
    ).sort((left, right) => left.moduleName.localeCompare(right.moduleName));

    return {
      screenContent,
      componentContents,
      contextContents
    };
  };

  const first = await generateAndCollect(firstProjectDir);
  const second = await generateAndCollect(secondProjectDir);
  assert.equal(first.screenContent, second.screenContent);
  assert.deepEqual(first.componentContents, second.componentContents);
  assert.deepEqual(first.contextContents, second.contextContents);
});

test("generateArtifactsStreaming emits theme content first and keeps output byte-equivalent to the batch wrapper", async () => {
  const streamingProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-streaming-theme-"));
  const batchProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-batch-theme-"));
  const ir = createIr();
  const generator = generateArtifactsStreaming({
    projectDir: streamingProjectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const eventTypes: string[] = [];
  let themeEvent:
    | {
        type: "theme";
        files: Array<{ path: string; content: string }>;
      }
    | undefined;
  let iterResult = await generator.next();
  while (!iterResult.done) {
    eventTypes.push(iterResult.value.type);
    if (iterResult.value.type === "theme") {
      themeEvent = iterResult.value;
    }
    iterResult = await generator.next();
  }
  const streamingResult = iterResult.value;

  assert.equal(eventTypes[0], "theme");
  assert.ok(themeEvent, "streaming generation must emit a theme event");
  assert.deepEqual(
    themeEvent.files.map((file) => file.path).sort((left, right) => left.localeCompare(right)),
    [
      "src/components/ErrorBoundary.tsx",
      "src/components/ScreenSkeleton.tsx",
      "src/theme/theme.ts",
      "src/theme/tokens.json"
    ]
  );

  for (const file of themeEvent.files) {
    assert.ok(file.content.length > 0, `theme file '${file.path}' must have non-empty content`);
    const diskContent = await readFile(path.join(streamingProjectDir, file.path), "utf8");
    assert.equal(file.content, diskContent, `theme file '${file.path}' must match disk content`);
    if (file.path.endsWith(".json")) {
      assert.doesNotThrow(() => JSON.parse(file.content), `theme file '${file.path}' must contain valid JSON`);
    }
  }

  const batchResult = await generateArtifacts({
    projectDir: batchProjectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.deepEqual(
    [...streamingResult.generatedPaths].sort((left, right) => left.localeCompare(right)),
    [...batchResult.generatedPaths].sort((left, right) => left.localeCompare(right))
  );
  assert.deepEqual(
    await collectDeterministicSnapshot({
      projectDir: streamingProjectDir,
      screenName: "Übersicht"
    }),
    await collectDeterministicSnapshot({
      projectDir: batchProjectDir,
      screenName: "Übersicht"
    })
  );
});

test("generateArtifactsStreaming keeps content-bearing event payloads non-empty while progress stays metadata-only", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-streaming-payloads-"));
  const generator = generateArtifactsStreaming({
    projectDir,
    ir: createIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const seenEventTypes = new Set<string>();
  let iterResult = await generator.next();
  while (!iterResult.done) {
    const event = iterResult.value;
    seenEventTypes.add(event.type);

    if (event.type === "theme" || event.type === "screen") {
      assert.ok(event.files.length > 0, `${event.type} events must include at least one file`);
      for (const file of event.files) {
        assert.ok(file.content.length > 0, `${event.type} file '${file.path}' must have non-empty content`);
      }
    } else if (event.type === "app" || event.type === "metrics") {
      assert.ok(event.file.content.length > 0, `${event.type} file '${event.file.path}' must have non-empty content`);
    } else {
      assert.equal(event.type, "progress");
      assert.equal("file" in event, false);
      assert.equal("files" in event, false);
      assert.ok(event.screenIndex > 0);
      assert.ok(event.screenCount > 0);
    }

    iterResult = await generator.next();
  }

  assert.deepEqual([...seenEventTypes].sort(), ["app", "metrics", "progress", "screen", "theme"]);
});

test("generateArtifacts uses injected runtime adapters for filesystem, design-system and icon seams", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-runtime-adapters-seams-"));
  const designSystemFilePath = path.join(projectDir, "runtime-design-system.json");
  const iconMapFilePath = path.join(projectDir, "runtime-icon-map.json");
  const writtenTextPaths: string[] = [];
  const writtenGeneratedPaths: string[] = [];
  let observedDesignSystemFilePath = "";
  let observedIconMapFilePath = "";
  const runtimeCallCounts = {
    mkdirRecursive: 0,
    writeTextFile: 0,
    writeGeneratedFile: 0,
    loadDesignSystemConfig: 0,
    applyDesignSystemMappings: 0,
    loadIconResolver: 0
  };
  const injectedRuntimeAdapters = {
    mkdirRecursive: async (directory: string): Promise<void> => {
      runtimeCallCounts.mkdirRecursive += 1;
      await mkdir(directory, { recursive: true });
    },
    writeTextFile: async ({ filePath, content }: { filePath: string; content: string }): Promise<void> => {
      runtimeCallCounts.writeTextFile += 1;
      writtenTextPaths.push(path.relative(projectDir, filePath));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    },
    writeGeneratedFile: async (rootDir: string, file: { path: string; content: string }): Promise<void> => {
      runtimeCallCounts.writeGeneratedFile += 1;
      writtenGeneratedPaths.push(file.path);
      await writeGeneratedFileFromRuntimeAdapter({
        rootDir,
        relativePath: file.path,
        content: file.content
      });
    },
    loadDesignSystemConfig: async ({
      designSystemFilePath: runtimeDesignSystemFilePath,
      onLog
    }: {
      designSystemFilePath: string;
      onLog: (message: string) => void;
    }): Promise<unknown> => {
      runtimeCallCounts.loadDesignSystemConfig += 1;
      observedDesignSystemFilePath = runtimeDesignSystemFilePath;
      void onLog;
      return {
        library: "@runtime/ui",
        mappings: {}
      };
    },
    applyDesignSystemMappings: ({
      content
    }: {
      filePath: string;
      content: string;
      config: unknown;
    }): string => {
      runtimeCallCounts.applyDesignSystemMappings += 1;
      return content;
    },
    loadIconResolver: async ({
      iconMapFilePath: runtimeIconMapFilePath,
      onLog
    }: {
      iconMapFilePath: string;
      onLog: (message: string) => void;
    }): Promise<unknown> => {
      runtimeCallCounts.loadIconResolver += 1;
      observedIconMapFilePath = runtimeIconMapFilePath;
      void onLog;
      return {
        entries: [],
        byIconName: new Map(),
        exactAliasMap: new Map(),
        tokenIndex: new Map(),
        synonymMap: new Map()
      };
    }
  };
  const ir = createIr();
  ir.screens = [
    {
      id: "runtime-adapter-screen",
      name: "Runtime Adapter Screen",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "runtime-adapter-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        },
        {
          id: "runtime-adapter-icon",
          name: "icon/unknown",
          nodeType: "INSTANCE",
          type: "container" as const,
          width: 24,
          height: 24,
          children: []
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    },
    [GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL]: injectedRuntimeAdapters
  } as Parameters<typeof generateArtifacts>[0]);

  assert.equal(runtimeCallCounts.loadDesignSystemConfig, 1);
  assert.equal(runtimeCallCounts.loadIconResolver, 1);
  assert.ok(runtimeCallCounts.applyDesignSystemMappings > 0);
  assert.ok(runtimeCallCounts.mkdirRecursive >= 3);
  assert.ok(runtimeCallCounts.writeTextFile >= 3);
  assert.ok(runtimeCallCounts.writeGeneratedFile >= 4);
  assert.equal(observedDesignSystemFilePath, designSystemFilePath);
  assert.equal(observedIconMapFilePath, iconMapFilePath);
  assert.ok(writtenTextPaths.includes("src/App.tsx"));
  assert.ok(writtenTextPaths.includes(path.join("src", "theme", "tokens.json")));
  assert.ok(writtenTextPaths.includes("generation-metrics.json"));
  assert.ok(writtenGeneratedPaths.includes(toDeterministicScreenPath("Runtime Adapter Screen")));
  assert.ok(result.generatedPaths.includes(toDeterministicScreenPath("Runtime Adapter Screen")));
});

test("generateArtifacts keeps deterministic output stable with injected runtime adapters", async () => {
  const screenName = "Übersicht";
  const runDefault = async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-runtime-adapters-default-"));
    const result = await generateArtifacts({
      projectDir,
      ir: createIr(),
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      }
    });
    return {
      generatedPaths: [...result.generatedPaths].sort((left, right) => left.localeCompare(right)),
      snapshot: await collectDeterministicSnapshot({
        projectDir,
        screenName
      })
    };
  };
  const createInjectedRuntimeAdapters = () => {
    const runtimeCallCounts = {
      mkdirRecursive: 0,
      writeTextFile: 0,
      writeGeneratedFile: 0,
      loadDesignSystemConfig: 0,
      loadIconResolver: 0
    };
    const runtimeAdapters = {
      mkdirRecursive: async (directory: string): Promise<void> => {
        runtimeCallCounts.mkdirRecursive += 1;
        await mkdir(directory, { recursive: true });
      },
      writeTextFile: async ({ filePath, content }: { filePath: string; content: string }): Promise<void> => {
        runtimeCallCounts.writeTextFile += 1;
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf8");
      },
      writeGeneratedFile: async (rootDir: string, file: { path: string; content: string }): Promise<void> => {
        runtimeCallCounts.writeGeneratedFile += 1;
        await writeGeneratedFileFromRuntimeAdapter({
          rootDir,
          relativePath: file.path,
          content: file.content
        });
      },
      loadDesignSystemConfig: async ({
        onLog
      }: {
        designSystemFilePath: string;
        onLog: (message: string) => void;
      }): Promise<undefined> => {
        runtimeCallCounts.loadDesignSystemConfig += 1;
        void onLog;
        return undefined;
      },
      applyDesignSystemMappings: ({
        content
      }: {
        filePath: string;
        content: string;
        config: unknown;
      }): string => content,
      loadIconResolver: async ({
        onLog
      }: {
        iconMapFilePath: string;
        onLog: (message: string) => void;
      }): Promise<unknown> => {
        runtimeCallCounts.loadIconResolver += 1;
        void onLog;
        return {
          entries: [],
          byIconName: new Map(),
          exactAliasMap: new Map(),
          tokenIndex: new Map(),
          synonymMap: new Map()
        };
      }
    };
    return {
      runtimeAdapters,
      runtimeCallCounts
    };
  };
  const runInjected = async (suffix: string) => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-generator-runtime-adapters-injected-${suffix}-`));
    const { runtimeAdapters, runtimeCallCounts } = createInjectedRuntimeAdapters();
    const result = await generateArtifacts({
      projectDir,
      ir: createIr(),
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      },
      [GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL]: runtimeAdapters
    } as Parameters<typeof generateArtifacts>[0]);
    return {
      generatedPaths: [...result.generatedPaths].sort((left, right) => left.localeCompare(right)),
      snapshot: await collectDeterministicSnapshot({
        projectDir,
        screenName
      }),
      runtimeCallCounts
    };
  };

  const defaultRun = await runDefault();
  const injectedFirstRun = await runInjected("first");
  const injectedSecondRun = await runInjected("second");

  assert.deepEqual(injectedFirstRun.snapshot, defaultRun.snapshot);
  assert.deepEqual(injectedSecondRun.snapshot, defaultRun.snapshot);
  assert.deepEqual(injectedFirstRun.snapshot, injectedSecondRun.snapshot);
  assert.deepEqual(injectedFirstRun.generatedPaths, defaultRun.generatedPaths);
  assert.deepEqual(injectedSecondRun.generatedPaths, defaultRun.generatedPaths);
  assert.deepEqual(injectedFirstRun.generatedPaths, injectedSecondRun.generatedPaths);
  assert.equal(injectedFirstRun.runtimeCallCounts.loadDesignSystemConfig, 1);
  assert.equal(injectedFirstRun.runtimeCallCounts.loadIconResolver, 1);
  assert.ok(injectedFirstRun.runtimeCallCounts.writeTextFile >= 3);
  assert.ok(injectedFirstRun.runtimeCallCounts.writeGeneratedFile >= 4);
  assert.equal(injectedSecondRun.runtimeCallCounts.loadDesignSystemConfig, 1);
  assert.equal(injectedSecondRun.runtimeCallCounts.loadIconResolver, 1);
  assert.ok(injectedSecondRun.runtimeCallCounts.writeTextFile >= 3);
  assert.ok(injectedSecondRun.runtimeCallCounts.writeGeneratedFile >= 4);
});

test("generateArtifacts applies design-system mappings to screen and extracted pattern component files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-"));
  const designSystemFilePath = path.join(projectDir, "design-system.json");
  await writeFile(
    designSystemFilePath,
    `${JSON.stringify(
      {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "PrimaryButton",
            propMappings: {
              variant: "appearance"
            }
          },
          Card: {
            component: "ContentCard"
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const ir = createIr();
  ir.screens = [
    {
      id: "design-system-screen",
      name: "Design System",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "design-system-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Jetzt starten"
        },
        {
          id: "design-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            },
            {
              id: "design-price-a",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "9,99 €"
            }
          ]
        },
        {
          id: "design-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            },
            {
              id: "design-price-b",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "19,99 €"
            }
          ]
        },
        {
          id: "design-card-c",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "design-image-c",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "design-title-c",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Premium Paket"
            },
            {
              id: "design-price-c",
              name: "Offer Price",
              nodeType: "TEXT",
              type: "text" as const,
              text: "29,99 €"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    imageAssetMap: {
      "design-image-a": "/images/design-a.png",
      "design-image-b": "/images/design-b.png",
      "design-image-c": "/images/design-c.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/DesignSystemPattern1.tsx"), true);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Design System")), "utf8");
  assert.ok(screenContent.includes('import { PrimaryButton } from "@acme/ui";'));
  assert.ok(screenContent.includes("<PrimaryButton"));
  assert.ok(screenContent.includes("appearance="));
  assert.equal(screenContent.includes('import { Button } from "@mui/material";'), false);
  validateGeneratedSourceFile({
    filePath: path.join(projectDir, toDeterministicScreenPath("Design System")),
    content: screenContent
  });

  const patternContent = await readFile(path.join(projectDir, "src", "components", "DesignSystemPattern1.tsx"), "utf8");
  assert.ok(patternContent.includes('import { ContentCard } from "@acme/ui";'));
  assert.ok(patternContent.includes("<ContentCard"));
  assert.equal(/<Card(?=[\s>])/.test(patternContent), false);
  assert.equal(patternContent.includes("theme.unstable_sx("), false);
  assert.ok(patternContent.includes("sx={[{"));
  validateGeneratedSourceFile({
    filePath: path.join(projectDir, "src", "components", "DesignSystemPattern1.tsx"),
    content: patternContent
  });
});

test("generateArtifacts keeps MUI fallback when design-system config file is missing", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-missing-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "missing-design-system-screen",
      name: "Missing Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "missing-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Missing Design System")), "utf8");
  assert.ok(screenContent.includes("<Button"));
  assert.ok(screenContent.includes('import { Button, Container } from "@mui/material";'));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts logs warning and keeps MUI fallback when design-system config is invalid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-invalid-"));
  const designSystemFilePath = path.join(projectDir, "design-system.invalid.json");
  const logs: string[] = [];
  await writeFile(designSystemFilePath, `${JSON.stringify({ library: "", mappings: [] }, null, 2)}\n`, "utf8");

  const ir = createIr();
  ir.screens = [
    {
      id: "invalid-design-system-screen",
      name: "Invalid Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "invalid-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.ok(logs.some((entry) => entry.includes("Design system config") && entry.includes("invalid")));
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Invalid Design System")), "utf8");
  assert.ok(screenContent.includes("<Button"));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts keeps node-level componentMappings precedence over design-system mapping", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-design-system-priority-"));
  const designSystemFilePath = path.join(projectDir, "design-system.json");
  await writeFile(
    designSystemFilePath,
    `${JSON.stringify(
      {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "PrimaryButton",
            propMappings: {
              variant: "appearance"
            }
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const ir = createIr();
  ir.screens = [
    {
      id: "priority-design-system-screen",
      name: "Priority Design System",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "priority-design-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "priority-design-button",
        componentName: "CustomActionButton",
        importPath: "@custom/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ],
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Priority Design System")), "utf8");
  assert.ok(screenContent.includes('from "@custom/ui";'));
  assert.ok(screenContent.includes("CustomActionButton"));
  assert.ok(screenContent.includes("<CustomActionButton"));
  assert.equal(screenContent.includes("PrimaryButton"), false);
});

test("generateArtifacts applies customer profile imports before design-system mappings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-customer-profile-"));
  const designSystemFilePath = path.join(projectDir, "design-system.json");
  await writeFile(
    designSystemFilePath,
    `${JSON.stringify(
      {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "FallbackButton"
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const ir = createIr();
  ir.screens = [
    {
      id: "customer-profile-screen",
      name: "Customer Profile",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "customer-profile-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    designSystemFilePath,
    customerProfile: createCustomerProfileForGeneratorTests(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Customer Profile")), "utf8");
  assert.ok(screenContent.includes('import { PrimaryButton as CustomerButton } from "@customer/components";'));
  assert.ok(screenContent.includes("<CustomerButton"));
  assert.ok(screenContent.includes("appearance="));
  assert.equal(screenContent.includes("FallbackButton"), false);
});

test("generateArtifacts prefers an explicit customerProfileDesignSystemConfig over the full customer profile mapping", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-match-report-design-system-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "match-report-screen",
      name: "Match Report Mapping",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "match-report-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    customerProfile: createCustomerProfileForGeneratorTests(),
    customerProfileDesignSystemConfig: {
      library: "__customer_profile__",
      mappings: {}
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Match Report Mapping")), "utf8");
  assert.equal(screenContent.includes('from "@customer/components";'), false);
  assert.equal(screenContent.includes("CustomerButton"), false);
  assert.ok(screenContent.includes('from "@mui/material";'));
  assert.ok(screenContent.includes("<Button"));
});

test("generateArtifacts keeps node-level componentMappings precedence over customer profile imports", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-customer-profile-priority-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "customer-priority-screen",
      name: "Customer Priority",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "customer-priority-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    customerProfile: createCustomerProfileForGeneratorTests(),
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "customer-priority-button",
        componentName: "ManualActionButton",
        importPath: "@manual/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ],
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Customer Priority")), "utf8");
  assert.ok(screenContent.includes('from "@manual/ui";'));
  assert.ok(screenContent.includes("ManualActionButton"));
  assert.equal(screenContent.includes("CustomerButton"), false);
});

test("generateArtifacts logs customer profile diagnostics when denied MUI fallbacks remain", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-customer-profile-diagnostics-"));
  const logs: string[] = [];
  const ir = createIr();
  ir.screens = [
    {
      id: "customer-diagnostics-screen",
      name: "Customer Diagnostics",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "customer-diagnostics-button",
          name: "Primary CTA",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter"
        }
      ]
    }
  ];

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
        components: {}
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny"
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
  if (!customerProfile) {
    assert.fail("Expected diagnostics customer profile fixture to parse.");
  }

  await generateArtifacts({
    projectDir,
    ir,
    customerProfile,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.equal(
    logs.some((entry) => entry.includes("Customer profile import policy warning") && entry.includes("MUI fallback import 'Button'")),
    true
  );
});

test("generateArtifacts keeps componentMappings precedence over pattern dispatch and remains byte-stable", async () => {
  const createDispatchPrecedenceIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "dispatch-precedence-screen",
        name: "Dispatch Precedence",
        layoutMode: "NONE" as const,
        gap: 0,
        width: 360,
        height: 640,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "mapped-header-container",
            name: "Primary Header",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            primaryAxisAlignItems: "SPACE_BETWEEN" as const,
            counterAxisAlignItems: "CENTER" as const,
            x: 0,
            y: 0,
            width: 360,
            height: 72,
            fillColor: "#ee0000",
            children: [
              {
                id: "mapped-header-title",
                name: "Header Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Dashboard",
                x: 16,
                y: 24,
                fillColor: "#ffffff"
              },
              {
                id: "mapped-header-action",
                name: "Open Menu",
                nodeType: "FRAME",
                type: "button" as const,
                x: 312,
                y: 20,
                width: 32,
                height: 32,
                children: []
              }
            ]
          }
        ]
      }
    ];
    return ir;
  };

  const componentMappings = [
    {
      boardKey: "board-1",
      nodeId: "mapped-header-container",
      componentName: "MappedHeader",
      importPath: "@custom/ui",
      priority: 0,
      source: "local_override" as const,
      enabled: true
    }
  ];

  const generateScreenContent = async (suffix: string): Promise<string> => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-generator-dispatch-precedence-${suffix}-`));
    await generateArtifacts({
      projectDir,
      ir: createDispatchPrecedenceIr(),
      componentMappings,
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      }
    });
    return await readFile(path.join(projectDir, toDeterministicScreenPath("Dispatch Precedence")), "utf8");
  };

  const first = await generateScreenContent("a");
  const second = await generateScreenContent("b");

  assert.equal(first, second);
  assert.ok(first.includes('from "@custom/ui";'));
  assert.ok(first.includes("<MappedHeader"));
  assert.equal(first.includes("<AppBar "), false);
  assert.equal(first.includes("<Toolbar>"), false);
});

test("generateArtifacts renders mapped VECTOR nodes and keeps unmapped VECTOR fallback behavior", async () => {
  const createVectorIr = () => {
    const ir = createIr();
    ir.screens = [
      {
        id: "mapped-vector-screen",
        name: "Mapped Vector Screen",
        layoutMode: "NONE" as const,
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "mapped-vector-node",
            name: "Mapped Vector",
            nodeType: "VECTOR",
            type: "container" as const,
            x: 0,
            y: 0,
            width: 24,
            height: 24,
            vectorPaths: ["M2 2 L22 22"]
          },
          {
            id: "unmapped-vector-node",
            name: "Unmapped Vector",
            nodeType: "VECTOR",
            type: "container" as const,
            x: 40,
            y: 0,
            width: 24,
            height: 24,
            vectorPaths: ["M22 2 L2 22"]
          },
          {
            id: "mapped-vector-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Vector diagnostics"
          }
        ]
      }
    ];
    return ir;
  };

  const mappedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-vector-mapped-"));
  await generateArtifacts({
    projectDir: mappedProjectDir,
    ir: createVectorIr(),
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "mapped-vector-node",
        componentName: "CustomVectorIcon",
        importPath: "@custom/icons",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ],
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const mappedContent = await readFile(path.join(mappedProjectDir, toDeterministicScreenPath("Mapped Vector Screen")), "utf8");
  assert.ok(mappedContent.includes('from "@custom/icons";'));
  assert.ok(mappedContent.includes("<CustomVectorIcon"));
  assert.ok(mappedContent.includes('data-figma-node-id={"mapped-vector-node"}'));
  assert.ok(mappedContent.includes("<SvgIcon"));
  assert.ok(mappedContent.includes('data-ir-id="unmapped-vector-node"'));

  const fallbackProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-vector-fallback-"));
  await generateArtifacts({
    projectDir: fallbackProjectDir,
    ir: createVectorIr(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const fallbackContent = await readFile(path.join(fallbackProjectDir, toDeterministicScreenPath("Mapped Vector Screen")), "utf8");
  assert.equal(fallbackContent.includes("CustomVectorIcon"), false);
  assert.ok(fallbackContent.includes("<SvgIcon"));
  assert.ok(fallbackContent.includes('data-ir-id="mapped-vector-node"'));
  assert.ok(fallbackContent.includes('data-ir-id="unmapped-vector-node"'));
});

test("generateArtifacts keeps inline rendering when repeated pattern count is below extraction threshold", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-threshold-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "offer-pair-screen",
      name: "Offer Pair",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "offer-pair-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-pair-image-a",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-pair-title-a",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Starter Paket"
            }
          ]
        },
        {
          id: "offer-pair-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          fillColor: "#ffffff",
          children: [
            {
              id: "offer-pair-image-b",
              name: "Offer Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 320,
              height: 96
            },
            {
              id: "offer-pair-title-b",
              name: "Offer Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Family Paket"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.some((entry) => /src\/components\/.*Pattern\d+\.tsx/.test(entry)), false);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Offer Pair")), "utf8");
  assert.equal(screenContent.includes("Pattern"), false);
  assert.ok(screenContent.includes("<Card"));
});

test("generateArtifacts skips pattern context when extracted clusters have no dynamic bindings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-no-context-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "static-offers-screen",
      name: "Static Offers",
      layoutMode: "VERTICAL" as const,
      gap: 16,
      padding: { top: 12, right: 12, bottom: 12, left: 12 },
      children: [
        {
          id: "static-card-a",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-a-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-a-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        },
        {
          id: "static-card-b",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-b-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-b-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        },
        {
          id: "static-card-c",
          name: "Static Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 280,
          height: 120,
          children: [
            { id: "static-card-c-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "Reusable Card" },
            { id: "static-card-c-price", name: "Price", nodeType: "TEXT", type: "text" as const, text: "9,99 €" }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/components/StaticOffersPattern1.tsx"), true);
  assert.equal(result.generatedPaths.some((entry) => /src\/context\/.*PatternContext\.tsx$/.test(entry)), false);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Static Offers")), "utf8");
  assert.ok(screenContent.includes("<StaticOffersPattern1"));
  assert.equal(screenContent.includes("instanceId={"), false);
  assert.equal(screenContent.includes("PatternContextProvider"), false);

  const componentContent = await readFile(path.join(projectDir, "src", "components", "StaticOffersPattern1.tsx"), "utf8");
  assert.equal(componentContent.includes("instanceId: string;"), false);
  assert.equal(componentContent.includes("PatternContext"), false);
});

test("generateArtifacts keeps merged sx fallback for extracted patterns with fewer than four root sx properties", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-low-root-sx-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "low-root-sx-screen",
      name: "Low Root SX",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "low-root-card-a",
          name: "Compact Card",
          nodeType: "FRAME",
          type: "card" as const,
          children: [
            { id: "low-root-card-a-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "A" },
            { id: "low-root-card-a-subtitle", name: "Subtitle", nodeType: "TEXT", type: "text" as const, text: "Alpha" }
          ]
        },
        {
          id: "low-root-card-b",
          name: "Compact Card",
          nodeType: "FRAME",
          type: "card" as const,
          children: [
            { id: "low-root-card-b-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "B" },
            { id: "low-root-card-b-subtitle", name: "Subtitle", nodeType: "TEXT", type: "text" as const, text: "Bravo" }
          ]
        },
        {
          id: "low-root-card-c",
          name: "Compact Card",
          nodeType: "FRAME",
          type: "card" as const,
          children: [
            { id: "low-root-card-c-title", name: "Title", nodeType: "TEXT", type: "text" as const, text: "C" },
            { id: "low-root-card-c-subtitle", name: "Subtitle", nodeType: "TEXT", type: "text" as const, text: "Charlie" }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const patternComponentPath = result.generatedPaths.find((entry) => /src\/components\/LowRoot.*Pattern1\.tsx$/.test(entry));
  assert.ok(patternComponentPath, "Expected extracted pattern component for low-root-sx scenario.");
  const patternContent = await readFile(path.join(projectDir, patternComponentPath ?? ""), "utf8");
  assert.equal(patternContent.includes("theme.unstable_sx("), false);
  assert.equal(patternContent.includes("Root = styled("), false);
  assert.ok(patternContent.includes("sx={[{"));
  assert.ok(patternContent.includes("return (\n    <>"));
  assertValidTsx({
    content: patternContent,
    filePath: path.join(projectDir, patternComponentPath ?? "")
  });
});

test("generateArtifacts skips extraction when structure similarity threshold is not met", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-pattern-similarity-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "similarity-screen",
      name: "Similarity Screen",
      layoutMode: "VERTICAL" as const,
      gap: 24,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "sim-card-a",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          children: [
            {
              id: "sim-title-a",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "A"
            },
            {
              id: "sim-image-a",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        },
        {
          id: "sim-card-b",
          name: "Offer Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 180,
          children: [
            {
              id: "sim-title-b",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "B"
            },
            {
              id: "sim-image-b",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        },
        {
          id: "sim-card-c",
          name: "Different Card",
          nodeType: "FRAME",
          type: "card" as const,
          width: 320,
          height: 220,
          children: [
            {
              id: "sim-title-c",
              name: "Title",
              nodeType: "TEXT",
              type: "text" as const,
              text: "C"
            },
            {
              id: "sim-subtitle-c",
              name: "Subtitle",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Extra"
            },
            {
              id: "sim-image-c",
              name: "Image",
              nodeType: "RECTANGLE",
              type: "image" as const,
              width: 120,
              height: 80
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.some((entry) => /src\/components\/.*Pattern\d+\.tsx/.test(entry)), false);
  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Similarity Screen")), "utf8");
  assert.equal(screenContent.includes("Pattern"), false);
});

test("generateArtifacts emits per-screen form context and rewires screen form state through hook usage", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-form-context-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "loan-form-screen",
      name: "Loan Form",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        createSemanticInputNode({ id: "loan-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" }),
        {
          id: "loan-submit-button",
          name: "Primary Submit",
          nodeType: "FRAME",
          type: "button" as const,
          width: 220,
          height: 48,
          fillColor: "#d4001a",
          children: [
            {
              id: "loan-submit-button-label",
              name: "Label",
              nodeType: "TEXT",
              type: "text" as const,
              text: "Continue",
              fillColor: "#ffffff"
            }
          ]
        }
      ]
    }
  ];

  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.generatedPaths.includes("src/context/LoanFormFormContext.tsx"), true);

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Loan Form")), "utf8");
  assert.ok(screenContent.includes('import { LoanFormFormContextProvider, useLoanFormFormContext } from "../context/LoanFormFormContext";'));
  assert.ok(screenContent.includes("function LoanFormScreenContent() {"));
  assert.ok(
    screenContent.includes(
      "const { control, handleSubmit, onSubmit, resolveFieldErrorMessage, isSubmitting, isSubmitted } = useLoanFormFormContext();"
    )
  );
  assert.ok(screenContent.includes("<LoanFormFormContextProvider>"));
  assert.ok(screenContent.includes('component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate'));
  assert.ok(screenContent.includes("<Controller"));
  assert.equal(screenContent.includes("const [formValues, setFormValues] = useState<Record<string, string>>("), false);
  assert.equal(screenContent.includes("const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);"), false);
  assert.equal(screenContent.includes("const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});"), false);

  const formContextContent = await readFile(path.join(projectDir, "src", "context", "LoanFormFormContext.tsx"), "utf8");
  assert.ok(formContextContent.includes("createContext"));
  assert.ok(formContextContent.includes('import { useForm, type UseFormReturn } from "react-hook-form";'));
  assert.ok(formContextContent.includes('import { zodResolver } from "@hookform/resolvers/zod";'));
  assert.ok(formContextContent.includes('import { z } from "zod";'));
  assert.ok(formContextContent.includes("export type LoanFormFormInput = z.input<typeof formSchema>;"));
  assert.ok(formContextContent.includes("export type LoanFormFormOutput = z.output<typeof formSchema>;"));
  assert.ok(
    formContextContent.includes(
      "const { control, handleSubmit, formState: { isSubmitting, isSubmitted }, reset, setError } = useForm<LoanFormFormInput>({"
    )
  );
  assert.ok(formContextContent.includes("isSubmitted: boolean;"));
  assert.ok(formContextContent.includes("if (!isTouched && !isSubmitted) {"));
  assert.ok(formContextContent.includes("const onSubmit = async (values: LoanFormFormOutput): Promise<void> => {"));
  assert.equal(formContextContent.includes("as unknown as UseFormReturn"), false);
  assert.ok(formContextContent.includes("export const useLoanFormFormContext = (): LoanFormFormContextValue => {"));
});

test("generateArtifacts keeps legacy form scaffolding when formHandlingMode=legacy_use_state is requested", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-form-legacy-"));
  const ir = createIr();
  ir.screens = [
    {
      id: "legacy-form-screen",
      name: "Legacy Form",
      layoutMode: "VERTICAL" as const,
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [createSemanticInputNode({ id: "legacy-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" })]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    formHandlingMode: "legacy_use_state",
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Legacy Form")), "utf8");
  assert.ok(screenContent.includes("<LegacyFormFormContextProvider>"));
  assert.ok(screenContent.includes("useLegacyFormFormContext"));
  assert.ok(screenContent.includes('component="form" onSubmit={handleSubmit} noValidate'));
  assert.equal(screenContent.includes("<Controller"), false);

  const formContextContent = await readFile(path.join(projectDir, "src", "context", "LegacyFormFormContext.tsx"), "utf8");
  assert.ok(formContextContent.includes("const [formValues, setFormValues] = useState<Record<string, string>>("));
  assert.ok(formContextContent.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"));
  assert.equal(formContextContent.includes("useForm<Record<string, string>>"), false);
});

test("generateArtifacts injects exported image asset paths into image and CardMedia rendering", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-images-"));
  const imageScreen = {
    id: "image-screen",
    name: "Image Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "hero-image",
        name: "Hero Image",
        nodeType: "RECTANGLE",
        type: "image" as const,
        width: 320,
        height: 180
      },
      {
        id: "summary-card",
        name: "Summary Card",
        nodeType: "FRAME",
        type: "card" as const,
        width: 320,
        height: 260,
        fillColor: "#ffffff",
        children: [
          {
            id: "card-media-image",
            name: "Card Media",
            nodeType: "RECTANGLE",
            type: "image" as const,
            width: 320,
            height: 140
          },
          {
            id: "card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Card headline"
          }
        ]
      },
      {
        id: "table-with-image",
        name: "Table With Image",
        nodeType: "FRAME",
        type: "table" as const,
        width: 400,
        height: 180,
        children: [
          {
            id: "table-header-row",
            name: "Header Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              {
                id: "table-header-col-1",
                name: "Product",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Product"
              },
              {
                id: "table-header-col-2",
                name: "Details",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Details"
              }
            ]
          },
          {
            id: "table-body-row",
            name: "Body Row",
            nodeType: "FRAME",
            type: "container" as const,
            layoutMode: "HORIZONTAL" as const,
            children: [
              {
                id: "table-image-cell",
                name: "Table Image",
                nodeType: "RECTANGLE",
                type: "image" as const,
                width: 120,
                height: 80
              },
              {
                id: "table-text-cell",
                name: "Details Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Shown with image"
              }
            ]
          }
        ]
      }
    ]
  };

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [imageScreen]
    },
    imageAssetMap: {
      "hero-image": "/images/hero.png",
      "card-media-image": "/images/card-media.png",
      "table-image-cell": "/images/table-image.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Image Screen")), "utf8");
  assert.ok(
    generatedScreenContent.includes(
      'component="img" src={".\\u002Fimages\\u002Fhero.png"} alt={"Hero Image"} decoding="async" fetchPriority="high" width={320} height={180}'
    )
  );
  assert.ok(
    generatedScreenContent.includes(
      '<CardMedia component="img" image={".\\u002Fimages\\u002Fcard-media.png"} alt={"Card Media"} decoding="async" fetchPriority="high" width={320} height={140}'
    )
  );
  assert.ok(
    generatedScreenContent.includes(
      'component="img" src={".\\u002Fimages\\u002Ftable-image.png"} alt={"Table Image"} decoding="async" fetchPriority="high" width={120} height={80}'
    )
  );
});

test("generateArtifacts applies lazy loading for below-fold images and fetchpriority for hero images", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-lazy-"));
  const lazyScreen = {
    id: "lazy-screen",
    name: "Lazy Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "hero-img",
        name: "Hero Banner",
        nodeType: "RECTANGLE",
        type: "image" as const,
        y: 50,
        width: 800,
        height: 400
      },
      {
        id: "below-fold-img",
        name: "Gallery Photo",
        nodeType: "RECTANGLE",
        type: "image" as const,
        y: 900,
        width: 640,
        height: 480
      }
    ]
  };

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [lazyScreen]
    },
    imageAssetMap: {
      "hero-img": "/images/hero-banner.png",
      "below-fold-img": "/images/gallery.png"
    },
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const content = await readFile(path.join(projectDir, toDeterministicScreenPath("Lazy Screen")), "utf8");

  // Hero image (y=50): should have fetchPriority="high", decoding="async", no loading="lazy"
  assert.ok(
    content.includes(
      'src={".\\u002Fimages\\u002Fhero-banner.png"} alt={"Hero Banner"} decoding="async" fetchPriority="high" width={800} height={400}'
    )
  );
  assert.ok(!content.includes('.\\u002Fimages\\u002Fhero-banner.png"} alt={"Hero Banner"} loading="lazy"'));

  // Below-fold image (y=900): should have loading="lazy", decoding="async", no fetchpriority
  assert.ok(
    content.includes(
      'src={".\\u002Fimages\\u002Fgallery.png"} alt={"Gallery Photo"} loading="lazy" decoding="async" width={640} height={480}'
    )
  );
  assert.ok(!content.includes('.\\u002Fimages\\u002Fgallery.png"} alt={"Gallery Photo"} decoding="async" fetchpriority'));
});

test("generateArtifacts rejects non-deterministic mode in workspace-dev", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-mode-"));

  await assert.rejects(
    () =>
      generateArtifacts({
        projectDir,
        ir: createIr(),
        llmCodegenMode: "hybrid",
        llmModelName: "qwen",
        onLog: () => {
          // no-op
        }
      }),
    /Only deterministic code generation is supported/
  );
});

test("generateArtifacts wires prototype interactions from IR to deterministic route links across screens", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-prototype-navigation-"));
  const ir = figmaToDesignIr({
    name: "Prototype Navigation Integration",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-home",
              type: "FRAME",
              name: "Home",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "home-cta",
                  type: "FRAME",
                  name: "Go Settings",
                  absoluteBoundingBox: { x: 16, y: 16, width: 160, height: 48 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "screen-settings", navigation: "NAVIGATE" }]
                    }
                  ],
                  children: [
                    {
                      id: "home-cta-label",
                      type: "TEXT",
                      name: "Label",
                      characters: "Settings",
                      absoluteBoundingBox: { x: 32, y: 30, width: 100, height: 24 }
                    }
                  ]
                },
                {
                  id: "home-subtitle",
                  type: "TEXT",
                  name: "Subtitle",
                  characters: "Overview",
                  absoluteBoundingBox: { x: 16, y: 88, width: 100, height: 24 }
                }
              ]
            },
            {
              id: "screen-settings",
              type: "FRAME",
              name: "Settings",
              absoluteBoundingBox: { x: 480, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "settings-title",
                  type: "TEXT",
                  name: "Settings title",
                  characters: "Settings",
                  absoluteBoundingBox: { x: 496, y: 24, width: 120, height: 24 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const logs: string[] = [];
  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  const generatedScreenDir = path.join(projectDir, "src", "screens");
  const generatedScreenFiles = (await readdir(generatedScreenDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name);
  const generatedScreenContents = await Promise.all(
    generatedScreenFiles.map(async (fileName) => readFile(path.join(generatedScreenDir, fileName), "utf8"))
  );
  assert.ok(
    generatedScreenContents.some(
      (content) =>
        content.includes('import { Link as RouterLink } from "react-router-dom";') ||
        content.includes('import { useNavigate } from "react-router-dom";')
    )
  );
  assert.ok(
    generatedScreenContents.some(
      (content) =>
        content.includes('component={RouterLink} to={"\\u002Fsettings"}') ||
        content.includes('navigate("\\u002Fsettings")') ||
        content.includes('navigate("\\u002Fsettings", { replace: true })')
    )
  );

  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");
  assert.ok(appContent.includes('path="/home"'));
  assert.ok(appContent.includes('path="/settings"'));

  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as {
    prototypeNavigationDetected?: number;
    prototypeNavigationResolved?: number;
    prototypeNavigationUnresolved?: number;
    prototypeNavigationRendered?: number;
  };
  assert.equal(metrics.prototypeNavigationDetected, 1);
  assert.equal(metrics.prototypeNavigationResolved, 1);
  assert.equal(metrics.prototypeNavigationUnresolved, 0);
  assert.equal((metrics.prototypeNavigationRendered ?? 0) >= 1, true);
  assert.equal((result.generationMetrics.prototypeNavigationRendered ?? 0) >= 1, true);
  assert.ok(logs.some((entry) => entry.includes("Prototype navigation: detected=1, resolved=1, unresolved=0")));
});

test("generateArtifacts auto-bootstraps icon fallback map file when missing", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-bootstrap-"));
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-icon-map-root-"));
  const iconMapFilePath = path.join(outputRoot, "icon-fallback-map.json");
  const logs: string[] = [];

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-bootstrap-screen",
          name: "Icon Bootstrap Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-bootstrap-node",
              name: "icon/download",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  const mapFileContent = await readFile(iconMapFilePath, "utf8");
  const parsedMap = JSON.parse(mapFileContent) as { version?: number; entries?: unknown[] };
  assert.equal(parsedMap.version, 1);
  assert.equal(Array.isArray(parsedMap.entries), true);
  assert.ok((parsedMap.entries ?? []).length >= 200);
  assert.ok(logs.some((entry) => entry.includes("Bootstrapped icon fallback map")));

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Bootstrap Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import DownloadIcon from "@mui/icons-material/Download";'));
});

test("generateArtifacts uses custom icon fallback map file when valid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-custom-"));
  const iconMapFilePath = path.join(projectDir, "icon-map.custom.json");
  await writeFile(
    iconMapFilePath,
    `${JSON.stringify(
      {
        version: 1,
        entries: [{ iconName: "Delete", aliases: ["trash"] }],
        synonyms: {
          "remove item": "Delete"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-custom-screen",
          name: "Icon Custom Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-custom-node",
              name: "icon/trash",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Custom Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import DeleteIcon from "@mui/icons-material/Delete";'));
  assert.equal(generatedScreenContent.includes("InfoOutlinedIcon"), false);
});

test("generateArtifacts falls back to built-in icon catalog when icon map file is invalid", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-icon-invalid-"));
  const iconMapFilePath = path.join(projectDir, "icon-map.invalid.json");
  const logs: string[] = [];
  await writeFile(iconMapFilePath, `{\"version\":1,\"entries\":\"invalid\"}\n`, "utf8");

  await generateArtifacts({
    projectDir,
    ir: {
      ...createIr(),
      screens: [
        {
          id: "icon-invalid-screen",
          name: "Icon Invalid Screen",
          layoutMode: "NONE" as const,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: [
            {
              id: "icon-invalid-node",
              name: "icon/user",
              nodeType: "INSTANCE",
              type: "container" as const,
              x: 0,
              y: 0,
              width: 24,
              height: 24,
              children: []
            }
          ]
        }
      ]
    },
    iconMapFilePath,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: (message) => logs.push(message)
  });

  assert.ok(
    logs.some((entry) => entry.toLowerCase().includes("icon fallback map") && entry.toLowerCase().includes("invalid"))
  );
  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Icon Invalid Screen"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  assert.ok(generatedScreenContent.includes('import PersonIcon from "@mui/icons-material/Person";'));
});

test("generateArtifacts logs and writes accessibility contrast warnings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-a11y-"));
  const logs: string[] = [];
  const ir = createIr();
  ir.screens = [
    {
      id: "contrast-screen",
      name: "Contrast Screen",
      layoutMode: "NONE" as const,
      gap: 0,
      fillColor: "#ffffff",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      children: [
        {
          id: "low-contrast-text",
          name: "Primary Title",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Low contrast copy",
          fillColor: "#8a8a8a",
          fontSize: 16,
          fontWeight: 400
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "qwen",
    onLog: (message) => logs.push(message)
  });

  assert.ok(logs.some((entry) => entry.includes("[a11y] Low contrast")));
  const metricsContent = await readFile(path.join(projectDir, "generation-metrics.json"), "utf8");
  const metrics = JSON.parse(metricsContent) as { accessibilityWarnings?: Array<{ code?: string }> };
  assert.equal(Array.isArray(metrics.accessibilityWarnings), true);
  assert.ok((metrics.accessibilityWarnings ?? []).length > 0);
  assert.equal(metrics.accessibilityWarnings?.[0]?.code, "W_A11Y_LOW_CONTRAST");
});

test("createDeterministicAppFile uses lazy route-level loading for non-initial screens", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([
    ir.screens[0],
    {
      ...ir.screens[0],
      id: "screen-2",
      name: "Settings"
    }
  ]);

  assert.ok(appFile.content.includes("Suspense"));
  assert.ok(appFile.content.includes("BrowserRouter"));
  assert.ok(appFile.content.includes('import ScreenSkeleton from "./components/ScreenSkeleton";'));
  assert.ok(appFile.content.includes("const routeLoadingFallback = <ScreenSkeleton />;"));
  assert.ok(appFile.content.includes("const LazySettingsScreen = lazy"));
  assert.ok(appFile.content.includes('element={<ErrorBoundary><LazySettingsScreen /></ErrorBoundary>}'));
  assert.equal((appFile.content.match(/element={<ErrorBoundary></g) ?? []).length, 2);
});

test("createDeterministicAppFile emits BrowserRouter basename resolver by default", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]]);

  assert.ok(appFile.content.includes("resolveBrowserBasename"));
  assert.ok(appFile.content.includes('window.location.pathname.match(/^\\/workspace\\/repros\\/[^/]+/)'));
  assert.ok(appFile.content.includes("<BrowserRouter basename={browserBasename}>"));
  assert.equal(appFile.content.includes("HashRouter"), false);
});

test("createDeterministicAppFile supports hash router mode override", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]], { routerMode: "hash" });

  assert.ok(appFile.content.includes("<HashRouter>"));
  assert.ok(appFile.content.includes('import { HashRouter, Navigate, Route, Routes } from "react-router-dom";'));
  assert.equal(appFile.content.includes("BrowserRouter"), false);
  assert.equal(appFile.content.includes("resolveBrowserBasename"), false);
});

test("createDeterministicAppFile omits lazy import when only one screen exists", () => {
  const ir = createIr();
  const appFile = createDeterministicAppFile([ir.screens[0]]);

  assert.ok(appFile.content.includes('import { Suspense } from "react";'));
  assert.equal(appFile.content.includes('import { Suspense, lazy } from "react";'), false);
  assert.equal(appFile.content.includes("const Lazy"), false);
  assert.equal(appFile.content.includes("= lazy(async"), false);
});

test("createDeterministicAppFile disambiguates duplicate screen names", () => {
  const ir = createIr();
  const duplicateScreens = [
    { ...ir.screens[0], id: "screen-a", name: "Overview" },
    { ...ir.screens[0], id: "screen-b", name: "Overview" },
    { ...ir.screens[0], id: "screen-c", name: "Overview" }
  ];

  const appFile = createDeterministicAppFile(duplicateScreens);
  assert.ok(appFile.content.includes('path="/overview"'));
  assert.ok(appFile.content.includes('path="/overview-'));
  assert.ok(appFile.content.includes('import OverviewScreen from "./screens/Overview";'));
  assert.ok(appFile.content.includes('const LazyOverview'));
});

test("deterministic screen rendering keeps semantic labels and avoids Mui internal text leakage", () => {
  const screen = createRegressionScreen();
  const screenFile = createDeterministicScreenFile(screen);
  const content = screenFile.content;

  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.ok(content.includes('>{"Weiter"}</Button>'));
  assert.ok(content.includes('endIcon={<ChevronRightIcon'));
  assert.ok(content.includes("TextField"));
  assert.ok(content.includes("MenuItem"));
  assert.ok(content.includes("InputAdornment"));

  assert.equal(content.includes('{"MuiInputRoot"}'), false);
  assert.equal(content.includes('{"MuiInputBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiButtonEndIcon"}'), false);
  assert.equal(/>\s*"/.test(content), false);
  assert.ok(content.includes('top: "40px"'));
  assert.ok(content.includes('width: "560px"'));
  assert.ok(content.includes('minHeight: "66px"'));
});

test("deterministic screen rendering preserves simple MUI board controls, stepper icons, and exported images", () => {
  const screen = createMuiBoardRegressionScreen();
  const screenFile = createDeterministicScreenFile(screen);
  const content = screenFile.content;

  assert.ok(content.includes("Bauen oder kaufen"));
  assert.ok(content.includes("<Slider"));
  assert.ok(content.includes('src={".\\u002Fimages\\u002Fbauen-oder-kaufen.png"}'));
  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.equal(content.includes('data-ir-id="1:32"'), false);
  assert.equal(content.includes('data-ir-id="1:44"'), false);
  assert.equal(content.includes("<Table"), false);
  assert.equal(content.includes('{"MuiSliderRail"}'), false);
  assert.equal(content.includes('{"MuiSliderTrack"}'), false);
  assert.equal(content.includes('{"MuiSliderThumb"}'), false);
  assert.equal(content.includes('{"MuiInputBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiInputRoot"}'), false);
  assert.equal(content.includes('M0 0L24 0L24 24L0 24L0 0Z'), false);
});

test("deterministic screen rendering resolves detached MUI field labels, relative image assets, and decimal bounding-box paths", () => {
  const screen = createDetachedMuiFieldRegressionScreen();
  const screenFile = createDeterministicScreenFile(screen);
  const content = screenFile.content;

  assert.ok(content.includes("Bitte erfassen Sie die gewünschte monatliche Sparrate und den Zeitraum."));
  assert.ok(content.includes('label={"Monatliche Sparrate (optional)"}'));
  assert.ok(content.includes('label={"Zu welchem Monat soll die Besparung starten?"}'));
  assert.ok(content.includes('src={".\\u002Fimages\\u002Fbauen-oder-kaufen.png"}'));
  assert.equal(content.includes('data-ir-id="detached-label-1"'), false);
  assert.equal(content.includes('data-ir-id="detached-label-2"'), false);
  assert.equal(content.includes('{"MuiInputBaseRoot"}'), false);
  assert.equal(content.includes('{"MuiInputRoot"}'), false);
  assert.equal(content.includes("M0 0L23.9931 0L23.9931 23.9931L0 23.9931L0 0Z"), false);
});

test("deriveSelectOptions keeps exact defaults for alphanumeric month-like values", () => {
  const monthOptions = deriveSelectOptions("April 2026", "de-DE");
  assert.equal(monthOptions[0], "April 2026");
  assert.ok(monthOptions.includes("April 2026"));
  assert.equal(monthOptions.includes("2.026,00"), false);

  const dayOptions = deriveSelectOptions("1. des Monats", "de-DE");
  assert.equal(dayOptions[0], "1. des Monats");
  assert.ok(dayOptions.includes("1. des Monats"));
  assert.equal(dayOptions.includes("1,00"), false);
});

test("deriveSelectOptions always includes the exact default value for numeric-like inputs", () => {
  const options = deriveSelectOptions("10%", "de-DE");
  assert.equal(options[0], "10%");
  assert.ok(options.includes("10%"));
  assert.equal(options.some((candidate) => candidate !== "10%"), true);
});

test("deterministic screen rendering keeps select default values inside generated option maps", () => {
  const screen = {
    id: "select-default-membership-screen",
    name: "Select Default Membership Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticSelectInputNode({
        id: "start-month-select",
        label: "Zu welchem Monat soll die Besparung starten?",
        value: "April 2026"
      }),
      createSemanticSelectInputNode({
        id: "start-day-select",
        label: "Zu welchem Tag des Monats sollen die Sparraten abgebucht werden?",
        value: "1. des Monats"
      })
    ]
  };

  const content = createDeterministicScreenFile(screen, { generationLocale: "de-DE" }).content;
  const selectOptionsMap = readGeneratedStringArrayMapLiteral({
    source: content,
    variableName: "selectOptions"
  });
  const flattenedOptions = Object.values(selectOptionsMap).flat();
  assert.ok(flattenedOptions.includes("April 2026"));
  assert.ok(flattenedOptions.includes("1. des Monats"));
  assert.equal(flattenedOptions.includes("2.026,00"), false);
  assert.equal(flattenedOptions.includes("1,00"), false);
});

test("deterministic screen rendering derives semantic select options with locale-aware number formatting", () => {
  const screen = {
    id: "semantic-select-locale-screen",
    name: "Semantic Select Locale Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticSelectInputNode({ id: "rate-input", label: "Rate", value: "10,00 %" })]
  };

  const defaultLocaleContent = createDeterministicScreenFile(screen).content;
  assert.ok(defaultLocaleContent.includes('"9,75 %"'));
  assert.equal(defaultLocaleContent.includes('"9.75 %"'), false);

  const enUsContent = createDeterministicScreenFile(screen, { generationLocale: "en-US" }).content;
  assert.ok(enUsContent.includes('"9.75 %"'));
  assert.equal(enUsContent.includes('"9,75 %"'), false);
});

test("deterministic screen rendering derives select fallback options with locale-aware number formatting", () => {
  const screen = {
    id: "select-fallback-locale-screen",
    name: "Select Fallback Locale Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "rate-select",
        name: "Rate Select",
        nodeType: "FRAME",
        type: "select" as const,
        text: "10,00 %",
        width: 260,
        height: 56,
        children: []
      }
    ]
  };

  const defaultLocaleContent = createDeterministicScreenFile(screen).content;
  assert.ok(defaultLocaleContent.includes('"9,75 %"'));
  assert.equal(defaultLocaleContent.includes('"9.75 %"'), false);

  const enUsContent = createDeterministicScreenFile(screen, { generationLocale: "en-US" }).content;
  assert.ok(enUsContent.includes('"9.75 %"'));
  assert.equal(enUsContent.includes('"9,75 %"'), false);
});

test("generateArtifacts falls back to de-DE and logs warning for invalid generationLocale", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-locale-fallback-"));
  const logs: string[] = [];
  const ir = {
    ...createIr(),
    screens: [
      {
        id: "locale-fallback-screen",
        name: "Locale Fallback",
        layoutMode: "VERTICAL" as const,
        gap: 8,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "fallback-rate-select",
            name: "Rate Select",
            nodeType: "FRAME",
            type: "select" as const,
            text: "10,00 %",
            width: 260,
            height: 56,
            children: []
          }
        ]
      }
    ]
  };

  await generateArtifacts({
    projectDir,
    ir,
    generationLocale: "invalid_locale",
    llmCodegenMode: "deterministic",
    llmModelName: "qwen",
    onLog: (message) => logs.push(message)
  });

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath("Locale Fallback"));
  const generatedScreenContent = await readFile(generatedScreenPath, "utf8");
  const generatedFormContextPath = path.join(projectDir, "src", "context", "LocaleFallbackFormContext.tsx");
  const generatedFormContextContent = await readFile(generatedFormContextPath, "utf8");
  assert.ok(generatedScreenContent.includes("useLocaleFallbackFormContext"));
  assert.ok(generatedFormContextContent.includes('"9,75 %"'));
  assert.equal(
    logs.some((entry) =>
      entry.includes("Invalid generationLocale 'invalid_locale' configured for deterministic generation")
    ),
    true
  );
});

test("deterministic screen rendering maps textRole placeholder to TextField placeholder without default prefill", () => {
  const screen = {
    id: "placeholder-screen",
    name: "Placeholder Screen",
    layoutMode: "VERTICAL" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "input-1",
        name: "Loan Input",
        nodeType: "FRAME",
        type: "input" as const,
        layoutMode: "VERTICAL" as const,
        gap: 4,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        width: 320,
        height: 72,
        children: [
          {
            id: "input-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Loan amount",
            y: 0
          },
          {
            id: "input-placeholder",
            name: "Placeholder",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Type here",
            textRole: "placeholder" as const,
            y: 24
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assert.ok(content.includes('label={"Loan amount"}'));
  assert.ok(content.includes('placeholder={"Type here"}'));
  assert.equal(/":\s*"Type here"/.test(content), false);
});

test("deterministic screen rendering infers TextField type and conservative autoComplete from semantic labels", () => {
  const screen = {
    id: "textfield-type-label-screen",
    name: "TextField Type Label Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "input-email", name: "Email Field", label: "Email" }),
      createSemanticInputNode({ id: "input-password", name: "Password Field", label: "Passwort" }),
      createSemanticInputNode({ id: "input-phone", name: "Phone Field", label: "Telefon" }),
      createSemanticInputNode({ id: "input-number", name: "Number Field", label: "Betrag" }),
      createSemanticInputNode({ id: "input-date", name: "Date Field", label: "Datum" }),
      createSemanticInputNode({ id: "input-url", name: "URL Field", label: "Website" }),
      createSemanticInputNode({ id: "input-search", name: "Search Field", label: "Suche" })
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const cases: Array<{ label: string; type: string; autoComplete?: string }> = [
    { label: "Email", type: "email", autoComplete: "email" },
    { label: "Passwort", type: "password", autoComplete: "current-password" },
    { label: "Telefon", type: "tel", autoComplete: "tel" },
    { label: "Betrag", type: "number" },
    { label: "Datum", type: "date" },
    { label: "Website", type: "url", autoComplete: "url" },
    { label: "Suche", type: "search" }
  ];

  for (const testCase of cases) {
    const block = findRenderedTextFieldBlock({ content, label: testCase.label });
    assert.ok(block.includes(`type={"${testCase.type}"}`));
    if (testCase.autoComplete) {
      assert.ok(block.includes(`autoComplete={"${testCase.autoComplete}"}`));
    } else {
      assert.equal(block.includes("autoComplete={"), false);
    }
    assert.ok(block.includes("value={formValues["));
    assert.ok(block.includes("onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue("));
  }
});

test("deterministic screen rendering infers TextField type from node name and placeholder hints", () => {
  const screen = {
    id: "textfield-type-hints-screen",
    name: "TextField Type Hints Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "name-email", name: "input-email", label: "Kontakt" }),
      createSemanticInputNode({ id: "name-password", name: "password-field", label: "Zugang" }),
      createSemanticInputNode({
        id: "placeholder-url",
        name: "generic-input",
        label: "Wert",
        placeholder: "Website Link eingeben"
      })
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const emailBlock = findRenderedTextFieldBlock({ content, label: "Kontakt" });
  assert.ok(emailBlock.includes('type={"email"}'));
  assert.ok(emailBlock.includes('autoComplete={"email"}'));

  const passwordBlock = findRenderedTextFieldBlock({ content, label: "Zugang" });
  assert.ok(passwordBlock.includes('type={"password"}'));
  assert.ok(passwordBlock.includes('autoComplete={"current-password"}'));

  const placeholderBlock = findRenderedTextFieldBlock({ content, label: "Wert" });
  assert.ok(placeholderBlock.includes('placeholder={"Website Link eingeben"}'));
  assert.ok(placeholderBlock.includes('type={"url"}'));
  assert.ok(placeholderBlock.includes('autoComplete={"url"}'));
});

test("deterministic screen rendering prioritizes password type when multiple semantic keywords match", () => {
  const screen = {
    id: "textfield-type-priority-screen",
    name: "TextField Type Priority Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "priority-field", name: "priority-field", label: "Email Passwort" })]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedTextFieldBlock({ content, label: "Email Passwort" });
  assert.ok(block.includes('type={"password"}'));
  assert.ok(block.includes('autoComplete={"current-password"}'));
});

test("deterministic screen rendering infers required fields from star labels and removes star from TextField label", () => {
  const screen = {
    id: "textfield-required-screen",
    name: "TextField Required Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "required-email", name: "Email Input", label: "Email *" })]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedTextFieldBlock({ content, label: "Email" });
  assert.equal(block.includes('label={"Email *"}'), false);
  assert.ok(block.includes('label={"Email"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"email_input_required_email-helper-text"}'));
  assert.ok(block.includes('"aria-required": "true"'));
  assert.ok(block.includes("slotProps={{"));
  assert.ok(block.includes('htmlInput: { "aria-describedby": "email_input_required_email-helper-text", "aria-required": "true" }'));
  assert.ok(block.includes('formHelperText: { id: "email_input_required_email-helper-text" }'));
  assert.equal(block.includes("InputProps={{"), false);
  assert.equal(block.includes("InputLabelProps={{"), false);
  assert.equal(block.includes("FormHelperTextProps={{"), false);
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("helperText={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
});

test("deterministic screen rendering maps TextField suffix adornment via slotProps.input and avoids deprecated props", () => {
  const amountInput = createSemanticInputNode({
    id: "amount-input",
    name: "Amount Input",
    label: "Betrag"
  });
  amountInput.children.push({
    id: "amount-input-suffix",
    name: "Suffix",
    nodeType: "TEXT",
    type: "text" as const,
    text: "€",
    x: 260,
    y: 28
  });

  const screen = {
    id: "textfield-suffix-screen",
    name: "TextField Suffix Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [amountInput]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedTextFieldBlock({ content, label: "Betrag" });
  assert.ok(content.includes("InputAdornment"));
  assert.ok(block.includes("slotProps={{"));
  assert.ok(block.includes('input: { endAdornment: <InputAdornment position="end">{"€"}</InputAdornment> }'));
  assert.ok(block.includes('htmlInput: { "aria-describedby": "amount_input_amount_input-helper-text" }'));
  assert.ok(block.includes('formHelperText: { id: "amount_input_amount_input-helper-text" }'));
  assert.equal(block.includes("InputProps={{"), false);
  assert.equal(block.includes("InputLabelProps={{"), false);
  assert.equal(block.includes("FormHelperTextProps={{"), false);
});

test("deterministic screen rendering emits form validation state scaffolding for interactive fields", () => {
  const screen = {
    id: "validation-scaffold-screen",
    name: "Validation Scaffold Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "email-field", name: "Email Input", label: "Email *", placeholder: "name@example.com" }),
      {
        id: "primary-submit",
        name: "Primary Submit",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 100,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "primary-submit-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Continue",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assert.ok(content.includes('component="form" onSubmit={handleSubmit} noValidate'));
  assert.ok(content.includes("const initialVisualErrors: Record<string, string> = "));
  assert.ok(content.includes("const requiredFields: Record<string, boolean> = "));
  assert.ok(content.includes("const fieldValidationTypes: Record<string, string> = "));
  assert.ok(content.includes("const fieldValidationMessages: Record<string, string> = "));
  assert.ok(content.includes("const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);"));
  assert.ok(content.includes("const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});"));
  assert.ok(content.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"));
  assert.ok(content.includes("const validateForm = (values: Record<string, string>): Record<string, string> => {"));
  assert.ok(content.includes("const handleFieldBlur = (fieldKey: string): void => {"));
  assert.ok(content.includes("const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {"));
  assert.ok(content.includes('import type { FormEvent, ChangeEvent } from "react";'));
  assert.equal(content.includes("const primarySubmitButtonKey"), false);
});

test("deterministic screen rendering uses react-hook-form scaffolding by default", () => {
  const screen = {
    id: "rhf-default-screen",
    name: "RHF Default Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 200,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [createSemanticInputNode({ id: "rhf-email", name: "Email Input", label: "Email *", placeholder: "name@example.com" })]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes('component="form" onSubmit={((event) => { void handleSubmit(onSubmit)(event); })} noValidate'));
  assert.ok(content.includes('import { Controller, useForm } from "react-hook-form";'));
  assert.ok(content.includes('import { zodResolver } from "@hookform/resolvers/zod";'));
  assert.ok(content.includes('import { z } from "zod";'));
  assert.ok(content.includes("const fieldSchemaSpecs = "));
  assert.ok(content.includes("type FieldSchemaSpec = {"));
  assert.ok(content.includes("const createFieldSchema = <TSpec extends FieldSchemaSpec>({"));
  assert.ok(
    content.includes('type FieldSchemaOutput<TSpec extends FieldSchemaSpec> = TSpec["validationType"] extends "number" ? number | undefined : string;')
  );
  assert.ok(/createFieldSchema\(\{ spec: fieldSchemaSpecs\["[^"]+"\] \}\)/.test(content));
  assert.ok(content.includes("type FormInput = z.input<typeof formSchema>;"));
  assert.ok(content.includes("type FormOutput = z.output<typeof formSchema>;"));
  assert.ok(content.includes("const { control, handleSubmit, formState: { isSubmitting, isSubmitted }, reset, setError } = useForm<FormInput>({"));
  assert.ok(content.includes("if (!isTouched && !isSubmitted) {"));
  assert.ok(content.includes("<Controller"));
  assert.equal(content.includes("fieldValidationTypes[fieldKey]"), false);
  assert.equal(content.includes("const [formValues, setFormValues] = useState<Record<string, string>>("), false);
  assert.equal(content.includes("const validateFieldValue = (fieldKey: string, value: string): string => {"), false);
});

test("deterministic screen rendering enforces select option membership in RHF schemas", () => {
  const screen = {
    id: "rhf-select-membership-screen",
    name: "RHF Select Membership Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "rhf-status-select",
        name: "Status Select",
        nodeType: "FRAME",
        type: "select" as const,
        width: 260,
        height: 56,
        children: [
          {
            id: "rhf-status-select-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Status"
          },
          {
            id: "rhf-status-select-option-1",
            name: "Option 1",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Aktiv"
          },
          {
            id: "rhf-status-select-option-2",
            name: "Option 2",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Inaktiv"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.ok(content.includes("const selectOptions: Record<string, string[]> = "));
  assert.ok(content.includes("const selectFieldOptions = spec.selectOptions;"));
  assert.ok(content.includes("!selectFieldOptions.includes(rawValue)"));
  assert.ok(content.includes("const selectValidationMessage = spec.selectValidationMessage;"));
});

test("deterministic screen rendering seeds visual error examples from red outlines", () => {
  const screen = {
    id: "visual-error-screen",
    name: "Visual Error Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "visual-error-field",
        name: "Email Input",
        nodeType: "FRAME",
        type: "input" as const,
        layoutMode: "VERTICAL" as const,
        gap: 4,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        width: 320,
        height: 72,
        strokeColor: "#d32f2f",
        children: [
          {
            id: "visual-error-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Email",
            y: 0
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  assert.ok(content.includes('"email_input_visual_error_field": "Please enter a valid email address."'));
  const block = findRenderedTextFieldBlock({ content, label: "Email" });
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("helperText={"));
});

test("deterministic screen rendering applies validation bindings for select controls", () => {
  const screen = {
    id: "select-validation-screen",
    name: "Select Validation Screen",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "status-select",
        name: "Status Select",
        nodeType: "FRAME",
        type: "select" as const,
        width: 260,
        height: 56,
        strokeColor: "#d32f2f",
        children: [
          {
            id: "status-select-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Status *"
          },
          {
            id: "status-select-option-1",
            name: "Option 1",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Aktiv"
          },
          {
            id: "status-select-option-2",
            name: "Option 2",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Inaktiv"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen, { formHandlingMode: "legacy_use_state" }).content;
  const block = findRenderedFormControlBlock({ content, label: "Status" });
  assert.equal(block.includes('label={"Status *"}'), false);
  assert.ok(block.includes('label={"Status"}'));
  assert.ok(block.includes("required"));
  assert.ok(block.includes('aria-describedby={"status_select_status_select-helper-text"}'));
  assert.ok(block.includes('aria-required="true"'));
  assert.ok(block.includes("error={"));
  assert.ok(block.includes("onBlur={() => handleFieldBlur("));
  assert.ok(block.includes("onChange={(event: SelectChangeEvent<string>) => updateFieldValue("));
  assert.ok(block.includes('<FormHelperText id={"status_select_status_select-helper-text"}>{'));
  assert.ok(content.includes('import type { FormEvent } from "react";'));
  assert.ok(content.includes('import type { SelectChangeEvent } from "@mui/material/Select";'));
});

test("deterministic screen rendering assigns a single primary submit button and explicit button types", () => {
  const screen = {
    id: "submit-wiring-screen",
    name: "Submit Wiring Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 360,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({ id: "submit-email", name: "Email Input", label: "Email" }),
      {
        id: "btn-secondary",
        name: "Secondary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 120,
        width: 180,
        height: 36,
        strokeColor: "#565656",
        children: [
          {
            id: "btn-secondary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Secondary",
            fillColor: "#292929"
          }
        ]
      },
      {
        id: "btn-primary",
        name: "Primary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 176,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "btn-primary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Primary",
            fillColor: "#ffffff"
          }
        ]
      },
      {
        id: "btn-disabled",
        name: "Disabled Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 236,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        opacity: 0.45,
        children: [
          {
            id: "btn-disabled-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Disabled",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("const primarySubmitButtonKey"), false);

  const secondaryLine = findRenderedButtonLine({ content, label: "Secondary" });
  assert.ok(secondaryLine.includes('type="button"'));

  const primaryLine = findRenderedButtonLine({ content, label: "Primary" });
  assert.ok(primaryLine.includes('type="submit"'));
  assert.ok(primaryLine.includes("disabled={isSubmitting}"));

  const disabledLine = findRenderedButtonLine({ content, label: "Disabled" });
  assert.ok(disabledLine.includes('type="button"'));
});

test("deterministic screen rendering keeps plain buttons on screens without form fields", () => {
  const screen = {
    id: "no-form-button-screen",
    name: "No Form Button Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    width: 360,
    height: 220,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "btn-plain-secondary",
        name: "Secondary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 0,
        width: 180,
        height: 36,
        strokeColor: "#565656",
        children: [
          {
            id: "btn-plain-secondary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Secondary",
            fillColor: "#292929"
          }
        ]
      },
      {
        id: "btn-plain-primary",
        name: "Primary Action",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 64,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "btn-plain-primary-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Primary",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assert.equal(content.includes("const primarySubmitButtonKey"), false);
  assert.equal(content.includes('type={primarySubmitButtonKey === '), false);

  const secondaryLine = findRenderedButtonLine({ content, label: "Secondary" });
  assert.ok(secondaryLine.includes('type="button"'));

  const primaryLine = findRenderedButtonLine({ content, label: "Primary" });
  assert.ok(primaryLine.includes('type="button"'));
});

test("deterministic screen rendering infers heading hierarchy components from typography prominence", () => {
  const screen = {
    id: "heading-hierarchy-screen",
    name: "Heading Hierarchy Screen",
    layoutMode: "NONE" as const,
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "heading-main",
        name: "Main Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Main Heading",
        fontSize: 40,
        fontWeight: 700
      },
      {
        id: "heading-section",
        name: "Section Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Section Heading",
        fontSize: 30,
        fontWeight: 650
      },
      {
        id: "heading-sub",
        name: "Sub Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Sub Heading",
        fontSize: 24,
        fontWeight: 600
      },
      {
        id: "heading-detail",
        name: "Detail Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Detail Heading",
        fontSize: 22,
        fontWeight: 600
      },
      {
        id: "heading-minor",
        name: "Minor Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Minor Heading",
        fontSize: 20,
        fontWeight: 600
      },
      {
        id: "heading-note",
        name: "Note Title",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Note Heading",
        fontSize: 18,
        fontWeight: 650
      },
      {
        id: "body-copy",
        name: "Body Copy",
        nodeType: "TEXT",
        type: "text" as const,
        text: "Body text",
        fontSize: 14,
        fontWeight: 400
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  const h1Line = findRenderedTypographyLine({ content, text: "Main Heading" });
  const h2Line = findRenderedTypographyLine({ content, text: "Section Heading" });
  const h3Line = findRenderedTypographyLine({ content, text: "Sub Heading" });
  const h4Line = findRenderedTypographyLine({ content, text: "Detail Heading" });
  const h5Line = findRenderedTypographyLine({ content, text: "Minor Heading" });
  const h6Line = findRenderedTypographyLine({ content, text: "Note Heading" });
  const bodyLine = findRenderedTypographyLine({ content, text: "Body text" });
  assert.ok(h1Line.includes('component="h1"'));
  assert.ok(h2Line.includes('component="h2"'));
  assert.ok(h3Line.includes('component="h3"'));
  assert.ok(h4Line.includes('component="h4"'));
  assert.ok(h5Line.includes('component="h5"'));
  assert.ok(h6Line.includes('component="h6"'));
  assert.equal(bodyLine.includes('component="h'), false);
});

test("deterministic screen rendering honors explicit board component semantics from Figma IR", () => {
  const ir = figmaToDesignIr({
    name: "Board Semantics",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "board-screen",
              type: "FRAME",
              name: "Board Semantics",
              layoutMode: "VERTICAL",
              itemSpacing: 16,
              absoluteBoundingBox: { x: 0, y: 0, width: 960, height: 640 },
              children: [
                {
                  id: "board-button",
                  type: "INSTANCE",
                  name: "<Button>",
                  cornerRadius: 64,
                  fills: [{ type: "SOLID", color: toFigmaColor("#ee0000") }],
                  absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 48 },
                  children: [{ id: "board-button-text", type: "TEXT", name: "Label", characters: "Vorhaben hinzufügen" }]
                },
                {
                  id: "board-card",
                  type: "INSTANCE",
                  name: "<Card>",
                  cornerRadius: 12,
                  fills: [{ type: "SOLID", color: toFigmaColor("#ffffff") }],
                  absoluteBoundingBox: { x: 0, y: 64, width: 320, height: 160 },
                  children: [{ id: "board-card-text", type: "TEXT", name: "Title", characters: "Card Content" }]
                },
                {
                  id: "board-divider",
                  type: "INSTANCE",
                  name: "<Divider>",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d9d9d9") }],
                  absoluteBoundingBox: { x: 0, y: 240, width: 320, height: 1 },
                  children: []
                },
                {
                  id: "board-alert",
                  type: "INSTANCE",
                  name: "<Alert>",
                  fills: [{ type: "SOLID", color: toFigmaColor("#e6f4ff") }],
                  absoluteBoundingBox: { x: 0, y: 264, width: 320, height: 56 },
                  children: [{ id: "board-alert-text", type: "TEXT", name: "Message", characters: "Bitte beachten" }]
                },
                {
                  id: "board-stack",
                  type: "FRAME",
                  name: "<Stack2>(Nested)",
                  layoutMode: "VERTICAL",
                  absoluteBoundingBox: { x: 0, y: 336, width: 320, height: 96 },
                  children: [{ id: "board-stack-text", type: "TEXT", name: "<Dynamic Typography>", characters: "Stack Body" }]
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const screen = ir.screens[0];
  assert.ok(screen);
  const content = createDeterministicScreenFile(screen!).content;

  assertValidTsx({
    content,
    filePath: toDeterministicScreenPath(screen?.name ?? "Board Semantics")
  });
  assert.ok(content.includes("<Button "));
  assert.ok(content.includes('{"Vorhaben hinzufügen"}'));
  assert.ok(content.includes("<Card "));
  assert.ok(content.includes("<Divider "));
  assert.ok(content.includes('aria-hidden="true"'));
  assert.ok(content.includes("<Alert "));
  assert.ok(content.includes('severity="info"'));
  assert.ok(content.includes("<Stack "));
  assert.ok(content.includes('direction="column"'));
  assert.equal(content.includes('<Paper data-ir-id="board-button"'), false);
  assert.equal(content.includes('<Paper data-ir-name="<Button>"'), false);
  assert.equal(content.includes("<Snackbar open"), false);
});

test("deterministic screen rendering preserves composite button surfaces and vector-only graphics", () => {
  const screen = {
    id: "composite-button-screen",
    name: "Composite Button Surface",
    layoutMode: "VERTICAL" as const,
    gap: 16,
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    children: [
      {
        id: "action-card",
        name: "<Button>",
        nodeType: "INSTANCE",
        type: "button" as const,
        width: 320,
        height: 96,
        fillColor: "#ffffff",
        strokeColor: "#d9d9d9",
        cornerRadius: 16,
        children: [
          {
            id: "action-card-icon",
            name: "Sparkasse S",
            nodeType: "VECTOR",
            type: "container" as const,
            width: 24,
            height: 24,
            fillColor: "#ee0000",
            vectorPaths: ["M0 0H24V24H0Z"]
          },
          {
            id: "action-card-title",
            name: "Title",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Druckcenter"
          },
          {
            id: "action-card-meta",
            name: "Meta",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Dokumente verwalten"
          },
          {
            id: "action-card-chip",
            name: "<Chip>",
            nodeType: "INSTANCE",
            type: "chip" as const,
            children: [
              {
                id: "action-card-chip-text",
                name: "Chip Text",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Bearbeitung gesperrt"
              }
            ]
          }
        ]
      },
      {
        id: "brand-mark",
        name: "Sparkasse S",
        nodeType: "VECTOR",
        type: "container" as const,
        width: 24,
        height: 24,
        fillColor: "#ee0000",
        vectorPaths: ["M0 0H24V24H0Z"]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assertValidTsx({
    content,
    filePath: toDeterministicScreenPath(screen.name)
  });
  assert.ok(content.includes("<Card "));
  assert.ok(content.includes('{"Druckcenter"}'));
  assert.ok(content.includes('label={"Bearbeitung gesperrt"}'));
  assert.equal(content.includes('<Button variant='), false);
  assert.ok(content.includes("<SvgIcon"));
  assert.ok(content.includes('viewBox={"0 0 24 24"}'));
});

test("deterministic screen rendering keeps Sparkasse-style branded headers structured instead of collapsing them to tabs or icon buttons", () => {
  const screen = {
    id: "sparkasse-header-screen",
    name: "Sparkasse Header Screen",
    layoutMode: "NONE" as const,
    width: 1440,
    height: 900,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "brand-bar",
        name: "Markenbühne",
        nodeType: "FRAME",
        type: "container" as const,
        x: 0,
        y: 0,
        width: 1440,
        height: 88,
        fillColor: "#ee0000",
        layoutMode: "HORIZONTAL" as const,
        children: [
          {
            id: "brand-cluster",
            name: "Brand Cluster",
            nodeType: "FRAME",
            type: "container" as const,
            x: 24,
            y: 16,
            width: 240,
            height: 56,
            children: [
              {
                id: "brand-mark",
                name: "Sparkasse S",
                nodeType: "VECTOR",
                type: "container" as const,
                width: 24,
                height: 24,
                fillColor: "#ffffff",
                vectorPaths: ["M0 0H24V24H0Z"]
              },
              {
                id: "brand-title",
                name: "Brand Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Sparkasse Musterstadt",
                fillColor: "#ffffff"
              }
            ]
          },
          {
            id: "nav-start",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 840,
            y: 24,
            width: 120,
            height: 32,
            children: [
              {
                id: "nav-start-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Startseite",
                fillColor: "#ffffff"
              }
            ]
          },
          {
            id: "nav-search",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 968,
            y: 24,
            width: 160,
            height: 32,
            children: [
              {
                id: "nav-search-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Personensuche",
                fillColor: "#ffffff"
              }
            ]
          },
          {
            id: "nav-messenger",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 1136,
            y: 24,
            width: 132,
            height: 32,
            children: [
              {
                id: "nav-messenger-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Messenger",
                fillColor: "#ffffff"
              }
            ]
          },
          {
            id: "nav-profile",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 1288,
            y: 20,
            width: 64,
            height: 40,
            children: [
              {
                id: "nav-profile-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "PB",
                fillColor: "#ffffff"
              }
            ]
          }
        ]
      },
      {
        id: "context-header",
        name: "Header + Titel",
        nodeType: "FRAME",
        type: "container" as const,
        x: 24,
        y: 108,
        width: 1392,
        height: 72,
        layoutMode: "HORIZONTAL" as const,
        children: [
          {
            id: "context-left",
            name: "Context Left",
            nodeType: "FRAME",
            type: "container" as const,
            x: 24,
            y: 112,
            width: 420,
            height: 56,
            children: [
              {
                id: "context-title",
                name: "Title",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Gewerbliche Finanzierung",
                fillColor: "#222222"
              },
              {
                id: "context-subtitle",
                name: "Subtitle",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Ben Sommer",
                fillColor: "#565656"
              }
            ]
          },
          {
            id: "context-action-save",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 1200,
            y: 120,
            width: 88,
            height: 32,
            strokeColor: "#d9d9d9",
            cornerRadius: 16,
            children: [
              {
                id: "context-action-save-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Merken",
                fillColor: "#565656"
              }
            ]
          },
          {
            id: "context-action-help",
            name: "<Button>",
            nodeType: "INSTANCE",
            type: "button" as const,
            x: 1296,
            y: 120,
            width: 72,
            height: 32,
            strokeColor: "#d9d9d9",
            cornerRadius: 16,
            children: [
              {
                id: "context-action-help-label",
                name: "Label",
                nodeType: "TEXT",
                type: "text" as const,
                text: "Hilfe",
                fillColor: "#565656"
              }
            ]
          }
        ]
      }
    ]
  };

  const content = createDeterministicScreenFile(screen).content;
  assertValidTsx({
    content,
    filePath: toDeterministicScreenPath(screen.name)
  });
  assert.ok(content.includes("<AppBar "));
  assert.ok(content.includes('{"Sparkasse Musterstadt"}'));
  assert.ok(content.includes('{"Startseite"}'));
  assert.ok(content.includes('{"Personensuche"}'));
  assert.ok(content.includes('{"Messenger"}'));
  assert.ok(content.includes('{"PB"}'));
  assert.ok(content.includes('{"Gewerbliche Finanzierung"}'));
  assert.ok(content.includes('{"Ben Sommer"}'));
  assert.ok(content.includes('{"Merken"}'));
  assert.ok(content.includes('{"Hilfe"}'));
  assert.equal(content.includes("<Tabs "), false);
  assert.equal(content.includes("<IconButton edge=\"end\""), false);
});

test("generateArtifacts uses upstream code connect mappings from IR during generation", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-code-connect-"));
  const ir = createIr();
  ir.screens[0]!.children = [
    {
      id: "code-connect-button",
      name: "Primary action",
      nodeType: "INSTANCE",
      type: "button",
      text: "Weiter",
      semanticName: "Button",
      semanticType: "Button",
      semanticSource: "code_connect",
      codeConnect: {
        componentName: "AcmeButton",
        source: "src/components/AcmeButton.tsx",
        propContract: {
          children: "{{text}}"
        }
      }
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(screenContent.includes('import AcmeButton from "../components/AcmeButton";'));
  assert.ok(screenContent.includes("<AcmeButton "));
  assert.ok(screenContent.includes('data-figma-node-id={"code-connect-button"}'));
  assert.ok(screenContent.includes('>{"Weiter"}</AcmeButton>'));
});

test("generateArtifacts renders metadata-driven semantic containers with HTML5 components", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-semantic-container-"));
  const ir = createIr();
  ir.screens[0]!.children = [
    {
      id: "semantic-header",
      name: "Frame 12",
      nodeType: "FRAME",
      type: "container",
      semanticName: "Main Header",
      semanticType: "header",
      semanticSource: "metadata",
      children: [
        {
          id: "semantic-header-title",
          name: "Heading",
          nodeType: "TEXT",
          type: "text",
          text: "Dashboard"
        }
      ]
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(screenContent.includes("<Box "));
  assert.ok(screenContent.includes('component="header"'));
  assert.ok(screenContent.includes('role="banner"'));
  assert.ok(screenContent.includes('{"Dashboard"}'));
});

test("generateArtifacts prefers MCP asset references for images and icon wrappers", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-mcp-assets-"));
  const ir = createIr();
  ir.screens[0]!.children = [
    {
      id: "mcp-image",
      name: "Hero image",
      nodeType: "RECTANGLE",
      type: "image",
      width: 320,
      height: 180,
      asset: {
        source: "/mcp/assets/hero.png",
        kind: "image",
        alt: "Hero image"
      }
    },
    {
      id: "mcp-icon",
      name: "ic_settings",
      nodeType: "INSTANCE",
      type: "container",
      width: 24,
      height: 24,
      asset: {
        source: "/mcp/assets/settings.svg",
        kind: "icon",
        label: "Settings icon"
      },
      children: []
    }
  ];

  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");
  assert.ok(screenContent.includes('src={"\\u002Fmcp\\u002Fassets\\u002Fhero.png"}'));
  assert.equal(screenContent.includes("data:image/svg+xml;utf8"), false);
  assert.ok(screenContent.includes('src={"\\u002Fmcp\\u002Fassets\\u002Fsettings.svg"}'));
  assert.ok(screenContent.includes('component="img"'));
});

test("generateArtifacts uses the resolved Storybook theme payload instead of IR-derived theme output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-storybook-theme-"));
  const ir = createIr();

  await generateArtifacts({
    projectDir,
    ir,
    resolvedStorybookTheme: createResolvedStorybookTheme(),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const themeContent = await readFile(path.join(projectDir, "src", "theme", "theme.ts"), "utf8");
  const tokensContent = JSON.parse(await readFile(path.join(projectDir, "src", "theme", "tokens.json"), "utf8")) as {
    customerBrandId: string;
    light: {
      spacingBase: number;
    };
  };
  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");

  assert.ok(themeContent.includes('main: "#aa0000"'));
  assert.ok(themeContent.includes('main: "#ff6666"'));
  assert.ok(themeContent.includes('fontFamily: "Storybook Sans"'));
  assert.match(themeContent, /typography:\s*\{\s*fontFamily: "Storybook Sans",\s*fontSize: 16,/);
  assert.ok(themeContent.includes('textTransform: "capitalize"'));
  assert.equal(themeContent.includes("breakpoints: {"), false);
  assert.equal(tokensContent.customerBrandId, "sparkasse-retail");
  assert.equal(tokensContent.light.spacingBase, 10);
  assert.ok(appContent.includes('data-testid="theme-mode-toggle"'));
});

test("generateArtifacts omits the theme mode toggle when the resolved Storybook theme has no dark scheme", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-storybook-light-only-"));
  const ir = createIr();

  await generateArtifacts({
    projectDir,
    ir,
    resolvedStorybookTheme: createResolvedStorybookTheme({ includeDark: false }),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const themeContent = await readFile(path.join(projectDir, "src", "theme", "theme.ts"), "utf8");
  const appContent = await readFile(path.join(projectDir, "src", "App.tsx"), "utf8");

  assert.equal(themeContent.includes("dark: {"), false);
  assert.equal(appContent.includes('data-testid="theme-mode-toggle"'), false);
  assert.equal(appContent.includes("useColorScheme"), false);
});

test("generateArtifacts applies Issue #693 customer form specializations in the storybook-first path", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-generator-issue-693-"));
  const ir = createIr();
  ir.screens[0]!.children = [
    {
      id: "dynamic-typography",
      name: "<Dynamic Typography>",
      nodeType: "TEXT",
      type: "text",
      semanticType: "Typography",
      text: "Payment Schedule",
      fontFamily: "Storybook Sans",
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
  ];
  const resolvedStorybookTheme = createResolvedStorybookTheme();
  resolvedStorybookTheme.light.typography.variants = {
    displayLg: {
      fontFamily: "Storybook Sans",
      fontSizePx: 32,
      fontWeight: 700,
      lineHeight: 40,
      letterSpacing: "0em"
    },
    bodyMd: {
      fontFamily: "Storybook Sans",
      fontSizePx: 16,
      fontWeight: 400,
      lineHeight: 24,
      letterSpacing: "0em"
    }
  };

  await generateArtifacts({
    projectDir,
    ir,
    customerProfile: createIssue693CustomerProfileForGeneratorTests(),
    customerProfileDesignSystemConfig: {
      library: "__customer_profile__",
      mappings: {
        DatePicker: {
          import: "@customer/forms",
          export: "CustomerDatePicker",
          component: "CustomerDatePicker"
        },
        InputIBAN: {
          import: "@customer/forms",
          export: "CustomerIbanInput",
          component: "CustomerIbanInput"
        },
        Typography: {
          import: "@customer/typography",
          export: "CustomerTypography",
          component: "CustomerTypography"
        }
      }
    },
    resolvedStorybookTheme,
    formHandlingMode: "react_hook_form",
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });

  const screenContent = await readFile(path.join(projectDir, toDeterministicScreenPath("Übersicht")), "utf8");

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
    /<[A-Za-z0-9_]+FormContextProvider>[\s\S]*<CustomerDatePickerProvider adapterLocale=\{"de"\} dateAdapter=\{CustomerDateAdapter\}>[\s\S]*<[A-Za-z0-9_]+ScreenContent \/>[\s\S]*<\/CustomerDatePickerProvider>[\s\S]*<\/[A-Za-z0-9_]+FormContextProvider>/
  );
  assert.equal(screenContent.includes("<TextField"), false);
});
