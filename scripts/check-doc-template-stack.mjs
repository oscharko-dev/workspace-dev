#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const resolvePathFromEnv = ({ envName, fallbackRelativePath }) => {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return path.resolve(packageRoot, fallbackRelativePath);
  }
  return path.isAbsolute(raw) ? raw : path.resolve(packageRoot, raw);
};

const pipelineDocPath = resolvePathFromEnv({
  envName: "WORKSPACE_DEV_PIPELINE_DOC_PATH",
  fallbackRelativePath: "PIPELINE.md"
});
const templatePackageJsonPath = resolvePathFromEnv({
  envName: "WORKSPACE_DEV_TEMPLATE_PACKAGE_JSON_PATH",
  fallbackRelativePath: "template/react-mui-app/package.json"
});

const extractMajorFromRange = ({ label, value }) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing or invalid '${label}' version range in template package metadata.`);
  }
  const match = value.match(/(\d+)(?:\.\d+){0,2}/);
  if (!match) {
    throw new Error(`Could not parse major version for '${label}' from '${value}'.`);
  }
  return Number.parseInt(match[1], 10);
};

const readTemplateMajors = async () => {
  const raw = await readFile(templatePackageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const dependencies = parsed.dependencies ?? {};
  const devDependencies = parsed.devDependencies ?? {};

  return {
    react: extractMajorFromRange({ label: "react", value: dependencies.react }),
    mui: extractMajorFromRange({ label: "@mui/material", value: dependencies["@mui/material"] }),
    vite: extractMajorFromRange({ label: "vite", value: devDependencies.vite })
  };
};

const readDocumentedMajors = async () => {
  const pipeline = await readFile(pipelineDocPath, "utf8");
  const match = pipeline.match(/React\s+(\d+)\s*\+\s*MUI\s+v(\d+)\s*\+\s*Vite\s+(\d+)/);
  if (!match) {
    throw new Error(
      "Could not find stack marker in PIPELINE.md. Expected format: 'React <major> + MUI v<major> + Vite <major>'."
    );
  }
  return {
    react: Number.parseInt(match[1], 10),
    mui: Number.parseInt(match[2], 10),
    vite: Number.parseInt(match[3], 10)
  };
};

const formatStack = ({ react, mui, vite }) => {
  return `React ${react} + MUI v${mui} + Vite ${vite}`;
};

const main = async () => {
  const expected = await readTemplateMajors();
  const documented = await readDocumentedMajors();

  const mismatches = [
    expected.react !== documented.react ? "React" : "",
    expected.mui !== documented.mui ? "MUI" : "",
    expected.vite !== documented.vite ? "Vite" : ""
  ].filter((item) => item.length > 0);

  if (mismatches.length > 0) {
    console.error("[docs-template-stack] Version consistency check failed.");
    console.error(`[docs-template-stack] Mismatched majors: ${mismatches.join(", ")}`);
    console.error(`[docs-template-stack] Template package: ${templatePackageJsonPath}`);
    console.error(`[docs-template-stack] Pipeline doc: ${pipelineDocPath}`);
    console.error(`[docs-template-stack] Expected: ${formatStack(expected)}`);
    console.error(`[docs-template-stack] Found: ${formatStack(documented)}`);
    process.exit(1);
  }

  console.log("[docs-template-stack] Version consistency check passed.");
  console.log(`[docs-template-stack] ${formatStack(expected)}`);
};

main().catch((error) => {
  console.error("[docs-template-stack] Failed:", error);
  process.exit(1);
});
