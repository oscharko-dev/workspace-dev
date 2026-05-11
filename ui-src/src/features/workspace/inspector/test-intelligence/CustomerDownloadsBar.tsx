/**
 * Customer downloads bar (Issue #1747).
 *
 * Renders the Markdown + ZIP download buttons side-by-side with icons.
 * Both anchors are server-relative so they inherit the current origin
 * without a CORS preflight; both are gated server-side by the TI feature
 * gates.
 *
 * WCAG 2.2 AA:
 *   - Each button is a real `<a>` (tab-reachable, no JS required)
 *   - Visible focus ring with brand color
 *   - aria-label spells out the action and the job id
 *   - The icons carry aria-hidden=true; the textual label is the
 *     accessible name; an additional sr-only description explains the
 *     payload shape so screen-reader users know whether they are about
 *     to download a single file or a bundle.
 */

import { useId, useMemo, type JSX } from "react";

export interface CustomerDownloadsBarProps {
  jobId: string;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

const BUTTON_CLASS = `inline-flex w-fit cursor-pointer items-center gap-1.5 rounded border border-[#4eba87]/40 bg-emerald-950/20 px-3 py-1 text-[11px] font-medium text-[#4eba87] no-underline transition hover:bg-emerald-950/40 ${FOCUS_RING_CLASS}`;

export function CustomerDownloadsBar({
  jobId,
}: CustomerDownloadsBarProps): JSX.Element {
  const safeId = useMemo(() => buildSafeJobIdSlug(jobId), [jobId]);
  const markdownUrl = useMemo(
    () =>
      `/workspace/test-intelligence/jobs/${encodeURIComponent(jobId)}/customer-markdown`,
    [jobId],
  );
  const zipUrl = useMemo(
    () =>
      `/workspace/test-intelligence/jobs/${encodeURIComponent(jobId)}/customer-markdown.zip`,
    [jobId],
  );
  const markdownDescId = useId();
  const zipDescId = useId();

  return (
    <div
      data-testid="ti-customer-downloads-bar"
      className="flex flex-wrap items-center gap-2"
    >
      <a
        data-testid="ti-customer-downloads-bar-markdown"
        href={markdownUrl}
        download={`${safeId}-testfaelle.md`}
        aria-label={`Download combined customer Markdown for job ${jobId}`}
        aria-describedby={markdownDescId}
        className={BUTTON_CLASS}
      >
        <MarkdownIcon />
        Download Markdown
      </a>
      <span id={markdownDescId} className="sr-only">
        Single file: combined testfaelle.md with all generated test cases
      </span>
      <a
        data-testid="ti-customer-downloads-bar-zip"
        href={zipUrl}
        download={`${safeId}-customer-bundle.zip`}
        aria-label={`Download customer artifact ZIP bundle for job ${jobId}`}
        aria-describedby={zipDescId}
        className={BUTTON_CLASS}
      >
        <ZipIcon />
        Download ZIP bundle
      </a>
      <span id={zipDescId} className="sr-only">
        ZIP bundle: combined Markdown, per-case Markdown files, IR JSON,
        manifest, and summary
      </span>
    </div>
  );
}

const buildSafeJobIdSlug = (jobId: string): string => {
  const safe = jobId.replace(/[^A-Za-z0-9_.-]+/gu, "-").slice(0, 64);
  return safe.length > 0 ? safe : "job";
};

function MarkdownIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Zm2.25 2.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0V8.31l1.22 1.22a.75.75 0 0 0 1.06 0l1.22-1.22V9.5a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-1.28-.53L8 7.69 6.28 5.97a.75.75 0 0 0-.53-.22h-1.5Zm7 .75a.75.75 0 0 0-1.5 0v2.19l-.47-.47a.75.75 0 1 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l1.75-1.75a.75.75 0 0 0-1.06-1.06l-.47.47V6.5Z" />
    </svg>
  );
}

function ZipIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12.5 2h-9Zm5 1v1h-1V3h1Zm-1 2h1v1h-1V5Zm1 2v1h-1V7h1Zm-1 2h1v1h-1V9Zm1.5 2.25A.75.75 0 0 0 8.25 11h-.5a.75.75 0 0 0-.75.75v1.25h2v-1.75Z" />
    </svg>
  );
}
