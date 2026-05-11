import assert from "node:assert/strict";
import test from "node:test";
import { cleanFigmaForCodegen } from "../job-engine/figma-clean.js";
import { buildFigmaAnalysis } from "./figma-analysis.js";
import { fetchParityFigmaFileOnce } from "./live-figma-file.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_FILE_KEY and FIGMA_ACCESS_TOKEN are required for live figma.analysis E2E."
    : undefined;

let cachedAnalysis: Awaited<ReturnType<typeof fetchLiveAnalysis>> | undefined;

async function fetchLiveAnalysis() {
  if (cachedAnalysis) {
    return cachedAnalysis;
  }

  const raw = (await fetchParityFigmaFileOnce({
    fileKey: FIGMA_FILE_KEY,
    accessToken: FIGMA_ACCESS_TOKEN
  })) as Parameters<typeof cleanFigmaForCodegen>[0]["file"];
  const cleaned = cleanFigmaForCodegen({ file: raw });
  cachedAnalysis = buildFigmaAnalysis({ file: cleaned.cleanedFile });
  return cachedAnalysis;
}

test("live E2E: figma.analysis captures sample-board structure and signals", { skip: skipReason }, async () => {
  const analysis = await fetchLiveAnalysis();

  assert.equal(analysis.artifactVersion, 1);
  assert.equal(analysis.summary.pageCount, 1);
  assert.equal(analysis.summary.topLevelFrameCount >= 1, true);
  assert.equal(analysis.summary.totalNodeCount > 0, true);
  assert.equal(analysis.summary.totalInstanceCount > 0, true);
  assert.equal(analysis.layoutGraph.frames.length >= 1, true);
  assert.equal(analysis.componentDensity.byFrame.length >= 1, true);
  assert.equal(analysis.componentDensity.hotspots.length > 0, true);
  assert.equal(analysis.externalComponents.length >= 1, true);
  assert.equal(analysis.componentFamilies.length > 0, true);
  assert.equal(analysis.tokenSignals.styleReferences.allStyleIds.length >= 1, true);
  assert.equal(analysis.diagnostics.some((entry) => entry.code === "MISSING_LOCAL_COMPONENTS"), true);
  assert.equal(Array.isArray(analysis.frameVariantGroups), true);
  assert.equal(Array.isArray(analysis.appShellSignals), true);
});
