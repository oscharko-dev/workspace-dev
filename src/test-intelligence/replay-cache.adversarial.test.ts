import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
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
  type TenantScope,
  type VisualScreenDescription,
} from "../contracts/index.js";
import { createFileSystemA11yJudgeCache } from "./a11y-judge.js";
import { createFileSystemFaithfulnessJudgeCache } from "./faithfulness-judge.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
} from "./intent-derivation.js";
import { createFileSystemLogicJudgeCache } from "./logic-judge.js";
import { compilePrompt } from "./prompt-compiler.js";
import { createPersistentReplayCache } from "./replay-cache-persistent.js";
import { computeReplayCacheKeyDigest } from "./replay-cache.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Tenants A and B share a byte-identical `ReplayCacheKey` so the deterministic
// digest is the same across both tenants. Isolation must therefore come from
// the cache *layout*, not from key divergence — exactly the threat model
// Issue #1944 closes.

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
): { cacheKey: ReplayCacheKey; cacheKeyDigest: string } => {
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

const TENANT_A: TenantScope = {
  tenantId: "tenant-a",
  environmentId: "prod",
  projectId: "proj-x",
};
const TENANT_B: TenantScope = {
  tenantId: "tenant-b",
  environmentId: "prod",
  projectId: "proj-x",
};

// ── Replay-cache: cross-tenant denial ────────────────────────────────────────

test("adversarial: tenant A cannot read tenant B's replay-cache entry even with identical input hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-adv-"));
  try {
    const { cacheKey, cacheKeyDigest } = compileForFixture("job-shared");
    const list = buildList("job-shared");

    const cacheA = createPersistentReplayCache(root, { tenantScope: TENANT_A });
    const cacheB = createPersistentReplayCache(root, { tenantScope: TENANT_B });

    // Populate tenant A only.
    await cacheA.store(cacheKey, list);

    // Both caches see the same deterministic key digest …
    assert.equal(cacheA.computeKey(cacheKey), cacheKeyDigest);
    assert.equal(cacheB.computeKey(cacheKey), cacheKeyDigest);

    // … but tenant B's loader cannot reach tenant A's directory.
    const missB = await cacheB.lookup(cacheKey);
    assert.equal(
      missB.hit,
      false,
      "tenant B must not see tenant A's replay-cache entry",
    );

    // Tenant A still hits its own entry.
    const hitA = await cacheA.lookup(cacheKey);
    assert.equal(hitA.hit, true);

    // On-disk paths confirm strict directory partitioning.
    const fileA = join(
      root,
      TENANT_A.tenantId,
      TENANT_A.environmentId,
      TENANT_A.projectId!,
      `${cacheKeyDigest}.json`,
    );
    const fileB = join(
      root,
      TENANT_B.tenantId,
      TENANT_B.environmentId,
      TENANT_B.projectId!,
      `${cacheKeyDigest}.json`,
    );
    await assert.doesNotReject(stat(fileA), "tenant A entry must exist");
    await assert.rejects(stat(fileB), "tenant B entry must not exist");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adversarial: same tenant + different environment must not share replay-cache entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-env-"));
  try {
    const { cacheKey } = compileForFixture("job-env");
    const list = buildList("job-env");

    const prod = createPersistentReplayCache(root, {
      tenantScope: { tenantId: "tenant-a", environmentId: "prod" },
    });
    const staging = createPersistentReplayCache(root, {
      tenantScope: { tenantId: "tenant-a", environmentId: "staging" },
    });

    await prod.store(cacheKey, list);

    const missStaging = await staging.lookup(cacheKey);
    assert.equal(
      missStaging.hit,
      false,
      "staging env must not see prod env's entry within the same tenant",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adversarial: same tenant + same env + different project must not share replay-cache entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-proj-"));
  try {
    const { cacheKey } = compileForFixture("job-proj");
    const list = buildList("job-proj");

    const projX = createPersistentReplayCache(root, {
      tenantScope: {
        tenantId: "tenant-a",
        environmentId: "prod",
        projectId: "proj-x",
      },
    });
    const projY = createPersistentReplayCache(root, {
      tenantScope: {
        tenantId: "tenant-a",
        environmentId: "prod",
        projectId: "proj-y",
      },
    });

    await projX.store(cacheKey, list);

    const missY = await projY.lookup(cacheKey);
    assert.equal(
      missY.hit,
      false,
      "proj-y must not see proj-x's entry within the same tenant + env",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adversarial: omitted projectId is normalised to 'default' and isolated from explicit 'default' siblings", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-replay-default-"));
  try {
    const { cacheKey, cacheKeyDigest } = compileForFixture("job-default");
    const list = buildList("job-default");

    const omitted = createPersistentReplayCache(root, {
      tenantScope: { tenantId: "tenant-a", environmentId: "prod" },
    });
    await omitted.store(cacheKey, list);

    // The path materialises under projectId="default".
    const onDisk = join(
      root,
      "tenant-a",
      "prod",
      "default",
      `${cacheKeyDigest}.json`,
    );
    await assert.doesNotReject(stat(onDisk));

    // An explicit projectId="default" caller hits the same partition (this is
    // the documented backwards-compat contract).
    const explicit = createPersistentReplayCache(root, {
      tenantScope: {
        tenantId: "tenant-a",
        environmentId: "prod",
        projectId: "default",
      },
    });
    const hit = await explicit.lookup(cacheKey);
    assert.equal(
      hit.hit,
      true,
      "explicit projectId='default' must hit the same partition as an omitted projectId",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── Loader-level path-traversal denial ───────────────────────────────────────

test("adversarial: replay-cache loader rejects path-traversal tenant scope segments", () => {
  const cases: ReadonlyArray<{ field: keyof TenantScope; value: string }> = [
    { field: "tenantId", value: "" },
    { field: "tenantId", value: ".." },
    { field: "tenantId", value: "." },
    { field: "tenantId", value: "../tenant-b" },
    { field: "tenantId", value: "tenant-a/tenant-b" },
    { field: "tenantId", value: "tenant-a\\tenant-b" },
    { field: "environmentId", value: "" },
    { field: "environmentId", value: ".." },
    { field: "environmentId", value: "prod/../staging" },
    { field: "projectId", value: "" },
    { field: "projectId", value: ".." },
    { field: "projectId", value: "proj-x/proj-y" },
  ];
  for (const { field, value } of cases) {
    const scope: TenantScope = {
      tenantId: field === "tenantId" ? value : "tenant-a",
      environmentId: field === "environmentId" ? value : "prod",
      ...(field === "projectId" ? { projectId: value } : { projectId: "proj-x" }),
    };
    assert.throws(
      () => createPersistentReplayCache("/tmp/does-not-matter", { tenantScope: scope }),
      RangeError,
      `expected RangeError for ${field}=${JSON.stringify(value)}`,
    );
  }
});

test("adversarial: logic-judge cache loader rejects path-traversal tenant scope segments", () => {
  assert.throws(
    () =>
      createFileSystemLogicJudgeCache("/tmp/does-not-matter", {
        tenantScope: { tenantId: "../tenant-b", environmentId: "prod" },
      }),
    RangeError,
  );
});

test("adversarial: faithfulness-judge cache loader rejects path-traversal tenant scope segments", () => {
  assert.throws(
    () =>
      createFileSystemFaithfulnessJudgeCache("/tmp/does-not-matter", {
        tenantScope: { tenantId: "tenant-a", environmentId: "prod/../staging" },
      }),
    RangeError,
  );
});

test("adversarial: a11y-judge cache loader rejects path-traversal tenant scope segments", () => {
  assert.throws(
    () =>
      createFileSystemA11yJudgeCache("/tmp/does-not-matter", {
        tenantScope: {
          tenantId: "tenant-a",
          environmentId: "prod",
          projectId: "..",
        },
      }),
    RangeError,
  );
});

// ── Judge caches: cross-tenant denial ────────────────────────────────────────
//
// The cache implementations only sha256 the key and JSON-encode the verdict —
// schema validation lives in the judge runners, not in the loaders. The
// adversarial tests below construct opaque key/verdict shapes via `as never`
// because we are exercising on-disk isolation, not verdict semantics.

const opaqueJudgeKey = {
  passKind: "tenant-isolation",
  marker: "shared-across-tenants",
} as const;

const opaqueJudgeVerdict = { sentinel: "verdict" } as const;

test("adversarial: tenant A cannot read tenant B's logic-judge cache entry even with identical key", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-logic-judge-adv-"));
  try {
    const cacheA = createFileSystemLogicJudgeCache(root, { tenantScope: TENANT_A });
    const cacheB = createFileSystemLogicJudgeCache(root, { tenantScope: TENANT_B });

    await cacheA.store(opaqueJudgeKey as never, opaqueJudgeVerdict as never);

    const hitA = await cacheA.lookup(opaqueJudgeKey as never);
    assert.equal(hitA.hit, true);

    const missB = await cacheB.lookup(opaqueJudgeKey as never);
    assert.equal(
      missB.hit,
      false,
      "tenant B must not see tenant A's logic-judge entry",
    );

    // Confirm tenant B's directory was never created.
    const tenantBRoot = join(root, TENANT_B.tenantId);
    await assert.rejects(
      readdir(tenantBRoot),
      { code: "ENOENT" },
      "tenant B must have no on-disk presence",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adversarial: tenant A cannot read tenant B's faithfulness-judge cache entry even with identical key", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-faithfulness-judge-adv-"));
  try {
    const cacheA = createFileSystemFaithfulnessJudgeCache(root, {
      tenantScope: TENANT_A,
    });
    const cacheB = createFileSystemFaithfulnessJudgeCache(root, {
      tenantScope: TENANT_B,
    });

    await cacheA.store(opaqueJudgeKey as never, opaqueJudgeVerdict as never);

    const missB = await cacheB.lookup(opaqueJudgeKey as never);
    assert.equal(
      missB.hit,
      false,
      "tenant B must not see tenant A's faithfulness-judge entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adversarial: tenant A cannot read tenant B's a11y-judge cache entry even with identical key", async () => {
  const root = await mkdtemp(join(tmpdir(), "wsd-a11y-judge-adv-"));
  try {
    const cacheA = createFileSystemA11yJudgeCache(root, { tenantScope: TENANT_A });
    const cacheB = createFileSystemA11yJudgeCache(root, { tenantScope: TENANT_B });

    await cacheA.store(opaqueJudgeKey as never, opaqueJudgeVerdict as never);

    const missB = await cacheB.lookup(opaqueJudgeKey as never);
    assert.equal(
      missB.hit,
      false,
      "tenant B must not see tenant A's a11y-judge entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── Digest invariance — isolation is by directory, not by key bias ───────────

test("adversarial: tenant scope must NOT be folded into the replay-cache key digest", () => {
  const { cacheKey } = compileForFixture("job-digest");
  const digest = computeReplayCacheKeyDigest(cacheKey);
  // Two tenants with the same key compute the same digest. Isolation lives
  // exclusively in the on-disk layout — confirming this prevents accidental
  // future drift that might silently re-enable cross-tenant collisions if
  // the digest scheme ever folds in tenant identity.
  const cacheA = createPersistentReplayCache("/tmp/does-not-matter", {
    tenantScope: TENANT_A,
  });
  const cacheB = createPersistentReplayCache("/tmp/does-not-matter", {
    tenantScope: TENANT_B,
  });
  assert.equal(cacheA.computeKey(cacheKey), digest);
  assert.equal(cacheB.computeKey(cacheKey), digest);
});
