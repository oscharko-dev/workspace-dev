import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const loadThemeModule = async (salt: string) => {
  const modulePath = path.resolve("/Users/oscharko/PycharmProjects/intent/workspace-dev/src/parity/sparkasse-theme.ts");
  return await import(`${pathToFileURL(modulePath).href}?case=${salt}`);
};

test("sparkasse theme falls back to defaults when token file is missing", async () => {
  process.env.BRAND_TOKENS_FILE = "/definitely/missing/sparkasse-tokens.json";
  const mod = await loadThemeModule("missing");

  const defaults = mod.getSparkasseThemeDefaults();
  assert.equal(defaults.palette.primary, "#EE0000");
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
        system: { "success-alt": { $value: "#22aa44" } },
        neutral: {
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
  assert.equal(defaults.borderRadius, 14);
  assert.equal(defaults.spacingBase, 10);
  assert.equal(defaults.headingSize, 30);
  assert.equal(defaults.bodySize, 15);

  const applied = mod.applySparkasseThemeDefaults({
    palette: {
      primary: "#999999",
      secondary: "#112233",
      background: "#ffffff",
      text: "#000000"
    },
    borderRadius: 1,
    spacingBase: 1,
    fontFamily: "MyFont",
    headingSize: 20,
    bodySize: 12
  });

  assert.equal(applied.palette.primary, "#001122");
  assert.equal(applied.palette.secondary, "#112233");
  assert.equal(applied.borderRadius, 14);
  assert.equal(applied.spacingBase, 10);
  assert.ok(applied.fontFamily.includes("Roboto"));
});
