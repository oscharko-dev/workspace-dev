/**
 * Jira sub-task markdown artifact writer (Issue #1482 — Wave 5).
 *
 * Emits SEPARATE markdown files per test case under the supplied output
 * directory:
 *
 *   manifest.md                    — run header + counts.
 *   summary.md                     — concise pass/partial/fail outcome.
 *   errors.md                      — run failure list; empty when none; redacted.
 *   jira-request-<safeId>.md       — per case: payload that was/would-be sent.
 *   jira-response-<safeId>.md      — per case: outcome + Jira issue key.
 *   testcase-<safeId>.md           — per case: title, steps, expected.
 *
 * `safeId` = first 16 chars of SHA-256(testCaseId).
 *
 * Hard invariants:
 *   - Bearer tokens, Jira credentials, raw screenshots, and base64 image
 *     bytes are NEVER written.
 *   - Failure detail strings are routed through `redactHighRiskSecrets`
 *     and a URL stripper before persistence.
 *   - All writes are atomic via `${pid}.${randomUUID()}.tmp` rename.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  GeneratedTestCase,
  JiraSubTaskRecord,
  JiraWriteRefusalCode,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

const URL_DETAIL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi;

/** Stable wall-clock source so tests can produce byte-identical artifacts. */
export interface JiraWriteMarkdownClock {
  now(): string;
}

export interface JiraWriteMarkdownInput {
  jobId: string;
  parentIssueKey: string;
  subtaskOutcomes: JiraSubTaskRecord[];
  dryRun: boolean;
  outputDir: string;
  /** Sorted by id; aligns one-to-one with `subtaskOutcomes` by `testCaseId`. */
  testCases: GeneratedTestCase[];
  /** Sorted run-level gate refusals when the Jira write never attempted cases. */
  refusalCodes?: JiraWriteRefusalCode[];
  clock?: JiraWriteMarkdownClock;
}

export interface JiraWriteMarkdownResult {
  manifestPath: string;
  summaryPath: string;
  errorsPath: string;
  /** testCaseId -> path */
  requestPaths: Record<string, string>;
  /** testCaseId -> path */
  responsePaths: Record<string, string>;
  /** testCaseId -> path */
  testcasePaths: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/**
 * Filename-safe digest for a given test case id. First 16 hex chars of
 * SHA-256(testCaseId). 16 chars = 64 bits of entropy — collision-safe
 * for any realistic test-case set per job.
 */
export const buildJiraWriteMarkdownSafeId = (testCaseId: string): string =>
  sha256Hex(testCaseId).slice(0, 16);

const writeAtomicText = async (path: string, value: string): Promise<void> => {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, value, "utf8");
  await rename(tmp, path);
};

const MANAGED_MARKDOWN_ARTIFACT_PATTERN =
  /^(?:manifest|summary|errors|jira-subtasks|subtasks|all-subtasks)\.md$|^(?:jira-request|jira-response|testcase)-[a-f0-9]{16}\.md$/u;

const removeManagedMarkdownArtifacts = async (
  outputDir: string,
): Promise<void> => {
  const entries = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() && MANAGED_MARKDOWN_ARTIFACT_PATTERN.test(entry.name),
      )
      .map((entry) => rm(join(outputDir, entry.name), { force: true })),
  );
};

const sanitizeMarkdown = (raw: string): string =>
  redactHighRiskSecrets(raw, "[redacted-secret]").replace(
    URL_DETAIL_PATTERN,
    "[redacted-url]",
  );

const formatList = (items: string[]): string =>
  items.length === 0
    ? "_(none)_"
    : items
        .map((item, idx) => `${idx + 1}. ${sanitizeMarkdown(item)}`)
        .join("\n");

const summarizeOutcome = (
  records: JiraSubTaskRecord[],
): { kind: "pass" | "partial" | "fail" | "dry_run"; line: string } => {
  const total = records.length;
  if (total === 0) {
    return { kind: "fail", line: "No test cases were processed." };
  }
  const created = records.filter((r) => r.outcome === "created").length;
  const skipped = records.filter(
    (r) => r.outcome === "skipped_duplicate",
  ).length;
  const failed = records.filter((r) => r.outcome === "failed").length;
  const dryRun = records.filter((r) => r.outcome === "dry_run").length;
  if (dryRun === total) {
    return {
      kind: "dry_run",
      line: `Dry-run completed for ${total} case(s); no Jira sub-tasks were created.`,
    };
  }
  if (failed === 0) {
    return {
      kind: "pass",
      line: `Pass: created=${created}, skipped_duplicate=${skipped}, total=${total}.`,
    };
  }
  if (failed < total) {
    return {
      kind: "partial",
      line: `Partial: created=${created}, skipped_duplicate=${skipped}, failed=${failed}, total=${total}. Re-run after addressing failures; idempotency will skip already-created sub-tasks.`,
    };
  }
  return {
    kind: "fail",
    line: `Fail: failed=${failed}, total=${total}. Inspect errors.md for detail.`,
  };
};

/* ------------------------------------------------------------------ */
/*  Section builders                                                     */
/* ------------------------------------------------------------------ */

