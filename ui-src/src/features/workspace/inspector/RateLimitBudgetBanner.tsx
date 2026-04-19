import { useEffect, useState, type JSX } from "react";
import {
  dismissBannerForMonth,
  getQuotaSnapshot,
  isBannerDismissedForMonth,
} from "./figma-mcp-call-counter";
import { subscribeToImportGovernanceEvents } from "./import-governance-events";

const FIGMA_PRICING_URL = "https://www.figma.com/pricing/";

export function RateLimitBudgetBanner(): JSX.Element | null {
  // Track the month the user dismissed so a cross-month render re-enables
  // the banner without waiting for sessionStorage re-read timing.
  const [dismissedMonth, setDismissedMonth] = useState<string | null>(null);
  // Force a re-render when the threshold is crossed so the banner appears
  // without waiting for an external state update to propagate.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeToImportGovernanceEvents((event) => {
      if (event.kind === "mcp-budget-threshold-crossed") {
        setTick((t) => t + 1);
      }
    });
  }, []);

  void tick;
  const snapshot = getQuotaSnapshot();

  if (!snapshot.thresholdCrossed) {
    return null;
  }
  const locallyDismissed = dismissedMonth === snapshot.month;
  const storageDismissed = isBannerDismissedForMonth(snapshot.month);
  if (locallyDismissed || storageDismissed) {
    return null;
  }

  const handleDismiss = (): void => {
    dismissBannerForMonth(snapshot.month);
    setDismissedMonth(snapshot.month);
  };

  return (
    <div
      data-testid="rate-limit-budget-banner"
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-3 border-b border-[#000000] bg-[#1c1800] px-4 py-1.5 text-[11px]"
    >
      <span aria-hidden="true" className="text-amber-400">
        ⚠
      </span>
      <span className="min-w-0 flex-1 text-amber-400">
        {`Figma MCP usage: ${String(snapshot.callsThisMonth)} of ${String(snapshot.budget)} calls this month. `}
        <a
          data-testid="rate-limit-budget-banner-link"
          href={FIGMA_PRICING_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="underline hover:text-amber-300"
        >
          Upgrade your plan
        </a>
        {" for more headroom."}
      </span>
      <button
        type="button"
        data-testid="rate-limit-budget-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss rate-limit warning"
        className="shrink-0 cursor-pointer rounded border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/65 transition hover:border-[#000000] hover:bg-[#222222] hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      >
        ✕
      </button>
    </div>
  );
}
