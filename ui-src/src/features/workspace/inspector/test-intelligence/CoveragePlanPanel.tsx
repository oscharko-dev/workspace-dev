import type { JSX } from "react";
import type {
  CoveragePlan,
  CoveragePlanPerElement,
  CoveragePlanPerScreen,
  CoverageRequirement,
} from "./types";

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
      {renderCoveragePlan(coveragePlan)}
    </section>
  );
}

function renderCoveragePlan(coveragePlan: CoveragePlan): JSX.Element {
  const hasStructuredCoverage =
    coveragePlan.perScreen !== undefined || coveragePlan.perElement !== undefined;
  const screenQuotas = coveragePlan.perScreen ?? [];
  const elementTargets = coveragePlan.perElement ?? [];
  const minimumCases = coveragePlan.minimumCases ?? [];
  const recommendedCases = coveragePlan.recommendedCases ?? [];

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Coverage plan</h2>
        <span className="text-[10px] text-white/45">
          mutation target {(coveragePlan.mutationKillRateTarget * 100).toFixed(0)}%
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        {hasStructuredCoverage ? (
          <>
            <PlanStat
              label="Screen quotas"
              value={String(screenQuotas.length)}
              testId="ti-coverage-plan-screen-quotas"
            />
            <PlanStat
              label="Element targets"
              value={String(elementTargets.length)}
              testId="ti-coverage-plan-element-targets"
            />
            <PlanStat
              label="Techniques"
              value={String(coveragePlan.techniques.length)}
              testId="ti-coverage-plan-techniques"
            />
          </>
        ) : (
          <>
            <PlanStat
              label="Minimum cases"
              value={String(minimumCases.length)}
              testId="ti-coverage-plan-minimum"
            />
            <PlanStat
              label="Recommended cases"
              value={String(recommendedCases.length)}
              testId="ti-coverage-plan-recommended"
            />
            <PlanStat
              label="Techniques"
              value={String(coveragePlan.techniques.length)}
              testId="ti-coverage-plan-techniques"
            />
          </>
        )}
      </div>

      {hasStructuredCoverage ? (
        <>
          <PlanScreenQuotaList
            screenQuotas={screenQuotas}
            testId="ti-coverage-plan-screen-list"
          />
          <PlanElementTargetList
            elementTargets={elementTargets}
            testId="ti-coverage-plan-element-list"
          />
        </>
      ) : (
        <>
          <PlanRequirementList
            label="Minimum case requirements"
            requirements={minimumCases}
            testId="ti-coverage-plan-minimum-list"
          />
          <PlanRequirementList
            label="Recommended follow-up"
            requirements={recommendedCases}
            testId="ti-coverage-plan-recommended-list"
          />
        </>
      )}
    </>
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
  requirements: readonly CoverageRequirement[];
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

function PlanScreenQuotaList({
  screenQuotas,
  testId,
}: {
  screenQuotas: readonly CoveragePlanPerScreen[];
  testId: string;
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      aria-label="Per-screen technique quotas"
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
        Per-screen technique quotas
      </h3>
      {screenQuotas.length === 0 ? (
        <p className="m-0 mt-2 text-[11px] text-white/55">
          Per-screen technique quotas: none.
        </p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {screenQuotas.map((screenQuota) => (
            <li
              key={screenQuota.screenId}
              className="rounded border border-white/5 bg-[#121212] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-white/85">
                  {screenQuota.screenId}
                </span>
                <span className="text-[10px] text-white/45">
                  {screenQuota.techniqueQuotas.length} quota
                  {screenQuota.techniqueQuotas.length === 1 ? "" : "s"}
                </span>
              </div>
              {screenQuota.techniqueQuotas.length === 0 ? (
                <p className="m-0 mt-1 text-[11px] text-white/55">
                  No technique quotas.
                </p>
              ) : (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                  {screenQuota.techniqueQuotas.map((quota) => (
                    <li
                      key={`${screenQuota.screenId}:${quota.technique}`}
                      className="rounded border border-white/10 px-2 py-1 text-[10px] text-white/75"
                    >
                      <span className="font-medium">
                        {formatToken(quota.technique)}
                      </span>
                      <span className="text-white/45"> x{quota.minCount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanElementTargetList({
  elementTargets,
  testId,
}: {
  elementTargets: readonly CoveragePlanPerElement[];
  testId: string;
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      aria-label="Per-element coverage targets"
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
        Per-element coverage targets
      </h3>
      {elementTargets.length === 0 ? (
        <p className="m-0 mt-2 text-[11px] text-white/55">
          Per-element coverage targets: none.
        </p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {elementTargets.map((elementTarget) => (
            <li
              key={`${elementTarget.screenId}:${elementTarget.elementId}`}
              className="rounded border border-white/5 bg-[#121212] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-white/85">
                  {elementTarget.elementId}
                </span>
                <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/55">
                  {elementTarget.mustHaveCase ? "required" : "optional"}
                </span>
                <span className="text-[10px] text-white/45">
                  screen {elementTarget.screenId}
                </span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-white/65">
                Risk class:{" "}
                <span className="font-mono text-white/80">
                  {formatToken(elementTarget.riskClass)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatToken(value: string): string {
  return value.replaceAll("_", " ");
}
