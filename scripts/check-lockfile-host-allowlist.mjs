#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const lockfilePaths = [
  path.resolve(packageRoot, "pnpm-lock.yaml"),
  path.resolve(packageRoot, "template/react-mui-app/pnpm-lock.yaml")
];

const DEFAULT_ALLOWED_HOSTS = ["registry.npmjs.org"];

const resolveAllowedHosts = () => {
  const raw = process.env.WORKSPACE_DEV_LOCKFILE_ALLOWED_HOSTS;
  if (!raw) {
    return new Set(DEFAULT_ALLOWED_HOSTS);
  }
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
};

const extractHosts = (content) => {
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

const main = async () => {
  const allowedHosts = resolveAllowedHosts();
  const observedHosts = new Set();

  for (const lockfilePath of lockfilePaths) {
    const content = await readFile(lockfilePath, "utf8");
    const lockfileHosts = extractHosts(content);
    for (const host of lockfileHosts) {
      observedHosts.add(host);
    }
  }

  const unexpectedHosts = [...observedHosts].filter((host) => !allowedHosts.has(host)).sort();
  if (unexpectedHosts.length > 0) {
    console.error("[lockfile-host-allowlist] Unexpected hosts found in tracked lockfiles:");
    for (const host of unexpectedHosts) {
      console.error(` - ${host}`);
    }
    console.error(`[lockfile-host-allowlist] Allowed hosts: ${[...allowedHosts].sort().join(", ")}`);
    process.exit(1);
  }

  console.log(
    `[lockfile-host-allowlist] Passed. Observed hosts: ${[...observedHosts].sort().join(", ") || "(none)"}`
  );
};

main().catch((error) => {
  console.error("[lockfile-host-allowlist] Failed:", error);
  process.exit(1);
});
