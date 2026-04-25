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
  "ALLOWED_LLM_GATEWAY_AUTH_MODES",
  "ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES",
  "ALLOWED_LLM_GATEWAY_ERROR_CLASSES",
  "ALLOWED_LLM_GATEWAY_ROLES",
  "ALLOWED_TEST_CASE_POLICY_DECISIONS",
  "ALLOWED_TEST_CASE_POLICY_OUTCOMES",
  "ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES",
  "ALLOWED_TEST_INTELLIGENCE_MODES",
  "ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES",
  "ALLOWED_WORKSPACE_JOB_TYPES",
  "BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION",
  "CONTRACT_VERSION",
  "EU_BANKING_DEFAULT_POLICY_PROFILE_ID",
  "EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION",
  "GENERATED_TESTCASES_ARTIFACT_FILENAME",
  "GENERATED_TEST_CASE_SCHEMA_VERSION",
  "LLM_CAPABILITIES_ARTIFACT_FILENAME",
  "LLM_CAPABILITIES_SCHEMA_VERSION",
  "LLM_GATEWAY_CONTRACT_VERSION",
  "REDACTION_POLICY_VERSION",
  "TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION",
  "TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_POLICY_REPORT_SCHEMA_VERSION",
  "TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION",
  "TEST_INTELLIGENCE_CONTRACT_VERSION",
  "TEST_INTELLIGENCE_ENV",
  "TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION",
  "VISUAL_SIDECAR_SCHEMA_VERSION",
  "VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME",
  "VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION",
].sort();

const EXPECTED_PUBLIC_RUNTIME_EXPORTS = [
  "ALLOWED_FIGMA_SOURCE_MODES",
  "ALLOWED_LLM_CODEGEN_MODES",
  "ALLOWED_LLM_GATEWAY_AUTH_MODES",
  "ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES",
  "ALLOWED_LLM_GATEWAY_ERROR_CLASSES",
  "ALLOWED_LLM_GATEWAY_ROLES",
  "ALLOWED_TEST_CASE_POLICY_DECISIONS",
  "ALLOWED_TEST_CASE_POLICY_OUTCOMES",
  "ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES",
  "ALLOWED_TEST_INTELLIGENCE_MODES",
  "ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES",
  "ALLOWED_WORKSPACE_JOB_TYPES",
  "DEFAULT_CAPTURE_CONFIG",
  "DEFAULT_DIFF_CONFIG",
  "DEFAULT_SCORING_CONFIG",
  "DEFAULT_SCORING_WEIGHTS",
  "DEFAULT_VIEWPORT",
  "EU_BANKING_DEFAULT_POLICY_PROFILE_ID",
  "EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION",
  "GENERATED_TESTCASES_ARTIFACT_FILENAME",
  "GENERATED_TEST_CASE_SCHEMA_VERSION",
  "LLM_CAPABILITIES_ARTIFACT_FILENAME",
  "LLM_CAPABILITIES_SCHEMA_VERSION",
  "LLM_GATEWAY_CONTRACT_VERSION",
  "REDACTION_POLICY_VERSION",
  "REDUCED_MOTION_STYLE",
  "CONTRACT_VERSION",
  "TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION",
  "TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_POLICY_REPORT_SCHEMA_VERSION",
  "TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME",
  "TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION",
  "TEST_INTELLIGENCE_CONTRACT_VERSION",
  "TEST_INTELLIGENCE_ENV",
  "TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION",
  "VISUAL_SIDECAR_SCHEMA_VERSION",
  "VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME",
  "VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION",
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
