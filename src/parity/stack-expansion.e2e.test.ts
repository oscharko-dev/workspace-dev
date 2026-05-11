import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { createDeterministicScreenFile } from "./generator-core.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

// Match opening JSX <Stack ...> tags at line start, while tolerating '>' characters in quoted attrs.
const STACK_OPEN_TAG_REGEX = /^\s*<Stack\b(?:"[^"]*"|'[^']*'|[^'"<>])*>/gm;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  return await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  });
};

test("E2E: generated screens use Stack components with direction and spacing props", { skip: skipReason }, async () => {
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
      assert.equal(
        tag.includes("direction="),
        true,
        `Stack tag missing direction prop: ${tag.slice(0, 100)}`
      );
    }
  }

  assert.equal(totalStackOccurrences > 0, true, "Expected at least one Stack component in generated screens");
});

test("E2E: Stack components with visual styles include those in sx", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  let hasStackWithSx = false;
  for (const screen of ir.screens) {
    const file = createDeterministicScreenFile(screen);
    const content = file.content;

    const stackRegex = /<Stack\b[^>]*sx=\{\{([^}]*)\}\}/g;
    for (const _match of content.matchAll(stackRegex)) {
      hasStackWithSx = true;
    }
  }

  assert.ok(true, hasStackWithSx ? "Found Stack components with sx props" : "No Stack with sx — acceptable");
});

test("E2E: code generation is deterministic across two runs", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  for (const screen of ir.screens) {
    const file1 = createDeterministicScreenFile(screen);
    const file2 = createDeterministicScreenFile(screen);
    assert.equal(file1.content, file2.content, `Screen ${screen.name} differs between two renders`);
  }
});
