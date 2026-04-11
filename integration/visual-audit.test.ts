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
import { saveVisualBenchmarkLastRunArtifact } from "./visual-benchmark-runner.js";
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

const auditFixtureManifest: VisualBenchmarkFixtureManifest = {
  version: 1,
  fixtureId: AUDIT_FIXTURE_ID,
  visualQuality: {
    frozenReferenceImage: "reference.png",
    frozenReferenceMetadata: "metadata.json",
  },
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

const createAuditEnvironment = async (options: {
  frozenRgba: readonly [number, number, number, number];
  metadataOverrides?: Partial<VisualBenchmarkFixtureMetadata>;
}): Promise<AuditEnvironment> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-audit-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(path.join(fixtureRoot, AUDIT_FIXTURE_ID), { recursive: true });
  const metadata: VisualBenchmarkFixtureMetadata = {
    ...auditFixtureMetadata,
    ...options.metadataOverrides,
  };
  await writeVisualBenchmarkFixtureManifest(
    AUDIT_FIXTURE_ID,
    auditFixtureManifest,
    { fixtureRoot, artifactRoot },
  );
  await writeVisualBenchmarkFixtureMetadata(AUDIT_FIXTURE_ID, metadata, {
    fixtureRoot,
    artifactRoot,
  });
  await writeVisualBenchmarkFixtureInputs(
    AUDIT_FIXTURE_ID,
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
    { fixtureRoot, artifactRoot },
  );
  const frozenBuffer = createTestPngBuffer(
    metadata.viewport.width,
    metadata.viewport.height,
    options.frozenRgba,
  );
  await writeVisualBenchmarkReference(AUDIT_FIXTURE_ID, frozenBuffer, {
    fixtureRoot,
    artifactRoot,
  });
  return { fixtureRoot, artifactRoot, frozenBuffer };
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
    });
    assert.equal(report.totalFixtures, 1);
    assert.equal(report.driftedFixtures, 0);
    assert.equal(report.regressedFixtures, 0);
    assert.equal(report.fixtures.length, 1);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.fixtureLabel, "Stable");
    assert.equal(fixtureResult.lastKnownGoodAt, "2026-04-09T00:00:00.000Z");
    assert.equal(fixtureResult.screens.length, 1);
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Stable");
    assert.equal(screen.driftScore, 100);
    assert.equal(screen.regressionScore, null);
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
    });
    assert.equal(report.driftedFixtures, 1);
    assert.equal(report.regressedFixtures, 0);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.fixtureLabel, "Design Drift Detected");
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Design Drift Detected");
    assert.ok(
      screen.driftScore < 95,
      `expected driftScore < 95, got ${String(screen.driftScore)}`,
    );
    assert.equal(screen.regressionScore, null);
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit reports Generator Regression when last-run artifact differs from frozen", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const regressedPng = createTestPngBuffer(8, 8, [255, 255, 0, 255]);
  await saveVisualBenchmarkLastRunArtifact(
    {
      fixtureId: AUDIT_FIXTURE_ID,
      score: 60,
      ranAt: "2026-04-10T11:00:00.000Z",
      viewport: { width: 8, height: 8 },
      actualImageBuffer: regressedPng,
    },
    { fixtureRoot: env.fixtureRoot, artifactRoot: env.artifactRoot },
  );
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
    });
    assert.equal(report.driftedFixtures, 0);
    assert.equal(report.regressedFixtures, 1);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.fixtureLabel, "Generator Regression");
    const screen = fixtureResult.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.label, "Generator Regression");
    assert.equal(screen.driftScore, 100);
    assert.ok(
      screen.regressionScore !== null && screen.regressionScore < 95,
      `expected regressionScore < 95, got ${String(screen.regressionScore)}`,
    );
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await cleanup(env);
  }
});

test("runVisualAudit reports Both Drifted when live and last-run both differ from frozen", async () => {
  const env = await createAuditEnvironment({ frozenRgba: [0, 100, 200, 255] });
  const driftedPng = createTestPngBuffer(8, 8, [250, 0, 0, 255]);
  const regressedPng = createTestPngBuffer(8, 8, [255, 255, 0, 255]);
  await saveVisualBenchmarkLastRunArtifact(
    {
      fixtureId: AUDIT_FIXTURE_ID,
      score: 60,
      ranAt: "2026-04-10T11:00:00.000Z",
      viewport: { width: 8, height: 8 },
      actualImageBuffer: regressedPng,
    },
    { fixtureRoot: env.fixtureRoot, artifactRoot: env.artifactRoot },
  );
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
    });
    assert.equal(report.driftedFixtures, 1);
    assert.equal(report.regressedFixtures, 1);
    const fixtureResult = report.fixtures[0];
    assert.ok(fixtureResult !== undefined);
    assert.equal(fixtureResult.fixtureLabel, "Both Drifted");
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

test("runVisualAudit returns driftScore 0 on dimension mismatch", async () => {
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
    });
    const screen = report.fixtures[0]?.screens[0];
    assert.ok(screen !== undefined);
    assert.equal(screen.driftScore, 0);
    assert.equal(screen.label, "Design Drift Detected");
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
  fixtures: [
    {
      fixtureId: AUDIT_FIXTURE_ID,
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
  const captured = captureStdout();
  try {
    const code = await runVisualAuditCli(["live", "--json"], {
      runAudit: async () => stable,
    });
    assert.equal(code, 0);
    const output = captured.writes.join("");
    const parsed = JSON.parse(output.trim()) as VisualAuditReport;
    assert.equal(parsed.totalFixtures, 1);
    assert.equal(parsed.fixtures[0]?.fixtureLabel, "Stable");
  } finally {
    captured.restore();
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
