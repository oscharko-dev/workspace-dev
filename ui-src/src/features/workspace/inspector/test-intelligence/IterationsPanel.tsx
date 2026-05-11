import type { JSX } from "react";
import type { AgentIterationsArtifact } from "./types";

export interface IterationsPanelProps {
  agentIterations: AgentIterationsArtifact | undefined;
}

export function IterationsPanel({
  agentIterations,
}: IterationsPanelProps): JSX.Element {
  if (!agentIterations || agentIterations.iterations.length === 0) {
    return (
      <section
        data-testid="ti-iterations-panel"
        aria-label="Repair iterations"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No repair iteration log is available for this job.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-iterations-panel"
      aria-label="Repair iterations"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Iterations</h2>
        <span className="text-[10px] text-white/45">
          {agentIterations.iterations.length} recorded
        </span>
      </header>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {agentIterations.iterations.map((iteration) => (
          <li
            key={`${iteration.roleStepId}-${iteration.iteration}`}
            className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-white/85">
                iter {iteration.iteration}
              </span>
              <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/55">
                {iteration.roleStepId}
              </span>
              <span className="text-[10px] uppercase text-white/45">
                {iteration.outcome.replaceAll("_", " ")}
              </span>
            </div>
            <p className="m-0 mt-1 text-[11px] text-white/65">
              Findings: {iteration.findingsCount} · parent{" "}
              <span className="font-mono text-white/80">
                {iteration.parentHash.slice(0, 12)}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
