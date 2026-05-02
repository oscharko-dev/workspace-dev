/**
 * Figma URL submission tab (Issue #1735).
 *
 * Operator pastes a Figma share URL, the panel parses out the
 * `figmaFileKey` + optional `figmaNodeId` client-side, and on submit
 * posts to `/workspace/submit` with `figmaSourceMode: "figma_url"` plus
 * the extracted JSON payload. The server completes the hybrid promotion
 * (file key + node id + access token) — we never echo the access token in
 * the UI.
 *
 * WCAG 2.2 AA:
 *   - URL input has a visible label and `aria-describedby` pointing at
 *     the parsed-info / inline-error region.
 *   - Validation errors are announced through `aria-live="polite"`; an
 *     action-blocking server-side rejection switches to
 *     `aria-live="assertive"`.
 *   - Focus rings use the brand colour with offset for clear contrast.
 */

import { useMemo, useState, type JSX } from "react";

import { postWorkspaceSubmit } from "./api";
import {
  describeFigmaUrlError,
  parseFigmaUrl,
  type ParsedFigmaUrl,
} from "./figma-url-parser";

export interface FigmaUrlTabProps {
  /**
   * Called when the workspace submit accepts the job. Mirrors the
   * `onIngested` callback the multi-source panel uses so the parent can
   * refresh the bundle / job-list views.
   */
  onSubmitted: (jobId: string) => Promise<void> | void;
}

type StatusKind = "idle" | "submitting" | "success" | "error";

interface StatusState {
  kind: StatusKind;
  message: string;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

const PARSED_INFO_ID = "ti-figma-url-parsed-info";
const INLINE_ERROR_ID = "ti-figma-url-inline-error";
const SUBMIT_STATUS_ID = "ti-figma-url-submit-status";

export function FigmaUrlTab({ onSubmitted }: FigmaUrlTabProps): JSX.Element {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<StatusState>({
    kind: "idle",
    message: "",
  });

  const parsed = useMemo(() => parseFigmaUrl(url), [url]);
  const showInlineError = url.trim().length > 0 && !parsed.ok;
  const submitDisabled = !parsed.ok || status.kind === "submitting";

  const handleSubmit = async (): Promise<void> => {
    if (!parsed.ok) return;
    setStatus({ kind: "submitting", message: "Submitting Figma URL…" });
    const result = await postWorkspaceSubmit({
      figmaJsonPayload: encodeFigmaUrlPayload(parsed.value),
      sourceMode: "figma_url",
    });
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setStatus({
      kind: "success",
      message: `Job submitted: ${result.value.jobId}.`,
    });
    await Promise.resolve(onSubmitted(result.value.jobId));
  };

  return (
    <section
      data-testid="ti-figma-url-tab"
      aria-labelledby="ti-figma-url-heading"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex flex-col gap-1">
        <h3
          id="ti-figma-url-heading"
          className="m-0 text-sm font-semibold text-white"
        >
          Figma URL
        </h3>
        <p className="m-0 text-[11px] text-white/55">
          Paste a Figma file or design link. The server resolves the file key
          and node id and pulls the screen via the configured
          <span className="font-mono"> FIGMA_ACCESS_TOKEN</span>.
        </p>
      </header>

      <label
        className="flex flex-col gap-1 text-[11px] text-white/65"
        htmlFor="ti-figma-url-input"
      >
        Figma share URL
        <input
          data-testid="ti-figma-url-input"
          id="ti-figma-url-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (status.kind !== "submitting") {
              setStatus({ kind: "idle", message: "" });
            }
          }}
          aria-describedby={`${PARSED_INFO_ID} ${INLINE_ERROR_ID}`}
          aria-invalid={showInlineError}
          placeholder="https://www.figma.com/design/<fileKey>/Title?node-id=0-1"
          className={`w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 ${FOCUS_RING_CLASS}`}
        />
      </label>

      <div
        id={PARSED_INFO_ID}
        data-testid="ti-figma-url-parsed-info"
        aria-live="polite"
        className="min-h-[18px] text-[11px] text-white/65"
      >
        {parsed.ok ? (
          <>
            <span className="text-white/45">file key </span>
            <span className="font-mono text-white/85">
              {parsed.value.figmaFileKey}
            </span>
            {parsed.value.figmaNodeId !== null ? (
              <>
                <span className="text-white/35"> · </span>
                <span className="text-white/45">node </span>
                <span className="font-mono text-white/85">
                  {parsed.value.figmaNodeId}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <p
        id={INLINE_ERROR_ID}
        data-testid="ti-figma-url-inline-error"
        role={showInlineError ? "status" : undefined}
        aria-live="polite"
        className="m-0 min-h-[16px] text-[11px] text-amber-200"
      >
        {showInlineError && !parsed.ok
          ? describeFigmaUrlError(parsed.reason)
          : ""}
      </p>

      <button
        type="button"
        data-testid="ti-figma-url-submit"
        disabled={submitDisabled}
        onClick={() => {
          void handleSubmit();
        }}
        className={`w-fit cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-3 py-1 text-[11px] font-medium text-[#4eba87] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/35 ${FOCUS_RING_CLASS}`}
      >
        Submit Figma URL
      </button>

      <p
        id={SUBMIT_STATUS_ID}
        data-testid="ti-figma-url-submit-status"
        role={status.kind === "error" ? "alert" : "status"}
        aria-live={status.kind === "error" ? "assertive" : "polite"}
        className={`m-0 min-h-[16px] text-[11px] ${
          status.kind === "error"
            ? "text-rose-200"
            : status.kind === "success"
              ? "text-emerald-200"
              : "text-white/65"
        }`}
      >
        {status.message}
      </p>
    </section>
  );
}

const encodeFigmaUrlPayload = (parsed: ParsedFigmaUrl): string => {
  const payload: { figmaFileKey: string; nodeId?: string } = {
    figmaFileKey: parsed.figmaFileKey,
  };
  if (parsed.figmaNodeId !== null) {
    payload.nodeId = parsed.figmaNodeId;
  }
  return JSON.stringify(payload);
};
