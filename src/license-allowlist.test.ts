import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/check-license-allowlist.mjs");

const createPackageJson = ({
  name,
  version = "1.0.0",
  license = "MIT",
  dependencies
}: {
  name: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
}): string => {
  return `${JSON.stringify(
    {
      name,
      version,
      private: true,
      type: "module",
      license,
      ...(dependencies ? { dependencies } : {})
    },
    null,
    2
  )}\n`;
};

const runCheck = async ({
  args = [],
  templatePackages,
  includeTemplateNodeModules = true
}: {
  args?: string[];
  templatePackages: Record<string, string>;
  includeTemplateNodeModules?: boolean;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-license-allowlist-"));
  const templateRoots = [
    path.join(tempRoot, "template/react-mui-app"),
    path.join(tempRoot, "template/react-tailwind-app"),
  ];

  try {
    await writeFile(path.join(tempRoot, "package.json"), createPackageJson({ name: "workspace-dev" }), "utf8");
    for (const templateRoot of templateRoots) {
      await mkdir(templateRoot, { recursive: true });
      await writeFile(path.join(templateRoot, "package.json"), createPackageJson({ name: "figma-generated-app" }), "utf8");

      if (includeTemplateNodeModules) {
        const nodeModulesRoot = path.join(templateRoot, "node_modules");
        await mkdir(nodeModulesRoot, { recursive: true });

        const entries = Object.entries(templatePackages).sort(([first], [second]) => first.localeCompare(second));
        for (const [relativePath, content] of entries) {
          const filePath = path.join(nodeModulesRoot, relativePath);
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, content, "utf8");
        }
      }
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: packageRoot,
        env: {
          ...process.env,
          WORKSPACE_DEV_PACKAGE_ROOT: tempRoot
        },
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
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`check-license-allowlist exited via signal '${signal}'.`));
          return;
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test("license allowlist check passes for approved transitive template licenses", async () => {
  const result = await runCheck({
    templatePackages: {
      "allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        license: "MIT",
        dependencies: {
          "allowed-child": "1.0.0"
        }
      }),
      "allowed-parent/node_modules/allowed-child/package.json": createPackageJson({
        name: "allowed-child",
        license: "ISC"
      })
    }
  });

  assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
  assert.match(result.stdout, /installed dependency tree: 2 packages/);
  assert.equal(result.stderr, "");
});

test("license allowlist check fails for disallowed transitive template licenses", async () => {
  const result = await runCheck({
    templatePackages: {
      "allowed-parent/package.json": createPackageJson({
        name: "allowed-parent",
        license: "MIT",
        dependencies: {
          "disallowed-child": "1.0.0"
        }
      }),
      "allowed-parent/node_modules/disallowed-child/package.json": createPackageJson({
        name: "disallowed-child",
        license: "GPL-3.0-only"
      })
    }
  });

  assert.equal(result.code, 1, `Expected failure, got stdout:\n${result.stdout}`);
  assert.match(result.stderr, /disallowed-child@1\.0\.0: GPL-3\.0-only/);
  assert.match(result.stderr, /Allowed licenses:/);
});

test("license allowlist check fails when the template install tree is missing", async () => {
  const result = await runCheck({
    templatePackages: {},
    includeTemplateNodeModules: false
  });

  assert.equal(result.code, 1, `Expected missing-install failure, got stdout:\n${result.stdout}`);
  assert.match(result.stderr, /template\/react-tailwind-app node_modules is missing/);
  assert.match(result.stderr, /pnpm --dir template\/react-tailwind-app install/);
});

test("license allowlist check scopes selected templates by build profile", async () => {
  const result = await runCheck({
    args: ["--profile", "default"],
    templatePackages: {},
    includeTemplateNodeModules: false
  });

  assert.equal(result.code, 1, `Expected missing-install failure, got stdout:\n${result.stdout}`);
  assert.match(result.stdout, /\[license-allowlist\] Checking profile 'default'\./);
  assert.doesNotMatch(result.stderr, /template\/react-mui-app node_modules is missing/);
  assert.match(result.stderr, /template\/react-tailwind-app node_modules is missing/);
});
