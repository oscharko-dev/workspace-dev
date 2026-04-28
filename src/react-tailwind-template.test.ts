import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const templateRoot = path.resolve(packageRoot, "template/react-tailwind-app");

const readTemplateFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.join(templateRoot, relativePath), "utf8");
};

test("react-tailwind template manifest exposes the expected OSS stack", async () => {
  const packageJson = JSON.parse(await readTemplateFile("package.json")) as {
    private?: boolean;
    type?: string;
    engines?: { node?: string };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const forbiddenPrefixes = ["@mui/", "@emotion/"];
  const forbiddenPackages = new Set([
    "react-hook-form",
    "react-router-dom",
    "web-vitals",
    "zod",
  ]);

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines?.node, "^20.19.0 || >=22.12.0");
  assert.equal(packageJson.scripts?.lint, "eslint . --max-warnings 0");
  assert.equal(packageJson.scripts?.typecheck, "tsc -b --noEmit");
  assert.equal(packageJson.scripts?.build, "tsc -b && vite build");
  assert.equal(packageJson.scripts?.test, "vitest run");

  assert.equal(packageJson.dependencies?.react?.startsWith("^19."), true);
  assert.equal(packageJson.dependencies?.["react-dom"]?.startsWith("^19."), true);
  assert.equal(packageJson.devDependencies?.typescript?.startsWith("~6."), true);
  assert.equal(packageJson.devDependencies?.vite?.startsWith("^8."), true);
  assert.equal(
    packageJson.devDependencies?.["@vitejs/plugin-react"]?.startsWith("^6."),
    true,
  );
  assert.equal(packageJson.devDependencies?.tailwindcss?.startsWith("^4."), true);
  assert.equal(
    packageJson.devDependencies?.["@tailwindcss/vite"]?.startsWith("^4."),
    true,
  );
  assert.equal(packageJson.devDependencies?.vitest !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@testing-library/react"] !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@testing-library/jest-dom"] !== undefined, true);
  assert.equal(packageJson.devDependencies?.["@types/react"]?.startsWith("^19."), true);
  assert.equal(packageJson.devDependencies?.["@types/react-dom"]?.startsWith("^19."), true);

  for (const packageName of Object.keys(allDependencies)) {
    assert.equal(
      forbiddenPrefixes.some((prefix) => packageName.startsWith(prefix)),
      false,
      `Forbidden dependency '${packageName}' must not be present in react-tailwind-app.`,
    );
    assert.equal(
      forbiddenPackages.has(packageName),
      false,
      `Customer or non-baseline dependency '${packageName}' must not be present in react-tailwind-app.`,
    );
  }
});

test("react-tailwind template wires Vite, Tailwind, strict TypeScript, and TSX entrypoints", async () => {
  const viteConfig = await readTemplateFile("vite.config.ts");
  const styles = await readTemplateFile("src/styles.css");
  const main = await readTemplateFile("src/main.tsx");
  const app = await readTemplateFile("src/App.tsx");
  const tsconfig = JSON.parse(await readTemplateFile("tsconfig.app.json")) as {
    compilerOptions?: {
      lib?: string[];
      strict?: boolean;
      noImplicitAny?: boolean;
      strictNullChecks?: boolean;
      exactOptionalPropertyTypes?: boolean;
      noUncheckedIndexedAccess?: boolean;
      jsx?: string;
      types?: string[];
    };
  };

  assert.match(viteConfig, /from "@tailwindcss\/vite"/);
  assert.match(viteConfig, /tailwindcss\(\)/);
  assert.match(viteConfig, /from "vitest\/config"/);
  assert.match(viteConfig, /environment: "jsdom"/);
  assert.match(styles, /@import "tailwindcss";/);
  assert.match(main, /createRoot/);
  assert.match(main, /import App from "\.\/App\.tsx"/);
  assert.match(main, /import "\.\/styles\.css"/);
  assert.match(app, /className="/);

  assert.equal(tsconfig.compilerOptions?.strict, true);
  assert.equal(tsconfig.compilerOptions?.noImplicitAny, true);
  assert.equal(tsconfig.compilerOptions?.strictNullChecks, true);
  assert.equal(tsconfig.compilerOptions?.exactOptionalPropertyTypes, true);
  assert.equal(tsconfig.compilerOptions?.noUncheckedIndexedAccess, true);
  assert.equal(tsconfig.compilerOptions?.jsx, "react-jsx");
  assert.equal(tsconfig.compilerOptions?.lib?.includes("DOM"), true);
  assert.equal(tsconfig.compilerOptions?.lib?.includes("DOM.Iterable"), true);
  assert.equal(tsconfig.compilerOptions?.types?.includes("vite/client"), true);
  assert.equal(tsconfig.compilerOptions?.types?.includes("react"), true);
  assert.equal(tsconfig.compilerOptions?.types?.includes("react-dom"), true);
  assert.equal(tsconfig.compilerOptions?.types?.includes("vitest/globals"), true);
});
