#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const CUSTOMER_EVAL_DIR =
  "fixtures/test-intelligence/customer-evals/";
export const RUBRIC_FILES = Object.freeze([
  "fixtures/test-intelligence/customer-evals/Eingabemasken-Testfallrubrik.md",
  "fixtures/test-intelligence/customer-evals/Testfall-eines-Anwendungstests.md",
]);

export const SAMPLE_PLAN_FILE =
  "fixtures/test-intelligence/customer-evals/SAMPLE-PLAN.md";
export const NON_UPDATE_NOTE_FILE =
  "fixtures/test-intelligence/customer-evals/SAMPLE-PLAN-NON-UPDATE.md";

export const isCustomerEvalRubricFile = (filePath) =>
  filePath.startsWith(CUSTOMER_EVAL_DIR) &&
  filePath !== SAMPLE_PLAN_FILE &&
  filePath !== NON_UPDATE_NOTE_FILE;

export const evaluateCustomerEvalSamplePlanUpdate = (changedFiles) => {
  const normalized = new Set(
    changedFiles
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  const rubricFilesChanged = Array.from(normalized).filter((filePath) =>
    isCustomerEvalRubricFile(filePath),
  );
  const samplePlanChanged = normalized.has(SAMPLE_PLAN_FILE);
  const nonUpdateNoteChanged = normalized.has(NON_UPDATE_NOTE_FILE);

  if (rubricFilesChanged.length === 0) {
    return {
      ok: true,
      reason: "No customer-eval rubric files changed.",
      rubricFilesChanged,
      samplePlanChanged,
      nonUpdateNoteChanged,
    };
  }

  if (samplePlanChanged || nonUpdateNoteChanged) {
    return {
      ok: true,
      reason:
        samplePlanChanged && nonUpdateNoteChanged
          ? "Customer-eval rubric changed together with the sample plan and explicit non-update note."
          : samplePlanChanged
            ? "Customer-eval rubric changed together with SAMPLE-PLAN.md."
            : "Customer-eval rubric changed together with SAMPLE-PLAN-NON-UPDATE.md.",
      rubricFilesChanged,
      samplePlanChanged,
      nonUpdateNoteChanged,
    };
  }

  return {
    ok: false,
    reason:
      "Customer-eval rubric changed under fixtures/test-intelligence/customer-evals/ without updating SAMPLE-PLAN.md or SAMPLE-PLAN-NON-UPDATE.md.",
      rubricFilesChanged,
      samplePlanChanged,
      nonUpdateNoteChanged,
  };
};

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

export const formatResult = (result) => {
  const details = [
    `rubric files changed: ${
      result.rubricFilesChanged.length === 0
        ? "(none)"
        : result.rubricFilesChanged.join(", ")
    }`,
    `sample plan changed: ${result.samplePlanChanged}`,
    `non-update note changed: ${result.nonUpdateNoteChanged}`,
  ];
  return `${result.reason}\n${details.join("\n")}`;
};

const isCliEntry = () =>
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry()) {
  const options = parseArgs(process.argv.slice(2));
  const changedFiles = await listChangedFilesFromGit(options);
  const result = evaluateCustomerEvalSamplePlanUpdate(changedFiles);
  if (!result.ok) {
    console.error(formatResult(result));
    process.exit(1);
  }
  console.log(formatResult(result));
}
