import type { JSX } from "react";

import type { InspectorSourceRecord } from "./types";

export interface ProvenanceOverlayProps {
  label: string;
  sourceIds: readonly string[];
  sourceRefs: readonly InspectorSourceRecord[];
  testId: string;
}

export function ProvenanceOverlay({
  label,
  sourceIds,
  sourceRefs,
  testId,
}: ProvenanceOverlayProps): JSX.Element | null {
  if (sourceIds.length === 0) return null;
  const resolved = sourceIds
    .map((sourceId) => sourceRefs.find((ref) => ref.sourceId === sourceId))
    .filter((value): value is InspectorSourceRecord => value !== undefined);
  return (
    <div
      data-testid={testId}
      tabIndex={0}
      className="rounded border border-sky-500/20 bg-sky-950/15 px-3 py-2 text-[11px] text-sky-100 outline-none focus:border-sky-400/60"
    >
      <div className="font-semibold text-sky-200">{label}</div>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-1 p-0">
        {resolved.map((source) => (
          <li
            key={source.sourceId}
            className="rounded border border-sky-400/25 bg-black/20 px-1.5 py-[1px]"
          >
            {source.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
