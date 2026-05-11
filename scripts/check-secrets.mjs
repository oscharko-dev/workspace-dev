#!/usr/bin/env node

/**
 * Pre-commit secret & tenant-metadata guard.
 *
 * Blocks credentials (AWS/GCP/GitHub/Slack/Figma/OpenAI/Anthropic/Stripe/npm
 * tokens, JWTs, PEM private keys, basic-auth URLs, Azure storage keys) and
 * tenant/operator metadata files (.env, infra/, .claude/, .codex/, AGENTS.md,
 * CLAUDE.md, mcp.json, …) from being committed.
 *
 * Design:
 * - Scans ONLY the staged diff (`git diff --cached -U0`). Added lines only.
 *   Pre-existing content in the repo is not flagged, so the hook cannot be
 *   "stuck" by unrelated lines.
 * - Path blocklist is evaluated against the staged file list
 *   (`git diff --cached --name-only --diff-filter=AM -z`).
 * - Zero runtime deps; aligned with the package's zero-dep supply-chain posture.
 *
 * Escape hatches (use sparingly, e.g. for documentation examples):
 * - Per-line: trailing `pragma: allowlist secret` recognised in shell (#),
 *   JS line (//), JS block, and HTML comment styles.
 * - Per-path: `.env.example` / `.env.sample` are exempt from content scanning
 *   (they belong in the repo and are explicitly allowed by .gitignore).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profileDefinitions, resolveBuildProfiles } from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, "..");

const resolvePackageRoot = (env = process.env) => {
  const override = env.WORKSPACE_DEV_PACKAGE_ROOT;
  if (typeof override === "string" && override.length > 0) {
    return path.resolve(override);
  }
  return DEFAULT_PACKAGE_ROOT;
};

// ── credential patterns ─────────────────────────────────────────────────────
// Each pattern is designed to be prefix-anchored where possible to keep the
// false-positive rate low. Generic high-entropy heuristics are intentionally
// omitted — they produce noise on lockfiles, minified bundles, and SRI hashes.

export const SECRET_PATTERNS = [
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "github-pat",
    description: "GitHub personal access token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  },
  {
    id: "github-fine-grained-pat",
    description: "GitHub fine-grained PAT",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/,
  },
  {
    id: "slack-token",
    description: "Slack API token",
    pattern: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: "figma-pat",
    description: "Figma personal access token",
    pattern: /\bfigd_[A-Za-z0-9_-]{30,}\b/,
  },
  {
    id: "figma-oauth",
    description: "Figma OAuth token",
    pattern: /\bfigoa_[A-Za-z0-9_-]{30,}\b/,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: "gcp-service-account",
    description: "GCP service-account JSON marker",
    pattern: /"type"\s*:\s*"service_account"/,
  },
  {
    id: "npm-token",
    description: "npm access token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    id: "openai-api-key",
    description: "OpenAI API key",
    pattern: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: "anthropic-api-key",
    description: "Anthropic API key",
    pattern: /\bsk-ant-(?:api|admin)[0-9]{2}-[A-Za-z0-9_-]{80,}\b/,
  },
  {
    id: "stripe-secret-key",
    description: "Stripe secret/restricted key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: "jwt",
    description: "JWT (header.payload.signature)",
    pattern:
      /\beyJ[A-Za-z0-9_=-]{10,}\.eyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\b/,
  },
  {
    id: "private-key-pem",
    description: "PEM-encoded private key",
    pattern:
      /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    id: "basic-auth-url",
    description: "URL with embedded credentials",
    pattern:
      /\b(?:https?|ftp|ssh|git|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rabbitmq):\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s/]+/,
  },
  {
    id: "azure-storage-key",
    description: "Azure storage connection string",
    pattern:
      /\bDefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{20,}/i,
  },
];

// ── path blocklist (tenant / operator metadata) ─────────────────────────────
// Keep aligned with .gitignore so a force-add attempt is rejected loudly
// rather than silently succeeding.

export const BLOCKED_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "service-account.json",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "Glossar.md",
  "PR-Wellen.md",
  "FIGMA_GUIDE.md",
  "FIGMA_LEITFADEN.md",
  "FIGMA_LEITFADEN_V2.md",
  "mcp.json",
  ".mcp.json",
]);

export const BLOCKED_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".jks",
  ".keystore",
  ".asc",
]);

export const BLOCKED_PATH_PREFIXES = [
  "infra/",
  ".codex/",
  ".claude/",
  ".intent/",
  ".playwright-mcp/",
  ".idea/",
  ".vscode/",
  ".aws/",
  "sandbox/",
  "testdata/",
];

// `.env` is blocked, but `.env.example` / `.env.sample` are templates that
// belong in the repo (and are explicitly allowed in .gitignore).
const ENV_FILENAME_ALLOW = new Set([".env.example", ".env.sample"]);
const ENV_FILENAME_BLOCK = /^\.env(?:\.[^/]+)?$/;

const PRAGMA_ALLOW_LINE =
  /(?:#|\/\/|\/\*|<!--)\s*pragma:\s*allowlist\s*secret/i;

export const isPragmaAllowlisted = (line) =>
  typeof line === "string" && PRAGMA_ALLOW_LINE.test(line);

const FIGMA_PRESIGNED_THUMBNAIL_URL =
  /https:\/\/s3-alpha\.figma\.com\/[^\s"]*\bX-Amz-Credential=/;

const isDocumentedPublicCredentialContext = ({ patternId, line }) => {
  return (
    patternId === "aws-access-key-id" &&
    FIGMA_PRESIGNED_THUMBNAIL_URL.test(line)
  );
};

// ── path classification ─────────────────────────────────────────────────────

export const classifyPath = (relativePath) => {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return null;
  }
  const normalized = relativePath.split(path.sep).join("/");
  const basename = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;

  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (
      normalized === prefix.replace(/\/$/, "") ||
      normalized.startsWith(prefix)
    ) {
      return {
        reason: `path is inside blocked tenant-metadata directory '${prefix}'`,
      };
    }
  }

  if (ENV_FILENAME_ALLOW.has(basename)) {
    return null;
  }
  if (ENV_FILENAME_BLOCK.test(basename)) {
    return {
      reason:
        "environment files are blocked; commit a .env.example or .env.sample template instead",
    };
  }

  if (BLOCKED_BASENAMES.has(basename)) {
    return { reason: `filename '${basename}' is on the blocklist` };
  }

  const lowerBasename = basename.toLowerCase();
  const dotIndex = lowerBasename.lastIndexOf(".");
  if (dotIndex > 0) {
    const ext = lowerBasename.slice(dotIndex);
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return {
        reason: `extension '${ext}' is reserved for keys/certificates and cannot be committed`,
      };
    }
  }

  return null;
};

// ── content scanning ────────────────────────────────────────────────────────

export const scanContent = (content, { filename = "", startLine = 1 } = {}) => {
  if (typeof content !== "string" || content.length === 0) {
    return [];
  }
  const findings = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isPragmaAllowlisted(line)) {
      continue;
    }
    for (const { id, pattern, description } of SECRET_PATTERNS) {
      if (isDocumentedPublicCredentialContext({ patternId: id, line })) {
        continue;
      }
      if (pattern.test(line)) {
        findings.push({
          file: filename,
          line: startLine + i,
          patternId: id,
          description,
          excerpt: truncateExcerpt(line),
        });
      }
    }
  }
  return findings;
};

const truncateExcerpt = (line, max = 160) => {
  const trimmed = line.trimStart();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
};

// ── staged diff parsing ─────────────────────────────────────────────────────

/**
 * Parse the output of `git diff --cached -U0 --no-color` into a list of
 * added-line records. Context and removed lines are discarded.
 */
