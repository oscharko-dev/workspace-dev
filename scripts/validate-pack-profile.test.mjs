import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commonRequiredFiles,
  profileDefinitions,
  templateRequiredFiles,
} from "./pack-profile-contract.mjs";
import {
  parseValidatePackProfileArgs,
  validatePackProfileTarballs,
} from "./validate-pack-profile.mjs";

const packageRoot = new URL("..", import.meta.url);

const run = async ({ command, args, cwd }) =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${code ?? 1}): ${stderr}`));
    });
  });

const writeFixtureFile = async (root, relativePath, content = "fixture\n") => {
  const filePath = path.join(root, "package", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

const writeJsonFixtureFile = async (root, relativePath, value) => {
  await writeFixtureFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
};

const createFixtureTarball = async ({
  mutate,
  profileId = "default",
} = {}) => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pack-validator-fixture-"),
  );
  const tarballPath = path.join(fixtureRoot, "fixture.tgz");
  const profile = profileDefinitions[profileId];

  try {
    const manifest = {
      name: "workspace-dev",
      version: "1.0.0",
      type: "module",
      license: "MIT",
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      bin: {
        "workspace-dev": "./dist/cli.js",
      },
      exports: {
        ".": {
          import: "./dist/index.js",
          require: "./dist/index.cjs",
        },
        "./contracts": {
          import: "./dist/contracts/index.js",
          require: "./dist/contracts/index.cjs",
        },
      },
      peerDependencies: {
        typescript: ">=5.0.0",
      },
      peerDependenciesMeta: {
        typescript: {
          optional: true,
        },
      },
      workspaceDev: {
        buildProfile: profile.id,
        pipelineIds: [...profile.pipelineIds],
      },
    };

    await writeJsonFixtureFile(fixtureRoot, "package.json", manifest);
    for (const relativePath of commonRequiredFiles) {
      if (relativePath === "package.json") {
        continue;
      }
      await writeFixtureFile(fixtureRoot, relativePath);
    }

    await writeFixtureFile(
      fixtureRoot,
      "dist/cli.js",
      "#!/usr/bin/env node\nif (process.argv.includes('--help')) console.log('workspace-dev help');\n",
    );
    await writeFixtureFile(
      fixtureRoot,
      "dist/index.js",
      `const pipelineIds = ${JSON.stringify(profile.pipelineIds)};\n` +
        "export const createWorkspaceServer = async () => ({ app: { close: async () => undefined, inject: async () => { const body = JSON.stringify({ availablePipelines: pipelineIds.map((id) => ({ id })) }); return { statusCode: 200, body, headers: {}, json: () => JSON.parse(body) }; } } });\n",
    );
    await writeFixtureFile(
      fixtureRoot,
      "dist/index.cjs",
      "module.exports = { createWorkspaceServer: () => undefined };\n",
    );
    await writeFixtureFile(
      fixtureRoot,
      "dist/contracts/index.js",
      "export const CONTRACT_VERSION = '1.0.0'; export const ALLOWED_FIGMA_SOURCE_MODES = [];\n",
    );
    await writeFixtureFile(
      fixtureRoot,
      "dist/contracts/index.cjs",
      "module.exports = { CONTRACT_VERSION: '1.0.0', ALLOWED_FIGMA_SOURCE_MODES: [] };\n",
    );
    await writeFixtureFile(fixtureRoot, "dist/ui/assets/app.js");
    await writeFixtureFile(fixtureRoot, "dist/ui/assets/app.css");

    for (const templateId of profile.templates) {
      for (const relativePath of templateRequiredFiles[templateId]) {
        if (relativePath.endsWith("/package.json")) {
          await writeJsonFixtureFile(fixtureRoot, relativePath, {
            name: templateId,
            dependencies: { react: "^19.0.0" },
          });
          continue;
        }
        await writeFixtureFile(fixtureRoot, relativePath);
      }
    }

    await mutate?.({ fixtureRoot, manifest, profile });
    await run({
      command: "tar",
      args: ["-czf", tarballPath, "-C", fixtureRoot, "package"],
      cwd: packageRoot,
    });

    return {
      tarballPath,
      cleanup: async () => {
        await rm(fixtureRoot, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await rm(fixtureRoot, { force: true, recursive: true });
    throw error;
  }
};

test("validate-pack-profile parses exactly one profile and positional tarballs", () => {
  assert.deepEqual(
    parseValidatePackProfileArgs(["--profile", "default", "a.tgz", "b.tgz"]),
    {
      help: false,
      profile: "default",
      tarballPaths: ["a.tgz", "b.tgz"],
    },
  );
  assert.throws(
    () => parseValidatePackProfileArgs(["--profile", "default", "--profile", "rocket"]),
    /Only one --profile/,
  );
});

test("validatePackProfileTarballs accepts a profile-matching tarball", async () => {
  const fixture = await createFixtureTarball();
  try {
    await validatePackProfileTarballs({
      profileId: "default",
      tarballPaths: [fixture.tarballPath],
    });
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs rejects unselected template leakage", async () => {
  const fixture = await createFixtureTarball({
    mutate: async ({ fixtureRoot }) => {
      await writeJsonFixtureFile(
        fixtureRoot,
        "template/react-mui-app/package.json",
        { name: "react-mui-app" },
      );
    },
  });
  try {
    await assert.rejects(
      validatePackProfileTarballs({
        profileId: "default",
        tarballPaths: [fixture.tarballPath],
      }),
      /forbidden path/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs rejects default compiled Rocket markers", async () => {
  const fixture = await createFixtureTarball({
    mutate: async ({ fixtureRoot }) => {
      await writeFixtureFile(
        fixtureRoot,
        "dist/leaked-profile-marker.js",
        "export const marker = 'RocketTemplatePrepareService';\n",
      );
    },
  });
  try {
    await assert.rejects(
      validatePackProfileTarballs({
        profileId: "default",
        tarballPaths: [fixture.tarballPath],
      }),
      /compiled dist contains Rocket\/customer-only marker/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs allows Rocket compiled markers in rocket profile", async () => {
  const fixture = await createFixtureTarball({
    profileId: "rocket",
    mutate: async ({ fixtureRoot }) => {
      await writeFixtureFile(
        fixtureRoot,
        "dist/rocket-profile-marker.js",
        "export const marker = 'RocketTemplatePrepareService';\n",
      );
    },
  });
  try {
    await validatePackProfileTarballs({
      profileId: "rocket",
      tarballPaths: [fixture.tarballPath],
    });
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs rejects profile manifest mismatch", async () => {
  const fixture = await createFixtureTarball({
    mutate: async ({ fixtureRoot, manifest }) => {
      manifest.workspaceDev.buildProfile = "rocket";
      manifest.workspaceDev.pipelineIds = ["rocket"];
      await writeJsonFixtureFile(fixtureRoot, "package.json", manifest);
    },
  });
  try {
    await assert.rejects(
      validatePackProfileTarballs({
        profileId: "default",
        tarballPaths: [fixture.tarballPath],
      }),
      /buildProfile mismatch/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs rejects packaged workspace pipeline mismatch", async () => {
  const fixture = await createFixtureTarball({
    mutate: async ({ fixtureRoot }) => {
      await writeFixtureFile(
        fixtureRoot,
        "dist/index.js",
        "export const createWorkspaceServer = async () => ({ app: { close: async () => undefined, inject: async () => { const body = JSON.stringify({ availablePipelines: [{ id: 'rocket' }] }); return { statusCode: 200, body, headers: {}, json: () => JSON.parse(body) }; } } });\n",
      );
    },
  });
  try {
    await assert.rejects(
      validatePackProfileTarballs({
        profileId: "default",
        tarballPaths: [fixture.tarballPath],
      }),
      /Command failed/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("validatePackProfileTarballs rejects denied default template lockfile dependencies", async () => {
  const fixture = await createFixtureTarball({
    mutate: async ({ fixtureRoot }) => {
      await writeFixtureFile(
        fixtureRoot,
        "template/react-tailwind-app/pnpm-lock.yaml",
        [
          "lockfileVersion: '9.0'",
          "",
          "importers:",
          "  .:",
          "    dependencies:",
          "      '@mui/material':",
          "        specifier: ^7.0.0",
          "        version: 7.0.0",
          "",
          "packages:",
          "  '@mui/material@7.0.0':",
          "    resolution: {integrity: sha512-fixture}",
          "",
        ].join("\n"),
      );
    },
  });
  try {
    await assert.rejects(
      validatePackProfileTarballs({
        profileId: "default",
        tarballPaths: [fixture.tarballPath],
      }),
      /lockfile includes denied Rocket runtime dependencies: @mui\/material/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("validate-pack-profile CLI fails without tarball paths", async () => {
  await assert.rejects(
    run({
      command: "node",
      args: ["scripts/validate-pack-profile.mjs", "--profile", "default"],
      cwd: packageRoot,
    }),
    /Missing tarball path/,
  );
});
