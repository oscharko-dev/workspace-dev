/**
 * Minimal human-oversight review queue UI (Issue #2179).
 *
 * Surfaces the per-tenant queue and lets a competent reviewer:
 *
 *   1. List pending items (with optional profile / sla-due-by filters).
 *   2. Inspect one item's judge-disagreement context.
 *   3. Submit a pre-signed verdict produced by `ti review decide`.
 *
 * The reviewer's private key is **never** uploaded to the browser. The
 * intended air-gap-friendly flow is:
 *
 *   - Reviewer browses the queue here.
 *   - Reviewer copies the displayed item id and reviews offline.
 *   - Reviewer runs `workspace-dev test-intelligence review decide …`
 *     locally to build + sign + persist the verdict.
 *   - Reviewer optionally pastes the verdict JSON into the textarea
 *     below to validate via the HTTP route's signature check.
 *
 * The page deliberately uses no theming framework — the styling is
 * inline CSS so it ships in air-gapped sovereign-cloud profiles.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type JSX } from "react";
import { fetchQueue, HumanReviewApiError, submitDecision } from "./api";
import type { HumanReviewQueueItem, HumanReviewVerdict } from "./types";

const styles: Readonly<Record<string, CSSProperties>> = {
  page: {
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    color: "#202020",
    background: "#fafafa",
    minHeight: "100vh",
    padding: "24px",
  },
  header: { marginBottom: "16px" },
  filters: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  input: {
    padding: "6px 8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "14px",
  },
  button: {
    padding: "6px 12px",
    border: "1px solid #888",
    background: "#fff",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
    background: "#fff",
    border: "1px solid #ddd",
  },
  th: {
    textAlign: "left",
    padding: "8px",
    background: "#f0f0f0",
    borderBottom: "1px solid #ddd",
  },
  td: { padding: "8px", borderBottom: "1px solid #eee", verticalAlign: "top" },
  monoCell: {
    padding: "8px",
    borderBottom: "1px solid #eee",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "12px",
  },
  rowActive: { background: "#eef6ff" },
  panel: {
    background: "#fff",
    border: "1px solid #ddd",
    padding: "16px",
    marginTop: "16px",
  },
  pre: {
    background: "#f6f8fa",
    padding: "8px",
    overflowX: "auto",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "12px",
    maxHeight: "240px",
  },
  errorBanner: {
    background: "#fee",
    border: "1px solid #c66",
    padding: "8px 12px",
    marginBottom: "12px",
    color: "#900",
    borderRadius: "4px",
    fontSize: "14px",
  },
  okBanner: {
    background: "#efe",
    border: "1px solid #6c6",
    padding: "8px 12px",
    marginBottom: "12px",
    color: "#060",
    borderRadius: "4px",
    fontSize: "14px",
  },
  textarea: {
    width: "100%",
    minHeight: "180px",
    padding: "8px",
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "12px",
    border: "1px solid #ccc",
    borderRadius: "4px",
  },
};

const useQueue = (
  tenant: string,
  profile: string,
  slaDueBy: string,
  refreshTick: number,
): {
  readonly items: readonly HumanReviewQueueItem[];
  readonly loading: boolean;
  readonly error: string | undefined;
} => {
  const [items, setItems] = useState<readonly HumanReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!tenant) {
      const id = setTimeout(() => {
        if (cancelled) return;
        setItems([]);
        setError(undefined);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
    const id = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(undefined);
      fetchQueue({
        tenant,
        ...(profile ? { profile } : {}),
        ...(slaDueBy ? { slaDueBy } : {}),
      })
        .then((next) => {
          if (cancelled) return;
          setItems(next);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof HumanReviewApiError) {
            setError(`[${err.code}] ${err.message}`);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
          setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [tenant, profile, slaDueBy, refreshTick]);

  return { items, loading, error };
};

export const HumanReviewPage = (): JSX.Element => {
  const [tenant, setTenant] = useState("default");
  const [profile, setProfile] = useState("");
  const [slaDueBy, setSlaDueBy] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(undefined);
  const [verdictPaste, setVerdictPaste] = useState("");
  const [submitState, setSubmitState] = useState<
    | { readonly kind: "idle" }
    | { readonly kind: "error"; readonly message: string }
    | { readonly kind: "ok"; readonly itemId: string }
  >({ kind: "idle" });

  const { items, loading, error } = useQueue(tenant, profile, slaDueBy, refreshTick);

  const selected = useMemo(
    () => items.find((item) => item.itemId === selectedItemId),
    [items, selectedItemId],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      let parsed: unknown;
      try {
        parsed = JSON.parse(verdictPaste);
      } catch (err) {
        setSubmitState({
          kind: "error",
          message: `pasted verdict is not valid JSON: ${(err as Error).message}`,
        });
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setSubmitState({
          kind: "error",
          message: "pasted verdict must be a JSON object",
        });
        return;
      }
      try {
        const recorded = await submitDecision(
          tenant,
          parsed as HumanReviewVerdict,
        );
        setSubmitState({ kind: "ok", itemId: recorded.itemId });
        setVerdictPaste("");
        setRefreshTick((t) => t + 1);
      } catch (err) {
        if (err instanceof HumanReviewApiError) {
          setSubmitState({
            kind: "error",
            message: `[${err.code}] ${err.message}`,
          });
        } else {
          setSubmitState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [tenant, verdictPaste],
  );

  return (
    <main style={styles["page"]} aria-labelledby="human-review-heading">
      <header style={styles["header"]}>
        <h1 id="human-review-heading" style={{ margin: 0, fontSize: "20px" }}>
          Human-oversight review queue
        </h1>
        <p style={{ margin: "4px 0 0", color: "#555", fontSize: "13px" }}>
          DSGVO Art. 22 / EU AI Act Art. 14. Pending escalations from the
          test-intelligence harness. Verdicts are signed off-line via{" "}
          <code>workspace-dev test-intelligence review decide</code>.
        </p>
      </header>

      <form
        style={styles["filters"]}
        onSubmit={(e) => {
          e.preventDefault();
          setRefreshTick((t) => t + 1);
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          tenant
          <input
            style={styles["input"]}
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            aria-label="tenant id"
            required
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          profile
          <input
            style={styles["input"]}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            aria-label="profile id (optional)"
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          sla-due-by
          <input
            style={styles["input"]}
            value={slaDueBy}
            onChange={(e) => setSlaDueBy(e.target.value)}
            placeholder="ISO-8601"
            aria-label="sla due by (ISO-8601, optional)"
          />
        </label>
        <button type="submit" style={styles["button"]}>
          Refresh
        </button>
      </form>

      {error !== undefined ? (
        <div role="alert" style={styles["errorBanner"]}>
          {error}
        </div>
      ) : null}

      <table style={styles["table"]} aria-label="pending review queue">
        <thead>
          <tr>
            <th style={styles["th"]}>Item</th>
            <th style={styles["th"]}>Run</th>
            <th style={styles["th"]}>Test case</th>
            <th style={styles["th"]}>Disagreement</th>
            <th style={styles["th"]}>Proposed</th>
            <th style={styles["th"]}>SLA deadline</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td style={styles["td"]} colSpan={6}>
                Loading…
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td style={styles["td"]} colSpan={6}>
                No pending review items for tenant{" "}
                <code>{tenant || "(none)"}</code>.
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const isSelected = item.itemId === selectedItemId;
              const select = () => setSelectedItemId(item.itemId);
              return (
                <tr
                  key={item.itemId}
                  style={isSelected ? styles["rowActive"] : undefined}
                  aria-selected={isSelected}
                >
                  <td style={styles["monoCell"]}>
                    <button
                      type="button"
                      onClick={select}
                      aria-pressed={isSelected}
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        font: "inherit",
                        color: "#0645ad",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {item.itemId.slice(0, 12)}…
                    </button>
                  </td>
                  <td style={styles["monoCell"]}>{item.runId}</td>
                  <td style={styles["monoCell"]}>{item.testCaseId}</td>
                  <td style={styles["td"]}>
                    {item.judgeDisagreement.decision} ·{" "}
                    {(item.judgeDisagreement.disagreementRate * 100).toFixed(0)}%
                  </td>
                  <td style={styles["td"]}>{item.proposedDecision}</td>
                  <td style={styles["monoCell"]}>{item.slaDeadlineAt}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {selected !== undefined ? (
        <section style={styles["panel"]} aria-label="selected queue item">
          <h2 style={{ margin: "0 0 8px", fontSize: "16px" }}>
            Item {selected.itemId}
          </h2>
          <pre style={styles["pre"]}>{JSON.stringify(selected, null, 2)}</pre>

          <h3 style={{ marginTop: "16px", fontSize: "14px" }}>
            Submit signed verdict
          </h3>
          <p style={{ fontSize: "12px", color: "#666", margin: "0 0 8px" }}>
            Paste the canonical-JSON verdict produced by{" "}
            <code>ti review decide</code>. The server verifies the ed25519
            signature before persisting.
          </p>
          {submitState.kind === "error" ? (
            <div role="alert" style={styles["errorBanner"]}>
              {submitState.message}
            </div>
          ) : null}
          {submitState.kind === "ok" ? (
            <div role="status" style={styles["okBanner"]}>
              Verdict recorded for item {submitState.itemId}.
            </div>
          ) : null}
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <textarea
              style={styles["textarea"]}
              value={verdictPaste}
              onChange={(e) => setVerdictPaste(e.target.value)}
              placeholder='{"schemaVersion":"1.0.0", … ,"signatureHex":"…"}'
              aria-label="signed verdict JSON"
              required
            />
            <div style={{ marginTop: "8px" }}>
              <button type="submit" style={styles["button"]}>
                Persist verdict
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
};

export default HumanReviewPage;
