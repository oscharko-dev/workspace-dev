import path from "node:path";
import type {
  WorkspaceTestSpaceCase,
  WorkspaceTestSpaceCoverageFinding,
  WorkspaceTestSpaceRun,
  WorkspaceTestSpaceStep,
} from "../contracts/index.js";

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("#", "\\#")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

function escapeMarkdownCell(value: string): string {
  return escapeMarkdownText(value).replaceAll("\n", "<br />");
}

function toTableRow(values: string[]): string {
  return `| ${values.join(" | ")} |`;
}

function renderKeyValueTable(
  rows: Array<[string, string]>,
): string[] {
  return [
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) =>
      toTableRow([escapeMarkdownCell(field), escapeMarkdownCell(value)]),
    ),
  ];
}

function renderStringList(title: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`- ${title}: none`];
  }
  return [
    `- ${escapeMarkdownText(title)}:`,
    ...values.map((value) => `  - ${escapeMarkdownText(value)}`),
  ];
}

function renderStepTable(steps: WorkspaceTestSpaceStep[]): string[] {
  return [
    "",
    "| Step | Action | Expected result |",
    "| --- | --- | --- |",
    ...steps.map((step) =>
      toTableRow([
        String(step.order),
        escapeMarkdownCell(step.action),
        escapeMarkdownCell(step.expectedResult),
      ]),
    ),
  ];
}

function renderCaseDetails(testCase: WorkspaceTestSpaceCase): string[] {
  return [
    `### ${escapeMarkdownText(testCase.id)} - ${escapeMarkdownText(testCase.title)}`,
    "",
    "<details>",
    `<summary>${escapeMarkdownText(testCase.type)} / ${escapeMarkdownText(testCase.priority)}</summary>`,
    "",
    ...renderStringList("Preconditions", testCase.preconditions ?? []),
    "",
    ...renderStepTable(testCase.steps),
    "",
    `Expected result: ${escapeMarkdownText(testCase.expectedResult)}`,
    "",
    `Coverage tags: ${testCase.coverageTags.length > 0 ? testCase.coverageTags.map((tag) => escapeMarkdownText(tag)).join(", ") : "none"}`,
    "",
    "</details>",
  ];
}

function renderFindingDetails(
  finding: WorkspaceTestSpaceCoverageFinding,
): string[] {
  return [
    `### ${escapeMarkdownText(finding.id)}`,
    "",
    "<details>",
    `<summary>${escapeMarkdownText(finding.severity.toUpperCase())}</summary>`,
    "",
    `Message: ${escapeMarkdownText(finding.message)}`,
    "",
    `Recommendation: ${escapeMarkdownText(finding.recommendation)}`,
    "",
    `Related cases: ${finding.relatedCaseIds.length > 0 ? finding.relatedCaseIds.map((caseId) => escapeMarkdownText(caseId)).join(", ") : "none"}`,
    "",
    "</details>",
  ];
}

function renderCaseSummaryTable(testCases: WorkspaceTestSpaceCase[]): string[] {
  return [
    "| Case ID | Title | Priority | Type | Steps | Coverage tags |",
    "| --- | --- | --- | --- | --- | --- |",
    ...testCases.map((testCase) =>
      toTableRow([
        escapeMarkdownCell(testCase.id),
        escapeMarkdownCell(testCase.title),
        testCase.priority,
        testCase.type,
        String(testCase.steps.length),
        String(testCase.coverageTags.length),
      ]),
    ),
  ];
}

function renderFindingSummaryTable(
  findings: WorkspaceTestSpaceCoverageFinding[],
): string[] {
  return [
    "| Finding ID | Severity | Message | Related cases |",
    "| --- | --- | --- | --- |",
    ...findings.map((finding) =>
      toTableRow([
        escapeMarkdownCell(finding.id),
        finding.severity,
        escapeMarkdownCell(finding.message),
        finding.relatedCaseIds.length > 0
          ? escapeMarkdownCell(finding.relatedCaseIds.join(", "))
          : "none",
      ]),
    ),
  ];
}

function renderSummaryRows(run: WorkspaceTestSpaceRun): string[] {
  const summary = run.figmaSummary;
  const rows: Array<[string, string]> = [
    ["Run ID", run.runId],
    ["Status", run.status],
    ["Model deployment", run.modelDeployment],
    ["Created at", run.createdAt],
    ["Updated at", run.updatedAt],
    ["Figma source mode", run.request.figmaSourceMode],
    ["Business summary", run.request.businessContext.summary],
    ["Test cases", String(run.testCases.length)],
    ["Coverage findings", String(run.coverageFindings.length)],
    ["Markdown artifact", path.basename(run.markdownArtifact.path)],
  ];

  const orderedSummaryKeys = [
    "sourceMode",
    "sourceKind",
    "nodeCount",
    "frameCount",
    "textNodeCount",
    "componentCount",
    "maxDepth",
    "topLevelNames",
    "sampleText",
    "sourceLocator",
  ] as const;
  for (const key of orderedSummaryKeys) {
    if (!(key in summary)) {
      continue;
    }
    const value = summary[key];
    rows.push([`Figma summary: ${key}`, JSON.stringify(value)]);
  }

  return renderKeyValueTable(rows);
}

export function renderWorkspaceTestSpaceMarkdown(
  run: WorkspaceTestSpaceRun,
): string {
  const lines: string[] = [];
  lines.push(`# Test Space Run ${escapeMarkdownText(run.runId)}`);
  lines.push("");
  lines.push("Generated markdown for Figma-derived business test cases, coverage, and audit context.");
  lines.push("");
  lines.push("## Table of Contents");
  lines.push("- [Overview](#overview)");
  lines.push("- [Business Context](#business-context)");
  lines.push("- [Figma Summary](#figma-summary)");
  lines.push("- [Test Cases](#test-cases)");
  lines.push("- [Coverage Findings](#coverage-findings)");
  lines.push("");
  lines.push("## Overview");
  lines.push(...renderSummaryRows(run));
  lines.push("");
  lines.push("## Business Context");
  lines.push(...renderKeyValueTable([
    ["Summary", run.request.businessContext.summary],
    ["Product", run.request.businessContext.productName ?? "none"],
    ["Audience", run.request.businessContext.audience ?? "none"],
    ["Notes", run.request.businessContext.notes ?? "none"],
    ["Goals", run.request.businessContext.goals?.length ? run.request.businessContext.goals.join("; ") : "none"],
    ["Constraints", run.request.businessContext.constraints?.length ? run.request.businessContext.constraints.join("; ") : "none"],
  ]));
  lines.push("");
  lines.push("## Figma Summary");
  lines.push(...renderKeyValueTable(
    Object.entries(run.figmaSummary).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  ));
  lines.push("");
  lines.push("## Test Cases");
  lines.push(...renderCaseSummaryTable(run.testCases));
  for (const testCase of run.testCases) {
    lines.push("");
    lines.push(...renderCaseDetails(testCase));
  }
  lines.push("");
  lines.push("## Coverage Findings");
  if (run.coverageFindings.length === 0) {
    lines.push("No coverage findings were produced.");
  } else {
    lines.push(...renderFindingSummaryTable(run.coverageFindings));
    for (const finding of run.coverageFindings) {
      lines.push("");
      lines.push(...renderFindingDetails(finding));
    }
  }

  return `${lines.join("\n")}\n`;
}
