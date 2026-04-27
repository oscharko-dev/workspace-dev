import type { JSX } from "react";
import type {
  StaleDraftCheckResult,
  StaleDraftDecision,
} from "./inspector-override-draft";

interface StaleDraftWarningProps {
  checkResult: StaleDraftCheckResult;
  onDecision: (decision: StaleDraftDecision | "remap") => void;
  disabled?: boolean;
  remapPending?: boolean;
}

export function StaleDraftWarning({
  checkResult,
  onDecision,
  disabled = false,
  remapPending = false,
}: StaleDraftWarningProps): JSX.Element {
  const hasUnmapped = checkResult.unmappedNodeIds.length > 0;
  const remapAvailable = hasUnmapped && !checkResult.carryForwardAvailable;

  return (
    <div role="alert" className="stale-draft-warning">
      <p className="stale-draft-warning-title">Stale draft detected</p>
      <p className="stale-draft-warning-message">{checkResult.message}</p>
      {hasUnmapped && (
        <p className="stale-draft-warning-detail">
          {`${String(checkResult.unmappedNodeIds.length)} node(s) could not be mapped to the latest output.`}
        </p>
      )}
      <div className="stale-draft-warning-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onDecision("continue");
          }}
          className="stale-draft-btn"
          title="Keep editing against the original source job"
        >
          Continue with original
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onDecision("discard");
          }}
          className="stale-draft-btn"
          title="Discard the draft and start fresh from the latest job"
        >
          Discard draft
        </button>
        {checkResult.carryForwardAvailable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onDecision("carry-forward");
            }}
            className="stale-draft-btn stale-draft-btn--primary"
            title="Apply your edits to the latest job output"
          >
            Carry forward to latest
          </button>
        )}
        {remapAvailable && (
          <button
            type="button"
            disabled={disabled || remapPending}
            onClick={() => {
              onDecision("remap");
            }}
            className="stale-draft-btn stale-draft-btn--info"
            title="Get guided suggestions for remapping changed nodes"
          >
            {remapPending ? "Loading suggestions\u2026" : "Suggest remaps"}
          </button>
        )}
      </div>
    </div>
  );
}
