import { useId, useState, type JSX } from "react";

import type { InspectorSourceRecord } from "./types";

export interface ProvenanceOverlayProps {
  label: string;
  sourceIds: readonly string[];
  sourceRefs: readonly InspectorSourceRecord[];
  testId: string;
}

const shortHash = (value: string): string => value.slice(0, 12);

const formatCapturedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace(".000Z", "Z");
};

export function ProvenanceOverlay({
  label,
  sourceIds,
  sourceRefs,
  testId,
}: ProvenanceOverlayProps): JSX.Element | null {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const tooltipId = useId();
  const open = isHovered || isFocused;
  if (sourceIds.length === 0) return null;
  const resolved = sourceIds
    .map((sourceId) => sourceRefs.find((ref) => ref.sourceId === sourceId))
    .filter((value): value is InspectorSourceRecord => value !== undefined);
  const sourceCountLabel =
    sourceIds.length === 1 ? "1 source" : `${sourceIds.length} sources`;
  const summary = buildSourceSummary(resolved, sourceIds.length);

  return (
    <div
      data-testid={testId}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      className="relative min-w-0"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-label={`${label}. ${sourceCountLabel}. ${summary}`}
        onFocus={() => {
          setIsFocused(true);
        }}
        onBlur={() => {
          setIsFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsHovered(false);
            setIsFocused(false);
          }
        }}
        className="flex w-full items-center justify-between gap-3 rounded border border-sky-500/20 bg-sky-950/15 px-3 py-2 text-left text-[11px] text-sky-100 outline-none transition hover:border-sky-400/40 focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/30"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-sky-200">{label}</span>
          <span className="rounded-full border border-sky-400/20 bg-black/15 px-1.5 py-[1px] text-[10px] uppercase tracking-wide text-sky-100/80">
            {sourceCountLabel}
          </span>
        </span>
        <span className="truncate text-sky-100/60">{summary}</span>
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        data-testid={`${testId}-panel`}
        className={`absolute left-0 top-full z-20 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded border border-sky-500/25 bg-[#08101d] px-3 py-2 text-[11px] text-sky-100 shadow-xl shadow-black/40 transition duration-150 ${
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sky-200">{label}</div>
          <div className="text-[10px] uppercase tracking-wide text-sky-100/55">
            Hover or focus to inspect
          </div>
        </div>
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {resolved.map((source) => (
            <li
              key={source.sourceId}
              className="rounded border border-sky-400/20 bg-black/15 px-2 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{source.label}</span>
                <span className="rounded border border-sky-400/20 px-1.5 py-[1px] text-[10px] uppercase text-sky-100/80">
                  {source.role}
                </span>
                <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/70">
                  {source.kind}
                </span>
              </div>
              <dl className="m-0 mt-2 grid gap-1 text-[10px] text-sky-50/75 sm:grid-cols-2">
                <ProvenanceTerm label="sourceId" value={source.sourceId} />
                <ProvenanceTerm
                  label="capturedAt"
                  value={formatCapturedAt(source.capturedAt)}
                />
                <ProvenanceTerm
                  label="contentHash"
                  value={shortHash(source.contentHash)}
                />
                <ProvenanceTerm
                  label="author"
                  value={source.authorHandle ?? "unassigned"}
                />
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface ProvenanceTermProps {
  label: string;
  value: string;
}

function ProvenanceTerm({ label, value }: ProvenanceTermProps): JSX.Element {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0 text-sky-100/45">{label}</dt>
      <dd className="m-0 min-w-0 break-words font-mono text-sky-50/85">
        {value}
      </dd>
    </div>
  );
}

function buildSourceSummary(
  resolved: readonly InspectorSourceRecord[],
  totalSourceIds: number,
): string {
  if (resolved.length === 0) {
    return totalSourceIds > 0 ? "Source details unavailable" : "No sources";
  }

  const preview = resolved.slice(0, 2).map((source) => source.label);
  const resolvedOverflow = resolved.length - preview.length;
  const unresolvedOverflow = totalSourceIds - resolved.length;
  const suffixParts: string[] = [];

  if (resolvedOverflow > 0) {
    suffixParts.push(`+${resolvedOverflow} more`);
  }
  if (unresolvedOverflow > 0) {
    suffixParts.push(`+${unresolvedOverflow} unresolved`);
  }

  return suffixParts.length > 0
    ? `${preview.join(" · ")} ${suffixParts.join(" ")}`
    : preview.join(" · ");
}
