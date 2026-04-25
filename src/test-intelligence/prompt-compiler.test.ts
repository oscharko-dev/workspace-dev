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

test("compiler: jobId does NOT participate in cache key (hash invariant)", async () => {
  const { intent, visual } = await loadFixture();
  const a = compilePrompt({
    jobId: "job-A",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  const b = compilePrompt({
    jobId: "job-B",
    intent,
    visual,
    modelBinding: sampleModelBinding,
    visualBinding: sampleVisualBinding,
    policyBundleVersion: "policy-2026-04-25",
  });
  assert.equal(a.request.hashes.cacheKey, b.request.hashes.cacheKey);
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
  assert.ok(artifacts.userPrompt.startsWith(COMPILED_USER_PROMPT_PREAMBLE));
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
  assert.equal(
    request.responseSchemaName,
    `workspace-dev.test-intelligence.generated-test-case-list.v${GENERATED_TEST_CASE_SCHEMA_VERSION}`,
  );
});
