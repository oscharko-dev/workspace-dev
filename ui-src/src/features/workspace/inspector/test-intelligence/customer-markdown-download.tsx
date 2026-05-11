/**
 * Customer-Markdown download button (Issue #1735).
 *
 * Triggers a browser download of the combined customer-format Markdown
 * (testfaelle.md) for the active test-intelligence job. Hits
 * `GET /workspace/test-intelligence/jobs/:jobId/customer-markdown`,
 * gated server-side by the same TI feature gates as the rest of the
 * inspector.
 *
 * Uses an anchor with `download=` rather than `window.open` so the
 * browser presents the file via Save-As; the URL is server-relative so
 * it inherits the same origin without a CORS preflight.
 */

import { useMemo, type JSX } from "react";

export interface CustomerMarkdownDownloadProps {
  jobId: string;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

export function CustomerMarkdownDownload({
  jobId,
}: CustomerMarkdownDownloadProps): JSX.Element {
  const downloadUrl = useMemo(
    () =>
      `/workspace/test-intelligence/jobs/${encodeURIComponent(jobId)}/customer-markdown`,
    [jobId],
  );
  const filename = useMemo(() => buildSuggestedFilename(jobId), [jobId]);

  return (
    <a
      data-testid="ti-customer-markdown-download"
      href={downloadUrl}
      download={filename}
      aria-label={`Download customer Markdown for job ${jobId}`}
      className={`inline-flex w-fit cursor-pointer items-center gap-1 rounded border border-[#4eba87]/40 bg-emerald-950/20 px-3 py-1 text-[11px] font-medium text-[#4eba87] no-underline transition hover:bg-emerald-950/40 ${FOCUS_RING_CLASS}`}
    >
      Download Markdown
    </a>
  );
}

const buildSuggestedFilename = (jobId: string): string => {
  const safeJobId = jobId.replace(/[^A-Za-z0-9_.-]+/gu, "-").slice(0, 64);
  return `${safeJobId}-testfaelle.md`;
};
