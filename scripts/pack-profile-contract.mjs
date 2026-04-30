export const profileDefinitions = {
  default: {
    id: "default",
    envValue: "default",
    pipelineIds: ["default"],
    templates: ["react-tailwind-app"],
  },
  rocket: {
    id: "rocket",
    envValue: "rocket",
    pipelineIds: ["rocket"],
    templates: ["react-mui-app"],
  },
  "default-rocket": {
    id: "default-rocket",
    envValue: "default,rocket",
    pipelineIds: ["default", "rocket"],
    templates: ["react-tailwind-app", "react-mui-app"],
  },
};

export const profileAliases = new Map([
  ["all", "default-rocket"],
  ["default,rocket", "default-rocket"],
]);

export const profileTarballSizeBudgetsBytes = {
  default: 6_500_000,
  rocket: 6_700_000,
  "default-rocket": 7_000_000,
};

export const rootFileAllowlist = [
  "README.md",
  "TROUBLESHOOTING.md",
  "VERSIONING.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "SECURITY.md",
  "THREAT_MODEL.md",
  "CODE_OF_CONDUCT.md",
  "COMPLIANCE.md",
  "ARCHITECTURE.md",
  "COMPATIBILITY.md",
  "SLA.md",
  "ESCROW.md",
  "ZERO_TELEMETRY.md",
  "SUPPORT.md",
  "CONTRACT_CHANGELOG.md",
  "PIPELINE.md",
];

export const docsFileAllowlist = [
  "docs/default-pipeline/default-demo-fixtures.md",
  "docs/default-pipeline/default-demo-guide.md",
  "docs/default-pipeline/pipeline-authoring-and-migration.md",
  "docs/migration-guide.md",
  "docs/template-maintenance.md",
  "docs/test-intelligence.md",
  "docs/api/test-intelligence-multi-source.md",
  "docs/architecture/multi-source-flow.mmd",
  "docs/dora/multi-source.md",
  "docs/dpia/custom-context-source.md",
  "docs/dpia/jira-source.md",
  "docs/eu-ai-act/human-oversight.md",
  "docs/migration/wave-4-additive.md",
  "docs/runbooks/jira-source-setup.md",
  "docs/runbooks/multi-source-air-gap.md",
];

export const distAllowlist = ["dist"];

export const templateFileAllowlists = {
  "react-tailwind-app": [
    "template/react-tailwind-app/.npmignore",
    "template/react-tailwind-app/.npmrc",
    "template/react-tailwind-app/e2e/template.spec.ts",
    "template/react-tailwind-app/eslint.config.js",
    "template/react-tailwind-app/index.html",
    "template/react-tailwind-app/package.json",
    "template/react-tailwind-app/perf-baseline.json",
    "template/react-tailwind-app/perf-budget.json",
    "template/react-tailwind-app/playwright.config.ts",
    "template/react-tailwind-app/pnpm-lock.yaml",
    "template/react-tailwind-app/pnpm-workspace.yaml",
    "template/react-tailwind-app/scripts/perf-runner.mjs",
    "template/react-tailwind-app/scripts/validate-ui-report-lib.mjs",
    "template/react-tailwind-app/scripts/validate-ui-report.mjs",
    "template/react-tailwind-app/src/App.tsx",
    "template/react-tailwind-app/src/main.tsx",
    "template/react-tailwind-app/src/styles.css",
    "template/react-tailwind-app/src/test/setup.ts",
    "template/react-tailwind-app/src/vite-env.d.ts",
    "template/react-tailwind-app/tsconfig.e2e.json",
    "template/react-tailwind-app/tsconfig.app.json",
    "template/react-tailwind-app/tsconfig.json",
    "template/react-tailwind-app/tsconfig.node.json",
    "template/react-tailwind-app/vite.config.ts",
  ],
  "react-mui-app": [
    "template/react-mui-app/.npmrc",
    "template/react-mui-app/eslint.config.js",
    "template/react-mui-app/index.html",
    "template/react-mui-app/package-lock.json",
    "template/react-mui-app/package.json",
    "template/react-mui-app/perf-baseline.json",
    "template/react-mui-app/perf-budget.json",
    "template/react-mui-app/pnpm-lock.yaml",
    "template/react-mui-app/pnpm-workspace.yaml",
    "template/react-mui-app/scripts/perf-runner.mjs",
    "template/react-mui-app/scripts/validate-ui-report-lib.mjs",
    "template/react-mui-app/scripts/validate-ui-report.mjs",
    "template/react-mui-app/src/App.tsx",
    "template/react-mui-app/src/components/ErrorBoundary.tsx",
    "template/react-mui-app/src/components/RouteSkeleton.tsx",
    "template/react-mui-app/src/main.tsx",
    "template/react-mui-app/src/performance/report-web-vitals.ts",
    "template/react-mui-app/src/performance/resource-hints.ts",
    "template/react-mui-app/src/performance/runtime-errors.ts",
    "template/react-mui-app/src/routes/CheckoutRoute.tsx",
    "template/react-mui-app/src/routes/HomeRoute.tsx",
    "template/react-mui-app/src/routes/OverviewRoute.tsx",
    "template/react-mui-app/src/routes/lazy-routes.ts",
    "template/react-mui-app/src/test/jest-axe.d.ts",
    "template/react-mui-app/src/test/setup.ts",
    "template/react-mui-app/src/theme/theme.ts",
    "template/react-mui-app/src/vite-env.d.ts",
    "template/react-mui-app/tsconfig.json",
    "template/react-mui-app/vite.config.ts",
  ],
};

