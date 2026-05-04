import type { JSX } from "react";
import type { CoveragePlan } from "./types";

export interface CoveragePlanPanelProps {
  coveragePlan: CoveragePlan | undefined;
}

export function CoveragePlanPanel({
  coveragePlan,
}: CoveragePlanPanelProps): JSX.Element {
  if (!coveragePlan) {
    return (
      <section
        data-testid="ti-coverage-plan-panel"
        aria-label="Coverage plan"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No deterministic coverage plan artifact is available for this job.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-coverage-plan-panel"
      aria-label="Coverage plan"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Coverage plan</h2>
        <span className="text-[10px] text-white/45">
          mutation target {(coveragePlan.mutationKillRateTarget * 100).toFixed(0)}%
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        <PlanStat
          label="Minimum cases"
          value={String(coveragePlan.minimumCases.length)}
          testId="ti-coverage-plan-minimum"
        />
        <PlanStat
          label="Recommended cases"
          value={String(coveragePlan.recommendedCases.length)}
          testId="ti-coverage-plan-recommended"
        />
        <PlanStat
          label="Techniques"
          value={String(coveragePlan.techniques.length)}
          testId="ti-coverage-plan-techniques"
        />
      </div>

      <PlanRequirementList
        label="Minimum case requirements"
        requirements={coveragePlan.minimumCases}
        testId="ti-coverage-plan-minimum-list"
      />
      <PlanRequirementList
        label="Recommended follow-up"
        requirements={coveragePlan.recommendedCases}
        testId="ti-coverage-plan-recommended-list"
      />
    </section>
  );
}

function PlanStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): JSX.Element {
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

function PlanRequirementList({
  label,
  requirements,
  testId,
}: {
  label: string;
  requirements: CoveragePlan["minimumCases"];
  testId: string;
}): JSX.Element {
  if (requirements.length === 0) {
    return (
      <section
        data-testid={testId}
        aria-label={label}
        className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-2 text-[11px] text-white/55"
      >
        {label}: none.
      </section>
    );
  }

  return (
    <section
      data-testid={testId}
      aria-label={label}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
        {label}
      </h3>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {requirements.map((requirement) => (
          <li
            key={requirement.requirementId}
            className="rounded border border-white/5 bg-[#121212] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-white/85">
                {requirement.requirementId}
              </span>
              <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/55">
                {requirement.technique.replaceAll("_", " ")}
              </span>
              <span className="text-[10px] text-white/45">
                {requirement.reasonCode.replaceAll("_", " ")}
              </span>
            </div>
            <p className="m-0 mt-1 text-[11px] text-white/65">
              Targets:{" "}
              <span className="font-mono text-white/80">
                {requirement.targetIds.join(", ")}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
