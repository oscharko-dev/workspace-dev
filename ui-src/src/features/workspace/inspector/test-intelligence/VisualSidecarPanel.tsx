// ---------------------------------------------------------------------------
// Visual sidecar panel (Issue #1367 multimodal update)
//
// Shows the visual sidecar role, deployment, fallback status, confidence
// summary, and ambiguity markers for the job. The Inspector renders one row
// per screen so reviewers can map an outcome (low confidence, possible PII,
// fallback only, etc.) back to the screen that triggered it.
// ---------------------------------------------------------------------------

import type { JSX } from "react";
import {
  formatConfidence,
  formatVisualSidecarOutcomeBadge,
} from "./formatters";
import type { VisualSidecarReport } from "./types";

export interface VisualSidecarPanelProps {
  report: VisualSidecarReport | undefined;
}

const HIGH_RISK_OUTCOMES = new Set<string>([
  "schema_invalid",
  "primary_unavailable",
  "prompt_injection_like_text",
]);

const REVIEW_OUTCOMES = new Set<string>([
  "low_confidence",
  "possible_pii",
  "conflicts_with_figma_metadata",
]);

export function VisualSidecarPanel({
  report,
}: VisualSidecarPanelProps): JSX.Element {
  if (!report) {
    return (
      <section
        data-testid="ti-visual-sidecar-panel"
        aria-label="Visual sidecar workflow"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No visual sidecar report — no multimodal observations were emitted for
        this job.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-visual-sidecar-panel"
      aria-label="Visual sidecar workflow"
      className={`flex flex-col gap-3 rounded border px-4 py-4 ${
        report.blocked
          ? "border-rose-500/30 bg-rose-950/15"
          : "border-white/10 bg-[#171717]"
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">
          Visual sidecar workflow
        </h2>
        <span
          data-testid="ti-visual-sidecar-status"
          className={`rounded border px-1.5 py-[1px] text-[10px] font-semibold ${
            report.blocked
              ? "border-rose-500/30 bg-rose-950/40 text-rose-200"
              : "border-emerald-500/30 bg-emerald-950/40 text-emerald-200"
          }`}
        >
          {report.blocked ? "Sidecar blocked" : "Sidecar OK"}
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        <SidecarStat
          label="Total screens"
          value={String(report.totalScreens)}
          testId="ti-visual-sidecar-total"
        />
        <SidecarStat
          label="Screens with findings"
          value={String(report.screensWithFindings)}
          testId="ti-visual-sidecar-findings"
        />
        <SidecarStat
          label="Mean confidence"
          value={formatConfidence(meanConfidence(report))}
          testId="ti-visual-sidecar-confidence"
        />
      </div>

      {report.records.length === 0 ? (
        <p
          data-testid="ti-visual-sidecar-empty-rows"
          className="m-0 text-[11px] text-white/55"
        >
          The visual sidecar processed no screens for this job.
        </p>
      ) : (
        <ul
          data-testid="ti-visual-sidecar-rows"
          aria-label="Per-screen visual sidecar outcomes"
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {report.records.map((record) => {
            const blockedRow = record.outcomes.some((outcome) =>
              HIGH_RISK_OUTCOMES.has(outcome),
            );
            const reviewRow = record.outcomes.some((outcome) =>
              REVIEW_OUTCOMES.has(outcome),
            );
            return (
              <li
                key={record.screenId}
                data-testid={`ti-visual-sidecar-row-${record.screenId}`}
                data-row-blocked={blockedRow ? "true" : "false"}
                className={`flex flex-col gap-1 rounded border px-3 py-2 ${
                  blockedRow
                    ? "border-rose-500/30 bg-rose-950/15"
                    : reviewRow
                      ? "border-amber-500/30 bg-amber-950/15"
                      : "border-white/10 bg-[#0f0f0f]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="break-words font-mono text-[12px] text-white">
                    {record.screenId}
                  </span>
                  <span className="text-[10px] text-white/55">
                    deployment{" "}
                    <span className="font-mono text-white/85">
                      {record.deployment}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {record.outcomes.map((outcome) => {
                    const badge = formatVisualSidecarOutcomeBadge(outcome);
                    return (
                      <span
                        key={`${record.screenId}-${outcome}`}
                        data-testid={`ti-visual-sidecar-outcome-${record.screenId}-${outcome}`}
                        className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    );
                  })}
                </div>
                <span className="text-[10px] text-white/55">
                  Mean confidence{" "}
                  <span className="font-mono text-white/85">
                    {formatConfidence(record.meanConfidence)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function meanConfidence(report: VisualSidecarReport): number {
  if (report.records.length === 0) return Number.NaN;
  const sum = report.records.reduce(
    (acc, record) => acc + record.meanConfidence,
    0,
  );
  return sum / report.records.length;
}

interface SidecarStatProps {
  label: string;
  value: string;
  testId: string;
}

function SidecarStat({ label, value, testId }: SidecarStatProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-white">{value}</div>
    </div>
  );
}
