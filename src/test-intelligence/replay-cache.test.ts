import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  computeReplayCacheKeyDigest,
  createFileSystemReplayCache,
  createMemoryReplayCache,
  executeWithReplayCache,
  ReplayCacheValidationError,
  type ReplayCache,
} from "./replay-cache.js";

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
      screenId: "s-payment",
      screenName: "Payment",
      nodes: [
        {
          nodeId: "n-iban",
          nodeName: "IBAN",
          nodeType: "TEXT_INPUT",
          text: "IBAN",
        },
      ],
    },
  ],
};

const visualInput: VisualScreenDescription[] = [
  {
    screenId: "s-payment",
    sidecarDeployment: "llama-4-maverick-vision",
    confidenceSummary: { min: 0.8, max: 0.9, mean: 0.85 },
    regions: [
      {
        regionId: "n-iban",
        confidence: 0.85,
        controlType: "text_input",
        label: "IBAN",
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
  title: "Submit valid IBAN",
  objective: "Verify the form accepts a syntactically valid IBAN.",
  level: "system",
  type: "validation",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "boundary_value_analysis",
  preconditions: [],
  testData: ["[REDACTED:IBAN]"],
  steps: [{ index: 1, action: "Enter IBAN" }],
  expectedResults: ["No validation error"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-iban" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["s-payment::field::n-iban"],
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

interface MockLlmCallRecord {
  jobId: string;
  cacheKeyDigest: string;
}

const buildMockLlmClient = (): {
  generate: (jobId: string, cacheKeyDigest: string) => GeneratedTestCaseList;
  calls: MockLlmCallRecord[];
} => {
  const calls: MockLlmCallRecord[] = [];
  return {
    calls,
    generate: (jobId, cacheKeyDigest) => {
      calls.push({ jobId, cacheKeyDigest });
      return buildList(jobId);
    },
  };
};

const compileForFixture = (
  jobId: string,
): {
  cacheKey: ReplayCacheKey;
  cacheKeyDigest: string;
} => {
  const intent = deriveBusinessTestIntentIr({ figma: figmaInput });
  const compiled = compilePrompt({
    jobId,
    intent,
    visual: visualInput,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  return {
    cacheKey: compiled.cacheKey,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
  };
};

const runHitMissCycle = async (cache: ReplayCache): Promise<void> => {
  const { cacheKey, cacheKeyDigest } = compileForFixture("job-1");
  const llm = buildMockLlmClient();

  // First lookup: miss → must invoke LLM client.
  const miss = await cache.lookup(cacheKey);
  assert.equal(miss.hit, false, "expected first lookup to be a miss");
  if (miss.hit === false) {
    const list = llm.generate("job-1", miss.key);
    assert.equal(miss.key, cacheKeyDigest);
    await cache.store(cacheKey, list);
  }
  assert.equal(llm.calls.length, 1, "first miss must invoke the LLM client");

  // Second lookup: hit → must NOT invoke the LLM client.
  const hit = await cache.lookup(cacheKey);
  assert.equal(hit.hit, true, "expected second lookup to be a hit");
  if (hit.hit === true) {
    assert.equal(hit.entry.testCases.jobId, "job-1");
  }
  // No new generate calls happened on the cache hit.
  assert.equal(llm.calls.length, 1, "cache hit must not invoke the LLM client");
};

test("memory cache: miss → store → hit cycle skips the mocked LLM client", async () => {
  const cache = createMemoryReplayCache();
  await runHitMissCycle(cache);
});

test("replay execution: miss calls LLM once, stores result, and returns cacheHit=false", async () => {
  const cache = createMemoryReplayCache();
  const { cacheKey, cacheKeyDigest } = compileForFixture("job-1");
  const llm = buildMockLlmClient();

  const result = await executeWithReplayCache({
    cache,
    cacheKey,
    generate: async (digest) => {
      const generated = llm.generate("job-1", digest);
      return {
        ...generated,
        testCases: generated.testCases.map((testCase) => ({
          ...testCase,
          audit: { ...testCase.audit, cacheHit: true },
        })),
      };
    },
  });

  assert.equal(result.cacheHit, false);
  assert.equal(result.key, cacheKeyDigest);
  assert.equal(llm.calls.length, 1);
  assert.equal(result.testCases.testCases[0]!.audit.cacheHit, false);

  const stored = await cache.lookup(cacheKey);
  assert.equal(stored.hit, true);
});

test("replay execution: hit skips LLM and returns audit cacheHit=true", async () => {
  const cache = createMemoryReplayCache();
  const { cacheKey, cacheKeyDigest } = compileForFixture("job-1");
  await cache.store(cacheKey, buildList("job-1"));
  const llm = buildMockLlmClient();

  const result = await executeWithReplayCache({
    cache,
    cacheKey,
    generate: async (digest) => llm.generate("job-1", digest),
  });

  assert.equal(result.cacheHit, true);
  assert.equal(result.key, cacheKeyDigest);
  assert.equal(llm.calls.length, 0, "cache hit must not invoke the LLM client");
  assert.equal(result.testCases.testCases[0]!.audit.cacheHit, true);

  const stored = await cache.lookup(cacheKey);
  assert.equal(stored.hit, true);
  if (stored.hit) {
    assert.equal(
      stored.entry.testCases.testCases[0]!.audit.cacheHit,
      false,
      "cache storage keeps the original generated artifact immutable",
    );
  }
});

test("memory cache: lookup returns a deep clone (caller cannot poison cache)", async () => {
  const cache = createMemoryReplayCache();
  const { cacheKey } = compileForFixture("job-1");
  await cache.store(cacheKey, buildList("job-1"));
  const first = await cache.lookup(cacheKey);
  assert.equal(first.hit, true);
  if (first.hit === true) {
    first.entry.testCases.testCases[0]!.title = "MUTATED";
  }
  const second = await cache.lookup(cacheKey);
  assert.equal(second.hit, true);
  if (second.hit === true) {
    assert.notEqual(second.entry.testCases.testCases[0]!.title, "MUTATED");
  }
});

test("filesystem cache: miss → store → hit cycle persists JSON on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-fs-"));
  try {
    const cache = createFileSystemReplayCache(root);
    await runHitMissCycle(cache);
    // A second lookup with a fresh cache instance pointing at the same
    // directory must still hit (filesystem-based identity).
    const fresh = createFileSystemReplayCache(root);
    const { cacheKey } = compileForFixture("job-1");
    const result = await fresh.lookup(cacheKey);
    assert.equal(result.hit, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem cache: rejects writing an invalid GeneratedTestCaseList", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-fs-"));
  try {
    const cache = createFileSystemReplayCache(root);
    const { cacheKey } = compileForFixture("job-1");
    const invalid = {
      schemaVersion: "9.9.9",
      jobId: "job-1",
      testCases: [],
    } as unknown as GeneratedTestCaseList;
    await assert.rejects(
      async () => cache.store(cacheKey, invalid),
      ReplayCacheValidationError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem cache: rejects reading a corrupted file", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-fs-"));
  try {
    const cache = createFileSystemReplayCache(root);
    const { cacheKey } = compileForFixture("job-1");
    const digest = computeReplayCacheKeyDigest(cacheKey);
    // Write a file that claims the wrong key, mimicking corruption.
    await writeFile(
      join(root, `${digest}.json`),
      JSON.stringify({
        key: "deadbeef",
        storedAt: "2026-04-25T00:00:00.000Z",
        testCases: buildList("job-1"),
      }),
      "utf8",
    );
    await assert.rejects(
      async () => cache.lookup(cacheKey),
      ReplayCacheValidationError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory cache: rejects writing an invalid GeneratedTestCaseList", async () => {
  const cache = createMemoryReplayCache();
  const { cacheKey } = compileForFixture("job-1");
  const invalid = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "",
    testCases: [],
  } as unknown as GeneratedTestCaseList;
  await assert.rejects(
    async () => cache.store(cacheKey, invalid),
    ReplayCacheValidationError,
  );
});

test("filesystem cache: stored JSON file is parseable and self-describes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-fs-"));
  try {
    const cache = createFileSystemReplayCache(root);
    const { cacheKey } = compileForFixture("job-1");
    const digest = computeReplayCacheKeyDigest(cacheKey);
    await cache.store(cacheKey, buildList("job-1"));
    const raw = await readFile(join(root, `${digest}.json`), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed["key"], digest);
    assert.equal(typeof parsed["storedAt"], "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache key digest: stable for the same key inputs", () => {
  const { cacheKey: a } = compileForFixture("job-1");
  const { cacheKey: b } = compileForFixture("job-2");
  // jobId never participates in the key; both compilations must produce
  // the same key shape and digest.
  assert.deepEqual(a, b);
  assert.equal(computeReplayCacheKeyDigest(a), computeReplayCacheKeyDigest(b));
});