export const parseStagedDiff = (diffText) => {
  if (typeof diffText !== "string" || diffText.length === 0) {
    return [];
  }
  const added = [];
  const lines = diffText.split("\n");
  let currentFile = "";
  let newLineNumber = 0;

  for (const rawLine of lines) {
    if (rawLine.startsWith("+++ ")) {
      const pathPart = rawLine.slice(4).trim();
      if (pathPart === "/dev/null") {
        currentFile = "";
      } else if (pathPart.startsWith("b/")) {
        currentFile = pathPart.slice(2);
      } else {
        currentFile = pathPart;
      }
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      continue;
    }
    if (rawLine.startsWith("@@")) {
      const match = rawLine.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        newLineNumber = Number.parseInt(match[1], 10);
      }
      continue;
    }
    if (rawLine.startsWith("diff --git ") || rawLine.startsWith("index ")) {
      continue;
    }
    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      if (currentFile) {
        added.push({
          file: currentFile,
          line: newLineNumber,
          content: rawLine.slice(1),
        });
      }
      newLineNumber += 1;
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      // removed line: does not advance new-file line counter
      continue;
    }
  }
  return added;
};

// ── staged file listing ─────────────────────────────────────────────────────

const listStagedFiles = ({ cwd, env, execFile }) => {
  const output = execFile(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=AM", "-z"],
    {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (typeof output !== "string" || output.length === 0) {
    return [];
  }
  return output.split("\0").filter(Boolean);
};

const getStagedDiff = ({ cwd, env, execFile }) => {
  return execFile("git", ["diff", "--cached", "--unified=0", "--no-color"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
};

const listTrackedFiles = ({ cwd, env, execFile }) => {
  const output = execFile("git", ["ls-files", "-z"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (typeof output !== "string" || output.length === 0) {
    return [];
  }
  return output.split("\0").filter(Boolean);
};

const scanTrackedContent = ({ cwd, files, readTextFile }) => {
  const findings = [];
  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    const content = readTextFile(absolutePath, "utf8");
    findings.push(...scanContent(content, { filename: file, startLine: 1 }));
  }
  return findings;
};

const isFileInProfileBoundary = (file, profile) => {
  const normalized = file.split(path.sep).join("/");
  if (!normalized.startsWith("template/")) {
    return true;
  }
  return profile.templates.some((templateId) =>
    normalized.startsWith(`template/${templateId}/`),
  );
};

const filterFilesByProfile = (files, profile) =>
  files.filter((file) => isFileInProfileBoundary(file, profile));

const parseCliArgs = (argv) => {
  const options = {
    all: false,
    profiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--all") {
      options.all = true;
      continue;
    }
    if (current === "--profile" || current === "-p") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      options.profiles.push(next);
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      options.profiles.push(current.slice("--profile=".length));
      continue;
    }
    if (!current.startsWith("-")) {
      options.profiles.push(current);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    all: options.all,
    profileIds:
      options.profiles.length > 0
        ? resolveBuildProfiles(options.profiles)
        : undefined,
  };
};

// ── main guard ──────────────────────────────────────────────────────────────

export const runGuard = ({
  cwd = resolvePackageRoot(),
  env = process.env,
  execFile = execFileSync,
  readTextFile = readFileSync,
  all = false,
  profileIds,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  if (env.WORKSPACE_DEV_SKIP_SECRET_SCAN === "true") {
    stdout("[check-secrets] Skipped via WORKSPACE_DEV_SKIP_SECRET_SCAN=true.");
    return 0;
  }

  if (all) {
    let trackedFiles;
    try {
      trackedFiles = listTrackedFiles({ cwd, env, execFile });
    } catch (error) {
      stderr(
        `[check-secrets] Unable to list tracked files: ${formatError(error)}`,
      );
      return 1;
    }

    const scanProfileIds = profileIds?.length ? profileIds : [undefined];
    let scannedTrackedCount = 0;
    let scannedContentCount = 0;

    for (const profileId of scanProfileIds) {
      const profile = profileId ? profileDefinitions[profileId] : undefined;
      const profileTrackedFiles = profile
        ? filterFilesByProfile(trackedFiles, profile)
        : trackedFiles;
      const pathViolations = [];
      const contentCandidates = [];
      for (const file of profileTrackedFiles) {
        const classification = classifyPath(file);
        if (classification) {
          pathViolations.push({ file, reason: classification.reason });
          continue;
        }
        const basename = file.includes("/")
          ? file.slice(file.lastIndexOf("/") + 1)
          : file;
        if (ENV_FILENAME_ALLOW.has(basename)) {
          continue;
        }
        contentCandidates.push(file);
      }

      let contentFindings = [];
      try {
        contentFindings = scanTrackedContent({
          cwd,
          files: contentCandidates,
          readTextFile,
        });
      } catch (error) {
        stderr(
          `[check-secrets] Unable to read tracked file content: ${formatError(error)}`,
        );
        return 1;
      }

      if (pathViolations.length > 0) {
        stderr("[check-secrets] Blocked tracked path(s):");
        for (const v of pathViolations) {
          stderr(` - ${v.file}  [${v.reason}]`);
        }
      }
      if (contentFindings.length > 0) {
        stderr("[check-secrets] Secret pattern matches in tracked files:");
        for (const f of contentFindings) {
          stderr(` - ${f.file}:${f.line}  [${f.patternId}] ${f.description}`);
          stderr(`     ${f.excerpt}`);
        }
        stderr(
          "[check-secrets] If this is a documented example, append a per-line pragma (e.g. `// pragma: allowlist secret`). Otherwise rotate the exposed credential and remove it from the repository.",
        );
      }
      if (pathViolations.length > 0 || contentFindings.length > 0) {
        return 1;
      }

      scannedTrackedCount += profileTrackedFiles.length;
      scannedContentCount += contentCandidates.length;
      if (profile) {
        stdout(
          `[check-secrets] Passed for profile '${profile.id}'. Scanned ${profileTrackedFiles.length} tracked file(s), ${contentCandidates.length} content file(s).`,
        );
      }
    }

    stdout(
      `[check-secrets] Passed. Scanned ${scannedTrackedCount} tracked file(s), ${scannedContentCount} content file(s).`,
    );
    return 0;
  }

  let stagedFiles;
  try {
    stagedFiles = listStagedFiles({ cwd, env, execFile });
  } catch (error) {
    stderr(
      `[check-secrets] Unable to list staged files: ${formatError(error)}`,
    );
    return 1;
  }

  if (stagedFiles.length === 0) {
    stdout("[check-secrets] No staged files — nothing to scan.");
    return 0;
  }

  const pathViolations = [];
  const contentCandidates = [];
  for (const file of stagedFiles) {
    const classification = classifyPath(file);
    if (classification) {
      pathViolations.push({ file, reason: classification.reason });
      continue;
    }
    const basename = file.includes("/")
      ? file.slice(file.lastIndexOf("/") + 1)
      : file;
    if (ENV_FILENAME_ALLOW.has(basename)) {
      continue;
    }
    contentCandidates.push(file);
  }

  let diffText = "";
  if (contentCandidates.length > 0) {
    try {
      diffText = getStagedDiff({ cwd, env, execFile });
    } catch (error) {
      stderr(
        `[check-secrets] Unable to read staged diff: ${formatError(error)}`,
      );
      return 1;
    }
  }

  const addedLines = parseStagedDiff(diffText);
  const scannableFiles = new Set(contentCandidates);
  const contentFindings = [];
  for (const { file, line, content } of addedLines) {
    if (!scannableFiles.has(file)) {
      continue;
    }
    if (isPragmaAllowlisted(content)) {
      continue;
    }
    for (const { id, pattern, description } of SECRET_PATTERNS) {
      if (isDocumentedPublicCredentialContext({ patternId: id, line: content })) {
        continue;
      }
      if (pattern.test(content)) {
        contentFindings.push({
          file,
          line,
          patternId: id,
          description,
          excerpt: truncateExcerpt(content),
        });
      }
    }
  }

  if (pathViolations.length === 0 && contentFindings.length === 0) {
    stdout(
      `[check-secrets] Passed. Scanned ${stagedFiles.length} staged file(s), ${addedLines.length} added line(s).`,
    );
    return 0;
  }

  if (pathViolations.length > 0) {
    stderr("[check-secrets] Blocked path(s):");
    for (const v of pathViolations) {
      stderr(` - ${v.file}  [${v.reason}]`);
    }
  }
  if (contentFindings.length > 0) {
    stderr("[check-secrets] Secret pattern matches in staged changes:");
    for (const f of contentFindings) {
      stderr(` - ${f.file}:${f.line}  [${f.patternId}] ${f.description}`);
      stderr(`     ${f.excerpt}`);
    }
    stderr(
      "[check-secrets] If this is a documented example, append a per-line pragma (e.g. `// pragma: allowlist secret`). Otherwise rotate the exposed credential and remove it from the index.",
    );
  }
  return 1;
};

const formatError = (error) =>
  error instanceof Error ? error.message : String(error);

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const exitCode = runGuard(options);
    process.exit(exitCode);
  } catch (error) {
    console.error("[check-secrets] Failed:", formatError(error));
    process.exit(1);
  }
}
