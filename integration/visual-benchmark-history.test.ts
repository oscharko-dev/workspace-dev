import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_VISUAL_BENCHMARK_HISTORY_SIZE,
  MAX_VISUAL_BENCHMARK_HISTORY_SIZE,
  appendVisualBenchmarkHistoryEntry,
  loadVisualBenchmarkHistory,
  parseVisualBenchmarkHistory,
  resolveVisualBenchmarkHistoryPath,
  saveVisualBenchmarkHistory,
  type VisualBenchmarkHistory,
  type VisualBenchmarkHistoryEntry,
} from "./visual-benchmark-history.js";
import {
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
} from "./visual-benchmark.helpers.js";

const makeEntry = (
  runAt: string,
  scores: ReadonlyArray<{
    fixtureId: string;
    screenId?: string;
    screenName?: string;
    score: number;
  }>,
): VisualBenchmarkHistoryEntry => ({
  runAt,
  scores: scores.map((entry) => ({ ...entry })),
});

const createTempRoot = async (): Promise<string> => {
  return mkdtemp(path.join(os.tmpdir(), "visual-benchmark-history-"));
};

const createTempFixtureRoot = async (
  fixtureId = "simple-form",
  screenId = "1:65671",
  screenName = "Simple Form Screen",
): Promise<string> => {
  const fixtureRoot = await createTempRoot();
  await mkdir(path.join(fixtureRoot, fixtureId), { recursive: true });
  await writeVisualBenchmarkFixtureManifest(
    fixtureId,
    {
      version: 1,
      fixtureId,
      visualQuality: {
        frozenReferenceImage: "reference.png",
        frozenReferenceMetadata: "metadata.json",
      },
    },
    { fixtureRoot },
  );
  await writeVisualBenchmarkFixtureMetadata(
    fixtureId,
    {
      version: 1,
      fixtureId,
      capturedAt: "2026-04-10T00:00:00.000Z",
      source: {
        fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        nodeId: screenId,
        nodeName: screenName,
        lastModified: "2026-04-10T00:00:00.000Z",
      },
      viewport: {
        width: 1280,
        height: 720,
      },
      export: {
        format: "png",
        scale: 2,
      },
    },
    { fixtureRoot },
  );
  await writeVisualBenchmarkFixtureInputs(
    fixtureId,
    {
      name: "Fixture Board",
      lastModified: "2026-04-10T00:00:00.000Z",
      nodes: {
        [screenId]: {
          document: {
            id: screenId,
            name: screenName,
            type: "FRAME",
            absoluteBoundingBox: {
              x: 0,
              y: 0,
              width: 1280,
              height: 720,
            },
          },
        },
      },
    },
    { fixtureRoot },
  );
  return fixtureRoot;
};

// ---------------------------------------------------------------------------
// parseVisualBenchmarkHistory
// ---------------------------------------------------------------------------

test("parseVisualBenchmarkHistory accepts valid version 1 object", () => {
  const parsed = parseVisualBenchmarkHistory(
    JSON.stringify({
      version: 1,
      entries: [
        {
          runAt: "2026-04-10T00:00:00.000Z",
          scores: [{ fixtureId: "simple-form", score: 88 }],
        },
      ],
    }),
  );
  assert.equal(parsed.version, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0]?.runAt, "2026-04-10T00:00:00.000Z");
  assert.deepEqual(parsed.entries[0]?.scores, [
    { fixtureId: "simple-form", score: 88 },
  ]);
});

test("parseVisualBenchmarkHistory accepts valid version 2 object", () => {
  const parsed = parseVisualBenchmarkHistory(
    JSON.stringify({
      version: 2,
      entries: [
        {
          runAt: "2026-04-10T00:00:00.000Z",
          scores: [
            {
              fixtureId: "simple-form",
              screenId: "1:65671",
              screenName: "Simple Form Screen",
              score: 88,
            },
          ],
        },
      ],
    }),
  );
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.entries[0]?.scores, [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      screenName: "Simple Form Screen",
      score: 88,
    },
  ]);
});

