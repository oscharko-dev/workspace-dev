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
      className="removed-style-1"
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
        className="removed-style-2"
      >
        <span className="removed-style-3">Pre-flight quality score</span>
        <span
          data-testid="suggestions-quality-band"
          className="removed-style-4"
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
    <div className="removed-style-5">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="removed-style-6"
        >
          <span
            className="removed-style-7"
          >
            {label}
          </span>
          <div
            aria-label={`${label} score ${String(value)} out of 100`}
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={100}
            className="removed-style-8"
          >
            <span
              className="removed-style-9"
            />
          </div>
          <span className="removed-style-10">
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
      className="removed-style-11"
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
      className="removed-style-12"
    >
      {risks.slice(0, 8).map((risk) => {
        const sev = SEVERITY_BADGE[risk.severity];
        return (
          <li
            key={risk.id}
            data-testid={`suggestions-risk-${risk.severity}`}
            className="removed-style-13"
          >
            <span
              className="removed-style-14"
            >
              {sev.label}
            </span>
            <div className="removed-style-15">
              <div className="removed-style-16">{risk.label}</div>
              <p
                className="removed-style-17"
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
        className="removed-style-18"
      >
        <span className="removed-style-19">Token mapping intelligence</span>
        <span className="removed-style-20">
          {model.summary.conflicts} conflicts · {model.summary.unmapped}{" "}
          unmapped · {model.summary.autoAccepted} auto-accepted
        </span>
      </header>
      <div className="removed-style-21">
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
      <ul className="removed-style-22">
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
      className="removed-style-23"
    >
      <input
        type="checkbox"
        checked={accepted}
        disabled={disabled}
        onChange={() => {
          onToggle(suggestion.id);
        }}
        aria-label={`Accept token mapping for ${suggestion.tokenName}`}
        className="removed-style-24"
      />
      <div className="removed-style-25">
        <div
          className="removed-style-26"
        >
          <code
            className="removed-style-27"
          >
            {suggestion.tokenName}
          </code>
          <span
            className="removed-style-28"
          >
            {recommendationLabel}
          </span>
          {suggestion.kind === "conflict" ? (
            <span className="removed-style-29">
              {suggestion.figmaValue} → {suggestion.existingValue}
            </span>
          ) : null}
        </div>
        <p className="removed-style-30">
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
        className="removed-style-31"
      >
        <span className="removed-style-32">Post-generation review nudges</span>
        <span className="removed-style-33">
          {result.summary.total} nudge{result.summary.total === 1 ? "" : "s"} ·{" "}
          {result.summary.byFile} file{result.summary.byFile === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="removed-style-34">
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
      className="removed-style-35"
    >
      <span
        className="removed-style-36"
      >
        {sev.label}
      </span>
      <div className="removed-style-37">
        <div
          className="removed-style-38"
        >
          <span className="removed-style-39">{nudge.label}</span>
          {nudge.wcag ? (
            <span className="removed-style-40">{nudge.wcag}</span>
          ) : null}
          {onFocusFile ? (
            <button
              type="button"
              onClick={() => {
                onFocusFile(nudge.filePath, nudge.line);
              }}
              data-testid={`suggestions-a11y-focus-${nudge.ruleId}`}
              className="removed-style-41"
            >
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </button>
          ) : (
            <span className="removed-style-42">
              {nudge.filePath}
              {nudge.line ? `:${String(nudge.line)}` : ""}
            </span>
          )}
        </div>
        <p
          className="removed-style-43"
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
