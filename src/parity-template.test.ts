import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const templateRoot = path.resolve(packageRoot, "template/react-mui-app");

const TEMPLATE_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "vite.config.ts",
  "tsconfig.json",
  "eslint.config.js",
  "src/App.tsx",
  "src/main.tsx",
  "src/theme/theme.ts"
] as const;

const normalize = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

const toSha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const TEMPLATE_HASH_SNAPSHOT: Record<(typeof TEMPLATE_FILES)[number], string> = {
  "package.json": "c275a6b360a1aedeabddb6dffb28f32c5761bc66a555298a96b6dbd957f2fbfa",
  "pnpm-lock.yaml": "110c397954e425f879b6cefa63c8c93a9e8c61012d9eca8ff6fdc217a5a8f4ad",
  "vite.config.ts": "b1e4685d9f2abca26f4cca73de471abd27393a9d2a34a997a1402decdf12e2ec",
  "tsconfig.json": "369ee58e34e4c0cc9835c47970cdd6ae0b445f6e3ca5bc7e0ebaa1fcc5956005",
  "eslint.config.js": "92fe7ae585f43eb52a90982c3eba9e0fa025c109ce8711ed1f290a9939190091",
  "src/App.tsx": "a125f5c96f5bc7bf4e7351ff69f80afea511622a5ad9ff1394c243aaa56cb67a",
  "src/main.tsx": "0ecc6f22a73af994d158f5afea1414f9b9259cc9fae04c4c59cb564550befaca",
  "src/theme/theme.ts": "db3d5849c0f85cc08e324eba84169ad1a3e9ea5c45652449dd41a8031550cd34"
};

test("template integrity: bundled template matches deterministic hash snapshot", async () => {
  for (const relativePath of TEMPLATE_FILES) {
    const templateContent = normalize(await readFile(path.join(templateRoot, relativePath), "utf8"));
    const actualHash = toSha256(templateContent);
    const expectedHash = TEMPLATE_HASH_SNAPSHOT[relativePath];
    assert.equal(
      actualHash,
      expectedHash,
      `Template snapshot drift detected for '${relativePath}'. If this change is intentional, update TEMPLATE_HASH_SNAPSHOT in src/parity-template.test.ts.`
    );
  }
});
