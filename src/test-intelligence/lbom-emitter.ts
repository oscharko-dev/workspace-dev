/**
 * Per-job LLM Bill of Materials emitter (CycloneDX 1.6 ML-BOM, Issue #1378).
 *
 * The emitter composes a deterministic, byte-stable CycloneDX 1.6 ML-BOM
 * document from the artifacts the Wave 1 Validation harness already produced:
 *
 *   - test-generation model component (`gpt-oss-120b` family)
 *   - visual primary model component (`llama-4-maverick-vision`)
 *   - visual fallback model component (`phi-4-multimodal-poc`)
 *   - data component for the curated few-shot bundle (hash = promptHash)
 *   - data component for the active policy profile (hash = canonical SHA-256)
 *
 * Hard invariants stamped on the artifact as CycloneDX metadata properties:
 *   - `workspace-dev:secretsIncluded = false`
 *   - `workspace-dev:rawPromptsIncluded = false`
 *   - `workspace-dev:rawScreenshotsIncluded = false`
 *
 * The hand-rolled validator in `validateLbomDocument` is structural and
 * domain-aware (per the workspace-dev zero-runtime-deps policy — see
 * `repo_zero_deps.md`). It enforces the field shape the harness emits,
 * rejects raw prompt or screenshot payloads, and refuses any field that
 * smells like a high-risk secret per `redactHighRiskSecrets`.
 *
 * Persistence uses the same atomic `${pid}.${randomUUID()}.tmp` rename
 * pattern as the rest of the test-intelligence module so concurrent
 * harness runs cannot corrupt the artifact.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  ALLOWED_LBOM_MODEL_ROLES,
  CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LBOM_ARTIFACT_DIRECTORY,
  LBOM_ARTIFACT_FILENAME,
  LBOM_ARTIFACT_SCHEMA_VERSION,
  LBOM_CYCLONEDX_SPEC_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type LbomDataComponent,
  type LbomDataKind,
  type LbomDependency,
  type LbomHash,
  type LbomMetadata,
  type LbomModelComponent,
  type LbomModelRole,
  type LbomProperty,
  type LbomSubjectComponent,
  type LbomToolComponent,
  type LbomValidationIssue,
  type LbomValidationResult,
  type TestCasePolicyProfile,
  type VisualSidecarFallbackReason,
  type VisualSidecarResult,
  type Wave1ValidationFixtureId,
  type Wave1ValidationLbomDocument,
  type Wave1ValidationLbomSummary,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32_TO_128 =
  /^([a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[a-fA-F0-9]{96}|[a-fA-F0-9]{128})$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SERIAL_NUMBER_PREFIX = "urn:uuid:";
const RFC4122_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LABEL_LENGTH = 256;

const REDACTION_PLACEHOLDER = "[REDACTED]";

const sanitizeLabel = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, REDACTION_PLACEHOLDER)
    // eslint-disable-next-line no-control-regex -- intentionally strip ASCII control chars
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length === 0) return REDACTION_PLACEHOLDER;
  if (redacted.length <= MAX_LABEL_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_LABEL_LENGTH)}...`;
};

const sortPropertiesByName = (props: LbomProperty[]): LbomProperty[] =>
  [...props].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Inputs for `buildLbomDocument`. */
export interface BuildLbomDocumentInput {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  generatedAt: string;
  /** Identities of the deployments behind the run, mirroring the manifest. */
  modelDeployments: {
    testGeneration: string;
    visualPrimary: string;
    visualFallback?: string;
  };
  /** Active policy profile identity (id + version + canonical-hash inputs). */
  policyProfile: TestCasePolicyProfile;
  /** Active export profile identity, persisted as a property. */
  exportProfile: { id: string; version: string };
  /**
   * Replay-cache identity hashes for the run. The `promptHash` is reused
   * as the few-shot bundle's content hash because the few-shot examples
   * are baked into `SYSTEM_PROMPT` + `USER_PROMPT_PREAMBLE` — `promptHash`
   * is the bundle's authoritative content fingerprint per the prompt
   * compiler (see `prompt-compiler.ts`).
   */
  hashes: {
    promptHash: string;
    schemaHash: string;
    inputHash: string;
    cacheKeyDigest: string;
  };
  /**
   * Test-generation model identity. `name` is the canonical model id
   * (`gpt-oss-120b`); the live deployment label is recorded as a property.
   */
  testGenerationBinding: {
    modelRevision: string;
    gatewayRelease: string;
    compatibilityMode?: string;
    provider?: string;
    licenseStatus?: string;
  };
  /** Optional visual model identities, supplied by live/mock gateway clients. */
  visualModelBindings?: Partial<
    Record<
      "visual_primary" | "visual_fallback",
      {
        modelRevision: string;
        gatewayRelease: string;
        compatibilityMode?: string;
        provider?: string;
        licenseStatus?: string;
      }
    >
  >;
  /** Visual sidecar runtime outcome (when the multimodal path ran). */
  visualSidecar?: VisualSidecarResult;
  /** The redaction policy version active during the run. */
  redactionPolicyVersion?: string;
  /** Optional weights SHA-256 (per-deployment). */
  weightsSha256?: Partial<Record<LbomModelRole, string>>;
}

/**
 * Stable canonical model names per role. The deployment label (e.g.
 * `gpt-oss-120b-mock`) is stamped as a property; the canonical name keeps
 * the LBOM stable across mock vs. live runs and across deployment renames.
 */
const CANONICAL_MODEL_NAMES: Record<LbomModelRole, string> = {
  test_generation: "gpt-oss-120b",
  visual_primary: "llama-4-maverick-vision",
  visual_fallback: "phi-4-multimodal-poc",
};

