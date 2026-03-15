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
  "package.json": "a165389cca07bdc5defb45346dbcace9917a9980b8b952c6bdfd86524378f3f2",
  "pnpm-lock.yaml": "3184f6ee6d03639e821e081700affe4255891191c10c34871cb86e31680a86eb",
  "vite.config.ts": "3ea49273273aeeb6abbd6477e8211a2279e21eba8b1f827444d94059484f97d9",
  "tsconfig.json": "f921bebd56ac845e889a55e8c44b804a0f70b5f51e5c221c3dd0aae7fe7cb5b0",
  "eslint.config.js": "beca62d859daf895bb540e25cb69d6a5fe6051f4c3627dabb139314c91039910",
  "perf-budget.json": "aa06e9a8708171dd36884798f08a7903b5c06b84b431cdd477e83fc3e8a93e44",
  "scripts/perf-runner.mjs": "f236d2543bd33b3cf7c0088f221091e4b1144c156ac97adf202b3fdd95e59c63",
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
