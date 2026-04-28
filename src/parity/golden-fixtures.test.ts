import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { WorkspaceRegenerationOverrideEntry } from "../contracts/index.js";
import { cleanFigmaForCodegen } from "../job-engine/figma-clean.js";
import { ROCKET_PIPELINE_DEFINITION } from "../job-engine/pipeline/pipeline-selection.js";
import { applyIrOverrides } from "../job-engine/ir-overrides.js";
import { buildFigmaAnalysis } from "./figma-analysis.js";
import { generateArtifacts } from "./generator-core.js";
import { applyAppShellsToDesignIr } from "./ir-app-shells.js";
import { applyScreenVariantFamiliesToDesignIr } from "./ir-screen-variants.js";
import { figmaToDesignIrWithOptions } from "./ir.js";

interface GoldenArtifactSpec {
  name: string;
  kind: "json" | "text";
  actual: string;
  expected: string;
}

interface GoldenFixtureSpec {
  id: string;
  figmaJson: string;
  irOverridesFile?: string;
  artifacts: GoldenArtifactSpec[];
}

interface GoldenFixtureManifest {
  version: number;
  pipelineId: "rocket";
  fixtures: GoldenFixtureSpec[];
}

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = path.resolve(MODULE_DIR, "fixtures", "golden");
const MANIFEST_FILE = path.join(GOLDEN_ROOT, "manifest.json");

const normalizeText = (value: string): string => {
  return `${value.replace(/\r\n/g, "\n").trimEnd()}\n`;
};

const normalizeJson = (value: string): string => {
  return `${JSON.stringify(JSON.parse(value), null, 2)}\n`;
};

const normalizeArtifactContent = ({ kind, value }: { kind: GoldenArtifactSpec["kind"]; value: string }): string => {
  return kind === "json" ? normalizeJson(value) : normalizeText(value);
};

const shouldApproveGolden = (): boolean => {
  const raw = process.env.FIGMAPIPE_GOLDEN_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

const isCiRuntime = (): boolean => {
  const raw = process.env.CI?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw !== "0" && raw !== "false";
};

const loadManifest = async (): Promise<GoldenFixtureManifest> => {
  const payload = JSON.parse(await readFile(MANIFEST_FILE, "utf8")) as Partial<GoldenFixtureManifest>;
  assert.equal(payload.version, 1, "Unsupported golden fixture manifest version.");
  assert.equal(payload.pipelineId, ROCKET_PIPELINE_DEFINITION.id, "Golden fixtures must be owned by the rocket pipeline.");
  assert.equal(Array.isArray(payload.fixtures), true, "Manifest must contain fixtures[].");
  return payload as GoldenFixtureManifest;
};

const loadIrOverrides = async ({ fixture }: { fixture: GoldenFixtureSpec }): Promise<WorkspaceRegenerationOverrideEntry[]> => {
  if (!fixture.irOverridesFile) {
    return [];
  }

  const overridesPath = path.join(GOLDEN_ROOT, fixture.irOverridesFile);
  const payload = JSON.parse(await readFile(overridesPath, "utf8")) as unknown;
  assert.equal(Array.isArray(payload), true, `Fixture '${fixture.id}' overrides must be an array.`);
  return payload as WorkspaceRegenerationOverrideEntry[];
};

const listFiles = async ({ root }: { root: string }): Promise<string[]> => {
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
        continue;
      }
      result.push(path.relative(root, entryPath).replace(/\\/g, "/"));
    }
  }

  return result.sort((left, right) => left.localeCompare(right));
};

const assertActualFileExists = async ({
  fixtureId,
  artifact,
  projectDir,
  absolutePath
}: {
  fixtureId: string;
  artifact: GoldenArtifactSpec;
  projectDir: string;
  absolutePath: string;
}): Promise<void> => {
  try {
    await readFile(absolutePath, "utf8");
  } catch {
    const available = await listFiles({ root: projectDir });
    assert.fail(
      `Missing generated artifact for fixture '${fixtureId}': '${artifact.actual}'. Available files: ${available.join(", ") || "(none)"}`
    );
  }
};

