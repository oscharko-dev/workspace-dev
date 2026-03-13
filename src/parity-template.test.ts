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
  "perf-budget.json",
  "scripts/perf-runner.mjs",
  "src/App.tsx",
  "src/main.tsx",
  "src/performance/report-web-vitals.ts",
  "src/theme/theme.ts"
] as const;

const normalize = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

const toSha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const TEMPLATE_HASH_SNAPSHOT: Record<(typeof TEMPLATE_FILES)[number], string> = {
  "package.json": "6b871e33b7ab7ac806ad322e73b02b1bf209c47d1cad873e6de767980bbc565e",
  "pnpm-lock.yaml": "0201c6906f12ff329a20ad30ecc2b4b300128de33f285d60246f3e9618a7741d",
  "vite.config.ts": "b1e4685d9f2abca26f4cca73de471abd27393a9d2a34a997a1402decdf12e2ec",
  "tsconfig.json": "f921bebd56ac845e889a55e8c44b804a0f70b5f51e5c221c3dd0aae7fe7cb5b0",
  "eslint.config.js": "92fe7ae585f43eb52a90982c3eba9e0fa025c109ce8711ed1f290a9939190091",
  "perf-budget.json": "aa06e9a8708171dd36884798f08a7903b5c06b84b431cdd477e83fc3e8a93e44",
  "scripts/perf-runner.mjs": "4a074b06746828f5ef34dd7dcb5c02ff46dd3400bdfaadb3da58b7f8765e6c8f",
  "src/App.tsx": "a125f5c96f5bc7bf4e7351ff69f80afea511622a5ad9ff1394c243aaa56cb67a",
  "src/main.tsx": "b0eb6415571d137571820c60016e3e97e4f04afe8e6f1562824ff4745a3925e8",
  "src/performance/report-web-vitals.ts": "4a818db2533f3290aac059f7117beacb45cb8b604a643ad0f227ca8d3d213e5d",
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
