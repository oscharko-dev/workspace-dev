import { type JSX } from "react";
import { type JobConfidence, type ConfidenceLevel } from "../data/types";

const LEVEL_COLORS: Record<ConfidenceLevel, string> = {
  high: "#22c55e",
  medium: "#eab308",
  low: "#f97316",
  very_low: "#ef4444",
};

const LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: "High Confidence",
  medium: "Medium Confidence",
  low: "Low Confidence",
  very_low: "Very Low Confidence",
};

interface ConfidenceSummaryProps {
  confidence: JobConfidence | undefined;
}

export function ConfidenceSummary({
  confidence,
}: ConfidenceSummaryProps): JSX.Element | null {
  if (!confidence || confidence.status !== "completed" || !confidence.level) {
    return null;
  }

  const color = LEVEL_COLORS[confidence.level];
  const label = LEVEL_LABELS[confidence.level];

  return (
    <section
      data-testid="confidence-summary"
      className="rounded-md border bg-[#171717] p-3"
      style={{ borderColor: color }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <strong className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
          {label}
        </strong>
        {confidence.score !== undefined && (
          <span className="ml-auto font-mono text-xs tabular-nums text-white/55">
            {confidence.score.toFixed(1)}%
          </span>
        )}
      </div>
      {confidence.lowConfidenceSummary &&
        confidence.lowConfidenceSummary.length > 0 && (
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-[11px] text-white/55">
            {confidence.lowConfidenceSummary.map((item, i) => (
              <li key={`${String(i)}-${item}`}>{item}</li>
            ))}
          </ul>
        )}
      {confidence.contributors && confidence.contributors.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-white/45">
            Signal breakdown ({confidence.contributors.length} contributors)
          </summary>
          <table className="mt-1 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/45">
                <th className="px-2 py-1 font-medium">Signal</th>
                <th className="px-2 py-1 font-medium">Impact</th>
                <th className="px-2 py-1 font-medium">Weight</th>
                <th className="px-2 py-1 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {confidence.contributors.map((c, i) => (
                <tr
                  key={`${String(i)}-${c.signal}`}
                  className="border-b border-white/5"
                >
                  <td className="px-2 py-1 text-white/80">{c.signal}</td>
                  <td
                    className={`px-2 py-1 ${
                      c.impact === "negative"
                        ? "text-rose-400"
                        : c.impact === "positive"
                          ? "text-[#4eba87]"
                          : "text-white/45"
                    }`}
                  >
                    {c.impact}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums text-white/55">
                    {c.weight.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums text-white/55">
                    {c.value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