const buildManifest = (input: JiraWriteMarkdownInput, generatedAt: string) => {
  const records = input.subtaskOutcomes;
  const refusalCodes = input.refusalCodes ?? [];
  const total = records.length;
  const created = records.filter((r) => r.outcome === "created").length;
  const skipped = records.filter(
    (r) => r.outcome === "skipped_duplicate",
  ).length;
  const failed = records.filter((r) => r.outcome === "failed").length;
  const dryRun = records.filter((r) => r.outcome === "dry_run").length;
  const lines = [
    "# Jira Sub-Task Write Manifest",
    "",
    `- Job ID: \`${input.jobId}\``,
    `- Parent Issue Key: \`${input.parentIssueKey}\``,
    `- Generated At: ${generatedAt}`,
    `- Dry Run: ${input.dryRun ? "true" : "false"}`,
    `- Total Cases: ${total}`,
    `- Created: ${created}`,
    `- Skipped Duplicate: ${skipped}`,
    `- Failed: ${failed}`,
    `- Dry-Run Outcomes: ${dryRun}`,
    ...(refusalCodes.length > 0
      ? [`- Refusal Codes: ${refusalCodes.map((c) => `\`${c}\``).join(", ")}`]
      : []),
    "",
    "Per-test-case markdown artifacts live alongside this manifest as",
    "`testcase-<safeId>.md`, `jira-request-<safeId>.md`, and",
    "`jira-response-<safeId>.md`.",
    "",
  ];
  return lines.join("\n");
};

const buildSummary = (input: JiraWriteMarkdownInput, generatedAt: string) => {
  const refusalCodes = input.refusalCodes ?? [];
  const summary =
    refusalCodes.length > 0
      ? {
          kind: "fail" as const,
          line: `Refused before Jira write execution: ${refusalCodes.join(", ")}.`,
        }
      : summarizeOutcome(input.subtaskOutcomes);
  const lines = [
    "# Jira Sub-Task Write Summary",
    "",
    `- Job ID: \`${input.jobId}\``,
    `- Parent Issue Key: \`${input.parentIssueKey}\``,
    `- Generated At: ${generatedAt}`,
    `- Outcome: ${summary.kind}`,
    "",
    summary.line,
    "",
  ];
  if (summary.kind === "partial" || summary.kind === "fail") {
    lines.push(
      "Re-run guidance: the pipeline is idempotent — re-invoking with the",
      "same `(jobId, parentIssueKey)` will skip already-created sub-tasks.",
      "Address the failures recorded in `errors.md` and re-run.",
      "",
    );
  }
  return lines.join("\n");
};

