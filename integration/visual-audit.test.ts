import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
} from "./visual-benchmark.helpers.js";
import { fetchVisualBenchmarkReferenceImage } from "./visual-benchmark.update.js";
import type { VisualBenchmarkFixtureRunResult } from "./visual-benchmark.execution.js";
import { runVisualAudit, type VisualAuditReport } from "./visual-audit.js";
import {
  parseVisualAuditCliArgs,
  runVisualAuditCli,
} from "./visual-audit.cli.js";

const createTestPngBuffer = (
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      png.data[index] = rgba[0];
      png.data[index + 1] = rgba[1];
      png.data[index + 2] = rgba[2];
      png.data[index + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
};

const createJsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const AUDIT_FIXTURE_ID = "audit-fixture";
const AUDIT_NODE_ID = "1:65671";
const AUDIT_IMAGE_URL = "https://example.test/reference.png";

const auditFixtureMetadata: VisualBenchmarkFixtureMetadata = {
  version: 1,
  fixtureId: AUDIT_FIXTURE_ID,
  capturedAt: "2026-04-09T00:00:00.000Z",
  source: {
    fileKey: "TESTFILEKEY",
    nodeId: AUDIT_NODE_ID,
    nodeName: "Audit Fixture Frame",
    lastModified: "2026-03-30T20:59:16Z",
  },
  viewport: { width: 8, height: 8 },
  export: { format: "png", scale: 2 },
};

const liveSnapshotPayload = {
  name: "Audit-Test-Board",
  lastModified: "2026-04-10T09:15:00Z",
  nodes: {
    [AUDIT_NODE_ID]: {
      document: {
        id: AUDIT_NODE_ID,
        name: "Audit Fixture Frame",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 8 },
      },
    },
  },
};

interface AuditEnvironment {
  fixtureRoot: string;
  artifactRoot: string;
  frozenBuffer: Buffer;
}

const writeAuditFixture = async (options: {
  fixtureRoot: string;
  artifactRoot: string;
  metadata: VisualBenchmarkFixtureMetadata;
  frozenRgba: readonly [number, number, number, number];
}): Promise<Buffer> => {
  const metadata = options.metadata;
  const manifest: VisualBenchmarkFixtureManifest = {
    version: 1,
    fixtureId: metadata.fixtureId,
    visualQuality: {
      frozenReferenceImage: "reference.png",
      frozenReferenceMetadata: "metadata.json",
    },
  };
  await mkdir(path.join(options.fixtureRoot, metadata.fixtureId), {
    recursive: true,
  });
  await writeVisualBenchmarkFixtureManifest(metadata.fixtureId, manifest, {
    fixtureRoot: options.fixtureRoot,
    artifactRoot: options.artifactRoot,
  });
  await writeVisualBenchmarkFixtureMetadata(metadata.fixtureId, metadata, {
    fixtureRoot: options.fixtureRoot,
    artifactRoot: options.artifactRoot,
  });
  await writeVisualBenchmarkFixtureInputs(
    metadata.fixtureId,
    {
      name: "Audit-Test-Board",
      lastModified: metadata.source.lastModified,
      nodes: {
        [metadata.source.nodeId]: {
          document: {
            id: metadata.source.nodeId,
            name: metadata.source.nodeName,
            type: "FRAME",
            absoluteBoundingBox: {
              x: 0,
              y: 0,
              width: metadata.viewport.width,
              height: metadata.viewport.height,
            },
          },
        },
      },
    },
    { fixtureRoot: options.fixtureRoot, artifactRoot: options.artifactRoot },
  );
  const frozenBuffer = createTestPngBuffer(
    metadata.viewport.width,
    metadata.viewport.height,
    options.frozenRgba,
  );
  await writeVisualBenchmarkReference(metadata.fixtureId, frozenBuffer, {
    fixtureRoot: options.fixtureRoot,
    artifactRoot: options.artifactRoot,
  });
  return frozenBuffer;
};

