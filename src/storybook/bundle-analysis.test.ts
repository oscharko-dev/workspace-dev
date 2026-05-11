import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTopLevelFieldKeys,
  extractCssCustomPropertyDefinitions,
  extractCssCustomProperties,
  extractMdxImageSources,
  extractMdxLinks,
  extractMdxTextBlocks,
  extractStoryDesignUrls,
  hasAuthoritativeThemeFactoryMarker,
  extractThemeMarkers
} from "./bundle-analysis.js";

test("story bundle analysis extracts args, argTypes, and design links without executing code", () => {
  const storyBundle = `
    const meta = {
      title: "ReactUI/Core/Tooltip",
      args: { title: "Einfach", infos: "Ohne Infos" },
      argTypes: {
        title: { control: { type: "select" } },
        infos: { control: { type: "select" } }
      },
      parameters: {
        design: {
          type: "figma",
          url: "https://www.figma.com/design/demo"
        }
      }
    };
    const variant = {
      name: "Mit Infos",
      args: {
        infos: "Mit Infos"
      }
    };
  `;

  assert.deepEqual(collectTopLevelFieldKeys({ bundleText: storyBundle, fieldName: "args" }), ["infos", "title"]);
  assert.deepEqual(
    collectTopLevelFieldKeys({ bundleText: storyBundle, fieldName: "argTypes" }),
    ["infos", "title"]
  );
  assert.deepEqual(extractStoryDesignUrls(storyBundle), ["https://www.figma.com/design/demo"]);
});

test("MDX bundle analysis extracts links, images, and normalized text blocks", () => {
  const mdxBundle = `
    function content() {
      return e.jsxs(e.Fragment, {
        children: [
          e.jsx(h1, { children: "Color Tokens" }),
          e.jsx(p, { children: "Tokens sind Farbnamen, denen HEX-Werte zugeordnet sind." }),
          e.jsxs(p, {
            children: [
              "Weitere Details unter ",
              e.jsx("a", { href: "/docs/base-colors-sk-theme--docs", children: "SK-Theme" }),
              " sowie ",
              e.jsx("a", { href: "https://example.com/design", children: "extern" })
            ]
          }),
          e.jsx("img", { src: "static/assets/images/Base/Color_Tokens_1.png", alt: "Tokens" }),
          e.jsx(code, { children: "export const Template = () => <Chip />;" })
        ]
      });
    }
  `;

  assert.deepEqual(extractMdxLinks(mdxBundle), ["/docs/base-colors-sk-theme--docs", "https://example.com/design"]);
  assert.deepEqual(extractMdxImageSources(mdxBundle), ["static/assets/images/Base/Color_Tokens_1.png"]);
  assert.deepEqual(extractMdxTextBlocks(mdxBundle), [
    "Color Tokens",
    "extern",
    "SK-Theme",
    "Tokens sind Farbnamen, denen HEX-Werte zugeordnet sind.",
    "Weitere Details unter sowie"
  ]);
});

test("theme and css analysis only surfaces machine-readable runtime markers", () => {
  const runtimeBundle = `
    const appTheme = createTheme({ palette: { primary: { main: "#ff0000" } } });
    export const Wrapped = () => jsx(ThemeProvider, { theme: appTheme, children: jsx(App, {}) });
  `;
  const cssText = `
    :root {
      --fi-color-brand: #ff0000;
      --fi-color-surface: #ffffff;
    }
  `;

  assert.deepEqual(extractThemeMarkers(runtimeBundle), ["createTheme", "ThemeProvider"]);
  assert.equal(hasAuthoritativeThemeFactoryMarker(extractThemeMarkers(runtimeBundle)), true);
  assert.equal(hasAuthoritativeThemeFactoryMarker(["ThemeProvider"]), false);
  assert.deepEqual(extractCssCustomProperties(cssText), ["--fi-color-brand", "--fi-color-surface"]);
  assert.deepEqual(extractCssCustomPropertyDefinitions(cssText), [
    { name: "--fi-color-brand", value: "#ff0000" },
    { name: "--fi-color-surface", value: "#ffffff" }
  ]);
});

test("theme analysis recognizes minified named theme factories without widening provider-only bundles", () => {
  const minifiedThemeBundle = `
    const buildTheme = wrapper(() => helper({
      components: { MuiCssBaseline: { styleOverrides: { body: { backgroundColor: "#f0f0f0" } } } },
      palette: { primary: { main: "#ff0000" } },
      typography: { fontFamily: "SparkasseRegular" }
    }), "createCustomTheme");
    const theme = buildTheme();
    export const App = () => jsx(ThemeProvider, { theme, children: jsx("div", {}) });
  `;
  const providerOnlyBundle = `
    const wrapTheme = wrapper(() => providerValue, "createCustomTheme");
    export const App = () => jsx(ThemeProvider, { theme: providerTheme, children: jsx("div", {}) });
  `;

  assert.deepEqual(extractThemeMarkers(minifiedThemeBundle), ["createTheme", "ThemeProvider"]);
  assert.equal(hasAuthoritativeThemeFactoryMarker(extractThemeMarkers(minifiedThemeBundle)), true);
  assert.deepEqual(extractThemeMarkers(providerOnlyBundle), ["ThemeProvider"]);
  assert.equal(hasAuthoritativeThemeFactoryMarker(extractThemeMarkers(providerOnlyBundle)), false);
});

test("extractCssCustomPropertyDefinitions strips CSS comments from property values", () => {
  const cssText = `
    :root {
      --brand-color: #ff0000 /* primary brand */;
      --spacing-base: 8px /* default */ ;
      --bg-color: white /* fallback color */;
    }
  `;
  const definitions = extractCssCustomPropertyDefinitions(cssText);
  const brandColor = definitions.find((d) => d.name === "--brand-color");
  assert.equal(brandColor?.value, "#ff0000");
  const spacingBase = definitions.find((d) => d.name === "--spacing-base");
  assert.equal(spacingBase?.value, "8px");
  const bgColor = definitions.find((d) => d.name === "--bg-color");
  assert.equal(bgColor?.value, "white");
});
