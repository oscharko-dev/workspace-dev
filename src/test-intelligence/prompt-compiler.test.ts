import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type CompiledPromptCustomContext,
  type CompiledPromptModelBinding,
  type CompiledPromptVisualBinding,
  type VisualScreenDescription,
} from "../contracts/index.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
} from "./intent-derivation.js";
import {
  COMPILED_SYSTEM_PROMPT,
  COMPILED_USER_PROMPT_PREAMBLE,
  compilePrompt,
} from "./prompt-compiler.js";
import { buildGeneratedTestCaseListJsonSchema } from "./generated-test-case-schema.js";
import { reconcileSources } from "./reconciliation.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

const PII_SUBSTRINGS = [
  "DE89370400440532013000",
  "4111111111111111",
  "max.mustermann@sparkasse.de",
  "+49 221 1234567",
  "Max Mustermann",
  "86095742719",
];

const sampleModelBinding: CompiledPromptModelBinding = {
  modelRevision: "gpt-oss-120b@2026-04-25",
  gatewayRelease: "azure-ai-foundry@2026.04",
  seed: 42,
};

const sampleVisualBinding: CompiledPromptVisualBinding = {
  schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  selectedDeployment: "llama-4-maverick-vision",
  fallbackReason: "none",
  fixtureImageHash: "f".repeat(64),
  screenCount: 1,
};

const loadFixture = async (): Promise<{
  intent: ReturnType<typeof deriveBusinessTestIntentIr>;
  visual: VisualScreenDescription[];
}> => {
  const figmaRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.figma.json"),
    "utf8",
  );
  const visualRaw = await readFile(
    join(FIXTURES_DIR, "simple-form.visual.json"),
    "utf8",
  );
  const figma = JSON.parse(figmaRaw) as IntentDerivationFigmaInput;
  const visual = JSON.parse(visualRaw) as VisualScreenDescription[];
  const intent = reconcileSources({
    figmaIntent: deriveBusinessTestIntentIr({ figma }),
    visual,
  });
  return { intent, visual };
};

test("compiler: produces stable inputHash, promptHash, schemaHash, cacheKey", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const b = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.equal(a.request.hashes.inputHash, b.request.hashes.inputHash);
  assert.equal(a.request.hashes.promptHash, b.request.hashes.promptHash);
  assert.equal(a.request.hashes.schemaHash, b.request.hashes.schemaHash);
  assert.equal(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
});

test("compiler: hash differs when modelRevision changes", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const b = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: {
      ...sampleModelBinding,
      modelRevision: "gpt-oss-120b@2026-05-01",
    },
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.notEqual(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
});

test("compiler: hash differs when policy bundle version changes", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const b = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-05-01",
  });
  assert.notEqual(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
});

test("compiler: hash differs when visual sidecar deployment changes", async () => {
  const { intent, visual } = await loadFixture();
  const primary = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const fallback = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: {
      ...sampleVisualBinding,
      selectedDeployment: "phi-4-multimodal-poc",
      fallbackReason: "primary_quota_exceeded",
    },
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.notEqual(
    primary.request.hashes.cacheKey,
    fallback.request.hashes.cacheKey,
  );
});

test("compiler: hash differs when fixture image hash changes", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const b = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: { ...sampleVisualBinding, fixtureImageHash: "0".repeat(64) },
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.notEqual(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
});

test("compiler: includes sanitized custom context in prompt and replay identity", async () => {
  const { intent, visual } = await loadFixture();
  const customContext: CompiledPromptCustomContext = {
    markdownSections: [
      {
        sourceId: "custom-context-markdown",
        entryId: "note-1",
        bodyMarkdown:
          "# Supporting evidence\n\n- Expected currency codes only.\n",
        bodyPlain: "Supporting evidence\nExpected currency codes only.\n",
        markdownContentHash: "a".repeat(64),
        plainContentHash: "b".repeat(64),
      },
    ],
    structuredAttributes: [
      {
        sourceId: "custom-context-structured",
        entryId: "structured-1",
        key: "data_class",
        value: "PCI-DSS-3",
        contentHash: "c".repeat(64),
      },
    ],
  };
  const withContext = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    customContext,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const withoutContext = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.notEqual(
    withContext.request.hashes.cacheKey,
    withoutContext.request.hashes.cacheKey,
  );
  assert.match(
    withContext.request.userPrompt,
    /CUSTOM_CONTEXT_MARKDOWN_SUPPORTING_EVIDENCE/,
  );
  assert.match(withContext.request.userPrompt, /PCI-DSS-3/);
  assert.deepEqual(withContext.artifacts.payload.customContext, customContext);
});

