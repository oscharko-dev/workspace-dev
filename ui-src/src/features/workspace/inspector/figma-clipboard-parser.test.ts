import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  extractFigmaNodeId,
  isFigmaClipboard,
  parseFigmaClipboard,
} from "./figma-clipboard-parser";
import type { FigmaMeta } from "./figma-clipboard-parser";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../integration/fixtures/figma-clipboard",
);

function readFixture(name: string): string {
  return readFileSync(path.join(fixtureRoot, name), "utf-8");
}

/** Encode a FigmaMeta object into the base64 figmeta wrapper format. */
function encodeFigmeta(meta: FigmaMeta): string {
  return btoa(JSON.stringify(meta));
}

/**
 * Build a realistic Figma clipboard HTML string.
 * Mirrors the real structure produced by Figma's copy-to-clipboard.
 */
function buildFigmaClipboardHtml(
  options: {
    meta?: FigmaMeta;
    includeBuffer?: boolean;
    visibleText?: string;
  } = {},
): string {
  const meta: FigmaMeta = options.meta ?? {
    fileKey: "abc123XYZ",
    pasteID: 42,
    dataType: "scene",
  };
  const encoded = encodeFigmeta(meta);
  const metadataSpan = `<span data-metadata="<!--(figmeta)${encoded}(/figmeta)-->"></span>`;

  const bufferSpan =
    options.includeBuffer !== false
      ? `<span data-buffer="<!--(figma)ZmlnLi4u(/figma)-->"></span>`
      : "";

  const visible = options.visibleText ?? "Button";

  return [
    `<meta charset="utf-8">`,
    `<div>`,
    `  ${metadataSpan}`,
    `  ${bufferSpan}`,
    `</div>`,
    `<span style="white-space:pre-wrap;">${visible}</span>`,
  ].join("\n");
}

const DEFAULT_HTML = readFixture("scene-copy.html");
const COMPONENT_SET_HTML = readFixture("component-set-copy.html");
const DEFAULT_META: FigmaMeta = {
  fileKey: "abc123XYZ",
  pasteID: 42,
  dataType: "scene",
};

// ---------------------------------------------------------------------------
// isFigmaClipboard
// ---------------------------------------------------------------------------

