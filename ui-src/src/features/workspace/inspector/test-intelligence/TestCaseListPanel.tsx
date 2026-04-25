// ---------------------------------------------------------------------------
// Test case list panel (Issue #1367)
//
// Renders one row per generated test case. Each row shows status, priority,
// risk category, type, quality (confidence) score, and policy state. Clicking
// a row selects the case so the surrounding page can show its detail view.
// Long content (titles, objectives) wraps cleanly so it never overlaps the
// status badges on the right.
// ---------------------------------------------------------------------------

import type { JSX } from "react";
import {
  formatConfidence,
  formatPolicyDecisionBadge,
  formatPriorityBadge,
  formatReviewStateBadge,
  formatRiskCategoryLabel,
  formatTestTypeLabel,
  qualityScoreClass,
  resolveEffectiveReviewState,
} from "./formatters";
import type { GeneratedTestCase, PolicyDecision, ReviewState } from "./types";

export interface TestCaseListEntry {
  testCase: GeneratedTestCase;
  reviewState?: ReviewState;
  policyDecision?: PolicyDecision;
  policyBlocked: boolean;
  approverCount: number;
}

export interface TestCaseListPanelProps {
  entries: readonly TestCaseListEntry[];
  selectedTestCaseId: string | null;
  onSelect: (testCaseId: string) => void;
}

export function TestCaseListPanel({
  entries,
  selectedTestCaseId,
  onSelect,
}: TestCaseListPanelProps): JSX.Element {
  if (entries.length === 0) {
    return (
      <div
        data-testid="ti-test-case-list-empty"
        role="status"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-8 text-center text-[12px] text-white/50"
      >
        No generated test cases were found for this job.
      </div>
    );
  }

  return (
    <ul
      data-testid="ti-test-case-list"
      aria-label="Generated test cases"
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {entries.map((entry) => {
        const isSelected = selectedTestCaseId === entry.testCase.id;
        const reviewBadge = formatReviewStateBadge(
          resolveEffectiveReviewState(
            entry.reviewState,
            entry.testCase.reviewState,
          ),
        );
        const policyBadge = entry.policyDecision
          ? formatPolicyDecisionBadge(entry.policyDecision)
          : null;
        const priorityBadge = formatPriorityBadge(entry.testCase.priority);
        const confidenceLabel = formatConfidence(
          entry.testCase.qualitySignals.confidence,
        );
        const confidenceClass = qualityScoreClass(
          entry.testCase.qualitySignals.confidence,
        );

        return (
          <li key={entry.testCase.id} className="m-0 p-0">
            <button
              type="button"
              aria-pressed={isSelected}
              data-testid={`ti-test-case-row-${entry.testCase.id}`}
              data-test-case-id={entry.testCase.id}
              data-policy-blocked={entry.policyBlocked ? "true" : "false"}
              data-selected={isSelected ? "true" : "false"}
              onClick={() => {
                onSelect(entry.testCase.id);
              }}
              className={`flex w-full cursor-pointer flex-col gap-2 rounded border bg-[#171717] px-4 py-3 text-left transition ${
                isSelected
                  ? "border-[#4eba87]/50 ring-1 ring-[#4eba87]/30"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] uppercase tracking-wide text-white/45"
                      data-testid={`ti-test-case-id-${entry.testCase.id}`}
                    >
                      {entry.testCase.id}
                    </span>
                    <span
                      className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${priorityBadge.className}`}
                      data-testid={`ti-test-case-priority-${entry.testCase.id}`}
                    >
                      {priorityBadge.label}
                    </span>
                    <span className="text-[10px] text-white/50">
                      {formatTestTypeLabel(entry.testCase.type)}
                    </span>
                    <span className="text-[10px] text-white/35">·</span>
                    <span className="text-[10px] text-white/50">
                      {formatRiskCategoryLabel(entry.testCase.riskCategory)}
                    </span>
                  </div>
                  <div
                    className="break-words text-[13px] font-semibold text-white"
                    data-testid={`ti-test-case-title-${entry.testCase.id}`}
                  >
                    {entry.testCase.title}
                  </div>
                  <div className="break-words text-[11px] leading-relaxed text-white/60">
                    {entry.testCase.objective}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${reviewBadge.className}`}
                    data-testid={`ti-test-case-review-state-${entry.testCase.id}`}
                  >
                    {reviewBadge.label}
                  </span>
                  {policyBadge ? (
                    <span
                      className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${policyBadge.className}`}
                      data-testid={`ti-test-case-policy-${entry.testCase.id}`}
                    >
                      {policyBadge.label}
                    </span>
                  ) : null}
                  <span
                    className={`text-[10px] font-mono ${confidenceClass}`}
                    data-testid={`ti-test-case-confidence-${entry.testCase.id}`}
                  >
                    score {confidenceLabel}
                  </span>
                  {entry.approverCount > 0 ? (
                    <span
                      className="text-[10px] text-white/45"
                      data-testid={`ti-test-case-approvers-${entry.testCase.id}`}
                    >
                      {entry.approverCount} approver
                      {entry.approverCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
