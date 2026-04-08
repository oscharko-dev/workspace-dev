import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as contracts from "./contracts/index.js";
import * as publicApi from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractChangelogPath = path.resolve(__dirname, "../CONTRACT_CHANGELOG.md");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EXPECTED_CONTRACT_RUNTIME_EXPORTS = ["CONTRACT_VERSION"].sort();

const EXPECTED_PUBLIC_RUNTIME_EXPORTS = [
  "DEFAULT_CAPTURE_CONFIG",
  "DEFAULT_DIFF_CONFIG",
  "DEFAULT_VIEWPORT",
  "CONTRACT_VERSION",
  "captureFromProject",
  "captureScreenshot",
  "comparePngBuffers",
  "comparePngFiles",
  "createProjectInstance",
  "createWorkspaceServer",
  "enforceModeLock",
  "getProjectInstance",
  "getWorkspaceDefaults",
  "listProjectInstances",
  "registerIsolationProcessCleanup",
  "resolveCaptureConfig",
  "removeAllInstances",
  "removeProjectInstance",
  "unregisterIsolationProcessCleanup",
  "validateModeLock",
  "waitWithTimeout",
  "writeDiffImage"
].sort();

test("contract surface: contracts runtime exports match snapshot", () => {
  const actualExports = Object.keys(contracts).sort();
  assert.deepEqual(
    actualExports,
    EXPECTED_CONTRACT_RUNTIME_EXPORTS,
    `Contract runtime exports changed. Actual: [${actualExports.join(", ")}], expected: [${EXPECTED_CONTRACT_RUNTIME_EXPORTS.join(", ")}].`
  );
});

test("public API surface: runtime exports match snapshot", () => {
  const actualExports = Object.keys(publicApi).sort();
  assert.deepEqual(
    actualExports,
    EXPECTED_PUBLIC_RUNTIME_EXPORTS,
    `Public API runtime exports changed. Actual: [${actualExports.join(", ")}], expected: [${EXPECTED_PUBLIC_RUNTIME_EXPORTS.join(", ")}].`
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