const MODEL_DESCRIPTIONS: Record<LbomModelRole, string> = {
  test_generation:
    "Structured test-case generator. Receives redacted Business Test Intent IR + visual sidecar JSON, emits a GeneratedTestCaseList that the validation pipeline gates. Never receives image payloads.",
  visual_primary:
    "Primary multimodal sidecar that derives a structured visual screen description from a UI capture. Subject to byte caps and MIME allowlists at preflight.",
  visual_fallback:
    "Fallback multimodal sidecar invoked when the primary deployment is unavailable, quota-throttled, or when an operator forces a policy downgrade.",
};

const MODEL_TASKS: Record<LbomModelRole, string> = {
  test_generation: "structured-test-case-generation",
  visual_primary: "visual-screen-description",
  visual_fallback: "visual-screen-description",
};

const MODEL_ARCHITECTURE_FAMILIES: Record<LbomModelRole, string> = {
  test_generation: "transformer",
  visual_primary: "multimodal-transformer",
  visual_fallback: "multimodal-transformer",
};

const MODEL_USE_CASES: Record<LbomModelRole, string[]> = {
  test_generation: [
    "Derive ISO/IEC/IEEE 29119-4 structured test cases from a redacted Business Test Intent IR.",
    "Map test-case fields to Figma trace ids supplied by the IR for replay determinism.",
  ],
  visual_primary: [
    "Describe Figma UI captures as a structured visual sidecar so the test-case generator can reason about controls without seeing pixels.",
  ],
  visual_fallback: [
    "Provide a degraded but policy-equivalent visual sidecar when the primary deployment is unavailable or throttled.",
  ],
};

const MODEL_TECHNICAL_LIMITATIONS: Record<LbomModelRole, string[]> = {
  test_generation: [
    "Receives only redacted JSON inputs; cannot inspect image bytes or fetch remote URLs.",
    "Output is gated by a hand-written JSON schema; non-conforming responses are rejected at the validation pipeline.",
  ],
  visual_primary: [
    "Subject to a 5 MiB image-input byte cap and a closed-set MIME allowlist enforced at preflight.",
    "Cannot persist raw screenshot bytes downstream; capture identity is recorded as SHA-256 only.",
  ],
  visual_fallback: [
    "Capabilities are a strict subset of the primary deployment; a fallback selection signals a degraded path the policy gate logs.",
  ],
};

const MODEL_ETHICAL_CONSIDERATIONS: Record<LbomModelRole, string[]> = {
  test_generation: [
    "PII exposure",
    "Regulated-data leakage",
  ],
  visual_primary: [
    "Visible PII exposure",
  ],
  visual_fallback: [
    "Visible PII exposure",
  ],
};

const MODEL_ETHICAL_MITIGATIONS: Record<LbomModelRole, string[]> = {
  test_generation: [
    "Inputs are PII-redacted by upstream `pii-redaction.ts`; the generator never sees plaintext PII.",
    "Outputs are gated by the eu-banking-default policy profile to prevent regulated-data and high-risk leakage.",
  ],
  visual_primary: [
    "Captures are scanned for visible PII flags before being routed; the validation gate refuses sidecars whose `piiFlags` exceed policy.",
  ],
  visual_fallback: [
    "Captures are scanned for visible PII flags before being routed; the validation gate refuses sidecars whose `piiFlags` exceed policy.",
  ],
};

const MODEL_PERFORMANCE_TRADEOFFS: Record<LbomModelRole, string[]> = {
  test_generation: [
    "Determinism is prioritised over generation diversity: the replay cache short-circuits identical inputs to byte-stable artifacts.",
  ],
  visual_primary: [
    "Higher fidelity than the fallback at the cost of latency and quota pressure under burst load.",
  ],
  visual_fallback: [
    "Lower fidelity than the primary; surfaces fallback-used signal so policy can gate sensitive jobs.",
  ],
};

const ALLOWED_VISUAL_FALLBACK_REASONS = new Set<VisualSidecarFallbackReason>([
  "none",
  "primary_unavailable",
  "primary_quota_exceeded",
  "policy_downgrade",
]);

