import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  collectCustomerProfileImportIssuesFromSource,
  isCustomerProfileMuiFallbackAllowed,
  type CustomerProfileImportIssue,
  type ResolvedCustomerProfile
} from "./customer-profile.js";
import type {
  ComponentMatchLibraryResolutionReason,
  ComponentMatchLibraryResolutionStatus,
  ComponentMatchReportArtifact,
  ComponentMatchResolvedDiagnosticCode
} from "./storybook/types.js";

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

export interface CustomerProfileMatchValidationIssue {
  status: ComponentMatchLibraryResolutionStatus;
  reason: ComponentMatchLibraryResolutionReason;
  figmaFamilyKey: string;
  figmaFamilyName: string;
  componentKey?: string;
  storybookTier?: string;
  profileFamily?: string;
  message: string;
}

export interface CustomerProfileMatchValidationSummary {
  status: "ok" | "warn" | "failed";
  policy: ResolvedCustomerProfile["strictness"]["match"];
  issueCount: number;
  issues: CustomerProfileMatchValidationIssue[];
  counts: {
    byStatus: Record<ComponentMatchLibraryResolutionStatus, number>;
    byReason: Record<ComponentMatchLibraryResolutionReason, number>;
  };
}

export type CustomerProfileComponentApiValidationReason =
  | ComponentMatchResolvedDiagnosticCode
  | "component_api_missing"
  | "component_api_signature_conflict";

export interface CustomerProfileComponentApiValidationIssue {
  severity: "warning" | "error";
  code: CustomerProfileComponentApiValidationReason;
  figmaFamilyKey: string;
  figmaFamilyName: string;
  componentKey?: string;
  sourceProp?: string;
  targetProp?: string;
  message: string;
}

export interface CustomerProfileComponentApiValidationSummary {
  status: "ok" | "warn" | "failed";
  issueCount: number;
  counts: {
    byReason: Record<CustomerProfileComponentApiValidationReason, number>;
  };
  issues: CustomerProfileComponentApiValidationIssue[];
}

const COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES = [
  "resolved_import",
  "mui_fallback_allowed",
  "mui_fallback_denied",
  "not_applicable"
] as const satisfies readonly ComponentMatchLibraryResolutionStatus[];
const COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS = [
  "profile_import_resolved",
  "profile_import_missing",
  "profile_import_family_mismatch",
  "profile_family_unresolved",
  "match_ambiguous",
  "match_unmatched"
] as const satisfies readonly ComponentMatchLibraryResolutionReason[];
const ISSUE_LIBRARY_RESOLUTION_REASONS = new Set<ComponentMatchLibraryResolutionReason>([
  "match_ambiguous",
  "match_unmatched",
  "profile_family_unresolved",
  "profile_import_missing",
  "profile_import_family_mismatch"
]);
const COMPONENT_API_REASON_CODES = [
  "component_api_children_unsupported",
  "component_api_missing",
  "component_api_prop_unsupported",
  "component_api_signature_conflict",
  "component_api_slot_unsupported"
] as const satisfies readonly CustomerProfileComponentApiValidationReason[];

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

const createMatchStatusCounts = (): Record<ComponentMatchLibraryResolutionStatus, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_STATUSES.map((status) => [status, 0])
  ) as Record<ComponentMatchLibraryResolutionStatus, number>;
};

const createMatchReasonCounts = (): Record<ComponentMatchLibraryResolutionReason, number> => {
  return Object.fromEntries(
    COMPONENT_MATCH_LIBRARY_RESOLUTION_REASONS.map((reason) => [reason, 0])
  ) as Record<ComponentMatchLibraryResolutionReason, number>;
};

const createComponentApiReasonCounts = (): Record<CustomerProfileComponentApiValidationReason, number> => {
  return Object.fromEntries(
    COMPONENT_API_REASON_CODES.map((reason) => [reason, 0])
  ) as Record<CustomerProfileComponentApiValidationReason, number>;
};

