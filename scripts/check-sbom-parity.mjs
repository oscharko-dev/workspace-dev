#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProfileGateArgs,
  profilesFromIds,
  sbomDocumentsForProfile,
} from "./profile-gate-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_EXPECTED_DOCUMENTS = [
  {
    label: "workspace-dev",
    cyclonedxFileName: "workspace-dev.cdx.json",
    spdxFileName: "workspace-dev.spdx.json"
  },
  {
    label: "figma-generated-app-react-mui",
    cyclonedxFileName: "figma-generated-app-react-mui.cdx.json",
    spdxFileName: "figma-generated-app-react-mui.spdx.json"
  },
  {
    label: "figma-generated-app-react-tailwind",
    cyclonedxFileName: "figma-generated-app-react-tailwind.cdx.json",
    spdxFileName: "figma-generated-app-react-tailwind.spdx.json"
  }
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  let directory = "artifacts/sbom";
  const profileArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    if (current === "--directory") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value for --directory.");
      }
      directory = next;
      index += 1;
      continue;
    }
    if (current.startsWith("--directory=")) {
      directory = current.slice("--directory=".length);
      continue;
    }
    if (current === "--profile" || current === "-p") {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      profileArgs.push(current, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      profileArgs.push(current);
      continue;
    }
    directory = current;
  }

  const { profileIds } =
    profileArgs.length > 0
      ? parseProfileGateArgs(profileArgs)
      : { profileIds: [] };

  return {
    directory: path.resolve(repoRoot, directory),
    expectedDocuments:
      profileIds.length > 0
        ? profilesFromIds(profileIds).flatMap((profile) =>
            sbomDocumentsForProfile(profile),
          )
        : DEFAULT_EXPECTED_DOCUMENTS
  };
};

const normalizePackageKey = (value) => {
  const decodedValue = decodeURIComponent(value);
  const queryIndex = decodedValue.indexOf("?");
  const fragmentIndex = decodedValue.indexOf("#");
  const endIndexCandidates = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const endIndex = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : decodedValue.length;
  return decodedValue.slice(0, endIndex);
};

const toPackageKey = (name, version, group) => {
  const normalizedName = typeof group === "string" && group.length > 0 ? `${group}/${name}` : name;
  return normalizePackageKey(`${normalizedName}@${version}`);
};

const collectCycloneDxPackageKeys = (document) => {
  const packageKeys = new Set();
  const components = [];

  if (document?.metadata?.component) {
    components.push(document.metadata.component);
  }
  if (Array.isArray(document?.components)) {
    components.push(...document.components);
  }

  for (const component of components) {
    if (
      !component ||
      typeof component !== "object" ||
      typeof component.name !== "string" ||
      typeof component.version !== "string"
    ) {
      continue;
    }
    if (typeof component.purl === "string" && component.purl.length > 0) {
      packageKeys.add(normalizePackageKey(component.purl));
      continue;
    }
    packageKeys.add(toPackageKey(component.name, component.version, component.group));
  }

  return packageKeys;
};

const collectSpdxPackageKeys = (document) => {
  const packageKeys = new Set();
  const packages = Array.isArray(document?.packages) ? document.packages : [];

  for (const packageEntry of packages) {
    if (
      !packageEntry ||
      typeof packageEntry !== "object" ||
      typeof packageEntry.name !== "string" ||
      typeof packageEntry.versionInfo !== "string"
    ) {
      continue;
    }
    const purlRef = Array.isArray(packageEntry.externalRefs)
      ? packageEntry.externalRefs.find(
          (reference) =>
            reference &&
            typeof reference === "object" &&
            reference.referenceType === "purl" &&
            typeof reference.referenceLocator === "string"
        )
      : null;
    if (purlRef) {
      packageKeys.add(normalizePackageKey(purlRef.referenceLocator));
      continue;
    }
    packageKeys.add(toPackageKey(packageEntry.name, packageEntry.versionInfo));
  }

  return packageKeys;
};

const diffSets = (expected, actual) => {
  return [...expected].filter((value) => !actual.has(value)).sort((first, second) => first.localeCompare(second));
};

const verifyDocumentPair = async ({ directory, label, cyclonedxFileName, spdxFileName }) => {
  const cyclonedxPath = path.resolve(directory, cyclonedxFileName);
  const spdxPath = path.resolve(directory, spdxFileName);
  const cyclonedxDocument = JSON.parse(await readFile(cyclonedxPath, "utf8"));
  const spdxDocument = JSON.parse(await readFile(spdxPath, "utf8"));

  const cyclonedxPackages = collectCycloneDxPackageKeys(cyclonedxDocument);
  const spdxPackages = collectSpdxPackageKeys(spdxDocument);
  const missingFromSpdx = diffSets(cyclonedxPackages, spdxPackages);
  const missingFromCycloneDx = diffSets(spdxPackages, cyclonedxPackages);

  if (missingFromSpdx.length > 0 || missingFromCycloneDx.length > 0) {
    const details = [
      missingFromSpdx.length > 0
        ? `missing from SPDX: ${missingFromSpdx.join(", ")}`
        : null,
      missingFromCycloneDx.length > 0
        ? `missing from CycloneDX: ${missingFromCycloneDx.join(", ")}`
        : null
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`[sbom-parity] ${label} mismatch. ${details}`);
  }

  console.log(`[sbom-parity] ${label} matched ${spdxPackages.size} packages.`);
};

const main = async () => {
  const { directory, expectedDocuments } = parseArgs();
  for (const documentDefinition of expectedDocuments) {
    await verifyDocumentPair({
      directory,
      ...documentDefinition
    });
  }
};

main().catch((error) => {
  console.error("[sbom-parity] Failed:", error);
  process.exit(1);
});