const buildModelComponent = (input: {
  role: LbomModelRole;
  deployment: string;
  modelRevision?: string | undefined;
  gatewayRelease?: string | undefined;
  compatibilityMode?: string | undefined;
  provider?: string | undefined;
  licenseStatus?: string | undefined;
  weightsSha256?: string | undefined;
  fallbackUsed: boolean;
  fallbackReason?: VisualSidecarFallbackReason;
  imageInputSupport: boolean;
}): LbomModelComponent => {
  const canonicalName = CANONICAL_MODEL_NAMES[input.role];
  const safeDeployment = sanitizeLabel(input.deployment);
  const safeRevision =
    input.modelRevision === undefined
      ? "unknown"
      : sanitizeLabel(input.modelRevision);
  const safeGatewayRelease =
    input.gatewayRelease === undefined
      ? "unknown"
      : sanitizeLabel(input.gatewayRelease);

  const properties: LbomProperty[] = sortPropertiesByName([
    { name: "workspace-dev:role", value: input.role },
    { name: "workspace-dev:deployment", value: safeDeployment },
    {
      name: "workspace-dev:format",
      value:
        input.compatibilityMode === undefined
          ? "unknown"
          : sanitizeLabel(input.compatibilityMode),
    },
    { name: "workspace-dev:gatewayRelease", value: safeGatewayRelease },
    {
      name: "workspace-dev:imageInputSupport",
      value: input.imageInputSupport ? "true" : "false",
    },
    {
      name: "workspace-dev:licenseStatus",
      value:
        input.licenseStatus === undefined
          ? "unknown"
          : sanitizeLabel(input.licenseStatus),
    },
    {
      name: "workspace-dev:provider",
      value:
        input.provider === undefined ? "unknown" : sanitizeLabel(input.provider),
    },
    {
      name: "workspace-dev:fallbackUsed",
      value: input.fallbackUsed ? "true" : "false",
    },
    ...(input.fallbackReason !== undefined
      ? [
          {
            name: "workspace-dev:fallbackReason",
            value: input.fallbackReason,
          } satisfies LbomProperty,
        ]
      : []),
  ]);

  const hashes: LbomHash[] | undefined =
    input.weightsSha256 !== undefined
      ? [{ alg: "SHA-256", content: input.weightsSha256.toLowerCase() }]
      : undefined;

  const component: LbomModelComponent = {
    type: "machine-learning-model",
    "bom-ref": `model:${input.role}`,
    name: canonicalName,
    version: safeRevision,
    description: MODEL_DESCRIPTIONS[input.role],
    publisher: "workspace-dev",
    group: "workspace-dev:test-intelligence",
    ...(hashes !== undefined ? { hashes } : {}),
    properties,
    modelCard: {
      modelParameters: {
        task: MODEL_TASKS[input.role],
        architectureFamily: MODEL_ARCHITECTURE_FAMILIES[input.role],
      },
      considerations: {
        useCases: [...MODEL_USE_CASES[input.role]],
        technicalLimitations: [...MODEL_TECHNICAL_LIMITATIONS[input.role]],
        ethicalConsiderations: MODEL_ETHICAL_CONSIDERATIONS[input.role].map(
          (name, index) => ({
            name,
            mitigationStrategy:
              MODEL_ETHICAL_MITIGATIONS[input.role][index] ?? "Policy gated",
          }),
        ),
        performanceTradeoffs: [...MODEL_PERFORMANCE_TRADEOFFS[input.role]],
      },
    },
  };
  return component;
};

const buildFewShotBundleComponent = (input: {
  promptHash: string;
  schemaHash: string;
  promptTemplateVersion: string;
  schemaVersion: string;
}): LbomDataComponent => ({
  type: "data",
  "bom-ref": "data:few-shot-bundle",
  name: "test-intelligence-prompt-bundle",
  version: input.promptTemplateVersion,
  description:
    "Curated workspace-dev prompt bundle: deterministic system + user preamble plus the bound generated-test-case JSON schema. The bundle hash is the prompt-compiler `promptHash`.",
  hashes: [
    { alg: "SHA-256", content: input.promptHash },
    { alg: "SHA-256", content: input.schemaHash },
  ],
  properties: sortPropertiesByName([
    { name: "workspace-dev:bundleKind", value: "few_shot_bundle" },
    {
      name: "workspace-dev:promptTemplateVersion",
      value: sanitizeLabel(input.promptTemplateVersion),
    },
    {
      name: "workspace-dev:generatedTestCaseSchemaVersion",
      value: sanitizeLabel(input.schemaVersion),
    },
  ]),
});

const buildPolicyProfileComponent = (
  profile: TestCasePolicyProfile,
): LbomDataComponent => {
  const policyHash = sha256Hex(profile);
  return {
    type: "data",
    "bom-ref": "data:policy-profile",
    name: sanitizeLabel(profile.id),
    version: sanitizeLabel(profile.version),
    description:
      "Active workspace-dev test-case policy profile applied to the run's validation pipeline. The hash is the canonical SHA-256 of the profile object.",
    hashes: [{ alg: "SHA-256", content: policyHash }],
    properties: sortPropertiesByName([
      { name: "workspace-dev:bundleKind", value: "policy_profile" },
      {
        name: "workspace-dev:policyProfileId",
        value: sanitizeLabel(profile.id),
      },
      {
        name: "workspace-dev:policyProfileVersion",
        value: sanitizeLabel(profile.version),
      },
    ]),
  };
};

const buildSubjectComponent = (input: {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  exportProfile: { id: string; version: string };
}): LbomSubjectComponent => ({
  type: "application",
  "bom-ref": `job:${sanitizeLabel(input.jobId)}`,
  name: "workspace-dev-test-intelligence-job",
  version: sanitizeLabel(input.jobId),
  description:
    "Wave 1 Validation test-intelligence job. Composes the model chain, the curated few-shot bundle, and the active policy profile that produced the run's structured test cases.",
  properties: sortPropertiesByName([
    { name: "workspace-dev:fixtureId", value: input.fixtureId },
    { name: "workspace-dev:jobId", value: sanitizeLabel(input.jobId) },
    {
      name: "workspace-dev:exportProfileId",
      value: sanitizeLabel(input.exportProfile.id),
    },
    {
      name: "workspace-dev:exportProfileVersion",
      value: sanitizeLabel(input.exportProfile.version),
    },
  ]),
});