test("parseVisualBenchmarkHistory accepts empty entries array", () => {
  const parsed = parseVisualBenchmarkHistory(
    JSON.stringify({ version: 1, entries: [] }),
  );
  assert.equal(parsed.entries.length, 0);
});

test("parseVisualBenchmarkHistory rejects non-object input", () => {
  assert.throws(() => parseVisualBenchmarkHistory("[]"), /to be an object/);
});

test("parseVisualBenchmarkHistory rejects unsupported version", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkHistory(JSON.stringify({ version: 3, entries: [] })),
    /version must be 1 or 2/,
  );
});

test("parseVisualBenchmarkHistory rejects missing entries", () => {
  assert.throws(
    () => parseVisualBenchmarkHistory(JSON.stringify({ version: 1 })),
    /entries must be an array/,
  );
});

test("parseVisualBenchmarkHistory rejects non-string runAt", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkHistory(
        JSON.stringify({
          version: 1,
          entries: [{ runAt: 123, scores: [] }],
        }),
      ),
    /runAt must be a non-empty string/,
  );
});

test("parseVisualBenchmarkHistory rejects non-array scores", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkHistory(
        JSON.stringify({
          version: 1,
          entries: [{ runAt: "2026-01-01T00:00:00Z", scores: {} }],
        }),
      ),
    /scores must be an array/,
  );
});

test("parseVisualBenchmarkHistory rejects non-finite score", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkHistory(
        JSON.stringify({
          version: 1,
          entries: [
            {
              runAt: "2026-01-01T00:00:00Z",
              scores: [{ fixtureId: "simple-form", score: "high" }],
            },
          ],
        }),
      ),
    /score must be a finite number/,
  );
});

test("parseVisualBenchmarkHistory rejects empty fixtureId", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkHistory(
        JSON.stringify({
          version: 1,
          entries: [
            {
              runAt: "2026-01-01T00:00:00Z",
              scores: [{ fixtureId: "", score: 90 }],
            },
          ],
        }),
      ),
    /fixtureId must be a non-empty string/,
  );
});

// ---------------------------------------------------------------------------
// appendVisualBenchmarkHistoryEntry
// ---------------------------------------------------------------------------

test("appendVisualBenchmarkHistoryEntry seeds empty history when no prior exists", () => {
  const result = appendVisualBenchmarkHistoryEntry(
    null,
    makeEntry("2026-04-10T00:00:00Z", [
      {
        fixtureId: "simple-form",
        screenId: "1:65671",
        screenName: "Simple Form Screen",
        score: 90,
      },
    ]),
  );
  assert.equal(result.version, 2);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.runAt, "2026-04-10T00:00:00Z");
});

test("appendVisualBenchmarkHistoryEntry sorts scores by fixtureId, screenId, and screenName", () => {
  const result = appendVisualBenchmarkHistoryEntry(
    null,
    makeEntry("2026-04-10T00:00:00Z", [
      {
        fixtureId: "simple-form",
        screenId: "2:2000",
        screenName: "Screen B",
        score: 88,
      },
      {
        fixtureId: "complex-dashboard",
        screenId: "1:1000",
        screenName: "Dashboard",
        score: 72,
      },
      {
        fixtureId: "simple-form",
        screenId: "1:1000",
        screenName: "Screen A",
        score: 89,
      },
    ]),
  );
  assert.deepEqual(
    result.entries[0]?.scores.map(
      (entry) => `${entry.fixtureId}:${entry.screenId}:${entry.screenName ?? ""}`,
    ),
    [
      "complex-dashboard:1:1000:Dashboard",
      "simple-form:1:1000:Screen A",
      "simple-form:2:2000:Screen B",
    ],
  );
});

