import { useCallback, useEffect, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import {
  getIntentClassificationMetricsSnapshot,
  INTENT_CLASSIFICATION_MAX_MISCLASSIFICATION_RATE,
  resetIntentClassificationMetrics,
  type ConfidenceBucket,
  type IntentClassificationMetricsSnapshot,
} from "./inspector/intent-classification-metrics";
import type { ImportIntent } from "./inspector/paste-input-classifier";

const ALL_INTENTS: readonly ImportIntent[] = [
  "FIGMA_JSON_NODE_BATCH",
  "FIGMA_JSON_DOC",
  "FIGMA_PLUGIN_ENVELOPE",
  "RAW_CODE_OR_TEXT",
  "UNKNOWN",
];

const ALL_BUCKETS: readonly ConfidenceBucket[] = [
  "very_high",
  "high",
  "medium",
  "low",
];

function BackIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
    >
      <path
        fillRule="evenodd"
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatIntentLabel(intent: ImportIntent): string {
  switch (intent) {
    case "FIGMA_JSON_NODE_BATCH":
      return "Figma-Node JSON";
    case "FIGMA_JSON_DOC":
      return "Figma-Dokument JSON";
    case "FIGMA_PLUGIN_ENVELOPE":
      return "Plugin Envelope";
    case "RAW_CODE_OR_TEXT":
      return "Code / Text";
    case "UNKNOWN":
      return "Unknown";
  }
}

function formatBucketLabel(bucket: ConfidenceBucket): string {
  switch (bucket) {
    case "very_high":
      return "Very high";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
  }
}

function SummaryCard({
  label,
  value,
  accent = "text-white",
  testId,
}: {
  label: string;
  value: string;
  accent?: string;
  testId: string;
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      className="rounded-md border border-white/10 bg-[#171717] p-4"
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </section>
  );
}

export function InspectorIntentMetricsPage(): JSX.Element {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<IntentClassificationMetricsSnapshot>(
    () => getIntentClassificationMetricsSnapshot(),
  );

  const refreshSnapshot = useCallback(() => {
    setSnapshot(getIntentClassificationMetricsSnapshot());
  }, []);

  useEffect(() => {
    const handleStorage = (): void => {
      refreshSnapshot();
    };
    const handleFocus = (): void => {
      refreshSnapshot();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshSnapshot]);

  const hasData = snapshot.totalClassifications > 0;
  const thresholdPassed =
    snapshot.misclassificationRate <=
    INTENT_CLASSIFICATION_MAX_MISCLASSIFICATION_RATE;
  const thresholdStateLabel = hasData
    ? thresholdPassed
      ? "Pass"
      : "Fail"
    : "No data";

  return (
    <div
      data-testid="intent-metrics-page"
      className="flex min-h-screen flex-col bg-[#101010] text-white"
    >
      <header className="shrink-0 border-b border-[#000000] bg-[#171717]">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigate("/workspace/ui/inspector");
              }}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-white/60 transition hover:border-white/10 hover:bg-[#000000] hover:text-[#4eba87]"
            >
              <BackIcon />
              Back
            </button>
            <div className="h-4 w-px bg-[#333333]" />
            <div className="flex items-baseline gap-2">
              <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                Intent Metrics
              </h1>
              <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                inspector diagnostics
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="intent-metrics-refresh"
              onClick={refreshSnapshot}
              className="cursor-pointer rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[11px] font-medium text-white/60 transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
            >
              Refresh
            </button>
            <button
              type="button"
              data-testid="intent-metrics-reset"
              onClick={() => {
                resetIntentClassificationMetrics();
                refreshSnapshot();
              }}
              className="cursor-pointer rounded border border-rose-400/25 bg-rose-950/20 px-2 py-1 text-[11px] font-medium text-rose-200 transition hover:border-rose-300/40 hover:text-rose-100"
            >
              Reset counters
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
        <section className="rounded-md border border-[#4eba87]/20 bg-[#121814] p-4 text-sm text-white/75">
          Tracks local, air-gap-safe intent classifications and SmartBanner
          corrections. CI enforces a representative inspector E2E
          misclassification ceiling of{" "}
          {formatPercent(INTENT_CLASSIFICATION_MAX_MISCLASSIFICATION_RATE)}.
        </section>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Classifications"
            value={String(snapshot.totalClassifications)}
            testId="intent-metrics-total-classifications"
          />
          <SummaryCard
            label="Corrections"
            value={String(snapshot.totalCorrections)}
            testId="intent-metrics-total-corrections"
          />
          <SummaryCard
            label="Misclassification rate"
            value={formatPercent(snapshot.misclassificationRate)}
            accent={thresholdPassed ? "text-[#4eba87]" : "text-rose-300"}
            testId="intent-metrics-misclassification-rate"
          />
          <SummaryCard
            label="Threshold status"
            value={thresholdStateLabel}
            accent={
              thresholdStateLabel === "Pass"
                ? "text-[#4eba87]"
                : thresholdStateLabel === "Fail"
                  ? "text-rose-300"
                  : "text-white/65"
            }
            testId="intent-metrics-threshold-status"
          />
        </div>

        <section className="rounded-md border border-white/10 bg-[#171717] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-sm font-semibold text-white">
                Intent x confidence buckets
              </h2>
              <p className="m-0 mt-1 text-[11px] text-white/55">
                Confidence buckets: very_high &ge; 0.9, high &ge; 0.8, medium
                &ge; 0.7, low &lt; 0.7.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/45">
                  <th className="px-3 py-2 font-medium">Intent</th>
                  {ALL_BUCKETS.map((bucket) => (
                    <th key={bucket} className="px-3 py-2 font-medium">
                      {formatBucketLabel(bucket)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_INTENTS.map((intent) => (
                  <tr key={intent} className="border-b border-white/5">
                    <th className="px-3 py-2 font-medium text-white/80">
                      {formatIntentLabel(intent)}
                    </th>
                    {ALL_BUCKETS.map((bucket) => (
                      <td
                        key={`${intent}-${bucket}`}
                        className="px-3 py-2 font-mono text-white/70"
                      >
                        {snapshot.classifications[intent][bucket]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-white/10 bg-[#171717] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-sm font-semibold text-white">
                Recent events
              </h2>
              <p className="m-0 mt-1 text-[11px] text-white/55">
                Most recent {snapshot.recentEvents.length} of 200 locally stored
                events.
              </p>
            </div>
            <span className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[10px] text-white/60">
              storage v{snapshot.storageVersion}
            </span>
          </div>
          {snapshot.recentEvents.length === 0 ? (
            <div
              data-testid="intent-metrics-empty-events"
              className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-3 py-6 text-center text-[11px] text-white/45"
            >
              No recorded classifications yet.
            </div>
          ) : (
            <ol
              data-testid="intent-metrics-events"
              className="m-0 flex list-none flex-col gap-2 p-0"
            >
              {[...snapshot.recentEvents].reverse().map((event, index) => (
                <li
                  key={`${event.type}-${event.timestamp}-${String(index)}`}
                  className="rounded border border-white/5 bg-[#0a0a0a] px-3 py-2 text-[11px] text-white/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-white/85">
                      {event.type === "classification"
                        ? `${formatIntentLabel(event.intent)} · ${formatBucketLabel(event.confidenceBucket)}`
                        : `${formatIntentLabel(event.from)} → ${formatIntentLabel(event.to)}`}
                    </span>
                    <span className="font-mono text-white/45">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
