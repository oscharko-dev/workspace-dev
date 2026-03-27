import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "./contracts/index.js";
import { getAllowedFigmaSourceModes, getAllowedLlmCodegenModes, getWorkspaceDefaults } from "./mode-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("docs: mode lock docs stay aligned with runtime constraints", async () => {
  const architectureDoc = await readRepoFile("ARCHITECTURE.md");
  const claudeDoc = await readRepoFile("CLAUDE.md");
  const complianceDoc = await readRepoFile("COMPLIANCE.md");
  const compatibilityDoc = await readRepoFile("COMPATIBILITY.md");
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const readmeDoc = await readRepoFile("README.md");
  const schemasSource = await readRepoFile("src/schemas.ts");
  const docsToCheck = [architectureDoc, claudeDoc];
  const defaults = getWorkspaceDefaults();
  const figmaModeLock = `figmaSourceMode=${getAllowedFigmaSourceModes().join("|")}`;
  const codegenModeLock = `llmCodegenMode=${getAllowedLlmCodegenModes().join("|")}`;
  const escapedContractVersion = escapeRegExp(CONTRACT_VERSION);

  for (const document of docsToCheck) {
    assert.match(document, new RegExp(escapeRegExp(figmaModeLock)));
    assert.match(document, new RegExp(escapeRegExp(codegenModeLock)));
  }

  assert.match(architectureDoc, /MODE_LOCK_VIOLATION/);
  assert.match(architectureDoc, /single-threaded Node\.js event loop invariant/i);
  assert.match(architectureDoc, /not safe for `worker_threads`/i);
  assert.match(architectureDoc, /waits up to 3 seconds for process exit, then falls back to `SIGKILL`/i);
  assert.match(architectureDoc, /best-effort `SIGTERM`/i);
  assert.match(architectureDoc, /template\/react-mui-app\/pnpm-lock\.yaml/);
  assert.match(architectureDoc, /package\.json[` ]+`files`|`package\.json` `files`|package\.json `files`/);
  assert.match(architectureDoc, /template:install|--frozen-lockfile/);
  assert.match(architectureDoc, /verify:airgap/);
  assert.match(architectureDoc, /verify:reproducible-build/);
  assert.match(claudeDoc, /figmaSourceMode=rest\|hybrid\|local_json/);
  assert.match(claudeDoc, /module resolution `node16`/);
  assert.match(complianceDoc, /`\.github\/workflows\/changesets-release\.yml`/);
  assert.doesNotMatch(complianceDoc, /npm-publish\.yml/);
  assert.match(compatibilityDoc, new RegExp(`\\| Contract version \\| \`${escapedContractVersion}\` \\|`));
  assert.match(compatibilityDoc, /\| TypeScript consumer compiler \| 5\.0\.0 \| >=5\.0\.0 \|/);
  assert.match(compatibilityDoc, /TypeScript 4\.x consumers are unsupported and must upgrade to TypeScript `>=5\.0\.0`/);
  assert.match(compatibilityDoc, /\| `figmaSourceMode=hybrid` \| Supported \|/);
  assert.match(contributingDoc, /feature branch from `dev`/);
  assert.match(contributingDoc, /PR targeting `dev`/);
  assert.match(contributingDoc, /dev -> dev-gate -> main/);
  assert.match(contributingDoc, /## Adding new validated fields/);
  assert.match(contributingDoc, /allowedKeys/);
  assert.match(contributingDoc, /formatZodError/);
  assert.match(contributingDoc, /unexpected-property rejection/);
  assert.match(schemasSource, /Validation conventions in this module:/);
  assert.match(schemasSource, /Guard unknown input with `isRecord` before reading object fields\./);
  assert.match(schemasSource, /Define an explicit `allowedKeys` set for each object schema and reject/);
  assert.match(schemasSource, /Collect failures in `ValidationIssue\[\]` with stable paths and messages/);
  assert.match(readmeDoc, /## Repository branch flow/i);
  assert.match(readmeDoc, /`dev` is the active development branch/i);
  assert.match(readmeDoc, /`dev-gate` is the protected quality gate branch/i);
  assert.match(readmeDoc, /`main` is the release branch/i);
  assert.match(readmeDoc, /TypeScript `>=5\.0\.0` for typed package consumption/);
  assert.match(readmeDoc, /published dual ESM\/CJS type surface is validated only for TypeScript 5\+ consumers/i);
  assert.equal(defaults.figmaSourceMode, "rest");
  assert.equal(defaults.llmCodegenMode, "deterministic");
});

test("docs: validation and app template source contain expected pipeline patterns", async () => {
  const validationSource = await readRepoFile("src/job-engine/validation.ts");
  const appTemplateSource = await readRepoFile("src/parity/templates/app-template.ts");

  assert.match(validationSource, /args: \["lint", "--fix"\]/);
  assert.match(validationSource, /args: \["run", "test"\]/);
  assert.match(validationSource, /args: \["run", "validate:ui"\]/);
  assert.match(validationSource, /args: \["run", "perf:assert"\]/);
  assert.match(appTemplateSource, /BrowserRouter/);
  assert.match(appTemplateSource, /HashRouter/);
});

test("docs: versioning policy stays aligned across README and changelogs", async () => {
  const readmeDoc = await readRepoFile("README.md");
  const versioningDoc = await readRepoFile("VERSIONING.md");
  const contractChangelog = await readRepoFile("CONTRACT_CHANGELOG.md");
  const contractsSource = await readRepoFile("src/contracts/index.ts");

  assert.match(readmeDoc, /## Versioning strategy/i);
  assert.match(readmeDoc, /`VERSIONING\.md`/);
  assert.match(readmeDoc, /Pin the npm package version in your own `package\.json`/);
  assert.match(readmeDoc, /Use `CONTRACT_VERSION` for compatibility audits/i);
  assert.match(readmeDoc, /`CHANGELOG\.md` tracks package release history/i);
  assert.match(readmeDoc, /`CONTRACT_CHANGELOG\.md` tracks public contract history/i);

  assert.match(versioningDoc, /two independent version tracks/i);
  assert.match(versioningDoc, /consumers install and pin in their own `package\.json`/i);
  assert.match(versioningDoc, /do not need to match numerically/i);
  assert.match(versioningDoc, /Every public contract change must bump `CONTRACT_VERSION`/);
  assert.match(versioningDoc, /npm and GitHub Releases are the authoritative sources for published package versions/i);

  assert.match(contractChangelog, /### Package alignment policy/);
  assert.match(contractChangelog, /intentionally independent version tracks/i);
  assert.match(contractChangelog, /does not require the checked-in `package\.json` version to change immediately/i);
  assert.match(contractChangelog, /Consumers pin the package version from npm, not `CONTRACT_VERSION`\./);
  assert.match(contractChangelog, /See `VERSIONING\.md` for the full package-versus-contract versioning policy\./);

  assert.match(contractsSource, /VERSIONING\.md/);
});
