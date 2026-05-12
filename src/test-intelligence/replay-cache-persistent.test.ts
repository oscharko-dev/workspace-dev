import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type CompiledPromptModelBinding,
  type CompiledPromptVisualBinding,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type ReplayCacheKey,
  type VisualScreenDescription,
} from "../contracts/index.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
} from "./intent-derivation.js";
import { compilePrompt } from "./prompt-compiler.js";
import { computeReplayCacheKeyDigest } from "./replay-cache.js";
import {
  createPersistentReplayCache,
  DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET,
  DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS,
  loadPersistentCircuitBreakerState,
  writePersistentCircuitBreakerState,
} from "./replay-cache-persistent.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleModelBinding: CompiledPromptModelBinding = {
  modelRevision: "gpt-oss-120b@2026-04-25",
  gatewayRelease: "azure-ai-foundry@2026.04",
  seed: 7,
};

const sampleVisualBinding: CompiledPromptVisualBinding = {
  schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  selectedDeployment: "llama-4-maverick-vision",
  fallbackReason: "none",
  fixtureImageHash: "f".repeat(64),
  screenCount: 1,
};

const figmaInput: IntentDerivationFigmaInput = {
  source: { kind: "figma_local_json" },
  screens: [
    {
      screenId: "s-login",
      screenName: "Login",
      nodes: [
        {
          nodeId: "n-email",
          nodeName: "Email",
          nodeType: "TEXT_INPUT",
          text: "Email",
        },
      ],
    },
  ],
};

const visualInput: VisualScreenDescription[] = [
  {
    screenId: "s-login",
    sidecarDeployment: "llama-4-maverick-vision",
    confidenceSummary: { min: 0.8, max: 0.9, mean: 0.85 },
    regions: [
      {
        regionId: "n-email",
        confidence: 0.85,
        controlType: "text_input",
        label: "Email",
      },
    ],
  },
];

const buildSampleTestCase = (jobId: string): GeneratedTestCase => ({
  id: `${jobId}::tc-001`,
  sourceJobId: jobId,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit valid email",
  objective: "Verify the login form accepts a valid email address.",
  level: "system",
  type: "validation",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "boundary_value_analysis",
  preconditions: [],
  testData: ["user@example.com"],
  steps: [{ index: 1, action: "Enter email" }],
  expectedResults: ["No validation error"],
  figmaTraceRefs: [{ screenId: "s-login", nodeId: "n-email" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["s-login::field::n-email"],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
  },
  reviewState: "draft",
  audit: {
    jobId,
    generatedAt: "2026-04-25T00:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "abc",
    inputHash: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
  },
});

const buildList = (jobId: string): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId,
  testCases: [buildSampleTestCase(jobId)],
});

