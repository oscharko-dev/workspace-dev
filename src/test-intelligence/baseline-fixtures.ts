/**
 * MA-0 baseline archetype fixture loader (Issue #1762).
 *
 * The MA-0 baseline suite covers the 7 mask archetypes a production
 * Figma-to-test-intelligence run is expected to handle. Each archetype
 * is fully synthetic, hand-validated, and reproducible across runs so
 * later waves (MA-1 .. MA-5) can `diff` their eval results against
 * this baseline.
 *
 * On-disk layout under `src/test-intelligence/fixtures/`:
 *
 *   - `<archetypeId>.figma.json`             — required Figma input.
 *   - `<archetypeId>.jira.json`              — optional Jira context.
 *   - `<archetypeId>.custom.md`              — optional customer markdown.
 *   - `<archetypeId>.expected.summary.json`  — hand-curated summary snapshot.
 *
 * The companion test (`baseline-fixtures.test.ts`) asserts that loading
 * each archetype's Figma input through `deriveBusinessTestIntentIr`
 * produces counts that match the snapshot.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { IntentDerivationFigmaInput } from "./intent-derivation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

/**
 * Frozen list of the seven archetype fixture ids covered by the
 * MA-0 baseline suite. The order is the canonical archetype order
 * documented in Issue #1762 / Story #1754.
 */
export const BASELINE_ARCHETYPE_FIXTURE_IDS = [
  "baseline-simple-form",
  "baseline-calculation",
  "baseline-optional-fields",
  "baseline-multi-context",
  "baseline-ambiguous-rules",
  "baseline-complex-mask",
  "baseline-validation-heavy",
] as const;

export type BaselineArchetypeFixtureId =
  (typeof BASELINE_ARCHETYPE_FIXTURE_IDS)[number];

/**
 * Counts derivable from the Figma input alone — these mirror the
 * shape of `BusinessTestIntentIr` after `deriveBusinessTestIntentIr`
 * runs over the fixture, and are the canonical metric surface
 * the MA-0 baseline pins.
 */
export interface BaselineArchetypeFigmaCounts {
  screenCount: number;
  nodeCount: number;
  fieldNodeCount: number;
  actionNodeCount: number;
  validationCount: number;
  navigationCount: number;
}

/**
 * Indicators describing which optional auxiliary sources are
 * checked-in alongside the Figma input.
 */
export interface BaselineArchetypeSources {
  hasJira: boolean;
  hasCustomMarkdown: boolean;
}

/**
 * Hand-curated snapshot persisted as `<archetypeId>.expected.summary.json`
 * for every archetype. The `figma.*Count` numbers are byte-stable and
 * are asserted by `baseline-fixtures.test.ts`.
 */
export interface BaselineArchetypeSummary {
  schemaVersion: "1.0.0";
  archetypeId: BaselineArchetypeFixtureId;
  archetype: string;
  intent: string;
  figma: BaselineArchetypeFigmaCounts;
  sources: BaselineArchetypeSources;
  expectedOpenQuestionsKeywords: string[];
  notes: string;
}

export interface LoadedBaselineArchetypeFixture {
  archetypeId: BaselineArchetypeFixtureId;
  figma: IntentDerivationFigmaInput;
  figmaPath: string;
  jira?: unknown;
  jiraPath?: string;
  customMarkdown?: string;
  customMarkdownPath?: string;
  summary: BaselineArchetypeSummary;
  summaryPath: string;
}

export const isBaselineArchetypeFixtureId = (
  value: unknown,
): value is BaselineArchetypeFixtureId => {
  return (
    typeof value === "string" &&
    (BASELINE_ARCHETYPE_FIXTURE_IDS as readonly string[]).includes(value)
  );
};

const baselinePath = (
  archetypeId: BaselineArchetypeFixtureId,
  suffix: string,
): string => join(FIXTURES_DIR, `${archetypeId}.${suffix}`);

const tryReadOptional = async (
  path: string,
): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (
      typeof err !== "object" ||
      err === null ||
      (err as { code?: string }).code !== "ENOENT"
    ) {
      throw err;
    }
    return undefined;
  }
};

/**
 * Load a baseline archetype fixture into the shapes the test suite
 * consumes. The Figma input and the expected-summary snapshot are
 * mandatory; `jira.json` and `custom.md` are surfaced when present
 * and are otherwise omitted.
 */
export const loadBaselineArchetypeFixture = async (
  archetypeId: BaselineArchetypeFixtureId,
): Promise<LoadedBaselineArchetypeFixture> => {
  if (!isBaselineArchetypeFixtureId(archetypeId)) {
    throw new RangeError(
      `loadBaselineArchetypeFixture: unknown archetypeId "${String(
        archetypeId,
      )}". Allowed: ${BASELINE_ARCHETYPE_FIXTURE_IDS.join(", ")}.`,
    );
  }
  const figmaPath = baselinePath(archetypeId, "figma.json");
  const summaryPath = baselinePath(archetypeId, "expected.summary.json");
  const jiraPath = baselinePath(archetypeId, "jira.json");
  const customMarkdownPath = baselinePath(archetypeId, "custom.md");

  const [figmaRaw, summaryRaw, jiraRaw, customMarkdown] = await Promise.all([
    readFile(figmaPath, "utf8"),
    readFile(summaryPath, "utf8"),
    tryReadOptional(jiraPath),
    tryReadOptional(customMarkdownPath),
  ]);

  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const summary = JSON.parse(summaryRaw) as BaselineArchetypeSummary;

  const result: LoadedBaselineArchetypeFixture = {
    archetypeId,
    figma,
    figmaPath,
    summary,
    summaryPath,
  };
  if (jiraRaw !== undefined) {
    result.jira = JSON.parse(jiraRaw);
    result.jiraPath = jiraPath;
  }
  if (customMarkdown !== undefined) {
    result.customMarkdown = customMarkdown;
    result.customMarkdownPath = customMarkdownPath;
  }
  return result;
};
