#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const cyclonedxPackageEntryPath = require.resolve("@cyclonedx/cyclonedx-npm");
const cyclonedxCliPath = path.resolve(
  path.dirname(cyclonedxPackageEntryPath),
  "bin/cyclonedx-npm-cli.js"
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  let outputPath = "artifacts/sbom/workspace-dev.spdx.json";
  let packageRoot = repoRoot;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    if (current === "--package-root") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --package-root.");
      }
      packageRoot = path.resolve(repoRoot, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--package-root=")) {
      packageRoot = path.resolve(repoRoot, current.slice("--package-root=".length));
      continue;
    }
    outputPath = current;
  }

  return {
    outputPath,
    packageRoot
  };
};

const resolveTimestamp = () => {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number.parseInt(sourceDateEpoch, 10) * 1000).toISOString();
  }
  return new Date().toISOString();
};

const statPath = async (targetPath) => {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const toSpdxId = (name, version) => {
  return `SPDXRef-Package-${`${name}-${version}`.replace(/[^a-zA-Z0-9.-]/g, "-")}`;
};

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.npm_execpath;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`));
    });
  });

const normalizePackageKey = (value) => {
  const decodedValue = decodeURIComponent(value);
  const queryIndex = decodedValue.indexOf("?");
  const fragmentIndex = decodedValue.indexOf("#");
  const endIndexCandidates = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const endIndex = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : decodedValue.length;
  return decodedValue.slice(0, endIndex);
};

const packageKeyFromCycloneDxComponent = (component) => {
  if (typeof component.purl === "string" && component.purl.length > 0) {
    return normalizePackageKey(component.purl);
  }

  const name =
    typeof component.group === "string" && component.group.length > 0
      ? `${component.group}/${component.name}`
      : component.name;
  return normalizePackageKey(`pkg:npm/${name}@${component.version}`);
};

const collectCycloneDxPackages = async (packageRoot, packageJson) => {
  const runtimeDependencyNames = Object.keys(packageJson.dependencies ?? {});
  if (runtimeDependencyNames.length === 0) {
    return [];
  }

  const nodeModulesPath = path.join(packageRoot, "node_modules");
  const nodeModulesStats = await statPath(nodeModulesPath);
  if (!nodeModulesStats) {
    throw new Error(
      `node_modules is missing at '${nodeModulesPath}'. Install runtime dependencies before generating SPDX.`
    );
  }

  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-spdx-cyclonedx-"));
  const tempCycloneDxPath = path.join(tempDirectoryPath, "package.cdx.json");

  try {
    await run(
      process.execPath,
      [
        cyclonedxCliPath,
        "--ignore-npm-errors",
        "--omit",
        "dev",
        "--spec-version",
        "1.5",
        "--output-reproducible",
        "--output-file",
        tempCycloneDxPath
      ],
      packageRoot
    );

    const cycloneDxDocument = JSON.parse(await readFile(tempCycloneDxPath, "utf8"));
    const packageByKey = new Map();
    const components = Array.isArray(cycloneDxDocument.components) ? cycloneDxDocument.components : [];

    for (const component of components) {
      if (
        !component ||
        typeof component !== "object" ||
        typeof component.name !== "string" ||
        typeof component.version !== "string"
      ) {
        continue;
      }

      const packageName =
        typeof component.group === "string" && component.group.length > 0
          ? `${component.group}/${component.name}`
          : component.name;
      packageByKey.set(packageKeyFromCycloneDxComponent(component), {
        packageName,
        packagePurl:
          typeof component.purl === "string" && component.purl.length > 0
            ? normalizePackageKey(component.purl)
            : normalizePackageKey(`pkg:npm/${packageName}@${component.version}`),
        packageVersion: component.version
      });
    }

    return [...packageByKey.values()].sort((first, second) => {
      const nameComparison = first.packageName.localeCompare(second.packageName);
      return nameComparison !== 0
        ? nameComparison
        : first.packageVersion.localeCompare(second.packageVersion);
    });
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true });
  }
};

const collectRuntimeDependencyGraph = async (packageRoot, packageJson) => {
  const packages = await collectCycloneDxPackages(packageRoot, packageJson);

  return {
    packages,
    relationships: packages.map((dependencyPackage) => ({
      spdxElementId: toSpdxId(String(packageJson.name), String(packageJson.version)),
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: toSpdxId(dependencyPackage.packageName, dependencyPackage.packageVersion)
    }))
  };
};

const main = async () => {
  const { outputPath, packageRoot } = parseArgs();
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const packageJson = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8")
  );
  const dependencyGraph = await collectRuntimeDependencyGraph(packageRoot, packageJson);
  const rootPackageId = toSpdxId(String(packageJson.name), String(packageJson.version));
  const packages = [
    {
      SPDXID: rootPackageId,
      name: packageJson.name,
      versionInfo: packageJson.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: packageJson.license ?? "NOASSERTION",
      licenseDeclared: packageJson.license ?? "NOASSERTION",
      summary: packageJson.description ?? "",
      primaryPackagePurpose: packageJson.private === true ? "APPLICATION" : "LIBRARY",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${packageJson.name}@${packageJson.version}`
        }
      ]
    },
    ...dependencyGraph.packages.map((dependencyPackage) => ({
      SPDXID: toSpdxId(dependencyPackage.packageName, dependencyPackage.packageVersion),
      name: dependencyPackage.packageName,
      versionInfo: dependencyPackage.packageVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      primaryPackagePurpose: "LIBRARY",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: dependencyPackage.packagePurl
        }
      ]
    }))
  ];

  const timestamp = resolveTimestamp();
  const document = {
    SPDXID: "SPDXRef-DOCUMENT",
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    name: `${packageJson.name}-${packageJson.version}`,
    documentNamespace: `https://spdx.org/spdxdocs/${packageJson.name}-${packageJson.version}`,
    creationInfo: {
      created: timestamp,
      creators: ["Tool: workspace-dev-spdx-generator@1.0.0"]
    },
    documentDescribes: [rootPackageId],
    packages,
    relationships: dependencyGraph.relationships
  };

  await writeFile(`${absoluteOutputPath}`, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`[sbom] SPDX written to ${absoluteOutputPath} (packageRoot=${packageRoot})`);
};

main().catch((error) => {
  console.error("[sbom] SPDX generation failed:", error);
  process.exit(1);
});
