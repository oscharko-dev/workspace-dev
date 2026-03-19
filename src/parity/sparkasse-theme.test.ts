import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const loadThemeModule = async (salt: string) => {
  const modulePath = path.resolve(MODULE_DIR, "sparkasse-theme.ts");
  return await import(`${pathToFileURL(modulePath).href}?case=${salt}`);
};

test("sparkasse theme falls back to defaults when token file is missing", async () => {
  process.env.BRAND_TOKENS_FILE = "/definitely/missing/sparkasse-tokens.json";
  const mod = await loadThemeModule("missing");

  const defaults = mod.getSparkasseThemeDefaults();
  assert.equal(defaults.palette.primary, "#EE0000");
  assert.equal(defaults.palette.info, "#0288D1");
  assert.equal(defaults.palette.action.focus, "#EE00001f");
  assert.equal(defaults.spacingBase, 8);
});

test("sparkasse theme loads configured token file and applies fallback-safe typography", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-sparkasse-"));
  const tokensFile = path.join(tempDir, "tokens.json");

  await writeFile(
    tokensFile,
    JSON.stringify({
      color: {
        brand: { primary: { $value: "#001122" } },
        system: {
          "success-alt": { $value: "#22aa44" },
          success: { $value: "#11bb55" },
          warning: { $value: "#cc8800" },
          error: { $value: "#bb2233" },
          info: { $value: "#2277dd" }
        },
        neutral: {
          "gray-200": { $value: "#d4d7db" },
          "gray-50": { $value: "#f4f5f6" },
          "gray-900": { $value: "#121212" }
        }
      },
      borderRadius: { lg: { $value: 14 } },
      spacing: { xs: { $value: 10 } },
      typography: {
        fontFamily: { regular: { $value: "SparkasseCustom" } },
        fontSize: {
          "2xl": { $value: 30 },
          md: { $value: 15 }
        },
        variants: {
          h2: {
            fontSize: { $value: 26 },
            fontWeight: { $value: 700 },
            lineHeight: { $value: 34 }
          },
          button: {
            fontSize: { $value: 15 },
            fontWeight: { $value: 600 },
            lineHeight: { $value: 22 },
            textTransform: { $value: "none" }
          },
          overline: {
            fontSize: { $value: 12 },
            lineHeight: { $value: 18 },
            letterSpacing: { $value: 0.12 }
          }
        }
      }
    }),
    "utf8"
  );

  process.env.BRAND_TOKENS_FILE = tokensFile;
  const mod = await loadThemeModule("configured");

  const defaults = mod.getSparkasseThemeDefaults();
  assert.equal(defaults.palette.primary, "#001122");
  assert.equal(defaults.palette.secondary, "#22aa44");
  assert.equal(defaults.palette.background, "#f4f5f6");
  assert.equal(defaults.palette.text, "#121212");
  assert.equal(defaults.palette.success, "#11bb55");
  assert.equal(defaults.palette.warning, "#cc8800");
  assert.equal(defaults.palette.error, "#bb2233");
  assert.equal(defaults.palette.info, "#2277dd");
  assert.equal(defaults.palette.divider, "#d4d7db");
  assert.equal(defaults.palette.action.active, "#1212128a");
  assert.equal(defaults.borderRadius, 14);
  assert.equal(defaults.spacingBase, 10);
  assert.equal(defaults.headingSize, 30);
  assert.equal(defaults.bodySize, 15);
  assert.equal(defaults.typography.h2.fontSizePx, 26);
  assert.equal(defaults.typography.button.textTransform, "none");
  assert.equal(defaults.typography.overline.letterSpacingEm, 0.12);

  const applied = mod.applySparkasseThemeDefaults({
    palette: {
      primary: "#999999",
      secondary: "#112233",
      background: "#ffffff",
      text: "#000000",
      success: "#00ff00",
      warning: "#ffaa00",
      error: "#ff0000",
      info: "#00aaff",
      divider: "#eeeeee",
      action: {
        active: "#0000008a",
        hover: "#9999990a",
        selected: "#99999914",
        disabled: "#00000042",
        disabledBackground: "#0000001f",
        focus: "#9999991f"
      }
    },
    borderRadius: 1,
    spacingBase: 1,
    fontFamily: "MyFont",
    headingSize: 20,
    bodySize: 12,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "MyFont",
      headingSize: 20,
      bodySize: 12
    })
  });

  assert.equal(applied.palette.primary, "#001122");
  assert.equal(applied.palette.secondary, "#112233");
  assert.equal(applied.palette.background, "#f4f5f6");
  assert.equal(applied.palette.text, "#121212");
  assert.equal(applied.palette.success, "#11bb55");
  assert.equal(applied.palette.warning, "#cc8800");
  assert.equal(applied.palette.error, "#bb2233");
  assert.equal(applied.palette.info, "#2277dd");
  assert.equal(applied.palette.divider, "#d4d7db");
  assert.equal(applied.palette.action.focus, "#0011221f");
  assert.equal(applied.borderRadius, 14);
  assert.equal(applied.spacingBase, 10);
  assert.ok(applied.fontFamily.includes("Roboto"));
  assert.equal(applied.headingSize, 30);
  assert.equal(applied.bodySize, 15);
  assert.equal(applied.typography.h2.fontSizePx, 26);
  assert.equal(applied.typography.button.textTransform, "none");
  assert.equal(applied.typography.overline.letterSpacingEm, 0.12);
});
