/**
 * Wave 4.I production-readiness fixture loader (Issue #1439).
 *
 * Each Wave 4.I fixture is keyed by id and may contribute up to four
 * physical files under `src/test-intelligence/fixtures/`:
 *
 *   - `<id>.figma.json`              — normalised Figma input (optional).
 *   - `<id>.visual.json`             — visual sidecar batch (optional).
 *   - `<id>.jira-rest-response.json` — synthetic Jira REST `issues` payload.
 *   - `<id>.jira-paste.txt`          — Jira paste body in plain or markdown.
 *   - `<id>.custom-context.json`     — structured custom-context input.
 *   - `<id>.custom-context.md`       — Markdown custom-context input.
 *   - `<id>.envelope.json`           — multi-source envelope (always present).
 *
 * The loader is intentionally side-effect-free: it reads files lazily and
 * returns plain in-memory objects. The envelope file is parsed but is NOT
 * validated here — the harness recomputes the canonical envelope from the
 * actual source artifacts.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { MultiSourceTestIntentEnvelope } from "../contracts/index.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

export type Wave4ProductionReadinessFixtureId =
  | "release-multisource-onboarding"
  | "release-multisource-payment-with-conflict"
  | "release-multisource-paste-only-airgap"
  | "release-multisource-figma-only-regression"
  | "release-multisource-jira-rest-only"
  | "release-multisource-jira-paste-only-airgap"
  | "release-multisource-jira-rest-plus-custom"
  | "release-multisource-figma-plus-jira"
  | "release-multisource-all-sources-with-conflict"
  | "release-multisource-jira-rest-plus-custom-markdown"
  | "release-multisource-figma-plus-jira-plus-custom-markdown"
  | "release-multisource-custom-markdown-adversarial";

export const WAVE4_PRODUCTION_READINESS_FIXTURE_IDS: readonly Wave4ProductionReadinessFixtureId[] =
  [
    "release-multisource-onboarding",
    "release-multisource-payment-with-conflict",
    "release-multisource-paste-only-airgap",
    "release-multisource-figma-only-regression",
    "release-multisource-jira-rest-only",
    "release-multisource-jira-paste-only-airgap",
    "release-multisource-jira-rest-plus-custom",
    "release-multisource-figma-plus-jira",
    "release-multisource-all-sources-with-conflict",
    "release-multisource-jira-rest-plus-custom-markdown",
    "release-multisource-figma-plus-jira-plus-custom-markdown",
    "release-multisource-custom-markdown-adversarial",
  ] as const;

export interface LoadedWave4ProductionReadinessFixture {
  fixtureId: Wave4ProductionReadinessFixtureId;
  envelope: MultiSourceTestIntentEnvelope;
  envelopePath: string;
  figmaJson?: unknown;
  visualJson?: unknown;
  jiraRestResponse?: unknown;
  jiraPasteText?: string;
  customContextJson?: unknown;
  customContextMarkdown?: string;
  figmaPath?: string;
  visualPath?: string;
  jiraRestResponsePath?: string;
  jiraPastePath?: string;
  customContextPath?: string;
}

export const isWave4ProductionReadinessFixtureId = (
  value: unknown,
): value is Wave4ProductionReadinessFixtureId => {
  return (
    typeof value === "string" &&
    (WAVE4_PRODUCTION_READINESS_FIXTURE_IDS as readonly string[]).includes(
      value,
    )
  );
};

interface OptionalFile<TValue> {
  value: TValue;
  path: string;
}

const readOptionalUtf8 = async (
  path: string,
): Promise<OptionalFile<string> | undefined> => {
  try {
    const value = await readFile(path, "utf8");
    return { value, path };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
};

const readOptionalJson = async (
  path: string,
): Promise<OptionalFile<unknown> | undefined> => {
  const file = await readOptionalUtf8(path);
  if (file === undefined) return undefined;
  return { value: JSON.parse(file.value) as unknown, path: file.path };
};

export const loadWave4ProductionReadinessFixture = async (
  fixtureId: Wave4ProductionReadinessFixtureId,
): Promise<LoadedWave4ProductionReadinessFixture> => {
  if (!isWave4ProductionReadinessFixtureId(fixtureId)) {
    throw new RangeError(
      `loadWave4ProductionReadinessFixture: unknown fixtureId "${String(
        fixtureId,
      )}". Allowed: ${WAVE4_PRODUCTION_READINESS_FIXTURE_IDS.join(", ")}.`,
    );
  }

  const envelopePath = join(FIXTURES_DIR, `${fixtureId}.envelope.json`);
  const envelopeRaw = await readFile(envelopePath, "utf8");
  const envelope = JSON.parse(envelopeRaw) as MultiSourceTestIntentEnvelope;

  const figma = await readOptionalJson(
    join(FIXTURES_DIR, `${fixtureId}.figma.json`),
  );
  const visual = await readOptionalJson(
    join(FIXTURES_DIR, `${fixtureId}.visual.json`),
  );
  const jiraRest = await readOptionalJson(
    join(FIXTURES_DIR, `${fixtureId}.jira-rest-response.json`),
  );
  const jiraPaste = await readOptionalUtf8(
    join(FIXTURES_DIR, `${fixtureId}.jira-paste.txt`),
  );
  const customJson = await readOptionalJson(
    join(FIXTURES_DIR, `${fixtureId}.custom-context.json`),
  );
  const customMd = await readOptionalUtf8(
    join(FIXTURES_DIR, `${fixtureId}.custom-context.md`),
  );

  const result: LoadedWave4ProductionReadinessFixture = {
    fixtureId,
    envelope,
    envelopePath,
    ...(figma !== undefined
      ? { figmaJson: figma.value, figmaPath: figma.path }
      : {}),
    ...(visual !== undefined
      ? { visualJson: visual.value, visualPath: visual.path }
      : {}),
    ...(jiraRest !== undefined
      ? {
          jiraRestResponse: jiraRest.value,
          jiraRestResponsePath: jiraRest.path,
        }
      : {}),
    ...(jiraPaste !== undefined
      ? { jiraPasteText: jiraPaste.value, jiraPastePath: jiraPaste.path }
      : {}),
    ...(customJson !== undefined
      ? {
          customContextJson: customJson.value,
          customContextPath: customJson.path,
        }
      : {}),
    ...(customMd !== undefined
      ? {
          customContextMarkdown: customMd.value,
          customContextPath: customMd.path,
        }
      : {}),
  };
  return result;
};
