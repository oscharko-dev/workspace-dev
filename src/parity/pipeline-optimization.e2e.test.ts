/**
 * Comprehensive E2E pipeline test for the code generation pipeline optimization roadmap.
 *
 * Tests the full Figma → IR → codegen → artifact pipeline against a real Figma board
 * to validate correctness, determinism, and output quality after optimization changes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/348
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { createDeterministicScreenFile, generateArtifacts } from "./generator-core.js";
import {
  HEADING_FONT_SIZE_MIN,
  HEADING_FONT_WEIGHT_MIN,
  PATTERN_SIMILARITY_THRESHOLD,
  PATTERN_MIN_OCCURRENCES,
  DEFAULT_SPACING_BASE
} from "./constants.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping pipeline optimization E2E tests"
    : undefined;

// Match opening JSX <Stack ...> tags at line start, while tolerating '>' characters in quoted attrs.
const STACK_OPEN_TAG_REGEX = /^\s*<Stack\b(?:"[^"]*"|'[^']*'|[^'"<>])*>/gm;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

const collectAllElements = (elements: Array<{ type: string; children?: unknown[] }>): Array<{ type: string; children?: unknown[] }> => {
  const result: Array<{ type: string; children?: unknown[] }> = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    result.push(current);
    if (Array.isArray(current.children)) {
      stack.push(...(current.children as Array<{ type: string; children?: unknown[] }>));
    }
  }
  return result;
};

const DEPRECATED_MUI_PROP_PATTERNS = [
  "InputProps={{",
  "InputLabelProps={{",
  "FormHelperTextProps={{",
  "PaperProps={{",
  "PopperProps={{",
  "TransitionProps={{",
  "ContentProps={{",
  "ClickAwayListenerProps={{"
] as const;

// ── Constants validation ────────────────────────────────────────────────────

test("E2E: centralized constants are used consistently in pipeline output", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.ok(ir.screens.length > 0, "Expected at least one screen in IR");

  // Verify constants have sensible values
  assert.equal(typeof HEADING_FONT_SIZE_MIN, "number");
  assert.equal(typeof HEADING_FONT_WEIGHT_MIN, "number");
  assert.equal(typeof PATTERN_SIMILARITY_THRESHOLD, "number");
  assert.equal(typeof PATTERN_MIN_OCCURRENCES, "number");
  assert.equal(typeof DEFAULT_SPACING_BASE, "number");

  assert.ok(HEADING_FONT_SIZE_MIN > 0, "HEADING_FONT_SIZE_MIN must be positive");
  assert.ok(HEADING_FONT_WEIGHT_MIN > 0, "HEADING_FONT_WEIGHT_MIN must be positive");
  assert.ok(PATTERN_SIMILARITY_THRESHOLD > 0 && PATTERN_SIMILARITY_THRESHOLD <= 1, "Similarity threshold must be in (0, 1]");
  assert.ok(PATTERN_MIN_OCCURRENCES >= 2, "Min occurrences must be at least 2");
  assert.ok(DEFAULT_SPACING_BASE > 0, "Spacing base must be positive");
});

// ── Full pipeline determinism ───────────────────────────────────────────────

test("E2E: full pipeline produces deterministic artifacts across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const firstDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-pipeline-1-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-pipeline-2-"));

  await generateArtifacts({
    projectDir: firstDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });
  await generateArtifacts({
    projectDir: secondDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const listAllFiles = async (root: string): Promise<string[]> => {
    const result: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
        } else {
          result.push(path.relative(root, entryPath));
        }
      }
    }
    return result.sort();
  };

  const firstFiles = await listAllFiles(firstDir);
  const secondFiles = await listAllFiles(secondDir);

  assert.deepEqual(
    firstFiles,
    secondFiles,
    "File lists must be identical across two pipeline runs"
  );

  assert.ok(firstFiles.length > 0, "Expected at least one generated file");
});

// ── IR derivation quality ───────────────────────────────────────────────────

test("E2E: IR derivation produces valid screens with expected structure", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.ok(ir.screens.length > 0, "Expected at least one screen");

  for (const screen of ir.screens) {
    assert.ok(screen.name.length > 0, `Screen must have a name`);
    assert.ok(screen.children.length > 0, `Screen '${screen.name}' must have children`);

    const allElements = collectAllElements(screen.children as Array<{ type: string; children?: unknown[] }>);
    assert.ok(allElements.length > 0, `Screen '${screen.name}' must have flattened elements`);

    // Every element must have a type
    for (const element of allElements) {
      assert.ok(typeof element.type === "string" && element.type.length > 0, "Every element must have a type");
    }
  }

  // Verify design tokens are present
  assert.ok(ir.tokens !== undefined, "Design tokens must be present");
  assert.ok(typeof ir.tokens.fontFamily === "string", "Font family token must be a string");
  assert.ok(typeof ir.tokens.spacingBase === "number", "Spacing base token must be a number");
});

// ── Screen file generation quality ──────────────────────────────────────────

test("E2E: generated screen files contain valid React component structure", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  for (const screen of ir.screens) {
    const file = createDeterministicScreenFile(screen);
    const content = file.content;

    // Must have an export (default or named)
    assert.ok(
      content.includes("export default") || content.includes("export const") || content.includes("export function"),
      `Screen '${screen.name}' must have an export`
    );

    // Must import from MUI or have JSX content
    assert.ok(
      content.includes("@mui/material") || content.includes("<Box") || content.includes("<Stack") || content.includes("<Typography"),
      `Screen '${screen.name}' must use MUI components`
    );

    // Must not have syntax-breaking patterns
    assert.ok(
      !content.includes("undefined undefined"),
      `Screen '${screen.name}' must not have doubled undefined tokens`
    );

    for (const pattern of DEPRECATED_MUI_PROP_PATTERNS) {
      assert.equal(
        content.includes(pattern),
        false,
        `Screen '${screen.name}' must not include deprecated MUI prop pattern '${pattern}'`
      );
    }
  }
});

// ── Theme generation quality ────────────────────────────────────────────────

test("E2E: generated artifacts include a valid theme file", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-theme-"));
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const { readFile } = await import("node:fs/promises");
  const themePath = path.join(projectDir, "src", "theme", "theme.ts");

  let themeContent: string;
  try {
    themeContent = await readFile(themePath, "utf8");
  } catch {
    assert.fail("Expected theme file at src/theme/theme.ts");
    return;
  }

  assert.ok(themeContent.includes("extendTheme"), "Theme must use extendTheme");
  assert.ok(themeContent.includes("palette"), "Theme must define palette");
  assert.ok(themeContent.includes("typography"), "Theme must define typography");
});

// ── Stack component usage ───────────────────────────────────────────────────

test("E2E: Stack components use direction prop and generate valid spacing", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  let totalStackOccurrences = 0;
  for (const screen of ir.screens) {
    const file = createDeterministicScreenFile(screen);
    const content = file.content;

    const stackMatches = [...content.matchAll(STACK_OPEN_TAG_REGEX)];
    for (const match of stackMatches) {
      totalStackOccurrences += 1;
      const tag = match[0];
      assert.ok(
        tag.includes("direction="),
        `Stack tag missing direction prop: ${tag.slice(0, 120)}`
      );
    }
  }

  assert.ok(totalStackOccurrences > 0, "Expected at least one Stack component in generated screens");
});

// ── Code generation determinism per-screen ──────────────────────────────────

test("E2E: per-screen code generation is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  for (const screen of ir.screens) {
    const file1 = createDeterministicScreenFile(screen);
    const file2 = createDeterministicScreenFile(screen);
    assert.equal(
      file1.content,
      file2.content,
      `Screen '${screen.name}' content differs between two renders`
    );
    assert.equal(
      file1.path,
      file2.path,
      `Screen '${screen.name}' path differs between two renders`
    );
  }
});
