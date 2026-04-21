import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TEMPLATE_DEPENDENCY_ISSUE_MARKER,
  analyzeTemplateDependencyFreshness,
  collectTemplateDependencies,
  extractLockedDependencyVersions,
  findLatestMinorPatchUpdate,
  parseStableSemver,
  parseVersionFromRange,
  renderTemplateDependencyIssueBody,
} from "./check-template-dependency-freshness.mjs";

test("parseVersionFromRange extracts stable semver from common npm ranges", () => {
  assert.deepEqual(parseStableSemver("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    raw: "1.2.3",
  });
  assert.equal(parseStableSemver("1.2.3-beta.1"), null);
  assert.equal(parseVersionFromRange("^19.2.5")?.raw, "19.2.5");
  assert.equal(parseVersionFromRange("~8.0.8")?.raw, "8.0.8");
});

test("extractLockedDependencyVersions reads root importer versions", () => {
  const versions = extractLockedDependencyVersions(`lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@mui/material':
        specifier: ^7.3.9
        version: 7.3.10(@emotion/react@11.14.0)(react@19.2.5)
      react:
        specifier: ^19.2.5
        version: 19.2.5
    devDependencies:
      typescript:
        specifier: ^5.9.2
        version: 5.9.3

packages:

  react@19.2.5:
    resolution: {}
`);

  assert.equal(versions.get("@mui/material"), "7.3.10");
  assert.equal(versions.get("react"), "19.2.5");
  assert.equal(versions.get("typescript"), "5.9.3");
});

test("collectTemplateDependencies reads production and development entries", () => {
  assert.deepEqual(
    collectTemplateDependencies({
      dependencies: {
        react: "^19.2.5",
      },
      devDependencies: {
        vite: "^8.0.8",
      },
    }),
    [
      {
        name: "react",
        dependencyType: "dependencies",
        currentRange: "^19.2.5",
        currentVersion: "19.2.5",
      },
      {
        name: "vite",
        dependencyType: "devDependencies",
        currentRange: "^8.0.8",
        currentVersion: "8.0.8",
      },
    ],
  );
});

test("findLatestMinorPatchUpdate ignores major and prerelease updates", () => {
  assert.deepEqual(
    findLatestMinorPatchUpdate({
      currentVersion: "7.3.9",
      versions: {
        "7.3.10": {},
        "7.4.0-beta.1": {},
        "8.0.0": {},
      },
      time: {
        "7.3.10": "2026-01-01T00:00:00.000Z",
        "7.4.0-beta.1": "2026-01-02T00:00:00.000Z",
        "8.0.0": "2026-01-03T00:00:00.000Z",
      },
    }),
    {
      version: "7.3.10",
      publishedAt: "2026-01-01T00:00:00.000Z",
    },
  );
});

test("analyzeTemplateDependencyFreshness reports same-major updates older than threshold", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-template-freshness-"),
  );
  const packageJsonPath = path.join(tempRoot, "package.json");
  const lockfilePath = path.join(tempRoot, "pnpm-lock.yaml");
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        dependencies: {
          react: "^19.2.5",
          zod: "^4.3.6",
        },
        devDependencies: {
          vite: "^8.0.8",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    lockfilePath,
    `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.2.5
        version: 19.2.5
      zod:
        specifier: ^4.3.6
        version: 4.3.6
    devDependencies:
      vite:
        specifier: ^8.0.8
        version: 8.0.8
`,
    "utf8",
  );

  const report = await analyzeTemplateDependencyFreshness({
    packageJsonPath,
    lockfilePath,
    thresholdDays: 30,
    now: new Date("2026-04-21T00:00:00.000Z"),
    fetchPackage: async (packageName) => {
      const packages = {
        react: {
          versions: {
            "19.2.5": {},
            "19.3.0": {},
            "20.0.0": {},
          },
          time: {
            "19.3.0": "2026-03-01T00:00:00.000Z",
            "20.0.0": "2026-02-01T00:00:00.000Z",
          },
        },
        vite: {
          versions: {
            "8.0.8": {},
            "8.0.9": {},
          },
          time: {
            "8.0.9": "2026-04-10T00:00:00.000Z",
          },
        },
        zod: {
          versions: {
            "4.3.6": {},
          },
          time: {},
        },
      };
      return packages[packageName];
    },
  });

  assert.equal(report.dependencyCount, 3);
  assert.deepEqual(report.staleDependencies, [
    {
      name: "react",
      dependencyType: "dependencies",
      currentRange: "^19.2.5",
      currentLockedVersion: "19.2.5",
      latestMinorPatchVersion: "19.3.0",
      publishedAt: "2026-03-01T00:00:00.000Z",
      daysBehind: 51,
    },
  ]);
});

test("renderTemplateDependencyIssueBody includes marker and actionable table", () => {
  const body = renderTemplateDependencyIssueBody({
    checkedAt: "2026-04-21T00:00:00.000Z",
    thresholdDays: 30,
    staleDependencies: [
      {
        name: "@mui/material",
        dependencyType: "dependencies",
        currentRange: "^7.3.9",
        currentLockedVersion: "7.3.9",
        latestMinorPatchVersion: "7.4.0",
        daysBehind: 45,
        publishedAt: "2026-03-07T00:00:00.000Z",
      },
    ],
  });

  assert.match(body, new RegExp(TEMPLATE_DEPENDENCY_ISSUE_MARKER));
  assert.match(body, /\| `@mui\/material` \| dependencies \| `\^7\.3\.9` \| `7\.3\.9` \| `7\.4\.0` \| 45 \| 2026-03-07 \|/);
  assert.match(body, /docs\/template-maintenance\.md/);
});
