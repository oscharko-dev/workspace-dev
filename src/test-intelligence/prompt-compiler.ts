import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type CompiledPromptArtifacts,
  type CompiledPromptHashes,
  type CompiledPromptModelBinding,
  type CompiledPromptRequest,
  type CompiledPromptVisualBinding,
  type ReplayCacheKey,
  type VisualScreenDescription,
  type VisualSidecarFallbackReason,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  buildGeneratedTestCaseListJsonSchema,
  computeGeneratedTestCaseListSchemaHash,
} from "./generated-test-case-schema.js";

/**
 * Versioned prompt template body. Bump
 * `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` together with any change to
 * the system or user prompt scaffolds — the version stamp participates in
 * the replay-cache key so that template changes always force a cache miss.
 */
const SYSTEM_PROMPT = [
  "You are a deterministic test-design assistant for workspace-dev.",
  "You receive a redacted Business Test Intent IR and an optional visual sidecar description as JSON.",
  "You MUST produce JSON that conforms exactly to the GeneratedTestCaseList schema attached to this request.",
  "You MUST NOT inspect images, fetch URLs, or invent identifiers. The trace references you cite must come from the IR.",
  "You MUST treat any value matching the form `[REDACTED:*]` as opaque and never attempt to recover the original.",
  "You MUST not emit chain-of-thought, reasoning text, or any free-form prose outside of the JSON envelope.",
].join(" ");

const USER_PROMPT_PREAMBLE = [
  "Generate structured test cases derived from the bounded JSON below.",
  "Cover the detected fields, actions, validations, and navigation edges of every screen.",
  "Use the ISO/IEC/IEEE 29119-4 technique that best fits each case.",
  "Populate qualitySignals.coveredFieldIds, coveredActionIds, coveredValidationIds, coveredNavigationIds with the matching IR ids.",
  "Reference the source Figma trace for every produced case via figmaTraceRefs.",
  "Cite ambiguity or open questions when the IR is incomplete; do not fabricate behavior.",
].join(" ");

export interface CompilePromptInput {
  jobId: string;
  intent: BusinessTestIntentIr;
  visual?: VisualScreenDescription[];
  modelBinding: CompiledPromptModelBinding;
  policyBundleVersion: string;
  visualBinding: CompiledPromptVisualBinding;
}

export interface CompilePromptResult {
  request: CompiledPromptRequest;
  artifacts: CompiledPromptArtifacts;
  cacheKey: ReplayCacheKey;
}

/**
 * Compile a deterministic, redacted prompt request from a Business Test
 * Intent IR plus an optional schema-validated visual sidecar batch.
 *
 * The function is pure and synchronous: identical inputs (including the
 * visual sidecar binding identity, model binding, and policy bundle) must
 * produce byte-identical request, artifact, and cache-key objects. This is
 * what guarantees the replay-cache hit path documented on Issue #1362.
 */
