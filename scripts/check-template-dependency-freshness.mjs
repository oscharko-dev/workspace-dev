#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;

export const TEMPLATE_DEPENDENCY_ISSUE_MARKER =
  "<!-- workspace-dev:template-dependency-freshness -->";

const DEFAULT_TEMPLATE_PACKAGE_JSON = path.join(
  PACKAGE_ROOT,
  "template/react-mui-app/package.json",
);
const DEFAULT_TEMPLATE_LOCKFILE = path.join(
  PACKAGE_ROOT,
  "template/react-mui-app/pnpm-lock.yaml",
);

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_THRESHOLD_DAYS = 30;

const parseArgs = (argv) => {
  const options = {
    packageJsonPath: DEFAULT_TEMPLATE_PACKAGE_JSON,
    lockfilePath: DEFAULT_TEMPLATE_LOCKFILE,
    registryUrl: DEFAULT_REGISTRY_URL,
    thresholdDays: DEFAULT_THRESHOLD_DAYS,
    jsonOutputPath: null,
    markdownOutputPath: null,
    failOnStale: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--package-json" && next) {
      options.packageJsonPath = path.resolve(next);
      index += 1;
    } else if (arg === "--lockfile" && next) {
      options.lockfilePath = path.resolve(next);
      index += 1;
    } else if (arg === "--registry-url" && next) {
      options.registryUrl = next;
      index += 1;
    } else if (arg === "--threshold-days" && next) {
      options.thresholdDays = Number(next);
      index += 1;
    } else if (arg === "--json-output" && next) {
      options.jsonOutputPath = path.resolve(next);
      index += 1;
    } else if (arg === "--markdown-output" && next) {
      options.markdownOutputPath = path.resolve(next);
      index += 1;
    } else if (arg === "--fail-on-stale") {
      options.failOnStale = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.thresholdDays) || options.thresholdDays <= 0) {
    throw new Error("--threshold-days must be a positive number.");
  }

  return options;
};

export const parseStableSemver = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: value,
  };
};

export const parseVersionFromRange = (range) => {
  if (typeof range !== "string") {
    return null;
  }
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match ? parseStableSemver(match[1]) : null;
};

const parseLockfilePackageName = (line) => {
  const match = line.match(/^      (.+):\s*$/);
  if (!match) {
    return null;
  }
  return match[1].replace(/^['"]|['"]$/g, "");
};

const parseLockfileVersion = (line) => {
  const match = line.match(/^        version:\s+(.+?)\s*$/);
  if (!match) {
    return null;
  }
  return parseVersionFromRange(match[1])?.raw ?? null;
};

export const extractLockedDependencyVersions = (lockfileContent) => {
  const versions = new Map();
  let inImporters = false;
  let inRootImporter = false;
  let currentSection = null;
  let currentPackageName = null;

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
      currentPackageName = null;
      continue;
    }
    if (!inRootImporter) {
      continue;
    }
    if (/^  [^ ].+:\s*$/.test(line) && line !== "  .:") {
      break;
    }
    const sectionMatch = line.match(/^    (dependencies|devDependencies):\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentPackageName = null;
      continue;
    }
    if (currentSection === null) {
      continue;
    }
    const packageName = parseLockfilePackageName(line);
    if (packageName !== null) {
      currentPackageName = packageName;
      continue;
    }
    if (currentPackageName === null) {
      continue;
    }
    const lockedVersion = parseLockfileVersion(line);
    if (lockedVersion !== null) {
      versions.set(currentPackageName, lockedVersion);
    }
  }

  return versions;
};

export const compareSemver = (first, second) => {
  for (const key of ["major", "minor", "patch"]) {
    if (first[key] !== second[key]) {
      return first[key] - second[key];
    }
  }
  return 0;
};

export const collectTemplateDependencies = (packageJson) => {
  const sections = [
    ["dependencies", packageJson.dependencies],
    ["devDependencies", packageJson.devDependencies],
  ];
  const dependencies = [];

  for (const [dependencyType, entries] of sections) {
    if (!entries || typeof entries !== "object") {
      continue;
    }
    for (const [name, range] of Object.entries(entries)) {
      if (typeof range !== "string") {
        continue;
      }
      const currentVersion = parseVersionFromRange(range);
      if (currentVersion === null) {
        continue;
      }
      dependencies.push({
        name,
        dependencyType,
        currentRange: range,
        currentVersion: currentVersion.raw,
      });
    }
  }

  return dependencies.sort((first, second) =>
    first.name.localeCompare(second.name),
  );
};

export const findLatestMinorPatchUpdate = ({
  currentVersion,
  versions,
  time,
}) => {
  const current = parseStableSemver(currentVersion);
  if (current === null || !versions || typeof versions !== "object") {
    return null;
  }

  const candidates = Object.keys(versions)
    .map(parseStableSemver)
    .filter(
      (candidate) =>
        candidate !== null &&
        candidate.major === current.major &&
        compareSemver(candidate, current) > 0 &&
        typeof time?.[candidate.raw] === "string",
    )
    .sort(compareSemver);

  const latest = candidates.at(-1);
  if (!latest) {
    return null;
  }

  return {
    version: latest.raw,
    publishedAt: time[latest.raw],
  };
};