test("appendVisualBenchmarkHistoryEntry appends to existing history", () => {
  const existing: VisualBenchmarkHistory = {
    version: 2,
    entries: [
      makeEntry("2026-04-09T00:00:00Z", [
        {
          fixtureId: "simple-form",
          screenId: "1:65671",
          screenName: "Simple Form Screen",
          score: 80,
        },
      ]),
    ],
  };
  const result = appendVisualBenchmarkHistoryEntry(
    existing,
    makeEntry("2026-04-10T00:00:00Z", [
      {
        fixtureId: "simple-form",
        screenId: "1:65671",
        screenName: "Simple Form Screen",
        score: 88,
      },
    ]),
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.runAt, "2026-04-09T00:00:00Z");
  assert.equal(result.entries[1]?.runAt, "2026-04-10T00:00:00Z");
});

test("appendVisualBenchmarkHistoryEntry drops oldest entries when ring buffer exceeds limit", () => {
  const existing: VisualBenchmarkHistory = {
    version: 2,
    entries: [
      makeEntry("2026-04-01T00:00:00Z", [
        { fixtureId: "simple-form", screenId: "1:65671", score: 70 },
      ]),
      makeEntry("2026-04-02T00:00:00Z", [
        { fixtureId: "simple-form", screenId: "1:65671", score: 72 },
      ]),
      makeEntry("2026-04-03T00:00:00Z", [
        { fixtureId: "simple-form", screenId: "1:65671", score: 74 },
      ]),
    ],
  };
  const result = appendVisualBenchmarkHistoryEntry(
    existing,
    makeEntry("2026-04-04T00:00:00Z", [
      { fixtureId: "simple-form", screenId: "1:65671", score: 76 },
    ]),
    2,
  );
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.runAt, "2026-04-03T00:00:00Z");
  assert.equal(result.entries[1]?.runAt, "2026-04-04T00:00:00Z");
});

test("appendVisualBenchmarkHistoryEntry keeps all entries when below ring buffer limit", () => {
  const result = appendVisualBenchmarkHistoryEntry(
    null,
    makeEntry("2026-04-10T00:00:00Z", [
      { fixtureId: "simple-form", screenId: "1:65671", score: 88 },
    ]),
    DEFAULT_VISUAL_BENCHMARK_HISTORY_SIZE,
  );
  assert.equal(result.entries.length, 1);
});

test("appendVisualBenchmarkHistoryEntry rejects maxEntries <= 0", () => {
  assert.throws(
    () =>
      appendVisualBenchmarkHistoryEntry(
        null,
        makeEntry("2026-04-10T00:00:00Z", [
          { fixtureId: "simple-form", screenId: "1:65671", score: 88 },
        ]),
        0,
      ),
    /maxEntries must be a positive integer/,
  );
});

test("appendVisualBenchmarkHistoryEntry rejects maxEntries beyond limit", () => {
  assert.throws(
    () =>
      appendVisualBenchmarkHistoryEntry(
        null,
        makeEntry("2026-04-10T00:00:00Z", [
          { fixtureId: "simple-form", screenId: "1:65671", score: 88 },
        ]),
        MAX_VISUAL_BENCHMARK_HISTORY_SIZE + 1,
      ),
    /maxEntries must not exceed/,
  );
});

test("appendVisualBenchmarkHistoryEntry rejects non-finite score", () => {
  assert.throws(
    () =>
      appendVisualBenchmarkHistoryEntry(null, {
        runAt: "2026-04-10T00:00:00Z",
        scores: [{ fixtureId: "simple-form", screenId: "1:65671", score: Number.NaN }],
      }),
    /score must be a finite number/,
  );
});

test("appendVisualBenchmarkHistoryEntry rejects empty runAt", () => {
  assert.throws(
    () => appendVisualBenchmarkHistoryEntry(null, { runAt: "", scores: [] }),
    /runAt must be a non-empty string/,
  );
});

// ---------------------------------------------------------------------------
// loadVisualBenchmarkHistory / saveVisualBenchmarkHistory — round-trip
// ---------------------------------------------------------------------------

