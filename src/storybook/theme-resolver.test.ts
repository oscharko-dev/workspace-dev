import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerProfileConfig } from "../customer-profile.js";
import { resolveStorybookTheme } from "./theme-resolver.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY, type StorybookPublicThemesArtifact, type StorybookPublicTokensArtifact } from "./types.js";

const createCustomerProfile = () => {
  const profile = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [],
      brandMappings: [
        {
          id: "sparkasse-retail",
          aliases: ["sparkasse-retail", "sk"],
          brandTheme: "sparkasse",
          storybookThemes: {
            light: "sparkasse-light",
            dark: "sparkasse-dark"
          }
        },
        {
          id: "sparkasse-light-only",
          aliases: ["sparkasse-light-only"],
          brandTheme: "sparkasse",
          storybookThemes: {
            light: "sparkasse-light"
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
        dependencies: {}
      },
      strictness: {
        match: "warn",
        token: "warn",
        import: "warn"
      }
    }
  });
  if (!profile) {
    throw new Error("Failed to build customer profile fixture.");
  }
  return profile;
};

const createTokensArtifact = ({
  includeDark = true,
  includeBackgroundPaper = true,
  includeReferenceOnlyNoise = false
}: {
  includeDark?: boolean;
  includeBackgroundPaper?: boolean;
  includeReferenceOnlyNoise?: boolean;
} = {}): StorybookPublicTokensArtifact => {
  const provenance = includeReferenceOnlyNoise
    ? {
        color: [
          {
            type: "docs_text",
            reliability: "reference_only",
            title: "Theme Docs"
          }
        ]
      }
    : {};

  return {
    $schema: "https://www.designtokens.org/TR/2025.10/format/",
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.tokens",
        version: 3,
        stats: {
          tokenCount: 0,
          themeCount: includeDark ? 2 : 1,
          byType: {
            color: 0,
            dimension: 0,
            fontFamily: 0,
            fontWeight: 0,
            number: 0,
            typography: 0
          },
          diagnosticCount: 0,
          errorCount: 0
        },
        diagnostics: [],
        themes: [
          { id: "sparkasse-dark", name: "Sparkasse Dark", context: "dark", categories: ["dark"], tokenCount: 0 },
          { id: "sparkasse-light", name: "Sparkasse Light", context: "default", categories: ["light"], tokenCount: 0 }
        ],
        provenance
      }
    },
    theme: {
      "sparkasse-light": {
        color: {
          primary: {
            main: { $type: "color", $value: "#dd0000" },
            "contrast-text": { $type: "color", $value: "#ffffff" }
          },
          secondary: {
            main: { $type: "color", $value: "#0055aa" }
          },
          text: {
            primary: { $type: "color", $value: "#222222" }
          },
          background: {
            default: { $type: "color", $value: "#fafafa" },
            ...(includeBackgroundPaper
              ? {
                  paper: { $type: "color", $value: "#ffffff" }
                }
              : {})
          },
          divider: { $type: "color", $value: "#dddddd" },
          action: {
            hover: { $type: "color", $value: "#eeeeee" }
          },
          components: {
            "mui-app-bar": {
              "style-overrides": {
                root: {
                  "background-color": { $type: "color", $value: "#aa0000" }
                }
              }
            }
          }
        },
        spacing: {
          base: { $type: "dimension", $value: { value: 8, unit: "px" } },
          components: {
            "mui-button": {
              "style-overrides": {
                root: {
                  padding: { $type: "dimension", $value: { value: 12, unit: "px" } }
                }
              }
            }
          }
        },
        radius: {
          shape: {
            "border-radius": { $type: "dimension", $value: { value: 12, unit: "px" } }
          },
          components: {
            "mui-card": {
              "style-overrides": {
                root: {
                  "border-radius": { $type: "dimension", $value: { value: 18, unit: "px" } }
                }
              }
            }
          }
        },
        typography: {
          base: {
            $type: "typography",
            $value: {
              fontFamily: "{font.family.brand-sans}",
              fontSize: { value: 16, unit: "px" },
              fontWeight: 400,
              lineHeight: 1.5
            }
          },
          h1: {
            $type: "typography",
            $value: {
              fontFamily: "{font.family.brand-sans}",
              fontSize: { value: 32, unit: "px" },
              fontWeight: 700,
              lineHeight: 1.2
            }
          },
          components: {
            "mui-button": {
              "style-overrides": {
                root: {
                  $type: "typography",
                  $value: {
                    textTransform: "none"
                  }
                }
              }
            }
          }
        }
      },
      ...(includeDark
        ? {
            "sparkasse-dark": {
              color: {
                primary: {
                  main: { $type: "color", $value: "#ff6666" },
                  "contrast-text": { $type: "color", $value: "#111111" }
                },
                text: {
                  primary: { $type: "color", $value: "#f5f5f5" }
                },
                background: {
                  default: { $type: "color", $value: "#121212" },
                  paper: { $type: "color", $value: "#1f1f1f" }
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
                    fontFamily: "{font.family.brand-sans}",
                    fontSize: { value: 16, unit: "px" },
                    fontWeight: 400,
                    lineHeight: 1.5
                  }
                }
              }
            }
          }
        : {})
    },
    font: {
      family: {
        "brand-sans": {
          $type: "fontFamily",
          $value: "Brand Sans"
        }
      }
    }
  };
};

