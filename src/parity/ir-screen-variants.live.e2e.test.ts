import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanFigmaForCodegen } from "../job-engine/figma-clean.js";
import { buildFigmaAnalysis } from "./figma-analysis.js";
import { resolveEmittedScreenTargets } from "./emitted-screen-targets.js";
import { generateArtifacts } from "./generator-core.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import { applyAppShellsToDesignIr } from "./ir-app-shells.js";
import { applyScreenVariantFamiliesToDesignIr } from "./ir-screen-variants.js";
import { figmaToDesignIrWithOptions } from "./ir.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_FILE_KEY and FIGMA_ACCESS_TOKEN are required for live screen variant E2E tests."
    : undefined;

const TARGET_FAMILY_ID = "id-003-1-fehlermeldungen-5";
const TARGET_CANONICAL_SCREEN_ID = "1:66050";
const TARGET_MEMBER_SCREEN_IDS = ["1:63230", "1:64644", "1:66050", "1:67464", "1:68884"] as const;

type LiveVariantFamily = NonNullable<ReturnType<typeof applyScreenVariantFamiliesToDesignIr>["screenVariantFamilies"]>[number];

type LiveFixtureUnavailableDetails =
  | {
      reason: "missing-frame-documents";
      boardName?: string;
      missingScreenIds: string[];
      expectedScreenIds: readonly string[];
    }
  | {
      reason: "missing-target-family";
      boardName?: string;
      expectedFamilyId: string;
      availableFamilyIds: string[];
    };

class LiveFixtureUnavailableError extends Error {
  public readonly details: LiveFixtureUnavailableDetails;

  public constructor(details: LiveFixtureUnavailableDetails) {
    super("Live fixture unavailable for Issue #704 verification.");
    this.name = "LiveFixtureUnavailableError";
    this.details = details;
  }
}

interface LiveVariantFixtureContext {
  ir: ReturnType<typeof applyScreenVariantFamiliesToDesignIr>;
  emitted: ReturnType<typeof resolveEmittedScreenTargets>;
  family: LiveVariantFamily;
}

type LiveVariantFixtureResolution =
  | {
      kind: "available";
      context: LiveVariantFixtureContext;
    }
  | {
      kind: "unavailable";
      details: LiveFixtureUnavailableDetails;
    };

let cachedContext: Promise<LiveVariantFixtureContext> | undefined;

interface LiveFrameDocumentFetchResult {
  document?: unknown;
  boardName?: string;
}

const isStringLengthOverflowError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Cannot create a string longer");
};

