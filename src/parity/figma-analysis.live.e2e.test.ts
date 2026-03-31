import assert from "node:assert/strict";
import test from "node:test";
import { cleanFigmaForCodegen } from "../job-engine/figma-clean.js";
import { buildFigmaAnalysis } from "./figma-analysis.js";

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

  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  const raw = (await response.json()) as Parameters<typeof cleanFigmaForCodegen>[0]["file"];
  const cleaned = cleanFigmaForCodegen({ file: raw });
  cachedAnalysis = buildFigmaAnalysis({ file: cleaned.cleanedFile });
  return cachedAnalysis;
}

test("live E2E: figma.analysis captures sample-board structure and signals", { skip: skipReason }, async () => {
  const analysis = await fetchLiveAnalysis();

  assert.equal(analysis.summary.pageCount, 1);
  assert.equal(analysis.summary.sectionCount, 1);
  assert.equal(analysis.summary.localComponentCount, 0);
  assert.equal(analysis.summary.localStyleCount, 0);
  assert.equal(analysis.layoutGraph.sections[0]?.directChildCount, 23);
  assert.equal(analysis.layoutGraph.frames.length >= 5, true);
  assert.equal(analysis.frameVariantGroups.some((group) => group.frameIds.length === 5), true);
  assert.equal(analysis.appShellSignals.length > 0, true);
  assert.equal(analysis.componentDensity.byFrame.length >= 5, true);
  assert.equal(analysis.componentDensity.hotspots.length > 0, true);
  assert.equal(analysis.externalComponents.length >= 149, true);
  assert.equal(analysis.tokenSignals.boundVariableIds.length >= 123, true);
  assert.equal(analysis.tokenSignals.variableModeIds.includes("20708:1"), true);
  assert.equal(analysis.tokenSignals.styleReferences.allStyleIds.length >= 41, true);
  assert.equal(analysis.tokenSignals.styleReferences.localStyleIds.length, 0);
  assert.equal(analysis.tokenSignals.styleReferences.linkedStyleIds.length >= 41, true);
  assert.equal(analysis.diagnostics.some((entry) => entry.code === "MISSING_LOCAL_COMPONENTS"), true);
  assert.equal(analysis.diagnostics.some((entry) => entry.code === "MISSING_LOCAL_STYLES"), true);
});
