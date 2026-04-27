import { useCallback, useState, type JSX } from "react";

// ---------------------------------------------------------------------------
// Types mirroring the server contracts (kept local to avoid cross-package import)
// ---------------------------------------------------------------------------

export type RemapConfidence = "high" | "medium" | "low";
export type RemapRule =
  | "exact-id"
  | "name-and-type"
  | "name-fuzzy-and-type"
  | "ancestry-and-type";

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

const CONFIDENCE_STYLES: Record<
  RemapConfidence,
  { bg: string; text: string; label: string }
> = {
  high: { bg: "#dcfce7", text: "#166534", label: "High" },
  medium: { bg: "#fef9c3", text: "#854d0e", label: "Medium" },
  low: { bg: "#fee2e2", text: "#991b1b", label: "Low" },
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
  disabled = false,
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
      accepted: decisions.get(s.sourceNodeId) ?? false,
    }));
    onApply(entries);
  }, [decisions, onApply, result.suggestions]);

  const acceptedCount = [...decisions.values()].filter(Boolean).length;
  const totalSuggestions = result.suggestions.length;

  return (
    <div className="remap-review-panel">
      <p className="remap-review-panel-title">Remap suggestions</p>
      <p className="remap-review-panel-message">{result.message}</p>

      {result.suggestions.length > 0 && (
        <div className="remap-review-suggestions">
          <div className="remap-suggestions-header">
            <span className="remap-suggestions-count">
              {`${String(acceptedCount)} of ${String(totalSuggestions)} accepted`}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={acceptAll}
              className="remap-accept-all-btn"
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
                className="remap-suggestion-item"
                style={
                  {
                    "--remap-item-border": accepted
                      ? "1px solid var(--color-primary-border, #93c5fd)"
                      : "1px solid var(--color-border, #e5e7eb)",
                    "--remap-item-bg": accepted
                      ? "var(--color-primary-bg-subtle, #f0f9ff)"
                      : "var(--color-bg, #fff)",
                  } as React.CSSProperties
                }
              >
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={disabled}
                  onChange={() => {
                    toggleDecision(suggestion.sourceNodeId);
                  }}
                  className="remap-suggestion-item-checkbox"
                  aria-label={`Accept remap for ${suggestion.sourceNodeName}`}
                />
                <div className="remap-suggestion-content">
                  <div className="remap-suggestion-header">
                    <span
                      className="remap-suggestion-source-name"
                      title={`Source: ${suggestion.sourceNodeId}`}
                    >
                      {suggestion.sourceNodeName}
                    </span>
                    <span className="remap-suggestion-arrow">{"\u2192"}</span>
                    <span
                      className="remap-suggestion-target-name"
                      title={`Target: ${suggestion.targetNodeId}`}
                    >
                      {suggestion.targetNodeName}
                    </span>
                    <span
                      className="remap-confidence-badge"
                      style={
                        {
                          "--remap-badge-bg": style.bg,
                          "--remap-badge-color": style.text,
                        } as React.CSSProperties
                      }
                    >
                      {style.label}
                    </span>
                  </div>
                  <p className="remap-suggestion-reason">{suggestion.reason}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {result.rejections.length > 0 && (
        <div className="remap-rejections">
          <p className="remap-rejections-title">
            {`Unsupported mappings (${String(result.rejections.length)})`}
          </p>
          {result.rejections.map((rejection) => (
            <div key={rejection.sourceNodeId} className="remap-rejection-item">
              <span className="remap-rejection-name">
                {rejection.sourceNodeName}
              </span>
              <span className="remap-rejection-type">
                {` (${rejection.sourceNodeType})`}
              </span>
              <p className="remap-rejection-reason">{rejection.reason}</p>
            </div>
          ))}
        </div>
      )}

      <div className="remap-review-actions">
        <button
          type="button"
          disabled={disabled || acceptedCount === 0}
          onClick={handleApply}
          className="remap-apply-btn"
          title="Apply accepted remaps and carry forward draft"
        >
          {`Apply ${String(acceptedCount)} remap(s)`}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="remap-cancel-btn"
          title="Cancel remap and return to stale draft options"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
