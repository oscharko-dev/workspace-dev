import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const expectedRepositoryUrl = "git+https://github.com/oscharko-dev/workspace-dev.git";
const expectedHomepageUrl = "https://github.com/oscharko-dev/workspace-dev#readme";
const expectedBugsUrl = "https://github.com/oscharko-dev/workspace-dev/issues";

const run = async ({
  command,
  args,
  cwd
}: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Command '${command} ${args.join(" ")}' exited via signal '${signal}'.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command '${command} ${args.join(" ")}' failed with exit code ${code ?? 1}.\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
};

test("package distribution includes template lockfile but excludes template node_modules", async () => {
  const packDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-"));
  const extractDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pack-extract-"));

  try {
    await run({
      command: "pnpm",
      args: ["pack", "--pack-destination", packDir],
      cwd: packageRoot
    });

    const packedFiles = await readdir(packDir);
    const tarball = packedFiles.find((fileName) => fileName.endsWith(".tgz"));
    assert.notEqual(tarball, undefined, "Expected pnpm pack to produce a tarball.");

    const tarballListing = await run({
      command: "tar",
      args: ["-tzf", path.join(packDir, tarball ?? "")],
      cwd: packageRoot
    });

    assert.match(tarballListing, /package\/GOVERNANCE\.md/);
    assert.match(tarballListing, /package\/template\/react-mui-app\/package\.json/);
    assert.match(tarballListing, /package\/template\/react-mui-app\/pnpm-lock\.yaml/);
    assert.doesNotMatch(tarballListing, /package\/template\/react-mui-app\/node_modules\//);

    await run({
      command: "tar",
      args: ["-xzf", path.join(packDir, tarball), "-C", extractDir, "package/package.json"],
      cwd: packageRoot
    });

    const packagedManifest = JSON.parse(
      await readFile(path.join(extractDir, "package", "package.json"), "utf8")
    ) as {
      repository: {
        type: string;
        url: string;
      };
      homepage: string;
      bugs: {
        url: string;
      };
      peerDependencies: {
        typescript: string;
      };
      peerDependenciesMeta: {
        typescript: {
          optional: boolean;
        };
      };
    };

    assert.equal(packagedManifest.repository.type, "git");
    assert.equal(packagedManifest.repository.url, expectedRepositoryUrl);
    assert.equal(packagedManifest.homepage, expectedHomepageUrl);
    assert.equal(packagedManifest.bugs.url, expectedBugsUrl);
    assert.equal(packagedManifest.peerDependencies.typescript, ">=5.0.0");
    assert.equal(packagedManifest.peerDependenciesMeta.typescript.optional, true);
  } finally {
    await rm(packDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
});
