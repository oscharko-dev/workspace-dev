import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(
  packageRoot,
  "scripts/check-workflow-persist-credentials.mjs",
);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runCli = async (env: NodeJS.ProcessEnv = {}): Promise<CliResult> => {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
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
        reject(
          new Error(
            `check-workflow-persist-credentials exited via signal '${signal}'.`,
          ),
        );
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
};

const writeWorkflowFixture = async (
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<void> => {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
};

test("check-workflow-persist-credentials CLI: exits 0 when all checkouts have persist-credentials: false", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-persist-creds-clean-"),
  );
  try {
    await writeWorkflowFixture(
      tempRoot,
      ".github/workflows/ci.yml",
      [
        "name: clean",
        "jobs:",
        "  a:",
        "    steps:",
        "      - uses: actions/checkout@abc123  # v6",
        "        with:",
        "          persist-credentials: false",
        "      - run: pnpm install --frozen-lockfile --ignore-scripts",
        "",
      ].join("\n"),
    );

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      0,
      `Expected exit 0, got stderr:\n${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /\[check-workflow-persist-credentials\] Passed\./,
    );
    assert.equal(result.stderr, "");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-persist-credentials CLI: exits 1 and reports file:line when checkout is missing persist-credentials", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-persist-creds-dirty-"),
  );
  try {
    await writeWorkflowFixture(
      tempRoot,
      ".github/workflows/ci.yml",
      [
        "name: dirty",
        "jobs:",
        "  a:",
        "    steps:",
        "      - uses: actions/checkout@abc123",
        "",
        "      - run: echo done",
        "",
      ].join("\n"),
    );

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      1,
      `Expected exit 1, got stdout:\n${result.stdout}`,
    );
    assert.match(
      result.stderr,
      /\.github\/workflows\/ci\.yml:5 .*actions\/checkout/,
    );
    assert.match(
      result.stderr,
      /Missing persist-credentials: false on actions\/checkout steps/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-persist-credentials CLI: exits 0 when no workflow files exist", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-persist-creds-empty-"),
  );
  try {
    await mkdir(path.join(tempRoot, ".github", "workflows"), {
      recursive: true,
    });

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      0,
      `Expected exit 0, got stderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-persist-credentials CLI: allows persist-credentials: true in changesets-release.yml", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-persist-creds-allowlist-"),
  );
  try {
    await writeWorkflowFixture(
      tempRoot,
      ".github/workflows/changesets-release.yml",
      [
        "name: release",
        "jobs:",
        "  release:",
        "    steps:",
        "      - uses: actions/checkout@abc123",
        "        with:",
        "          persist-credentials: true",
        "      - run: pnpm publish",
        "",
      ].join("\n"),
    );

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      0,
      `Expected exit 0, got stderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
