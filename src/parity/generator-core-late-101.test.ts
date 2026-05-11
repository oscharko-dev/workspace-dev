import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateArtifacts,
  toDeterministicScreenPath,
} from "./generator-core.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const createIr = () => ({
  sourceName: "Demo",
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#00aa55",
      background: "#fafafa",
      text: "#222222",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#2222221f",
      action: {
        active: "#2222228a",
        hover: "#ee00000a",
        selected: "#ee000014",
        disabled: "#22222242",
        disabledBackground: "#2222221f",
        focus: "#ee00001f",
      },
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16,
    }),
  },
  screens: [
    {
      id: "screen-1",
      name: "Übersicht",
      layoutMode: "VERTICAL" as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      children: [
        {
          id: "n1",
          name: "Titel",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Willkommen",
        },
        {
          id: "n2",
          name: "Konto Input",
          nodeType: "FRAME",
          type: "input" as const,
          text: "Kontonummer",
        },
        {
          id: "n3",
          name: "Weiter Button",
          nodeType: "FRAME",
          type: "button" as const,
          text: "Weiter",
        },
      ],
    },
  ],
});

test("deterministic generator: no Tailwind utility classes in screen output (issue #1006)", async () => {
  const projectDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-101-"),
  );
  const ir = createIr();
  const result = await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    },
  });

  const screenContent = await readFile(
    path.join(projectDir, toDeterministicScreenPath("Übersicht")),
    "utf8",
  );

  assert.ok(
    !/className="[a-zA-Z]+-[a-zA-Z0-9-]+"/.test(screenContent),
    "Expected no Tailwind utility className patterns in generated screen.",
  );
  assert.ok(
    !result.generatedPaths.some((generatedPath) =>
      /tailwind\.config/.test(generatedPath),
    ),
    "Expected no tailwind.config file in generated paths.",
  );
  assert.ok(
    screenContent.includes("sx={"),
    "Expected MUI sx={ prop in generated screen.",
  );
});

test("deterministic generator: IR boundary markers present in every screen node (issue #1006)", async () => {
  const projectDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-101-"),
  );
  const ir = createIr();
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    },
  });

  const screenContent = await readFile(
    path.join(projectDir, toDeterministicScreenPath("Übersicht")),
    "utf8",
  );

  assert.ok(
    screenContent.includes('data-ir-id="n1"'),
    "Expected data-ir-id for node n1.",
  );
  assert.ok(
    screenContent.includes('data-ir-id="n2"'),
    "Expected data-ir-id for node n2.",
  );
  assert.ok(
    screenContent.includes('data-ir-id="n3"'),
    "Expected data-ir-id for node n3.",
  );
  assert.ok(
    screenContent.includes("@ir:start"),
    "Expected @ir:start IR boundary block comment.",
  );
  assert.ok(
    screenContent.includes("@ir:end"),
    "Expected @ir:end IR boundary block comment.",
  );
});

test("deterministic generator: storybook_first flag produces same artifact set as default (issue #1006)", async () => {
  const [standardProjectDir, storybookProjectDir] = await Promise.all([
    mkdtemp(path.join(os.tmpdir(), "workspace-dev-101-")),
    mkdtemp(path.join(os.tmpdir(), "workspace-dev-101-")),
  ]);

  const [standardResult, storybookResult] = await Promise.all([
    generateArtifacts({
      projectDir: standardProjectDir,
      ir: createIr(),
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      },
    }),
    generateArtifacts({
      projectDir: storybookProjectDir,
      ir: createIr(),
      customerProfileDesignSystemConfigSource: "storybook_first",
      llmCodegenMode: "deterministic",
      llmModelName: "deterministic",
      onLog: () => {
        // no-op
      },
    }),
  ]);

  const standardPaths = [...standardResult.generatedPaths].sort();
  const storybookPaths = [...storybookResult.generatedPaths].sort();

  assert.equal(
    storybookPaths.length,
    standardPaths.length,
    "Expected storybook_first run to emit same number of artifacts as default run.",
  );
  assert.deepEqual(
    storybookPaths,
    standardPaths,
    "Expected storybook_first run to emit identical artifact path set as default run.",
  );
  assert.equal(
    storybookResult.screenTotal,
    standardResult.screenTotal,
    "Expected storybook_first screenTotal to match default screenTotal.",
  );
});

test("deterministic generator: no bare `any` type in generated screen (issue #1006)", async () => {
  // Generated code must be type-safe — no implicit any escapes.
  const projectDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-101-"),
  );
  const ir = createIr();
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    },
  });

  const screenContent = await readFile(
    path.join(projectDir, toDeterministicScreenPath("Übersicht")),
    "utf8",
  );

  assert.ok(
    !screenContent.includes(": any"),
    "Expected no `: any` type annotations in generated screen.",
  );
  assert.ok(
    !screenContent.includes(" as any"),
    "Expected no `as any` casts in generated screen.",
  );
});