const buildErrors = (input: JiraWriteMarkdownInput, generatedAt: string) => {
  const failed = input.subtaskOutcomes.filter((r) => r.outcome === "failed");
  const refusalCodes = input.refusalCodes ?? [];
  const lines = [
    "# Jira Sub-Task Write Errors",
    "",
    `- Job ID: \`${input.jobId}\``,
    `- Generated At: ${generatedAt}`,
    ...(refusalCodes.length > 0
      ? [`- Refusal Codes: ${refusalCodes.map((c) => `\`${c}\``).join(", ")}`]
      : []),
    `- Failed Cases: ${failed.length}`,
    "",
  ];
  if (failed.length === 0) {
    lines.push(
      refusalCodes.length > 0
        ? "No per-test-case errors were recorded because the run was refused before Jira write execution."
        : "No per-test-case errors were recorded for this run.",
      "",
    );
    return lines.join("\n");
  }
  for (const record of failed) {
    lines.push(`## Test Case \`${record.testCaseId}\``);
    lines.push("");
    lines.push(`- External ID: \`${record.externalId}\``);
    lines.push(`- Failure Class: \`${record.failureClass ?? "unknown"}\``);
    if (record.retryable !== undefined) {
      lines.push(`- Retryable: ${record.retryable ? "true" : "false"}`);
    }
    if (record.failureDetail !== undefined) {
      lines.push(`- Failure Detail: ${sanitizeMarkdown(record.failureDetail)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
};

const buildRequest = (
  testCase: GeneratedTestCase,
  record: JiraSubTaskRecord,
  parentIssueKey: string,
  dryRun: boolean,
) => {
  const stepLines = testCase.steps.map(
    (step, idx) =>
      `${idx + 1}. ${sanitizeMarkdown(step.action)}${
        step.expected ? ` => ${sanitizeMarkdown(step.expected)}` : ""
      }`,
  );
  const lines = [
    `# Jira Sub-Task Request: \`${testCase.id}\``,
    "",
    `- Parent Issue Key: \`${parentIssueKey}\``,
    `- External ID: \`${record.externalId}\``,
    `- Issue Type: Sub-task`,
    `- Dry Run: ${dryRun ? "true" : "false"}`,
    "",
    `## Summary`,
    "",
    `[${testCase.id}] ${sanitizeMarkdown(testCase.title)}`,
    "",
    `## Description`,
    "",
    `Objective: ${sanitizeMarkdown(testCase.objective)}`,
    "",
    `### Preconditions`,
    "",
    formatList(testCase.preconditions),
    "",
    `### Steps`,
    "",
    stepLines.length === 0 ? "_(none)_" : stepLines.join("\n"),
    "",
    `### Expected Results`,
    "",
    formatList(testCase.expectedResults),
    "",
    `## Labels`,
    "",
    `- ti-external-id:${record.externalId}`,
    `- ti-job:${testCase.sourceJobId}`,
    "",
  ];
  return lines.join("\n");
};

const buildResponse = (record: JiraSubTaskRecord) => {
  const lines = [
    `# Jira Sub-Task Response: \`${record.testCaseId}\``,
    "",
    `- External ID: \`${record.externalId}\``,
    `- Outcome: \`${record.outcome}\``,
  ];
  if (record.jiraIssueKey !== undefined) {
    lines.push(`- Jira Issue Key: \`${record.jiraIssueKey}\``);
  }
  if (record.failureClass !== undefined) {
    lines.push(`- Failure Class: \`${record.failureClass}\``);
  }
  if (record.retryable !== undefined) {
    lines.push(`- Retryable: ${record.retryable ? "true" : "false"}`);
  }
  if (record.failureDetail !== undefined) {
    lines.push(`- Failure Detail: ${sanitizeMarkdown(record.failureDetail)}`);
  }
  lines.push("");
  return lines.join("\n");
};

const buildTestCaseMarkdown = (testCase: GeneratedTestCase) => {
  const stepLines = testCase.steps.map(
    (step, idx) =>
      `${idx + 1}. ${sanitizeMarkdown(step.action)}${
        step.expected ? ` => ${sanitizeMarkdown(step.expected)}` : ""
      }`,
  );
  const lines = [
    `# Test Case: \`${testCase.id}\``,
    "",
    `- Title: ${sanitizeMarkdown(testCase.title)}`,
    `- Objective: ${sanitizeMarkdown(testCase.objective)}`,
    `- Level: \`${testCase.level}\``,
    `- Type: \`${testCase.type}\``,
    `- Priority: \`${testCase.priority}\``,
    `- Risk Category: \`${testCase.riskCategory}\``,
    `- Technique: \`${testCase.technique}\``,
    "",
    `## Preconditions`,
    "",
    formatList(testCase.preconditions),
    "",
    `## Test Data`,
    "",
    formatList(testCase.testData),
    "",
    `## Steps`,
    "",
    stepLines.length === 0 ? "_(none)_" : stepLines.join("\n"),
    "",
    `## Expected Results`,
    "",
    formatList(testCase.expectedResults),
    "",
  ];
  return lines.join("\n");
};

/* ------------------------------------------------------------------ */
/*  Public writer                                                        */
/* ------------------------------------------------------------------ */

/**
 * Write the per-test-case markdown artifact set for a Jira sub-task
 * write run. All writes are atomic via temp-rename. Returns the set of
 * resolved paths so the orchestrator can echo them in its result.
 */
export const writeJiraSubtaskMarkdownArtifacts = async (
  input: JiraWriteMarkdownInput,
): Promise<JiraWriteMarkdownResult> => {
  const generatedAt = (
    input.clock ?? { now: () => new Date().toISOString() }
  ).now();
  await mkdir(input.outputDir, { recursive: true });
  await removeManagedMarkdownArtifacts(input.outputDir);

  const manifestPath = join(input.outputDir, "manifest.md");
  const summaryPath = join(input.outputDir, "summary.md");
  const errorsPath = join(input.outputDir, "errors.md");

  const testCaseById = new Map(
    input.testCases.map((tc) => [tc.id, tc] as const),
  );

  const requestPaths: Record<string, string> = {};
  const responsePaths: Record<string, string> = {};
  const testcasePaths: Record<string, string> = {};

  await writeAtomicText(manifestPath, buildManifest(input, generatedAt));
  await writeAtomicText(summaryPath, buildSummary(input, generatedAt));

  await writeAtomicText(errorsPath, buildErrors(input, generatedAt));

  for (const record of input.subtaskOutcomes) {
    const testCase = testCaseById.get(record.testCaseId);
    if (testCase === undefined) continue;
    const safeId = buildJiraWriteMarkdownSafeId(record.testCaseId);
    const requestPath = join(input.outputDir, `jira-request-${safeId}.md`);
    const responsePath = join(input.outputDir, `jira-response-${safeId}.md`);
    const testcasePath = join(input.outputDir, `testcase-${safeId}.md`);
    await writeAtomicText(
      requestPath,
      buildRequest(testCase, record, input.parentIssueKey, input.dryRun),
    );
    await writeAtomicText(responsePath, buildResponse(record));
    await writeAtomicText(testcasePath, buildTestCaseMarkdown(testCase));
    requestPaths[record.testCaseId] = requestPath;
    responsePaths[record.testCaseId] = responsePath;
    testcasePaths[record.testCaseId] = testcasePath;
  }

  return {
    manifestPath,
    summaryPath,
    errorsPath,
    requestPaths,
    responsePaths,
    testcasePaths,
  };
};
