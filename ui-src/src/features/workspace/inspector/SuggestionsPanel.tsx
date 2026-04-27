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
import "./inspector.css";
import type { InspectorCSSProperties } from "./types";

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

const BAND_CLASS: Record<QualityScoreBand, string> = {
  excellent: "sp-quality-band sp-quality-band--excellent",
  good: "sp-quality-band sp-quality-band--good",
  fair: "sp-quality-band sp-quality-band--fair",
  poor: "sp-quality-band sp-quality-band--poor",
};

const SEVERITY_CLASS: Record<"high" | "medium" | "low", string> = {
  high: "sp-severity-badge sp-severity-badge--high",
  medium: "sp-severity-badge sp-severity-badge--medium",
  low: "sp-severity-badge sp-severity-badge--low",
};

const SEVERITY_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
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
      className="sp-panel"
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
  const bandClass = BAND_CLASS[qualityScore.band];
  const bandLabel = BAND_LABELS[qualityScore.band];
  return (
    <div data-testid="suggestions-quality-score">
      <header className="sp-section-header">
        <span className="sp-section-title">Pre-flight quality score</span>
        <span data-testid="suggestions-quality-band" className={bandClass}>
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
    <div className="sp-breakdown-container">
      {rows.map(([label, value]) => (
        <div key={label} className="sp-breakdown-row">
          <span className="sp-breakdown-label">{label}</span>
          <div
            aria-label={`${label} score ${String(value)} out of 100`}
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
            className="sp-breakdown-bar"
          >
            <span
              className={`sp-breakdown-fill ${value >= 80 ? "sp-breakdown-fill--high" : value >= 60 ? "sp-breakdown-fill--medium" : "sp-breakdown-fill--low"}`}
              style={
                {
                  "--sp-breakdown-width": `${String(value)}%`,
                } as InspectorCSSProperties
              }
            />
          </div>
          <span className="sp-breakdown-value">{value}</span>
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
    <p data-testid="suggestions-quality-summary" className="sp-summary">
      {summary.totalNodes} nodes · depth {summary.maxDepth} ·{" "}
      {summary.unmappedNodes} unmapped · {summary.interactiveWithoutSemantics}{" "}
      interactive w/o semantics · {summary.diagnosticsBySeverity.error} errors,{" "}
      {summary.diagnosticsBySeverity.warning} warnings
    </p>
  );
}

function RiskTagList({ risks }: { risks: QualityRiskTag[] }): JSX.Element {
  return (
    <ul data-testid="suggestions-risk-list" className="sp-risk-list">
      {risks.slice(0, 8).map((risk) => (
        <li
          key={risk.id}
          data-testid={`suggestions-risk-${risk.severity}`}
          className="sp-risk-item"
        >
          <span className={SEVERITY_CLASS[risk.severity]}>
            {SEVERITY_LABEL[risk.severity]}
          </span>
          <div className="sp-item-body">
            <div className="sp-item-title">{risk.label}</div>
            <p className="sp-item-detail">{risk.detail}</p>
          </div>
        </li>
      ))}
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
      <header className="sp-section-header">
        <span className="sp-section-title">Token mapping intelligence</span>
        <span className="sp-section-meta">
          {model.summary.conflicts} conflicts · {model.summary.unmapped}{" "}
          unmapped · {model.summary.autoAccepted} auto-accepted
        </span>
      </header>
      <div className="sp-token-controls">
        <button
          type="button"
          onClick={acceptAll}
          disabled={disabled}
          data-testid="suggestions-token-accept-all"
          className="sp-btn-secondary"
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={rejectAll}
          disabled={disabled}
          data-testid="suggestions-token-reject-all"
          className="sp-btn-secondary"
        >
          Reject all
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={disabled || !onApply}
          data-testid="suggestions-token-apply"
          className="sp-btn-primary"
        >
          Apply decisions
        </button>
      </div>
      <ul className="sp-token-list">
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
      className={`sp-token-item ${accepted ? "sp-token-item--accepted" : "sp-token-item--pending"}`}
    >
      <input
        type="checkbox"
        checked={accepted}
        disabled={disabled}
        onChange={() => {
          onToggle(suggestion.id);
        }}
        aria-label={`Accept token mapping for ${suggestion.tokenName}`}
        className="sp-token-checkbox"
      />
      <div className="sp-item-body">
        <div className="sp-token-meta">
          <code className="sp-token-name">{suggestion.tokenName}</code>
          <span className="sp-token-recommendation">{recommendationLabel}</span>
          {suggestion.kind === "conflict" ? (
            <span className="sp-token-conflict-detail">
              {suggestion.figmaValue} → {suggestion.existingValue}
            </span>
          ) : null}
        </div>
        <p className="sp-token-detail">{suggestion.detail}</p>
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
      <header className="sp-section-header">
        <span className="sp-section-title">Post-generation review nudges</span>
        <span className="sp-section-meta">
          {result.summary.total} nudge{result.summary.total === 1 ? "" : "s"} ·{" "}
          {result.summary.byFile} file{result.summary.byFile === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="sp-token-list">
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
  return (
    <li
      data-testid={`suggestions-a11y-${nudge.severity}`}
      className="sp-a11y-item"
    >
      <span className={SEVERITY_CLASS[nudge.severity]}>
        {SEVERITY_LABEL[nudge.severity]}
      </span>
      <div className="sp-item-body">
        <div className="sp-a11y-label-row">
          <span className="sp-a11y-label">{nudge.label}</span>
          {nudge.wcag ? (
            <span className="sp-a11y-wcag">{nudge.wcag}</span>
          ) : null}
          {onFocusFile ? (
            <button
              type="button"
              onClick={() => {
                onFocusFile(nudge.filePath, nudge.line);
              }}
              data-testid={`suggestions-a11y-focus-${nudge.ruleId}`}
              className="sp-a11y-file-btn"
            >
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </button>
          ) : (
            <span className="sp-a11y-file-label">
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </span>
          )}
        </div>
        <p className="sp-item-detail">{nudge.detail}</p>
      </div>
    </li>
  );
}
