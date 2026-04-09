import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import {
  getVisualBenchmarkFixtureRoot,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkManifest,
  toStableJsonString,
  writeVisualBenchmarkManifest,
  writeVisualBenchmarkReference
} from "./visual-benchmark.helpers.js";

// ---------------------------------------------------------------------------
// Approval gate
// ---------------------------------------------------------------------------

const shouldApprove = (): boolean => {
  const raw = process.env.FIGMAPIPE_VISUAL_BENCHMARK_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

// ---------------------------------------------------------------------------
// Placeholder PNG generation
// ---------------------------------------------------------------------------

const createPlaceholderPng = (width: number, height: number): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = 200;
      png.data[idx + 1] = 200;
      png.data[idx + 2] = 200;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

// ---------------------------------------------------------------------------
// Figma API helpers
// ---------------------------------------------------------------------------

const fetchWithRetry = async (
  url: string,
  headers: Record<string, string>,
  maxRetries: number
): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return response;
      }
      if (response.status >= 500 && attempt < maxRetries) {
        process.stdout.write(`  Figma API returned ${response.status}, retrying (${attempt + 1}/${maxRetries})...\n`);
        continue;
      }
      throw new Error(`Figma API request failed: ${response.status} ${response.statusText} — ${url}`);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxRetries) {
        process.stdout.write(`  Fetch error, retrying (${attempt + 1}/${maxRetries})...\n`);
        continue;
      }
    }
  }
  throw lastError;
};

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const updateFixtures = async (): Promise<void> => {
  const figmaFileKey = process.env.FIGMA_FILE_KEY?.trim();
  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  assert.ok(figmaFileKey, "FIGMA_FILE_KEY is required to update visual-benchmark fixtures.");
  assert.ok(figmaAccessToken, "FIGMA_ACCESS_TOKEN is required to update visual-benchmark fixtures.");

  const fixtureRoot = getVisualBenchmarkFixtureRoot();
  const fixtureIds = await listVisualBenchmarkFixtureIds();
  process.stdout.write(`Updating fixtures for ${fixtureIds.length} fixture(s)...\n`);

  const figmaUrl = `https://api.figma.com/v1/files/${encodeURIComponent(figmaFileKey)}?geometry=paths`;
  process.stdout.write(`  Fetching Figma file: ${figmaUrl}\n`);
  const response = await fetchWithRetry(figmaUrl, { "X-Figma-Token": figmaAccessToken }, 3);
  const figmaData = await response.json() as unknown;

  for (const fixtureId of fixtureIds) {
    const manifest = await loadVisualBenchmarkManifest(fixtureId);
    const figmaInputPath = path.join(fixtureRoot, fixtureId, manifest.inputs.figma);
    await mkdir(path.dirname(figmaInputPath), { recursive: true });
    await writeFile(figmaInputPath, toStableJsonString(figmaData), "utf8");
    process.stdout.write(`  Updated ${fixtureId}/inputs/figma.json\n`);
  }

  process.stdout.write("Fixture inputs updated.\n");
};

const updateReferences = async (): Promise<void> => {
  const figmaFileKey = process.env.FIGMA_FILE_KEY?.trim();
  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();

  const fixtureRoot = getVisualBenchmarkFixtureRoot();
  const fixtureIds = await listVisualBenchmarkFixtureIds();
  process.stdout.write(`Updating references for ${fixtureIds.length} fixture(s)...\n`);

  for (const fixtureId of fixtureIds) {
    const manifest = await loadVisualBenchmarkManifest(fixtureId);

    for (const refSpec of manifest.references) {
      const refPath = path.join(fixtureRoot, fixtureId, refSpec.path);
      let buffer: Buffer | undefined;

      if (figmaFileKey && figmaAccessToken) {
        const figmaInput = JSON.parse(
          await readFile(path.join(fixtureRoot, fixtureId, manifest.inputs.figma), "utf8")
        ) as unknown;
        const nodeId = extractFirstFrameNodeId(figmaInput);
        if (nodeId) {
          const imagesUrl = `https://api.figma.com/v1/images/${encodeURIComponent(figmaFileKey)}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`;
          process.stdout.write(`  Fetching reference image: ${imagesUrl}\n`);
          const response = await fetchWithRetry(imagesUrl, { "X-Figma-Token": figmaAccessToken }, 3);
          const imagesResult = (await response.json()) as Record<string, unknown>;
          const images = imagesResult.images as Record<string, string> | undefined;
          const imageUrl = images?.[nodeId];
          if (imageUrl) {
            const imageResponse = await fetchWithRetry(imageUrl, {}, 3);
            buffer = Buffer.from(await imageResponse.arrayBuffer());
          }
        }
      }

      if (!buffer || !isValidPngBuffer(buffer)) {
        process.stdout.write(`  Generating placeholder reference for ${fixtureId}/${refSpec.name}...\n`);
        buffer = createPlaceholderPng(refSpec.viewport.width, refSpec.viewport.height);
      }

      const updatedRefSpec = {
        ...refSpec,
        capturedAt: new Date().toISOString()
      };

      await writeVisualBenchmarkReference(fixtureId, updatedRefSpec, buffer);
      process.stdout.write(`  Updated ${fixtureId}/${refSpec.path}\n`);

      const updatedManifest = {
        ...manifest,
        references: manifest.references.map((ref) =>
          ref.name === refSpec.name ? updatedRefSpec : ref
        )
      };
      await writeVisualBenchmarkManifest(fixtureId, updatedManifest);
    }
  }

  process.stdout.write("References updated.\n");
};