const createAuditEnvironment = async (options: {
  frozenRgba: readonly [number, number, number, number];
  metadataOverrides?: Partial<VisualBenchmarkFixtureMetadata>;
}): Promise<AuditEnvironment> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-audit-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  const metadata: VisualBenchmarkFixtureMetadata = {
    ...auditFixtureMetadata,
    ...options.metadataOverrides,
  };
  const frozenBuffer = await writeAuditFixture({
    fixtureRoot,
    artifactRoot,
    metadata,
    frozenRgba: options.frozenRgba,
  });
  return { fixtureRoot, artifactRoot, frozenBuffer };
};

const createSecondAuditFixture = async (options: {
  fixtureRoot: string;
  artifactRoot: string;
  fixtureId: string;
  nodeId: string;
  nodeName: string;
  width: number;
  height: number;
  frozenRgba: readonly [number, number, number, number];
  capturedAt?: string;
  lastModified?: string;
}): Promise<Buffer> => {
  return await writeAuditFixture({
    fixtureRoot: options.fixtureRoot,
    artifactRoot: options.artifactRoot,
    metadata: {
      version: 2,
      fixtureId: options.fixtureId,
      capturedAt: options.capturedAt ?? "2026-04-09T00:00:00.000Z",
      source: {
        fileKey: "TESTFILEKEY",
        nodeId: options.nodeId,
        nodeName: options.nodeName,
        lastModified: options.lastModified ?? "2026-03-30T20:59:16Z",
      },
      viewport: { width: options.width, height: options.height },
      export: { format: "png", scale: 2 },
      screens: [
        {
          screenId: "screen-a",
          screenName: "Screen A",
          nodeId: options.nodeId,
          viewport: { width: options.width, height: options.height },
        },
        {
          screenId: "screen-b",
          screenName: "Screen B",
          nodeId: options.nodeId,
          viewport: { width: options.width, height: options.height },
        },
      ],
    },
    frozenRgba: options.frozenRgba,
  });
};

const cleanup = async (env: AuditEnvironment): Promise<void> => {
  const parent = path.dirname(env.fixtureRoot);
  await rm(parent, { recursive: true, force: true });
};

interface SequencedFetchMock {
  fetchImpl: typeof fetch;
  callCount: () => number;
  pngFetchesByUrl: () => ReadonlyMap<string, number>;
}

const createSequencedFetch = (
  steps: ReadonlyArray<() => Response | Promise<Response>>,
): SequencedFetchMock => {
  let call = 0;
  const pngFetches = new Map<string, number>();
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    pngFetches.set(url, (pngFetches.get(url) ?? 0) + 1);
    const step = steps[call];
    call += 1;
    if (step === undefined) {
      throw new Error(`Unexpected fetch call ${String(call)} for ${url}`);
    }
    return await step();
  };
  return {
    fetchImpl,
    callCount: () => call,
    pngFetchesByUrl: () => pngFetches,
  };
};

const nodePayloadStep = (): Response => createJsonResponse(liveSnapshotPayload);
const imageLookupStep = (): Response =>
  createJsonResponse({
    err: null,
    images: { [AUDIT_NODE_ID]: AUDIT_IMAGE_URL },
  });
const pngStep = (buffer: Buffer): Response =>
  new Response(buffer, { status: 200 });

const createGeneratedRun = (
  fixtureId: string,
  screens: ReadonlyArray<{
    screenId: string;
    nodeId?: string;
    screenName: string;
    buffer: Buffer;
    viewport: { width: number; height: number };
  }>,
): VisualBenchmarkFixtureRunResult => ({
  fixtureId,
  aggregateScore: 100,
  screens: screens.map((screen) => ({
    screenId: screen.screenId,
    screenName: screen.screenName,
    nodeId: screen.nodeId ?? screen.screenId,
    status: "completed",
    score: 100,
    screenshotBuffer: screen.buffer,
    diffBuffer: null,
    report: null,
    viewport: screen.viewport,
  })),
});

