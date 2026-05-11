import type { JSX } from "react";
import type {
  AdversarialGapFinding,
  JudgePanelVerdict,
} from "./types";

export interface AgentFindingsPanelProps {
  judgePanelVerdicts: readonly JudgePanelVerdict[] | undefined;
  adversarialGapFindings: readonly AdversarialGapFinding[] | undefined;
}

export function AgentFindingsPanel({
  judgePanelVerdicts = [],
  adversarialGapFindings = [],
}: AgentFindingsPanelProps): JSX.Element {
  if (judgePanelVerdicts.length === 0 && adversarialGapFindings.length === 0) {
    return (
      <section
        data-testid="ti-agent-findings-panel"
        aria-label="Agent findings"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No judge or gap-finder findings were emitted for this job.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-agent-findings-panel"
      aria-label="Agent findings"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Agent findings</h2>
        <span className="text-[10px] text-white/45">
          {judgePanelVerdicts.length + adversarialGapFindings.length} findings
        </span>
      </header>

      {judgePanelVerdicts.length > 0 ? (
        <FindingGroup title="Judge panel">
          {judgePanelVerdicts.map((verdict) => (
            <li
              key={`${verdict.testCaseId}-${verdict.criterion}`}
              className="rounded border border-white/5 bg-[#121212] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-white/85">
                  {verdict.testCaseId}
                </span>
                <SeverityBadge value={verdict.resolvedSeverity} />
                <span className="text-[10px] uppercase text-white/55">
                  {verdict.escalationRoute.replaceAll("_", " ")}
                </span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-white/65">
                Criterion: {verdict.criterion}
              </p>
            </li>
          ))}
        </FindingGroup>
      ) : null}

      {adversarialGapFindings.length > 0 ? (
        <FindingGroup title="Gap finder">
          {adversarialGapFindings.map((finding) => (
            <li
              key={finding.findingId}
              className="rounded border border-white/5 bg-[#121212] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-white/85">
                  {finding.findingId}
                </span>
                <SeverityBadge value={finding.severity} />
                <span className="text-[10px] uppercase text-white/55">
                  {finding.missingCaseType}
                </span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-white/65">
                {finding.summary}
              </p>
            </li>
          ))}
        </FindingGroup>
      ) : null}
    </section>
  );
}

function FindingGroup({
  title,
  children,
}: {
  title: string;
  children: JSX.Element[];
}): JSX.Element {
  return (
    <section className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-3">
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
        {title}
      </h3>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">{children}</ul>
    </section>
  );
}

function SeverityBadge({ value }: { value: string }): JSX.Element {
  const className =
    value === "critical"
      ? "border-rose-500/30 bg-rose-950/20 text-rose-200"
      : value === "major" || value === "downgraded_disagreement"
        ? "border-amber-500/30 bg-amber-950/20 text-amber-200"
        : "border-white/10 bg-[#1a1a1a] text-white/65";
  return (
    <span
      className={`rounded border px-1.5 py-[1px] text-[10px] uppercase ${className}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
