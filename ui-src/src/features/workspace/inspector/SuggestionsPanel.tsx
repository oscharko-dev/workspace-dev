/**
 * SuggestionsPanel — non-invasive right-pane surface for Issue #993.
 *
 * Renders three sections:
 *  1. Pre-flight Quality Score (score + risk tags, prioritised).
 *  2. Token Matching Intelligence (1-click accept/reject conflicts + unmapped).
 *  3. Post-gen Review Nudges (accessibility/semantic HTML hints on files).
 *
 * This component is a pure view — all decisions are lifted to the parent via
 * callbacks. Consumers derive the three models with the corresponding pure
 * helpers (`deriveQualityScore`, `deriveTokenSuggestionModel`, `deriveA11yNudges`).
 */

import { useCallback, useMemo, useState, type JSX } from "react";
import type {
  QualityRiskTag,
  QualityScoreBand,
  QualityScoreResult,
} from "./import-quality-score";
import type {
  TokenSuggestion,
  TokenSuggestionModel,
} from "./token-suggestion-model";
import { resolveTokenDecisions } from "./token-suggestion-model";
import type { A11yNudge, A11yNudgeResult } from "./a11y-nudge";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SuggestionsPanelProps {
  qualityScore: QualityScoreResult;
  tokenModel: TokenSuggestionModel;
  a11yResult: A11yNudgeResult;
  onApplyTokenDecisions?: (result: {
    acceptedTokenNames: string[];
    rejectedTokenNames: string[];
  }) => void;
  onFocusFile?: (path: string, line?: number) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BAND_LABELS: Record<QualityScoreBand, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

const BAND_STYLE: Record<
  QualityScoreBand,
  { bg: string; border: string; text: string }
> = {
  excellent: { bg: "#ecfdf5", border: "#10b981", text: "#065f46" },
  good: { bg: "#eff6ff", border: "#3b82f6", text: "#1e40af" },
  fair: { bg: "#fffbeb", border: "#d97706", text: "#78350f" },
  poor: { bg: "#fef2f2", border: "#dc2626", text: "#991b1b" },
};

const SEVERITY_BADGE: Record<
  "high" | "medium" | "low",
  { bg: string; text: string; label: string }
> = {
  high: { bg: "#fee2e2", text: "#991b1b", label: "High" },
  medium: { bg: "#fef9c3", text: "#854d0e", label: "Medium" },
  low: { bg: "#dbeafe", text: "#1e3a8a", label: "Low" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SuggestionsPanel({
  qualityScore,
  tokenModel,
  a11yResult,
  onApplyTokenDecisions,
  onFocusFile,
  disabled = false,
}: SuggestionsPanelProps): JSX.Element | null {
  const hasTokenSuggestions =
    tokenModel.available && tokenModel.suggestions.length > 0;
  const hasA11yNudges = a11yResult.nudges.length > 0;
  const hasRisks = qualityScore.risks.length > 0;
  const showPanel =
    hasTokenSuggestions ||
    hasA11yNudges ||
    hasRisks ||
    qualityScore.summary.totalNodes > 0;

  if (!showPanel) return null;

  return (
    <section
      aria-label="Import quality suggestions"
      data-testid="inspector-suggestions-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        background: "#fafafa",
        color: "#111827",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <QualityScoreSection qualityScore={qualityScore} />
      {tokenModel.available ? (
        <TokenSuggestionsSection
          model={tokenModel}
          {...(onApplyTokenDecisions ? { onApply: onApplyTokenDecisions } : {})}
          disabled={disabled}
        />
      ) : null}
      {hasA11yNudges ? (
        <A11yNudgeSection
          result={a11yResult}
          {...(onFocusFile ? { onFocusFile } : {})}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Quality Score section
// ---------------------------------------------------------------------------

function QualityScoreSection({
  qualityScore,
}: {
  qualityScore: QualityScoreResult;
}): JSX.Element {
  const bandStyle = BAND_STYLE[qualityScore.band];
  const bandLabel = BAND_LABELS[qualityScore.band];
  return (
    <div data-testid="suggestions-quality-score">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 600 }}>Pre-flight quality score</span>
        <span
          data-testid="suggestions-quality-band"
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            background: bandStyle.bg,
            border: `1px solid ${bandStyle.border}`,
            color: bandStyle.text,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {bandLabel} · {qualityScore.score}
        </span>
      </header>
      <BreakdownBar breakdown={qualityScore.breakdown} />
      <Summary qualityScore={qualityScore} />
      {qualityScore.risks.length > 0 ? (
        <RiskTagList risks={qualityScore.risks} />
      ) : null}
    </div>
  );
}

function BreakdownBar({
  breakdown,
}: {
  breakdown: QualityScoreResult["breakdown"];
}): JSX.Element {
  const rows: Array<[string, number]> = [
    ["Structure", breakdown.structure],
    ["Semantic", breakdown.semantic],
    ["Codegen", breakdown.codegen],
  ];
  return (
    <div style={{ marginTop: 4 }}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <span
            style={{
              width: 78,
              fontSize: 11,
              color: "#4b5563",
            }}
          >
            {label}
          </span>
          <div
            aria-label={`${label} score ${String(value)} out of 100`}
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              position: "relative",
              flex: 1,
              height: 6,
              background: "#e5e7eb",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: `${String(value)}%`,
                background:
                  value >= 80 ? "#10b981" : value >= 60 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <span style={{ width: 28, textAlign: "right", fontSize: 11 }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Summary({
  qualityScore,
}: {
  qualityScore: QualityScoreResult;
}): JSX.Element {
  const { summary } = qualityScore;
  return (
    <p
      data-testid="suggestions-quality-summary"
      style={{ margin: "6px 0 0", fontSize: 11, color: "#6b7280" }}
    >
      {summary.totalNodes} nodes · depth {summary.maxDepth} ·{" "}
      {summary.unmappedNodes} unmapped · {summary.interactiveWithoutSemantics}{" "}
      interactive w/o semantics · {summary.diagnosticsBySeverity.error} errors,{" "}
      {summary.diagnosticsBySeverity.warning} warnings
    </p>
  );
}

function RiskTagList({ risks }: { risks: QualityRiskTag[] }): JSX.Element {
  return (
    <ul
      data-testid="suggestions-risk-list"
      style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}
    >
      {risks.slice(0, 8).map((risk) => {
        const sev = SEVERITY_BADGE[risk.severity];
        return (
          <li
            key={risk.id}
            data-testid={`suggestions-risk-${risk.severity}`}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "6px 8px",
              marginBottom: 4,
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
            }}
          >
            <span
              style={{
                padding: "0 6px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                background: sev.bg,
                color: sev.text,
                flexShrink: 0,
                alignSelf: "center",
              }}
            >
              {sev.label}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 12 }}>{risk.label}</div>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 11,
                  color: "#6b7280",
                  wordBreak: "break-word",
                }}
              >
                {risk.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Token Suggestions section
// ---------------------------------------------------------------------------

function TokenSuggestionsSection({
  model,
  onApply,
  disabled,
}: {
  model: TokenSuggestionModel;
  onApply?: (result: {
    acceptedTokenNames: string[];
    rejectedTokenNames: string[];
  }) => void;
  disabled: boolean;
}): JSX.Element {
  const initialAccepted = useMemo(
    () =>
      new Set(
        model.suggestions
          .filter((suggestion) => suggestion.autoAccepted)
          .map((suggestion) => suggestion.id),
      ),
    [model.suggestions],
  );
  const [accepted, setAccepted] = useState<Set<string>>(initialAccepted);

  const toggle = useCallback((id: string): void => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setAccepted(new Set(model.suggestions.map((suggestion) => suggestion.id)));
  }, [model.suggestions]);

  const rejectAll = useCallback(() => {
    setAccepted(new Set());
  }, []);

  const apply = useCallback(() => {
    if (!onApply) return;
    const result = resolveTokenDecisions(model, accepted);
    onApply({
      acceptedTokenNames: result.acceptedTokenNames,
      rejectedTokenNames: result.rejectedTokenNames,
    });
  }, [accepted, model, onApply]);

  return (
    <div data-testid="suggestions-token-section">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 600 }}>Token mapping intelligence</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {model.summary.conflicts} conflicts · {model.summary.unmapped}{" "}
          unmapped · {model.summary.autoAccepted} auto-accepted
        </span>
      </header>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={acceptAll}
          disabled={disabled}
          data-testid="suggestions-token-accept-all"
          style={secondaryButton(disabled)}
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={rejectAll}
          disabled={disabled}
          data-testid="suggestions-token-reject-all"
          style={secondaryButton(disabled)}
        >
          Reject all
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={disabled || !onApply}
          data-testid="suggestions-token-apply"
          style={primaryButton(disabled || !onApply)}
        >
          Apply decisions
        </button>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {model.suggestions.map((suggestion) => (
          <TokenSuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            accepted={accepted.has(suggestion.id)}
            onToggle={toggle}
            disabled={disabled}
          />
        ))}
      </ul>
    </div>
  );
}

function TokenSuggestionRow({
  suggestion,
  accepted,
  onToggle,
  disabled,
}: {
  suggestion: TokenSuggestion;
  accepted: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
}): JSX.Element {
  const recommendationLabel =
    suggestion.recommendation === "accept"
      ? "Accept"
      : suggestion.recommendation === "reject"
        ? "Reject"
        : "Review";
  return (
    <li
      data-testid={`suggestions-token-${suggestion.kind}`}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "6px 8px",
        borderRadius: 6,
        border: accepted ? "1px solid #93c5fd" : "1px solid #e5e7eb",
        background: accepted ? "#f0f9ff" : "#fff",
        marginBottom: 4,
      }}
    >
      <input
        type="checkbox"
        checked={accepted}
        disabled={disabled}
        onChange={() => {
          onToggle(suggestion.id);
        }}
        aria-label={`Accept token mapping for ${suggestion.tokenName}`}
        style={{ marginTop: 3 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <code
            style={{
              fontSize: 12,
              fontWeight: 500,
              background: "#f3f4f6",
              padding: "0 4px",
              borderRadius: 3,
            }}
          >
            {suggestion.tokenName}
          </code>
          <span
            style={{
              fontSize: 10,
              padding: "0 6px",
              borderRadius: 4,
              background: "#e0e7ff",
              color: "#3730a3",
              fontWeight: 600,
            }}
          >
            {recommendationLabel}
          </span>
          {suggestion.kind === "conflict" ? (
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {suggestion.figmaValue} → {suggestion.existingValue}
            </span>
          ) : null}
        </div>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>
          {suggestion.detail}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// A11y Nudge section
// ---------------------------------------------------------------------------

function A11yNudgeSection({
  result,
  onFocusFile,
}: {
  result: A11yNudgeResult;
  onFocusFile?: (path: string, line?: number) => void;
}): JSX.Element {
  return (
    <div data-testid="suggestions-a11y-section">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 600 }}>Post-generation review nudges</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {result.summary.total} nudge{result.summary.total === 1 ? "" : "s"} ·{" "}
          {result.summary.byFile} file{result.summary.byFile === 1 ? "" : "s"}
        </span>
      </header>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {result.nudges.slice(0, 10).map((nudge) => (
          <A11yNudgeRow
            key={`${nudge.ruleId}:${nudge.filePath}:${String(nudge.line ?? 0)}`}
            nudge={nudge}
            {...(onFocusFile ? { onFocusFile } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

function A11yNudgeRow({
  nudge,
  onFocusFile,
}: {
  nudge: A11yNudge;
  onFocusFile?: (path: string, line?: number) => void;
}): JSX.Element {
  const sev = SEVERITY_BADGE[nudge.severity];
  return (
    <li
      data-testid={`suggestions-a11y-${nudge.severity}`}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "6px 8px",
        marginBottom: 4,
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        background: "#fff",
      }}
    >
      <span
        style={{
          padding: "0 6px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          background: sev.bg,
          color: sev.text,
          flexShrink: 0,
          alignSelf: "center",
        }}
      >
        {sev.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 500, fontSize: 12 }}>{nudge.label}</span>
          {nudge.wcag ? (
            <span style={{ fontSize: 10, color: "#6b7280" }}>{nudge.wcag}</span>
          ) : null}
          {onFocusFile ? (
            <button
              type="button"
              onClick={() => {
                onFocusFile(nudge.filePath, nudge.line);
              }}
              data-testid={`suggestions-a11y-focus-${nudge.ruleId}`}
              style={{
                background: "transparent",
                border: "1px solid #d1d5db",
                padding: "0 6px",
                borderRadius: 4,
                fontSize: 10,
                cursor: "pointer",
                color: "#1f2937",
              }}
            >
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </button>
          ) : (
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </span>
          )}
        </div>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 11,
            color: "#6b7280",
            wordBreak: "break-word",
          }}
        >
          {nudge.detail}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Button helpers
// ---------------------------------------------------------------------------

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "#f9fafb",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 11,
    color: "#1f2937",
  };
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid #1d4ed8",
    background: disabled ? "#93c5fd" : "#2563eb",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 11,
    fontWeight: 600,
  };
}
