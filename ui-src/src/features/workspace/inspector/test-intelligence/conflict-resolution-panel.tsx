import { useMemo, useState, type JSX } from "react";

import type {
  InspectorConflictDecisionSnapshot,
  MultiSourceConflict,
  InspectorSourceRecord,
} from "./types";

export interface ConflictResolutionPanelProps {
  conflicts: readonly MultiSourceConflict[];
  sourceRefs: readonly InspectorSourceRecord[];
  decisions: Record<string, InspectorConflictDecisionSnapshot> | undefined;
  onResolve: (input: {
    conflictId: string;
    action: "approve" | "reject";
    selectedSourceId?: string;
    selectedNormalizedValue?: string;
  }) => Promise<void>;
}

export function ConflictResolutionPanel({
  conflicts,
  sourceRefs,
  decisions,
  onResolve,
}: ConflictResolutionPanelProps): JSX.Element {
  const [pendingConflictId, setPendingConflictId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const availableKinds = useMemo(
    () => [...new Set(conflicts.map((conflict) => conflict.kind))].sort(),
    [conflicts],
  );
  const filteredConflicts = useMemo(
    () =>
      kindFilter === "all"
        ? conflicts
        : conflicts.filter((conflict) => conflict.kind === kindFilter),
    [conflicts, kindFilter],
  );
  return (
    <section
      data-testid="ti-multisource-conflicts"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Conflict resolution</h2>
        <div className="flex items-center gap-2">
          {availableKinds.length > 1 ? (
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/45">
              Filter
              <select
                aria-label="Filter conflicts by kind"
                value={kindFilter}
                onChange={(event) => {
                  setKindFilter(event.target.value);
                }}
                className="rounded border border-white/10 bg-[#0f0f0f] px-2 py-1 text-[10px] text-white/80"
              >
                <option value="all">All</option>
                {availableKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="text-[10px] uppercase tracking-wide text-white/45">
            {filteredConflicts.length} shown
          </span>
        </div>
      </header>
      {conflicts.length === 0 ? (
        <p className="m-0 text-[12px] text-white/55">
          No multi-source conflicts were emitted for this job.
        </p>
      ) : filteredConflicts.length === 0 ? (
        <p className="m-0 text-[12px] text-white/55">
          No conflicts match the current filter.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {filteredConflicts.map((conflict) => {
            const decision = decisions?.[conflict.conflictId];
            return (
              <li
                key={conflict.conflictId}
                className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-3 text-[11px] text-white/85"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-white/45">
                    {conflict.conflictId.slice(0, 10)}
                  </span>
                  <span className="rounded border border-amber-500/25 px-1.5 py-[1px] text-[10px] uppercase text-amber-200">
                    {conflict.kind}
                  </span>
                  {decision ? (
                    <span className="rounded border border-emerald-500/25 px-1.5 py-[1px] text-[10px] uppercase text-emerald-200">
                      {decision.state}
                    </span>
                  ) : null}
                </div>
                {conflict.detail ? (
                  <p className="m-0 mt-1 text-white/70">{conflict.detail}</p>
                ) : null}
                <p className="m-0 mt-2 text-white/55">
                  Sources:{" "}
                  {conflict.participatingSourceIds
                    .map(
                      (sourceId) =>
                        sourceRefs.find((ref) => ref.sourceId === sourceId)?.label ??
                        sourceId,
                    )
                    .join(", ")}
                </p>
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-1 p-0">
                  {conflict.normalizedValues.map((value) => (
                    <li
                      key={value}
                      className="rounded border border-white/10 px-2 py-[1px] font-mono text-[10px] text-white/70"
                    >
                      {value}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {conflict.participatingSourceIds.map((sourceId) => (
                    <button
                      key={sourceId}
                      type="button"
                      aria-label={`Approve ${sourceId} for ${conflict.conflictId}`}
                      disabled={pendingConflictId === conflict.conflictId}
                      onClick={() => {
                        setPendingConflictId(conflict.conflictId);
                        void onResolve({
                          conflictId: conflict.conflictId,
                          action: "approve",
                          selectedSourceId: sourceId,
                        }).finally(() => {
                          setPendingConflictId(null);
                        });
                      }}
                      className="cursor-pointer rounded border border-emerald-500/30 bg-emerald-950/20 px-2 py-1 text-[10px] text-emerald-200"
                    >
                      Prefer{" "}
                      {sourceRefs.find((ref) => ref.sourceId === sourceId)?.label ??
                        sourceId}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={`Reject ${conflict.conflictId}`}
                    disabled={pendingConflictId === conflict.conflictId}
                    onClick={() => {
                      setPendingConflictId(conflict.conflictId);
                      void onResolve({
                        conflictId: conflict.conflictId,
                        action: "reject",
                      }).finally(() => {
                        setPendingConflictId(null);
                      });
                    }}
                    className="cursor-pointer rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-200"
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
