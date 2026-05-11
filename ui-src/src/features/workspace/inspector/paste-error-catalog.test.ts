import { describe, expect, it } from "vitest";
import {
  formatErrorDescription,
  getPasteErrorMessage,
  PASTE_ERROR_CATALOG,
  type PasteErrorCode,
} from "./paste-error-catalog";

describe("PASTE_ERROR_CATALOG", () => {
  it("has entries for all known error codes", () => {
    const codes: PasteErrorCode[] = [
      "CLIPBOARD_NOT_FIGMA",
      "MCP_UNAVAILABLE",
      "MCP_RATE_LIMITED",
      "FILE_NOT_FOUND",
      "NODE_NOT_FOUND",
      "AUTH_REQUIRED",
      "TRANSFORM_PARTIAL",
      "CODEGEN_PARTIAL",
      "PAYLOAD_TOO_LARGE",
      "SCHEMA_MISMATCH",
      "STAGE_FAILED",
      "JOB_FAILED",
      "POLL_FAILED",
      "SUBMIT_FAILED",
      "CANCEL_FAILED",
      "MISSING_PREVIEW_URL",
    ];
    for (const code of codes) {
      const entry = PASTE_ERROR_CATALOG[code];
      expect(entry.title.length, `${code} needs a title`).toBeGreaterThan(0);
      expect(
        entry.description.length,
        `${code} needs a description`,
      ).toBeGreaterThan(0);
      expect(entry.action.length, `${code} needs an action`).toBeGreaterThan(0);
      expect(typeof entry.retryable).toBe("boolean");
    }
  });

  it("does not expose raw stack traces or tokens in any message", () => {
    for (const [code, entry] of Object.entries(PASTE_ERROR_CATALOG)) {
      const combined = `${entry.title} ${entry.description} ${entry.action}`;
      expect(combined, `${code} must not contain 'Error:'`).not.toContain(
        "Error:",
      );
      expect(combined, `${code} must not contain stack frames`).not.toMatch(
        /at \w+ \(.*:\d+:\d+\)/,
      );
    }
  });
});

describe("getPasteErrorMessage", () => {
  it("returns the correct entry for known codes", () => {
    expect(getPasteErrorMessage("MCP_UNAVAILABLE").title).toBe(
      "Figma MCP unavailable",
    );
    expect(getPasteErrorMessage("PAYLOAD_TOO_LARGE").retryable).toBe(false);
  });

  it("falls back to STAGE_FAILED for unknown codes", () => {
    const fallback = getPasteErrorMessage("SOME_UNKNOWN_CODE_XYZ");
    expect(fallback).toEqual(PASTE_ERROR_CATALOG.STAGE_FAILED);
  });
});

describe("formatErrorDescription", () => {
  it("replaces template variables", () => {
    const result = formatErrorDescription("{N} of {total} files had errors.", {
      N: 2,
      total: 8,
    });
    expect(result).toBe("2 of 8 files had errors.");
  });

  it("leaves unknown placeholders intact", () => {
    const result = formatErrorDescription("{N} of {total}", { N: 1 });
    expect(result).toBe("1 of {total}");
  });
});