const toCustomerProfileMatchIssueMessage = ({
  componentKey,
  figmaFamilyName,
  profileFamily,
  reason,
  storybookTier
}: {
  componentKey?: string;
  figmaFamilyName: string;
  profileFamily?: string;
  reason: ComponentMatchLibraryResolutionReason;
  storybookTier?: string;
}): string => {
  const componentLabel = componentKey ? `component '${componentKey}'` : `Figma family '${figmaFamilyName}'`;
  if (reason === "match_ambiguous") {
    return `${componentLabel} remains ambiguous in component.match_report.`;
  }
  if (reason === "match_unmatched") {
    return `${componentLabel} is unmatched in component.match_report.`;
  }
  if (reason === "profile_family_unresolved") {
    return `${componentLabel} could not resolve Storybook tier '${storybookTier ?? "unknown"}' to a customer profile family.`;
  }
  if (reason === "profile_import_family_mismatch") {
    return `${componentLabel} resolves to customer profile family '${profileFamily ?? "unknown"}' but its configured import belongs to a different family.`;
  }
  if (reason === "profile_import_missing") {
    return `${componentLabel} has no customer profile import for family '${profileFamily ?? "unknown"}'.`;
  }
  return `${componentLabel} resolved successfully.`;
};

export const validateCustomerProfileComponentMatchReport = ({
  artifact,
  customerProfile
}: {
  artifact: ComponentMatchReportArtifact;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileMatchValidationSummary => {
  const counts = {
    byStatus: createMatchStatusCounts(),
    byReason: createMatchReasonCounts()
  };
  const issues: CustomerProfileMatchValidationIssue[] = [];

  for (const entry of artifact.entries) {
    counts.byStatus[entry.libraryResolution.status] += 1;
    counts.byReason[entry.libraryResolution.reason] += 1;

    const hasNonIssueStatus =
      entry.libraryResolution.status === "resolved_import" || entry.libraryResolution.status === "mui_fallback_allowed";
    const hasIssueReason = ISSUE_LIBRARY_RESOLUTION_REASONS.has(entry.libraryResolution.reason);
    const hasIssueStatus = entry.libraryResolution.status === "mui_fallback_denied";
    if (hasNonIssueStatus || (!hasIssueReason && !hasIssueStatus)) {
      continue;
    }

    issues.push({
      status: entry.libraryResolution.status,
      reason: entry.libraryResolution.reason,
      figmaFamilyKey: entry.figma.familyKey,
      figmaFamilyName: entry.figma.familyName,
      ...(entry.libraryResolution.componentKey ? { componentKey: entry.libraryResolution.componentKey } : {}),
      ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {}),
      ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
      message: toCustomerProfileMatchIssueMessage({
        figmaFamilyName: entry.figma.familyName,
        reason: entry.libraryResolution.reason,
        ...(entry.libraryResolution.componentKey ? { componentKey: entry.libraryResolution.componentKey } : {}),
        ...(entry.libraryResolution.profileFamily ? { profileFamily: entry.libraryResolution.profileFamily } : {}),
        ...(entry.libraryResolution.storybookTier ? { storybookTier: entry.libraryResolution.storybookTier } : {})
      })
    });
  }

  issues.sort((left, right) => {
    const byFamilyName = left.figmaFamilyName.localeCompare(right.figmaFamilyName);
    if (byFamilyName !== 0) {
      return byFamilyName;
    }
    return left.figmaFamilyKey.localeCompare(right.figmaFamilyKey);
  });

  const status =
    issues.length === 0
      ? "ok"
      : customerProfile.strictness.match === "error"
        ? "failed"
        : customerProfile.strictness.match === "warn"
          ? "warn"
          : "ok";

  return {
    status,
    policy: customerProfile.strictness.match,
    issueCount: issues.length,
    issues,
    counts
  };
};

export const validateCustomerProfileComponentApiComponentMatchReport = ({
  artifact,
  customerProfile
}: {
  artifact: ComponentMatchReportArtifact;
  customerProfile: ResolvedCustomerProfile;
}): CustomerProfileComponentApiValidationSummary => {
  const issues: CustomerProfileComponentApiValidationIssue[] = [];
  const counts = {
    byReason: createComponentApiReasonCounts()
  };
  const resolvedEntriesByComponentKey = new Map<
    string,
    Array<{
      figmaFamilyKey: string;
      figmaFamilyName: string;
      apiSignature: string | undefined;
      issueSeverity: "warning" | "error";
    }>
  >();

  for (const entry of artifact.entries) {
    if (entry.libraryResolution.status !== "resolved_import") {
      continue;
    }
    const componentKey = entry.libraryResolution.componentKey?.trim();
    const issueSeverity =
      componentKey &&
      isCustomerProfileMuiFallbackAllowed({
        profile: customerProfile,
        componentKey
      })
        ? "warning"
        : "error";

    if (!componentKey || !entry.resolvedApi || !entry.resolvedProps) {
      issues.push({
        severity: issueSeverity,
        code: "component_api_missing",
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        ...(componentKey ? { componentKey } : {}),
        message:
          `component.match_report entry '${entry.figma.familyKey}' is missing resolved component-api data ` +
          `for component '${componentKey ?? "unknown"}'.`
      });
      continue;
    }

    const groupEntries = resolvedEntriesByComponentKey.get(componentKey) ?? [];
    groupEntries.push({
      figmaFamilyKey: entry.figma.familyKey,
      figmaFamilyName: entry.figma.familyName,
      apiSignature:
        entry.resolvedApi.status === "resolved"
          ? JSON.stringify({
              allowedProps: entry.resolvedApi.allowedProps,
              children: entry.resolvedApi.children,
              slots: entry.resolvedApi.slots,
              defaultProps: entry.resolvedApi.defaultProps
            })
          : undefined,
      issueSeverity
    });
    resolvedEntriesByComponentKey.set(componentKey, groupEntries);

    if (entry.resolvedProps.status === "resolved" && entry.resolvedProps.codegenCompatible) {
      continue;
    }

    if (entry.resolvedProps.diagnostics.length === 0) {
      issues.push({
        severity: issueSeverity,
        code: "component_api_missing",
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        componentKey,
        message: `Resolved component '${componentKey}' is not codegen-compatible.`
      });
      continue;
    }

    for (const diagnostic of entry.resolvedProps.diagnostics) {
      issues.push({
        severity: diagnostic.severity,
        code: diagnostic.code,
        figmaFamilyKey: entry.figma.familyKey,
        figmaFamilyName: entry.figma.familyName,
        componentKey,
        ...(diagnostic.sourceProp ? { sourceProp: diagnostic.sourceProp } : {}),
        ...(diagnostic.targetProp ? { targetProp: diagnostic.targetProp } : {}),
        message: diagnostic.message
      });
    }
  }

  for (const [componentKey, entries] of resolvedEntriesByComponentKey.entries()) {
    const signatures = new Set(entries.map((entry) => entry.apiSignature).filter((entry): entry is string => Boolean(entry)));
    if (signatures.size <= 1) {
      continue;
    }
    const representative = [...entries].sort((left, right) => left.figmaFamilyName.localeCompare(right.figmaFamilyName))[0];
    issues.push({
      severity: representative?.issueSeverity ?? "error",
      code: "component_api_signature_conflict",
      figmaFamilyKey: representative?.figmaFamilyKey ?? componentKey,
      figmaFamilyName: representative?.figmaFamilyName ?? componentKey,
      componentKey,
      message:
        `Resolved component '${componentKey}' produced multiple component-api contracts across matched Figma families; ` +
        "storybook-first mapping was excluded."
    });
  }

  issues.sort((left, right) => {
    const byFamilyName = left.figmaFamilyName.localeCompare(right.figmaFamilyName);
    if (byFamilyName !== 0) {
      return byFamilyName;
    }
    const byFamilyKey = left.figmaFamilyKey.localeCompare(right.figmaFamilyKey);
    if (byFamilyKey !== 0) {
      return byFamilyKey;
    }
    return left.code.localeCompare(right.code);
  });

  for (const issue of issues) {
    counts.byReason[issue.code] = (counts.byReason[issue.code] ?? 0) + 1;
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  return {
    status: hasError ? "failed" : hasWarning ? "warn" : "ok",
    issueCount: issues.length,
    counts,
    issues
  };
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
