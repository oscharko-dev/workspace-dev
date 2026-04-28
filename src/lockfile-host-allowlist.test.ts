import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/check-lockfile-host-allowlist.mjs");
const { extractHosts, runLockfileHostAllowlist } = await import(pathToFileURL(scriptPath).href);

const createLockfileFromEntries = (entries: string[]): string => {
  return `lockfileVersion: '9.0'\n\npackages:\n${entries.join("")}`;
};

const createLockfile = (hosts: string[]): string => {
  const entries = hosts.map((host, index) => {
    const dependencyName = `fixture-${index + 1}`;
    return `  ${dependencyName}@1.0.0:\n    resolution: {integrity: sha512-${index + 1}, tarball: https://${host}/${dependencyName}-${index + 1}.tgz}\n`;
  });

  return createLockfileFromEntries(entries);
};

const writeLockfiles = async (rootPath: string, rootHosts: string[], templateHosts: string[]) => {
  const templateRoot = path.join(rootPath, "template/react-mui-app");
  await mkdir(templateRoot, { recursive: true });
  await writeFile(path.join(rootPath, "pnpm-lock.yaml"), createLockfile(rootHosts), "utf8");
  await writeFile(path.join(templateRoot, "pnpm-lock.yaml"), createLockfile(templateHosts), "utf8");
};

