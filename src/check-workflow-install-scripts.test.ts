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
  "scripts/check-workflow-install-scripts.mjs",
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
            `check-workflow-install-scripts exited via signal '${signal}'.`,
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

const writePackageJson = async (
  rootDir: string,
  body: unknown,
): Promise<void> => {
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify(body, null, 2),
    "utf8",
  );
};

test("check-workflow-install-scripts CLI: exits 0 when all installs use --ignore-scripts", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-workflow-install-scripts-clean-"),
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
        "      - run: pnpm install --frozen-lockfile --ignore-scripts",
        "      - run: pnpm --dir template/react-mui-app install --frozen-lockfile --ignore-scripts",
        "      - run: pnpm exec playwright install --with-deps chromium",
        "      - run: pnpm exec playwright install-deps chromium",
        "",
      ].join("\n"),
    );
    await writePackageJson(tempRoot, {
      name: "fixture",
      scripts: {
        "template:install":
          "pnpm --dir template/react-mui-app install --frozen-lockfile --ignore-scripts",
      },
    });

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      0,
      `Expected exit 0, got stderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /\[check-workflow-install-scripts\] Passed\./);
    assert.equal(result.stderr, "");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-install-scripts CLI: exits 1 and reports file:line when a workflow install is missing --ignore-scripts", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-workflow-install-scripts-dirty-"),
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
        "      - run: pnpm install --frozen-lockfile",
        "",
      ].join("\n"),
    );
    await writePackageJson(tempRoot, { name: "fixture", scripts: {} });

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      1,
      `Expected exit 1, got stdout:\n${result.stdout}`,
    );
    assert.match(
      result.stderr,
      /\.github\/workflows\/ci\.yml:5 .*pnpm install --frozen-lockfile/,
    );
    assert.match(
      result.stderr,
      /Missing --ignore-scripts on CI dependency installs/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-install-scripts CLI: exits 1 when a package.json script is missing --ignore-scripts", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-workflow-install-scripts-pkg-"),
  );
  try {
    await writeWorkflowFixture(
      tempRoot,
      ".github/workflows/ci.yml",
      ["name: clean", "# no installs here", ""].join("\n"),
    );
    await writePackageJson(tempRoot, {
      name: "fixture",
      scripts: {
        "template:install":
          "pnpm --dir template/react-mui-app install --frozen-lockfile",
      },
    });

    const result = await runCli({ WORKSPACE_DEV_PACKAGE_ROOT: tempRoot });
    assert.equal(
      result.code,
      1,
      `Expected exit 1, got stdout:\n${result.stdout}`,
    );
    assert.match(result.stderr, /package\.json \[script: template:install\]/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("check-workflow-install-scripts CLI: ignores yaml comment lines", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-workflow-install-scripts-comment-"),
  );
  try {
    await writeWorkflowFixture(
      tempRoot,
      ".github/workflows/ci.yml",
      [
        "name: comment",
        "jobs:",
        "  a:",
        "    steps:",
        "      # run: pnpm install --frozen-lockfile",
        "      - run: pnpm install --frozen-lockfile --ignore-scripts",
        "",
      ].join("\n"),
    );
    await writePackageJson(tempRoot, { name: "fixture", scripts: {} });

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
