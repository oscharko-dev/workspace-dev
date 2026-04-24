import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as contracts from "./contracts/index.js";
import * as publicApi from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractChangelogPath = path.resolve(
  __dirname,
  "../CONTRACT_CHANGELOG.md",
);
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EXPECTED_CONTRACT_RUNTIME_EXPORTS = [
  "ALLOWED_FIGMA_SOURCE_MODES",
  "ALLOWED_LLM_CODEGEN_MODES",
  "CONTRACT_VERSION",
].sort();

const EXPECTED_PUBLIC_RUNTIME_EXPORTS = [
  "ALLOWED_FIGMA_SOURCE_MODES",
  "ALLOWED_LLM_CODEGEN_MODES",
  "DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT",
  "DEFAULT_TEST_SPACE_QC_WRITE_ENABLED",
  "DEFAULT_CAPTURE_CONFIG",
  "DEFAULT_DIFF_CONFIG",
  "DEFAULT_SCORING_CONFIG",
  "DEFAULT_SCORING_WEIGHTS",
  "DEFAULT_VIEWPORT",
  "REDUCED_MOTION_STYLE",
  "CONTRACT_VERSION",
  "WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV",
  "WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV",
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV",
  "WORKSPACE_TEST_SPACE_QC_BASE_URL_ENV",
  "WORKSPACE_TEST_SPACE_QC_CLIENT_ID_ENV",
  "WORKSPACE_TEST_SPACE_QC_CLIENT_SECRET_ENV",
  "WORKSPACE_TEST_SPACE_QC_DOMAIN_ENV",
  "WORKSPACE_TEST_SPACE_QC_PROJECT_ENV",
  "WORKSPACE_TEST_SPACE_QC_WRITE_ENABLED_ENV",
  "VisualDiffCorruptPngError",
  "VisualDiffDimensionMismatchError",
  "VisualDiffReferenceMissingError",
  "VisualDiffTestMissingError",
  "captureFromProject",
  "captureScreenshot",
  "comparePngBuffers",
  "comparePngFiles",
  "computeVisualQualityReport",
  "createProjectInstance",
  "createWorkspaceServer",
  "enforceModeLock",
  "getProjectInstance",
  "getWorkspaceDefaults",
  "interpretScore",
  "listProjectInstances",
  "registerIsolationProcessCleanup",
  "resolveCaptureConfig",
  "resolveCaptureContextOptions",
  "resolveCaptureContextOptionsForBrowser",
  "removeAllInstances",
  "removeProjectInstance",
  "unregisterIsolationProcessCleanup",
  "validateModeLock",
  "waitWithTimeout",
  "writeDiffImage",
].sort();

test("contract surface: contracts runtime exports match snapshot", () => {
  const actualExports = Object.keys(contracts).sort();
  assert.deepEqual(
    actualExports,
    EXPECTED_CONTRACT_RUNTIME_EXPORTS,
    `Contract runtime exports changed. Actual: [${actualExports.join(", ")}], expected: [${EXPECTED_CONTRACT_RUNTIME_EXPORTS.join(", ")}].`,
  );
});

test("public API surface: runtime exports match snapshot", () => {
  const actualExports = Object.keys(publicApi).sort();
  assert.deepEqual(
    actualExports,
    EXPECTED_PUBLIC_RUNTIME_EXPORTS,
    `Public API runtime exports changed. Actual: [${actualExports.join(", ")}], expected: [${EXPECTED_PUBLIC_RUNTIME_EXPORTS.join(", ")}].`,
  );
});

test("contract surface: CONTRACT_VERSION is a valid semver string", () => {
  assert.equal(typeof contracts.CONTRACT_VERSION, "string");
  assert.match(contracts.CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
});

test("contract process gate: changelog contains current contract version heading", async () => {
  const changelog = await readFile(contractChangelogPath, "utf8");
  const heading = `## [${contracts.CONTRACT_VERSION}]`;
  assert.match(changelog, new RegExp(`^${escapeRegExp(heading)}`, "m"));
});