const runCliCheck = async ({
  args = [],
  env = {}
}: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: packageRoot,
      env: {
        ...process.env,
        ...env
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
        reject(new Error(`check-lockfile-host-allowlist exited via signal '${signal}'.`));
        return;
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

const runHelperCheck = async ({
  args = [],
  env = {},
  rootHosts = ["registry.npmjs.org"],
  templateHosts = ["registry.npmjs.org"],
  rootContent,
  templateContent,
  lockfilePaths = [
    "/virtual/pnpm-lock.yaml",
    "/virtual/template/react-mui-app/pnpm-lock.yaml",
    "/virtual/template/react-tailwind-app/pnpm-lock.yaml",
  ],
  readTextFile
}: {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  rootHosts?: string[];
  templateHosts?: string[];
  rootContent?: string;
  templateContent?: string;
  lockfilePaths?: string[];
  readTextFile?: (filePath: string, encoding: string) => Promise<string>;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const lockfileContents = new Map<string, string>([
    [lockfilePaths[0]!, rootContent ?? createLockfile(rootHosts)],
    [lockfilePaths[1]!, templateContent ?? createLockfile(templateHosts)],
    [lockfilePaths[2]!, createLockfile(["registry.npmjs.org"])],
  ]);

  const code = await runLockfileHostAllowlist({
    args,
    env: {
      ...process.env,
      ...env
    },
    lockfilePaths,
    readTextFile:
      readTextFile ??
      (async (filePath: string) => {
        const content = lockfileContents.get(filePath);
        if (!content) {
          throw new Error(`Unexpected lockfile path: ${filePath}`);
        }
        return content;
      }),
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
    stderr: (line: string) => {
      stderrLines.push(line);
    }
  });

  return {
    code,
    stdout: stdoutLines.length > 0 ? `${stdoutLines.join("\n")}\n` : "",
    stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : ""
  };
};

test("lockfile host allowlist CLI remains bound to tracked repo lockfiles even when WORKSPACE_DEV_PACKAGE_ROOT is set", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-lockfile-hosts-root-redirect-"));

  try {
    await writeLockfiles(tempRoot, ["mirror.local"], ["mirror.local"]);
    const result = await runCliCheck({
      env: {
        WORKSPACE_DEV_PACKAGE_ROOT: tempRoot
      }
    });

    assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
    assert.match(result.stdout, /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/);
    assert.match(result.stdout, /\[lockfile-host-allowlist\] Passed\. Observed hosts:/);
    assert.doesNotMatch(result.stdout, /mirror\.local/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("lockfile host allowlist ignores WORKSPACE_DEV_LOCKFILE_ALLOWED_HOSTS", async () => {
  const result = await runHelperCheck({
    env: {
      WORKSPACE_DEV_LOCKFILE_ALLOWED_HOSTS: "mirror.local"
    },
    rootHosts: ["mirror.local"]
  });

  assert.equal(result.code, 1, `Expected failure, got stdout:\n${result.stdout}`);
  assert.match(result.stdout, /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/);
  assert.match(result.stderr, /Unexpected hosts found in tracked lockfiles:/);
  assert.match(result.stderr, / - mirror\.local/);
  assert.doesNotMatch(result.stdout, /Effective allowlist: .*mirror\.local/);
});

test("lockfile host allowlist accepts local CLI overrides via both supported flag forms", async () => {
  const splitFlagResult = await runHelperCheck({
    args: ["--allow-hosts", " mirror.local , REGISTRY.NPMJS.ORG , mirror.local "],
    rootHosts: ["mirror.local"],
    templateHosts: ["registry.npmjs.org"]
  });
  const equalsFlagResult = await runHelperCheck({
    args: ["--allow-hosts=mirror.local,registry.npmjs.org"],
    rootHosts: ["mirror.local"],
    templateHosts: ["registry.npmjs.org"]
  });

  for (const result of [splitFlagResult, equalsFlagResult]) {
    assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
    assert.match(
      result.stdout,
      /\[lockfile-host-allowlist\] Effective allowlist: mirror\.local, registry\.npmjs\.org/
    );
    assert.match(
      result.stdout,
      /\[lockfile-host-allowlist\] Passed\. Observed hosts: mirror\.local, registry\.npmjs\.org/
    );
    assert.equal(result.stderr, "");
  }
});

test("lockfile host allowlist refuses CLI overrides in GitHub Actions before scanning lockfiles", async () => {
  let readCount = 0;
  const result = await runHelperCheck({
    args: ["--allow-hosts=mirror.local"],
    env: {
      GITHUB_ACTIONS: "true"
    },
    readTextFile: async () => {
      readCount += 1;
      throw new Error("lockfile scan should not run");
    }
  });

  assert.equal(result.code, 1, `Expected GitHub Actions refusal, got stdout:\n${result.stdout}`);
  assert.equal(readCount, 0, "Expected refusal before scanning lockfiles.");
  assert.match(result.stdout, /\[lockfile-host-allowlist\] Effective allowlist: mirror\.local/);
  assert.match(result.stderr, /CLI host overrides are refused in GitHub Actions/);
  assert.doesNotMatch(result.stderr, /lockfile scan should not run/);
});

test("lockfile host allowlist preserves tarball detection and detects explicit non-tarball resolver URLs", () => {
  const content = createLockfileFromEntries([
    "  tarball-fixture@1.0.0:\n    resolution: {integrity: sha512-1, tarball: https://registry.npmjs.org/tarball-fixture-1.0.0.tgz}\n",
    "  standalone-resolution@1.0.0:\n    resolution: https://codeload.github.com/example/project/tar.gz/abcdef\n",
    "  resolved-fixture@1.0.0:\n    resolved: https://mirror.local/resolved-fixture-1.0.0.tgz\n",
    "  repository-fixture@1.0.0:\n    repository: https://repo.example.com/example/project.git\n",
    "  git-specifier-fixture@1.0.0:\n    resolution: git+https://git.example.com/example/project.git#deadbeef\n"
  ]);

  assert.deepEqual([...extractHosts(content)].sort(), [
    "codeload.github.com",
    "git.example.com",
    "mirror.local",
    "registry.npmjs.org",
    "repo.example.com"
  ]);
});

test("lockfile host allowlist reports explicit non-tarball resolver hosts through the gate", async () => {
  const rootContent = createLockfileFromEntries([
    "  standalone-resolution@1.0.0:\n    resolution: https://codeload.github.com/example/project/tar.gz/abcdef\n",
    "  resolved-fixture@1.0.0:\n    resolved: https://mirror.local/resolved-fixture-1.0.0.tgz\n",
    "  repository-fixture@1.0.0:\n    repository: git+https://git.example.com/example/project.git#deadbeef\n"
  ]);

  const result = await runHelperCheck({
    rootContent,
    templateHosts: ["registry.npmjs.org"]
  });

  assert.equal(result.code, 1, `Expected failure, got stdout:\n${result.stdout}`);
  assert.match(result.stdout, /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/);
  assert.match(result.stderr, /Unexpected hosts found in tracked lockfiles:/);
  assert.match(result.stderr, / - codeload\.github\.com/);
  assert.match(result.stderr, / - git\.example\.com/);
  assert.match(result.stderr, / - mirror\.local/);
});

test("lockfile host allowlist fails closed for malformed URL-like resolver content", async () => {
  const rootContent = createLockfileFromEntries([
    "  malformed-resolution@1.0.0:\n    resolution: https://\n"
  ]);

  const result = await runHelperCheck({
    rootContent
  });

  assert.equal(result.code, 1, `Expected malformed resolver failure, got stdout:\n${result.stdout}`);
  assert.match(result.stdout, /\[lockfile-host-allowlist\] Effective allowlist: registry\.npmjs\.org/);
  assert.match(result.stderr, /Malformed URL-like resolver content in resolution: https:\/\//);
  assert.doesNotMatch(result.stderr, /Unexpected hosts found in tracked lockfiles:/);
});

test("lockfile host allowlist accepts inline resolver URLs whose query strings contain nested https tokens", () => {
  const content = createLockfileFromEntries([
    "  proxied-inline-resolution@1.0.0:\n    resolution: {tarball: https://proxy.example.com/fetch?url=https://registry.npmjs.org/pkg/-/pkg.tgz}\n"
  ]);

  assert.deepEqual([...extractHosts(content)], ["proxy.example.com"]);
});

test("lockfile host allowlist fails closed for mixed inline resolver objects with malformed URL-like fragments", () => {
  const content = createLockfileFromEntries([
    "  mixed-inline-resolution@1.0.0:\n    resolution: {integrity: sha512-1, tarball: https://registry.npmjs.org/mixed-1.0.0.tgz, broken: https://}\n"
  ]);

  assert.throws(
    () => extractHosts(content),
    /Malformed URL-like resolver content in resolution: \{integrity: sha512-1, tarball: https:\/\/registry\.npmjs\.org\/mixed-1\.0\.0\.tgz, broken: https:\/\/\}/
  );
});

test("lockfile host allowlist fails clearly for unknown flags and malformed host values", async () => {
  const unknownFlagResult = await runHelperCheck({
    args: ["--unexpected-flag"]
  });
  const malformedHostResult = await runHelperCheck({
    args: ["--allow-hosts=https://registry.npmjs.org"]
  });
  const emptyHostEntryResult = await runHelperCheck({
    args: ["--allow-hosts=registry.npmjs.org, ,mirror.local"]
  });

  assert.equal(unknownFlagResult.code, 1, `Expected unknown flag failure, got stdout:\n${unknownFlagResult.stdout}`);
  assert.match(unknownFlagResult.stderr, /Unknown flag: --unexpected-flag/);
  assert.doesNotMatch(unknownFlagResult.stdout, /Effective allowlist:/);

  assert.equal(
    malformedHostResult.code,
    1,
    `Expected malformed host failure, got stdout:\n${malformedHostResult.stdout}`
  );
  assert.match(
    malformedHostResult.stderr,
    /--allow-hosts contains malformed host 'https:\/\/registry\.npmjs\.org'/
  );
  assert.doesNotMatch(malformedHostResult.stdout, /Effective allowlist:/);

  assert.equal(
    emptyHostEntryResult.code,
    1,
    `Expected empty host entry failure, got stdout:\n${emptyHostEntryResult.stdout}`
  );
  assert.match(emptyHostEntryResult.stderr, /--allow-hosts must not contain empty host entries/);
  assert.doesNotMatch(emptyHostEntryResult.stdout, /Effective allowlist:/);
});
