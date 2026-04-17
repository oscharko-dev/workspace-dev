import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/generate-cyclonedx.mjs");

const createPackageJson = ({
  name,
  version = "1.0.0",
  privatePackage = true,
  dependencies
}: {
  name: string;
  version?: string;
  privatePackage?: boolean;
  dependencies?: Record<string, string>;
}): string => {
  return `${JSON.stringify(
    {
      name,
      version,
      private: privatePackage,
      type: "module",
      ...(dependencies ? { dependencies } : {})
    },
    null,
    2
  )}\n`;
};

const runGenerator = async ({
  installTree,
  manifest,
  spawnEnv,
  symlinks
}: {
  installTree?: Record<string, string>;
  manifest: string;
  spawnEnv?: NodeJS.ProcessEnv;
  symlinks?: Array<{ path: string; target: string }>;
}): Promise<{
  code: number;
  document: Record<string, unknown> | null;
  stderr: string;
  stdout: string;
}> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-cyclonedx-generation-"));
  const projectRoot = path.join(tempRoot, "project");
  const outputPath = path.join(tempRoot, "sbom.cdx.json");

  try {
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), manifest, "utf8");

    const fileEntries = Object.entries(installTree ?? {}).sort(([first], [second]) => first.localeCompare(second));
    for (const [relativePath, content] of fileEntries) {
      const filePath = path.join(projectRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }

    for (const entry of symlinks ?? []) {
      const linkPath = path.join(projectRoot, entry.path);
      await mkdir(path.dirname(linkPath), { recursive: true });
      await symlink(entry.target, linkPath);
    }

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, outputPath, "--package-root", projectRoot], {
        cwd: packageRoot,
        env: spawnEnv ?? process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", async (code, signal) => {
        if (signal) {
          reject(new Error(`generate-cyclonedx exited via signal '${signal}'.`));
          return;
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr
        });
      });
    });

    return {
      ...result,
      document:
        result.code === 0 ? (JSON.parse(await readFile(outputPath, "utf8")) as Record<string, unknown>) : null
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test("CycloneDX generator ignores an inherited npm_execpath that points at pnpm", async () => {
  const result = await runGenerator({
    manifest: createPackageJson({
      name: "figma-generated-app",
      dependencies: {
        "allowed-parent": "^1.0.0"
      }
    }),
    installTree: {
      "node_modules/.pnpm/allowed-parent@1.2.0/node_modules/allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        version: "1.2.0",
        dependencies: {
          "allowed-child": "2.0.0"
        }
      }),
      "node_modules/.pnpm/allowed-child@2.0.0/node_modules/allowed-child/package.json": createPackageJson({
        name: "allowed-child",
        version: "2.0.0"
      })
    },
    spawnEnv: {
      ...process.env,
      npm_execpath: "/definitely-not-npm-cli.js"
    },
    symlinks: [
      {
        path: "node_modules/allowed-parent",
        target: ".pnpm/allowed-parent@1.2.0/node_modules/allowed-parent"
      },
      {
        path: "node_modules/.pnpm/allowed-parent@1.2.0/node_modules/allowed-parent/node_modules/allowed-child",
        target: "../../../../allowed-child@2.0.0/node_modules/allowed-child"
      }
    ]
  });

  assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
  assert.ok(result.document, "Expected CycloneDX document to be created");
  assert.equal(result.document?.bomFormat, "CycloneDX");
  const components = Array.isArray(result.document?.components) ? result.document.components : [];
  const packageKeys = components
    .filter(
      (component): component is { name: string; version: string } =>
        Boolean(
          component &&
            typeof component === "object" &&
            "name" in component &&
            "version" in component &&
            typeof component.name === "string" &&
            typeof component.version === "string"
        )
    )
    .map((component) => `${component.name}@${component.version}`)
    .sort((first, second) => first.localeCompare(second));

  assert.deepEqual(packageKeys, ["allowed-child@2.0.0", "allowed-parent@1.2.0"]);
});
