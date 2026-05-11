#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROTECTED_BRANCHES = ["dev"];

export const resolvePackageRoot = (env = process.env) => {
  const override = env.WORKSPACE_DEV_PACKAGE_ROOT;
  if (typeof override === "string" && override.length > 0) {
    return path.resolve(override);
  }
  return DEFAULT_PACKAGE_ROOT;
};

export const parseProtectedBranches = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [...DEFAULT_PROTECTED_BRANCHES];
  }

  return value
    .split(",")
    .map((branch) => branch.trim())
    .filter(Boolean);
};

export const shouldBlockBranch = (branchName, protectedBranches) =>
  typeof branchName === "string" &&
  branchName.length > 0 &&
  protectedBranches.includes(branchName);

export const getCurrentBranch = ({
  cwd = resolvePackageRoot(),
  env = process.env,
  execFile = execFileSync,
} = {}) => {
  const output = execFile("git", ["branch", "--show-current"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.trim();
};

export const buildProtectedBranchMessage = ({
  operation,
  branchName,
  protectedBranches,
}) => {
  const protectedList = protectedBranches.join(", ");
  return [
    `[protected-branch] Direct ${operation} to '${branchName}' are blocked.`,
    `[protected-branch] Protected branches: ${protectedList}.`,
    "[protected-branch] Create a feature branch and open a pull request into the protected branch instead.",
  ].join("\n");
};

export const runGuard = ({
  operation = "commits",
  cwd = resolvePackageRoot(),
  env = process.env,
  execFile = execFileSync,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const protectedBranches = parseProtectedBranches(
    env.WORKSPACE_DEV_PROTECTED_BRANCHES,
  );

  let branchName = "";
  try {
    branchName = getCurrentBranch({ cwd, env, execFile });
  } catch (error) {
    stderr(
      `[protected-branch] Unable to determine current branch: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  if (!shouldBlockBranch(branchName, protectedBranches)) {
    stdout(
      `[protected-branch] Allowed ${operation} on '${branchName || "detached HEAD"}'.`,
    );
    return 0;
  }

  stderr(
    buildProtectedBranchMessage({ operation, branchName, protectedBranches }),
  );
  return 1;
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  const [, , operationArg] = process.argv;
  const exitCode = runGuard({
    operation: operationArg === "pushes" ? "pushes" : "commits",
  });
  process.exit(exitCode);
}
