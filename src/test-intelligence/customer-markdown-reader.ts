/**
 * Customer-format Markdown reader (Issue #1733).
 *
 * Resolves the combined `testfaelle.md` for a given test-intelligence job
 * and returns its contents. The path is built deterministically from the
 * artifact root; we additionally re-resolve and assert containment under
 * the root so a maliciously-crafted `jobId` cannot escape via traversal.
 *
 * The route layer further constrains `jobId` via `isSafeJobId`, but
 * defence-in-depth: a rename or refactor that loosens that guard must
 * not be able to read arbitrary files through this helper.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ReadCustomerMarkdownResult =
  | { ok: true; combinedMarkdown: string; combinedPath: string }
  | { ok: false; reason: "not_found" | "path_outside_root" | "io_error" };

const COMBINED_FILENAME = "testfaelle.md";
const CUSTOMER_MARKDOWN_DIR = "customer-markdown";
// The production runner persists each job's customer Markdown under
//   <artifactRoot>/jobs/<jobId>/test-intelligence/customer-markdown/testfaelle.md
// (see src/test-intelligence/production-runner.ts, `artifactDir` at the
// "9. Persist artifacts" step). The reader must mirror that layout exactly,
// otherwise the export route returns 404 even though the file is on disk.
const JOBS_SEGMENT = "jobs";
const TI_SEGMENT = "test-intelligence";

export interface ReadCustomerMarkdownInput {
  /**
   * Absolute path to the test-intelligence artifact root used by the
   * production runner — the same value the runner is invoked with as its
   * `outputRoot`. The runner appends
   * `jobs/<jobId>/test-intelligence/customer-markdown/testfaelle.md`
   * underneath this root; the reader resolves the same suffix.
   */
  artifactRoot: string;
  /** Job id selected by the request layer (already pattern-validated). */
  jobId: string;
}

export const readCustomerMarkdownArtifact = async (
  input: ReadCustomerMarkdownInput,
): Promise<ReadCustomerMarkdownResult> => {
  const resolvedRoot = path.resolve(input.artifactRoot);
  const candidatePath = path.resolve(
    resolvedRoot,
    JOBS_SEGMENT,
    input.jobId,
    TI_SEGMENT,
    CUSTOMER_MARKDOWN_DIR,
    COMBINED_FILENAME,
  );
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!candidatePath.startsWith(rootWithSep)) {
    return { ok: false, reason: "path_outside_root" };
  }

  const probe = await stat(candidatePath).catch(() => null);
  if (probe === null) {
    return { ok: false, reason: "not_found" };
  }
  if (!probe.isFile()) {
    return { ok: false, reason: "not_found" };
  }
  try {
    const body = await readFile(candidatePath, "utf8");
    return { ok: true, combinedMarkdown: body, combinedPath: candidatePath };
  } catch {
    return { ok: false, reason: "io_error" };
  }
};

/** Suggested attachment filename (UTF-8 safe ASCII fallback). */
export const buildCustomerMarkdownAttachmentName = (jobId: string): string => {
  const safeJobId = jobId.replace(/[^A-Za-z0-9_.-]+/gu, "-").slice(0, 64);
  return `${safeJobId}-testfaelle.md`;
};
