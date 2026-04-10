import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertAllowedFixtureId,
  getVisualBenchmarkFixtureRoot,
  toStableJsonString,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";

const HISTORY_FILE_NAME = "history.json";

export const DEFAULT_VISUAL_BENCHMARK_HISTORY_SIZE = 20;
export const MAX_VISUAL_BENCHMARK_HISTORY_SIZE = 1000;

export interface VisualBenchmarkHistoryScoreEntry {
  fixtureId: string;
  score: number;
}

export interface VisualBenchmarkHistoryEntry {
  runAt: string;
  scores: VisualBenchmarkHistoryScoreEntry[];
}

export interface VisualBenchmarkHistory {
  version: 1;
  entries: VisualBenchmarkHistoryEntry[];
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const resolveVisualBenchmarkHistoryPath = (
  options?: VisualBenchmarkFixtureOptions,
): string => {
  const root = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  return path.join(root, HISTORY_FILE_NAME);
};

export const parseVisualBenchmarkHistory = (
  content: string,
): VisualBenchmarkHistory => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected visual benchmark history to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("Visual benchmark history version must be 1.");
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Visual benchmark history entries must be an array.");
  }

  const entries: VisualBenchmarkHistoryEntry[] = [];
  for (const entry of parsed.entries) {
    if (!isPlainRecord(entry)) {
      throw new Error("Each visual benchmark history entry must be an object.");
    }
    if (typeof entry.runAt !== "string" || entry.runAt.trim().length === 0) {
      throw new Error(
        "Visual benchmark history entry runAt must be a non-empty string.",
      );
    }
    if (!Array.isArray(entry.scores)) {
      throw new Error(
        "Visual benchmark history entry scores must be an array.",
      );
    }

    const scores: VisualBenchmarkHistoryScoreEntry[] = [];
    for (const score of entry.scores) {
      if (!isPlainRecord(score)) {
        throw new Error(
          "Each visual benchmark history score entry must be an object.",
        );
      }
      if (
        typeof score.fixtureId !== "string" ||
        score.fixtureId.trim().length === 0
      ) {
        throw new Error(
          "Visual benchmark history score entry fixtureId must be a non-empty string.",
        );
      }
      if (typeof score.score !== "number" || !Number.isFinite(score.score)) {
        throw new Error(
          "Visual benchmark history score entry score must be a finite number.",
        );
      }
      scores.push({ fixtureId: score.fixtureId, score: score.score });
    }

    entries.push({ runAt: entry.runAt, scores });
  }

  return { version: 1, entries };
};

export const loadVisualBenchmarkHistory = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkHistory | null> => {
  const historyPath = resolveVisualBenchmarkHistoryPath(options);
  try {
    const content = await readFile(historyPath, "utf8");
    return parseVisualBenchmarkHistory(content);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

export const saveVisualBenchmarkHistory = async (
  history: VisualBenchmarkHistory,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const historyPath = resolveVisualBenchmarkHistoryPath(options);
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, toStableJsonString(history), "utf8");
};

const normalizeHistoryScores = (
  scores: readonly VisualBenchmarkHistoryScoreEntry[],
): VisualBenchmarkHistoryScoreEntry[] => {
  return [...scores]
    .map((entry) => ({
      fixtureId: assertAllowedFixtureId(entry.fixtureId),
      score: entry.score,
    }))
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
};

export const appendVisualBenchmarkHistoryEntry = (
  history: VisualBenchmarkHistory | null,
  entry: VisualBenchmarkHistoryEntry,
  maxEntries: number = DEFAULT_VISUAL_BENCHMARK_HISTORY_SIZE,
): VisualBenchmarkHistory => {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("maxEntries must be a positive integer.");
  }
  if (maxEntries > MAX_VISUAL_BENCHMARK_HISTORY_SIZE) {
    throw new Error(
      `maxEntries must not exceed ${String(MAX_VISUAL_BENCHMARK_HISTORY_SIZE)}.`,
    );
  }
  if (typeof entry.runAt !== "string" || entry.runAt.trim().length === 0) {
    throw new Error("History entry runAt must be a non-empty string.");
  }
  for (const score of entry.scores) {
    if (typeof score.score !== "number" || !Number.isFinite(score.score)) {
      throw new Error("History entry score must be a finite number.");
    }
  }

  const existing: VisualBenchmarkHistoryEntry[] = history?.entries ?? [];
  const newEntry: VisualBenchmarkHistoryEntry = {
    runAt: entry.runAt,
    scores: normalizeHistoryScores(entry.scores),
  };
  const combined = [...existing, newEntry];
  const trimmed =
    combined.length > maxEntries ? combined.slice(-maxEntries) : combined;
  return { version: 1, entries: trimmed };
};
