import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertAllowedScreenId,
  enumerateFixtureScreens,
  loadVisualBenchmarkFixtureMetadata,
  parseVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkScreenPaths,
  toScreenIdToken,
  writeVisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureScreenMetadata,
} from "./visual-benchmark.helpers.js";

// ---------------------------------------------------------------------------
// assertAllowedScreenId — security allow-list (ADR Q7-C)
// ---------------------------------------------------------------------------

test("assertAllowedScreenId accepts Figma node id format", () => {
  assert.equal(assertAllowedScreenId("2:10001"), "2:10001");
  assert.equal(assertAllowedScreenId("1:65671"), "1:65671");
  assert.equal(assertAllowedScreenId("2:10001:extra"), "2:10001:extra");
});

test("assertAllowedScreenId accepts alphanumeric, underscore, hyphen", () => {
  assert.equal(assertAllowedScreenId("screen-1"), "screen-1");
  assert.equal(assertAllowedScreenId("Screen_A"), "Screen_A");
  assert.equal(assertAllowedScreenId("abc123"), "abc123");
  assert.equal(assertAllowedScreenId("a"), "a");
});

test("assertAllowedScreenId trims whitespace and returns the trimmed id", () => {
  assert.equal(assertAllowedScreenId("  2:10001  "), "2:10001");
});

test("assertAllowedScreenId rejects empty or whitespace-only input", () => {
  assert.throws(() => assertAllowedScreenId(""), /non-empty/i);
  assert.throws(() => assertAllowedScreenId("   "), /non-empty/i);
});

test("assertAllowedScreenId rejects path traversal sequences", () => {
  assert.throws(
    () => assertAllowedScreenId(".."),
    /forbidden|invalid|not allowed/i,
  );
  assert.throws(
    () => assertAllowedScreenId("../foo"),
    /forbidden|invalid|not allowed|characters/i,
  );
  assert.throws(
    () => assertAllowedScreenId("foo/../bar"),
    /forbidden|invalid|not allowed|characters/i,
  );
});

test("assertAllowedScreenId rejects path separators", () => {
  assert.throws(
    () => assertAllowedScreenId("foo/bar"),
    /invalid|characters|not allowed/i,
  );
  assert.throws(
    () => assertAllowedScreenId("foo\\bar"),
    /invalid|characters|not allowed/i,
  );
});

test("assertAllowedScreenId rejects absolute paths", () => {
  assert.throws(
    () => assertAllowedScreenId("/2:10001"),
    /invalid|characters|not allowed|absolute/i,
  );
});

test("assertAllowedScreenId rejects dots and spaces", () => {
  assert.throws(
    () => assertAllowedScreenId("2.10001"),
    /invalid|characters|not allowed/i,
  );
  assert.throws(
    () => assertAllowedScreenId("screen with space"),
    /invalid|characters|not allowed/i,
  );
});

test("assertAllowedScreenId rejects Unicode and non-ASCII characters", () => {
  assert.throws(
    () => assertAllowedScreenId("überschrift"),
    /invalid|characters|not allowed/i,
  );
  assert.throws(
    () => assertAllowedScreenId("2:10001\u0000"),
    /invalid|characters|not allowed/i,
  );
});

// ---------------------------------------------------------------------------
// toScreenIdToken — path derivation (ADR Q7-C)
// ---------------------------------------------------------------------------

test("toScreenIdToken replaces every colon with an underscore", () => {
  assert.equal(toScreenIdToken("2:10001"), "2_10001");
  assert.equal(toScreenIdToken("1:65671"), "1_65671");
  assert.equal(toScreenIdToken("2:10001:extra"), "2_10001_extra");
});

test("toScreenIdToken is a pure identity on ids without colons", () => {
  assert.equal(toScreenIdToken("a_b"), "a_b");
  assert.equal(toScreenIdToken("screen-1"), "screen-1");
  assert.equal(toScreenIdToken("abc123"), "abc123");
});

test("toScreenIdToken performs no other substitutions", () => {
  // No lowercasing, no length cap, no NFC normalization
  assert.equal(toScreenIdToken("Screen-A"), "Screen-A");
  assert.equal(
    toScreenIdToken("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
});

// ---------------------------------------------------------------------------
// resolveVisualBenchmarkScreenPaths — double-validated path derivation
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkScreenPaths joins fixtureId/screens/<token>/reference.png", () => {
  const root = "/tmp/fake-root";
  const paths = resolveVisualBenchmarkScreenPaths("simple-form", "2:10001", {
    fixtureRoot: root,
  });
  assert.ok(
    paths.referencePngPath.endsWith(
      path.join("simple-form", "screens", "2_10001", "reference.png"),
    ),
    `Expected reference path to end with simple-form/screens/2_10001/reference.png, got ${paths.referencePngPath}`,
  );
  assert.ok(
    paths.screenDir.endsWith(path.join("simple-form", "screens", "2_10001")),
  );
});