const buildSerialNumber = (input: {
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  cacheKeyDigest: string;
  contractVersion: string;
}): string => {
  // Derive a deterministic UUIDv4-shaped serial from job identity. The
  // value MUST be byte-stable for a given fixture so the LBOM hashes match
  // across runs. We compute SHA-256 over canonical input bytes and project
  // the digest into the RFC 4122 UUID layout, stamping the version (4) and
  // variant (0b10) bits per spec.
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        kind: "lbom-serial",
        fixtureId: input.fixtureId,
        jobId: input.jobId,
        cacheKeyDigest: input.cacheKeyDigest,
        contractVersion: input.contractVersion,
      }),
    )
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${SERIAL_NUMBER_PREFIX}${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const buildMetadata = (input: {
  generatedAt: string;
  fixtureId: Wave1ValidationFixtureId;
  jobId: string;
  policyProfile: TestCasePolicyProfile;
  exportProfile: { id: string; version: string };
  redactionPolicyVersion: string;
  hashes: BuildLbomDocumentInput["hashes"];
  visualSidecar?: VisualSidecarResult;
}): LbomMetadata => {
  const tools: LbomToolComponent[] = [
    {
      type: "application",
      name: "workspace-dev",
      version: CONTRACT_VERSION,
      publisher: "workspace-dev",
      description:
        "workspace-dev air-gapped Figma-to-Test test-intelligence harness. Emits the per-job LBOM as part of the evidence-seal flow.",
    },
  ];

  const visualSelectedDeployment =
    input.visualSidecar?.outcome === "success"
      ? sanitizeLabel(input.visualSidecar.selectedDeployment)
      : input.visualSidecar?.outcome === "failure"
        ? "none"
        : "fixture";
  const visualFallbackReason =
    input.visualSidecar?.outcome === "success"
      ? input.visualSidecar.fallbackReason
      : "none";
  const visualFallbackUsed =
    input.visualSidecar?.outcome === "success" &&
    input.visualSidecar.fallbackReason !== "none";

  const properties: LbomProperty[] = sortPropertiesByName([
    {
      name: "workspace-dev:contractVersion",
      value: sanitizeLabel(CONTRACT_VERSION),
    },
    {
      name: "workspace-dev:testIntelligenceContractVersion",
      value: sanitizeLabel(TEST_INTELLIGENCE_CONTRACT_VERSION),
    },
    {
      name: "workspace-dev:redactionPolicyVersion",
      value: sanitizeLabel(input.redactionPolicyVersion),
    },
    {
      name: "workspace-dev:secretsIncluded",
      value: "false",
    },
    {
      name: "workspace-dev:rawPromptsIncluded",
      value: "false",
    },
    {
      name: "workspace-dev:rawScreenshotsIncluded",
      value: "false",
    },
    {
      name: "workspace-dev:visualSidecarSchemaVersion",
      value: sanitizeLabel(VISUAL_SIDECAR_SCHEMA_VERSION),
    },
    {
      name: "workspace-dev:promptHash",
      value: input.hashes.promptHash,
    },
    {
      name: "workspace-dev:schemaHash",
      value: input.hashes.schemaHash,
    },
    {
      name: "workspace-dev:inputHash",
      value: input.hashes.inputHash,
    },
    {
      name: "workspace-dev:cacheKeyDigest",
      value: input.hashes.cacheKeyDigest,
    },
    {
      name: "workspace-dev:visualSelectedDeployment",
      value: visualSelectedDeployment,
    },
    {
      name: "workspace-dev:visualFallbackReason",
      value: visualFallbackReason,
    },
    {
      name: "workspace-dev:visualFallbackUsed",
      value: visualFallbackUsed ? "true" : "false",
    },
  ]);

  return {
    timestamp: input.generatedAt,
    tools: { components: tools },
    component: buildSubjectComponent({
      fixtureId: input.fixtureId,
      jobId: input.jobId,
      exportProfile: input.exportProfile,
    }),
    properties,
  };
};

/**
 * Build a deterministic CycloneDX 1.6 ML-BOM document for the run. The
 * output is byte-stable for a given input — components are emitted in
 * canonical order (test_generation → visual_primary → visual_fallback →
 * data:few-shot-bundle → data:policy-profile), properties are sorted by
 * name, and the serial number is derived from job identity.
 */
export const buildLbomDocument = (
  input: BuildLbomDocumentInput,
): Wave1ValidationLbomDocument => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new RangeError("buildLbomDocument: jobId must be non-empty");
  }
  if (typeof input.generatedAt !== "string" || input.generatedAt.length === 0) {
    throw new RangeError("buildLbomDocument: generatedAt must be non-empty");
  }
  for (const hashField of [
    "promptHash",
    "schemaHash",
    "inputHash",
    "cacheKeyDigest",
  ] as const) {
    if (!HEX64.test(input.hashes[hashField])) {
      throw new RangeError(
        `buildLbomDocument: hashes.${hashField} must be a sha256 hex string`,
      );
    }
  }
  if (input.weightsSha256 !== undefined) {
    for (const role of ALLOWED_LBOM_MODEL_ROLES) {
      const candidate = input.weightsSha256[role];
      if (candidate !== undefined && !HEX32_TO_128.test(candidate)) {
        throw new RangeError(
          `buildLbomDocument: weightsSha256.${role} must be a hex digest`,
        );
      }
    }
  }

  const visualPrimaryDeployment = sanitizeLabel(
    input.modelDeployments.visualPrimary,
  );
  const visualFallbackDeployment =
    input.modelDeployments.visualFallback === undefined ||
    input.modelDeployments.visualFallback.length === 0
      ? "phi-4-multimodal-poc"
      : sanitizeLabel(input.modelDeployments.visualFallback);
  const visualFallbackReason: VisualSidecarFallbackReason =
    input.visualSidecar?.outcome === "success"
      ? input.visualSidecar.fallbackReason
      : "none";
  const fallbackUsed =
    input.visualSidecar?.outcome === "success" &&
    input.visualSidecar.fallbackReason !== "none";
  const fallbackSelectedDeployment =
    input.visualSidecar?.outcome === "success"
      ? input.visualSidecar.selectedDeployment
      : undefined;

  const components: Array<LbomModelComponent | LbomDataComponent> = [
    buildModelComponent({
      role: "test_generation",
      deployment: input.modelDeployments.testGeneration,
      modelRevision: input.testGenerationBinding.modelRevision,
      gatewayRelease: input.testGenerationBinding.gatewayRelease,
      compatibilityMode: input.testGenerationBinding.compatibilityMode,
      provider: input.testGenerationBinding.provider,
      licenseStatus: input.testGenerationBinding.licenseStatus,
      ...(input.weightsSha256?.test_generation !== undefined
        ? { weightsSha256: input.weightsSha256.test_generation }
        : {}),
      fallbackUsed: false,
      imageInputSupport: false,
    }),
    buildModelComponent({
      role: "visual_primary",
      deployment: visualPrimaryDeployment,
      modelRevision: input.visualModelBindings?.visual_primary?.modelRevision,
      gatewayRelease: input.visualModelBindings?.visual_primary?.gatewayRelease,
      compatibilityMode:
        input.visualModelBindings?.visual_primary?.compatibilityMode,
      provider: input.visualModelBindings?.visual_primary?.provider,
      licenseStatus: input.visualModelBindings?.visual_primary?.licenseStatus,
      fallbackUsed:
        fallbackUsed &&
        fallbackSelectedDeployment !== "llama-4-maverick-vision",
      fallbackReason: visualFallbackReason,
      imageInputSupport: true,
      ...(input.weightsSha256?.visual_primary !== undefined
        ? { weightsSha256: input.weightsSha256.visual_primary }
        : {}),
    }),
    buildModelComponent({
      role: "visual_fallback",
      deployment: visualFallbackDeployment,
      modelRevision: input.visualModelBindings?.visual_fallback?.modelRevision,
      gatewayRelease:
        input.visualModelBindings?.visual_fallback?.gatewayRelease,
      compatibilityMode:
        input.visualModelBindings?.visual_fallback?.compatibilityMode,
      provider: input.visualModelBindings?.visual_fallback?.provider,
      licenseStatus: input.visualModelBindings?.visual_fallback?.licenseStatus,
      fallbackUsed:
        fallbackUsed && fallbackSelectedDeployment === "phi-4-multimodal-poc",
      fallbackReason: visualFallbackReason,
      imageInputSupport: true,
      ...(input.weightsSha256?.visual_fallback !== undefined
        ? { weightsSha256: input.weightsSha256.visual_fallback }
        : {}),
    }),
    buildFewShotBundleComponent({
      promptHash: input.hashes.promptHash,
      schemaHash: input.hashes.schemaHash,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    }),
    buildPolicyProfileComponent(input.policyProfile),
  ];

  const dependencies: LbomDependency[] = [
    {
      ref: `job:${sanitizeLabel(input.jobId)}`,
      dependsOn: [
        "model:test_generation",
        "model:visual_primary",
        "model:visual_fallback",
        "data:few-shot-bundle",
        "data:policy-profile",
      ],
    },
    {
      ref: "model:test_generation",
      dependsOn: ["data:few-shot-bundle", "data:policy-profile"],
    },
    {
      ref: "model:visual_primary",
      dependsOn: ["data:policy-profile"],
    },
    {
      ref: "model:visual_fallback",
      dependsOn: ["data:policy-profile"],
    },
  ];

  const document: Wave1ValidationLbomDocument = {
    bomFormat: "CycloneDX",
    specVersion: LBOM_CYCLONEDX_SPEC_VERSION,
    version: 1,
    serialNumber: buildSerialNumber({
      fixtureId: input.fixtureId,
      jobId: input.jobId,
      cacheKeyDigest: input.hashes.cacheKeyDigest,
      contractVersion: CONTRACT_VERSION,
    }),
    metadata: buildMetadata({
      generatedAt: input.generatedAt,
      fixtureId: input.fixtureId,
      jobId: input.jobId,
      policyProfile: input.policyProfile,
      exportProfile: input.exportProfile,
      redactionPolicyVersion:
        input.redactionPolicyVersion ?? REDACTION_POLICY_VERSION,
      hashes: input.hashes,
      ...(input.visualSidecar !== undefined
        ? { visualSidecar: input.visualSidecar }
        : {}),
    }),
    components,
    dependencies,
  };
  return document;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pushIssue = (
  issues: LbomValidationIssue[],
  path: string,
  code: LbomValidationIssue["code"],
  message: string,
): void => {
  issues.push({ path, code, message });
};

