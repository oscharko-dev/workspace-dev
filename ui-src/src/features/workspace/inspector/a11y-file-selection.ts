/**
 * Pure helpers used by the InspectorPanel a11y nudge integration (#993).
 *
 * Splits the "which files do we scan" decision and the "merge fetched
 * contents back into the nudge input shape" mapping out of the React
 * component so they can be unit-tested without a react-query test harness.
 */

export interface A11yScanCandidate {
  path: string;
  sizeBytes: number;
}

export interface A11yScanInput {
  path: string;
  contents?: string;
}

export const A11Y_DEFAULT_FETCH_CAP = 25;
export const A11Y_DEFAULT_SIZE_CAP_BYTES = 1_000_000;

const JSX_LIKE_PATTERN = /\.(tsx|jsx|html|mdx)$/i;

export interface SelectA11yScanFilesOptions {
  fetchCap?: number;
  sizeCapBytes?: number;
}

/**
 * Picks the JSX/TSX/HTML/MDX files that the a11y scanner can usefully
 * inspect, dropping anything past the size and fetch caps. Returns a
 * deterministic prefix of the input order so React-query keys remain
 * stable across renders.
 */
export function selectA11yScanFiles(
  files: readonly A11yScanCandidate[],
  options: SelectA11yScanFilesOptions = {},
): A11yScanCandidate[] {
  const fetchCap = Math.max(0, options.fetchCap ?? A11Y_DEFAULT_FETCH_CAP);
  const sizeCap = Math.max(
    0,
    options.sizeCapBytes ?? A11Y_DEFAULT_SIZE_CAP_BYTES,
  );
  const out: A11yScanCandidate[] = [];
  for (const file of files) {
    if (out.length >= fetchCap) break;
    if (!JSX_LIKE_PATTERN.test(file.path)) continue;
    if (file.sizeBytes > sizeCap) continue;
    out.push({ path: file.path, sizeBytes: file.sizeBytes });
  }
  return out;
}

/**
 * Pairs the selected scan files with their fetched contents (when
 * available) into the shape `deriveA11yNudges` expects. Files whose
 * fetch is still pending or failed are passed through with `contents`
 * omitted so the scanner skips them without false positives.
 */
export function mergeA11yScanInputs(
  scanFiles: readonly A11yScanCandidate[],
  contents: readonly (string | null | undefined)[],
): A11yScanInput[] {
  return scanFiles.map((file, index) => {
    const fetched = contents[index];
    if (typeof fetched === "string" && fetched.length > 0) {
      return { path: file.path, contents: fetched };
    }
    return { path: file.path };
  });
}
