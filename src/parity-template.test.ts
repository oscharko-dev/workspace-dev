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

const toSemverMajor = (versionRange: string | undefined): number | undefined => {
  if (!versionRange || versionRange.trim().length === 0) {
    return undefined;
  }
  const match = versionRange.match(/(\d+)(?:\.\d+){0,2}/);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  return Number.isInteger(major) && major >= 0 ? major : undefined;
};

const TEMPLATE_HASH_SNAPSHOT: Record<(typeof TEMPLATE_FILES)[number], string> = {
  "package.json": "a165389cca07bdc5defb45346dbcace9917a9980b8b952c6bdfd86524378f3f2",
  "pnpm-lock.yaml": "3184f6ee6d03639e821e081700affe4255891191c10c34871cb86e31680a86eb",
  "vite.config.ts": "3ea49273273aeeb6abbd6477e8211a2279e21eba8b1f827444d94059484f97d9",
  "tsconfig.json": "cd2157acd03b65daacc1df910dc5f387c81ee6ed3d6fb83e768203ca43fe3a47",
  "eslint.config.js": "beca62d859daf895bb540e25cb69d6a5fe6051f4c3627dabb139314c91039910",
  "perf-budget.json": "aa06e9a8708171dd36884798f08a7903b5c06b84b431cdd477e83fc3e8a93e44",
  "scripts/perf-runner.mjs": "f236d2543bd33b3cf7c0088f221091e4b1144c156ac97adf202b3fdd95e59c63",
  "src/App.tsx": "3e2284af4c28946708128ed4feeeb643178010781a99409acc76269363a603ef",
  "src/main.tsx": "e4ab9640e86610c9e4373c8436d5845230dda0997b8ad8d02b47649599cec8f0",
  "src/performance/report-web-vitals.ts": "4a818db2533f3290aac059f7117beacb45cb8b604a643ad0f227ca8d3d213e5d",
  "src/theme/theme.ts": "6d873ec1d31aaa36bb233f2cb0df6adc0fd52bf12740e3325995a5264858be64"
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

test("template semantics: React 19 dependencies and JSX typing coverage are explicitly configured", async () => {
  const packageJson = JSON.parse(await readFile(path.join(templateRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const tsconfigJson = JSON.parse(await readFile(path.join(templateRoot, "tsconfig.json"), "utf8")) as {
    compilerOptions?: {
      jsx?: string;
      types?: string[];
    };
  };

  assert.equal(packageJson.dependencies?.react?.startsWith("^19."), true);
  assert.equal(packageJson.dependencies?.["react-dom"]?.startsWith("^19."), true);
  assert.equal(packageJson.devDependencies?.["@types/react"]?.startsWith("^19."), true);
  assert.equal(packageJson.devDependencies?.["@types/react-dom"]?.startsWith("^19."), true);

  assert.equal(tsconfigJson.compilerOptions?.jsx, "react-jsx");
  assert.equal(tsconfigJson.compilerOptions?.types?.includes("react"), true);
  assert.equal(tsconfigJson.compilerOptions?.types?.includes("react-dom"), true);
});

test("template semantics: main entry retains CssBaseline global reset", async () => {
  const mainContent = await readFile(path.join(templateRoot, "src/main.tsx"), "utf8");
  assert.match(mainContent, /import\s+CssBaseline\s+from\s+["']@mui\/material\/CssBaseline["'];?/);
  assert.match(mainContent, /import\s*\{\s*ThemeProvider\s*\}\s*from\s*["']@mui\/material\/styles["'];?/);
  assert.match(mainContent, /<ThemeProvider[^>]*defaultMode="system"[^>]*noSsr[^>]*>/);
  assert.match(mainContent, /<CssBaseline\s*\/>/);
});

test("template semantics: theme baseline ships both light and dark color schemes", async () => {
  const themeContent = await readFile(path.join(templateRoot, "src/theme/theme.ts"), "utf8");
  assert.match(themeContent, /colorSchemes:\s*\{/);
  assert.match(themeContent, /light:\s*\{/);
  assert.match(themeContent, /dark:\s*\{/);
  assert.match(themeContent, /MuiButton:\s*\{/);
});

test("template semantics: Vite baseline remains at least major 6 with React plugin wiring", async () => {
  const packageJson = JSON.parse(await readFile(path.join(templateRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  const viteConfig = await readFile(path.join(templateRoot, "vite.config.ts"), "utf8");

  const viteVersionRange = packageJson.devDependencies?.vite;
  const vitePluginVersionRange = packageJson.devDependencies?.["@vitejs/plugin-react"];
  const viteMajor = toSemverMajor(viteVersionRange);
  const vitePluginMajor = toSemverMajor(vitePluginVersionRange);

  assert.notEqual(viteMajor, undefined, `Unable to parse Vite version range '${viteVersionRange ?? ""}'`);
  assert.notEqual(
    vitePluginMajor,
    undefined,
    `Unable to parse @vitejs/plugin-react version range '${vitePluginVersionRange ?? ""}'`
  );
  assert.equal((viteMajor ?? 0) >= 6, true, `Expected vite major >= 6, received '${viteVersionRange ?? ""}'`);
  assert.equal(
    (vitePluginMajor ?? 0) >= 6,
    true,
    `Expected @vitejs/plugin-react major >= 6, received '${vitePluginVersionRange ?? ""}'`
  );

  assert.match(viteConfig, /from\s+["']vite["']/);
  assert.match(viteConfig, /\bdefineConfig\b/);
  assert.match(viteConfig, /\breact\s*\(/);
});