const validateProperties = (
  props: unknown,
  basePath: string,
  issues: LbomValidationIssue[],
): void => {
  if (!Array.isArray(props)) {
    pushIssue(issues, basePath, "invalid_type", "properties must be an array");
    return;
  }
  const propsArr: unknown[] = props as unknown[];
  for (let i = 0; i < propsArr.length; i += 1) {
    const entry: unknown = propsArr[i];
    const path = `${basePath}[${i}]`;
    if (!isRecord(entry)) {
      pushIssue(issues, path, "invalid_type", "property must be an object");
      continue;
    }
    if (typeof entry["name"] !== "string" || entry["name"].length === 0) {
      pushIssue(
        issues,
        `${path}.name`,
        "missing_required_field",
        "property.name must be a non-empty string",
      );
    }
    if (typeof entry["value"] !== "string") {
      pushIssue(
        issues,
        `${path}.value`,
        "invalid_type",
        "property.value must be a string",
      );
      continue;
    }
    const value = entry["value"];
    if (
      typeof value === "string" &&
      redactHighRiskSecrets(value, REDACTION_PLACEHOLDER) !== value
    ) {
      pushIssue(
        issues,
        `${path}.value`,
        "secret_leak",
        "property.value matched a high-risk secret pattern",
      );
    }
  }
};