const liveAudit = async (): Promise<void> => {
  const figmaFileKey = process.env.FIGMA_FILE_KEY?.trim();
  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  assert.ok(figmaFileKey, "FIGMA_FILE_KEY is required for live visual-benchmark audit.");
  assert.ok(figmaAccessToken, "FIGMA_ACCESS_TOKEN is required for live visual-benchmark audit.");

  const fixtureIds = await listVisualBenchmarkFixtureIds();
  process.stdout.write(`Running live audit for ${fixtureIds.length} fixture(s)...\n`);

  const figmaUrl = `https://api.figma.com/v1/files/${encodeURIComponent(figmaFileKey)}?geometry=paths`;
  process.stdout.write(`  Fetching current Figma state: ${figmaUrl}\n`);
  const response = await fetchWithRetry(figmaUrl, { "X-Figma-Token": figmaAccessToken }, 3);
  const liveFigmaData = (await response.json()) as Record<string, unknown>;

  const fixtureRoot = getVisualBenchmarkFixtureRoot();

  for (const fixtureId of fixtureIds) {
    const manifest = await loadVisualBenchmarkManifest(fixtureId);
    const frozenFigmaPath = path.join(fixtureRoot, fixtureId, manifest.inputs.figma);
    const frozenFigma = JSON.parse(await readFile(frozenFigmaPath, "utf8")) as Record<string, unknown>;

    const frozenLastModified = frozenFigma.lastModified ?? "(unknown)";
    const liveLastModified = liveFigmaData.lastModified ?? "(unknown)";

    const hasDrift = frozenLastModified !== liveLastModified;
    process.stdout.write(
      `  Fixture '${fixtureId}': frozen=${String(frozenLastModified)}, live=${String(liveLastModified)} — ${hasDrift ? "DRIFT DETECTED" : "no drift"}\n`
    );
  }

  process.stdout.write("Live audit complete.\n");
};

const bootstrapFixtures = async (): Promise<void> => {
  const fixtureRoot = getVisualBenchmarkFixtureRoot();
  const fixtureIds = await listVisualBenchmarkFixtureIds();

  for (const fixtureId of fixtureIds) {
    const manifest = await loadVisualBenchmarkManifest(fixtureId);

    for (const refSpec of manifest.references) {
      const refPath = path.join(fixtureRoot, fixtureId, refSpec.path);
      let needsGeneration = false;
      try {
        const existing = await readFile(refPath);
        if (!isValidPngBuffer(existing)) {
          needsGeneration = true;
        }
      } catch {
        needsGeneration = true;
      }

      if (needsGeneration) {
        process.stdout.write(`  Bootstrapping placeholder: ${fixtureId}/${refSpec.path}\n`);
        const buffer = createPlaceholderPng(refSpec.viewport.width, refSpec.viewport.height);
        await writeVisualBenchmarkReference(fixtureId, refSpec, buffer);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Figma document traversal helper
// ---------------------------------------------------------------------------

const extractFirstFrameNodeId = (figmaData: unknown): string | undefined => {
  if (typeof figmaData !== "object" || figmaData === null) {
    return undefined;
  }
  const doc = (figmaData as Record<string, unknown>).document;
  if (typeof doc !== "object" || doc === null) {
    return undefined;
  }
  const docChildren = (doc as Record<string, unknown>).children;
  if (!Array.isArray(docChildren)) {
    return undefined;
  }
  for (const page of docChildren) {
    if (typeof page !== "object" || page === null) {
      continue;
    }
    const pageChildren = (page as Record<string, unknown>).children;
    if (!Array.isArray(pageChildren)) {
      continue;
    }
    for (const node of pageChildren) {
      if (typeof node !== "object" || node === null) {
        continue;
      }
      const nodeRecord = node as Record<string, unknown>;
      if (nodeRecord.type === "FRAME" && typeof nodeRecord.id === "string") {
        return nodeRecord.id;
      }
    }
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes("--bootstrap")) {
    await bootstrapFixtures();
    return;
  }

  if (!shouldApprove()) {
    throw new Error(
      "Refusing to update visual-benchmark fixtures without FIGMAPIPE_VISUAL_BENCHMARK_APPROVE=true."
    );
  }

  if (args.includes("--update-fixtures")) {
    await updateFixtures();
  } else if (args.includes("--update-references")) {
    await updateReferences();
  } else if (args.includes("--live")) {
    await liveAudit();
  } else {
    throw new Error(
      "Usage: visual-benchmark.update.ts --update-fixtures | --update-references | --live | --bootstrap"
    );
  }
};

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