const fetchFrameDocument = async ({
  screenId,
  includeGeometry
}: {
  screenId: string;
  includeGeometry: boolean;
}): Promise<LiveFrameDocumentFetchResult> => {
  const geometryParam = includeGeometry ? "&geometry=paths" : "";
  const response = await fetch(
    `https://api.figma.com/v1/files/${encodeURIComponent(FIGMA_FILE_KEY)}/nodes?ids=${encodeURIComponent(screenId)}${geometryParam}`,
    {
      headers: {
        "X-Figma-Token": FIGMA_ACCESS_TOKEN
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Figma API responded with status ${response.status} for node '${screenId}'.`);
  }

  const payload = (await response.json()) as {
    name?: string;
    nodes?: Record<string, { document?: unknown }>;
  };
  return {
    document: payload.nodes?.[screenId]?.document,
    boardName: typeof payload.name === "string" ? payload.name : undefined
  };
};

const formatLiveFixtureUnavailableMessage = (details: LiveFixtureUnavailableDetails): string => {
  const boardLabel = details.boardName ? `'${details.boardName}'` : `'${FIGMA_FILE_KEY}'`;
  if (details.reason === "missing-frame-documents") {
    const missing = details.missingScreenIds.join(", ");
    return `Live board ${boardLabel} is incompatible with Issue #704 fixture: missing target frame node document(s): ${missing}.`;
  }
  const availableFamilies =
    details.availableFamilyIds.length > 0 ? details.availableFamilyIds.join(", ") : "(none)";
  return `Live board ${boardLabel} is incompatible with Issue #704 fixture: target family '${details.expectedFamilyId}' not found. Available families: ${availableFamilies}.`;
};

const loadLiveVariantFixtureContext = async (): Promise<LiveVariantFixtureResolution> => {
  try {
    return {
      kind: "available",
      context: await fetchLiveVariantFixtureContext()
    };
  } catch (error) {
    if (error instanceof LiveFixtureUnavailableError) {
      return {
        kind: "unavailable",
        details: error.details
      };
    }
    throw error;
  }
};

const fetchLiveVariantFixtureContext = async (): Promise<LiveVariantFixtureContext> => {
  if (cachedContext) {
    return cachedContext;
  }

  cachedContext = (async () => {
    const frames: unknown[] = [];
    const missingScreenIds: string[] = [];
    let boardName: string | undefined;
    for (const screenId of TARGET_MEMBER_SCREEN_IDS) {
      let frameDocument: unknown | undefined;
      try {
        const responseWithGeometry = await fetchFrameDocument({
          screenId,
          includeGeometry: true
        });
        boardName ??= responseWithGeometry.boardName;
        frameDocument = responseWithGeometry.document;
      } catch (error) {
        if (!isStringLengthOverflowError(error)) {
          throw error;
        }
      }

      if (!frameDocument) {
        const responseWithoutGeometry = await fetchFrameDocument({
          screenId,
          includeGeometry: false
        });
        boardName ??= responseWithoutGeometry.boardName;
        frameDocument = responseWithoutGeometry.document;
      }

      if (!frameDocument) {
        missingScreenIds.push(screenId);
        continue;
      }
      frames.push(frameDocument);
    }

    if (missingScreenIds.length > 0) {
      throw new LiveFixtureUnavailableError({
        reason: "missing-frame-documents",
        boardName,
        missingScreenIds,
        expectedScreenIds: TARGET_MEMBER_SCREEN_IDS
      });
    }

    const cleaned = cleanFigmaForCodegen({
      file: {
        name: boardName ?? "Issue 704 Live Variant Board",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "ID-003 variants",
              children: frames
            }
          ]
        }
      } as Parameters<typeof cleanFigmaForCodegen>[0]["file"]
    });
    const figmaAnalysis = buildFigmaAnalysis({ file: cleaned.cleanedFile });
    const baseIr = figmaToDesignIrWithOptions(cleaned.cleanedFile, {
      brandTheme: "derived"
    });
    const irWithAppShells = applyAppShellsToDesignIr({
      ir: baseIr,
      figmaAnalysis
    });
    const ir = applyScreenVariantFamiliesToDesignIr({
      ir: irWithAppShells,
      figmaAnalysis
    });
    const family = ir.screenVariantFamilies?.find((candidate) => candidate.familyId === TARGET_FAMILY_ID);
    if (!family) {
      throw new LiveFixtureUnavailableError({
        reason: "missing-target-family",
        boardName,
        expectedFamilyId: TARGET_FAMILY_ID,
        availableFamilyIds: (ir.screenVariantFamilies ?? []).map((candidate) => candidate.familyId).sort((left, right) => {
          return left.localeCompare(right);
        })
      });
    }

    return {
      ir,
      emitted: resolveEmittedScreenTargets({ ir }),
      family
    };
  })();

  return cachedContext;
};

const collectGeneratedSnapshot = async ({
  projectDir,
  generatedPaths
}: {
  projectDir: string;
  generatedPaths: readonly string[];
}): Promise<Map<string, string>> => {
  const snapshot = new Map<string, string>();
  for (const relativePath of generatedPaths) {
    snapshot.set(relativePath, await readFile(path.join(projectDir, relativePath), "utf8"));
  }
  return snapshot;
};

test("formatLiveFixtureUnavailableMessage emits a deterministic diagnostic", () => {
  const unavailableMessage = formatLiveFixtureUnavailableMessage({
    reason: "missing-frame-documents",
    boardName: "Simple-Test-Board",
    missingScreenIds: ["1:63230", "1:64644"],
    expectedScreenIds: TARGET_MEMBER_SCREEN_IDS
  });
  assert.equal(unavailableMessage.includes("Simple-Test-Board"), true);
  assert.equal(unavailableMessage.includes("1:63230, 1:64644"), true);
});