const validateHashes = (
  hashes: unknown,
  basePath: string,
  issues: LbomValidationIssue[],
): void => {
  if (!Array.isArray(hashes)) {
    pushIssue(issues, basePath, "invalid_type", "hashes must be an array");
    return;
  }
  const hashArr: unknown[] = hashes as unknown[];
  for (let i = 0; i < hashArr.length; i += 1) {
    const entry: unknown = hashArr[i];
    const path = `${basePath}[${i}]`;
    if (!isRecord(entry)) {
      pushIssue(issues, path, "invalid_type", "hash must be an object");
      continue;
    }
    if (entry["alg"] !== "SHA-256") {
      pushIssue(
        issues,
        `${path}.alg`,
        "invalid_value",
        "hash.alg must be 'SHA-256'",
      );
    }
    if (
      typeof entry["content"] !== "string" ||
      !HEX32_TO_128.test(entry["content"])
    ) {
      pushIssue(
        issues,
        `${path}.content`,
        "invalid_hash",
        "hash.content must be a hex digest matching CycloneDX 1.6",
      );
    }
  }
};

const validateModelComponent = (
  component: Record<string, unknown>,
  index: number,
  bomRefs: Set<string>,
  issues: LbomValidationIssue[],
): void => {
  const path = `components[${index}]`;
  for (const field of ["name", "version", "description", "bom-ref"] as const) {
    if (typeof component[field] !== "string" || component[field] === "") {
      pushIssue(
        issues,
        `${path}.${field}`,
        "missing_required_field",
        `${field} must be a non-empty string`,
      );
    }
  }
  const bomRef = component["bom-ref"];
  if (typeof bomRef === "string") {
    if (bomRefs.has(bomRef)) {
      pushIssue(
        issues,
        `${path}.bom-ref`,
        "duplicate_bom_ref",
        `bom-ref ${bomRef} is duplicated`,
      );
    } else {
      bomRefs.add(bomRef);
    }
  }
  if (component["hashes"] !== undefined) {
    validateHashes(component["hashes"], `${path}.hashes`, issues);
  }
  validateProperties(component["properties"], `${path}.properties`, issues);
  const modelCard = component["modelCard"];
  if (!isRecord(modelCard)) {
    pushIssue(
      issues,
      `${path}.modelCard`,
      "missing_required_field",
      "modelCard must be an object on machine-learning-model components",
    );
    return;
  }
  const modelParameters = modelCard["modelParameters"];
  if (!isRecord(modelParameters)) {
    pushIssue(
      issues,
      `${path}.modelCard.modelParameters`,
      "missing_required_field",
      "modelParameters must be an object",
    );
  } else if (
    typeof modelParameters["task"] !== "string" ||
    modelParameters["task"].length === 0
  ) {
    pushIssue(
      issues,
      `${path}.modelCard.modelParameters.task`,
      "missing_required_field",
      "modelParameters.task must be a non-empty string",
    );
  }
  const considerations = modelCard["considerations"];
  if (considerations !== undefined && !isRecord(considerations)) {
    pushIssue(
      issues,
      `${path}.modelCard.considerations`,
      "invalid_type",
      "considerations must be an object when present",
    );
  }
};

const validateDataComponent = (
  component: Record<string, unknown>,
  index: number,
  bomRefs: Set<string>,
  issues: LbomValidationIssue[],
): void => {
  const path = `components[${index}]`;
  for (const field of ["name", "version", "description", "bom-ref"] as const) {
    if (typeof component[field] !== "string" || component[field] === "") {
      pushIssue(
        issues,
        `${path}.${field}`,
        "missing_required_field",
        `${field} must be a non-empty string`,
      );
    }
  }
  const bomRef = component["bom-ref"];
  if (typeof bomRef === "string") {
    if (bomRefs.has(bomRef)) {
      pushIssue(
        issues,
        `${path}.bom-ref`,
        "duplicate_bom_ref",
        `bom-ref ${bomRef} is duplicated`,
      );
    } else {
      bomRefs.add(bomRef);
    }
  }
  validateHashes(component["hashes"], `${path}.hashes`, issues);
  validateProperties(component["properties"], `${path}.properties`, issues);
  if (component["contents"] !== undefined) {
    pushIssue(
      issues,
      `${path}.contents`,
      "raw_prompt_leak",
      "data components must not embed raw `contents` payloads in workspace-dev",
    );
  }
};

const validateMetadata = (
  metadata: unknown,
  issues: LbomValidationIssue[],
): void => {
  if (!isRecord(metadata)) {
    pushIssue(
      issues,
      "metadata",
      "missing_required_field",
      "metadata must be an object",
    );
    return;
  }
  if (
    typeof metadata["timestamp"] !== "string" ||
    !ISO_TIMESTAMP.test(metadata["timestamp"])
  ) {
    pushIssue(
      issues,
      "metadata.timestamp",
      "invalid_timestamp",
      "metadata.timestamp must be an ISO-8601 date-time string",
    );
  }
  const tools = metadata["tools"];
  if (!isRecord(tools) || !Array.isArray(tools["components"])) {
    pushIssue(
      issues,
      "metadata.tools.components",
      "invalid_type",
      "metadata.tools.components must be an array",
    );
  } else {
    const toolsArr: unknown[] = tools["components"] as unknown[];
    for (let i = 0; i < toolsArr.length; i += 1) {
      const tool: unknown = toolsArr[i];
      const path = `metadata.tools.components[${i}]`;
      if (!isRecord(tool)) {
        pushIssue(issues, path, "invalid_type", "tool entry must be an object");
        continue;
      }
      for (const field of [
        "type",
        "name",
        "version",
        "publisher",
        "description",
      ] as const) {
        if (typeof tool[field] !== "string" || tool[field] === "") {
          pushIssue(
            issues,
            `${path}.${field}`,
            "missing_required_field",
            `${field} must be a non-empty string`,
          );
        }
      }
    }
  }
  const subject = metadata["component"];
  if (!isRecord(subject)) {
    pushIssue(
      issues,
      "metadata.component",
      "missing_required_field",
      "metadata.component must be an object",
    );
  } else {
    for (const field of [
      "type",
      "bom-ref",
      "name",
      "version",
      "description",
    ] as const) {
      if (typeof subject[field] !== "string" || subject[field] === "") {
        pushIssue(
          issues,
          `metadata.component.${field}`,
          "missing_required_field",
          `metadata.component.${field} must be a non-empty string`,
        );
      }
    }
    validateProperties(
      subject["properties"],
      "metadata.component.properties",
      issues,
    );
  }
  validateProperties(metadata["properties"], "metadata.properties", issues);
};

