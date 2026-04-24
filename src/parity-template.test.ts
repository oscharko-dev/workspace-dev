import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
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
  "src/components/ErrorBoundary.tsx",
  "src/components/RouteSkeleton.tsx",
  "src/main.tsx",
  "src/performance/report-web-vitals.ts",
  "src/performance/resource-hints.ts",
  "src/performance/runtime-errors.ts",
  "src/vite-env.d.ts",
  "src/routes/CheckoutRoute.tsx",
  "src/routes/HomeRoute.tsx",
  "src/routes/OverviewRoute.tsx",
  "src/routes/lazy-routes.ts",
  "src/test/jest-axe.d.ts",
  "src/test/setup.ts",
  "src/theme/theme.ts",
] as const;

const normalize = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

const toSha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const toSemverMajor = (
  versionRange: string | undefined,
): number | undefined => {
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

const TEMPLATE_HASH_SNAPSHOT: Record<(typeof TEMPLATE_FILES)[number], string> =
  {
    "package.json":
      "83bddf0bfa3525df5b5ab36f774dd4b60393bdc590301119723107519c44c2a6",
    "pnpm-lock.yaml":
      "8a53aa05e138ec3dfee591d879aaa6df0b9c90b29d079ccb1f5f8158fc0344cc",
    "vite.config.ts":
      "7afffdfa2dc74d6306cd107d1f1410621755f50702b4c9374ed0a40c80241d05",
    "tsconfig.json":
      "46145f2477e39d3f2d7048e04a23afbb24b9c529981a8d37dbac09faea5bb808",
    "eslint.config.js":
      "5c8adc94a29be71c2124aed12738dc5497d844db2225c986b2b1ec5401cbe684",
    "perf-budget.json":
      "aa06e9a8708171dd36884798f08a7903b5c06b84b431cdd477e83fc3e8a93e44",
    "scripts/perf-runner.mjs":
      "8b4f390b32a0e2866b2a4104344a4d4bd63e53afd414033ca02aa343c96277f8",
    "src/App.tsx":
      "985cdba983fb04d56e28ea58102b9691fb912f0eb3412feab1f0bb7966332a65",
    "src/components/ErrorBoundary.tsx":
      "52ce535a42ceaa79e6f8dcf82ae25ea5ac341532cabfeeaff60c2ec4427377b1",
    "src/components/RouteSkeleton.tsx":
      "f4b4bf51d5f362b2ed7e2fb826677c3202970ee71099fddfd49132e6a6f2473d",
    "src/main.tsx":
      "0c851c4821d6f502f31ee1535902b01ffc20ee9c3c426bb0a01b9ce09bb1fbe9",
    "src/performance/report-web-vitals.ts":
      "2614da9f5cfb572e63eb9500fb8b882c37097813753b91ab68d726221f82f767",
    "src/performance/resource-hints.ts":
      "d955f9f50c78b51cb4914dccb54260df51b36587de43a7d6bc72add613555986",
    "src/performance/runtime-errors.ts":
      "11d976b471a714fb20562372de868be9dc65a17a818639bfcf484c68db81012b",
    "src/vite-env.d.ts":
      "dff9f1cbbb0559e21d251fbab9fbebcbfac51f241cf508b1bc2d04bc7c20ed80",
    "src/routes/CheckoutRoute.tsx":
      "d5892642a879e35e61f94b5656a5bcfce510fd50ec80454d7ebcf51ea6f0aeb2",
    "src/routes/HomeRoute.tsx":
      "544beb926180c66148acc098c860f2218c2ae4383aa6fe4f6b5cc9f32d2fbc81",
    "src/routes/OverviewRoute.tsx":
      "b8cff03d3a82bf9d9697d7e2876d1ffb97a55de6b46d460ec001822d60f7f599",
    "src/routes/lazy-routes.ts":
      "f4b9ca60f8ceecb1faa424b7fd1911b3f99c90fafddda1e1ef4dac910d92316f",
    "src/test/jest-axe.d.ts":
      "078c99e9f30e0e2b4eae659114cbfb826321e5dc4bd6dbe93d1a2a22515a41eb",
    "src/test/setup.ts":
      "ddb53f127ab6a95a831510013d8b7dee6dc8fe377cce8187af4e3f19ad2704ff",
    "src/theme/theme.ts":
      "2964ea672f2131bc10cb57a88bd1a40ad98d0bccc1a93e11c8ee61f2e6f2307d",
  };

test("template integrity: bundled template matches deterministic hash snapshot", async () => {
  for (const relativePath of TEMPLATE_FILES) {
    const templateContent = normalize(
      await readFile(path.join(templateRoot, relativePath), "utf8"),
    );
    const actualHash = toSha256(templateContent);
    const expectedHash = TEMPLATE_HASH_SNAPSHOT[relativePath];
    assert.equal(
      actualHash,
      expectedHash,
      `Template snapshot drift detected for '${relativePath}'. If this change is intentional, update TEMPLATE_HASH_SNAPSHOT in src/parity-template.test.ts.`,
    );
  }
});

test("template semantics: React 19 dependencies and JSX typing coverage are explicitly configured", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(templateRoot, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const tsconfigJson = JSON.parse(
    await readFile(path.join(templateRoot, "tsconfig.json"), "utf8"),
  ) as {
    compilerOptions?: {
      jsx?: string;
      types?: string[];
    };
  };

  assert.equal(packageJson.dependencies?.react?.startsWith("^19."), true);
  assert.equal(
    packageJson.dependencies?.["react-dom"]?.startsWith("^19."),
    true,
  );
  assert.equal(
    packageJson.devDependencies?.["@types/react"]?.startsWith("^19."),
    true,
  );
  assert.equal(
    packageJson.devDependencies?.["@types/react-dom"]?.startsWith("^19."),
    true,
  );

  assert.equal(tsconfigJson.compilerOptions?.jsx, "react-jsx");
  assert.equal(tsconfigJson.compilerOptions?.types?.includes("react"), true);
  assert.equal(
    tsconfigJson.compilerOptions?.types?.includes("react-dom"),
    true,
  );
});

test("template semantics: main entry retains CssBaseline global reset", async () => {
  const mainContent = await readFile(
    path.join(templateRoot, "src/main.tsx"),
    "utf8",
  );
  assert.match(
    mainContent,
    /import\s+CssBaseline\s+from\s+["']@mui\/material\/CssBaseline["'];?/,
  );
  assert.match(
    mainContent,
    /import\s*\{\s*ThemeProvider\s*\}\s*from\s*["']@mui\/material\/styles["'];?/,
  );
  assert.match(
    mainContent,
    /<ThemeProvider[^>]*defaultMode="system"[^>]*noSsr[^>]*>/,
  );
  assert.match(mainContent, /<CssBaseline\s*\/>/);
});

test("template semantics: theme baseline ships both light and dark color schemes", async () => {
  const themeContent = await readFile(
    path.join(templateRoot, "src/theme/theme.ts"),
    "utf8",
  );
  assert.match(themeContent, /extendTheme\s*\(\s*\{/);
  assert.match(themeContent, /colorSchemes:\s*\{/);
  assert.match(themeContent, /light:\s*\{/);
  assert.match(themeContent, /dark:\s*\{/);
  assert.match(themeContent, /MuiButton:\s*\{/);
});

test("template semantics: Vite baseline remains at least major 6 with React plugin wiring", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(templateRoot, "package.json"), "utf8"),
  ) as {
    devDependencies?: Record<string, string>;
  };
  const viteConfig = await readFile(
    path.join(templateRoot, "vite.config.ts"),
    "utf8",
  );

  const viteVersionRange = packageJson.devDependencies?.vite;
  const vitePluginVersionRange =
    packageJson.devDependencies?.["@vitejs/plugin-react"];
  const viteMajor = toSemverMajor(viteVersionRange);
  const vitePluginMajor = toSemverMajor(vitePluginVersionRange);

  assert.notEqual(
    viteMajor,
    undefined,
    `Unable to parse Vite version range '${viteVersionRange ?? ""}'`,
  );
  assert.notEqual(
    vitePluginMajor,
    undefined,
    `Unable to parse @vitejs/plugin-react version range '${vitePluginVersionRange ?? ""}'`,
  );
  assert.equal(
    (viteMajor ?? 0) >= 6,
    true,
    `Expected vite major >= 6, received '${viteVersionRange ?? ""}'`,
  );
  assert.equal(
    (vitePluginMajor ?? 0) >= 6,
    true,
    `Expected @vitejs/plugin-react major >= 6, received '${vitePluginVersionRange ?? ""}'`,
  );

  assert.match(viteConfig, /from\s+["']vitest\/config["']/);
  assert.match(viteConfig, /\bdefineConfig\b/);
  assert.match(viteConfig, /\breact\s*\(/);
  assert.match(
    viteConfig,
    /VITE_REACT_COMPILER_TARGET=18\|19|reactCompilerTarget === "19"/,
  );
});

test("template semantics: unit-test toolchain is wired for Vitest + Testing Library + jest-axe", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(templateRoot, "package.json"), "utf8"),
  ) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const tsconfigJson = JSON.parse(
    await readFile(path.join(templateRoot, "tsconfig.json"), "utf8"),
  ) as {
    compilerOptions?: {
      types?: string[];
    };
  };
  const viteConfig = await readFile(
    path.join(templateRoot, "vite.config.ts"),
    "utf8",
  );
  const setupFile = await readFile(
    path.join(templateRoot, "src/test/setup.ts"),
    "utf8",
  );
  const axeTypesFile = await readFile(
    path.join(templateRoot, "src/test/jest-axe.d.ts"),
    "utf8",
  );

  assert.equal(packageJson.scripts?.test, "vitest run");
  assert.equal(packageJson.scripts?.["test:watch"], "vitest");
  assert.equal(packageJson.devDependencies?.vitest !== undefined, true);
  assert.equal(packageJson.devDependencies?.jsdom !== undefined, true);
  assert.equal(
    packageJson.devDependencies?.["@testing-library/react"] !== undefined,
    true,
  );
  assert.equal(
    packageJson.devDependencies?.["@testing-library/jest-dom"] !== undefined,
    true,
  );
  assert.equal(
    packageJson.devDependencies?.["@testing-library/user-event"] !== undefined,
    true,
  );
  assert.equal(packageJson.devDependencies?.["jest-axe"] !== undefined, true);

  assert.match(viteConfig, /test:\s*\{/);
  assert.match(viteConfig, /environment:\s*["']jsdom["']/);
  assert.match(viteConfig, /setupFiles:\s*["']\.\/src\/test\/setup\.ts["']/);
  assert.equal(
    tsconfigJson.compilerOptions?.types?.includes("vitest/globals"),
    true,
  );

  assert.match(setupFile, /@testing-library\/jest-dom\/vitest/);
  assert.match(setupFile, /toHaveNoViolations/);
  assert.match(setupFile, /expect\.extend/);
  assert.match(axeTypesFile, /toHaveNoViolations/);
});

test("template semantics: routed seed app exercises lazy secondary routes and perf route coverage", async () => {
  const appContent = await readFile(
    path.join(templateRoot, "src/App.tsx"),
    "utf8",
  );
  const perfBudget = JSON.parse(
    await readFile(path.join(templateRoot, "perf-budget.json"), "utf8"),
  ) as {
    routes?: string[];
  };

  assert.match(appContent, /HashRouter/);
  assert.match(appContent, /LazyOverviewRoute/);
  assert.match(appContent, /LazyCheckoutRoute/);
  assert.match(appContent, /warmRouteModule/);
  assert.equal(perfBudget.routes?.join(","), "/,/overview,/checkout");
});

test("template semantics: main entry wires resource hints, root error callbacks, and vitals reporting", async () => {
  const mainContent = await readFile(
    path.join(templateRoot, "src/main.tsx"),
    "utf8",
  );
  const resourceHintContent = await readFile(
    path.join(templateRoot, "src/performance/resource-hints.ts"),
    "utf8",
  );
  const runtimeErrorContent = await readFile(
    path.join(templateRoot, "src/performance/runtime-errors.ts"),
    "utf8",
  );
  const vitalsContent = await readFile(
    path.join(templateRoot, "src/performance/report-web-vitals.ts"),
    "utf8",
  );

  assert.match(mainContent, /applyRuntimeResourceHints/);
  assert.match(
    mainContent,
    /createRoot\(rootElement,\s*createRootErrorHandlers\(\)\)/,
  );
  assert.match(resourceHintContent, /prefetchDNS/);
  assert.match(resourceHintContent, /preconnect/);
  assert.match(runtimeErrorContent, /onCaughtError/);
  assert.match(runtimeErrorContent, /onUncaughtError/);
  assert.match(vitalsContent, /onCLS/);
  assert.match(vitalsContent, /onINP/);
  assert.match(vitalsContent, /onLCP/);
  assert.match(vitalsContent, /onFCP/);
  assert.match(vitalsContent, /onTTFB/);
});

test("template semantics: eslint config includes react compiler enforcement", async () => {
  const eslintConfig = await readFile(
    path.join(templateRoot, "eslint.config.js"),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(path.join(templateRoot, "package.json"), "utf8"),
  ) as {
    devDependencies?: Record<string, string>;
  };

  assert.equal(
    packageJson.devDependencies?.["eslint-plugin-react-compiler"] !== undefined,
    true,
  );
  assert.match(eslintConfig, /react-compiler/);
  assert.match(eslintConfig, /reactCompiler\.configs\.recommended\.rules/);
});