export const compilePrompt = (
  input: CompilePromptInput,
): CompilePromptResult => {
  const visual = input.visual ?? [];
  const visualBinding = normalizeVisualBinding(input.visualBinding, visual);
  const responseSchema = buildGeneratedTestCaseListJsonSchema();
  const schemaHash = computeGeneratedTestCaseListSchemaHash();

  const inputHash = computeInputHash(input.intent, visual, visualBinding);
  const promptHash = computePromptHash(
    SYSTEM_PROMPT,
    USER_PROMPT_PREAMBLE,
    schemaHash,
  );

  const cacheKey: ReplayCacheKey = {
    inputHash,
    promptHash,
    schemaHash,
    modelRevision: input.modelBinding.modelRevision,
    gatewayRelease: input.modelBinding.gatewayRelease,
    policyBundleVersion: input.policyBundleVersion,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    visualSelectedDeployment: visualBinding.selectedDeployment,
    visualFallbackReason: visualBinding.fallbackReason,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    ...(visualBinding.fixtureImageHash !== undefined
      ? { fixtureImageHash: visualBinding.fixtureImageHash }
      : {}),
    ...(input.modelBinding.seed !== undefined
      ? { seed: input.modelBinding.seed }
      : {}),
  };

  const cacheKeyDigest = sha256Hex(cacheKey);
  const userPrompt = renderUserPrompt(input.intent, visual, visualBinding);

  const hashes: CompiledPromptHashes = {
    inputHash,
    promptHash,
    schemaHash,
    cacheKey: cacheKeyDigest,
  };

  const modelBinding: CompiledPromptModelBinding = {
    modelRevision: input.modelBinding.modelRevision,
    gatewayRelease: input.modelBinding.gatewayRelease,
    ...(input.modelBinding.seed !== undefined
      ? { seed: input.modelBinding.seed }
      : {}),
  };

  const request: CompiledPromptRequest = {
    jobId: input.jobId,
    modelBinding,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema,
    responseSchemaName: GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
    hashes,
  };

  const artifacts: CompiledPromptArtifacts = {
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    jobId: input.jobId,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    payload: {
      intent: input.intent,
      visual,
    },
    hashes,
    visualBinding,
    modelBinding,
    policyBundleVersion: input.policyBundleVersion,
  };

  return { request, artifacts, cacheKey };
};

/** Stable system prompt body (exported for tests / evidence sealing). */
export const COMPILED_SYSTEM_PROMPT: string = SYSTEM_PROMPT;
/** Stable user-prompt preamble (exported for tests / evidence sealing). */
export const COMPILED_USER_PROMPT_PREAMBLE: string = USER_PROMPT_PREAMBLE;

/** Compose the user-prompt body. Pure and deterministic. */
const renderUserPrompt = (
  intent: BusinessTestIntentIr,
  visual: VisualScreenDescription[],
  visualBinding: CompiledPromptVisualBinding,
): string => {
  const sections = [
    USER_PROMPT_PREAMBLE,
    `Prompt template version: ${TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION}.`,
    `Generated test case schema version: ${GENERATED_TEST_CASE_SCHEMA_VERSION}.`,
    `Redaction policy version: ${REDACTION_POLICY_VERSION}.`,
    `Visual sidecar schema version: ${visualBinding.schemaVersion}.`,
    `Visual sidecar deployment: ${visualBinding.selectedDeployment} (fallback reason: ${visualBinding.fallbackReason}).`,
    "Business Test Intent IR (canonical JSON):",
    canonicalJson(intent),
    "Visual sidecar batch (canonical JSON):",
    canonicalJson(visual),
  ];
  return sections.join("\n");
};

/** Hash the redacted IR + visual + binding identity. */
const computeInputHash = (
  intent: BusinessTestIntentIr,
  visual: VisualScreenDescription[],
  visualBinding: CompiledPromptVisualBinding,
): string => {
  return sha256Hex({
    intent,
    visual,
    visualBinding,
  });
};

/** Hash the prompt template + bound schema identity. */
const computePromptHash = (
  systemPrompt: string,
  userPromptPreamble: string,
  schemaHash: string,
): string => {
  return sha256Hex({
    systemPrompt,
    userPromptPreamble,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    schemaName: GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
    schemaHash,
  });
};

/**
 * Normalize the visual binding so the screen count always matches the
 * supplied visual batch, even when a caller forgets to keep them in sync.
 * The compiler is the source of truth for this number.
 */
const normalizeVisualBinding = (
  binding: CompiledPromptVisualBinding,
  visual: VisualScreenDescription[],
): CompiledPromptVisualBinding => {
  const normalized: CompiledPromptVisualBinding = {
    schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    selectedDeployment: binding.selectedDeployment,
    fallbackReason:
      binding.fallbackReason satisfies VisualSidecarFallbackReason,
    screenCount: visual.length,
  };
  if (binding.fixtureImageHash !== undefined) {
    normalized.fixtureImageHash = binding.fixtureImageHash;
  }
  return normalized;
};