test("live E2E: stateful screen variants derive one emitted family target with alias routes", { skip: skipReason }, async () => {
  const resolution = await loadLiveVariantFixtureContext();
  if (resolution.kind === "unavailable") {
    const diagnostic = formatLiveFixtureUnavailableMessage(resolution.details);
    assert.equal(diagnostic.includes("incompatible with Issue #704 fixture"), true);
    return;
  }
  const { family, emitted } = resolution.context;
  assert.equal(family.canonicalScreenId, TARGET_CANONICAL_SCREEN_ID);
  assert.equal(family.memberScreenIds.length, 5);
  assert.equal(family.scenarios.length, 5);

  const familyEmittedTargets = emitted.emittedTargets.filter((target) => family.memberScreenIds.includes(target.emittedScreenId));
  assert.equal(familyEmittedTargets.length, 1);
  assert.equal(familyEmittedTargets[0]?.emittedScreenId, TARGET_CANONICAL_SCREEN_ID);

  const familyRoutes = emitted.routeEntries.filter((entry) => family.memberScreenIds.includes(entry.routeScreenId));
  assert.equal(familyRoutes.length, 5);
  assert.equal(familyRoutes.filter((entry) => entry.initialVariantId !== undefined).length, 4);
});

test("live E2E: stateful screen variant codegen is byte-stable across two runs", { skip: skipReason }, async () => {
  const resolution = await loadLiveVariantFixtureContext();
  if (resolution.kind === "unavailable") {
    const diagnostic = formatLiveFixtureUnavailableMessage(resolution.details);
    assert.equal(diagnostic.includes("incompatible with Issue #704 fixture"), true);
    return;
  }
  const { ir, emitted, family } = resolution.context;

  const canonicalIdentity = emitted.rawIdentitiesByScreenId.get(TARGET_CANONICAL_SCREEN_ID);
  assert.ok(canonicalIdentity, `Missing canonical identity for '${TARGET_CANONICAL_SCREEN_ID}'.`);

  const firstProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-live-variants-run-1-"));
  const secondProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-live-variants-run-2-"));

  const firstResult = await generateArtifacts({
    projectDir: firstProjectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const secondResult = await generateArtifacts({
    projectDir: secondProjectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const firstGeneratedPaths = [...firstResult.generatedPaths].sort((left, right) => left.localeCompare(right));
  const secondGeneratedPaths = [...secondResult.generatedPaths].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(firstGeneratedPaths, secondGeneratedPaths);

  const firstSnapshot = await collectGeneratedSnapshot({
    projectDir: firstProjectDir,
    generatedPaths: firstGeneratedPaths
  });
  const secondSnapshot = await collectGeneratedSnapshot({
    projectDir: secondProjectDir,
    generatedPaths: secondGeneratedPaths
  });

  assert.equal(firstSnapshot.size, secondSnapshot.size);
  for (const generatedPath of firstGeneratedPaths) {
    assert.equal(
      firstSnapshot.get(generatedPath),
      secondSnapshot.get(generatedPath),
      `Generated artifact '${generatedPath}' differs between two live runs.`
    );
  }

  assert.equal(firstResult.generatedPaths.has(canonicalIdentity.filePath), true);
  for (const memberScreenId of family.memberScreenIds) {
    if (memberScreenId === TARGET_CANONICAL_SCREEN_ID) {
      continue;
    }
    const memberIdentity = emitted.rawIdentitiesByScreenId.get(memberScreenId);
    assert.ok(memberIdentity, `Missing member identity for '${memberScreenId}'.`);
    assert.equal(firstResult.generatedPaths.has(memberIdentity.filePath), false);
  }

  const appContent = firstSnapshot.get("src/App.tsx") ?? "";
  assert.equal(appContent.includes(`path="${canonicalIdentity.routePath}"`), true);

  const routeIdentityByScreenId = buildScreenArtifactIdentities(ir.screens);
  for (const scenario of family.scenarios) {
    const routeIdentity = routeIdentityByScreenId.get(scenario.screenId);
    assert.ok(routeIdentity, `Missing route identity for '${scenario.screenId}'.`);
    assert.equal(appContent.includes(`path="${routeIdentity.routePath}"`), true);
    if (scenario.screenId !== TARGET_CANONICAL_SCREEN_ID) {
      assert.equal(appContent.includes(`initialVariantId="${scenario.screenId}"`), true);
    }
  }

  const canonicalScreenContent = firstSnapshot.get(canonicalIdentity.filePath) ?? "";
  assert.equal(canonicalScreenContent.includes("initialVariantId?: string"), true);
  assert.equal(canonicalScreenContent.includes("variantScenarioConfig"), true);
  assert.equal(canonicalScreenContent.includes("renderVariantContent"), true);
});
