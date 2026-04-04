import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "template", "react-mui-app");
const TEMPLATE_NODE_MODULES_DIR = path.join(TEMPLATE_ROOT, "node_modules");
const TEMPLATE_INSTALL_LOCK_DIR = path.join(TEMPLATE_ROOT, ".workspace-dev-test-install.lock");
const TEMPLATE_SEED_SENTINEL = path.join(TEMPLATE_NODE_MODULES_DIR, "eslint-plugin-jsx-a11y");

let preparedSeedPromise: Promise<void> | undefined;

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const hasTemplateValidationSeed = async (): Promise<boolean> => {
  try {
    await access(TEMPLATE_SEED_SENTINEL);
    return true;
  } catch {
    return false;
  }
};

const installTemplateDependencies = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts", "--reporter", "append-only", "--prefer-offline"],
      {
        cwd: TEMPLATE_ROOT,
        stdio: "ignore"
      }
    );

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Template dependency seed install failed with exit code ${code ?? "unknown"}.`));
    });
  });
};

const waitForTemplateInstall = async (): Promise<void> => {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (await hasTemplateValidationSeed()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for template validation seed at ${TEMPLATE_NODE_MODULES_DIR}.`);
};

// Materialize the template's own dependency graph once so heavy job-engine tests
// can reuse it through validate.project's seeded node_modules path.
export const ensureTemplateValidationSeedNodeModules = async (): Promise<void> => {
  if (preparedSeedPromise) {
    await preparedSeedPromise;
    return;
  }

  preparedSeedPromise = (async () => {
    if (await hasTemplateValidationSeed()) {
      return;
    }

    try {
      await mkdir(TEMPLATE_INSTALL_LOCK_DIR);
      try {
        await installTemplateDependencies();
      } finally {
        await rm(TEMPLATE_INSTALL_LOCK_DIR, { recursive: true, force: true });
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
      await waitForTemplateInstall();
    }

    if (!(await hasTemplateValidationSeed())) {
      throw new Error(`Template validation seed is still unavailable at ${TEMPLATE_NODE_MODULES_DIR}.`);
    }
  })();

  try {
    await preparedSeedPromise;
  } catch (error) {
    preparedSeedPromise = undefined;
    throw error;
  }
};
