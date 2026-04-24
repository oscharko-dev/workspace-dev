#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

export const runInstall = ({
  cwd = PACKAGE_ROOT,
  env = process.env,
  execFile = execFileSync,
  stdout = console.log,
} = {}) => {
  if (env.CI === "true") {
    stdout("[install-git-hooks] Skipping hook installation in CI.");
    return 0;
  }

  execFile("git", ["rev-parse", "--git-dir"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Use an absolute path so each working tree (including git worktrees, which
  // maintain their own config.worktree) binds hooks to its own .githooks dir.
  // A relative value would be resolved against the gitdir, which for a
  // worktree is .git/worktrees/<name>/ and contains no hooks.
  const hooksPath = path.join(cwd, ".githooks");

  // `--worktree` targets $GIT_DIR/config.worktree when
  // extensions.worktreeConfig is enabled; otherwise it behaves like `--local`.
  // Using it unconditionally means: main working tree writes to .git/config,
  // each linked worktree writes to its own config.worktree — so neither
  // overwrites the other's hooks path.
  execFile("git", ["config", "--worktree", "core.hooksPath", hooksPath], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  stdout(`[install-git-hooks] Configured core.hooksPath to ${hooksPath}.`);
  return 0;
};

if (isCliEntry()) {
  const exitCode = runInstall();
  process.exit(exitCode);
}
