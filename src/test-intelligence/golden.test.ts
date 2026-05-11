import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION } from "../contracts/index.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";
import type { VisualScreenDescription } from "../contracts/index.js";
import { reconcileSources } from "./reconciliation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

const EXPECTED_PATH = join(
  FIXTURES_DIR,
  "simple-form.expected.business-intent-ir.json",
);

const APPROVE =
  process.env["FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE"] === "1";

// Raw PII substrings that must not appear in the serialized output.
const PII_SUBSTRINGS = [
  "DE89370400440532013000",
  "4111111111111111",
  "max.mustermann@sparkasse.de",
  "+49 221 1234567",
  "Max Mustermann",
  "86095742719",
];

test("golden: simple-form derivation + reconciliation", async () => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];

  const derived = deriveBusinessTestIntentIr({ figma });
  const output = reconcileSources({ figmaIntent: derived, visual });

  const serialized = JSON.stringify(output, null, 2) + "\n";

  if (APPROVE) {
    await writeFile(EXPECTED_PATH, serialized, "utf8");
    return;
  }

  const expectedRaw = await readFile(EXPECTED_PATH, "utf8");
  assert.equal(
    serialized,
    expectedRaw,
    "golden output changed — re-run with FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1 to update",
  );
});

test("golden: version matches schema constant", async () => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];

  const derived = deriveBusinessTestIntentIr({ figma });
  const output = reconcileSources({ figmaIntent: derived, visual });

  assert.equal(output.version, BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION);
});

test("golden: no original PII substrings in serialized output", async () => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];

  const derived = deriveBusinessTestIntentIr({ figma });
  const output = reconcileSources({ figmaIntent: derived, visual });

  const serialized = JSON.stringify(output);
  for (const pii of PII_SUBSTRINGS) {
    assert.equal(
      serialized.includes(pii),
      false,
      `PII substring "${pii}" found in serialized output`,
    );
  }
});

test("golden: all detected elements have trace.nodeId", async () => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];

  const derived = deriveBusinessTestIntentIr({ figma });
  const output = reconcileSources({ figmaIntent: derived, visual });

  const allElements = [
    ...output.detectedFields,
    ...output.detectedActions,
    ...output.detectedValidations,
    ...output.detectedNavigation,
  ];

  for (const el of allElements) {
    assert.equal(
      typeof el.trace.nodeId,
      "string",
      `element ${el.id} missing trace.nodeId`,
    );
  }
});

test("golden: derivation is deterministic (byte-identical on second run)", async () => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];

  const run1 = reconcileSources({
    figmaIntent: deriveBusinessTestIntentIr({ figma }),
    visual,
  });
  const run2 = reconcileSources({
    figmaIntent: deriveBusinessTestIntentIr({ figma }),
    visual,
  });

  assert.equal(
    JSON.stringify(run1),
    JSON.stringify(run2),
    "second derivation produced different output (non-determinism)",
  );
});