export const commonRequiredFiles = [
  "package.json",
  "README.md",
  "PIPELINE.md",
  "LICENSE",
  "GOVERNANCE.md",
  "SECURITY.md",
  "THREAT_MODEL.md",
  "COMPLIANCE.md",
  "ARCHITECTURE.md",
  "COMPATIBILITY.md",
  "dist/cli.js",
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
  "dist/contracts/index.js",
  "dist/contracts/index.cjs",
  "dist/contracts/index.d.ts",
  "dist/contracts/index.d.cts",
  "dist/ui/index.html",
  ...docsFileAllowlist,
];

export const templateRequiredFiles = {
  "react-tailwind-app": [
    "template/react-tailwind-app/package.json",
    "template/react-tailwind-app/pnpm-lock.yaml",
    "template/react-tailwind-app/perf-budget.json",
    "template/react-tailwind-app/perf-baseline.json",
    "template/react-tailwind-app/scripts/perf-runner.mjs",
    "template/react-tailwind-app/scripts/validate-ui-report.mjs",
    "template/react-tailwind-app/scripts/validate-ui-report-lib.mjs",
    "template/react-tailwind-app/playwright.config.ts",
    "template/react-tailwind-app/e2e/template.spec.ts",
    "template/react-tailwind-app/tsconfig.e2e.json",
  ],
  "react-mui-app": [
    "template/react-mui-app/package.json",
    "template/react-mui-app/pnpm-lock.yaml",
    "template/react-mui-app/src/App.tsx",
    "template/react-mui-app/src/components/ErrorBoundary.tsx",
    "template/react-mui-app/src/components/RouteSkeleton.tsx",
    "template/react-mui-app/vite.config.ts",
  ],
};

export const forbiddenPackagePathPatterns = [
  /^package\/src(?:\/|$)/,
  /^package\/ui-src(?:\/|$)/,
  /^package\/node_modules(?:\/|$)/,
  /^package\/scripts(?:\/|$)/,
  /^package\/tsconfig\.json$/,
  /^package\/\.npmignore$/,
  /^package\/\.env(?:\.|$)/,
  /\/node_modules\//,
  /\/\.figmapipe(?:\/|$)/,
  /\/artifacts\//,
  /^package\/template\/[^/]+\/dist(?:\/|$)/,
  /\/playwright-report\//,
  /\/test-results\//,
  /\/ui-gate-[^/]*\.json$/,
  /\.test\.[cm]?[jt]sx?$/,
];

const profileIds = Object.keys(profileDefinitions);

export const normalizeBuildProfileId = (rawProfile) => {
  const normalized = rawProfile.trim();
  const aliased = profileAliases.get(normalized) ?? normalized;
  if (!Object.prototype.hasOwnProperty.call(profileDefinitions, aliased)) {
    throw new Error(
      `Unsupported build profile '${rawProfile}'. Expected one of: ${profileIds.join(", ")}.`,
    );
  }
  return aliased;
};

export const resolveBuildProfiles = (rawProfiles) => [
  ...new Set(rawProfiles.map((profile) => normalizeBuildProfileId(profile))),
];

export const defaultBuildProfileIds = Object.keys(profileDefinitions);

export const createProfilePackageManifest = (baseManifest, profile) => {
  const manifest = structuredClone(baseManifest);
  delete manifest.devDependencies;
  delete manifest.files;
  delete manifest.scripts;
  manifest.workspaceDev = {
    ...(manifest.workspaceDev ?? {}),
    buildProfile: profile.id,
    pipelineIds: profile.pipelineIds,
  };
  return manifest;
};
