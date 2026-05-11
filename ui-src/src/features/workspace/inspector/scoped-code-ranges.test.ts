/**
 * Unit tests for scoped code range derivation.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
 */
import { describe, it, expect } from "vitest";
import {
  SNIPPET_CONTEXT_LINES,
  defaultMappedMode,
  deriveScopedCode,
  deriveScopedDiffRanges,
  findManifestRangeByIrNodeId,
  fallbackMode,
  getAvailableModes,
  isModeAvailable,
  modeLabel,
  type ManifestRange
} from "./scoped-code-ranges";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCode(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${String(i + 1)}`).join("\n");
}

// ---------------------------------------------------------------------------
// deriveScopedCode
// ---------------------------------------------------------------------------

describe("deriveScopedCode", () => {
  const code10 = makeCode(10);

  describe("full mode", () => {
    it("returns the entire file with no highlight when no manifest range", () => {
      const result = deriveScopedCode(code10, "full", null);
      expect(result.code).toBe(code10);
      expect(result.highlightRange).toBeNull();
      expect(result.lineOffset).toBe(1);
      expect(result.totalLines).toBe(10);
    });

    it("returns the entire file with no highlight even when manifest range is provided", () => {
      const range: ManifestRange = { startLine: 3, endLine: 5 };
      const result = deriveScopedCode(code10, "full", range);
      expect(result.code).toBe(code10);
      expect(result.highlightRange).toBeNull();
      expect(result.lineOffset).toBe(1);
    });
  });

  describe("focused mode", () => {
    it("returns full file with a highlight range for the manifest region", () => {
      const range: ManifestRange = { startLine: 3, endLine: 5 };
      const result = deriveScopedCode(code10, "focused", range);
      expect(result.code).toBe(code10);
      expect(result.highlightRange).toEqual({ startLine: 3, endLine: 5 });
      expect(result.lineOffset).toBe(1);
      expect(result.totalLines).toBe(10);
    });

    it("falls back to full file with no highlight when unmapped", () => {
      const result = deriveScopedCode(code10, "focused", null);
      expect(result.code).toBe(code10);
      expect(result.highlightRange).toBeNull();
    });
  });

  describe("snippet mode", () => {
    it("returns only the manifest range ± context lines", () => {
      const range: ManifestRange = { startLine: 5, endLine: 7 };
      const result = deriveScopedCode(code10, "snippet", range);

      // Expected: lines 3-9 (5-2 to 7+2)
      const expectedStart = 5 - SNIPPET_CONTEXT_LINES; // 3
      const expectedEnd = 7 + SNIPPET_CONTEXT_LINES;   // 9
      const expectedLines = code10.split("\n").slice(expectedStart - 1, expectedEnd);
      expect(result.code).toBe(expectedLines.join("\n"));
      expect(result.lineOffset).toBe(expectedStart);
      expect(result.totalLines).toBe(expectedEnd - expectedStart + 1);
    });

    it("provides a highlight range relative to the snippet", () => {
      const range: ManifestRange = { startLine: 5, endLine: 7 };
      const result = deriveScopedCode(code10, "snippet", range);

      // The highlight should start at offset within the snippet
      // Snippet starts at line 3, so line 5 is at position 3 within the snippet
      expect(result.highlightRange).toEqual({
        startLine: SNIPPET_CONTEXT_LINES + 1,
        endLine: SNIPPET_CONTEXT_LINES + 3
      });
    });

    it("clamps context lines at file boundaries (start)", () => {
      const range: ManifestRange = { startLine: 1, endLine: 2 };
      const result = deriveScopedCode(code10, "snippet", range);

      // Start should clamp to line 1, end should be 2+2=4
      expect(result.lineOffset).toBe(1);
      const lines = result.code.split("\n");
      expect(lines.length).toBe(4); // lines 1-4
    });

    it("clamps context lines at file boundaries (end)", () => {
      const range: ManifestRange = { startLine: 9, endLine: 10 };
      const result = deriveScopedCode(code10, "snippet", range);

      // Start should be 9-2=7, end should clamp to 10
      expect(result.lineOffset).toBe(7);
      const lines = result.code.split("\n");
      expect(lines.length).toBe(4); // lines 7-10
    });

    it("handles single-line manifest range", () => {
      const range: ManifestRange = { startLine: 5, endLine: 5 };
      const result = deriveScopedCode(code10, "snippet", range);
      expect(result.lineOffset).toBe(3);
      expect(result.highlightRange).toEqual({ startLine: 3, endLine: 3 });
    });

    it("falls back to full file when unmapped", () => {
      const result = deriveScopedCode(code10, "snippet", null);
      expect(result.code).toBe(code10);
      expect(result.highlightRange).toBeNull();
      expect(result.lineOffset).toBe(1);
    });
  });

  describe("boundary clamping", () => {
    it("clamps start line below 1 to 1", () => {
      const range: ManifestRange = { startLine: 0, endLine: 3 };
      const result = deriveScopedCode(code10, "focused", range);
      expect(result.highlightRange?.startLine).toBe(1);
    });

    it("clamps end line above total lines to total lines", () => {
      const range: ManifestRange = { startLine: 8, endLine: 15 };
      const result = deriveScopedCode(code10, "focused", range);
      expect(result.highlightRange?.endLine).toBe(10);
    });
  });
});

describe("findManifestRangeByIrNodeId", () => {
  it("returns the matching start and end lines for a node marker pair", () => {
    const code = [
      "export function Example() {",
      "  return (",
      "    <>",
      "      {/* @ir:start node-a Header FRAME */}",
      "      <Box>Title</Box>",
      "      {/* @ir:end node-a */}",
      "    </>",
      "  );",
      "}"
    ].join("\n");

    expect(findManifestRangeByIrNodeId(code, "node-a")).toEqual({
      startLine: 4,
      endLine: 6
    });
  });

  it("handles nested markers and returns the exact selected node range", () => {
    const code = [
      "{/* @ir:start parent Parent FRAME */}",
      "<Box>",
      "  {/* @ir:start child-a Child A FRAME */}",
      "  <Stack />",
      "  {/* @ir:end child-a */}",
      "  {/* @ir:start child-b Child B FRAME */}",
      "  <Typography>Body</Typography>",
      "  {/* @ir:end child-b */}",
      "</Box>",
      "{/* @ir:end parent */}"
    ].join("\n");

    expect(findManifestRangeByIrNodeId(code, "child-b")).toEqual({
      startLine: 6,
      endLine: 8
    });
  });

  it("returns null when the requested node markers are missing", () => {
    const code = [
      "{/* @ir:start node-a Header FRAME */}",
      "<Box />",
      "{/* @ir:end node-a */}"
    ].join("\n");

    expect(findManifestRangeByIrNodeId(code, "node-missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveScopedDiffRanges
// ---------------------------------------------------------------------------

describe("deriveScopedDiffRanges", () => {
  const currentRange: ManifestRange = { startLine: 10, endLine: 20 };
  const previousRange: ManifestRange = { startLine: 8, endLine: 18 };

  it("returns null ranges in full mode", () => {
    const result = deriveScopedDiffRanges("full", currentRange, previousRange);
    expect(result.oldFocusRange).toBeNull();
    expect(result.newFocusRange).toBeNull();
  });

  it("returns independent ranges in focused mode", () => {
    const result = deriveScopedDiffRanges("focused", currentRange, previousRange);
    expect(result.oldFocusRange).toEqual(previousRange);
    expect(result.newFocusRange).toEqual(currentRange);
  });

  it("returns independent ranges in snippet mode", () => {
    const result = deriveScopedDiffRanges("snippet", currentRange, previousRange);
    expect(result.oldFocusRange).toEqual(previousRange);
    expect(result.newFocusRange).toEqual(currentRange);
  });

  it("handles null previous range", () => {
    const result = deriveScopedDiffRanges("focused", currentRange, null);
    expect(result.oldFocusRange).toBeNull();
    expect(result.newFocusRange).toEqual(currentRange);
  });

  it("handles null current range", () => {
    const result = deriveScopedDiffRanges("focused", null, previousRange);
    expect(result.oldFocusRange).toEqual(previousRange);
    expect(result.newFocusRange).toBeNull();
  });

  it("handles both null ranges", () => {
    const result = deriveScopedDiffRanges("snippet", null, null);
    expect(result.oldFocusRange).toBeNull();
    expect(result.newFocusRange).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mode availability and labels
// ---------------------------------------------------------------------------

describe("isModeAvailable", () => {
  it("all modes available when mapped", () => {
    expect(isModeAvailable("snippet", true)).toBe(true);
    expect(isModeAvailable("focused", true)).toBe(true);
    expect(isModeAvailable("full", true)).toBe(true);
  });

  it("only full mode available when unmapped", () => {
    expect(isModeAvailable("snippet", false)).toBe(false);
    expect(isModeAvailable("focused", false)).toBe(false);
    expect(isModeAvailable("full", false)).toBe(true);
  });
});

describe("getAvailableModes", () => {
  it("returns all three modes when mapped", () => {
    expect(getAvailableModes(true)).toEqual(["snippet", "focused", "full"]);
  });

  it("returns only full when unmapped", () => {
    expect(getAvailableModes(false)).toEqual(["full"]);
  });
});

describe("modeLabel", () => {
  it("returns human-readable labels", () => {
    expect(modeLabel("snippet")).toBe("Snippet");
    expect(modeLabel("focused")).toBe("Focused file");
    expect(modeLabel("full")).toBe("Full file");
  });
});

describe("defaultMappedMode", () => {
  it("returns snippet", () => {
    expect(defaultMappedMode()).toBe("snippet");
  });
});

describe("fallbackMode", () => {
  it("returns full", () => {
    expect(fallbackMode()).toBe("full");
  });
});
