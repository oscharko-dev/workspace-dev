#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

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

const main = async () => {
  const { outputPath, packageRoot } = parseArgs();
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const packageJson = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8")
  );

  const runtimeDependencyEntries = Object.entries(packageJson.dependencies ?? {}).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const rootPackageId = `SPDXRef-Package-${String(packageJson.name).replace(/[^a-zA-Z0-9.-]/g, "-")}`;
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
    }
  ];

  const relationships = [];
  for (const [dependencyName, versionRange] of runtimeDependencyEntries) {
    const dependencyId = `SPDXRef-Package-${dependencyName.replace(/[^a-zA-Z0-9.-]/g, "-")}`;
    packages.push({
      SPDXID: dependencyId,
      name: dependencyName,
      versionInfo: versionRange,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      primaryPackagePurpose: "LIBRARY"
    });
    relationships.push({
      spdxElementId: rootPackageId,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: dependencyId
    });
  }

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
    relationships
  };

  await writeFile(`${absoluteOutputPath}`, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`[sbom] SPDX written to ${absoluteOutputPath} (packageRoot=${packageRoot})`);
};

main().catch((error) => {
  console.error("[sbom] SPDX generation failed:", error);
  process.exit(1);
});