test("fetchVisualBenchmarkReferenceImage retries on 429 and honors Retry-After", async () => {
  const sleepDelays: number[] = [];
  let call = 0;
  const goodPng = createTestPngBuffer(4, 4, [0, 0, 0, 255]);
  const buffer = await fetchVisualBenchmarkReferenceImage(
    auditFixtureMetadata,
    "test-token",
    {
      fetchImpl: async () => {
        call += 1;
        if (call === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        if (call === 2) {
          return createJsonResponse({
            err: null,
            images: { [AUDIT_NODE_ID]: AUDIT_IMAGE_URL },
          });
        }
        return new Response(goodPng, { status: 200 });
      },
      sleepImpl: async (ms) => {
        sleepDelays.push(ms);
      },
      log: () => undefined,
    },
  );
  assert.ok(buffer.length > 0);
  assert.equal(call, 3);
  assert.equal(sleepDelays.length, 1);
  assert.equal(sleepDelays[0], 0);
});

test("fetchVisualBenchmarkReferenceImage falls back to exponential backoff when Retry-After is absent", async () => {
  const sleepDelays: number[] = [];
  let call = 0;
  const goodPng = createTestPngBuffer(4, 4, [0, 0, 0, 255]);
  await fetchVisualBenchmarkReferenceImage(auditFixtureMetadata, "test-token", {
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return new Response("rate limited", { status: 429 });
      }
      if (call === 2) {
        return createJsonResponse({
          err: null,
          images: { [AUDIT_NODE_ID]: AUDIT_IMAGE_URL },
        });
      }
      return new Response(goodPng, { status: 200 });
    },
    sleepImpl: async (ms) => {
      sleepDelays.push(ms);
    },
    log: () => undefined,
  });
  assert.equal(sleepDelays.length, 1);
  assert.equal(sleepDelays[0], 1_000);
});

test("fetchVisualBenchmarkReferenceImage still rejects non-429 4xx without retry", async () => {
  let call = 0;
  await assert.rejects(async () => {
    await fetchVisualBenchmarkReferenceImage(
      auditFixtureMetadata,
      "test-token",
      {
        fetchImpl: async () => {
          call += 1;
          return new Response("forbidden", {
            status: 403,
            statusText: "Forbidden",
          });
        },
        sleepImpl: async () => undefined,
        log: () => undefined,
      },
    );
  }, /403|Forbidden/);
  assert.equal(call, 1, "non-429 4xx must not retry");
});

test("parseVisualAuditCliArgs rejects missing command", () => {
  assert.throws(() => parseVisualAuditCliArgs([]), /Usage/);
});

test("parseVisualAuditCliArgs rejects unknown command", () => {
  assert.throws(() => parseVisualAuditCliArgs(["frozen"]), /Unknown command/);
});

test("parseVisualAuditCliArgs accepts live command with defaults", () => {
  const options = parseVisualAuditCliArgs(["live"]);
  assert.equal(options.command, "live");
  assert.equal(options.json, false);
  assert.equal(options.fixture, undefined);
  assert.equal(options.driftThreshold, undefined);
  assert.equal(options.regressionThreshold, undefined);
});

test("parseVisualAuditCliArgs accepts --json and --fixture", () => {
  const options = parseVisualAuditCliArgs([
    "live",
    "--json",
    "--fixture",
    "simple-form",
  ]);
  assert.equal(options.json, true);
  assert.equal(options.fixture, "simple-form");
});

test("parseVisualAuditCliArgs parses numeric thresholds", () => {
  const options = parseVisualAuditCliArgs([
    "live",
    "--drift-threshold",
    "90",
    "--regression-threshold",
    "80",
  ]);
  assert.equal(options.driftThreshold, 90);
  assert.equal(options.regressionThreshold, 80);
});