const packageRegistryUrl = (registryUrl, packageName) => {
  const normalizedRegistry = registryUrl.replace(/\/+$/, "");
  return `${normalizedRegistry}/${encodeURIComponent(packageName)}`;
};

export const analyzeTemplateDependencyFreshness = async ({
  packageJsonPath = DEFAULT_TEMPLATE_PACKAGE_JSON,
  lockfilePath = DEFAULT_TEMPLATE_LOCKFILE,
  registryUrl = DEFAULT_REGISTRY_URL,
  thresholdDays = DEFAULT_THRESHOLD_DAYS,
  now = new Date(),
  fetchPackage = async (packageName) => {
    const response = await fetch(packageRegistryUrl(registryUrl, packageName), {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Registry request failed for ${packageName}: ${response.status} ${response.statusText}`,
      );
    }
    return response.json();
  },
} = {}) => {
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(rawPackageJson);
  const lockedVersions = extractLockedDependencyVersions(
    await readFile(lockfilePath, "utf8"),
  );
  const dependencies = collectTemplateDependencies(packageJson).map(
    (dependency) => ({
      ...dependency,
      currentVersion:
        lockedVersions.get(dependency.name) ?? dependency.currentVersion,
    }),
  );
  const staleDependencies = [];

  for (const dependency of dependencies) {
    const packument = await fetchPackage(dependency.name);
    const update = findLatestMinorPatchUpdate({
      currentVersion: dependency.currentVersion,
      versions: packument.versions,
      time: packument.time,
    });

    if (update === null) {
      continue;
    }

    const publishedAtMs = Date.parse(update.publishedAt);
    if (!Number.isFinite(publishedAtMs)) {
      continue;
    }
    const ageMs = now.getTime() - publishedAtMs;
    if (ageMs <= thresholdDays * DAY_MS) {
      continue;
    }

    staleDependencies.push({
      name: dependency.name,
      dependencyType: dependency.dependencyType,
      currentRange: dependency.currentRange,
      currentLockedVersion: dependency.currentVersion,
      latestMinorPatchVersion: update.version,
      publishedAt: new Date(publishedAtMs).toISOString(),
      daysBehind: Math.floor(ageMs / DAY_MS),
    });
  }

  return {
    checkedAt: now.toISOString(),
    thresholdDays,
    templatePackagePath: path.relative(PACKAGE_ROOT, packageJsonPath),
    templateLockfilePath: path.relative(PACKAGE_ROOT, lockfilePath),
    dependencyCount: dependencies.length,
    staleDependencies,
  };
};

export const renderTemplateDependencyIssueBody = (report) => {
  const rows = report.staleDependencies
    .map(
      (dependency) =>
        `| \`${dependency.name}\` | ${dependency.dependencyType} | \`${dependency.currentRange}\` | \`${dependency.currentLockedVersion}\` | \`${dependency.latestMinorPatchVersion}\` | ${dependency.daysBehind} | ${dependency.publishedAt.slice(0, 10)} |`,
    )
    .join("\n");

  return `${TEMPLATE_DEPENDENCY_ISSUE_MARKER}
Template dependency freshness automation found minor or patch updates that have been available for more than ${report.thresholdDays} days.

Review the update policy in \`docs/template-maintenance.md\`, update \`template/react-mui-app/package.json\` and \`template/react-mui-app/pnpm-lock.yaml\` in a dedicated PR, and run the documented template validation gates before merging.

| Package | Type | Current range | Current locked version | Latest same-major version | Days behind | Published |
| --- | --- | --- | --- | --- | ---: | --- |
${rows}

Checked at: ${report.checkedAt}
`;
};

const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await analyzeTemplateDependencyFreshness(options);
    const issueBody = renderTemplateDependencyIssueBody(report);

    if (options.jsonOutputPath) {
      await writeJson(options.jsonOutputPath, report);
    }
    if (options.markdownOutputPath) {
      await writeText(options.markdownOutputPath, issueBody);
    }

    console.log(
      `[template-dependency-freshness] Checked ${report.dependencyCount} dependency entries; stale minor/patch updates: ${report.staleDependencies.length}.`,
    );

    if (report.staleDependencies.length > 0) {
      for (const dependency of report.staleDependencies) {
        console.log(
          ` - ${dependency.name}: ${dependency.currentLockedVersion} -> ${dependency.latestMinorPatchVersion} (${dependency.daysBehind} days)`,
        );
      }
    }

    if (options.failOnStale && report.staleDependencies.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("[template-dependency-freshness] Failed:", error);
    process.exit(1);
  }
}
