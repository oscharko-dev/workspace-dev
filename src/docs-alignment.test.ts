import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "./contracts/index.js";
import * as publicApi from "./index.js";
import { getAllowedFigmaSourceModes, getAllowedLlmCodegenModes, getWorkspaceDefaults } from "./mode-lock.js";
import { PASTE_ERROR_CATALOG } from "../ui-src/src/features/workspace/inspector/paste-error-catalog.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

const extractMarkdownSection = (
  markdown: string,
  heading: string,
): string | null => {
  const escapedHeading = escapeRegExp(heading);
  const match = markdown.match(
    new RegExp(
      `^### ${escapedHeading}$([\\s\\S]*?)(?=^## |^### |\\Z)`,
      "m",
    ),
  );
  return match ? match[0] : null;
};

const extractMarkdownTopLevelSection = (
  markdown: string,
  heading: string,
): string | null => {
  const escapedHeading = escapeRegExp(heading);
  const match = markdown.match(
    new RegExp(
      `^## ${escapedHeading}$([\\s\\S]*?)(?=^## |\\Z)`,
      "m",
    ),
  );
  return match ? match[0] : null;
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

const EXPECTED_FIGMA_IMPORT_QUALITY_GOVERNANCE_HEADINGS = [
  "Quality and governance",
  "Pre-flight quality score",
  "Token matching intelligence",
  "Post-gen review nudges",
  "Review stepper and audit trail",
  "Workspace inspector policy (`.workspace-inspector-policy.json`)",
] as const;

const EXPECTED_FIGMA_IMPORT_SCOPE_HEADINGS = [
  "Scope, re-import, and delta mode",
  "Multi-select scope and `Generate Selected`",
  "Re-import prompt and update diff",
  "Import history and replay",
  "URL entry and frame targeting",
  "Delta mode, fallback, and cache invalidation",
] as const;

const EXPECTED_FIGMA_IMPORT_POLICY_KEYS = [
  "quality.bandThresholds.excellent",
  "quality.bandThresholds.good",
  "quality.bandThresholds.fair",
  "quality.weights.structure",
  "quality.weights.semantic",
  "quality.weights.codegen",
  "quality.maxAcceptableDepth",
  "quality.maxAcceptableNodes",
  "quality.riskSeverityOverrides",
  "tokens.autoAcceptConfidence",
  "tokens.maxConflictDelta",
  "tokens.disabled",
  "a11y.wcagLevel",
  "a11y.disabledRules",
  "governance.minQualityScoreToApply",
  "governance.securitySensitivePatterns",
  "governance.requireNoteOnOverride",
] as const;

const EXPECTED_FIGMA_IMPORT_ERROR_ALIAS_CODES = [
  "EMPTY_INPUT",
  "INVALID_PAYLOAD",
  "TOO_LARGE",
  "UNSUPPORTED_FORMAT",
  "UNSUPPORTED_CLIPBOARD_KIND",
  "UNSUPPORTED_FIGMA_CLIPBOARD_HTML",
  "UNSUPPORTED_TEXT_PASTE",
  "UNSUPPORTED_UNKNOWN_PASTE",
  "UNSUPPORTED_FILE",
  "SECURE_CONTEXT_MISSING",
] as const;

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
  assert.match(contributingDoc, /\[GOVERNANCE\.md\]\(GOVERNANCE\.md\)/);
  assert.match(contributingDoc, /## Adding new validated fields/);
  assert.match(contributingDoc, /allowedKeys/);
  assert.match(contributingDoc, /formatZodError/);
  assert.match(contributingDoc, /unexpected-property rejection/);
  assert.match(schemasSource, /Validation conventions in this module:/);
  assert.match(schemasSource, /Guard unknown input with `isRecord` before reading object fields\./);
  assert.match(schemasSource, /Define an explicit `allowedKeys` set for each object schema and reject/);
  assert.match(schemasSource, /Collect failures in `ValidationIssue\[\]` with stable paths and messages/);
  assert.match(packageManifest, /"THREAT_MODEL\.md"/);
  assert.match(packageManifest, /"GOVERNANCE\.md"/);
  assert.match(readmeDoc, /## Repository branch flow/i);
  assert.match(readmeDoc, /`dev` is the active development branch/i);
  assert.match(readmeDoc, /`dev-gate` is the protected quality gate branch/i);
  assert.match(readmeDoc, /`main` is the release branch/i);
  assert.match(readmeDoc, /\[GOVERNANCE\.md\]\(GOVERNANCE\.md\)/);
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

test("docs: troubleshooting guide is linked from README and included in the published package", async () => {
  const packageManifest = JSON.parse(await readRepoFile("package.json")) as {
    files?: string[];
  };
  const readmeDoc = await readRepoFile("README.md");
  const troubleshootingDoc = await readRepoFile("TROUBLESHOOTING.md");
  const nodeSection = extractMarkdownTopLevelSection(troubleshootingDoc, "Node.js Version Mismatch");
  const pnpmSection = extractMarkdownTopLevelSection(troubleshootingDoc, "pnpm Install / Cache Failures");
  const portSection = extractMarkdownTopLevelSection(troubleshootingDoc, "Port 1983 Collision");
  const figmaSourceModeSection = extractMarkdownTopLevelSection(troubleshootingDoc, "figmaSourceMode Input Errors");
  const validateProjectSection = extractMarkdownTopLevelSection(
    troubleshootingDoc,
    "Validation Stage Failures (`validate.project`)",
  );
  const templateDependencySection = extractMarkdownTopLevelSection(
    troubleshootingDoc,
    "Template Dependency Issues",
  );

  assert.ok(packageManifest.files?.includes("TROUBLESHOOTING.md"));
  assert.match(readmeDoc, /\[TROUBLESHOOTING\.md\]\(TROUBLESHOOTING\.md\)/);
  assert.match(troubleshootingDoc, /^# TROUBLESHOOTING$/m);
  for (const section of [
    nodeSection,
    pnpmSection,
    portSection,
    figmaSourceModeSection,
    validateProjectSection,
    templateDependencySection,
  ]) {
    assert.ok(section);
    assert.match(section, /\*\*Symptom\*\*/);
    assert.match(section, /\*\*Cause\*\*/);
    assert.match(section, /\*\*Resolution\*\*/);
  }
  assert.match(nodeSection ?? "", /Node\.js `>=22\.0\.0`/);
  assert.match(nodeSection ?? "", /nvm use/);
  assert.match(pnpmSection ?? "", /network or registry path is unavailable/);
  assert.match(pnpmSection ?? "", /pnpm store prune/);
  assert.match(portSection ?? "", /lsof -i :1983/);
  assert.match(portSection ?? "", /FIGMAPIPE_WORKSPACE_PORT=21983/);
  assert.match(figmaSourceModeSection ?? "", /use only `rest`, `hybrid`, or `local_json`/);
  assert.match(figmaSourceModeSection ?? "", /test -f \/absolute\/path\/to\/figma\.json/);
  assert.match(validateProjectSection ?? "", /TypeScript errors, ESLint violations, or generated-project install failures/);
  assert.match(validateProjectSection ?? "", /pnpm run template:install/);
  assert.match(templateDependencySection ?? "", /template\/react-mui-app\/pnpm-lock\.yaml/);
  assert.match(templateDependencySection ?? "", /pnpm install --frozen-lockfile/);
});

test("docs: versioning policy stays aligned across README and changelogs", async () => {
  const readmeDoc = await readRepoFile("README.md");
  const versioningDoc = await readRepoFile("VERSIONING.md");
  const migrationGuide = await readRepoFile("docs/migration-guide.md");
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
    files?: string[];
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
  assert.match(readmeDoc, /## Migration/i);
  assert.match(readmeDoc, /\[contract migration guide\]\(docs\/migration-guide\.md\)/i);
  assert.ok(packageManifest.files?.includes("docs/migration-guide.md"));
  assert.match(migrationGuide, /CONTRACT_VERSION/);
  assert.match(migrationGuide, /workspace-dev\/contracts/);
  assert.match(migrationGuide, /CONTRACT_CHANGELOG\.md/);
  assert.match(migrationGuide, /workspace-dev": "~?1\.0\.0"/);
  assert.match(migrationGuide, /WorkspaceJobInput\.requestSourceMode/);
  assert.match(migrationGuide, /pnpm exec tsc --noEmit/);
  assert.match(migrationGuide, /Rollback/i);

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
  assert.match(readmeDoc, /## Programmatic API/i);
  assert.match(readmeDoc, /`workspace-dev\/contracts`/);
  assert.match(readmeDoc, /import \{ createWorkspaceServer \} from "workspace-dev";/);
  assert.match(readmeDoc, /import type \{ WorkspaceStartOptions \} from "workspace-dev\/contracts";/);
  assert.match(readmeDoc, /import \{ validateModeLock \} from "workspace-dev";/);
  assert.match(readmeDoc, /figmaSourceMode: "mcp"/);
  assert.match(readmeDoc, /CONTRACT_VERSION/);
  assert.match(readmeDoc, /type WorkspaceJobInput/);
  assert.match(readmeDoc, /type WorkspaceFigmaSourceMode/);
  assert.match(readmeDoc, /### Advanced isolation lifecycle API/i);
  assert.match(readmeDoc, /`ProjectInstance`/);
  assert.match(readmeDoc, /Per-project helpers:/);
  assert.match(readmeDoc, /Process-level lifecycle controls:/);
  assert.match(readmeDoc, /stable advanced surface/i);
  assert.match(readmeDoc, /not experimental or internal-only today/i);
  assert.match(readmeDoc, /## Operational Hardening/i);
  assert.match(readmeDoc, /default loopback bind \(`127\.0\.0\.1:1983`\)/i);
  assert.match(readmeDoc, /`local_json` is the preferred air-gap and firewall-friendly source mode/i);
  assert.match(readmeDoc, /repository-only verification fixtures, test suites, and\s+template `node_modules` do not ship/i);

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

test("docs: generated API reference stays wired to the public entrypoints", async () => {
  const packageManifest = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const readmeDoc = await readRepoFile("README.md");
  const typedocConfig = await readRepoFile("typedoc.json");
  const apiReferenceIndex = await readRepoFile("docs/api/README.md");
  const rootApiReference = await readRepoFile("docs/api/index/README.md");
  const contractsApiReference = await readRepoFile("docs/api/contracts/README.md");

  assert.equal(packageManifest.scripts?.["docs:api"], "node scripts/generate-api-docs.mjs");
  assert.equal(packageManifest.scripts?.["docs:api:check"], "node scripts/check-api-docs.mjs");
  assert.match(readmeDoc, /\[docs\/api\/README\.md\]\(docs\/api\/README\.md\)/);
  assert.match(typedocConfig, /"entryPoints": \["src\/index\.ts", "src\/contracts\/index\.ts"\]/);
  assert.match(typedocConfig, /"disableSources": true/);
  assert.match(apiReferenceIndex, /^# workspace-dev$/m);
  assert.match(apiReferenceIndex, /\[contracts\]\(contracts\/README\.md\)/);
  assert.match(apiReferenceIndex, /\[index\]\(index\/README\.md\)/);
  assert.match(rootApiReference, /^# index$/m);
  assert.match(rootApiReference, /^## Interfaces$/m);
  assert.match(rootApiReference, /^### InjectRequest$/m);
  assert.match(rootApiReference, /^### InjectResponse$/m);
  assert.match(rootApiReference, /^### WorkspaceServer$/m);
  assert.match(rootApiReference, /^### WorkspaceServerApp$/m);
  assert.match(rootApiReference, /^### createWorkspaceServer\(\)$/m);
  assert.match(contractsApiReference, /^# contracts$/m);
  assert.match(contractsApiReference, /^## Interfaces$/m);
  assert.match(contractsApiReference, /^### WorkspaceStartOptions$/m);
  assert.match(contractsApiReference, /^##### testIntelligence\?$/m);
  assert.match(contractsApiReference, /^##### jobType\?$/m);
  assert.match(contractsApiReference, /^##### testIntelligenceMode\?$/m);
  assert.match(contractsApiReference, /^### WorkspaceJobType$/m);
  assert.match(contractsApiReference, /^### WorkspaceTestIntelligenceMode$/m);
  assert.match(contractsApiReference, /^## Variables$/m);
  assert.match(contractsApiReference, /^### ALLOWED\\_TEST\\_INTELLIGENCE\\_MODES$/m);
  assert.match(contractsApiReference, /^### ALLOWED\\_WORKSPACE\\_JOB\\_TYPES$/m);
  assert.match(contractsApiReference, /^### CONTRACT\\_VERSION$/m);
  assert.match(contractsApiReference, /^### GENERATED\\_TEST\\_CASE\\_SCHEMA\\_VERSION$/m);
  assert.match(contractsApiReference, /^### TEST\\_INTELLIGENCE\\_CONTRACT\\_VERSION$/m);
  assert.match(contractsApiReference, /^### TEST\\_INTELLIGENCE\\_ENV$/m);
  assert.match(contractsApiReference, /^### TEST\\_INTELLIGENCE\\_PROMPT\\_TEMPLATE\\_VERSION$/m);
});

test("docs: figma direct-import guide stays aligned with inspector submit flow", async () => {
  const figmaImportDoc = await readRepoFile("docs/figma-import.md");
  const pluginTestingDoc = await readRepoFile("plugin/TESTING.md");
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const readmeDoc = await readRepoFile("README.md");
  const errorCodeReferenceSection = extractMarkdownSection(
    figmaImportDoc,
    "Inspector error-code reference",
  );

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
    figmaImportDoc,
    /^## Path D - Figma URL \(hybrid MCP \+ REST fallback\)$/m,
  );
  assert.match(figmaImportDoc, /`figmaSourceMode=hybrid`/);
  assert.match(figmaImportDoc, /`figmaSourceMode=mcp`/);
  assert.match(figmaImportDoc, /not a standalone\s+mode-lock option/i);
  assert.match(figmaImportDoc, /`WORKSPACE_DEV_MCP_SERVER_URL`/);
  assert.match(figmaImportDoc, /`WORKSPACE_ALLOW_INSECURE_MCP=true`/);
  assert.match(figmaImportDoc, /https:\/\/mcp\.figma\.com\/mcp/);
  assert.match(figmaImportDoc, /`get_design_context`/);
  assert.match(figmaImportDoc, /`get_variable_defs`/);
  assert.match(figmaImportDoc, /`get_metadata`/);
  assert.match(figmaImportDoc, /`get_screenshot`/);
  assert.match(figmaImportDoc, /`search_design_system`/);
  assert.match(figmaImportDoc, /`W_MCP_FALLBACK_REST`/);
  assert.match(figmaImportDoc, /`W_MCP_SCREENSHOT_FALLBACK_REST`/);
  assert.match(figmaImportDoc, /`Figma REST fallback active`/);
  assert.match(figmaImportDoc, /Retry available in\s+Ns/i);
  assert.match(figmaImportDoc, /`AUTH_REQUIRED`/);
  assert.match(figmaImportDoc, /`MCP_RATE_LIMITED`/);
  assert.match(figmaImportDoc, /`MCP_UNAVAILABLE`/);
  assert.ok(errorCodeReferenceSection, "missing Inspector error-code reference section");
  for (const errorCode of Object.keys(PASTE_ERROR_CATALOG).sort()) {
    assert.match(
      errorCodeReferenceSection,
      new RegExp(escapeRegExp(`\`${errorCode}\``)),
    );
  }
  for (const aliasCode of EXPECTED_FIGMA_IMPORT_ERROR_ALIAS_CODES) {
    assert.match(
      errorCodeReferenceSection,
      new RegExp(escapeRegExp(`\`${aliasCode}\``)),
    );
  }
  assert.match(
    figmaImportDoc,
    /\[`CLIPBOARD_NOT_FIGMA`\]\(#error-code-clipboard-not-figma\)/,
  );
  assert.match(
    figmaImportDoc,
    /\[`SCHEMA_MISMATCH`\]\(#error-code-schema-mismatch\)/,
  );
  assert.match(
    figmaImportDoc,
    /\[`PAYLOAD_TOO_LARGE`\]\(#error-code-payload-too-large\)/,
  );
  assert.match(
    figmaImportDoc,
    /\[`TRANSFORM_PARTIAL`\]\(#error-code-transform-partial\)/,
  );
  assert.match(
    figmaImportDoc,
    /\[`CODEGEN_PARTIAL`\]\(#error-code-codegen-partial\)/,
  );
  assert.match(figmaImportDoc, /\[`STAGE_FAILED`\]\(#error-code-stage-failed\)/);
  assert.match(figmaImportDoc, /\[`JOB_FAILED`\]\(#error-code-job-failed\)/);
  assert.match(
    figmaImportDoc,
    /\[`MISSING_PREVIEW_URL`\]\(#error-code-missing-preview-url\)/,
  );
  assert.match(
    figmaImportDoc,
    /\[`SUBMIT_FAILED`\]\(#error-code-submit-failed\)/,
  );
  assert.match(figmaImportDoc, /\[`POLL_FAILED`\]\(#error-code-poll-failed\)/);
  assert.match(
    figmaImportDoc,
    /\[`CANCEL_FAILED`\]\(#error-code-cancel-failed\)/,
  );
  assert.match(figmaImportDoc, /`INSPECTOR_LIVE_E2E=1`/);
  assert.match(figmaImportDoc, /`FIGMA_FILE_KEY`/);
  for (const heading of EXPECTED_FIGMA_IMPORT_SCOPE_HEADINGS) {
    const level = heading === "Scope, re-import, and delta mode" ? "##" : "###";
    assert.match(
      figmaImportDoc,
      new RegExp(`^${escapeRegExp(`${level} ${heading}`)}$`, "m"),
    );
  }
  assert.match(figmaImportDoc, /`Just this`/);
  assert.match(figmaImportDoc, /`\+ Children`/);
  assert.match(figmaImportDoc, /`All screens`/);
  assert.match(figmaImportDoc, /`Changed`/);
  assert.match(figmaImportDoc, /`Generate Selected`/);
  assert.match(figmaImportDoc, /`aria-checked="mixed"`/);
  assert.match(figmaImportDoc, /`Regenerate changed`/);
  assert.match(figmaImportDoc, /`Regenerate selected`/);
  assert.match(figmaImportDoc, /`Create new`/);
  assert.match(figmaImportDoc, /`Update diff`/);
  assert.match(figmaImportDoc, /`Added` \/ `Modified` \/ `Removed` \/ `Unchanged`/);
  assert.match(figmaImportDoc, /latest 20 import sessions/i);
  assert.match(figmaImportDoc, /`<outputRoot>\/import-sessions\/import-sessions\.json`/);
  assert.match(
    figmaImportDoc,
    /`\.workspace-dev\/import-sessions\/import-sessions\.json`/,
  );
  assert.match(figmaImportDoc, /`Delete` - remove the session from history\./);
  assert.match(figmaImportDoc, /`Log` - expand the persisted audit trail/i);
  assert.match(figmaImportDoc, /`Open design`/);
  assert.match(figmaImportDoc, /legacy `https:\/\/figma\.com\/file\/\.\.\.`/i);
  assert.match(figmaImportDoc, /branch urls are accepted/i);
  assert.match(figmaImportDoc, /FigJam, Figma Make, and community URLs are rejected/i);
  assert.match(figmaImportDoc, /`<outputRoot>\/paste-fingerprints\/`/);
  assert.match(figmaImportDoc, /`\.workspace-dev\/paste-fingerprints\/`/);
  assert.match(figmaImportDoc, /`strategy: baseline_created`/);
  assert.match(figmaImportDoc, /`strategy: structural_break`/);
  assert.match(figmaImportDoc, /prior source job no longer matches/i);
  assert.match(figmaImportDoc, /30 days/);
  assert.match(figmaImportDoc, /64-entry least-recently-used/i);
  assert.match(
    figmaImportDoc,
    /operator-facing benchmark maintenance commands[\s\S]*do not\s+require MCP server setup/i,
  );
  for (const heading of EXPECTED_FIGMA_IMPORT_QUALITY_GOVERNANCE_HEADINGS) {
    const level = heading === "Quality and governance" ? "##" : "###";
    assert.match(
      figmaImportDoc,
      new RegExp(`^${escapeRegExp(`${level} ${heading}`)}$`, "m"),
    );
  }
  for (const key of EXPECTED_FIGMA_IMPORT_POLICY_KEYS) {
    assert.match(figmaImportDoc, new RegExp(escapeRegExp(`\`${key}\``)));
  }
  assert.match(figmaImportDoc, /`Accept all`/);
  assert.match(figmaImportDoc, /`Reject all`/);
  assert.match(figmaImportDoc, /Import → Review → Approve → Apply/);
  assert.match(figmaImportDoc, /`GET \/workspace\/import-sessions\/:id\/events`/);
  assert.match(figmaImportDoc, /`POST \/workspace\/import-sessions\/:id\/approve`/);
  assert.match(figmaImportDoc, /local-only/i);
  assert.match(
    figmaImportDoc,
    /does not upload the design or[\s\S]*generated code to an LLM/i,
  );
  assert.match(figmaImportDoc, /ARCHITECTURE\.md#import-session-governance-994/);
  assert.match(
    figmaImportDoc,
    /case-insensitive literal substring matches[\s\S]*Regex-like entries are dropped with a warning/i,
  );
  assert.match(figmaImportDoc, /`GET \/workspace\/inspector-policy`/);
  assert.match(
    readmeDoc,
    /\[docs\/figma-import\.md - Quality and governance\]\(docs\/figma-import\.md#quality-and-governance\)/,
  );
  assert.match(
    readmeDoc,
    /`GET \/workspace\/inspector-policy` - repo-backed inspector policy loader payload \(`\{ policy, validation, warning\? \}`\)/,
  );
  assert.match(
    contributingDoc,
    /not\s+MCP setup flows/i,
  );
  assert.match(
    contributingDoc,
    /`WORKSPACEDEV_FIGMA_TOKEN`, `VISUAL_BENCHMARK_FIGMA_TOKEN`, or `FIGMA_ACCESS_TOKEN`/,
  );
  assert.match(
    contributingDoc,
    /`pnpm visual:audit live` currently requires `FIGMA_ACCESS_TOKEN`\./,
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
