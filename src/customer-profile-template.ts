import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedCustomerProfile } from "./customer-profile.js";

const sortRecord = (input: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(input).sort((left, right) => left[0].localeCompare(right[0])));
};

const sortPathRecord = (input: Record<string, string[]>): Record<string, string[]> => {
  return Object.fromEntries(
    Object.entries(input)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => [key, [...value]])
  );
};

const readJsonFile = async ({ filePath }: { filePath: string }): Promise<unknown> => {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
};

const writeJsonFile = async ({
  filePath,
  input
}: {
  filePath: string;
  input: unknown;
}): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
};

const upsertViteResolveAliases = ({
  content,
  importAliases
}: {
  content: string;
  importAliases: Record<string, string>;
}): string => {
  if (Object.keys(importAliases).length === 0) {
    return content;
  }

  const aliasBlock = [
    "  resolve: {",
    "    alias: {",
    ...Object.entries(importAliases).map(([aliasKey, target]) => `      ${JSON.stringify(aliasKey)}: ${JSON.stringify(target)},`),
    "    }",
    "  },"
  ].join("\n");

  if (/^\s*resolve:\s*\{/m.test(content)) {
    return content.replace(/^\s*resolve:\s*\{[\s\S]*?^\s*\},\n/m, `${aliasBlock}\n`);
  }

  if (content.includes("  base: normalizedBasePath,\n")) {
    return content.replace("  base: normalizedBasePath,\n", `  base: normalizedBasePath,\n${aliasBlock}\n`);
  }

  const defineConfigIndex = content.indexOf("export default defineConfig({");
  if (defineConfigIndex < 0) {
    throw new Error("Could not locate defineConfig block in vite.config.ts for customer profile alias insertion.");
  }
  const insertionIndex = defineConfigIndex + "export default defineConfig({".length;
  return `${content.slice(0, insertionIndex)}\n${aliasBlock}${content.slice(insertionIndex)}`;
};

export const applyCustomerProfileToTemplate = async ({
  generatedProjectDir,
  customerProfile
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
}): Promise<void> => {
  const packageJsonPath = path.join(generatedProjectDir, "package.json");
  const packageJson = await readJsonFile({ filePath: packageJsonPath });
  if (typeof packageJson !== "object" || packageJson === null || Array.isArray(packageJson)) {
    throw new Error(`Expected package.json at '${packageJsonPath}' to be an object.`);
  }

  const packageJsonRecord = packageJson as Record<string, unknown>;
  const existingDependencies =
    typeof packageJsonRecord.dependencies === "object" &&
    packageJsonRecord.dependencies !== null &&
    !Array.isArray(packageJsonRecord.dependencies)
      ? (packageJsonRecord.dependencies as Record<string, string>)
      : {};
  const existingDevDependencies =
    typeof packageJsonRecord.devDependencies === "object" &&
    packageJsonRecord.devDependencies !== null &&
    !Array.isArray(packageJsonRecord.devDependencies)
      ? (packageJsonRecord.devDependencies as Record<string, string>)
      : {};

  packageJsonRecord.dependencies = sortRecord({
    ...existingDependencies,
    ...customerProfile.template.dependencies
  });
  packageJsonRecord.devDependencies = sortRecord({
    ...existingDevDependencies,
    ...customerProfile.template.devDependencies
  });
  await writeJsonFile({
    filePath: packageJsonPath,
    input: packageJsonRecord
  });

  if (Object.keys(customerProfile.template.importAliases).length === 0) {
    return;
  }

  const tsconfigPath = path.join(generatedProjectDir, "tsconfig.json");
  const tsconfig = await readJsonFile({ filePath: tsconfigPath });
  if (typeof tsconfig !== "object" || tsconfig === null || Array.isArray(tsconfig)) {
    throw new Error(`Expected tsconfig.json at '${tsconfigPath}' to be an object.`);
  }
  const tsconfigRecord = tsconfig as Record<string, unknown>;
  const compilerOptions =
    typeof tsconfigRecord.compilerOptions === "object" &&
    tsconfigRecord.compilerOptions !== null &&
    !Array.isArray(tsconfigRecord.compilerOptions)
      ? (tsconfigRecord.compilerOptions as Record<string, unknown>)
      : {};
  const existingPaths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null && !Array.isArray(compilerOptions.paths)
      ? (compilerOptions.paths as Record<string, string[]>)
      : {};

  compilerOptions.baseUrl = ".";
  compilerOptions.paths = sortPathRecord({
    ...existingPaths,
    ...Object.fromEntries(
      Object.entries(customerProfile.template.importAliases).map(([aliasKey, target]) => [aliasKey, [target]] as const)
    )
  });
  tsconfigRecord.compilerOptions = compilerOptions;
  await writeJsonFile({
    filePath: tsconfigPath,
    input: tsconfigRecord
  });

  const viteConfigPath = path.join(generatedProjectDir, "vite.config.ts");
  const viteConfig = await readFile(viteConfigPath, "utf8");
  const nextViteConfig = upsertViteResolveAliases({
    content: viteConfig,
    importAliases: customerProfile.template.importAliases
  });
  if (nextViteConfig !== viteConfig) {
    await writeFile(viteConfigPath, nextViteConfig, "utf8");
  }
};
