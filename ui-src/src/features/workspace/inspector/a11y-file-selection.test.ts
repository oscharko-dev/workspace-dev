/**
 * Tests for the InspectorPanel a11y file-selection helpers (Issue #993).
 *
 * Covers the filtering, size cap, fetch cap, and content-merge paths that
 * previously lived inline inside InspectorPanel.tsx.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import {
  A11Y_DEFAULT_FETCH_CAP,
  A11Y_DEFAULT_SIZE_CAP_BYTES,
  mergeA11yScanInputs,
  selectA11yScanFiles,
} from "./a11y-file-selection";
import { deriveA11yNudges } from "./a11y-nudge";

describe("selectA11yScanFiles", () => {
  it("keeps only JSX-like extensions and ignores non-source files", () => {
    const result = selectA11yScanFiles([
      { path: "src/Home.tsx", sizeBytes: 200 },
      { path: "src/Home.css", sizeBytes: 200 },
      { path: "src/util.ts", sizeBytes: 200 },
      { path: "src/index.html", sizeBytes: 200 },
      { path: "docs/intro.mdx", sizeBytes: 200 },
      { path: "src/legacy.jsx", sizeBytes: 200 },
      { path: "package.json", sizeBytes: 200 },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "src/Home.tsx",
      "src/index.html",
      "docs/intro.mdx",
      "src/legacy.jsx",
    ]);
  });

  it("drops files larger than the size cap", () => {
    const result = selectA11yScanFiles([
      { path: "small.tsx", sizeBytes: 10 },
      { path: "huge.tsx", sizeBytes: A11Y_DEFAULT_SIZE_CAP_BYTES + 1 },
      { path: "boundary.tsx", sizeBytes: A11Y_DEFAULT_SIZE_CAP_BYTES },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "small.tsx",
      "boundary.tsx",
    ]);
  });

  it("respects the fetch cap and preserves input order", () => {
    const files = Array.from(
      { length: A11Y_DEFAULT_FETCH_CAP + 5 },
      (_, i) => ({
        path: `screens/page-${String(i).padStart(2, "0")}.tsx`,
        sizeBytes: 100,
      }),
    );
    const result = selectA11yScanFiles(files);
    expect(result).toHaveLength(A11Y_DEFAULT_FETCH_CAP);
    expect(result[0]?.path).toBe("screens/page-00.tsx");
    expect(result[result.length - 1]?.path).toBe(
      `screens/page-${String(A11Y_DEFAULT_FETCH_CAP - 1).padStart(2, "0")}.tsx`,
    );
  });

  it("honors custom fetch and size caps from options", () => {
    const result = selectA11yScanFiles(
      [
        { path: "a.tsx", sizeBytes: 50 },
        { path: "b.tsx", sizeBytes: 150 },
        { path: "c.tsx", sizeBytes: 50 },
      ],
      { fetchCap: 1, sizeCapBytes: 100 },
    );
    expect(result).toEqual([{ path: "a.tsx", sizeBytes: 50 }]);
  });

  it("returns an empty list for an empty input", () => {
    expect(selectA11yScanFiles([])).toEqual([]);
  });
});

describe("mergeA11yScanInputs", () => {
  it("attaches contents only when the corresponding fetch resolved", () => {
    const scan = [
      { path: "Home.tsx", sizeBytes: 0 },
      { path: "About.tsx", sizeBytes: 0 },
      { path: "Empty.tsx", sizeBytes: 0 },
      { path: "Pending.tsx", sizeBytes: 0 },
    ];
    const merged = mergeA11yScanInputs(scan, [
      `<img src="x" />`,
      null,
      "",
      undefined,
    ]);
    expect(merged).toEqual([
      { path: "Home.tsx", contents: `<img src="x" />` },
      { path: "About.tsx" },
      { path: "Empty.tsx" },
      { path: "Pending.tsx" },
    ]);
  });

  it("drops trailing contents that have no matching scan entry", () => {
    const merged = mergeA11yScanInputs(
      [{ path: "only.tsx", sizeBytes: 0 }],
      ["<img src='x' />", "extra-not-shown"],
    );
    expect(merged).toEqual([{ path: "only.tsx", contents: "<img src='x' />" }]);
  });
});

describe("a11y file selection feeds deriveA11yNudges end-to-end", () => {
  it("produces nudges only for files that were filtered in and successfully fetched", () => {
    const generated = [
      { path: "src/screens/Home.tsx", sizeBytes: 250 },
      { path: "src/legacy.jsx", sizeBytes: 250 },
      { path: "src/util.ts", sizeBytes: 250 },
      { path: "huge.tsx", sizeBytes: A11Y_DEFAULT_SIZE_CAP_BYTES + 1 },
    ];
    const scan = selectA11yScanFiles(generated);
    expect(scan.map((file) => file.path)).toEqual([
      "src/screens/Home.tsx",
      "src/legacy.jsx",
    ]);

    const fetched = [`<img src="x" />`, null];
    const inputs = mergeA11yScanInputs(scan, fetched);
    const result = deriveA11yNudges({ files: inputs });
    expect(result.summary.byFile).toBe(1);
    expect(
      result.nudges.every((nudge) => nudge.filePath === "src/screens/Home.tsx"),
    ).toBe(true);
    expect(
      result.nudges.some((nudge) => nudge.ruleId === "img-missing-alt"),
    ).toBe(true);
  });
});
