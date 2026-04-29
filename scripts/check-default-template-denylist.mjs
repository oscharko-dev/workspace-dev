#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_TEMPLATE_ROOT = path.join(
  PACKAGE_ROOT,
  "template/react-tailwind-app",
);

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const DENIED_PACKAGE_RULES = [
  { category: "mui", pattern: /^@mui(?:\/|$)/ },
  { category: "emotion", pattern: /^@emotion(?:\/|$)/ },
  {
    category: "customer",
    pattern: /^@customer(?:\/|$)|^customer[-/]|^@figmapipe\/customer(?:[-/]|$)/,
  },
  {
    category: "rocket",
    pattern: /^@rocket(?:\/|$)|^rocket[-/]|^@figmapipe\/rocket(?:[-/]|$)/,
  },
  {
    category: "telemetry",
    pattern:
      /^posthog-js$|^@sentry(?:\/|$)|^mixpanel(?:$|-)|^mixpanel-browser$/,
  },
  {
    category: "telemetry",
    pattern:
      /^amplitude(?:$|-)|^@amplitude(?:\/|$)|^analytics-node$|^@segment(?:\/|$)/,
  },
  {
    category: "telemetry",
    pattern:
      /^@datadog\/browser-(?:rum|logs)$|^dd-trace$|^newrelic$|^@newrelic(?:\/|$)/,
  },
  {
    category: "telemetry",
    pattern: /^applicationinsights$|^@opentelemetry(?:\/|$)/,
  },
];

