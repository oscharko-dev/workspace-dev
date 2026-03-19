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
  "src/test/jest-axe.d.ts",
  "src/test/setup.ts",
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
  "package.json": "f3a553a7cfd3b686b1fcaaa7ec886a50833e90679c3ffeed7ae0a317e0b898e1",
  "pnpm-lock.yaml": "a87b078b32155517ac5ada7ddc39e4375448a528276b2abcfedd0db1fc854dd5",
  "vite.config.ts": "a3351eadcec4c2c02d5ed40c7bf155d274bf35c583bc34a4e9a2424f9f73df11",
  "tsconfig.json": "46145f2477e39d3f2d7048e04a23afbb24b9c529981a8d37dbac09faea5bb808",
  "eslint.config.js": "beca62d859daf895bb540e25cb69d6a5fe6051f4c3627dabb139314c91039910",
  "perf-budget.json": "aa06e9a8708171dd36884798f08a7903b5c06b84b431cdd477e83fc3e8a93e44",
  "scripts/perf-runner.mjs": "f236d2543bd33b3cf7c0088f221091e4b1144c156ac97adf202b3fdd95e59c63",
  "src/App.tsx": "3e2284af4c28946708128ed4feeeb643178010781a99409acc76269363a603ef",
  "src/main.tsx": "e4ab9640e86610c9e4373c8436d5845230dda0997b8ad8d02b47649599cec8f0",
  "src/performance/report-web-vitals.ts": "4a818db2533f3290aac059f7117beacb45cb8b604a643ad0f227ca8d3d213e5d",
  "src/test/jest-axe.d.ts": "078c99e9f30e0e2b4eae659114cbfb826321e5dc4bd6dbe93d1a2a22515a41eb",
  "src/test/setup.ts": "ddb53f127ab6a95a831510013d8b7dee6dc8fe377cce8187af4e3f19ad2704ff",
  "src/theme/theme.ts": "5d5c1a83ea21a626cf1e9047ea4c60a2f2e3377cf71d36daf0f943242a964c75"
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
  assert.match(themeContent, /cssVariables:\s*true/);
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

  assert.match(viteConfig, /from\s+["']vitest\/config["']/);
  assert.match(viteConfig, /\bdefineConfig\b/);
  assert.match(viteConfig, /\breact\s*\(/);
});

test("template semantics: unit-test toolchain is wired for Vitest + Testing Library + jest-axe", async () => {
  const packageJson = JSON.parse(await readFile(path.join(templateRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const tsconfigJson = JSON.parse(await readFile(path.join(templateRoot, "tsconfig.json"), "utf8")) as {
    compilerOptions?: {
      types?: string[];
    };
  };
  const viteConfig = await readFile(path.join(templateRoot, "vite.config.ts"), "utf8");
  const setupFile = await readFile(path.join(templateRoot, "src/test/setup.ts"), "utf8");
  const axeTypesFile = await readFile(path.join(templateRoot, "src/test/jest-axe.d.ts"), "utf8");

  assert.equal(packageJson.scripts?.test, "vitest run");
  assert.equal(packageJson.scripts?.["test:watch"], "vitest");
  assert.equal(packageJson.devDependencies?.vitest !== undefined, true);
  assert.equal(packageJson.devDependencies?.jsdom !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@testing-library/react"] !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@testing-library/jest-dom"] !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@testing-library/user-event"] !== undefined, true);
  assert.equal(packageJson.devDependencies?.["jest-axe"] !== undefined, true);

  assert.match(viteConfig, /test:\s*\{/);
  assert.match(viteConfig, /environment:\s*["']jsdom["']/);
  assert.match(viteConfig, /setupFiles:\s*["']\.\/src\/test\/setup\.ts["']/);
  assert.equal(tsconfigJson.compilerOptions?.types?.includes("vitest/globals"), true);

  assert.match(setupFile, /@testing-library\/jest-dom\/vitest/);
  assert.match(setupFile, /toHaveNoViolations/);
  assert.match(setupFile, /expect\.extend/);
  assert.match(axeTypesFile, /toHaveNoViolations/);
});