const generateFixtureArtifacts = async ({
  fixture,
  ir,
  figmaAnalysis
}: {
  fixture: GoldenFixtureSpec;
  ir: ReturnType<typeof figmaToDesignIrWithOptions>;
  figmaAnalysis: ReturnType<typeof buildFigmaAnalysis>;
}): Promise<string> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-golden-${fixture.id}-`));
  await generateArtifacts({
    projectDir,
    ir,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });
  const actualDesignIrPath = path.join(projectDir, "design-ir.json");
  const actualFigmaAnalysisPath = path.join(projectDir, "figma-analysis.json");
  await writeFile(actualDesignIrPath, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  await writeFile(actualFigmaAnalysisPath, `${JSON.stringify(figmaAnalysis, null, 2)}\n`, "utf8");
  return projectDir;
};

test("golden fixtures: figma json to generated app artifacts", async (t) => {
  const approveMode = shouldApproveGolden();
  if (approveMode && isCiRuntime()) {
    assert.fail("FIGMAPIPE_GOLDEN_APPROVE cannot be enabled in CI.");
  }

  const manifest = await loadManifest();
  assert.equal(manifest.pipelineId, "rocket");
  assert.equal(ROCKET_PIPELINE_DEFINITION.template.bundleId, "react-mui-app");
  assert.equal(ROCKET_PIPELINE_DEFINITION.template.stack.styling, "mui");

  for (const fixture of manifest.fixtures) {
    await t.test(`rocket fixture ${fixture.id}`, async () => {
      const figmaJsonPath = path.join(GOLDEN_ROOT, fixture.figmaJson);
      const figmaPayload = JSON.parse(await readFile(figmaJsonPath, "utf8"));

      const cleaned = cleanFigmaForCodegen({
        file: figmaPayload
      });

      const baseIr = figmaToDesignIrWithOptions(cleaned.cleanedFile, {
        brandTheme: "derived"
      });
      const overrides = await loadIrOverrides({ fixture });
      const irWithOverrides =
        overrides.length > 0
          ? applyIrOverrides({
              ir: baseIr,
              overrides
            }).ir
          : baseIr;
      const figmaAnalysis = buildFigmaAnalysis({ file: cleaned.cleanedFile });
      const irWithAppShells = applyAppShellsToDesignIr({
        ir: irWithOverrides,
        figmaAnalysis
      });
      const ir = applyScreenVariantFamiliesToDesignIr({
        ir: irWithAppShells,
        figmaAnalysis
      });

      const firstProjectDir = await generateFixtureArtifacts({
        fixture,
        ir,
        figmaAnalysis
      });
      const secondProjectDir = await generateFixtureArtifacts({
        fixture,
        ir,
        figmaAnalysis
      });

      for (const artifact of fixture.artifacts) {
        const actualPath = path.join(firstProjectDir, artifact.actual);
        const secondActualPath = path.join(secondProjectDir, artifact.actual);
        await assertActualFileExists({
          fixtureId: fixture.id,
          artifact,
          projectDir: firstProjectDir,
          absolutePath: actualPath
        });
        await assertActualFileExists({
          fixtureId: fixture.id,
          artifact,
          projectDir: secondProjectDir,
          absolutePath: secondActualPath
        });

        const actualRaw = await readFile(actualPath, "utf8");
        const secondActualRaw = await readFile(secondActualPath, "utf8");
        const normalizedActual = normalizeArtifactContent({
          kind: artifact.kind,
          value: actualRaw
        });
        const normalizedSecondActual = normalizeArtifactContent({
          kind: artifact.kind,
          value: secondActualRaw
        });

        assert.equal(
          normalizedActual,
          normalizedSecondActual,
          `Deterministic rerun mismatch for fixture '${fixture.id}', artifact '${artifact.name}' (${artifact.actual}).`
        );

        if (artifact.actual === "src/App.tsx") {
          assert.equal(normalizedActual.includes("style={{"), false, `Golden App.tsx for fixture '${fixture.id}' still uses inline style.`);
          assert.equal(normalizedActual.includes("onFocus={"), false, `Golden App.tsx for fixture '${fixture.id}' still uses DOM style mutation handlers.`);
          assert.equal(normalizedActual.includes("onBlur={"), false, `Golden App.tsx for fixture '${fixture.id}' still uses DOM style mutation handlers.`);
        }

        const expectedPath = path.join(GOLDEN_ROOT, artifact.expected);

        if (approveMode) {
          await mkdir(path.dirname(expectedPath), { recursive: true });
          await writeFile(expectedPath, normalizedActual, "utf8");
          continue;
        }

        let expectedRaw: string;
        try {
          expectedRaw = await readFile(expectedPath, "utf8");
        } catch {
          assert.fail(
            `Missing expected golden file '${artifact.expected}' for fixture '${fixture.id}'. ` +
              "Run 'pnpm run test:golden:update' to approve snapshots."
          );
        }

        const normalizedExpected = normalizeArtifactContent({
          kind: artifact.kind,
          value: expectedRaw
        });

        assert.equal(
          normalizedActual,
          normalizedExpected,
          `Golden diff for fixture '${fixture.id}', artifact '${artifact.name}' (${artifact.actual}). ` +
            "If intentional, run 'pnpm run test:golden:update'."
        );
      }
    });
  }
});