test("compiler: suffix-only changes do not change cacheablePrefixHash", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-prefix-stable",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
    suffixSections: [
      {
        label: "RepairInstructions",
        body: "Fix duplicate coverage on the submit button.",
      },
    ],
  });
  const b = compilePrompt({
    jobId: "job-prefix-stable",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
    suffixSections: [
      {
        label: "RepairInstructions",
        body: "Add one more negative case for malformed email.",
      },
    ],
  });
  assert.equal(
    a.request.hashes.cacheablePrefixHash,
    b.request.hashes.cacheablePrefixHash,
  );
  assert.notEqual(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
});

test("compiler: active context-budget analysis changes the cache key and emits a per-role-step report", async () => {
  const { intent, visual } = await loadFixture();
  const customContext: CompiledPromptCustomContext = {
    markdownSections: [
      {
        sourceId: "custom-context-markdown",
        entryId: "note-1",
        bodyMarkdown: "# Supporting evidence\n\n" + "A".repeat(2_000),
        bodyPlain: "Supporting evidence\n" + "A".repeat(2_000),
        markdownContentHash: "d".repeat(64),
        plainContentHash: "e".repeat(64),
      },
    ],
    structuredAttributes: [],
  };

  const raw = compilePrompt({
    jobId: "job-analyzer",
    intent,
    visual,
    customContext,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const compacted = compilePrompt({
    jobId: "job-analyzer",
    intent,
    visual,
    customContext,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
    contextBudget: {
      roleStepId: "test_generation",
      maxInputTokens: 800,
    },
  });

  assert.notEqual(raw.request.hashes.cacheKey, compacted.request.hashes.cacheKey);
  assert.ok(compacted.request.hashes.contextBudgetHash);
  assert.equal(compacted.contextBudgetReport?.roleStepId, "test_generation");
  assert.equal(compacted.contextBudgetReport?.maxInputTokens, 800);
  assert.notEqual(compacted.contextBudgetReport?.action, "none");
  if (compacted.contextBudgetReport?.action === "compact_prompt_payload") {
    assert.ok(
      (compacted.contextBudgetReport.compactedFromArtifactHashes.length ?? 0) > 0,
    );
  }
  assert.match(
    JSON.stringify(compacted.contextBudgetReport),
    /"action":"(compact_prompt_payload|drop_optional_context|needs_review)"/u,
  );
  if (compacted.contextBudgetReport?.action === "compact_prompt_payload") {
    assert.match(
      compacted.request.userPrompt,
      /compacted from prompt payload due to context budget\./u,
    );
  }
  assert.equal(
    raw.request.hashes.cacheablePrefixHash,
    compacted.request.hashes.cacheablePrefixHash,
  );
});

test("compiler: artifacts contain only redacted PII (golden snapshot guard)", async () => {
  const { intent, visual } = await loadFixture();
  const result = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const serialized = JSON.stringify(result.artifacts);
  for (const pii of PII_SUBSTRINGS) {
    assert.equal(
      serialized.includes(pii),
      false,
      `PII substring "${pii}" leaked into compiled prompt artifacts`,
    );
  }
  // The redaction tokens must still survive — that's the proof we processed
  // the IR, not just dropped data.
  assert.match(serialized, /\[REDACTED:IBAN\]/);
});

test("compiler: redacts PII-like values from visual sidecar prompts and artifacts", async () => {
  const { intent, visual } = await loadFixture();
  const unsafeVisual: VisualScreenDescription[] = [
    {
      ...visual[0]!,
      screenName: "Max Mustermann payment screen",
      regions: [
        {
          ...visual[0]!.regions[0]!,
          label: "Card 4111111111111111",
          visibleText: "max.mustermann@sparkasse.de",
          stateHints: ["Call +49 221 1234567 after submit"],
          validationHints: ["Tax ID 86095742719 must be accepted"],
          ambiguity: { reason: "Owned by Max Mustermann" },
        },
      ],
    },
  ];

  const result = compilePrompt({
    jobId: "job-1",
    intent,
    visual: unsafeVisual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });

  const serialized = JSON.stringify({
    request: result.request,
    artifacts: result.artifacts,
  });
  for (const pii of PII_SUBSTRINGS) {
    assert.equal(
      serialized.includes(pii),
      false,
      `PII substring "${pii}" leaked into compiled visual prompt data`,
    );
  }
  assert.match(serialized, /\[REDACTED:PAN\]/);
  assert.match(serialized, /\[REDACTED:EMAIL\]/);
  assert.match(serialized, /\[REDACTED:PHONE\]/);
  assert.match(serialized, /\[REDACTED:TAX_ID\]/);
  assert.match(serialized, /\[REDACTED:FULL_NAME\]/);
});

test("compiler: strips unexpected visual sidecar properties from prompts and artifacts", async () => {
  const { intent, visual } = await loadFixture();
  const malformedVisual = [
    {
      ...visual[0]!,
      rawSecret: "max.mustermann@sparkasse.de",
      regions: [
        {
          ...visual[0]!.regions[0]!,
          debugSecret: "4111111111111111",
        },
      ],
    },
  ] as unknown as VisualScreenDescription[];

  const result = compilePrompt({
    jobId: "job-1",
    intent,
    visual: malformedVisual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });

  const serialized = JSON.stringify({
    request: result.request,
    artifacts: result.artifacts,
  });
  assert.equal(serialized.includes("rawSecret"), false);
  assert.equal(serialized.includes("debugSecret"), false);
  assert.equal(serialized.includes("max.mustermann@sparkasse.de"), false);
  assert.equal(serialized.includes("4111111111111111"), false);
});

test("compiler: includes versioned breadcrumbs in user prompt body", async () => {
  const { intent, visual } = await loadFixture();
  const { request } = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.match(
    request.userPrompt,
    new RegExp(
      `Prompt template version: ${TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION}\\.`,
    ),
  );
  assert.match(
    request.userPrompt,
    new RegExp(
      `Generated test case schema version: ${GENERATED_TEST_CASE_SCHEMA_VERSION}\\.`,
    ),
  );
  assert.match(
    request.userPrompt,
    new RegExp(`Redaction policy version: ${REDACTION_POLICY_VERSION}\\.`),
  );
  assert.match(
    request.userPrompt,
    new RegExp(
      `Visual sidecar schema version: ${VISUAL_SIDECAR_SCHEMA_VERSION}\\.`,
    ),
  );
});

test("compiler: artifacts pin the contract and schema versions", async () => {
  const { intent, visual } = await loadFixture();
  const { artifacts } = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.equal(artifacts.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(
    artifacts.promptTemplateVersion,
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(artifacts.schemaVersion, GENERATED_TEST_CASE_SCHEMA_VERSION);
  assert.equal(artifacts.redactionPolicyVersion, REDACTION_POLICY_VERSION);
  assert.equal(artifacts.visualBinding.screenCount, visual.length);
  assert.equal(artifacts.systemPrompt, COMPILED_SYSTEM_PROMPT);
  assert.equal(artifacts.promptLayout.prefixEndMarker, "--- prefix end ---");
  assert.match(artifacts.promptLayout.prefix, /\[2\] AgentRoleProfile/u);
  assert.match(
    artifacts.userPrompt,
    /Generate structured test cases derived from the bounded JSON below/u,
  );
});

test("compiler: normalizes visual binding screen count from redacted visual batch", async () => {
  const { intent, visual } = await loadFixture();
  const { artifacts } = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: { ...sampleVisualBinding, screenCount: 999 },
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.equal(artifacts.visualBinding.screenCount, visual.length);
});

test("compiler: omits seed and fixtureImageHash from request when absent", async () => {
  const { intent, visual } = await loadFixture();
  const { request, cacheKey } = compilePrompt({
    jobId: "job-1",
    intent,
    visual,
    modelBinding: {
      modelRevision: sampleModelBinding.modelRevision,
      gatewayRelease: sampleModelBinding.gatewayRelease,
    },
    visualBinding: {
      schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      selectedDeployment: "mock",
      fallbackReason: "none",
      screenCount: visual.length,
    },
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.equal(request.modelBinding.seed, undefined);
  assert.equal(cacheKey.seed, undefined);
  assert.equal(cacheKey.fixtureImageHash, undefined);
});

test("compiler: response schema name is stable", async () => {
  const { intent } = await loadFixture();
  const { request } = compilePrompt({
    jobId: "job-1",
    intent,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const majorVersion = GENERATED_TEST_CASE_SCHEMA_VERSION.split(".")[0];
  assert.equal(
    request.responseSchemaName,
    `workspace-dev-generated-test-case-list-v${majorVersion}`,
  );
  assert.match(request.responseSchemaName ?? "", /^[a-zA-Z0-9_-]{1,64}$/);
});

test("compiler: request schema matches generated test case JSON schema", async () => {
  const { intent } = await loadFixture();
  const { request } = compilePrompt({
    jobId: "job-1",
    intent,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.deepEqual(
    request.responseSchema,
    buildGeneratedTestCaseListJsonSchema(),
  );
});
