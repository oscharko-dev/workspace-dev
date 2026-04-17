#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
export const TRACKED_LOCKFILE_PATHS = [
  path.resolve(packageRoot, "pnpm-lock.yaml"),
  path.resolve(packageRoot, "template/react-mui-app/pnpm-lock.yaml")
];

const DEFAULT_ALLOWED_HOSTS = ["registry.npmjs.org"];
const HOST_LABEL_PATTERN = /^[a-z0-9-]+$/;
const HOST_ENTRY_PATTERN = /^[a-z0-9.-]+$/;

const isValidHost = (value) => {
  if (!HOST_ENTRY_PATTERN.test(value) || value.length > 253) {
    return false;
  }

  const labels = value.split(".");
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      HOST_LABEL_PATTERN.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
  );
};

export const normalizeHosts = (values, optionName) => {
  const normalizedHosts = [];
  const seenHosts = new Set();

  for (const value of values) {
    const entries = value.split(",");
    for (const entry of entries) {
      const normalizedEntry = entry.trim().toLowerCase();
      if (normalizedEntry.length === 0) {
        throw new Error(`${optionName} must not contain empty host entries.`);
      }
      if (!isValidHost(normalizedEntry)) {
        throw new Error(
          `${optionName} contains malformed host '${entry.trim() || entry}'. Expected bare hostnames like 'registry.npmjs.org'.`
        );
      }
      if (!seenHosts.has(normalizedEntry)) {
        seenHosts.add(normalizedEntry);
        normalizedHosts.push(normalizedEntry);
      }
    }
  }

  return normalizedHosts.sort((first, second) => first.localeCompare(second));
};

export const parseArgs = (args) => {
  const allowHostValues = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }

    if (current === "--allow-hosts") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --allow-hosts.");
      }
      allowHostValues.push(next);
      index += 1;
      continue;
    }

    if (current.startsWith("--allow-hosts=")) {
      allowHostValues.push(current.slice("--allow-hosts=".length));
      continue;
    }

    if (current.startsWith("--")) {
      throw new Error(`Unknown flag: ${current}`);
    }

    throw new Error(`Unexpected positional argument: ${current}`);
  }

  const overrideHosts = allowHostValues.length > 0 ? normalizeHosts(allowHostValues, "--allow-hosts") : null;
  return {
    hasOverride: overrideHosts !== null,
    overrideHosts
  };
};

export const resolveAllowedHosts = (overrideHosts) => {
  return new Set(overrideHosts ?? DEFAULT_ALLOWED_HOSTS);
};

export const formatHosts = (hosts) => {
  return [...hosts].sort((first, second) => first.localeCompare(second)).join(", ");
};

export const extractHosts = (content) => {
  const hosts = new Set();
  const urlPattern = /tarball:\s*(https?:\/\/([a-zA-Z0-9.-]+)(?::\d+)?\/[^\s,}]+)/g;
  for (const match of content.matchAll(urlPattern)) {
    const host = match[2];
    if (host) {
      hosts.add(host.toLowerCase());
    }
  }
  return hosts;
};

export const scanLockfileHosts = async ({ lockfilePaths = TRACKED_LOCKFILE_PATHS, readTextFile = readFile }) => {
  const observedHosts = new Set();

  for (const lockfilePath of lockfilePaths) {
    const content = await readTextFile(lockfilePath, "utf8");
    const lockfileHosts = extractHosts(content);
    for (const host of lockfileHosts) {
      observedHosts.add(host);
    }
  }

  return observedHosts;
};

export const runLockfileHostAllowlist = async ({
  args = process.argv.slice(2),
  env = process.env,
  lockfilePaths = TRACKED_LOCKFILE_PATHS,
  readTextFile = readFile,
  stdout = console.log,
  stderr = console.error
} = {}) => {
  try {
    const { hasOverride, overrideHosts } = parseArgs(args);
    const allowedHosts = resolveAllowedHosts(overrideHosts);

    stdout(`[lockfile-host-allowlist] Effective allowlist: ${formatHosts(allowedHosts)}`);

    if (hasOverride && env.GITHUB_ACTIONS === "true") {
      throw new Error(
        "CLI host overrides are refused in GitHub Actions. Remove --allow-hosts when GITHUB_ACTIONS=true."
      );
    }

    const observedHosts = await scanLockfileHosts({ lockfilePaths, readTextFile });

    const unexpectedHosts = [...observedHosts].filter((host) => !allowedHosts.has(host)).sort();
    if (unexpectedHosts.length > 0) {
      stderr("[lockfile-host-allowlist] Unexpected hosts found in tracked lockfiles:");
      for (const host of unexpectedHosts) {
        stderr(` - ${host}`);
      }
      stderr(`[lockfile-host-allowlist] Allowed hosts: ${formatHosts(allowedHosts)}`);
      return 1;
    }

    stdout(
      `[lockfile-host-allowlist] Passed. Observed hosts: ${[...observedHosts].sort().join(", ") || "(none)"}`
    );
    return 0;
  } catch (error) {
    stderr(`[lockfile-host-allowlist] Failed: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return typeof entryPath === "string" && path.resolve(entryPath) === fileURLToPath(import.meta.url);
};

if (isCliEntry()) {
  const exitCode = await runLockfileHostAllowlist();
  process.exit(exitCode);
}
