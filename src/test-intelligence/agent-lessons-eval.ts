import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  AGENT_LESSONS_EVAL_REPORT_ARTIFACT_FILENAME,
  AGENT_LESSONS_EVAL_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type Wave1ValidationFixtureId,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  scanLessons,
  selectRelevantLessons,
  writeAgentLesson,
  type AgentLessonType,
} from "./agent-lessons-memdir.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { compilePrompt } from "./prompt-compiler.js";
import { loadWave1ValidationFixture } from "./validation-fixtures.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const AGENT_LESSONS_EVAL_INPUT_PATH = join(
  FIXTURES_DIR,
  "agent-lessons-eval-input.json",
);
const AGENT_LESSONS_EVAL_REPORT_FIXTURE_PATH = join(
  FIXTURES_DIR,
  AGENT_LESSONS_EVAL_REPORT_ARTIFACT_FILENAME,
);

const AGENT_LESSONS_EVAL_INPUT_SCHEMA_VERSION = "1.0.0" as const;
const AGENT_LESSONS_EVAL_MODEL_REVISION =
  "agent-lessons-eval-deterministic-mock" as const;
const AGENT_LESSONS_EVAL_GATEWAY_RELEASE = "agent-lessons-eval-1.0" as const;
const AGENT_LESSONS_EVAL_POLICY_BUNDLE_VERSION =
  "agent-lessons-eval-default" as const;

interface AgentLessonsEvalFixtureInput {
  readonly schemaVersion: typeof AGENT_LESSONS_EVAL_INPUT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly lessons: readonly AgentLessonsEvalFixtureCase[];
}

export interface AgentLessonsEvalFixtureCase {
  readonly lessonId: string;
  readonly fixtureId: Wave1ValidationFixtureId;
  readonly policyProfileId: string;
  readonly query: string;
  readonly expectedPromptTerms: readonly string[];
  readonly lesson: {
    readonly name: string;
    readonly description: string;
    readonly type: AgentLessonType;
    readonly policyProfileScope: readonly string[];
    readonly approvedBy: readonly string[];
    readonly body: string;
  };
}

export interface AgentLessonEvalEntry {
  readonly lessonId: string;
  readonly fixtureId: Wave1ValidationFixtureId;
  readonly policyProfileId: string;
  readonly selected: boolean;
  readonly selectedLessonIds: readonly string[];
  readonly baselineCoverageRate: number;
  readonly candidateCoverageRate: number;
  readonly deltaVsBaseline: number;
  readonly promptHashChanged: boolean;
  readonly expectedPromptTerms: readonly string[];
  readonly pass: boolean;
}

export interface AgentLessonsEvalReport {
  readonly schemaVersion: typeof AGENT_LESSONS_EVAL_REPORT_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly lessons: readonly AgentLessonEvalEntry[];
}

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => isNonEmptyString(item));

const parseInputDocument = (raw: string): AgentLessonsEvalFixtureInput => {
  const parsed = JSON.parse(raw) as Partial<AgentLessonsEvalFixtureInput>;
  if (parsed.schemaVersion !== AGENT_LESSONS_EVAL_INPUT_SCHEMA_VERSION) {
    throw new Error(
      `agent-lessons-eval input schemaVersion must be "${AGENT_LESSONS_EVAL_INPUT_SCHEMA_VERSION}"`,
    );
  }
  if (!Array.isArray(parsed.lessons) || parsed.lessons.length === 0) {
    throw new TypeError(
      "agent-lessons-eval input must define a non-empty lessons array",
    );
  }
  for (const [index, lesson] of parsed.lessons.entries()) {
    const where = `agent-lessons-eval input lessons[${index}]`;
    if (!isRecord(lesson)) {
      throw new TypeError(`${where} must be an object`);
    }
    if (!isNonEmptyString(lesson["lessonId"])) {
      throw new TypeError(`${where}.lessonId must be a non-empty string`);
    }
    if (!isNonEmptyString(lesson["fixtureId"])) {
      throw new TypeError(`${where}.fixtureId must be a non-empty string`);
    }
    if (!isNonEmptyString(lesson["policyProfileId"])) {
      throw new TypeError(`${where}.policyProfileId must be a non-empty string`);
    }
    if (!isNonEmptyString(lesson["query"])) {
      throw new TypeError(`${where}.query must be a non-empty string`);
    }
    if (!isStringArray(lesson["expectedPromptTerms"])) {
      throw new TypeError(
        `${where}.expectedPromptTerms must be a non-empty string array`,
      );
    }
    const lessonPayload = lesson["lesson"];
    if (!isRecord(lessonPayload)) {
      throw new TypeError(`${where}.lesson must be an object`);
    }
    if (!isNonEmptyString(lessonPayload["name"])) {
      throw new TypeError(`${where}.lesson.name must be a non-empty string`);
    }
    if (!isNonEmptyString(lessonPayload["description"])) {
      throw new TypeError(
        `${where}.lesson.description must be a non-empty string`,
      );
    }
    if (!isNonEmptyString(lessonPayload["type"])) {
      throw new TypeError(`${where}.lesson.type must be a non-empty string`);
    }
    if (!isStringArray(lessonPayload["policyProfileScope"])) {
      throw new TypeError(
        `${where}.lesson.policyProfileScope must be a string array`,
      );
    }
    if (!isStringArray(lessonPayload["approvedBy"])) {
      throw new TypeError(`${where}.lesson.approvedBy must be a string array`);
    }
    if (!isNonEmptyString(lessonPayload["body"])) {
      throw new TypeError(`${where}.lesson.body must be a non-empty string`);
    }
  }
  return parsed as AgentLessonsEvalFixtureInput;
};