test("loadVisualBenchmarkHistory returns null when file is missing", async () => {
  const fixtureRoot = await createTempRoot();
  try {
    const result = await loadVisualBenchmarkHistory({ fixtureRoot });
    assert.equal(result, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("saveVisualBenchmarkHistory then loadVisualBenchmarkHistory round-trips", async () => {
  const fixtureRoot = await createTempRoot();
  try {
    const history: VisualBenchmarkHistory = {
      version: 2,
      entries: [
        makeEntry("2026-04-10T00:00:00Z", [
          {
            fixtureId: "simple-form",
            screenId: "1:65671",
            screenName: "Simple Form Screen",
            score: 88,
          },
        ]),
      ],
    };
    await saveVisualBenchmarkHistory(history, { fixtureRoot });
    const loaded = await loadVisualBenchmarkHistory({ fixtureRoot });
    assert.deepEqual(loaded, history);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("saveVisualBenchmarkHistory writes deterministic stable JSON", async () => {
  const fixtureRoot = await createTempRoot();
  try {
    const history: VisualBenchmarkHistory = {
      version: 2,
      entries: [
        makeEntry("2026-04-10T00:00:00Z", [
          {
            fixtureId: "simple-form",
            screenId: "1:65671",
            screenName: "Simple Form Screen",
            score: 88,
          },
        ]),
      ],
    };
    await saveVisualBenchmarkHistory(history, { fixtureRoot });
    const content = await readFile(
      resolveVisualBenchmarkHistoryPath({ fixtureRoot }),
      "utf8",
    );
    // Stable JSON: keys sorted alphabetically; "entries" < "version"
    const entriesIndex = content.indexOf('"entries"');
    const versionIndex = content.indexOf('"version"');
    assert.ok(entriesIndex >= 0, "entries key should be present");
    assert.ok(versionIndex >= 0, "version key should be present");
    assert.ok(
      entriesIndex < versionIndex,
      "stable JSON should sort entries before version",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkHistory migrates legacy history entries to screen-scoped entries", async () => {
  const fixtureRoot = await createTempFixtureRoot(
    "simple-form",
    "1:65671",
    "Simple Form Screen",
  );
  try {
    await writeFile(
      resolveVisualBenchmarkHistoryPath({ fixtureRoot }),
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              runAt: "2026-04-10T00:00:00.000Z",
              scores: [{ fixtureId: "simple-form", score: 88 }],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadVisualBenchmarkHistory({ fixtureRoot });
    assert.deepEqual(loaded, {
      version: 2,
      entries: [
        {
          runAt: "2026-04-10T00:00:00.000Z",
          scores: [
            {
              fixtureId: "simple-form",
              screenId: "1:65671",
              screenName: "Simple Form Screen",
              score: 88,
            },
          ],
        },
      ],
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkHistory rejects malformed file", async () => {
  const fixtureRoot = await createTempRoot();
  try {
    await writeFile(
      resolveVisualBenchmarkHistoryPath({ fixtureRoot }),
      "not json",
      "utf8",
    );
    await assert.rejects(
      loadVisualBenchmarkHistory({ fixtureRoot }),
      (error: unknown) => error instanceof Error,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkHistory rejects wrong version", async () => {
  const fixtureRoot = await createTempRoot();
  try {
    await writeFile(
      resolveVisualBenchmarkHistoryPath({ fixtureRoot }),
      JSON.stringify({ version: 0, entries: [] }),
      "utf8",
    );
    await assert.rejects(
      loadVisualBenchmarkHistory({ fixtureRoot }),
      /version must be 1 or 2/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resolveVisualBenchmarkHistoryPath uses fixtureRoot from options", () => {
  const custom = "/tmp/custom-root";
  const resolved = resolveVisualBenchmarkHistoryPath({ fixtureRoot: custom });
  assert.equal(resolved, path.join(custom, "history.json"));
});
