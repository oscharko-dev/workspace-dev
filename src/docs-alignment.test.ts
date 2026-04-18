import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "./contracts/index.js";
import * as publicApi from "./index.js";
import { getAllowedFigmaSourceModes, getAllowedLlmCodegenModes, getWorkspaceDefaults } from "./mode-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

const EXPECTED_ISOLATION_RUNTIME_EXPORTS = [
  "createProjectInstance",
  "getProjectInstance",
  "listProjectInstances",
  "registerIsolationProcessCleanup",
  "removeAllInstances",
  "removeProjectInstance",
  "unregisterIsolationProcessCleanup",
].sort();

test("docs: mode lock docs stay aligned with runtime constraints", async () => {
  const architectureDoc = await readRepoFile("ARCHITECTURE.md");
  const complianceDoc = await readRepoFile("COMPLIANCE.md");
  const compatibilityDoc = await readRepoFile("COMPATIBILITY.md");
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const localRuntimeDoc = await readRepoFile("docs/local-runtime.md");
  const packageManifest = await readRepoFile("package.json");
  const readmeDoc = await readRepoFile("README.md");
  const securityDoc = await readRepoFile("SECURITY.md");
  const threatModelDoc = await readRepoFile("THREAT_MODEL.md");
  const tsconfigDoc = await readRepoFile("tsconfig.json");
  const schemasSource = await readRepoFile("src/schemas.ts");
  const defaults = getWorkspaceDefaults();
  const figmaModeLock = `figmaSourceMode=${getAllowedFigmaSourceModes().join("|")}`;
  const codegenModeLock = `llmCodegenMode=${getAllowedLlmCodegenModes().join("|")}`;
  const escapedContractVersion = escapeRegExp(CONTRACT_VERSION);

  assert.match(architectureDoc, /MODE_LOCK_VIOLATION/);
  assert.match(architectureDoc, /single-threaded Node\.js event loop invariant/i);
  assert.match(architectureDoc, /not safe for `worker_threads`/i);
  assert.match(architectureDoc, /waits up to 3 seconds for process exit, then falls back to `SIGKILL`/i);
  assert.match(architectureDoc, /best-effort `SIGTERM`/i);
  assert.match(architectureDoc, new RegExp(escapeRegExp(figmaModeLock)));
  assert.match(architectureDoc, new RegExp(escapeRegExp(codegenModeLock)));
  assert.match(architectureDoc, /template\/react-mui-app\/pnpm-lock\.yaml/);
  assert.match(architectureDoc, /package\.json[` ]+`files`|`package\.json` `files`|package\.json `files`/);
  assert.match(architectureDoc, /template:install|--frozen-lockfile/);
  assert.match(architectureDoc, /verify:airgap/);
  assert.match(architectureDoc, /verify:reproducible-build/);
  assert.match(
    localRuntimeDoc,
    new RegExp(
      escapeRegExp(
        `Enforce mode lock (\`${getAllowedFigmaSourceModes().join("|")}\` + \`${getAllowedLlmCodegenModes().join("|")}\`)`
      )
    )
  );
  assert.match(tsconfigDoc, /"moduleResolution": "node16"/);
  assert.match(complianceDoc, /`\.github\/workflows\/changesets-release\.yml`/);
  assert.match(complianceDoc, /`THREAT_MODEL\.md`/);
  assert.doesNotMatch(complianceDoc, /npm-publish\.yml/);
  assert.match(compatibilityDoc, new RegExp(`\\| Contract version \\| \`${escapedContractVersion}\` \\|`));
  assert.match(compatibilityDoc, /\| TypeScript consumer compiler \| 5\.0\.0 \| >=5\.0\.0 \|/);
  assert.match(compatibilityDoc, /TypeScript 4\.x consumers are unsupported and must upgrade to TypeScript `>=5\.0\.0`/);
  assert.match(compatibilityDoc, /\| `figmaSourceMode=hybrid` \| Supported \|/);
  for (const figmaMode of getAllowedFigmaSourceModes()) {
    assert.match(readmeDoc, new RegExp(escapeRegExp(`\`figmaSourceMode=${figmaMode}\``)));
  }
  for (const codegenMode of getAllowedLlmCodegenModes()) {
    assert.match(readmeDoc, new RegExp(escapeRegExp(`\`llmCodegenMode=${codegenMode}\``)));
  }
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
  assert.match(packageManifest, /"THREAT_MODEL\.md"/);
  assert.match(readmeDoc, /## Repository branch flow/i);
  assert.match(readmeDoc, /`dev` is the active development branch/i);
  assert.match(readmeDoc, /`dev-gate` is the protected quality gate branch/i);
  assert.match(readmeDoc, /`main` is the release branch/i);
  assert.match(readmeDoc, /`THREAT_MODEL\.md`/);
  assert.match(readmeDoc, /TypeScript `>=5\.0\.0` for typed package consumption/);
  assert.match(readmeDoc, /published dual ESM\/CJS type surface is validated only for TypeScript 5\+ consumers/i);
  assert.match(securityDoc, /`THREAT_MODEL\.md`/);
  assert.match(
    securityDoc,
    new RegExp(
      escapeRegExp(
        `figmaSourceMode=${getAllowedFigmaSourceModes().join("|")}`
      )
    )
  );
  assert.match(threatModelDoc, /^# THREAT_MODEL/m);
  assert.match(threatModelDoc, /^## Trust Boundaries$/m);
  assert.match(threatModelDoc, /^## Attack Surfaces$/m);
  assert.match(threatModelDoc, /^## Threats, Mitigations, and Residual Risks$/m);
  assert.match(threatModelDoc, /^## Residual Risks and Operator Assumptions$/m);
  assert.match(threatModelDoc, /src\/server\/request-security\.ts/);
  assert.match(threatModelDoc, /src\/job-engine\/local-sync\.ts/);
  assert.match(threatModelDoc, /src\/job-engine\/git-pr\.ts/);
  assert.match(threatModelDoc, /src\/server\/dast-smoke\.e2e\.test\.ts/);
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
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const architectureDoc = await readRepoFile("ARCHITECTURE.md");
  const publicApiSource = await readRepoFile("src/index.ts");
  const isolationAdr = await readRepoFile(
    "docs/decisions/2026-04-18-issue-611-isolation-public-api-surface.md"
  );
  const packageManifest = JSON.parse(await readRepoFile("package.json")) as {
    exports: Record<string, unknown>;
  };
  const actualIsolationExports = EXPECTED_ISOLATION_RUNTIME_EXPORTS.filter((exportName) =>
    Object.prototype.hasOwnProperty.call(publicApi, exportName)
  ).sort();

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
  assert.match(versioningDoc, /root `workspace-dev` entrypoint is also a semver-governed public API surface/i);
  assert.match(versioningDoc, /Breaking changes to existing root exports are governed by package semver/i);
  assert.match(versioningDoc, /`CONTRACT_VERSION` and `CONTRACT_CHANGELOG\.md` govern versioned contract changes in `src\/contracts\/`/);

  assert.match(contributingDoc, /All contract-versioned public types must be defined in `src\/contracts\/`\./);
  assert.match(
    contributingDoc,
    /Semver-governed runtime types exported from the root `workspace-dev` entrypoint[\s\S]*may live outside `src\/contracts\/`/
  );
  assert.match(contributingDoc, /Public contract changes require:/);
  assert.match(contributingDoc, /Public package\/root-entrypoint API changes require:/);
  assert.match(contributingDoc, /Explicit package semver treatment through Changesets and release notes/);

  assert.match(contractChangelog, /### Package alignment policy/);
  assert.match(contractChangelog, /intentionally independent version tracks/i);
  assert.match(contractChangelog, /does not require the checked-in `package\.json` version to change immediately/i);
  assert.match(contractChangelog, /Consumers pin the package version from npm, not `CONTRACT_VERSION`\./);
  assert.match(contractChangelog, /See `VERSIONING\.md` for the full package-versus-contract versioning policy\./);

  assert.match(readmeDoc, /## Public API entrypoints/i);
  assert.match(readmeDoc, /`workspace-dev\/contracts`/);
  assert.match(readmeDoc, /### Advanced isolation lifecycle API/i);
  assert.match(readmeDoc, /`ProjectInstance`/);
  assert.match(readmeDoc, /Per-project helpers:/);
  assert.match(readmeDoc, /Process-level lifecycle controls:/);
  assert.match(readmeDoc, /stable advanced surface/i);
  assert.match(readmeDoc, /not experimental or internal-only today/i);

  assert.match(isolationAdr, /^# ADR: Issue #611 Isolation Public API Surface/m);
  assert.match(isolationAdr, /Keep the isolation helpers on the root `workspace-dev` entrypoint/);
  assert.match(isolationAdr, /Moved in this decision:\s*\n\s*-\s*None/);
  assert.match(isolationAdr, /Advanced stable surface for embedders and orchestration hosts:/);
  assert.match(isolationAdr, /`workspace-dev\/isolation` does not exist today/i);
  assert.match(isolationAdr, /## Isolation API Classification/);

  assert.match(architectureDoc, /supported public API, but they are an advanced orchestration surface/i);
  assert.match(architectureDoc, /Typical consumers should prefer `createWorkspaceServer`/);
  assert.match(architectureDoc, /future move to a dedicated subpath must be treated as a compatibility-managed public API change/i);

  assert.deepEqual(actualIsolationExports, EXPECTED_ISOLATION_RUNTIME_EXPORTS);
  assert.match(publicApiSource, /export type \{ ProjectInstance \} from "\.\/isolation\.js";/);
  assert.deepEqual(Object.keys(packageManifest.exports).sort(), [".", "./contracts"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(packageManifest.exports, "./isolation"));

  assert.match(contractsSource, /VERSIONING\.md/);
});

test("docs: figma direct-import guide stays aligned with inspector submit flow", async () => {
  const figmaImportDoc = await readRepoFile("docs/figma-import.md");
  const pluginTestingDoc = await readRepoFile("plugin/TESTING.md");

  assert.match(
    figmaImportDoc,
    /Open `http:\/\/127\.0\.0\.1:1983\/workspace\/ui\/inspector`\./,
  );
  assert.match(figmaImportDoc, /`figmaSourceMode=figma_url`/);
  assert.match(
    figmaImportDoc,
    /normalizes\s+that inspector-only alias to `hybrid`/i,
  );
  assert.match(figmaImportDoc, /not\s+part of the public mode-lock surface/i);
  assert.doesNotMatch(figmaImportDoc, /signed JSON envelope/i);
  assert.doesNotMatch(
    figmaImportDoc,
    /\| Enter Figma URL\s+\|[^\n]*figmaSourceMode=rest/i,
  );
  assert.match(
    pluginTestingDoc,
    /No nodes selected\. Please select at least one layer\./,
  );
});

test("docs: security governance docs stay aligned with GHSA workflow", async () => {
  const securityDoc = await readRepoFile("SECURITY.md");
  const securityPointer = await readRepoFile(".github/SECURITY.yml");
  const issueTemplateConfig = await readRepoFile(".github/ISSUE_TEMPLATE/config.yml");
  const pullRequestTemplate = await readRepoFile(".github/pull_request_template.md");

  assert.match(securityDoc, /GitHub private vulnerability reporting/i);
  assert.match(securityDoc, /Do not disclose unpublished vulnerabilities in public issues, PRs, or commit messages\./);
  assert.match(securityDoc, /## GHSA Maintainer Checklist/);
  assert.match(securityDoc, /draft GitHub Security Advisory \(GHSA\)/);
  assert.match(securityDoc, /affected version ranges/i);
  assert.match(securityDoc, /Request or attach a CVE/i);
  assert.match(securityDoc, /Publish the patched release before disclosure whenever possible/i);
  assert.match(securityPointer, /GitHub recognizes SECURITY\.md as the repository security policy surface\./);
  assert.match(securityPointer, /private vulnerability reporting, GHSA workflow, CVE handling, and coordinated disclosure guidance/i);
  assert.match(securityPointer, /canonical_policy: SECURITY\.md/);
  assert.match(issueTemplateConfig, /blank_issues_enabled:\s*false/);
  assert.match(issueTemplateConfig, /name:\s*Security disclosures/);
  assert.match(issueTemplateConfig, /mailto:security@oscharko\.dev/);
  assert.match(issueTemplateConfig, /Do not open public security issues\./);
  assert.match(pullRequestTemplate, /If this PR fixes a publicly disclosed security issue, link the GHSA here\./);
  assert.match(pullRequestTemplate, /If the fix is not yet public, do not disclose details in this template; follow `SECURITY\.md`\./);
});
