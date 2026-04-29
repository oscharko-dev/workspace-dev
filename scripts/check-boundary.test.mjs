import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeWorkspaceBoundaries } from "./check-boundary.mjs";

const writeFileFixture = async (root, relativePath, content) => {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const createBoundaryFixture = async (files) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-boundary-"));
  await writeFileFixture(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "workspace-dev-boundary-fixture",
        peerDependencies: {
          typescript: ">=5.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFileFixture(root, relativePath, content);
  }
  return root;
};

const analyzeFixture = async (files) => {
  const root = await createBoundaryFixture(files);
  return await analyzeWorkspaceBoundaries({
    cwd: root,
    packageJsonPath: path.join(root, "package.json"),
    srcDir: path.join(root, "src"),
  });
};

const violationContents = (violations) =>
  violations.map((violation) => violation.content).join("\n");

test("default pipeline modules cannot import customer-profile, rocket, MUI, Emotion, customer aliases, assets, or telemetry SDKs", async () => {
  const report = await analyzeFixture({
    "src/parity/default-tailwind-emitter.ts": [
      'import { loadCustomerProfile } from "../customer-profile.js";',
      'import { RocketTemplatePrepareService } from "../job-engine/services/rocket-template-prepare-service.js";',
      'import { Button } from "@mui/material";',
      'import { css } from "@emotion/react";',
      'import { CustomerButton } from "@customer/components";',
      'import logoUrl from "./assets/customer-logo.svg";',
      'import * as Sentry from "@sentry/browser";',
      "export const ok = true;",
      "",
    ].join("\n"),
  });

  const content = violationContents(report.violations);
  for (const category of [
    "customer-profile",
    "rocket",
    "mui",
    "emotion",
    "customer-alias",
    "proprietary-asset",
    "telemetry",
  ]) {
    assert.match(content, new RegExp(`default modules must not import ${category}`));
  }
});

test("default pipeline modules cannot use side-effect imports for denied dependencies", async () => {
  const report = await analyzeFixture({
    "src/job-engine/services/default-codegen-generate-service.ts": [
      'import "../customer-profile.js";',
      'import "../job-engine/services/rocket-template-prepare-service.js";',
      'import "@mui/material";',
      'import "@emotion/react";',
      'import "@customer/components";',
      'import "./assets/customer-logo.svg";',
      'import "posthog-js";',
      "export const ok = true;",
      "",
    ].join("\n"),
  });

  const content = violationContents(report.violations);
  for (const category of [
    "customer-profile",
    "rocket",
    "mui",
    "emotion",
    "customer-alias",
    "proprietary-asset",
    "telemetry",
  ]) {
    assert.match(content, new RegExp(`default modules must not import ${category}`));
  }
});

test("default pipeline boundary ignores tests and unrelated shared modules", async () => {
  const report = await analyzeFixture({
    "src/parity/default-tailwind-emitter.test.ts":
      'import { Button } from "@mui/material";\n',
    "src/storybook/theme-resolver.ts":
      'import type { ResolvedCustomerProfile } from "../customer-profile.js";\n',
  });

  assert.deepEqual(report.violations, []);
});

test("rocket modules cannot import default template internals", async () => {
  const report = await analyzeFixture({
    "src/job-engine/services/rocket-template-prepare-service.ts": [
      'import { TemplatePrepareService } from "./template-prepare-service.js";',
      'import defaultAppSource from "../../../template/react-tailwind-app/src/App.tsx";',
      "",
    ].join("\n"),
  });

  assert.match(
    violationContents(report.violations),
    /rocket modules must not import default template internals/,
  );
});

test("rocket modules cannot use side-effect imports for default template internals", async () => {
  const report = await analyzeFixture({
    "src/job-engine/services/rocket-template-prepare-service.ts": [
      'import "./template-prepare-service.js";',
      'import "../../../template/react-tailwind-app/src/App.tsx";',
      "",
    ].join("\n"),
  });

  const content = violationContents(report.violations);
  assert.match(content, /template-prepare-service\.js/);
  assert.match(content, /react-tailwind-app/);
});

test("rocket modules can import shared template prepare core", async () => {
  const report = await analyzeFixture({
    "src/job-engine/services/rocket-template-prepare-service.ts":
      'import { createTemplatePrepareService } from "./template-prepare-core.js";\n',
  });

  assert.deepEqual(report.violations, []);
});