const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);
const SKIP_DIRECTORIES = new Set([
  ".figmapipe",
  "artifacts",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const SOURCE_DENYLIST_PATTERNS = [
  {
    category: "mui",
    pattern:
      /(?:from\s+|import\s*\(|import\s+|require\s*\()\s*["']@mui(?:\/|["'])/,
  },
  {
    category: "emotion",
    pattern:
      /(?:from\s+|import\s*\(|import\s+|require\s*\()\s*["']@emotion(?:\/|["'])/,
  },
  {
    category: "customer",
    pattern:
      /(?:from\s+|import\s*\(|import\s+|require\s*\()\s*["'](?:@customer(?:\/|["'])|customer-profile(?:\/|["'])|@figmapipe\/customer(?:[-/]|["']))/,
  },
  {
    category: "rocket",
    pattern:
      /(?:from\s+|import\s*\(|import\s+|require\s*\()\s*["']@rocket(?:\/|["'])/,
  },
  {
    category: "telemetry",
    pattern:
      /(?:from\s+|import\s*\(|import\s+|require\s*\()\s*["'](?:posthog-js|@sentry\/|mixpanel|amplitude|@amplitude\/|@segment\/|@datadog\/browser-|dd-trace|newrelic|@opentelemetry\/)/,
  },
];

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const toPosix = (filePath) => filePath.split(path.sep).join("/");

const toRelative = ({ templateRoot, filePath }) =>
  toPosix(path.relative(templateRoot, filePath));

export const matchesDeniedPackage = (packageName) => {
  for (const rule of DENIED_PACKAGE_RULES) {
    if (rule.pattern.test(packageName)) {
      return rule.category;
    }
  }
  return null;
};

const parseJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const packageEntries = (packageJson) => {
  const entries = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const packageName of Object.keys(dependencies)) {
      entries.push({ source: `package.json ${section}`, packageName });
    }
  }

  const overrides = packageJson.pnpm?.overrides;
  if (overrides && typeof overrides === "object") {
    for (const overrideName of Object.keys(overrides)) {
      const packageName = overrideName.split(">").at(-1)?.trim();
      if (packageName) {
        entries.push({ source: "package.json pnpm.overrides", packageName });
      }
    }
  }

  return entries;
};

export const extractRootImporterPackages = (lockfileContent) => {
  const packages = [];
  let inImporters = false;
  let inRootImporter = false;
  let currentSection = null;

  for (const line of lockfileContent.split("\n")) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (!inImporters) {
      continue;
    }
    if (/^\S/.test(line) && line !== "importers:") {
      break;
    }
    if (line === "  .:") {
      inRootImporter = true;
      currentSection = null;
      continue;
    }
    if (!inRootImporter) {
      continue;
    }
    if (/^  [^ ].+:\s*$/.test(line) && line !== "  .:") {
      break;
    }
    const sectionMatch = line.match(
      /^    (dependencies|devDependencies|optionalDependencies|peerDependencies):\s*$/,
    );
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (currentSection === null) {
      continue;
    }
    const packageMatch = line.match(/^      (.+):\s*$/);
    if (!packageMatch) {
      continue;
    }
    packages.push({
      source: `pnpm-lock.yaml root importer ${currentSection}`,
      packageName: packageMatch[1].replace(/^['"]|['"]$/g, ""),
    });
  }

  return packages;
};

const parseLockfilePackageName = (rawKey) => {
  let key = rawKey.trim().replace(/^['"]|['"]$/g, "");
  if (key.startsWith("/")) {
    key = key.slice(1);
  }
  if (key.startsWith("@")) {
    const match = key.match(/^(@[^/]+\/[^@/(]+)/);
    return match?.[1] ?? key;
  }
  const match = key.match(/^([^@/(]+)/);
  return match?.[1] ?? key;
};

export const extractLockfilePackageEntries = (lockfileContent) => {
  const packages = [];
  let inPackages = false;

  for (const line of lockfileContent.split("\n")) {
    if (line === "packages:" || line === "snapshots:") {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    if (/^\S/.test(line) && line !== "packages:" && line !== "snapshots:") {
      inPackages = false;
      continue;
    }
    const packageMatch = line.match(/^ {2}(\S.+):\s*$/);
    if (!packageMatch) {
      continue;
    }
    const packageName = parseLockfilePackageName(packageMatch[1]);
    if (packageName.length > 0) {
      packages.push({
        source: "pnpm-lock.yaml package graph",
        packageName,
      });
    }
  }

  return packages;
};

const collectFiles = async (rootDir) => {
  const files = [];
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.isFile()) {
        files.push(path.join(dir, entry.name));
      }
    }
  };

  await walk(rootDir);
  return files;
};

const assertTemplateRoot = async (templateRoot) => {
  const stats = await stat(templateRoot);
  if (!stats.isDirectory()) {
    throw new Error(`Template root is not a directory: ${templateRoot}`);
  }
};

export const analyzeDefaultTemplateDenylist = async ({
  templateRoot = DEFAULT_TEMPLATE_ROOT,
} = {}) => {
  const normalizedTemplateRoot = path.resolve(templateRoot);
  await assertTemplateRoot(normalizedTemplateRoot);

  const violations = [];
  const packageJsonPath = path.join(normalizedTemplateRoot, "package.json");
  const lockfilePath = path.join(normalizedTemplateRoot, "pnpm-lock.yaml");
  const packageJson = await parseJson(packageJsonPath);

  for (const entry of packageEntries(packageJson)) {
    const category = matchesDeniedPackage(entry.packageName);
    if (category) {
      violations.push({ ...entry, category, kind: "dependency" });
    }
  }

  const lockfileContent = await readFile(lockfilePath, "utf8");
  const lockfileEntries = [
    ...extractRootImporterPackages(lockfileContent),
    ...extractLockfilePackageEntries(lockfileContent),
  ];
  const seenLockfileEntries = new Set();
  for (const entry of lockfileEntries) {
    const key = `${entry.source}:${entry.packageName}`;
    if (seenLockfileEntries.has(key)) {
      continue;
    }
    seenLockfileEntries.add(key);
    const category = matchesDeniedPackage(entry.packageName);
    if (category) {
      violations.push({ ...entry, category, kind: "dependency" });
    }
  }

  const files = await collectFiles(normalizedTemplateRoot);
  for (const filePath of files) {
    const relativePath = toRelative({
      templateRoot: normalizedTemplateRoot,
      filePath,
    });
    const extension = path.extname(filePath).toLowerCase();

    if (ASSET_EXTENSIONS.has(extension)) {
      violations.push({
        kind: "asset",
        category: "proprietary-asset-risk",
        source: relativePath,
        packageName: null,
      });
      continue;
    }

    if (
      !SOURCE_EXTENSIONS.has(extension) ||
      TEST_FILE_PATTERN.test(path.basename(filePath))
    ) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    for (const rule of SOURCE_DENYLIST_PATTERNS) {
      if (rule.pattern.test(content)) {
        violations.push({
          kind: "source",
          category: rule.category,
          source: relativePath,
          packageName: null,
        });
      }
    }
  }

  return {
    templateRoot: normalizedTemplateRoot,
    violations,
  };
};

const main = async () => {
  const templateRoot =
    process.env.WORKSPACE_DEV_DEFAULT_TEMPLATE_ROOT?.trim() ||
    DEFAULT_TEMPLATE_ROOT;
  const report = await analyzeDefaultTemplateDenylist({ templateRoot });

  if (report.violations.length > 0) {
    console.error("[default-template-denylist] Check failed.");
    for (const violation of report.violations) {
      const target = violation.packageName ? ` ${violation.packageName}` : "";
      console.error(
        `- ${violation.kind}:${violation.category}:${target} (${violation.source})`,
      );
    }
    process.exit(1);
  }

  console.log(
    `[default-template-denylist] Check passed for ${path.relative(PACKAGE_ROOT, report.templateRoot) || report.templateRoot}.`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[default-template-denylist] Failed:", error);
    process.exit(1);
  });
}