const compileForFixture = (
  jobId: string,
  policyBundleVersion = "policy-2026-04-25",
): { cacheKey: ReplayCacheKey; cacheKeyDigest: string } => {
  const intent = deriveBusinessTestIntentIr({ figma: figmaInput });
  const compiled = compilePrompt({
    jobId,
    intent,
    visual: visualInput,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion,
  });
  return {
    cacheKey: compiled.cacheKey,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
  };
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test("persistent cache: constants have expected values", () => {
  assert.equal(
    DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET,
    100 * 1024 * 1024,
  );
  assert.equal(
    DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS,
    10 * 60 * 1000,
  );
});

test("persistent cache: throws on empty tenant scope segment", () => {
  assert.throws(
    () =>
      createPersistentReplayCache("/tmp/does-not-matter", {
        tenantScope: { tenantId: "", environmentId: "default" },
      }),
    RangeError,
  );
});

test("persistent cache: rejects path-traversal tenant scope segments", () => {
  for (const bad of ["..", ".", "a/b", "a\\b", "a\0b"]) {
    assert.throws(
      () =>
        createPersistentReplayCache("/tmp/does-not-matter", {
          tenantScope: { tenantId: bad, environmentId: "default" },
        }),
      RangeError,
      `expected RangeError for tenantId=${JSON.stringify(bad)}`,
    );
  }
});

test("persistent cache: hit/miss correctness across simulated process restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-persistent-cache-"));
  try {
    const tenantScope = {
      tenantId: "tenant-restart",
      environmentId: "prod",
    } as const;
    const { cacheKey, cacheKeyDigest } = compileForFixture("job-restart");
    const list = buildList("job-restart");

    // First process: write to cache.
    const cacheA = createPersistentReplayCache(root, { tenantScope });
    const miss = await cacheA.lookup(cacheKey);
    assert.equal(miss.hit, false, "initial lookup must be a miss");
    await cacheA.store(cacheKey, list);

    // Verify file exists on disk under <tenantId>/<envId>/<projectId>/.
    const filePath = join(
      root,
      tenantScope.tenantId,
      tenantScope.environmentId,
      "default",
      `${cacheKeyDigest}.json`,
    );
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed["key"], cacheKeyDigest, "on-disk key matches digest");

    // Second process (simulated): create a fresh cache instance pointing to
    // the same rootDir — models a process restart where in-memory state is lost.
    const cacheB = createPersistentReplayCache(root, { tenantScope });
    const hit = await cacheB.lookup(cacheKey);
    assert.equal(hit.hit, true, "fresh instance must hit the persisted entry");
    if (hit.hit) {
      assert.equal(hit.entry.testCases.jobId, "job-restart");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cache: concurrent writes for the same key do not corrupt the entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-persistent-cache-concurrent-"));
  try {
    const tenantScope = {
      tenantId: "tenant-concurrent",
      environmentId: "prod",
    } as const;
    const { cacheKey } = compileForFixture("job-concurrent");
    const list = buildList("job-concurrent");

    const cache = createPersistentReplayCache(root, { tenantScope });
    // Two concurrent store calls — last rename wins; since content is
    // deterministic, both produce the same valid entry.
    await Promise.all([
      cache.store(cacheKey, list),
      cache.store(cacheKey, list),
    ]);

    const result = await cache.lookup(cacheKey);
    assert.equal(result.hit, true, "entry must be present after concurrent writes");
    if (result.hit) {
      assert.equal(result.entry.testCases.jobId, "job-concurrent");
      assert.equal(result.entry.testCases.testCases.length, 1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cache: circuit-breaker state is persisted atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-circuit-breaker-state-"));
  try {
    const statePath = join(root, "sandbox", "replay-cache", "circuit-breaker-state.json");
    await writePersistentCircuitBreakerState({
      path: statePath,
      key: "tenant:prod:default:visual_primary:llama-4-maverick-vision",
      entry: {
        updatedAt: "2026-05-08T12:00:00.000Z",
        snapshot: {
          state: "open",
          consecutiveFailures: 2,
          openedAtMs: 42,
        },
      },
    });
    const restored = await loadPersistentCircuitBreakerState({
      path: statePath,
      key: "tenant:prod:default:visual_primary:llama-4-maverick-vision",
    });
    assert.deepEqual(restored, {
      updatedAt: "2026-05-08T12:00:00.000Z",
      snapshot: {
        state: "open",
        consecutiveFailures: 2,
        openedAtMs: 42,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cache: tenant-scope isolation — two scopes cannot share entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-persistent-cache-scope-"));
  try {
    const { cacheKey } = compileForFixture("job-scope");
    const list = buildList("job-scope");

    const cacheA = createPersistentReplayCache(root, {
      tenantScope: { tenantId: "tenant-a", environmentId: "prod" },
    });
    const cacheB = createPersistentReplayCache(root, {
      tenantScope: { tenantId: "tenant-b", environmentId: "prod" },
    });

    // Store in tenant-a only.
    await cacheA.store(cacheKey, list);

    // tenant-a hits.
    const hitA = await cacheA.lookup(cacheKey);
    assert.equal(hitA.hit, true, "tenant-a must hit its own entry");

    // tenant-b misses — no cross-tenant bleed.
    const missB = await cacheB.lookup(cacheKey);
    assert.equal(
      missB.hit,
      false,
      "tenant-b must not access tenant-a's cache entry",
    );

    // Verify separate on-disk directories.
    const digestA = computeReplayCacheKeyDigest(cacheKey);
    const fileA = join(
      root,
      "tenant-a",
      "prod",
      "default",
      `${digestA}.json`,
    );
    const fileB = join(
      root,
      "tenant-b",
      "prod",
      "default",
      `${digestA}.json`,
    );
    await assert.doesNotReject(stat(fileA), "tenant-a file must exist");
    await assert.rejects(stat(fileB), "tenant-b file must not exist");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cache: LRU eviction respects the byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-persistent-cache-evict-"));
  try {
    const tenantScope = {
      tenantId: "tenant-evict",
      environmentId: "prod",
    } as const;

    // Use a very small byteBudget (1 byte) so every store triggers eviction.
    const tinyBudgetCache = createPersistentReplayCache(root, {
      tenantScope,
      byteBudget: 1,
    });

    // Build two distinct cache keys. Execution job ids are intentionally
    // ignored by replay identity, so vary a real generation input instead.
    const { cacheKey: keyA } = compileForFixture("job-evict-a");
    const { cacheKey: keyB } = compileForFixture(
      "job-evict-b",
      "policy-2026-04-26",
    );
    const listA = buildList("job-evict-a");
    const listB = buildList("job-evict-b");

    // If they hash to the same key, use a workaround by checking the digests.
    const digestA = computeReplayCacheKeyDigest(keyA);
    const digestB = computeReplayCacheKeyDigest(keyB);

    if (digestA === digestB) {
      // Same key — eviction test still works: store once, entry is present,
      // then a tiny budget would evict it after the next store of another key.
      // Skip the two-key variant if keys happen to collide.
      return;
    }

    // Store A (budget=1 byte → A is written and the dir has only A; eviction
    // may remove A immediately if A's size > 1 byte, which it will be).
    await tinyBudgetCache.store(keyA, listA);

    // Store B → eviction runs and removes A (oldest) to get under budget.
    // After eviction only B remains (but B itself may also be evicted since
    // it is larger than 1 byte — the guarantee is that the total never exceeds
    // budget AFTER a new entry is added and before the function returns).
    await tinyBudgetCache.store(keyB, listB);

    // At most one entry can survive a 1-byte budget; with two distinct keys
    // and JSON entries that are easily > 1 byte each, the total after
    // storing B and evicting is ≤ the size of B (oldest A was removed).
    // Either B is present (eviction removed A) or nothing is (B was also
    // removed, which is allowed when B > budget).
    // What must NOT happen: both A and B are present with combined size > 1.
    const scopeDir = join(
      root,
      tenantScope.tenantId,
      tenantScope.environmentId,
      "default",
    );
    const { readdir, stat: statFn } = await import("node:fs/promises");
    const entries = await readdir(scopeDir).catch(() => [] as string[]);
    const jsonFiles = entries.filter((e) => e.endsWith(".json"));

    if (jsonFiles.length >= 2) {
      // Both entries survived — verify total size ≤ budget (1 byte).
      let totalBytes = 0;
      for (const name of jsonFiles) {
        const s = await statFn(join(scopeDir, name));
        totalBytes += s.size;
      }
      assert.ok(
        totalBytes <= 1,
        `total cache size ${totalBytes} bytes exceeds budget of 1 byte`,
      );
    }
    // 0 or 1 entries remaining is the expected case with a 1-byte budget.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cache: stale .tmp files are cleaned before a new write", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-persistent-cache-stale-"));
  try {
    const tenantScope = {
      tenantId: "tenant-stale",
      environmentId: "prod",
    } as const;
    const { cacheKey, cacheKeyDigest } = compileForFixture("job-stale");
    const list = buildList("job-stale");
    const { mkdir } = await import("node:fs/promises");

    // Create a fake stale .tmp file with a past mtime.
    const scopeDir = join(
      root,
      tenantScope.tenantId,
      tenantScope.environmentId,
      "default",
    );
    await mkdir(scopeDir, { recursive: true });
    const staleTmpPath = join(scopeDir, `${cacheKeyDigest}.99999.tmp`);
    await writeFile(staleTmpPath, "stale-content", "utf8");
    // Backdate the mtime by 20 minutes (well past the 10-minute threshold).
    const past = new Date(Date.now() - 20 * 60 * 1000);
    const { utimes } = await import("node:fs/promises");
    await utimes(staleTmpPath, past, past);

    // Perform a store — the stale .tmp must be cleaned up.
    const cache = createPersistentReplayCache(root, {
      tenantScope,
      staleThresholdMs: 5 * 60 * 1000, // 5-minute threshold
    });
    await cache.store(cacheKey, list);

    // The stale file should have been removed.
    await assert.rejects(
      stat(staleTmpPath),
      { code: "ENOENT" },
      "stale .tmp file must be removed before a new write",
    );

    // The legitimate entry is still accessible.
    const hit = await cache.lookup(cacheKey);
    assert.equal(hit.hit, true, "entry must be present after stale cleanup");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