test("parseVisualAuditCliArgs rejects non-numeric thresholds", () => {
  assert.throws(
    () => parseVisualAuditCliArgs(["live", "--drift-threshold", "abc"]),
    /threshold/i,
  );
});

test("parseVisualAuditCliArgs rejects out-of-range thresholds", () => {
  assert.throws(
    () => parseVisualAuditCliArgs(["live", "--drift-threshold", "150"]),
    /between 0 and 100/,
  );
  assert.throws(
    () => parseVisualAuditCliArgs(["live", "--regression-threshold", "-1"]),
    /between 0 and 100/,
  );
});

test("parseVisualAuditCliArgs rejects unknown options", () => {
  assert.throws(
    () => parseVisualAuditCliArgs(["live", "--weird"]),
    /Unknown option/,
  );
});

test("parseVisualAuditCliArgs rejects missing threshold value", () => {
  assert.throws(
    () => parseVisualAuditCliArgs(["live", "--drift-threshold"]),
    /requires a value/i,
  );
});

test("runVisualAudit reports Stable when frozen and live buffers match", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const frozenPng = env.frozenBuffer;
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(frozenPng),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      now: () => "2026-04-11T12:00:00.000Z",
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: frozenPng,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.totalFixtures, 1);
    assert.equal(report.driftedFixtures, 0);
    assert.equal(report.regressedFixtures, 0);
    assert.equal(report.unavailableFixtures, 0);
    assert.equal(report.fixtures.length, 1);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.status, "completed");
    assert.equal(fixtureResult.fixtureLabel, "Stable");
    assert.equal(fixtureResult.lastKnownGoodAt, "2026-04-11T12:00:00.000Z");
    assert.equal(fixtureResult.screens.length, 1);
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Stable");
    assert.equal(screen.driftScore, 100);
    assert.equal(screen.regressionScore, 100);
    assert.equal(screen.frozenLastModified, "2026-03-30T20:59:16Z");
    assert.equal(screen.liveLastModified, "2026-04-10T09:15:00Z");
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit reports Design Drift Detected when live Figma differs from frozen", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const driftedPng = createTestPngBuffer(8, 8, [250, 0, 0, 255]);
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(driftedPng),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      now: () => "2026-04-11T12:00:00.000Z",
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: driftedPng,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.driftedFixtures, 1);
    assert.equal(report.regressedFixtures, 0);
    assert.equal(report.unavailableFixtures, 0);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.status, "completed");
    assert.equal(fixtureResult.fixtureLabel, "Design Drift Detected");
    assert.equal(fixtureResult.lastKnownGoodAt, "2026-04-11T12:00:00.000Z");
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Design Drift Detected");
    assert.ok(
      screen.driftScore < 95,
      `expected driftScore < 95, got ${String(screen.driftScore)}`,
    );
    assert.ok(screen.regressionScore >= 95);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit reports Generator Regression when current generated output differs from live Figma", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const regressedPng = createTestPngBuffer(8, 8, [255, 255, 0, 255]);
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(env.frozenBuffer),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: regressedPng,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.driftedFixtures, 0);
    assert.equal(report.regressedFixtures, 1);
    assert.equal(report.unavailableFixtures, 0);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.status, "completed");
    assert.equal(fixtureResult.fixtureLabel, "Generator Regression");
    assert.equal(fixtureResult.lastKnownGoodAt, "2026-04-09T00:00:00.000Z");
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Generator Regression");
    assert.equal(screen.driftScore, 100);
    assert.ok(screen.regressionScore !== null && screen.regressionScore < 95);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit reports Both Drifted when live Figma and current generated output both differ from frozen", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const driftedPng = createTestPngBuffer(8, 8, [250, 0, 0, 255]);
  const regressedPng = createTestPngBuffer(8, 8, [255, 255, 0, 255]);
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(driftedPng),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: regressedPng,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.driftedFixtures, 1);
    assert.equal(report.regressedFixtures, 1);
    assert.equal(report.unavailableFixtures, 0);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.status, "completed");
    assert.equal(fixtureResult.fixtureLabel, "Both Drifted");
    assert.equal(fixtureResult.lastKnownGoodAt, "2026-04-09T00:00:00.000Z");
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Both Drifted");
    assert.ok(screen.driftScore < 95);
    assert.ok(screen.regressionScore !== null && screen.regressionScore < 95);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit returns an unavailable fixture when the generated surface cannot be compared", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const biggerPng = createTestPngBuffer(16, 16, [0, 100, 200, 255]);
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(biggerPng),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: biggerPng,
            viewport: { width: 16, height: 16 },
          },
        ]),
    });
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.status, "unavailable");
    assert.equal(fixtureResult.fixtureLabel, "Unavailable");
    assert.match(
      fixtureResult.error ?? "",
      /Image dimensions do not match|cannot be normalized/i,
    );
    assert.equal(report.unavailableFixtures, 1);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit applies custom drift threshold", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const frozenPng = env.frozenBuffer;
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(frozenPng),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      driftThreshold: 100.5,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: frozenPng,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    const screen = report.fixtures[0]?.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.driftScore, 100);
    assert.equal(screen.label, "Design Drift Detected");
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit filters to a single fixtureId when provided", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(env.frozenBuffer),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      fixtureId: AUDIT_FIXTURE_ID,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: env.frozenBuffer,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.totalFixtures, 1);
    assert.equal(report.fixtures[0]?.fixtureId, AUDIT_FIXTURE_ID);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit throws when FIGMA_ACCESS_TOKEN is missing", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const priorToken = process.env.FIGMA_ACCESS_TOKEN;
  delete process.env.FIGMA_ACCESS_TOKEN;
  try {
    await assert.rejects(async () => {
      await runVisualAudit({
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
        fetchImpl: async () => new Response("unused"),
        sleepImpl: async () => undefined,
        log: () => undefined,
        executeFixture: async () =>
          createGeneratedRun(AUDIT_FIXTURE_ID, [
            {
              screenId: AUDIT_NODE_ID,
              screenName: "Audit Fixture Frame",
              buffer: env.frozenBuffer,
              viewport: { width: 8, height: 8 },
            },
          ]),
      });
    }, /FIGMA_ACCESS_TOKEN/);
  } finally {
    if (priorToken !== undefined) {
      process.env.FIGMA_ACCESS_TOKEN = priorToken;
    }
    await cleanup(env);
  }
});

