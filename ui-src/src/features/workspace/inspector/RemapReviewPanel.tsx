import { useCallback, useState, type JSX } from "react";

// ---------------------------------------------------------------------------
// Types mirroring the server contracts (kept local to avoid cross-package import)
// ---------------------------------------------------------------------------

export type RemapConfidence = "high" | "medium" | "low";
export type RemapRule = "exact-id" | "name-and-type" | "name-fuzzy-and-type" | "ancestry-and-type";

export interface RemapSuggestion {
  sourceNodeId: string;
  sourceNodeName: string;
  sourceNodeType: string;
  targetNodeId: string;
  targetNodeName: string;
  targetNodeType: string;
  rule: RemapRule;
  confidence: RemapConfidence;
  reason: string;
}

export interface RemapRejection {
  sourceNodeId: string;
  sourceNodeName: string;
  sourceNodeType: string;
  reason: string;
}

export interface RemapSuggestResult {
  sourceJobId: string;
  latestJobId: string;
  suggestions: RemapSuggestion[];
  rejections: RemapRejection[];
  message: string;
}

export interface RemapDecisionEntry {
  sourceNodeId: string;
  targetNodeId: string | null;
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// Confidence badge styling
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<RemapConfidence, { bg: string; text: string; label: string }> = {
  high: { bg: "#dcfce7", text: "#166534", label: "High" },
  medium: { bg: "#fef9c3", text: "#854d0e", label: "Medium" },
  low: { bg: "#fee2e2", text: "#991b1b", label: "Low" }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RemapReviewPanelProps {
  result: RemapSuggestResult;
  onApply: (decisions: RemapDecisionEntry[]) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function RemapReviewPanel({
  result,
  onApply,
  onCancel,
  disabled = false
}: RemapReviewPanelProps): JSX.Element {
  const [decisions, setDecisions] = useState<Map<string, boolean>>(() => {
    const initial = new Map<string, boolean>();
    for (const suggestion of result.suggestions) {
      // Auto-accept high confidence, let user review medium/low
      initial.set(suggestion.sourceNodeId, suggestion.confidence === "high");
    }
    return initial;
  });

  const toggleDecision = useCallback((sourceNodeId: string) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(sourceNodeId, !prev.get(sourceNodeId));
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        next.set(key, true);
      }
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    const entries: RemapDecisionEntry[] = result.suggestions.map((s) => ({
      sourceNodeId: s.sourceNodeId,
      targetNodeId: s.targetNodeId,
      accepted: decisions.get(s.sourceNodeId) ?? false
    }));
    onApply(entries);
  }, [decisions, onApply, result.suggestions]);

  const acceptedCount = [...decisions.values()].filter(Boolean).length;
  const totalSuggestions = result.suggestions.length;

  return (
    <div
      className="remap-review-panel"
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        border: "1px solid var(--color-info-border, #93c5fd)",
        background: "var(--color-info-bg, #eff6ff)",
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 1.5
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontWeight: 600,
          color: "var(--color-info-text, #1e40af)"
        }}
      >
        Remap suggestions
      </p>
      <p style={{ margin: "0 0 12px", color: "var(--color-text-secondary, #555)" }}>
        {result.message}
      </p>

      {result.suggestions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary, #555)" }}>
              {`${String(acceptedCount)} of ${String(totalSuggestions)} accepted`}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={acceptAll}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--color-border, #ccc)",
                background: "var(--color-bg-secondary, #f5f5f5)",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 11
              }}
            >
              Accept all
            </button>
          </div>

          {result.suggestions.map((suggestion) => {
            const accepted = decisions.get(suggestion.sourceNodeId) ?? false;
            const style = CONFIDENCE_STYLES[suggestion.confidence];
            return (
              <div
                key={suggestion.sourceNodeId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: `1px solid ${accepted ? "var(--color-primary-border, #93c5fd)" : "var(--color-border, #e5e7eb)"}`,
                  background: accepted
                    ? "var(--color-primary-bg-subtle, #f0f9ff)"
                    : "var(--color-bg, #fff)",
                  marginBottom: 4
                }}
              >
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={disabled}
                  onChange={() => { toggleDecision(suggestion.sourceNodeId); }}
                  style={{ marginTop: 3 }}
                  aria-label={`Accept remap for ${suggestion.sourceNodeName}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{ fontWeight: 500, fontSize: 12 }}
                      title={`Source: ${suggestion.sourceNodeId}`}
                    >
                      {suggestion.sourceNodeName}
                    </span>
                    <span style={{ color: "var(--color-text-tertiary, #999)", fontSize: 11 }}>
                      {"\u2192"}
                    </span>
                    <span
                      style={{ fontWeight: 500, fontSize: 12 }}
                      title={`Target: ${suggestion.targetNodeId}`}
                    >
                      {suggestion.targetNodeName}
                    </span>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: style.bg,
                        color: style.text
                      }}
                    >
                      {style.label}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 11,
                      color: "var(--color-text-tertiary, #888)"
                    }}
                  >
                    {suggestion.reason}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {result.rejections.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--color-text-secondary, #555)"
            }}
          >
            {`Unsupported mappings (${String(result.rejections.length)})`}
          </p>
          {result.rejections.map((rejection) => (
            <div
              key={rejection.sourceNodeId}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--color-warning-border, #fbbf24)",
                background: "var(--color-warning-bg-subtle, #fffbeb)",
                marginBottom: 4,
                fontSize: 12
              }}
            >
              <span style={{ fontWeight: 500 }}>{rejection.sourceNodeName}</span>
              <span style={{ color: "var(--color-text-tertiary, #888)" }}>
                {` (${rejection.sourceNodeType})`}
              </span>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 11,
                  color: "var(--color-text-tertiary, #888)"
                }}
              >
                {rejection.reason}
              </p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={disabled || acceptedCount === 0}
          onClick={handleApply}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-primary-border, #2563eb)",
            background: "var(--color-primary-bg, #eff6ff)",
            color: "var(--color-primary-text, #1d4ed8)",
            cursor: disabled || acceptedCount === 0 ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 500
          }}
          title="Apply accepted remaps and carry forward draft"
        >
          {`Apply ${String(acceptedCount)} remap(s)`}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border, #ccc)",
            background: "var(--color-bg-secondary, #f5f5f5)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12
          }}
          title="Cancel remap and return to stale draft options"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
