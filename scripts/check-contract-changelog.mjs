#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const CHANGELOG_FILE = "CONTRACT_CHANGELOG.md";
export const RELEVANT_CONTRACT_FILES = Object.freeze([
  "src/contracts/index.ts",
  "src/index.ts",
  "src/contract-version.test.ts",
]);
export const RELEVANT_CONTRACT_FILE_PREFIXES = Object.freeze([
  "src/test-intelligence/",
]);

export const ISSUE_REFERENCE_REGEX = /(?:Issue\s+#|#)(\d+)/giu;

export const parseArgs = (argv) => {
  const parsed = {
    base: undefined,
    head: undefined,
    mergeBase: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--base") {
      parsed.base = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--head") {
      parsed.head = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--merge-base") {
      parsed.mergeBase = true;
      continue;
    }
    throw new Error(
      `Unknown argument "${token}". Supported flags: --base <ref>, --head <ref>, --merge-base.`,
    );
  }
  return parsed;
};

export const diffRangeArgs = ({ base, head, mergeBase = false }) => {
  if (typeof base === "string" && base.length > 0) {
    if (mergeBase) {
      const resolvedHead =
        typeof head === "string" && head.length > 0 ? head : "HEAD";
      return [`${base}...${resolvedHead}`];
    }
    if (typeof head === "string" && head.length > 0) {
      return [base, head];
    }
    return [base, "HEAD"];
  }
  return ["HEAD^", "HEAD"];
};

export const extractIssueNumbers = (source) => {
  const values = new Set();
  for (const match of source.matchAll(ISSUE_REFERENCE_REGEX)) {
    values.add(Number.parseInt(match[1], 10));
  }
  return Array.from(values).sort((left, right) => left - right);
};

export const isRelevantContractFile = (filePath) =>
  RELEVANT_CONTRACT_FILES.includes(filePath) ||
  RELEVANT_CONTRACT_FILE_PREFIXES.some((prefix) => filePath.startsWith(prefix));

export const evaluateContractChangelogGuard = ({
  changedFiles,
  commitIssueNumbers,
  changelogIssueNumbers,
}) => {
  const normalizedChangedFiles = Array.from(
    new Set(
      changedFiles
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const relevantFilesChanged = normalizedChangedFiles.filter(
    isRelevantContractFile,
  );
  const changelogChanged = normalizedChangedFiles.includes(CHANGELOG_FILE);

  if (relevantFilesChanged.length === 0) {
    return {
      ok: true,
      reason: "No public contract/export snapshot files changed.",
      relevantFilesChanged,
      changelogChanged,
      commitIssueNumbers,
      changelogIssueNumbers,
      matchingIssueNumbers: [],
    };
  }

  if (!changelogChanged) {
    return {
      ok: false,
      reason:
        "Public contract/export snapshot files changed without updating CONTRACT_CHANGELOG.md.",
      relevantFilesChanged,
      changelogChanged,
      commitIssueNumbers,
      changelogIssueNumbers,
      matchingIssueNumbers: [],
    };
  }

  if (commitIssueNumbers.length === 0) {
    return {
      ok: false,
      reason:
        "Public contract/export snapshot files changed, but no issue number was found in the commit subjects for this diff range.",
      relevantFilesChanged,
      changelogChanged,
      commitIssueNumbers,
      changelogIssueNumbers,
      matchingIssueNumbers: [],
    };
  }

  const changelogIssueSet = new Set(changelogIssueNumbers);
  const matchingIssueNumbers = commitIssueNumbers.filter((issueNumber) =>
    changelogIssueSet.has(issueNumber),
  );

  if (matchingIssueNumbers.length === 0) {
    return {
      ok: false,
      reason:
        "Public contract/export snapshot files changed, but the added CONTRACT_CHANGELOG.md issue references do not match any issue number from the commit subjects in this diff range.",
      relevantFilesChanged,
      changelogChanged,
      commitIssueNumbers,
      changelogIssueNumbers,
      matchingIssueNumbers,
    };
  }

  return {
    ok: true,
    reason:
      "Public contract/export snapshot change is paired with a matching CONTRACT_CHANGELOG.md issue reference.",
    relevantFilesChanged,
    changelogChanged,
    commitIssueNumbers,
    changelogIssueNumbers,
    matchingIssueNumbers,
  };
};

export const formatResult = (result) =>
  [
    result.reason,
    `relevant files changed: ${
      result.relevantFilesChanged.length === 0
        ? "(none)"
        : result.relevantFilesChanged.join(", ")
    }`,
    `CONTRACT_CHANGELOG.md changed: ${result.changelogChanged}`,
    `commit issue numbers: ${
      result.commitIssueNumbers.length === 0
        ? "(none)"
        : result.commitIssueNumbers.join(", ")
    }`,
    `changelog issue numbers: ${
      result.changelogIssueNumbers.length === 0
        ? "(none)"
        : result.changelogIssueNumbers.join(", ")
    }`,
    `matching issue numbers: ${
      result.matchingIssueNumbers.length === 0
        ? "(none)"
        : result.matchingIssueNumbers.join(", ")
    }`,
  ].join("\n");

export const listChangedFilesFromGit = async ({
  base,
  head,
  mergeBase = false,
} = {}) => {
  const args = [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    ...diffRangeArgs({ base, head, mergeBase }),
  ];
  const { stdout } = await execFile("git", args, {
    encoding: "utf8",
  });
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

export const listCommitIssueNumbersFromGit = async ({
  base,
  head,
  mergeBase = false,
} = {}) => {
  const args = [
    "log",
    "--format=%s",
    ...diffRangeArgs({ base, head, mergeBase }),
  ];
  const { stdout } = await execFile("git", args, {
    encoding: "utf8",
  });
  return extractIssueNumbers(stdout);
};

export const listAddedChangelogIssueNumbersFromGit = async ({
  base,
  head,
  mergeBase = false,
} = {}) => {
  const args = [
    "diff",
    "--unified=0",
    ...diffRangeArgs({ base, head, mergeBase }),
    "--",
    CHANGELOG_FILE,
  ];
  const { stdout } = await execFile("git", args, {
    encoding: "utf8",
  });
  const addedLines = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
  return extractIssueNumbers(addedLines);
};

const isCliEntry = () =>
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry()) {
  const options = parseArgs(process.argv.slice(2));
  const [changedFiles, commitIssueNumbers, changelogIssueNumbers] =
    await Promise.all([
      listChangedFilesFromGit(options),
      listCommitIssueNumbersFromGit(options),
      listAddedChangelogIssueNumbersFromGit(options),
    ]);
  const result = evaluateContractChangelogGuard({
    changedFiles,
    commitIssueNumbers,
    changelogIssueNumbers,
  });
  const formatted = formatResult(result);
  if (!result.ok) {
    console.error(formatted);
    process.exit(1);
  }
  console.log(formatted);
}
