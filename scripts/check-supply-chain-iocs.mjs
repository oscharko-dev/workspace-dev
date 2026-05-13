#!/usr/bin/env node

/**
 * Fast IOC guard for active npm supply-chain campaigns.
 *
 * This is intentionally small and deterministic: it scans package manifests,
 * lockfiles, and workflows for campaign-specific package versions, payload
 * names, cache keys, exotic resolver fingerprints, and exfiltration hosts.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");

const STATIC_TARGETS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "template/react-mui-app/package.json",
  "template/react-mui-app/pnpm-lock.yaml",
  "template/react-mui-app/pnpm-workspace.yaml",
  "template/react-tailwind-app/package.json",
  "template/react-tailwind-app/pnpm-lock.yaml",
  "template/react-tailwind-app/pnpm-workspace.yaml",
];

export const IOCs = [
  {
    id: "tanstack-orphan-setup-resolver",
    pattern:
      /@tanstack\/setup|github:tanstack\/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c/iu,
  },
  {
    id: "tanstack-router-init-payload",
    pattern:
      /router_init\.js|vite_setup\.mjs|Linux-pnpm-store-6f9233a50def742c09fde54f56553d6b449a535adf87d4083690539f49ae4da11/iu,
  },
  {
    id: "tanstack-exfiltration-hosts",
    pattern:
      /litter\.catbox\.moe|filev2\.getsession\.org|seed[123]\.getsession\.org/iu,
  },
  {
    id: "mini-shai-hulud-runtime-payload",
    pattern: /router_runtime\.js|setup\.mjs/iu,
  },
  {
    id: "known-compromised-npm-versions",
    pattern:
      /(?:intercom-client@7\.0\.4|mbt@1\.2\.48|@cap-js\/db-service@2\.10\.1|@cap-js\/postgres@2\.2\.2|@cap-js\/sqlite@2\.2\.2)/iu,
  },
  {
    id: "known-malicious-publisher-or-actor-fingerprint",
    pattern:
      /npm-oidc-no-reply@github\.com|zblgg\/configuration|voicproducoes/iu,
  },
];

const workflowTargets = async (packageRoot) => {
  const workflowDir = path.join(packageRoot, ".github", "workflows");
  const entries = await readdir(workflowDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .map((entry) => path.join(".github", "workflows", entry.name))
    .sort();
};

export const defaultTargets = async (packageRoot = DEFAULT_PACKAGE_ROOT) => [
  ...STATIC_TARGETS,
  ...(await workflowTargets(packageRoot)),
];

export const scanContent = (content, filePath, iocs = IOCs) => {
  const findings = [];

  for (const ioc of iocs) {
    const match = ioc.pattern.exec(content);
    if (match) {
      const prefix = content.slice(0, match.index);
      const line = prefix.split("\n").length;
      findings.push({
        filePath,
        id: ioc.id,
        line,
        matched: match[0],
      });
    }
  }

  return findings;
};

export const runGuard = async ({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  readTextFile = readFile,
  targets,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const resolvedTargets = targets ?? (await defaultTargets(packageRoot));
  const findings = [];

  for (const rel of resolvedTargets) {
    const filePath = path.join(packageRoot, rel);
    const content = await readTextFile(filePath, "utf8");
    findings.push(...scanContent(content, rel));
  }

  if (findings.length > 0) {
    stderr("[check-supply-chain-iocs] Active npm supply-chain IOC(s) found:");
    for (const finding of findings) {
      stderr(
        ` - ${finding.filePath}:${finding.line} ${finding.id} matched ${JSON.stringify(
          finding.matched,
        )}`,
      );
    }
    stderr(
      "[check-supply-chain-iocs] Treat affected install hosts and CI jobs as compromised before bypassing this guard.",
    );
    return 1;
  }

  stdout(
    `[check-supply-chain-iocs] Passed. Scanned ${resolvedTargets.length} manifest, lockfile, and workflow file(s).`,
  );
  return 0;
};

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  const exitCode = await runGuard();
  process.exit(exitCode);
}