test("runVisualAudit caches live Figma image per nodeId within a single run", async () => {
  const metadataWithTwoScreens: Partial<VisualBenchmarkFixtureMetadata> = {
    version: 2,
    screens: [
      {
        screenId: "screen-a",
        screenName: "Screen A",
        nodeId: AUDIT_NODE_ID,
        viewport: { width: 8, height: 8 },
      },
      {
        screenId: "screen-b",
        screenName: "Screen B",
        nodeId: AUDIT_NODE_ID,
        viewport: { width: 8, height: 8 },
      },
    ],
  };
  const env = await createAuditEnvironment({
    frozenRgba: [0, 100, 200, 255],
    metadataOverrides: metadataWithTwoScreens,
  });
  const mock = createSequencedFetch([
    nodePayloadStep,
    imageLookupStep,
    () => pngStep(env.frozenBuffer),
  ]);
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl: mock.fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      executeFixture: async () =>
        createGeneratedRun(AUDIT_FIXTURE_ID, [
          {
            screenId: "screen-a",
            nodeId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            buffer: env.frozenBuffer,
            viewport: { width: 8, height: 8 },
          },
          {
            screenId: "screen-b",
            nodeId: AUDIT_NODE_ID,
            screenName: "Screen B",
            buffer: env.frozenBuffer,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.fixtures[0]?.screens.length, 2);
    assert.equal(
      mock.callCount(),
      3,
      "cache must prevent duplicate fetches for shared nodeId",
    );
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

const makeReport = (
  overrides?: Partial<VisualAuditReport>,
): VisualAuditReport => ({
  auditedAt: "2026-04-11T12:00:00.000Z",
  totalFixtures: 1,
  driftedFixtures: 0,
  regressedFixtures: 0,
  unavailableFixtures: 0,
  fixtures: [
    {
      fixtureId: AUDIT_FIXTURE_ID,
      status: "completed",
      fixtureLabel: "Stable",
      lastKnownGoodAt: "2026-04-09T00:00:00.000Z",
      screens: [
        {
          screenId: AUDIT_NODE_ID,
          screenName: "Audit Fixture Frame",
          driftScore: 100,
          regressionScore: null,
          label: "Stable",
          frozenLastModified: "2026-03-30T20:59:16Z",
          liveLastModified: "2026-04-10T09:15:00Z",
        },
      ],
    },
  ],
  ...overrides,
});

interface CapturedStdout {
  writes: string[];
  restore: () => void;
}

interface CapturedStdio extends CapturedStdout {
  stderrWrites: string[];
  restoreStderr: () => void;
}

const captureStdout = (): CapturedStdout => {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stdout.write;
  return {
    writes,
    restore: () => {
      process.stdout.write = original;
    },
  };
};

const captureStdio = (): CapturedStdio => {
  const stdout = captureStdout();
  const stderrWrites: string[] = [];
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrWrites.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  }) as typeof process.stderr.write;
  return {
    ...stdout,
    stderrWrites,
    restoreStderr: () => {
      process.stderr.write = originalStderr;
    },
  };
};

test("runVisualAuditCli returns exit code 0 when all fixtures are stable", async () => {
  const stable = makeReport();
  const captured = captureStdout();
  try {
    const code = await runVisualAuditCli(["live"], {
      runAudit: async () => stable,
    });
    assert.equal(code, 0);
  } finally {
    captured.restore();
  }
});

test("runVisualAuditCli returns exit code 1 when a fixture drifted", async () => {
  const drifted = makeReport({
    driftedFixtures: 1,
    fixtures: [
      {
        fixtureId: AUDIT_FIXTURE_ID,
        status: "completed",
        fixtureLabel: "Design Drift Detected",
        lastKnownGoodAt: "2026-04-09T00:00:00.000Z",
        screens: [
          {
            screenId: AUDIT_NODE_ID,
            screenName: "Audit Fixture Frame",
            driftScore: 72.5,
            regressionScore: null,
            label: "Design Drift Detected",
            frozenLastModified: "2026-03-30T20:59:16Z",
            liveLastModified: "2026-04-10T09:15:00Z",
          },
        ],
      },
    ],
  });
  const captured = captureStdout();
  try {
    const code = await runVisualAuditCli(["live"], {
      runAudit: async () => drifted,
    });
    assert.equal(code, 1);
    const output = captured.writes.join("");
    assert.match(output, /Design Drift Detected/);
    assert.match(output, /72\.5/);
  } finally {
    captured.restore();
  }
});

test("runVisualAuditCli writes the full report as JSON when --json is set", async () => {
  const stable = makeReport();
  const captured = captureStdio();
  try {
    const code = await runVisualAuditCli(["live", "--json"], {
      runAudit: async (deps) => {
        deps?.log?.("progress message");
        return stable;
      },
    });
    assert.equal(code, 0);
    const output = captured.writes.join("");
    const parsed = JSON.parse(output.trim()) as VisualAuditReport;
    assert.equal(parsed.totalFixtures, 1);
    assert.equal(parsed.fixtures[0]?.fixtureLabel, "Stable");
    assert.equal(captured.stderrWrites.join(""), "progress message\n");
  } finally {
    captured.restore();
    captured.restoreStderr();
  }
});

test("runVisualAuditCli forwards thresholds and fixture to the runAudit dependency", async () => {
  let seenDeps: Record<string, unknown> | null = null;
  const captured = captureStdout();
  try {
    const code = await runVisualAuditCli(
      [
        "live",
        "--fixture",
        "audit-fixture",
        "--drift-threshold",
        "90",
        "--regression-threshold",
        "80",
      ],
      {
        runAudit: async (deps) => {
          seenDeps = deps as unknown as Record<string, unknown>;
          return makeReport();
        },
      },
    );
    assert.equal(code, 0);
    assert.ok(seenDeps !== null);
    const deps = seenDeps as unknown as Record<string, unknown>;
    assert.equal(deps.fixtureId, "audit-fixture");
    assert.equal(deps.driftThreshold, 90);
    assert.equal(deps.regressionThreshold, 80);
  } finally {
    captured.restore();
  }
});

test("runVisualAudit returns fixture-level error and continues when a later fixture is missing its live node", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const missingFixtureId = "missing-node-fixture";
  const missingNodeId = "9:999";
  const missingFrozen = await createSecondAuditFixture({
    fixtureRoot: env.fixtureRoot,
    artifactRoot: env.artifactRoot,
    fixtureId: missingFixtureId,
    nodeId: missingNodeId,
    nodeName: "Missing Node Frame",
    width: 8,
    height: 8,
    frozenRgba: [50, 50, 50, 255],
  });
  const goodFixtureId = AUDIT_FIXTURE_ID;
  const goodImage = env.frozenBuffer;
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes(`/nodes?`) && url.includes(`ids=${encodeURIComponent(AUDIT_NODE_ID)}`)) {
      return createJsonResponse(liveSnapshotPayload);
    }
    if (url.includes(`/nodes?`) && url.includes(`ids=${encodeURIComponent(missingNodeId)}`)) {
      return createJsonResponse({
        name: "Missing Node Board",
        lastModified: "2026-04-10T09:15:00Z",
        nodes: {},
      });
    }
    if (url === AUDIT_IMAGE_URL) {
      return new Response(goodImage, { status: 200 });
    }
    return createJsonResponse({
      err: null,
      images: { [AUDIT_NODE_ID]: AUDIT_IMAGE_URL, [missingNodeId]: AUDIT_IMAGE_URL },
    });
  };
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  try {
    const report = await runVisualAudit({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      fetchImpl,
      sleepImpl: async () => undefined,
      log: () => undefined,
      executeFixture: async (fixtureId) =>
        createGeneratedRun(fixtureId, [
          {
            screenId:
              fixtureId === goodFixtureId ? AUDIT_NODE_ID : missingNodeId,
            nodeId:
              fixtureId === goodFixtureId ? AUDIT_NODE_ID : missingNodeId,
            screenName:
              fixtureId === goodFixtureId ? "Audit Fixture Frame" : "Missing Node Frame",
            buffer:
              fixtureId === goodFixtureId ? goodImage : missingFrozen,
            viewport: { width: 8, height: 8 },
          },
        ]),
    });
    assert.equal(report.totalFixtures, 2);
    assert.equal(report.fixtures.some((fixture) => fixture.status === "unavailable"), true);
    assert.equal(report.unavailableFixtures, 1);
    const unavailable = report.fixtures.find(
      (fixture) => fixture.fixtureId === missingFixtureId,
    );
    assert.ok(unavailable !== undefined);
    assert.equal(unavailable.status, "unavailable");
    assert.match(
      unavailable.error ?? "",
      /does not contain node|missing/i,
    );
    const completed = report.fixtures.find(
      (fixture) => fixture.fixtureId === goodFixtureId,
    );
    assert.ok(completed !== undefined);
    assert.equal(completed.status, "completed");
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});
