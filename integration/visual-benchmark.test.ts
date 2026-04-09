import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllowedFixturePath,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureBundle,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkManifest,
  loadVisualBenchmarkReference
} from "./visual-benchmark.helpers.js";

test("listVisualBenchmarkFixtureIds returns at least one fixture", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  assert.ok(ids.length > 0, "Expected at least one visual-benchmark fixture.");
  assert.ok(ids.includes("simple-form"), "Expected 'simple-form' fixture to be present.");
});

test("loadVisualBenchmarkManifest validates the simple-form manifest", async () => {
  const manifest = await loadVisualBenchmarkManifest("simple-form");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.fixtureId, "simple-form");
  assert.equal(manifest.inputs.figma, "inputs/figma.json");
  assert.ok(manifest.references.length > 0, "Expected at least one reference spec.");
});

test("loadVisualBenchmarkFixtureInputs reads figma.json for simple-form", async () => {
  const figmaInput = await loadVisualBenchmarkFixtureInputs("simple-form");
  assert.ok(typeof figmaInput === "object" && figmaInput !== null, "Expected figmaInput to be an object.");
  const doc = (figmaInput as Record<string, unknown>).document;
  assert.ok(typeof doc === "object" && doc !== null, "Expected figmaInput.document to be an object.");
  const docRecord = doc as Record<string, unknown>;
  assert.equal(docRecord.type, "DOCUMENT");
});

test("loadVisualBenchmarkReference reads a valid PNG for each reference", async () => {
  const manifest = await loadVisualBenchmarkManifest("simple-form");
  for (const refSpec of manifest.references) {
    const buffer = await loadVisualBenchmarkReference("simple-form", refSpec.name);
    assert.ok(Buffer.isBuffer(buffer), `Expected buffer for reference '${refSpec.name}'.`);
    assert.ok(buffer.length > 0, `Expected non-empty buffer for reference '${refSpec.name}'.`);
    assert.ok(isValidPngBuffer(buffer), `Expected valid PNG for reference '${refSpec.name}'.`);
  }
});

test("loadVisualBenchmarkFixtureBundle loads complete bundle", async () => {
  const bundle = await loadVisualBenchmarkFixtureBundle("simple-form");
  assert.equal(bundle.manifest.fixtureId, "simple-form");
  assert.ok(typeof bundle.figmaInput === "object" && bundle.figmaInput !== null);
  assert.ok(bundle.referenceBuffers.size > 0, "Expected at least one reference buffer.");
  assert.ok(bundle.referenceBuffers.has("desktop"), "Expected 'desktop' reference buffer.");
});

test("manifest references have complete metadata (capturedAt, viewport, captureConfig)", async () => {
  const manifest = await loadVisualBenchmarkManifest("simple-form");
  for (const refSpec of manifest.references) {
    assert.ok(refSpec.capturedAt.length > 0, `Reference '${refSpec.name}' must have capturedAt.`);
    assert.ok(typeof refSpec.viewport.width === "number" && refSpec.viewport.width > 0, `Reference '${refSpec.name}' must have positive viewport width.`);
    assert.ok(typeof refSpec.viewport.height === "number" && refSpec.viewport.height > 0, `Reference '${refSpec.name}' must have positive viewport height.`);
    assert.ok(typeof refSpec.viewport.deviceScaleFactor === "number" && refSpec.viewport.deviceScaleFactor > 0, `Reference '${refSpec.name}' must have positive deviceScaleFactor.`);
    assert.equal(typeof refSpec.captureConfig.waitForNetworkIdle, "boolean");
    assert.equal(typeof refSpec.captureConfig.waitForFonts, "boolean");
    assert.equal(typeof refSpec.captureConfig.waitForAnimations, "boolean");
    assert.equal(typeof refSpec.captureConfig.fullPage, "boolean");
  }
});

test("all reference PNGs start with valid PNG magic bytes", async () => {
  const manifest = await loadVisualBenchmarkManifest("simple-form");
  for (const refSpec of manifest.references) {
    const buffer = await loadVisualBenchmarkReference("simple-form", refSpec.name);
    assert.equal(buffer[0], 0x89, `Expected PNG magic byte 0 for '${refSpec.name}'.`);
    assert.equal(buffer[1], 0x50, `Expected PNG magic byte 1 for '${refSpec.name}'.`);
    assert.equal(buffer[2], 0x4e, `Expected PNG magic byte 2 for '${refSpec.name}'.`);
    assert.equal(buffer[3], 0x47, `Expected PNG magic byte 3 for '${refSpec.name}'.`);
  }
});

test("assertAllowedFixturePath rejects forbidden paths", () => {
  assert.throws(
    () => assertAllowedFixturePath(""),
    { message: "Fixture path must not be empty." }
  );

  assert.throws(
    () => assertAllowedFixturePath("/absolute/path"),
    { message: /must be relative/ }
  );

  assert.throws(
    () => assertAllowedFixturePath("../escape/path"),
    { message: /contains forbidden segment/ }
  );

  assert.throws(
    () => assertAllowedFixturePath("path/with/../traversal"),
    { message: /contains forbidden segment/ }
  );

  assert.throws(
    () => assertAllowedFixturePath("path/to/file.zip"),
    { message: /contains forbidden segment/ }
  );

  assert.throws(
    () => assertAllowedFixturePath("storybook-static/thing"),
    { message: /contains forbidden segment/ }
  );

  const validResult = assertAllowedFixturePath("inputs/figma.json");
  assert.equal(validResult, "inputs/figma.json");
});