const validateMetadataInvariantProperties = (
  document: Record<string, unknown>,
  issues: LbomValidationIssue[],
): void => {
  const metadata = document["metadata"];
  const properties =
    isRecord(metadata) && Array.isArray(metadata["properties"])
      ? (metadata["properties"] as unknown[])
      : [];
  const values = new Map<string, string>();
  for (const entry of properties) {
    if (!isRecord(entry)) continue;
    const name = entry["name"];
    const value = entry["value"];
    if (typeof name === "string" && typeof value === "string") {
      values.set(name, value);
    }
  }

  for (const name of [
    "workspace-dev:secretsIncluded",
    "workspace-dev:rawPromptsIncluded",
    "workspace-dev:rawScreenshotsIncluded",
  ] as const) {
    if (values.get(name) !== "false") {
      pushIssue(
        issues,
        `metadata.properties.${name}`,
        "invalid_value",
        `${name} must be the string "false"`,
      );
    }
  }
};

const validateDependencies = (
  dependencies: unknown,
  bomRefs: Set<string>,
  issues: LbomValidationIssue[],
): void => {
  if (!Array.isArray(dependencies)) {
    pushIssue(
      issues,
      "dependencies",
      "invalid_type",
      "dependencies must be an array",
    );
    return;
  }
  const depsArr: unknown[] = dependencies as unknown[];
  for (let i = 0; i < depsArr.length; i += 1) {
    const entry: unknown = depsArr[i];
    const path = `dependencies[${i}]`;
    if (!isRecord(entry)) {
      pushIssue(
        issues,
        path,
        "invalid_type",
        "dependency entry must be an object",
      );
      continue;
    }
    if (typeof entry["ref"] !== "string" || !bomRefs.has(entry["ref"])) {
      pushIssue(
        issues,
        `${path}.ref`,
        "unknown_dependency_ref",
        `dependency.ref ${String(entry["ref"])} does not match any component bom-ref`,
      );
    }
    if (!Array.isArray(entry["dependsOn"])) {
      pushIssue(
        issues,
        `${path}.dependsOn`,
        "invalid_type",
        "dependency.dependsOn must be an array",
      );
      continue;
    }
    const dependsOnArr: unknown[] = entry["dependsOn"] as unknown[];
    for (let j = 0; j < dependsOnArr.length; j += 1) {
      const ref: unknown = dependsOnArr[j];
      if (typeof ref !== "string" || !bomRefs.has(ref)) {
        pushIssue(
          issues,
          `${path}.dependsOn[${j}]`,
          "unknown_dependency_ref",
          `dependsOn ref ${String(ref)} does not match any component bom-ref`,
        );
      }
    }
  }
};

/**
 * Validate a CycloneDX 1.6 ML-BOM document emitted by workspace-dev.
 *
 * The validator is structural and domain-aware. It enforces the field
 * shape `buildLbomDocument` produces, the CycloneDX 1.6 enum values used
 * by workspace-dev (single hash algorithm, single license style, etc.),
 * and the workspace-dev hard invariants — refusing any field that smells
 * like a high-risk secret per `redactHighRiskSecrets` or any field that
 * could leak prompt text or screenshot bytes.
 */
