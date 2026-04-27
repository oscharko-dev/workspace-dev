import type { JSX } from "react";
import type { StaleDraftCheckResult, StaleDraftDecision } from "./inspector-override-draft";

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
  remapPending = false
}: StaleDraftWarningProps): JSX.Element {
  const hasUnmapped = checkResult.unmappedNodeIds.length > 0;
  const remapAvailable = hasUnmapped && !checkResult.carryForwardAvailable;

  return (
    <div
      role="alert"
      className="stale-draft-warning"
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        border: "1px solid var(--color-warning-border, #e5a100)",
        background: "var(--color-warning-bg, #fef9ec)",
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 1.5
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontWeight: 600,
          color: "var(--color-warning-text, #92610a)"
        }}
      >
        Stale draft detected
      </p>
      <p style={{ margin: "0 0 12px", color: "var(--color-text-secondary, #555)" }}>
        {checkResult.message}
      </p>
      {hasUnmapped && (
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 12,
            color: "var(--color-text-tertiary, #888)"
          }}
        >
          {`${String(checkResult.unmappedNodeIds.length)} node(s) could not be mapped to the latest output.`}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onDecision("continue"); }}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border, #ccc)",
            background: "var(--color-bg-secondary, #f5f5f5)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12
          }}
          title="Keep editing against the original source job"
        >
          Continue with original
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onDecision("discard"); }}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border, #ccc)",
            background: "var(--color-bg-secondary, #f5f5f5)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12
          }}
          title="Discard the draft and start fresh from the latest job"
        >
          Discard draft
        </button>
        {checkResult.carryForwardAvailable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => { onDecision("carry-forward"); }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-primary-border, #2563eb)",
              background: "var(--color-primary-bg, #eff6ff)",
              color: "var(--color-primary-text, #1d4ed8)",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 500
            }}
            title="Apply your edits to the latest job output"
          >
            Carry forward to latest
          </button>
        )}
        {remapAvailable && (
          <button
            type="button"
            disabled={disabled || remapPending}
            onClick={() => { onDecision("remap"); }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-info-border, #60a5fa)",
              background: "var(--color-info-bg, #eff6ff)",
              color: "var(--color-info-text, #1d4ed8)",
              cursor: disabled || remapPending ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 500
            }}
            title="Get guided suggestions for remapping changed nodes"
          >
            {remapPending ? "Loading suggestions\u2026" : "Suggest remaps"}
          </button>
        )}
      </div>
    </div>
  );
}
