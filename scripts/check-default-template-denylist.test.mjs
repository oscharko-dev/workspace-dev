import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeDefaultTemplateDenylist,
  extractLockfilePackageEntries,
  extractRootImporterPackages,
  matchesDeniedPackage,
} from "./check-default-template-denylist.mjs";

const writeTemplateFile = async (root, relativePath, content) => {
  const targetPath = path.join(root, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
};

const createTemplate = async ({
  packageJson = {},
  lockfile = "",
  files = {},
} = {}) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-default-template-"),
  );
  await writeTemplateFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          react: "^19.2.5",
          "react-dom": "^19.2.5",
        },
        devDependencies: {
          vite: "^8.0.10",
        },
        ...packageJson,
      },
      null,
      2,
    )}\n`,
  );
  await writeTemplateFile(
    root,
    "pnpm-lock.yaml",
    lockfile ||
      `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.2.5
        version: 19.2.5
      react-dom:
        specifier: ^19.2.5
        version: 19.2.5(react@19.2.5)
    devDependencies:
      vite:
        specifier: ^8.0.10
        version: 8.0.10
`,
  );
  await writeTemplateFile(
    root,
    "src/App.tsx",
    files["src/App.tsx"] ?? "export const App = () => <main />;\n",
  );
  for (const [relativePath, content] of Object.entries(files)) {
    if (relativePath === "src/App.tsx") {
      continue;
    }
    await writeTemplateFile(root, relativePath, content);
  }
  return root;
};

test("matchesDeniedPackage classifies guarded dependency families", () => {
  assert.equal(matchesDeniedPackage("@mui/material"), "mui");
  assert.equal(matchesDeniedPackage("@emotion/react"), "emotion");
  assert.equal(matchesDeniedPackage("@customer/components"), "customer");
  assert.equal(matchesDeniedPackage("@rocket/ui"), "rocket");
  assert.equal(matchesDeniedPackage("@sentry/react"), "telemetry");
  assert.equal(matchesDeniedPackage("@opentelemetry/api"), "telemetry");
  assert.equal(matchesDeniedPackage("react"), null);
});

test("extractRootImporterPackages reads direct lockfile importer dependencies only", () => {
  assert.deepEqual(
    extractRootImporterPackages(`lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@mui/material':
        specifier: ^7.3.9
        version: 7.3.9
    devDependencies:
      vite:
        specifier: ^8.0.10
        version: 8.0.10

packages:

  '@sentry/node@9.47.1':
    resolution: {}
`),
    [
      {
        source: "pnpm-lock.yaml root importer dependencies",
        packageName: "@mui/material",
      },
      {
        source: "pnpm-lock.yaml root importer devDependencies",
        packageName: "vite",
      },
    ],
  );
});

test("extractLockfilePackageEntries reads transitive package graph entries", () => {
  assert.deepEqual(
    extractLockfilePackageEntries(`lockfileVersion: '9.0'

packages:

  '@sentry/node@9.47.1':
    resolution: {}
  '@opentelemetry/api@1.9.1':
    resolution: {}
  react@19.2.5:
    resolution: {}

snapshots:

  '@emotion/react@11.14.0':
    dependencies: {}
`),
    [
      {
        source: "pnpm-lock.yaml package graph",
        packageName: "@sentry/node",
      },
      {
        source: "pnpm-lock.yaml package graph",
        packageName: "@opentelemetry/api",
      },
      {
        source: "pnpm-lock.yaml package graph",
        packageName: "react",
      },
      {
        source: "pnpm-lock.yaml package graph",
        packageName: "@emotion/react",
      },
    ],
  );
});

test("analyzeDefaultTemplateDenylist passes the clean default template shape", async () => {
  const root = await createTemplate();
  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.deepEqual(report.violations, []);
});

test("analyzeDefaultTemplateDenylist rejects denied package manifest entries", async () => {
  const root = await createTemplate({
    packageJson: {
      dependencies: {
        react: "^19.2.5",
        "react-dom": "^19.2.5",
        "@mui/material": "^7.3.9",
      },
    },
  });

  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.equal(
    report.violations.some(
      (violation) => violation.packageName === "@mui/material",
    ),
    true,
  );
});

test("analyzeDefaultTemplateDenylist rejects denied root importer lockfile entries", async () => {
  const root = await createTemplate({
    lockfile: `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.2.5
        version: 19.2.5
    devDependencies:
      '@emotion/react':
        specifier: ^11.14.0
        version: 11.14.0
`,
  });

  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.equal(
    report.violations.some(
      (violation) => violation.packageName === "@emotion/react",
    ),
    true,
  );
});

test("analyzeDefaultTemplateDenylist rejects denied transitive lockfile entries", async () => {
  const root = await createTemplate({
    lockfile: `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      react:
        specifier: ^19.2.5
        version: 19.2.5

packages:

  '@sentry/node@9.47.1':
    resolution: {}
`,
  });

  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.equal(
    report.violations.some(
      (violation) => violation.packageName === "@sentry/node",
    ),
    true,
  );
});

test("analyzeDefaultTemplateDenylist rejects denied imports but ignores test fixtures", async () => {
  const root = await createTemplate({
    files: {
      "src/App.tsx":
        'import { CustomerButton } from "@customer/components";\nimport { profile } from "customer-profile";\nexport const App = () => <CustomerButton profile={profile} />;\n',
      "scripts/fixture.test.mjs":
        'const fixture = "import { Button } from \\"@mui/material\\"";\n',
    },
  });

  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.deepEqual(
    report.violations.filter((violation) => violation.kind === "source").map(
      (violation) => violation.category,
    ),
    ["customer"],
  );
  assert.equal(
    report.violations.some(
      (violation) => violation.source === "scripts/fixture.test.mjs",
    ),
    false,
  );
});

test("analyzeDefaultTemplateDenylist rejects bundled static assets by default", async () => {
  const root = await createTemplate({
    files: {
      "src/logo.svg": "<svg />\n",
    },
  });

  const report = await analyzeDefaultTemplateDenylist({ templateRoot: root });
  assert.equal(
    report.violations.some((violation) => violation.kind === "asset"),
    true,
  );
});
