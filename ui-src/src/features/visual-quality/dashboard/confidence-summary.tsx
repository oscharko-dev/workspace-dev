import { type JSX } from "react";
import { type ConfidenceLevel, type JobConfidence } from "../data/types";

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
    <div
      style={{
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: color,
          }}
        />
        <strong>{label}</strong>
        {confidence.score !== undefined && (
          <span
            style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}
          >
            {confidence.score.toFixed(1)}%
          </span>
        )}
      </div>

      {confidence.lowConfidenceSummary &&
        confidence.lowConfidenceSummary.length > 0 && (
          <ul
            style={{
              margin: "8px 0 0 0",
              paddingLeft: 20,
              fontSize: 13,
              color: "#666",
            }}
          >
            {confidence.lowConfidenceSummary.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}

      {confidence.contributors && confidence.contributors.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: "#888" }}>
            Signal breakdown ({confidence.contributors.length} contributors)
          </summary>
          <table
            style={{
              width: "100%",
              fontSize: 12,
              marginTop: 4,
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "4px 8px" }}>Signal</th>
                <th style={{ padding: "4px 8px" }}>Impact</th>
                <th style={{ padding: "4px 8px" }}>Weight</th>
                <th style={{ padding: "4px 8px" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {confidence.contributors.map((c, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "4px 8px" }}>{c.signal}</td>
                  <td
                    style={{
                      padding: "4px 8px",
                      color:
                        c.impact === "negative"
                          ? "#ef4444"
                          : c.impact === "positive"
                            ? "#22c55e"
                            : "#888",
                    }}
                  >
                    {c.impact}
                  </td>
                  <td
                    style={{
                      padding: "4px 8px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {c.weight.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "4px 8px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {c.value.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
