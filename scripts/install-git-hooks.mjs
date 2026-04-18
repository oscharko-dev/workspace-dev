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

  execFile("git", ["config", "core.hooksPath", ".githooks"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  stdout("[install-git-hooks] Configured core.hooksPath to .githooks.");
  return 0;
};

if (isCliEntry()) {
  const exitCode = runInstall();
  process.exit(exitCode);
}
