import { useMemo, useState, type JSX } from "react";

import type { InspectorSourceRecord } from "./types";

export interface SourceListPanelProps {
  sources: readonly InspectorSourceRecord[];
}

const shortHash = (value: string): string => value.slice(0, 12);

const formatCapturedAtAbsolute = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace(".000Z", "Z");
};

const formatCapturedAtRelative = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown age";
  const deltaMs = Date.now() - date.getTime();
  const deltaMinutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${String(deltaMinutes)}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${String(deltaHours)}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${String(deltaDays)}d ago`;
};

export function SourceListPanel({ sources }: SourceListPanelProps): JSX.Element {
  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);
  const orderedSources = useMemo(
    () =>
      [...sources].sort((left, right) =>
        right.capturedAt.localeCompare(left.capturedAt),
      ),
    [sources],
  );

  return (
    <section
      data-testid="ti-multisource-source-list"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Attached sources</h2>
        <span className="text-[10px] uppercase tracking-wide text-white/45">
          {sources.length} total
        </span>
      </header>
      {sources.length === 0 ? (
        <p className="m-0 text-[12px] text-white/55">
          No sources have been attached to this job yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {orderedSources.map((source) => (
            <li
              key={source.sourceId}
              className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2 text-[11px] text-white/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/65">
                    {source.role}
                  </span>
                  <span className="rounded border border-white/10 px-1.5 py-[1px] text-[10px] uppercase text-white/65">
                    {source.kind}
                  </span>
                  <span className="font-medium text-white">{source.label}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Copy content hash for ${source.label}`}
                  onClick={() => {
                    if (typeof navigator?.clipboard?.writeText !== "function") {
                      return;
                    }
                    void navigator.clipboard.writeText(source.contentHash).then(() => {
                      setCopiedSourceId(source.sourceId);
                    });
                  }}
                  className="cursor-pointer rounded border border-white/10 px-2 py-1 text-[10px] text-white/65 transition hover:border-sky-400/40 hover:text-sky-200"
                >
                  {copiedSourceId === source.sourceId
                    ? "Copied"
                    : shortHash(source.contentHash)}
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-white/50">
                <span>
                  captured {formatCapturedAtAbsolute(source.capturedAt)} (
                  {formatCapturedAtRelative(source.capturedAt)})
                </span>
                {source.authorHandle ? (
                  <span className="font-mono">author {source.authorHandle}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