const loadInputDocument = async (): Promise<AgentLessonsEvalFixtureInput> => {
  const raw = await readFile(AGENT_LESSONS_EVAL_INPUT_PATH, "utf8");
  return parseInputDocument(raw);
};

const computeCoverageRate = (
  prompt: string,
  expectedTerms: readonly string[],
): number => {
  if (expectedTerms.length === 0) {
    return 1;
  }
  const matched = expectedTerms.filter((term) => prompt.includes(term)).length;
  return round6(matched / expectedTerms.length);
};

const buildEvalEntry = async (
  fixtureCase: AgentLessonsEvalFixtureCase,
  generatedAt: string,
): Promise<AgentLessonEvalEntry> => {
  const runDir = await mkdtemp(join(tmpdir(), "agent-lessons-eval-"));
  try {
    const fixture = await loadWave1ValidationFixture(fixtureCase.fixtureId);
    const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
    const commonInput = {
      intent,
      visual: fixture.visual,
      modelBinding: {
        modelRevision: AGENT_LESSONS_EVAL_MODEL_REVISION,
        gatewayRelease: AGENT_LESSONS_EVAL_GATEWAY_RELEASE,
      },
      policyBundleVersion: AGENT_LESSONS_EVAL_POLICY_BUNDLE_VERSION,
      customerRubric: {
        id: fixtureCase.policyProfileId,
        version: "fixture",
        description: `Policy profile ${fixtureCase.policyProfileId}`,
      },
      visualBinding: {
        schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
        selectedDeployment: "mock",
        fallbackReason: "none",
        screenCount: fixture.visual.length,
        ...(fixture.visualImageSha256 !== undefined
          ? { fixtureImageHash: fixture.visualImageSha256 }
          : {}),
      },
    } as const;

    const baseline = compilePrompt({
      jobId: `agent-lessons-baseline-${fixtureCase.lessonId}`,
      ...commonInput,
    });
    const writeResult = await writeAgentLesson({
      runDir,
      id: fixtureCase.lessonId,
      name: fixtureCase.lesson.name,
      description: fixtureCase.lesson.description,
      type: fixtureCase.lesson.type,
      policyProfileScope: fixtureCase.lesson.policyProfileScope,
      approvedBy: fixtureCase.lesson.approvedBy,
      body: fixtureCase.lesson.body,
      nowMs: Date.parse(generatedAt),
    });
    if (!writeResult.ok) {
      throw new Error(
        `agent-lessons-eval: could not persist lesson ${fixtureCase.lessonId}: ${writeResult.code}`,
      );
    }
    const manifest = await scanLessons({
      runDir,
      nowMs: Date.parse(generatedAt),
    });
    const selected = selectRelevantLessons({
      manifest,
      query: {
        tokens: [fixtureCase.query],
        policyProfileId: fixtureCase.policyProfileId,
      },
    });
    const candidate = compilePrompt({
      jobId: `agent-lessons-candidate-${fixtureCase.lessonId}`,
      ...commonInput,
      agentLessons: selected,
    });
    const baselineCoverageRate = computeCoverageRate(
      baseline.request.userPrompt,
      fixtureCase.expectedPromptTerms,
    );
    const candidateCoverageRate = computeCoverageRate(
      candidate.request.userPrompt,
      fixtureCase.expectedPromptTerms,
    );
    const selectedLessonIds = selected.map((lesson) => lesson.frontmatter.id);
    const selectedIncludesTarget = selectedLessonIds.includes(fixtureCase.lessonId);

    return Object.freeze({
      lessonId: fixtureCase.lessonId,
      fixtureId: fixtureCase.fixtureId,
      policyProfileId: fixtureCase.policyProfileId,
      selected: selectedIncludesTarget,
      selectedLessonIds,
      baselineCoverageRate,
      candidateCoverageRate,
      deltaVsBaseline: round6(candidateCoverageRate - baselineCoverageRate),
      promptHashChanged:
        baseline.request.hashes.cacheKey !== candidate.request.hashes.cacheKey,
      expectedPromptTerms: [...fixtureCase.expectedPromptTerms],
      pass:
        selectedIncludesTarget &&
        candidateCoverageRate >= baselineCoverageRate &&
        candidateCoverageRate === 1,
    });
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

export const buildAgentLessonsEvalReport = async (input?: {
  generatedAt?: string;
}): Promise<AgentLessonsEvalReport> => {
  const source = await loadInputDocument();
  const generatedAt = input?.generatedAt ?? source.generatedAt;
  const lessons = await Promise.all(
    [...source.lessons]
      .sort((left, right) => left.lessonId.localeCompare(right.lessonId))
      .map((fixtureCase) => buildEvalEntry(fixtureCase, generatedAt)),
  );
  return Object.freeze({
    schemaVersion: AGENT_LESSONS_EVAL_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    passed: lessons.every((entry) => entry.pass),
    lessons,
  });
};

export const readAgentLessonsEvalReport = async (
  filePath: string = AGENT_LESSONS_EVAL_REPORT_FIXTURE_PATH,
): Promise<AgentLessonsEvalReport> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as AgentLessonsEvalReport;
};

export const writeAgentLessonsEvalReport = async (input: {
  report: AgentLessonsEvalReport;
  outputPath?: string;
}): Promise<string> => {
  const outputPath = input.outputPath ?? AGENT_LESSONS_EVAL_REPORT_FIXTURE_PATH;
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.report), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const agentLessonsEvalInputFixturePath = (): string =>
  AGENT_LESSONS_EVAL_INPUT_PATH;

export const agentLessonsEvalReportFixturePath = (): string =>
  AGENT_LESSONS_EVAL_REPORT_FIXTURE_PATH;
