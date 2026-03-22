/**
 * Unit tests for the Myers diff algorithm and unified diff computation.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/434
 */
import { describe, it, expect } from "vitest";
import { computeUnifiedDiff } from "./diff";

describe("computeUnifiedDiff", () => {
  it("returns identical result when old and new are the same", () => {
    const text = "line 1\nline 2\nline 3";
    const result = computeUnifiedDiff(text, text);

    expect(result.isIdentical).toBe(true);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => l.kind === "context")).toBe(true);
  });

  it("detects a single added line", () => {
    const oldText = "line 1\nline 3";
    const newText = "line 1\nline 2\nline 3";
    const result = computeUnifiedDiff(oldText, newText, -1);

    expect(result.isIdentical).toBe(false);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(0);

    const added = result.lines.filter((l) => l.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]!.content).toBe("line 2");
    expect(added[0]!.oldLineNumber).toBeNull();
    expect(added[0]!.newLineNumber).toBe(2);
  });

  it("detects a single removed line", () => {
    const oldText = "line 1\nline 2\nline 3";
    const newText = "line 1\nline 3";
    const result = computeUnifiedDiff(oldText, newText, -1);

    expect(result.isIdentical).toBe(false);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(1);

    const removed = result.lines.filter((l) => l.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.content).toBe("line 2");
    expect(removed[0]!.oldLineNumber).toBe(2);
    expect(removed[0]!.newLineNumber).toBeNull();
  });

  it("detects a modification (remove + add)", () => {
    const oldText = "line 1\nold line 2\nline 3";
    const newText = "line 1\nnew line 2\nline 3";
    const result = computeUnifiedDiff(oldText, newText, -1);

    expect(result.isIdentical).toBe(false);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(1);

    const removed = result.lines.filter((l) => l.kind === "removed");
    const added = result.lines.filter((l) => l.kind === "added");
    expect(removed[0]!.content).toBe("old line 2");
    expect(added[0]!.content).toBe("new line 2");
  });

  it("handles empty old text (entirely new file)", () => {
    const result = computeUnifiedDiff("", "line 1\nline 2", -1);

    expect(result.isIdentical).toBe(false);
    expect(result.addedCount).toBe(2);
    expect(result.removedCount).toBe(1); // empty string splits to [""], so the empty line is "removed"
    expect(result.lines.filter((l) => l.kind === "added")).toHaveLength(2);
  });

  it("handles empty new text (entirely deleted file)", () => {
    const result = computeUnifiedDiff("line 1\nline 2", "", -1);

    expect(result.isIdentical).toBe(false);
    expect(result.removedCount).toBe(2);
  });

  it("handles both empty", () => {
    const result = computeUnifiedDiff("", "");

    expect(result.isIdentical).toBe(true);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
  });

  it("preserves dual line numbers correctly", () => {
    const oldText = "a\nb\nc";
    const newText = "a\nx\nc";
    const result = computeUnifiedDiff(oldText, newText, -1);

    // Context line "a"
    const contextA = result.lines.find((l) => l.content === "a");
    expect(contextA?.oldLineNumber).toBe(1);
    expect(contextA?.newLineNumber).toBe(1);

    // Removed "b"
    const removedB = result.lines.find((l) => l.content === "b");
    expect(removedB?.kind).toBe("removed");
    expect(removedB?.oldLineNumber).toBe(2);
    expect(removedB?.newLineNumber).toBeNull();

    // Added "x"
    const addedX = result.lines.find((l) => l.content === "x");
    expect(addedX?.kind).toBe("added");
    expect(addedX?.oldLineNumber).toBeNull();
    expect(addedX?.newLineNumber).toBe(2);

    // Context line "c"
    const contextC = result.lines.find((l) => l.content === "c");
    expect(contextC?.oldLineNumber).toBe(3);
    expect(contextC?.newLineNumber).toBe(3);
  });

  it("applies context filtering to hide distant unchanged lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldText = lines.join("\n");
    // Modify line 10 only
    const newLines = [...lines];
    newLines[9] = "CHANGED line 10";
    const newText = newLines.join("\n");

    const result = computeUnifiedDiff(oldText, newText, 2);

    // With context=2, we should see lines 8-12 area (2 before change, change, 2 after)
    // But NOT lines 1-6 or 14-20
    expect(result.lines.length).toBeLessThan(20);
    expect(result.lines.some((l) => l.content === "line 1")).toBe(false);
    expect(result.lines.some((l) => l.content === "line 20")).toBe(false);
    expect(result.lines.some((l) => l.content === "CHANGED line 10")).toBe(true);
  });

  it("shows all lines when context is negative (unlimited)", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldText = lines.join("\n");
    const newLines = [...lines];
    newLines[9] = "CHANGED";
    const newText = newLines.join("\n");

    const result = computeUnifiedDiff(oldText, newText, -1);

    // Should include all 20 lines + 1 removed + 1 added = 21 total
    expect(result.lines.length).toBe(21);
  });

  it("handles multi-hunk diffs with context filtering", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const oldText = lines.join("\n");
    const newLines = [...lines];
    newLines[4] = "CHANGED-5";
    newLines[24] = "CHANGED-25";
    const newText = newLines.join("\n");

    const result = computeUnifiedDiff(oldText, newText, 1);

    // Two separate change areas, each with 1 context line above and below
    // Change at index 4: lines 4,5,6 visible (indices 3,4,5)
    // Change at index 24: lines 24,25,26 visible (indices 23,24,25)
    // Middle lines (8-22) should be hidden
    expect(result.lines.some((l) => l.content === "line 15")).toBe(false);
    expect(result.lines.some((l) => l.content === "CHANGED-5")).toBe(true);
    expect(result.lines.some((l) => l.content === "CHANGED-25")).toBe(true);
  });

  it("returns correct DiffLine structure", () => {
    const result = computeUnifiedDiff("a", "b", -1);

    for (const line of result.lines) {
      expect(line).toHaveProperty("kind");
      expect(line).toHaveProperty("content");
      expect(line).toHaveProperty("oldLineNumber");
      expect(line).toHaveProperty("newLineNumber");
      expect(["context", "added", "removed"]).toContain(line.kind);
    }
  });
});