export const validateLbomDocument = (
  document: unknown,
): LbomValidationResult => {
  const issues: LbomValidationIssue[] = [];

  if (!isRecord(document)) {
    pushIssue(issues, "$", "invalid_type", "document must be a plain object");
    return { valid: false, issues };
  }

  if (document["bomFormat"] !== "CycloneDX") {
    pushIssue(
      issues,
      "bomFormat",
      "invalid_value",
      'bomFormat must be "CycloneDX"',
    );
  }
  if (document["specVersion"] !== LBOM_CYCLONEDX_SPEC_VERSION) {
    pushIssue(
      issues,
      "specVersion",
      "invalid_value",
      `specVersion must be "${LBOM_CYCLONEDX_SPEC_VERSION}"`,
    );
  }
  if (document["version"] !== 1) {
    pushIssue(
      issues,
      "version",
      "invalid_value",
      "version must be the integer 1",
    );
  }
  if (
    typeof document["serialNumber"] !== "string" ||
    !document["serialNumber"].startsWith(SERIAL_NUMBER_PREFIX) ||
    !RFC4122_UUID.test(
      document["serialNumber"].slice(SERIAL_NUMBER_PREFIX.length),
    )
  ) {
    pushIssue(
      issues,
      "serialNumber",
      "invalid_serial_number",
      "serialNumber must be an `urn:uuid:` RFC-4122 UUID",
    );
  }

  validateMetadata(document["metadata"], issues);
  validateMetadataInvariantProperties(document, issues);

  const bomRefs = new Set<string>();
  // The dependency graph is allowed to root at the BOM subject component
  // (recorded under metadata.component) — register its bom-ref alongside
  // the component bom-refs so dependency validation succeeds on the
  // canonical document shape produced by `buildLbomDocument`.
  const metadataNode = document["metadata"];
  if (isRecord(metadataNode)) {
    const subject = metadataNode["component"];
    if (
      isRecord(subject) &&
      typeof subject["bom-ref"] === "string" &&
      subject["bom-ref"].length > 0
    ) {
      bomRefs.add(subject["bom-ref"]);
    }
  }
  if (!Array.isArray(document["components"])) {
    pushIssue(
      issues,
      "components",
      "invalid_type",
      "components must be an array",
    );
    return { valid: false, issues };
  }

  let modelCount = 0;
  let dataCount = 0;
  const componentsArr: unknown[] = document["components"] as unknown[];
  for (let i = 0; i < componentsArr.length; i += 1) {
    const component: unknown = componentsArr[i];
    const path = `components[${i}]`;
    if (!isRecord(component)) {
      pushIssue(issues, path, "invalid_type", "component must be an object");
      continue;
    }
    if (component["type"] === "machine-learning-model") {
      modelCount += 1;
      validateModelComponent(component, i, bomRefs, issues);
    } else if (component["type"] === "data") {
      dataCount += 1;
      validateDataComponent(component, i, bomRefs, issues);
    } else {
      pushIssue(
        issues,
        `${path}.type`,
        "invalid_value",
        "component.type must be 'machine-learning-model' or 'data'",
      );
    }
  }
  if (modelCount < 3) {
    pushIssue(
      issues,
      "components",
      "missing_required_field",
      "expected at least 3 machine-learning-model components (test_generation + visual_primary + visual_fallback)",
    );
  }
  if (dataCount < 2) {
    pushIssue(
      issues,
      "components",
      "missing_required_field",
      "expected at least 2 data components (few-shot bundle + policy profile)",
    );
  }

  validateDependencies(document["dependencies"], bomRefs, issues);

  return { valid: issues.length === 0, issues };
};

const sha256OfBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Inputs for `writeLbomArtifact`. */
export interface WriteLbomArtifactInput {
  document: Wave1ValidationLbomDocument;
  /** Run directory; the LBOM is written under `lbom/ai-bom.cdx.json`. */
  runDir: string;
}

/** Result of `writeLbomArtifact`. */
export interface WriteLbomArtifactResult {
  /** Absolute path of the persisted artifact. */
  artifactPath: string;
  /**
   * Filename relative to the run directory. Always
   * `lbom/ai-bom.cdx.json` so the manifest entry is stable.
   */
  filename: `${typeof LBOM_ARTIFACT_DIRECTORY}/${typeof LBOM_ARTIFACT_FILENAME}`;
  /** Persisted UTF-8 bytes (the canonical-JSON encoding of the document). */
  bytes: Uint8Array;
  /** SHA-256 of the persisted bytes (hex, lowercase). */
  sha256: string;
}

/**
 * Persist the LBOM document under `<runDir>/lbom/ai-bom.cdx.json`. Uses
 * an atomic `${pid}.${randomUUID()}.tmp` rename so concurrent harness
 * runs cannot corrupt the artifact.
 */
export const writeLbomArtifact = async (
  input: WriteLbomArtifactInput,
): Promise<WriteLbomArtifactResult> => {
  const validation = validateLbomDocument(input.document);
  if (!validation.valid) {
    const summary = validation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new RangeError(
      `writeLbomArtifact: refusing to persist invalid LBOM (${summary})`,
    );
  }
  const lbomDir = join(input.runDir, LBOM_ARTIFACT_DIRECTORY);
  await mkdir(lbomDir, { recursive: true });
  const artifactPath = join(lbomDir, LBOM_ARTIFACT_FILENAME);
  const serialized = canonicalJson(input.document);
  const bytes = new TextEncoder().encode(serialized);
  await mkdir(dirname(artifactPath), { recursive: true });
  const tmp = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, artifactPath);
  return {
    artifactPath,
    filename: `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}` as const,
    bytes,
    sha256: sha256OfBytes(bytes),
  };
};

/** Build a non-secret summary of a written LBOM artifact. */
export const summarizeLbomArtifact = (input: {
  document: Wave1ValidationLbomDocument;
  bytes: Uint8Array;
}): Wave1ValidationLbomSummary => {
  const models = input.document.components.filter(
    (component) => component.type === "machine-learning-model",
  ).length;
  const data = input.document.components.filter(
    (component) => component.type === "data",
  ).length;
  const fallbackProperty = input.document.metadata.properties.find(
    (property) => property.name === "workspace-dev:visualFallbackUsed",
  );
  return {
    schemaVersion: LBOM_ARTIFACT_SCHEMA_VERSION,
    filename: `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
    bytes: input.bytes.byteLength,
    sha256: sha256OfBytes(input.bytes),
    componentCounts: { models, data },
    visualFallbackUsed: fallbackProperty?.value === "true",
  };
};

/** Extract the LBOM data-kind from a data-component bom-ref, if recognised. */
export const lbomDataKindFromBomRef = (
  bomRef: string,
): LbomDataKind | undefined => {
  if (bomRef === "data:few-shot-bundle") return "few_shot_bundle";
  if (bomRef === "data:policy-profile") return "policy_profile";
  return undefined;
};

/** Re-exported visual-sidecar fallback predicate (validation-only helper). */
export const isAllowedVisualFallbackReason = (
  value: string,
): value is VisualSidecarFallbackReason =>
  ALLOWED_VISUAL_FALLBACK_REASONS.has(value as VisualSidecarFallbackReason);
