import { describe, expect, it } from "vitest";

import { describeFigmaUrlError, parseFigmaUrl } from "./figma-url-parser";

describe("parseFigmaUrl", () => {
  it("extracts the file key from a /design/ URL with node-id", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0/Test-View-03?node-id=0-1&p=f&t=2aQhj61LNs2l99O4-0",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        figmaFileKey: "M7FGS79qLfr3O4OXEYbxy0",
        figmaNodeId: "0:1",
      },
    });
  });

  it("extracts the file key from a legacy /file/ URL", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/file/ABC123def456/My-File",
    );
    expect(result).toEqual({
      ok: true,
      value: { figmaFileKey: "ABC123def456", figmaNodeId: null },
    });
  });

  it("returns null nodeId when the query string omits node-id", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/abc/Title?p=f");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.figmaNodeId).toBeNull();
    }
  });

  it("normalises node-id from dash form to colon form", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/design/abc/Title?node-id=12-345",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.figmaNodeId).toBe("12:345");
    }
  });

  it("accepts the host without the www subdomain", () => {
    const result = parseFigmaUrl("https://figma.com/design/abc/Title");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.figmaFileKey).toBe("abc");
    }
  });

  it("rejects an empty string with reason 'empty'", () => {
    expect(parseFigmaUrl("")).toEqual({ ok: false, reason: "empty" });
    expect(parseFigmaUrl("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects non-https URLs with reason 'not_https'", () => {
    expect(parseFigmaUrl("http://www.figma.com/design/abc/X")).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("rejects non-figma hosts with reason 'wrong_host'", () => {
    expect(parseFigmaUrl("https://evil.example.com/design/abc/X")).toEqual({
      ok: false,
      reason: "wrong_host",
    });
  });

  it("rejects /file/ URLs missing the file key with reason 'malformed'", () => {
    const result = parseFigmaUrl("https://www.figma.com/file/?node-id=1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
    }
  });

  it("rejects unsupported figma routes with reason 'malformed'", () => {
    expect(parseFigmaUrl("https://www.figma.com/community/file/abc")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("trims surrounding whitespace before validation", () => {
    const result = parseFigmaUrl("  https://www.figma.com/design/abc/X  ");
    expect(result.ok).toBe(true);
  });
});

describe("describeFigmaUrlError", () => {
  it("returns a human-readable message for every error reason", () => {
    expect(describeFigmaUrlError("empty")).toContain("Figma URL");
    expect(describeFigmaUrlError("not_https")).toContain("https");
    expect(describeFigmaUrlError("wrong_host")).toContain("figma.com");
    expect(describeFigmaUrlError("missing_file_key")).toContain("file key");
    expect(describeFigmaUrlError("malformed")).toContain("Figma");
  });
});