describe("isFigmaClipboard", () => {
  it("returns true for valid Figma clipboard HTML", () => {
    expect(isFigmaClipboard(DEFAULT_HTML)).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isFigmaClipboard("")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isFigmaClipboard("hello world")).toBe(false);
  });

  it("returns false for non-Figma HTML", () => {
    expect(isFigmaClipboard("<p>Just a paragraph</p>")).toBe(false);
  });

  it("returns false for JSON text", () => {
    expect(isFigmaClipboard('{"document":{"id":"0:0"}}')).toBe(false);
  });

  it("returns false when figmeta only appears in visible text", () => {
    expect(
      isFigmaClipboard('<span style="white-space:pre-wrap;">(figmeta)</span>'),
    ).toBe(false);
  });

  it("returns false when only the buffer marker is present", () => {
    expect(
      isFigmaClipboard(
        '<span data-buffer="<!--(figma)ZmlnLi4u(/figma)-->"></span>',
      ),
    ).toBe(false);
  });

  it("returns true for single-quoted metadata attributes", () => {
    const html =
      "<span data-metadata='<!--(figmeta)eyJmaWxlS2V5IjoiYWJjMTIzWFlaIiwicGFzdGVJRCI6NDIsImRhdGFUeXBlIjoic2NlbmUifQ==(/figmeta)-->'></span>";
    expect(isFigmaClipboard(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseFigmaClipboard — happy path
// ---------------------------------------------------------------------------

describe("parseFigmaClipboard — valid Figma HTML", () => {
  it("extracts meta with all required fields", () => {
    const result = parseFigmaClipboard(DEFAULT_HTML);
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual(DEFAULT_META);
  });

  it("detects buffer presence when data-buffer span exists", () => {
    const result = parseFigmaClipboard(DEFAULT_HTML);
    expect(result!.hasBuffer).toBe(true);
  });

  it("detects buffer absence when data-buffer span is missing", () => {
    const html = buildFigmaClipboardHtml({ includeBuffer: false });
    const result = parseFigmaClipboard(html);
    expect(result).not.toBeNull();
    expect(result!.hasBuffer).toBe(false);
  });

  it("preserves raw HTML in result", () => {
    const result = parseFigmaClipboard(DEFAULT_HTML);
    expect(result!.rawHtml).toBe(DEFAULT_HTML);
  });

  it("handles non-scene dataType", () => {
    const result = parseFigmaClipboard(COMPONENT_SET_HTML);
    expect(result).not.toBeNull();
    expect(result!.meta.dataType).toBe("component_set");
  });

  it("handles fileKey with special characters", () => {
    const meta: FigmaMeta = {
      fileKey: "a1B2c3D4e5F6g7H8",
      pasteID: 999,
      dataType: "scene",
    };
    const html = buildFigmaClipboardHtml({ meta });
    const result = parseFigmaClipboard(html);
    expect(result!.meta.fileKey).toBe("a1B2c3D4e5F6g7H8");
  });

  it("ignores visible text that happens to contain the figma marker", () => {
    const html = `${buildFigmaClipboardHtml({ includeBuffer: false })}<span>(figma)</span>`;
    const result = parseFigmaClipboard(html);
    expect(result).not.toBeNull();
    expect(result!.hasBuffer).toBe(false);
  });

  it("parses single-quoted clipboard HTML when DOMParser is unavailable", () => {
    vi.stubGlobal("DOMParser", undefined);

    try {
      const html = [
        "<meta charset='utf-8'>",
        "<div>",
        "  <span data-metadata='<!--(figmeta)eyJmaWxlS2V5IjoiYWJjMTIzWFlaIiwicGFzdGVJRCI6NDIsImRhdGFUeXBlIjoic2NlbmUifQ==(/figmeta)-->'></span>",
        "  <span data-buffer='<!--(figma)ZmlnLi4uL2J1ZmZlci4uLg==(/figma)-->'></span>",
        "</div>",
      ].join("\n");
      const result = parseFigmaClipboard(html);
      expect(result).not.toBeNull();
      expect(result!.meta).toEqual(DEFAULT_META);
      expect(result!.hasBuffer).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses encoded wrappers when DOMParser is unavailable", () => {
    vi.stubGlobal("DOMParser", undefined);

    try {
      const html = [
        "<span data-metadata=\"&lt;!--(figmeta)eyJmaWxlS2V5IjoiYWJjMTIzWFlaIiwicGFzdGVJRCI6NDIsImRhdGFUeXBlIjoic2NlbmUifQ==(/figmeta)--&gt;\"></span>",
        "<span data-buffer=\"&lt;!--(figma)ZmlnLi4uL2J1ZmZlci4uLg==(/figma)--&gt;\"></span>",
      ].join("\n");
      const result = parseFigmaClipboard(html);
      expect(result).not.toBeNull();
      expect(result!.meta).toEqual(DEFAULT_META);
      expect(result!.hasBuffer).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// parseFigmaClipboard — null / edge cases
// ---------------------------------------------------------------------------

describe("parseFigmaClipboard — returns null for non-Figma content", () => {
  it("empty string", () => {
    expect(parseFigmaClipboard("")).toBeNull();
  });

  it("plain text", () => {
    expect(parseFigmaClipboard("hello")).toBeNull();
  });

  it("non-Figma HTML", () => {
    expect(parseFigmaClipboard("<div>no figma here</div>")).toBeNull();
  });

  it("JSON string", () => {
    expect(parseFigmaClipboard('{"document":{}}')).toBeNull();
  });
});

describe("parseFigmaClipboard — malformed Figma HTML", () => {
  it("figmeta marker present but no data-metadata attribute", () => {
    const html = `<div>(figmeta)<span>no attribute</span></div>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata attribute with invalid wrapper", () => {
    const html = `<span data-metadata="not-a-figmeta-wrapper"></span>(figmeta)`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with invalid base64", () => {
    const html = `<span data-metadata="<!--(figmeta)!!!invalid-base64!!!(/figmeta)-->"></span>(figmeta)`;
    // The "(figmeta)" in the attribute makes isFigmaClipboard true, but decode fails
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with valid base64 but invalid JSON", () => {
    const badBase64 = btoa("this is not json");
    const html = `<span data-metadata="<!--(figmeta)${badBase64}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with valid JSON but missing fileKey", () => {
    const incomplete = btoa(JSON.stringify({ pasteID: 1, dataType: "scene" }));
    const html = `<span data-metadata="<!--(figmeta)${incomplete}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with valid JSON but missing pasteID", () => {
    const incomplete = btoa(
      JSON.stringify({ fileKey: "abc", dataType: "scene" }),
    );
    const html = `<span data-metadata="<!--(figmeta)${incomplete}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with valid JSON but missing dataType", () => {
    const incomplete = btoa(JSON.stringify({ fileKey: "abc", pasteID: 1 }));
    const html = `<span data-metadata="<!--(figmeta)${incomplete}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with empty fileKey", () => {
    const bad = btoa(
      JSON.stringify({ fileKey: "", pasteID: 1, dataType: "scene" }),
    );
    const html = `<span data-metadata="<!--(figmeta)${bad}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with non-number pasteID", () => {
    const bad = btoa(
      JSON.stringify({
        fileKey: "abc",
        pasteID: "not-a-number",
        dataType: "scene",
      }),
    );
    const html = `<span data-metadata="<!--(figmeta)${bad}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with JSON array instead of object", () => {
    const arr = btoa(JSON.stringify([1, 2, 3]));
    const html = `<span data-metadata="<!--(figmeta)${arr}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });

  it("data-metadata with JSON null", () => {
    const n = btoa("null");
    const html = `<span data-metadata="<!--(figmeta)${n}(/figmeta)-->"></span>`;
    expect(parseFigmaClipboard(html)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFigmaNodeId
// ---------------------------------------------------------------------------

describe("extractFigmaNodeId", () => {
  it("returns null for scene payloads without MCP-backed mapping", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: 42,
      dataType: "scene",
    });
    expect(result).toBeNull();
  });

  it("returns null for non-scene dataType", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: 42,
      dataType: "component_set",
    });
    expect(result).toBeNull();
  });

  it("returns null for NaN pasteID", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: NaN,
      dataType: "scene",
    });
    expect(result).toBeNull();
  });

  it("returns null for Infinity pasteID", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: Infinity,
      dataType: "scene",
    });
    expect(result).toBeNull();
  });

  it("handles zero pasteID", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: 0,
      dataType: "scene",
    });
    expect(result).toBeNull();
  });

  it("handles large pasteID", () => {
    const result = extractFigmaNodeId({
      fileKey: "abc",
      pasteID: 999999999,
      dataType: "scene",
    });
    expect(result).toBeNull();
  });
});
