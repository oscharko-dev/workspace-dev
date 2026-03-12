#!/usr/bin/env node

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const run = ({
  command,
  args,
  cwd
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        npm_config_registry: "http://127.0.0.1:9",
        npm_config_audit: "false",
        npm_config_fund: "false"
      },
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")} (cwd=${cwd})`
        )
      );
    });
  });

const main = async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-airgap-"));
  const packDir = path.join(tmpRoot, "pack");
  const installDir = path.join(tmpRoot, "install");

  try {
    await run({
      command: "pnpm",
      args: ["pack", "--pack-destination", packDir],
      cwd: packageRoot
    });

    const files = await readdir(packDir);
    const tarball = files.find((file) => file.endsWith(".tgz"));
    if (!tarball) {
      throw new Error("pnpm pack did not produce a tarball.");
    }

    const tarballPath = path.join(packDir, tarball);
    await mkdir(installDir, { recursive: true });
    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-dev-airgap-smoke",
          private: true,
          version: "1.0.0"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await run({
      command: "npm",
      args: ["install", "--offline", "--ignore-scripts", tarballPath],
      cwd: installDir
    });

    await run({
      command: "node",
      args: [
        "--input-type=module",
        "-e",
        "const mod = await import('workspace-dev'); if (typeof mod.createWorkspaceServer !== 'function') throw new Error('ESM import failed');"
      ],
      cwd: installDir
    });

    await run({
      command: "node",
      args: [
        "-e",
        "const mod = require('workspace-dev'); if (typeof mod.createWorkspaceServer !== 'function') throw new Error('CJS require failed');"
      ],
      cwd: installDir
    });

    console.log("[airgap] Offline install and dual-module smoke checks passed.");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error("[airgap] Offline install verification failed:", error);
  process.exit(1);
});