test("resolveVisualBenchmarkScreenPaths rejects invalid fixtureId", () => {
  assert.throws(() =>
    resolveVisualBenchmarkScreenPaths("nested/fixture", "2:10001", {
      fixtureRoot: "/tmp/x",
    }),
  );
});

test("resolveVisualBenchmarkScreenPaths rejects invalid screenId", () => {
  assert.throws(() =>
    resolveVisualBenchmarkScreenPaths("simple-form", "../escape", {
      fixtureRoot: "/tmp/x",
    }),
  );
  assert.throws(() =>
    resolveVisualBenchmarkScreenPaths("simple-form", "", {
      fixtureRoot: "/tmp/x",
    }),
  );
});

// ---------------------------------------------------------------------------
// parseVisualBenchmarkFixtureMetadata — v1 passthrough + v2 parsing
// ---------------------------------------------------------------------------

const v1MetadataJson = (): string =>
  JSON.stringify({
    version: 1,
    fixtureId: "simple-form",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "1:65671",
      nodeName: "Simple Form",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: { width: 1336, height: 1578 },
    export: { format: "png", scale: 2 },
  });

const v2MetadataJson = (screens: unknown): string =>
  JSON.stringify({
    version: 2,
    fixtureId: "multi-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "2:10001",
      nodeName: "Fixture Root",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: { width: 1280, height: 720 },
    export: { format: "png", scale: 2 },
    screens,
  });

test("parseVisualBenchmarkFixtureMetadata parses v1 metadata without screens", () => {
  const metadata = parseVisualBenchmarkFixtureMetadata(v1MetadataJson());
  assert.equal(metadata.version, 1);
  assert.equal(metadata.fixtureId, "simple-form");
  assert.equal(metadata.source.nodeId, "1:65671");
  assert.equal(metadata.screens, undefined);
});

test("parseVisualBenchmarkFixtureMetadata parses v2 metadata with screens", () => {
  const screens = [
    {
      screenId: "2:10001",
      screenName: "Dashboard",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
    },
    {
      screenId: "2:10002",
      screenName: "Details",
      nodeId: "2:10002",
      viewport: { width: 1280, height: 720 },
      weight: 2,
    },
  ];
  const metadata = parseVisualBenchmarkFixtureMetadata(v2MetadataJson(screens));
  assert.equal(metadata.version, 2);
  assert.ok(Array.isArray(metadata.screens));
  assert.equal(metadata.screens?.length, 2);
  assert.equal(metadata.screens?.[0]?.screenId, "2:10001");
  assert.equal(metadata.screens?.[0]?.screenName, "Dashboard");
  assert.equal(metadata.screens?.[0]?.weight, undefined);
  assert.equal(metadata.screens?.[1]?.weight, 2);
});

test("parseVisualBenchmarkFixtureMetadata rejects v2 metadata with invalid screen id", () => {
  const screens = [
    {
      screenId: "../escape",
      screenName: "Bad",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
    },
  ];
  assert.throws(() =>
    parseVisualBenchmarkFixtureMetadata(v2MetadataJson(screens)),
  );
});

test("parseVisualBenchmarkFixtureMetadata rejects v2 metadata with non-array screens field", () => {
  const badJson = JSON.stringify({
    version: 2,
    fixtureId: "multi-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "X",
      nodeId: "2:1",
      nodeName: "X",
      lastModified: "2026-04-09T00:00:00.000Z",
    },
    viewport: { width: 100, height: 100 },
    export: { format: "png", scale: 1 },
    screens: "not-an-array",
  });
  assert.throws(() => parseVisualBenchmarkFixtureMetadata(badJson));
});

test("parseVisualBenchmarkFixtureMetadata rejects v2 metadata with weight <= 0", () => {
  const screens = [
    {
      screenId: "2:10001",
      screenName: "Dashboard",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
      weight: 0,
    },
  ];
  assert.throws(() =>
    parseVisualBenchmarkFixtureMetadata(v2MetadataJson(screens)),
  );

  const negative = [
    {
      screenId: "2:10001",
      screenName: "Dashboard",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
      weight: -1,
    },
  ];
  assert.throws(() =>
    parseVisualBenchmarkFixtureMetadata(v2MetadataJson(negative)),
  );
});

test("parseVisualBenchmarkFixtureMetadata rejects unknown version", () => {
  const badJson = JSON.stringify({
    version: 3,
    fixtureId: "x",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "X",
      nodeId: "2:1",
      nodeName: "X",
      lastModified: "2026-04-09T00:00:00.000Z",
    },
    viewport: { width: 100, height: 100 },
    export: { format: "png", scale: 1 },
  });
  assert.throws(() => parseVisualBenchmarkFixtureMetadata(badJson));
});

// ---------------------------------------------------------------------------
// enumerateFixtureScreens — v1 synthesis + v2 passthrough
// ---------------------------------------------------------------------------

