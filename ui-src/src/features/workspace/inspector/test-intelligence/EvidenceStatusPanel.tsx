import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEvidenceVerifyStatus } from "./api";

export interface EvidenceStatusPanelProps {
  jobId: string;
}

export function EvidenceStatusPanel({
  jobId,
}: EvidenceStatusPanelProps): JSX.Element {
  const query = useQuery({
    queryKey: ["test-intelligence", "evidence-status", jobId],
    queryFn: () => fetchEvidenceVerifyStatus(jobId),
  });

  if (query.isPending) {
    return (
      <section
        data-testid="ti-evidence-status-panel"
        aria-label="Evidence status"
        className="rounded border border-white/10 bg-[#171717] px-4 py-6 text-center text-[12px] text-white/45"
      >
        Verifying evidence artifacts…
      </section>
    );
  }

  if (!query.data?.ok) {
    return (
      <section
        data-testid="ti-evidence-status-panel"
        aria-label="Evidence status"
        className="rounded border border-amber-500/30 bg-amber-950/20 px-4 py-6 text-center text-[12px] text-amber-200"
      >
        {query.data?.message ?? "Evidence verification could not be loaded."}
      </section>
    );
  }

  const evidence = query.data.value;
  return (
    <section
      data-testid="ti-evidence-status-panel"
      aria-label="Evidence status"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Evidence status</h2>
        <span
          className={`rounded border px-1.5 py-[1px] text-[10px] uppercase ${
            evidence.ok
              ? "border-[#4eba87]/40 bg-emerald-950/20 text-[#4eba87]"
              : "border-rose-500/30 bg-rose-950/20 text-rose-200"
          }`}
        >
          {evidence.ok ? "verified" : "failed"}
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        <EvidenceStat
          label="Checks"
          value={String(evidence.checks.length)}
          testId="ti-evidence-checks"
        />
        <EvidenceStat
          label="Failures"
          value={String(evidence.failures.length)}
          testId="ti-evidence-failures"
        />
        <EvidenceStat
          label="Attestation"
          value={
            evidence.attestation?.present === true
              ? evidence.attestation.signingMode
              : "missing"
          }
          testId="ti-evidence-attestation"
        />
      </div>

      <p className="m-0 break-words text-[11px] text-white/60">
        Manifest <span className="font-mono text-white/80">{evidence.manifestSha256.slice(0, 16)}</span>
      </p>

      {evidence.failures.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {evidence.failures.map((failure) => (
            <li
              key={`${failure.code}-${failure.reference}`}
              className="rounded border border-rose-500/20 bg-rose-950/10 px-3 py-2 text-[11px] text-rose-100"
            >
              <span className="font-mono">{failure.code}</span>
              <span className="text-rose-200/70"> · </span>
              <span>{failure.reference}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function EvidenceStat({
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
