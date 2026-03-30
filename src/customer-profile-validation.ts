import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  collectCustomerProfileImportIssuesFromSource,
  type CustomerProfileImportIssue,
  type ResolvedCustomerProfile
} from "./customer-profile.js";

export interface CustomerProfileValidationIssue {
  code:
    | "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"
    | "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY"
    | "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"
    | CustomerProfileImportIssue["code"];
  message: string;
  filePath?: string;
  modulePath?: string;
}

export interface CustomerProfileValidationSummary {
  status: "ok" | "warn" | "failed";
  import: {
    policy: ResolvedCustomerProfile["strictness"]["import"];
    issueCount: number;
    issues: CustomerProfileValidationIssue[];
  };
  match: {
    policy: ResolvedCustomerProfile["strictness"]["match"];
  };
  token: {
    policy: ResolvedCustomerProfile["strictness"]["token"];
  };
}

const readJsonRecord = async ({ filePath }: { filePath: string }): Promise<Record<string, unknown>> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object at '${filePath}'.`);
  }
  return parsed as Record<string, unknown>;
};

const collectSourceFiles = async ({
  directoryPath
}: {
  directoryPath: string;
}): Promise<string[]> => {
  const results: string[] = [];
  const walk = async (currentPath: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".figmapipe") {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx") {
        results.push(absolutePath);
      }
    }
  };

  await walk(directoryPath);
  return results.sort((left, right) => left.localeCompare(right));
};

const validateTemplateDependencies = ({
  packageJson,
  customerProfile
}: {
  packageJson: Record<string, unknown>;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileValidationIssue[] => {
  const issues: CustomerProfileValidationIssue[] = [];
  const dependencies =
    typeof packageJson.dependencies === "object" && packageJson.dependencies !== null && !Array.isArray(packageJson.dependencies)
      ? (packageJson.dependencies as Record<string, string>)
      : {};
  const devDependencies =
    typeof packageJson.devDependencies === "object" &&
    packageJson.devDependencies !== null &&
    !Array.isArray(packageJson.devDependencies)
      ? (packageJson.devDependencies as Record<string, string>)
      : {};

  for (const [packageName, version] of Object.entries(customerProfile.template.dependencies)) {
    if (dependencies[packageName] === version) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY",
      filePath: "package.json",
      modulePath: packageName,
      message: `package.json must declare dependency '${packageName}' with version '${version}'.`
    });
  }

  for (const [packageName, version] of Object.entries(customerProfile.template.devDependencies)) {
    if (devDependencies[packageName] === version) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY",
      filePath: "package.json",
      modulePath: packageName,
      message: `package.json must declare devDependency '${packageName}' with version '${version}'.`
    });
  }

  return issues;
};

const validateTemplateAliases = async ({
  generatedProjectDir,
  customerProfile
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
}): Promise<CustomerProfileValidationIssue[]> => {
  const issues: CustomerProfileValidationIssue[] = [];
  if (Object.keys(customerProfile.template.importAliases).length === 0) {
    return issues;
  }

  const tsconfigPath = path.join(generatedProjectDir, "tsconfig.json");
  const tsconfig = await readJsonRecord({ filePath: tsconfigPath });
  const compilerOptions =
    typeof tsconfig.compilerOptions === "object" && tsconfig.compilerOptions !== null && !Array.isArray(tsconfig.compilerOptions)
      ? (tsconfig.compilerOptions as Record<string, unknown>)
      : {};
  const paths =
    typeof compilerOptions.paths === "object" && compilerOptions.paths !== null && !Array.isArray(compilerOptions.paths)
      ? (compilerOptions.paths as Record<string, unknown>)
      : {};

  for (const [aliasKey, target] of Object.entries(customerProfile.template.importAliases)) {
    const tsconfigValue = paths[aliasKey];
    const normalizedTsconfigValue =
      Array.isArray(tsconfigValue) && typeof tsconfigValue[0] === "string" ? tsconfigValue[0] : undefined;
    if (compilerOptions.baseUrl !== "." || normalizedTsconfigValue !== target) {
      issues.push({
        code: "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS",
        filePath: "tsconfig.json",
        modulePath: aliasKey,
        message: `tsconfig.json must map alias '${aliasKey}' to '${target}'.`
      });
    }
  }

  const viteConfigPath = path.join(generatedProjectDir, "vite.config.ts");
  const viteConfig = await readFile(viteConfigPath, "utf8");
  for (const [aliasKey, target] of Object.entries(customerProfile.template.importAliases)) {
    const aliasSnippet = `${JSON.stringify(aliasKey)}: ${JSON.stringify(target)}`;
    if (viteConfig.includes(aliasSnippet)) {
      continue;
    }
    issues.push({
      code: "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS",
      filePath: "vite.config.ts",
      modulePath: aliasKey,
      message: `vite.config.ts must map alias '${aliasKey}' to '${target}'.`
    });
  }

  return issues;
};

export const validateGeneratedProjectCustomerProfile = async ({
  generatedProjectDir,
  customerProfile
}: {
  generatedProjectDir: string;
  customerProfile: ResolvedCustomerProfile;
}): Promise<CustomerProfileValidationSummary> => {
  const issues: CustomerProfileValidationIssue[] = [];
  const packageJsonPath = path.join(generatedProjectDir, "package.json");
  const packageJson = await readJsonRecord({ filePath: packageJsonPath });

  issues.push(
    ...validateTemplateDependencies({
      packageJson,
      customerProfile
    })
  );

  issues.push(
    ...(await validateTemplateAliases({
      generatedProjectDir,
      customerProfile
    }))
  );

  const sourceRoot = path.join(generatedProjectDir, "src");
  const sourceFiles = await collectSourceFiles({
    directoryPath: sourceRoot
  });
  for (const sourceFile of sourceFiles) {
    const content = await readFile(sourceFile, "utf8");
    issues.push(
      ...collectCustomerProfileImportIssuesFromSource({
        content,
        filePath: path.relative(generatedProjectDir, sourceFile).split(path.sep).join("/"),
        profile: customerProfile
      })
    );
  }

  const status =
    issues.length === 0
      ? "ok"
      : customerProfile.strictness.import === "error"
        ? "failed"
        : customerProfile.strictness.import === "warn"
          ? "warn"
          : "ok";

  return {
    status,
    import: {
      policy: customerProfile.strictness.import,
      issueCount: issues.length,
      issues
    },
    match: {
      policy: customerProfile.strictness.match
    },
    token: {
      policy: customerProfile.strictness.token
    }
  };
};