test("enumerateFixtureScreens synthesizes a single screen for v1 metadata", () => {
  const v1: VisualBenchmarkFixtureMetadata = {
    version: 1,
    fixtureId: "simple-form",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "1:65671",
      nodeName: "Simple Form",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: { width: 1336, height: 1578 },
    export: { format: "png", scale: 2 },
  };
  const screens = enumerateFixtureScreens(v1);
  assert.equal(screens.length, 1);
  assert.equal(screens[0]?.screenId, "1:65671");
  assert.equal(screens[0]?.screenName, "Simple Form");
  assert.equal(screens[0]?.nodeId, "1:65671");
  assert.deepEqual(screens[0]?.viewport, { width: 1336, height: 1578 });
});

test("enumerateFixtureScreens returns declared screens for v2 metadata", () => {
  const screens: VisualBenchmarkFixtureScreenMetadata[] = [
    {
      screenId: "2:10001",
      screenName: "Dashboard",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
    },
    {
      screenId: "2:10002",
      screenName: "Details",
      nodeId: "2:10002",
      viewport: { width: 1280, height: 720 },
      weight: 2,
    },
  ];
  const v2: VisualBenchmarkFixtureMetadata = {
    version: 2,
    fixtureId: "multi-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "2:10001",
      nodeName: "Fixture Root",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: { width: 1280, height: 720 },
    export: { format: "png", scale: 2 },
    screens,
  };
  const result = enumerateFixtureScreens(v2);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.screenId, "2:10001");
  assert.equal(result[1]?.screenId, "2:10002");
  assert.equal(result[1]?.weight, 2);
});

test("enumerateFixtureScreens synthesizes single screen when v2 has empty screens array", () => {
  const v2: VisualBenchmarkFixtureMetadata = {
    version: 2,
    fixtureId: "edge-case",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "2:10001",
      nodeName: "Fixture Root",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: { width: 1280, height: 720 },
    export: { format: "png", scale: 2 },
    screens: [],
  };
  const result = enumerateFixtureScreens(v2);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.screenId, "2:10001");
});

// ---------------------------------------------------------------------------
// loadVisualBenchmarkFixtureMetadata reads v2 from disk
// ---------------------------------------------------------------------------

test("loadVisualBenchmarkFixtureMetadata round-trips v2 metadata with screens", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-helpers-v2-"),
  );
  try {
    const fixtureId = "multi-fixture";
    await mkdir(path.join(root, fixtureId), { recursive: true });
    const metadata: VisualBenchmarkFixtureMetadata = {
      version: 2,
      fixtureId,
      capturedAt: "2026-04-09T00:00:00.000Z",
      source: {
        fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        nodeId: "2:10001",
        nodeName: "Fixture Root",
        lastModified: "2026-03-30T20:59:16Z",
      },
      viewport: { width: 1280, height: 720 },
      export: { format: "png", scale: 2 },
      screens: [
        {
          screenId: "2:10001",
          screenName: "Dashboard",
          nodeId: "2:10001",
          viewport: { width: 1280, height: 720 },
        },
        {
          screenId: "2:10002",
          screenName: "Details",
          nodeId: "2:10002",
          viewport: { width: 1280, height: 720 },
          weight: 2,
        },
      ],
    };
    await writeVisualBenchmarkFixtureMetadata(fixtureId, metadata, {
      fixtureRoot: root,
    });
    const loaded = await loadVisualBenchmarkFixtureMetadata(fixtureId, {
      fixtureRoot: root,
    });
    assert.equal(loaded.version, 2);
    assert.equal(loaded.screens?.length, 2);
    assert.equal(loaded.screens?.[0]?.screenId, "2:10001");
    assert.equal(loaded.screens?.[1]?.weight, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkFixtureMetadata accepts legacy v1 metadata unchanged", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-helpers-v1-"),
  );
  try {
    const fixtureId = "legacy-fixture";
    await mkdir(path.join(root, fixtureId), { recursive: true });
    await writeFile(
      path.join(root, fixtureId, "metadata.json"),
      JSON.stringify(
        {
          version: 1,
          fixtureId,
          capturedAt: "2026-04-09T00:00:00.000Z",
          source: {
            fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
            nodeId: "2:9999",
            nodeName: "Legacy Screen",
            lastModified: "2026-03-30T20:59:16Z",
          },
          viewport: { width: 800, height: 600 },
          export: { format: "png", scale: 2 },
        },
        null,
        2,
      ),
      "utf8",
    );
    const loaded = await loadVisualBenchmarkFixtureMetadata(fixtureId, {
      fixtureRoot: root,
    });
    assert.equal(loaded.version, 1);
    assert.equal(loaded.fixtureId, "legacy-fixture");
    assert.equal(loaded.source.nodeId, "2:9999");
    assert.equal(loaded.screens, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
