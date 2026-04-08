import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { comparePngBuffers, comparePngFiles, writeDiffImage } from "./visual-diff.js";

const createSolidPng = (
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 255,
): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
};

const createHalfRedHalfBluePng = (width: number, height: number): Buffer => {
  const png = new PNG({ width, height });
  const halfWidth = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      if (x < halfWidth) {
        png.data[idx] = 255;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 255;
      }
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

test("comparePngBuffers returns 100% similarity for identical images", () => {
  const red = createSolidPng(50, 50, 255, 0, 0);
  const result = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: red,
  });

  assert.equal(result.similarityScore, 100);
  assert.equal(result.diffPixelCount, 0);
  assert.equal(result.totalPixels, 2500);
  assert.equal(result.width, 50);
  assert.equal(result.height, 50);
});

test("comparePngBuffers detects differences between distinct images", () => {
  const red = createSolidPng(50, 50, 255, 0, 0);
  const blue = createSolidPng(50, 50, 0, 0, 255);
  const result = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  assert.ok(result.similarityScore < 10);
  assert.ok(result.diffPixelCount > 0);
  assert.equal(result.totalPixels, 2500);
});

test("comparePngBuffers respects threshold configuration", () => {
  const grayA = createSolidPng(50, 50, 100, 100, 100);
  const grayB = createSolidPng(50, 50, 110, 110, 110);

  const lenientResult = comparePngBuffers({
    referenceBuffer: grayA,
    testBuffer: grayB,
    config: { threshold: 0.5 },
  });

  const strictResult = comparePngBuffers({
    referenceBuffer: grayA,
    testBuffer: grayB,
    config: { threshold: 0.01 },
  });

  assert.equal(lenientResult.diffPixelCount, 0);
  assert.ok(strictResult.diffPixelCount > 0);
});

test("comparePngBuffers rejects invalid diff config values", () => {
  const red = createSolidPng(20, 20, 255, 0, 0);

  assert.throws(
    () =>
      comparePngBuffers({
        referenceBuffer: red,
        testBuffer: red,
        config: { threshold: -0.1 },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /threshold/i);
      return true;
    },
  );

  assert.throws(
    () =>
      comparePngBuffers({
        referenceBuffer: red,
        testBuffer: red,
        config: { alpha: 1.1 },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /alpha/i);
      return true;
    },
  );
});

test("comparePngBuffers throws for dimension mismatch", () => {
  const small = createSolidPng(100, 100, 255, 0, 0);
  const large = createSolidPng(200, 200, 255, 0, 0);

  assert.throws(
    () => comparePngBuffers({ referenceBuffer: small, testBuffer: large }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("100x100"));
      assert.ok(error.message.includes("200x200"));
      return true;
    },
  );
});

test("comparePngBuffers validates regions before diffing", () => {
  const red = createSolidPng(10, 10, 255, 0, 0);

  assert.throws(
    () =>
      comparePngBuffers({
        referenceBuffer: red,
        testBuffer: red,
        regions: [{ name: "zero", x: 0, y: 0, width: 0, height: 5 }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /zero/i);
      return true;
    },
  );

  assert.throws(
    () =>
      comparePngBuffers({
        referenceBuffer: red,
        testBuffer: red,
        regions: [{ name: "oob", x: 9, y: 9, width: 2, height: 2 }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /out of bounds/i);
      return true;
    },
  );
});

test("comparePngBuffers calculates region deviations correctly", () => {
  const halfRedBlue = createHalfRedHalfBluePng(100, 100);
  const allRed = createSolidPng(100, 100, 255, 0, 0);

  const result = comparePngBuffers({
    referenceBuffer: halfRedBlue,
    testBuffer: allRed,
    regions: [
      { name: "left", x: 0, y: 0, width: 50, height: 100 },
      { name: "right", x: 50, y: 0, width: 50, height: 100 },
    ],
  });

  assert.equal(result.regions.length, 2);

  const leftRegion = result.regions.find((r) => r.name === "left");
  const rightRegion = result.regions.find((r) => r.name === "right");

  assert.ok(leftRegion !== undefined);
  assert.ok(rightRegion !== undefined);

  assert.equal(leftRegion.deviationPercent, 0);
  assert.equal(leftRegion.diffPixelCount, 0);

  assert.ok(rightRegion.deviationPercent > 90);
  assert.ok(rightRegion.diffPixelCount > 0);
});

test("comparePngBuffers emits deterministic default regions when omitted", () => {
  const red = createSolidPng(90, 100, 255, 0, 0);
  const result = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: red,
  });

  assert.equal(result.regions.length, 5);
  assert.deepEqual(
    result.regions.map(({ name, x, y, width, height }) => ({
      name,
      x,
      y,
      width,
      height,
    })),
    [
      { name: "header", x: 0, y: 0, width: 90, height: 20 },
      { name: "content-left", x: 0, y: 20, width: 30, height: 60 },
      { name: "content-center", x: 30, y: 20, width: 30, height: 60 },
      { name: "content-right", x: 60, y: 20, width: 30, height: 60 },
      { name: "footer", x: 0, y: 80, width: 90, height: 20 },
    ],
  );
});

test("comparePngBuffers produces valid diff image buffer", () => {
  const red = createSolidPng(80, 60, 255, 0, 0);
  const blue = createSolidPng(80, 60, 0, 0, 255);

  const result = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const decoded = PNG.sync.read(result.diffImageBuffer);
  assert.equal(decoded.width, 80);
  assert.equal(decoded.height, 60);
});

test("comparePngFiles reads files from disk and compares", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visual-diff-files-"));
  const refPath = path.join(tmpDir, "reference.png");
  const testPath = path.join(tmpDir, "test.png");

  await writeFile(refPath, createSolidPng(40, 40, 255, 0, 0));
  await writeFile(testPath, createSolidPng(40, 40, 255, 0, 0));

  const result = await comparePngFiles({
    referencePath: refPath,
    testPath: testPath,
  });

  assert.equal(result.similarityScore, 100);
  assert.equal(result.diffPixelCount, 0);
  assert.equal(result.width, 40);
  assert.equal(result.height, 40);
});

test("writeDiffImage creates parent directories and writes PNG to disk", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visual-diff-write-"));
  const red = createSolidPng(30, 30, 255, 0, 0);
  const blue = createSolidPng(30, 30, 0, 0, 255);

  const result = comparePngBuffers({
    referenceBuffer: red,
    testBuffer: blue,
  });

  const outputPath = path.join(tmpDir, "nested", "diff.png");
  await writeDiffImage({ diffImageBuffer: result.diffImageBuffer, outputPath });

  const fileContents = await readFile(outputPath);
  const decoded = PNG.sync.read(fileContents);
  assert.equal(decoded.width, 30);
  assert.equal(decoded.height, 30);
});
