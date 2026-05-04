import type { JSX } from "react";
import type { CatchUpBrief, CatchUpBriefEventGroup } from "./types";

export interface CatchUpBriefPanelProps {
  briefs: readonly CatchUpBrief[] | undefined;
}

const KIND_LABEL: Readonly<Record<CatchUpBriefEventGroup["kind"], string>> = {
  judge_panel: "Judge panel",
  gap_finder: "Gap finder",
  ir_mutation: "IR mutation",
  repair: "Repair",
  policy: "Policy",
  evidence: "Evidence",
};

const formatMinutes = (sinceMs: number): string => {
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) return "0 min";
  const minutes = Math.max(0, Math.round(sinceMs / 60_000));
  return `${minutes} min`;
};

export function CatchUpBriefPanel({
  briefs,
}: CatchUpBriefPanelProps): JSX.Element {
  if (!briefs || briefs.length === 0) {
    return (
      <section
        data-testid="ti-catch-up-brief-panel"
        aria-label="Catch-up briefs"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No catch-up briefs have been generated for this job yet.
      </section>
    );
  }

  // Most-recent brief first.
  const ordered = [...briefs].sort((a, b) =>
    b.generatedAt.localeCompare(a.generatedAt),
  );

  return (
    <section
      data-testid="ti-catch-up-brief-panel"
      aria-label="Catch-up briefs"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Catch-Up Brief</h2>
        <span className="text-[10px] text-white/45">
          {ordered.length} brief{ordered.length === 1 ? "" : "s"} on file
        </span>
      </header>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {ordered.map((brief) => (
          <li
            key={brief.contentHash}
            data-testid={`ti-catch-up-brief-${brief.contentHash.slice(0, 12)}`}
            className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-white/85">
                {brief.generatedAt}
              </span>
              <span
                data-testid={`ti-catch-up-brief-mode-${brief.contentHash.slice(0, 12)}`}
                className={`rounded border px-1.5 py-[1px] text-[10px] uppercase tracking-wide ${
                  brief.generatorMode === "deterministic"
                    ? "border-[#4eba87]/40 bg-emerald-950/20 text-[#4eba87]"
                    : "border-sky-500/30 bg-sky-950/15 text-sky-200"
                }`}
              >
                {brief.generatorMode === "deterministic"
                  ? "deterministic"
                  : "no-tools LLM"}
              </span>
              <span className="text-[10px] uppercase text-white/45">
                idle {formatMinutes(brief.sinceMs)}
              </span>
            </div>
            <p
              data-testid={`ti-catch-up-brief-summary-${brief.contentHash.slice(0, 12)}`}
              className="m-0 mt-2 text-[12px] text-white/85"
            >
              {brief.summary}
            </p>
            {brief.eventsCovered.length > 0 ? (
              <ul className="m-0 mt-2 flex flex-wrap gap-1.5 p-0 text-[10px] text-white/55">
                {brief.eventsCovered.map((group) => (
                  <li
                    key={`${brief.contentHash}-${group.kind}`}
                    data-testid={`ti-catch-up-brief-group-${brief.contentHash.slice(0, 12)}-${group.kind}`}
                    className="rounded border border-white/10 px-1.5 py-[1px]"
                  >
                    {KIND_LABEL[group.kind]}: {group.count}
                    {group.significant.length > 0 ? (
                      <span className="ml-1 font-mono text-white/45">
                        ({group.significant.slice(0, 3).join(", ")}
                        {group.significant.length > 3 ? "…" : ""})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="m-0 mt-2 break-all font-mono text-[10px] text-white/35">
              hash {brief.contentHash.slice(0, 16)}…
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
