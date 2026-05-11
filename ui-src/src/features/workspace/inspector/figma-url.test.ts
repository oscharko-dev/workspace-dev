/**
 * Unit tests for the figma-url shared parser.
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/1010
 */
import { describe, expect, it } from "vitest";
import {
  isValidFigmaUrl,
  parseFigmaUrl,
  validateFigmaUrl,
  type FigmaUrlParseResult,
  type FigmaUrlValidationCode,
} from "./figma-url";

const FILE_KEY = "abc123XYZ";
const BRANCH_PARENT = "PARENT_KEY";
const BRANCH_KEY = "BRANCH_KEY";

// ---------------------------------------------------------------------------
// parseFigmaUrl — happy paths (table-driven)
// ---------------------------------------------------------------------------

describe("parseFigmaUrl — valid URLs", () => {
  interface ValidCase {
    readonly name: string;
    readonly url: string;
    readonly expected: FigmaUrlParseResult;
  }

  const cases: readonly ValidCase[] = [
    {
      name: "design URL with node-id=1-2",
      url: `https://figma.com/design/${FILE_KEY}/My-File?node-id=1-2`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "1-2",
        kind: "design",
      },
    },
    {
      name: "design URL with node-id=1:2 (normalized)",
      url: `https://figma.com/design/${FILE_KEY}/My-File?node-id=1:2`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "1-2",
        kind: "design",
      },
    },
    {
      name: "design URL with node-id=1%3A2 (URL-encoded, normalized)",
      url: `https://figma.com/design/${FILE_KEY}/My-File?node-id=1%3A2`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "1-2",
        kind: "design",
      },
    },
    {
      name: "design URL without node-id",
      url: `https://figma.com/design/${FILE_KEY}/My-File`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: null,
        kind: "design",
      },
    },
    {
      name: "legacy file URL",
      url: `https://figma.com/file/${FILE_KEY}/Legacy-File?node-id=10-20`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "10-20",
        kind: "file",
      },
    },
    {
      name: "branch URL — branchKey becomes effective fileKey",
      url: `https://figma.com/design/${BRANCH_PARENT}/branch/${BRANCH_KEY}/Branch-File?node-id=3-4`,
      expected: {
        fileKey: BRANCH_KEY,
        rootFileKey: BRANCH_PARENT,
        branchKey: BRANCH_KEY,
        nodeId: "3-4",
        kind: "branch",
      },
    },
    {
      name: "branch URL without node-id",
      url: `https://figma.com/design/${BRANCH_PARENT}/branch/${BRANCH_KEY}/Branch-File`,
      expected: {
        fileKey: BRANCH_KEY,
        rootFileKey: BRANCH_PARENT,
        branchKey: BRANCH_KEY,
        nodeId: null,
        kind: "branch",
      },
    },
    {
      name: "www.figma.com strips the www. prefix",
      url: `https://www.figma.com/design/${FILE_KEY}/My-File?node-id=1-2`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "1-2",
        kind: "design",
      },
    },
    {
      name: "leading and trailing whitespace is trimmed",
      url: `   https://figma.com/design/${FILE_KEY}/My-File?node-id=1-2   `,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: "1-2",
        kind: "design",
      },
    },
    {
      name: "design URL without filename segment still parses",
      url: `https://figma.com/design/${FILE_KEY}`,
      expected: {
        fileKey: FILE_KEY,
        rootFileKey: FILE_KEY,
        branchKey: null,
        nodeId: null,
        kind: "design",
      },
    },
  ];

  it.each(cases)("parses $name", ({ url, expected }) => {
    expect(parseFigmaUrl(url)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// validateFigmaUrl — failure paths (table-driven)
// ---------------------------------------------------------------------------

describe("validateFigmaUrl — invalid URLs", () => {
  interface InvalidCase {
    readonly name: string;
    readonly url: string;
    readonly code: FigmaUrlValidationCode;
  }

  const cases: readonly InvalidCase[] = [
    { name: "empty string", url: "", code: "EMPTY" },
    { name: "whitespace-only string", url: "    \t\n  ", code: "EMPTY" },
    { name: "garbage non-URL string", url: "hello world", code: "INVALID_URL" },
    {
      name: "wrong host",
      url: "https://example.com/design/abc/Foo",
      code: "WRONG_HOST",
    },
    {
      name: "FigJam URL",
      url: "https://figma.com/board/abc/Some-Board",
      code: "UNSUPPORTED_FIGMA_VARIANT",
    },
    {
      name: "Figma Make URL",
      url: "https://figma.com/make/abc/Some-Make-File",
      code: "UNSUPPORTED_FIGMA_VARIANT",
    },
    {
      name: "Community URL",
      url: "https://figma.com/community/file/123/Community-File",
      code: "UNSUPPORTED_FIGMA_VARIANT",
    },
    {
      name: "Unknown Figma surface kind",
      url: "https://figma.com/proto/abc/Some-Prototype",
      code: "UNSUPPORTED_FIGMA_VARIANT",
    },
    {
      name: "Figma URL with no path",
      url: "https://figma.com/",
      code: "MISSING_FILE_KEY",
    },
    {
      name: "design URL with no file key",
      url: "https://figma.com/design/",
      code: "MISSING_FILE_KEY",
    },
    {
      name: "branch URL with no branch key",
      url: `https://figma.com/design/${BRANCH_PARENT}/branch/`,
      code: "MISSING_FILE_KEY",
    },
  ];

  it.each(cases)("rejects $name with code $code", ({ url, code }) => {
    const result = validateFigmaUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateFigmaUrl — success wrapper shape
// ---------------------------------------------------------------------------

describe("validateFigmaUrl — success result shape", () => {
  it("wraps the parsed result in { ok: true, value }", () => {
    const result = validateFigmaUrl(
      `https://figma.com/design/${FILE_KEY}/My-File?node-id=1-2`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fileKey).toBe(FILE_KEY);
      expect(result.value.kind).toBe("design");
    }
  });

  it("uses the documented user-facing message strings", () => {
    expect(validateFigmaUrl("")).toMatchObject({
      ok: false,
      code: "EMPTY",
      message: "Enter a Figma design URL",
    });
    expect(validateFigmaUrl("hello world")).toMatchObject({
      ok: false,
      code: "INVALID_URL",
      message: "That does not look like a URL",
    });
    expect(
      validateFigmaUrl("https://example.com/design/abc/Foo"),
    ).toMatchObject({
      ok: false,
      code: "WRONG_HOST",
      message: "URL must be on figma.com",
    });
    expect(validateFigmaUrl("https://figma.com/board/abc/Board")).toMatchObject(
      {
        ok: false,
        code: "UNSUPPORTED_FIGMA_VARIANT",
        message: "FigJam, Figma Make, and community files are not supported",
      },
    );
    expect(validateFigmaUrl("https://figma.com/design/")).toMatchObject({
      ok: false,
      code: "MISSING_FILE_KEY",
      message: "URL is missing the file key",
    });
  });
});

// ---------------------------------------------------------------------------
// isValidFigmaUrl
// ---------------------------------------------------------------------------

describe("isValidFigmaUrl", () => {
  const validUrls: readonly string[] = [
    `https://figma.com/design/${FILE_KEY}/My-File?node-id=1-2`,
    `https://figma.com/design/${FILE_KEY}/My-File`,
    `https://figma.com/file/${FILE_KEY}/Legacy`,
    `https://figma.com/design/${BRANCH_PARENT}/branch/${BRANCH_KEY}/Branch`,
    `https://www.figma.com/design/${FILE_KEY}/My-File`,
  ];

  const invalidUrls: readonly string[] = [
    "",
    "   ",
    "hello world",
    "https://example.com/design/abc/Foo",
    "https://figma.com/board/abc/Board",
    "https://figma.com/make/abc/Make",
    "https://figma.com/community/file/123/Community",
    "https://figma.com/",
    "https://figma.com/design/",
  ];

  it.each(validUrls)("returns true for valid URL: %s", (url) => {
    expect(isValidFigmaUrl(url)).toBe(true);
    expect(parseFigmaUrl(url)).not.toBeNull();
  });

  it.each(invalidUrls)("returns false for invalid URL: %s", (url) => {
    expect(isValidFigmaUrl(url)).toBe(false);
    expect(parseFigmaUrl(url)).toBeNull();
  });

  it("agrees with parseFigmaUrl !== null for every case", () => {
    for (const url of [...validUrls, ...invalidUrls]) {
      expect(isValidFigmaUrl(url)).toBe(parseFigmaUrl(url) !== null);
    }
  });
});