const createThemesArtifact = ({
  includeDark = true
}: {
  includeDark?: boolean;
} = {}): StorybookPublicThemesArtifact => {
  return {
    $schema: "https://www.designtokens.org/TR/2025.10/resolver/",
    name: "storybook.themes",
    version: "2025.10",
    sets: {
      "sparkasse-light": {
        sources: [{ $ref: "./tokens.json#/theme/sparkasse-light" }]
      },
      ...(includeDark
        ? {
            "sparkasse-dark": {
              sources: [{ $ref: "./tokens.json#/theme/sparkasse-dark" }]
            }
          }
        : {})
    },
    modifiers: {
      theme: {
        default: "default",
        contexts: {
          default: [{ $ref: "#/sets/sparkasse-light" }],
          ...(includeDark ? { dark: [{ $ref: "#/sets/sparkasse-dark" }] } : {})
        }
      }
    },
    resolutionOrder: [{ $ref: "#/modifiers/theme" }],
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.themes",
        version: 3,
        stats: {
          themeCount: includeDark ? 2 : 1,
          contextCount: includeDark ? 2 : 1,
          diagnosticCount: 0,
          errorCount: 0
        },
        diagnostics: [],
        themes: [
          ...(includeDark ? [{ id: "sparkasse-dark", name: "Sparkasse Dark", context: "dark", categories: ["dark"], tokenCount: 0 }] : []),
          { id: "sparkasse-light", name: "Sparkasse Light", context: "default", categories: ["light"], tokenCount: 0 }
        ],
        provenance: {}
      }
    }
  };
};

test("resolveStorybookTheme resolves a valid light-only brand mapping", () => {
  const resolved = resolveStorybookTheme({
    customerBrandId: "sparkasse-light-only",
    customerProfile: createCustomerProfile(),
    tokensArtifact: createTokensArtifact({ includeDark: false }),
    themesArtifact: createThemesArtifact({ includeDark: false })
  });

  assert.equal(resolved.brandMappingId, "sparkasse-light-only");
  assert.equal(resolved.includeThemeModeToggle, false);
  assert.equal(resolved.dark, undefined);
  assert.equal(resolved.light.palette.primary.main, "#dd0000");
  assert.equal(resolved.light.typography.fontFamily, "Brand Sans");
});

test("resolveStorybookTheme normalizes typography font-family arrays from Storybook token artifacts", () => {
  const tokensArtifact = createTokensArtifact({ includeDark: false });
  tokensArtifact.theme["sparkasse-light"].typography.base.$value.fontFamily = ["Brand Sans", "sans-serif"];

  const resolved = resolveStorybookTheme({
    customerBrandId: "sparkasse-light-only",
    customerProfile: createCustomerProfile(),
    tokensArtifact,
    themesArtifact: createThemesArtifact({ includeDark: false })
  });

  assert.equal(resolved.light.typography.fontFamily, "Brand Sans, sans-serif");
  assert.equal(resolved.light.typography.base.fontFamily, "Brand Sans, sans-serif");
});

