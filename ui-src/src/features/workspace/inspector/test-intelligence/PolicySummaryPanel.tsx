// ---------------------------------------------------------------------------
// Policy summary panel (Issue #1367)
//
// Shows the job-level policy report: aggregate counts, blocking diagnostics,
// and any job-level violations. The page-level summary card complements the
// per-test-case violations rendered inside the detail panel.
// ---------------------------------------------------------------------------

import type { JSX } from "react";
import type { PolicyReport, ValidationReport } from "./types";

export interface PolicySummaryPanelProps {
  policy: PolicyReport | undefined;
  validation: ValidationReport | undefined;
}

export function PolicySummaryPanel({
  policy,
  validation,
}: PolicySummaryPanelProps): JSX.Element {
  if (!policy && !validation) {
    return (
      <section
        data-testid="ti-policy-summary"
        aria-label="Policy summary"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No policy or validation report has been emitted yet.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-policy-summary"
      aria-label="Policy summary"
      className={`flex flex-col gap-3 rounded border p-4 ${
        policy?.blocked || validation?.blocked
          ? "border-rose-500/30 bg-rose-950/15"
          : "border-white/10 bg-[#171717]"
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">
          Policy &amp; validation
        </h2>
        {policy ? (
          <span className="text-[10px] text-white/45">
            profile {policy.policyProfileId} v{policy.policyProfileVersion}
          </span>
        ) : null}
      </header>

      <div className="grid gap-2 md:grid-cols-4">
        {policy ? (
          <>
            <Stat
              label="Approved"
              value={String(policy.approvedCount)}
              testId="ti-policy-approved"
              tone="good"
            />
            <Stat
              label="Needs review"
              value={String(policy.needsReviewCount)}
              testId="ti-policy-needs-review"
              tone="warn"
            />
            <Stat
              label="Blocked"
              value={String(policy.blockedCount)}
              testId="ti-policy-blocked"
              tone={policy.blockedCount > 0 ? "block" : "neutral"}
            />
          </>
        ) : null}
        {validation ? (
          <Stat
            label="Validation errors"
            value={String(validation.errorCount)}
            testId="ti-validation-errors"
            tone={validation.errorCount > 0 ? "block" : "neutral"}
          />
        ) : null}
      </div>

      {validation && validation.issues.length > 0 ? (
        <section
          data-testid="ti-validation-issue-list"
          aria-label="Validation issues"
          className="flex flex-col gap-1 rounded border border-rose-500/20 bg-rose-950/15 px-3 py-2"
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-rose-200">
            Validation issues
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {validation.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${String(index)}`}
                data-testid={`ti-validation-issue-${index}`}
                className="break-words text-[11px] text-white/85"
              >
                <span
                  className={
                    issue.severity === "error"
                      ? "font-semibold text-rose-200"
                      : "font-semibold text-amber-200"
                  }
                >
                  {issue.code}
                </span>
                {issue.testCaseId ? (
                  <span className="ml-1 font-mono text-[10px] text-white/55">
                    [{issue.testCaseId}]
                  </span>
                ) : null}
                <span className="text-white/35"> · </span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {policy && policy.jobLevelViolations.length > 0 ? (
        <section
          data-testid="ti-policy-job-violations"
          aria-label="Job-level policy violations"
          className="flex flex-col gap-1 rounded border border-amber-500/30 bg-amber-950/15 px-3 py-2"
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
            Job-level policy violations
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {policy.jobLevelViolations.map((violation, index) => (
              <li
                key={`${violation.rule}-${String(index)}`}
                data-testid={`ti-policy-job-violation-${index}`}
                className="break-words text-[11px] text-white/85"
              >
                <span className="font-semibold text-amber-200">
                  {violation.outcome}
                </span>
                <span className="text-white/35"> · </span>
                <span>{violation.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  testId: string;
  tone: "good" | "warn" | "block" | "neutral";
}

function Stat({ label, value, testId, tone }: StatProps): JSX.Element {
  const valueClass =
    tone === "good"
      ? "text-emerald-200"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "block"
          ? "text-rose-200"
          : "text-white";
  return (
    <div
      data-testid={testId}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className={`mt-1 text-base font-semibold ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}
