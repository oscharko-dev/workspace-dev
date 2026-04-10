import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertAllowedFixtureId,
  getVisualBenchmarkFixtureRoot,
  loadVisualBenchmarkFixtureMetadata,
  toStableJsonString,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";

const HISTORY_FILE_NAME = "history.json";

export const DEFAULT_VISUAL_BENCHMARK_HISTORY_SIZE = 20;
export const MAX_VISUAL_BENCHMARK_HISTORY_SIZE = 1000;

export interface VisualBenchmarkHistoryScoreEntry {
  fixtureId: string;
  screenId?: string;
  screenName?: string;
  score: number;
}

export interface VisualBenchmarkHistoryEntry {
  runAt: string;
  scores: VisualBenchmarkHistoryScoreEntry[];
}

export interface VisualBenchmarkHistory {
  version: 1 | 2;
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
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error("Visual benchmark history version must be 1 or 2.");
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
      let screenId: string | undefined;
      let screenName: string | undefined;
      if (parsed.version === 2) {
        if (
          typeof score.screenId !== "string" ||
          score.screenId.trim().length === 0
        ) {
          throw new Error(
            "Visual benchmark history version 2 score entry screenId must be a non-empty string.",
          );
        }
        screenId = score.screenId.trim();
        if (score.screenName !== undefined) {
          if (
            typeof score.screenName !== "string" ||
            score.screenName.trim().length === 0
          ) {
            throw new Error(
              "Visual benchmark history version 2 score entry screenName must be a non-empty string when provided.",
            );
          }
          screenName = score.screenName.trim();
        }
      }
      scores.push({
        fixtureId: score.fixtureId,
        ...(screenId !== undefined ? { screenId } : {}),
        ...(screenName !== undefined ? { screenName } : {}),
        score: score.score,
      });
    }

    entries.push({ runAt: entry.runAt, scores });
  }

  return { version: parsed.version, entries };
};

const normalizeOptionalScreenName = (
  screenName: string | undefined,
): string | undefined => {
  if (typeof screenName !== "string") {
    return undefined;
  }
  const normalized = screenName.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeHistoryScoreEntry = (
  entry: VisualBenchmarkHistoryScoreEntry,
): VisualBenchmarkHistoryScoreEntry => {
  const fixtureId = assertAllowedFixtureId(entry.fixtureId);
  const screenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : fixtureId;
  const screenName = normalizeOptionalScreenName(entry.screenName);

  return {
    fixtureId,
    screenId,
    ...(screenName !== undefined ? { screenName } : {}),
    score: entry.score,
  };
};

type FixtureMetadataCache = Map<
  string,
  Promise<Awaited<ReturnType<typeof loadVisualBenchmarkFixtureMetadata>> | null>
>;

const loadMetadataWithCache = (
  fixtureId: string,
  cache: FixtureMetadataCache,
  options?: VisualBenchmarkFixtureOptions,
): Promise<Awaited<
  ReturnType<typeof loadVisualBenchmarkFixtureMetadata>
> | null> => {
  const existing = cache.get(fixtureId);
  if (existing !== undefined) {
    return existing;
  }
  const promise = loadVisualBenchmarkFixtureMetadata(fixtureId, options).catch(
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    },
  );
  cache.set(fixtureId, promise);
  return promise;
};

const normalizeHistoryScoreEntryWithMetadata = async (
  entry: VisualBenchmarkHistoryScoreEntry,
  cache: FixtureMetadataCache,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkHistoryScoreEntry> => {
  const providedScreenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : undefined;
  const providedScreenName = normalizeOptionalScreenName(entry.screenName);
  const normalized = normalizeHistoryScoreEntry(entry);
  const metadata = await loadMetadataWithCache(
    normalized.fixtureId,
    cache,
    options,
  );
  if (metadata === null) {
    return normalized;
  }
  const screenName =
    providedScreenName ?? normalizeOptionalScreenName(metadata.source.nodeName);

  return {
    fixtureId: normalized.fixtureId,
    screenId: providedScreenId ?? metadata.source.nodeId,
    ...(screenName !== undefined ? { screenName } : {}),
    score: normalized.score,
  };
};

export const loadVisualBenchmarkHistory = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkHistory | null> => {
  const historyPath = resolveVisualBenchmarkHistoryPath(options);
  try {
    const content = await readFile(historyPath, "utf8");
    const parsed = parseVisualBenchmarkHistory(content);
    if (parsed.version === 2) {
      return {
        version: 2,
        entries: parsed.entries.map((entry) => ({
          runAt: entry.runAt,
          scores: normalizeHistoryScores(entry.scores),
        })),
      };
    }

    const entries: VisualBenchmarkHistoryEntry[] = [];
    const metadataCache: FixtureMetadataCache = new Map();
    for (const entry of parsed.entries) {
      const scores: VisualBenchmarkHistoryScoreEntry[] = [];
      for (const score of entry.scores) {
        scores.push(
          await normalizeHistoryScoreEntryWithMetadata(
            score,
            metadataCache,
            options,
          ),
        );
      }
      entries.push({
        runAt: entry.runAt,
        scores: normalizeHistoryScores(scores),
      });
    }

    return { version: 2, entries };
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
  const normalized: VisualBenchmarkHistory = {
    version: 2,
    entries: history.entries.map((entry) => ({
      runAt: entry.runAt,
      scores: normalizeHistoryScores(entry.scores),
    })),
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, toStableJsonString(normalized), "utf8");
};

const normalizeHistoryScores = (
  scores: readonly VisualBenchmarkHistoryScoreEntry[],
): VisualBenchmarkHistoryScoreEntry[] => {
  return [...scores]
    .map((entry) => normalizeHistoryScoreEntry(entry))
    .sort((left, right) => {
      const fixtureComparison = left.fixtureId.localeCompare(right.fixtureId);
      if (fixtureComparison !== 0) {
        return fixtureComparison;
      }

      const screenComparison = left.screenId!.localeCompare(right.screenId!);
      if (screenComparison !== 0) {
        return screenComparison;
      }

      return (left.screenName ?? "").localeCompare(right.screenName ?? "");
    });
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
  return { version: 2, entries: trimmed };
};