test("resolveStorybookTheme resolves a valid light and dark brand mapping and keeps component defaults Storybook-first", () => {
  const resolved = resolveStorybookTheme({
    customerBrandId: "sk",
    customerProfile: createCustomerProfile(),
    tokensArtifact: createTokensArtifact(),
    themesArtifact: createThemesArtifact()
  });

  assert.equal(resolved.brandMappingId, "sparkasse-retail");
  assert.equal(resolved.includeThemeModeToggle, true);
  assert.equal(resolved.light.palette.primary.contrastText, "#ffffff");
  assert.equal(resolved.dark?.palette.background.default, "#121212");
  assert.equal(resolved.light.components.MuiButton?.rootStyleOverrides?.padding, "12px");
  assert.equal(resolved.light.components.MuiButton?.rootStyleOverrides?.textTransform, "none");
  assert.equal(resolved.light.components.MuiAppBar?.rootStyleOverrides?.backgroundColor, "#aa0000");
  assert.equal(resolved.tokensDocument.light.themeId, "sparkasse-light");
});

test("resolveStorybookTheme fails hard when the selected brand mapping is missing", () => {
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "missing-brand",
        customerProfile: createCustomerProfile(),
        tokensArtifact: createTokensArtifact(),
        themesArtifact: createThemesArtifact()
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_BRAND_MAPPING_MISSING"
  );
});

test("resolveStorybookTheme fails hard when the selected Storybook theme id is missing from storybook.themes", () => {
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "sparkasse-retail",
        customerProfile: createCustomerProfile(),
        tokensArtifact: createTokensArtifact(),
        themesArtifact: createThemesArtifact({ includeDark: false })
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_SET_MISSING"
  );
});

test("resolveStorybookTheme fails hard when a required theme token surface is missing", () => {
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "sparkasse-light-only",
        customerProfile: createCustomerProfile(),
        tokensArtifact: createTokensArtifact({ includeDark: false, includeBackgroundPaper: false }),
        themesArtifact: createThemesArtifact({ includeDark: false })
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_STORYBOOK_THEME_REQUIRED_TOKEN_MISSING" || error.code === "E_STORYBOOK_THEME_REQUIRED_TOKEN_INVALID"
  );
});

test("resolveStorybookTheme ignores reference-only Storybook evidence metadata during value resolution", () => {
  const resolved = resolveStorybookTheme({
    customerBrandId: "sparkasse-light-only",
    customerProfile: createCustomerProfile(),
    tokensArtifact: createTokensArtifact({ includeDark: false, includeReferenceOnlyNoise: true }),
    themesArtifact: createThemesArtifact({ includeDark: false })
  });

  assert.equal(resolved.light.palette.primary.main, "#dd0000");
  assert.equal(resolved.light.typography.fontFamily, "Brand Sans");
});

test("resolveStorybookTheme fails hard when customerBrandId is missing", () => {
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: undefined,
        customerProfile: createCustomerProfile(),
        tokensArtifact: createTokensArtifact(),
        themesArtifact: createThemesArtifact()
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_CUSTOMER_BRAND_REQUIRED"
  );
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "   ",
        customerProfile: createCustomerProfile(),
        tokensArtifact: createTokensArtifact(),
        themesArtifact: createThemesArtifact()
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_CUSTOMER_BRAND_REQUIRED"
  );
});

test("resolveStorybookTheme fails hard when customerProfile is missing", () => {
  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "sparkasse-retail",
        customerProfile: undefined,
        tokensArtifact: createTokensArtifact(),
        themesArtifact: createThemesArtifact()
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_CUSTOMER_PROFILE_REQUIRED"
  );
});

test("resolveStorybookTheme fails hard when storybook tokens do not contain the selected theme", () => {
  const tokensArtifact = createTokensArtifact({ includeDark: false });
  // Remove the light theme token data entirely
  delete (tokensArtifact.theme as Record<string, unknown>)["sparkasse-light"];

  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "sparkasse-light-only",
        customerProfile: createCustomerProfile(),
        tokensArtifact,
        themesArtifact: createThemesArtifact({ includeDark: false })
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_TOKEN_SET_MISSING"
  );
});

test("resolveStorybookTheme fails hard on cyclic token alias references", () => {
  const tokensArtifact = createTokensArtifact({ includeDark: false });
  // Create a cycle: primary.main references itself via an alias chain
  tokensArtifact.theme["sparkasse-light"].color.primary.main = {
    $type: "color",
    $value: "{theme.sparkasse-light.color.primary.main}"
  };

  assert.throws(
    () =>
      resolveStorybookTheme({
        customerBrandId: "sparkasse-light-only",
        customerProfile: createCustomerProfile(),
        tokensArtifact,
        themesArtifact: createThemesArtifact({ includeDark: false })
      }),
    (error: Error & { code?: string }) => error.code === "E_STORYBOOK_THEME_ALIAS_CYCLE"
  );
});
