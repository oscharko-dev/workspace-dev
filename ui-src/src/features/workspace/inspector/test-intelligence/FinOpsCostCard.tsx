/**
 * Live FinOps cost card (Issue #1740 + #1738).
 *
 * Shows tokens-used vs. budget envelope with a colour-coded usage bar:
 *   - green   <= 60% of budget
 *   - amber   60% — 85%
 *   - red     > 85%
 *
 * The colour is the secondary signal — the numeric percentage and the
 * `data-usage-band` attribute are the primary signal so colour-blind
 * operators do not lose information.
 *
 * The component is intentionally pure (no fetching / no SSE). The host
 * page passes the latest tokens-used + budget pair so this card stays
 * cheap to re-render and easy to test.
 */

import { type JSX } from "react";

import {
  classifyUsageBand,
  formatTokens,
  type UsageBand,
} from "./finops-cost-card-model";

export interface FinOpsCostCardProps {
  /** Tokens used so far for this job. */
  tokensUsed: number;
  /** Budget envelope (max tokens before the runner fail-closes). */
  tokensBudget: number;
  /** Optional currency-formatted estimate to display alongside tokens. */
  estimatedCostLabel?: string;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

const BAND_BAR_CLASS: Readonly<Record<UsageBand, string>> = {
  green: "bg-[#4eba87]",
  amber: "bg-amber-300",
  red: "bg-rose-400",
};

const BAND_LABEL: Readonly<Record<UsageBand, string>> = {
  green: "within budget",
  amber: "budget warning",
  red: "budget critical",
};

export function FinOpsCostCard({
  tokensUsed,
  tokensBudget,
  estimatedCostLabel,
}: FinOpsCostCardProps): JSX.Element {
  const safeBudget = tokensBudget > 0 ? tokensBudget : 0;
  const ratio =
    safeBudget === 0 ? 0 : Math.min(1, Math.max(0, tokensUsed / safeBudget));
  const band = classifyUsageBand(ratio);
  const percentLabel = `${Math.round(ratio * 100)}%`;

  return (
    <section
      data-testid="ti-finops-cost-card"
      data-usage-band={band}
      aria-labelledby="ti-finops-cost-card-heading"
      className={`flex flex-col gap-2 rounded border border-white/10 bg-[#171717] p-4 ${FOCUS_RING_CLASS}`}
    >
      <header className="flex items-center justify-between">
        <h3
          id="ti-finops-cost-card-heading"
          className="m-0 text-sm font-semibold text-white"
        >
          FinOps usage
        </h3>
        <span
          data-testid="ti-finops-cost-card-band-label"
          className={`rounded border border-white/10 bg-[#0a0a0a] px-1.5 py-[1px] text-[10px] uppercase tracking-[0.18em] text-white/65`}
        >
          {BAND_LABEL[band]}
        </span>
      </header>

      <div className="flex items-baseline justify-between">
        <span
          data-testid="ti-finops-cost-card-tokens"
          className="font-mono text-[12px] text-white/85"
        >
          {formatTokens(tokensUsed)} / {formatTokens(safeBudget)} tokens
        </span>
        <span
          data-testid="ti-finops-cost-card-percent"
          className="font-mono text-[11px] text-white/65"
        >
          {percentLabel}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="FinOps token usage"
        aria-valuemin={0}
        aria-valuemax={safeBudget}
        aria-valuenow={Math.min(tokensUsed, safeBudget)}
        aria-valuetext={`${formatTokens(tokensUsed)} of ${formatTokens(safeBudget)} tokens used (${percentLabel}, ${BAND_LABEL[band]})`}
        data-testid="ti-finops-cost-card-bar"
        className="h-2 w-full overflow-hidden rounded bg-white/10"
      >
        <div
          data-testid="ti-finops-cost-card-bar-fill"
          className={`h-full ${BAND_BAR_CLASS[band]}`}
          style={{ width: `${(ratio * 100).toFixed(1)}%` }}
        />
      </div>

      {estimatedCostLabel !== undefined ? (
        <p
          data-testid="ti-finops-cost-card-estimate"
          className="m-0 text-[11px] text-white/55"
        >
          Estimated cost: {estimatedCostLabel}
        </p>
      ) : null}
    </section>
  );
}
