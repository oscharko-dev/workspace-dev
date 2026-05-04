import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type TestCasePolicyProfile,
  type Wave1ValidationAttestationSigningMode,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { listWave1ValidationAttestationArtifactPaths } from "./evidence-attestation.js";
import {
  GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
  computeGeneratedTestCaseListSchemaHash,
} from "./generated-test-case-schema.js";
import {
  COMPILED_SYSTEM_PROMPT,
  COMPILED_USER_PROMPT_PREAMBLE,
} from "./prompt-compiler.js";
import {
  VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
  VISUAL_SIDECAR_SYSTEM_PROMPT,
  buildVisualSidecarResponseSchema,
} from "./visual-sidecar-client.js";

export const ML_BOM_CYCLONEDX_SPEC_VERSION = "1.7" as const;
export const ML_BOM_ARTIFACT_SCHEMA_VERSION = "1.0.0" as const;
export const ML_BOM_ARTIFACT_DIRECTORY = "evidence/ml-bom" as const;
export const ML_BOM_ARTIFACT_FILENAME = "cyclonedx-1.7-ml-bom.json" as const;

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const RFC4122_UUID =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REDACTION_PLACEHOLDER = "[redacted]";
const TOOL_BOM_REF = "tool:workspace-dev";
const SUBJECT_BOM_REF = "application:workspace-dev-release";
const POLICY_COMPONENT_BOM_REF = "data:policy-bundle";

const ML_BOM_ROLE_ORDER = [
  "test_generation",
  "visual_primary",
  "visual_fallback",
] as const;

export type MlBomRole = (typeof ML_BOM_ROLE_ORDER)[number];

export interface MlBomModelBinding {
  role: MlBomRole;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  operatorEndpointReference: string;
  compatibilityMode?: string;
  modelWeightsSha256?: string;
}

interface MlBomProperty {
  name: string;
  value: string;
}

interface MlBomHash {
  alg: "SHA-256";
  content: string;
}

interface MlBomExternalReference {
  type:
    | "attestation"
    | "configuration"
    | "documentation"
    | "evidence"
    | "formulation";
  url: string;
}

interface MlBomDataProvenance {
  type: "configuration";
  name: string;
  description: string;
  governance: {
    owners: Array<{ organization: { name: string } }>;
    stewards: Array<{ organization: { name: string } }>;
  };
  contents: {
    properties: MlBomProperty[];
  };
}

export interface MlBomComponent {
  type: "machine-learning-model" | "data";
  "bom-ref": string;
  name: string;
  version: string;
  description: string;
  properties: MlBomProperty[];
  hashes?: MlBomHash[];
  externalReferences?: MlBomExternalReference[];
  data?: MlBomDataProvenance[];
}

export interface MlBomCitation {
  "bom-ref": string;
  pointers: string[];
  timestamp: string;
  attributedTo: string;
  note: string;
}

export interface MlBomDocument {
  $schema: "http://cyclonedx.org/schema/bom-1.7.schema.json";
  bomFormat: "CycloneDX";
  specVersion: typeof ML_BOM_CYCLONEDX_SPEC_VERSION;
  version: 1;
  serialNumber: string;
  metadata: {
    timestamp: string;
    tools: {
      components: Array<{
        type: "application";
        "bom-ref": string;
        name: string;
        version: string;
        publisher: string;
        description: string;
      }>;
    };
    component: {
      type: "application";
      "bom-ref": string;
      name: string;
      version: string;
      description: string;
      properties: MlBomProperty[];
      externalReferences: MlBomExternalReference[];
    };
    properties: MlBomProperty[];
  };
  components: MlBomComponent[];
  dependencies: Array<{
    ref: string;
    dependsOn: string[];
  }>;
  citations: MlBomCitation[];
}

export interface MlBomValidationIssue {
  path: string;
  code:
    | "duplicate_bom_ref"
    | "invalid_hash"
    | "invalid_serial_number"
    | "invalid_timestamp"
    | "invalid_value"
    | "missing_citation"
    | "missing_data_provenance"
    | "missing_required_field"
    | "missing_role"
    | "secret_leak";
  message: string;
}

export interface MlBomValidationResult {
  valid: boolean;
  issues: MlBomValidationIssue[];
}

export interface MlBomSummary {
  schemaVersion: typeof ML_BOM_ARTIFACT_SCHEMA_VERSION;
  filename: `${typeof ML_BOM_ARTIFACT_DIRECTORY}/${typeof ML_BOM_ARTIFACT_FILENAME}`;
  sha256: string;
  bytes: number;
  componentCounts: {
    data: number;
    models: number;
  };
  citations: number;
}

export interface BuildMlBomDocumentInput {
  generatedAt: string;
  signingMode: Wave1ValidationAttestationSigningMode;
  policyProfile: TestCasePolicyProfile;
  modelBindings: ReadonlyArray<MlBomModelBinding>;
}

export interface WriteMlBomArtifactInput {
  document: MlBomDocument;
  runDir: string;
}

export interface WriteMlBomArtifactResult {
  artifactPath: string;
  bytes: Uint8Array;
  sha256: string;
}

const sortProperties = (properties: readonly MlBomProperty[]): MlBomProperty[] =>
  [...properties].sort((left, right) =>
    left.name.localeCompare(right.name) || left.value.localeCompare(right.value),
  );

const sanitizeValue = (value: string): string => {
  const redacted = redactHighRiskSecrets(value, REDACTION_PLACEHOLDER)
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length === 0 ? REDACTION_PLACEHOLDER : redacted;
};

const buildPromptTemplateHash = (input: {
  schemaHash: string;
  schemaName: string;
  systemPrompt: string;
  userPromptPreamble: string;
}): string =>
  sha256Hex({
    systemPrompt: input.systemPrompt,
    userPromptPreamble: input.userPromptPreamble,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    schemaName: input.schemaName,
    schemaHash: input.schemaHash,
  });

const computeSystemPromptHashes = (): Record<MlBomRole, string> => ({
  test_generation: sha256Hex(COMPILED_SYSTEM_PROMPT),
  visual_primary: sha256Hex(VISUAL_SIDECAR_SYSTEM_PROMPT),
  visual_fallback: sha256Hex(VISUAL_SIDECAR_SYSTEM_PROMPT),
});

const computePromptTemplateHashes = (): Record<MlBomRole, string> => {
  const generatedTestCaseSchemaHash = computeGeneratedTestCaseListSchemaHash();
  const visualSchemaHash = sha256Hex(buildVisualSidecarResponseSchema());
  return {
    test_generation: buildPromptTemplateHash({
      schemaHash: generatedTestCaseSchemaHash,
      schemaName: GENERATED_TEST_CASE_LIST_SCHEMA_NAME,
      systemPrompt: COMPILED_SYSTEM_PROMPT,
      userPromptPreamble: COMPILED_USER_PROMPT_PREAMBLE,
    }),
    visual_primary: sha256Hex({
      systemPrompt: VISUAL_SIDECAR_SYSTEM_PROMPT,
      userPromptTemplate: "capture-indexed-screen-observation-envelope-v1",
      schemaName: VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
      schemaHash: visualSchemaHash,
    }),
    visual_fallback: sha256Hex({
      systemPrompt: VISUAL_SIDECAR_SYSTEM_PROMPT,
      userPromptTemplate: "capture-indexed-screen-observation-envelope-v1",
      schemaName: VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME,
      schemaHash: visualSchemaHash,
    }),
  };
};

const buildSerialNumber = (input: {
  modelBindings: ReadonlyArray<MlBomModelBinding>;
  policyBundleHash: string;
  releaseVersion: string;
}): string => {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        releaseVersion: input.releaseVersion,
        policyBundleHash: input.policyBundleHash,
        modelBindings: input.modelBindings.map((binding) => ({
          role: binding.role,
          deployment: binding.deployment,
          modelRevision: binding.modelRevision,
          gatewayRelease: binding.gatewayRelease,
          compatibilityMode: binding.compatibilityMode ?? null,
          modelWeightsSha256: binding.modelWeightsSha256 ?? null,
          operatorEndpointReference: binding.operatorEndpointReference,
        })),
      }),
      "utf8",
    )
    .digest("hex");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
  return `urn:uuid:${uuid}`;
};

const buildModelProperties = (input: {
  binding: MlBomModelBinding;
  promptTemplateHash: string;
  systemPromptHash: string;
}): MlBomProperty[] =>
  sortProperties([
    { name: "workspace-dev:role", value: input.binding.role },
    { name: "workspace-dev:deployment", value: input.binding.deployment },
    { name: "workspace-dev:gatewayRelease", value: input.binding.gatewayRelease },
    {
      name: "workspace-dev:operatorEndpointReference",
      value: sanitizeValue(input.binding.operatorEndpointReference),
    },
    {
      name: "workspace-dev:promptTemplateHash",
      value: input.promptTemplateHash,
    },
    {
      name: "workspace-dev:systemPromptHash",
      value: input.systemPromptHash,
    },
    ...(input.binding.compatibilityMode === undefined
      ? []
      : [
          {
            name: "workspace-dev:compatibilityMode",
            value: input.binding.compatibilityMode,
          },
        ]),
    ...(input.binding.modelWeightsSha256 === undefined
      ? []
      : [
          {
            name: "workspace-dev:modelWeightsSha256",
            value: input.binding.modelWeightsSha256,
          },
        ]),
  ]);

const buildCitation = (input: {
  bomRef: string;
  generatedAt: string;
  note: string;
  pointers: string[];
}): MlBomCitation => ({
  "bom-ref": input.bomRef,
  pointers: [...input.pointers],
  timestamp: input.generatedAt,
  attributedTo: TOOL_BOM_REF,
  note: input.note,
});

const findPropertyIndex = (
  properties: readonly MlBomProperty[],
  name: string,
): number => properties.findIndex((property) => property.name === name);

export const buildMlBomDocument = (
  input: BuildMlBomDocumentInput,
): MlBomDocument => {
  if (!ISO_TIMESTAMP.test(input.generatedAt)) {
    throw new RangeError("buildMlBomDocument: generatedAt must be ISO-8601");
  }
  const releaseName = String(packageJson.name);
  const releaseVersion = String(packageJson.version);
  const policyBundleHash = sha256Hex(input.policyProfile);
  const promptTemplateHashes = computePromptTemplateHashes();
  const systemPromptHashes = computeSystemPromptHashes();
  const attestationRefs = listWave1ValidationAttestationArtifactPaths(input.signingMode);
  const sortedBindings = [...input.modelBindings].sort(
    (left, right) =>
      ML_BOM_ROLE_ORDER.indexOf(left.role) - ML_BOM_ROLE_ORDER.indexOf(right.role),
  );

  const modelComponents: MlBomComponent[] = sortedBindings.map((binding) => ({
    type: "machine-learning-model",
    "bom-ref": `model:${binding.role}`,
    name: sanitizeValue(binding.deployment),
    version: sanitizeValue(binding.modelRevision),
    description: `${binding.role} model binding for workspace-dev ${releaseVersion}.`,
    properties: buildModelProperties({
      binding,
      promptTemplateHash: promptTemplateHashes[binding.role],
      systemPromptHash: systemPromptHashes[binding.role],
    }),
  }));
  const policyComponent: MlBomComponent = {
    type: "data",
    "bom-ref": POLICY_COMPONENT_BOM_REF,
    name: input.policyProfile.id,
    version: input.policyProfile.version,
    description: "Policy bundle provenance for the active test-intelligence gate.",
    hashes: [{ alg: "SHA-256", content: policyBundleHash }],
    properties: sortProperties([
      { name: "workspace-dev:policyBundleHash", value: policyBundleHash },
      {
        name: "workspace-dev:redactionPolicyVersion",
        value: REDACTION_POLICY_VERSION,
      },
    ]),
    data: [
      {
        type: "configuration",
        name: `${input.policyProfile.id}-policy-bundle`,
        description:
          "Structured provenance for the active policy bundle that governed this run.",
        governance: {
          owners: [{ organization: { name: "workspace-dev operator" } }],
          stewards: [{ organization: { name: "workspace-dev policy registry" } }],
        },
        contents: {
          properties: sortProperties([
            { name: "workspace-dev:policyProfileId", value: input.policyProfile.id },
            {
              name: "workspace-dev:policyProfileVersion",
              value: input.policyProfile.version,
            },
            {
              name: "workspace-dev:policyDescription",
              value: sanitizeValue(input.policyProfile.description),
            },
          ]),
        },
      },
    ],
    externalReferences: [
      {
        type: "configuration",
        url: `workspace-dev://policy/${encodeURIComponent(
          input.policyProfile.id,
        )}/${encodeURIComponent(input.policyProfile.version)}`,
      },
    ],
  };

  const metadataProperties = sortProperties([
    {
      name: "workspace-dev:artifactSchemaVersion",
      value: ML_BOM_ARTIFACT_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:contractVersion",
      value: TEST_INTELLIGENCE_CONTRACT_VERSION,
    },
    {
      name: "workspace-dev:releaseVersion",
      value: releaseVersion,
    },
    {
      name: "workspace-dev:testDesignModelSchemaVersion",
      value: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:coveragePlanSchemaVersion",
      value: COVERAGE_PLAN_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:judgePanelVerdictSchemaVersion",
      value: JUDGE_PANEL_VERDICT_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:generatedTestCaseSchemaVersion",
      value: GENERATED_TEST_CASE_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:visualSidecarSchemaVersion",
      value: VISUAL_SIDECAR_SCHEMA_VERSION,
    },
    {
      name: "workspace-dev:promptTemplateVersion",
      value: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    },
  ]);

  const document: MlBomDocument = {
    $schema: "http://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: ML_BOM_CYCLONEDX_SPEC_VERSION,
    version: 1,
    serialNumber: buildSerialNumber({
      modelBindings: sortedBindings,
      policyBundleHash,
      releaseVersion,
    }),
    metadata: {
      timestamp: input.generatedAt,
      tools: {
        components: [
          {
            type: "application",
            "bom-ref": TOOL_BOM_REF,
            name: releaseName,
            version: releaseVersion,
            publisher: "workspace-dev",
            description:
              "Deterministic CycloneDX 1.7 ML-BOM generator for test-intelligence evidence.",
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": SUBJECT_BOM_REF,
        name: releaseName,
        version: releaseVersion,
        description:
          "Release-scoped ML-BOM subject for workspace-dev test-intelligence evidence.",
        properties: sortProperties([
          {
            name: "workspace-dev:attestationSigningMode",
            value: input.signingMode,
          },
          {
            name: "workspace-dev:attestationEnvelopeReference",
            value: attestationRefs[0] ?? "",
          },
          ...(attestationRefs[1] === undefined
            ? []
            : [
                {
                  name: "workspace-dev:sigstoreBundleReference",
                  value: attestationRefs[1],
                },
              ]),
        ]),
        externalReferences: [
          { type: "attestation", url: attestationRefs[0] ?? "" },
          ...(attestationRefs[1] === undefined
            ? []
            : [{ type: "attestation" as const, url: attestationRefs[1] }]),
        ],
      },
      properties: metadataProperties,
    },
    components: [...modelComponents, policyComponent],
    dependencies: [
      {
        ref: SUBJECT_BOM_REF,
        dependsOn: [
          ...sortedBindings.map((binding) => `model:${binding.role}`),
          POLICY_COMPONENT_BOM_REF,
        ],
      },
    ],
    citations: [],
  };

  const citations: MlBomCitation[] = [];
  for (const [componentIndex, binding] of sortedBindings.entries()) {
    const properties = document.components[componentIndex]?.properties ?? [];
    const promptHashIndex = findPropertyIndex(
      properties,
      "workspace-dev:promptTemplateHash",
    );
    const systemPromptHashIndex = findPropertyIndex(
      properties,
      "workspace-dev:systemPromptHash",
    );
    citations.push(
      buildCitation({
        bomRef: `citation:${binding.role}:prompt`,
        generatedAt: input.generatedAt,
        note: `Prompt-template and system-prompt attribution for ${binding.role}.`,
        pointers: [
          `/components/${componentIndex}/properties/${promptHashIndex}/value`,
          `/components/${componentIndex}/properties/${systemPromptHashIndex}/value`,
        ],
      }),
    );
  }
  const policyComponentIndex = document.components.findIndex(
    (component) => component["bom-ref"] === POLICY_COMPONENT_BOM_REF,
  );
  const sigstoreBundleIndex = findPropertyIndex(
    document.metadata.component.properties,
    "workspace-dev:sigstoreBundleReference",
  );
  citations.push(
    buildCitation({
      bomRef: "citation:policy-bundle",
      generatedAt: input.generatedAt,
      note: "Policy bundle provenance and governance attribution.",
      pointers: [
        `/components/${policyComponentIndex}/hashes/0/content`,
        `/components/${policyComponentIndex}/data/0/governance/owners/0/organization/name`,
      ],
    }),
  );
  citations.push(
    buildCitation({
      bomRef: "citation:attestation",
      generatedAt: input.generatedAt,
      note: "Attestation and Sigstore bundle reference attribution.",
      pointers: [
        "/metadata/component/externalReferences/0/url",
        ...(sigstoreBundleIndex >= 0
          ? [`/metadata/component/properties/${sigstoreBundleIndex}/value`]
          : []),
      ],
    }),
  );
  document.citations = citations;
  return document;
};

export const validateMlBomDocument = (
  document: MlBomDocument,
): MlBomValidationResult => {
  const issues: MlBomValidationIssue[] = [];

  if (document.bomFormat !== "CycloneDX") {
    issues.push({
      path: "bomFormat",
      code: "invalid_value",
      message: 'bomFormat must equal "CycloneDX"',
    });
  }
  if (document.specVersion !== ML_BOM_CYCLONEDX_SPEC_VERSION) {
    issues.push({
      path: "specVersion",
      code: "invalid_value",
      message: `specVersion must equal ${ML_BOM_CYCLONEDX_SPEC_VERSION}`,
    });
  }
  if (!RFC4122_UUID.test(document.serialNumber)) {
    issues.push({
      path: "serialNumber",
      code: "invalid_serial_number",
      message: "serialNumber must be an RFC-4122 UUID URN",
    });
  }
  if (!ISO_TIMESTAMP.test(document.metadata.timestamp)) {
    issues.push({
      path: "metadata.timestamp",
      code: "invalid_timestamp",
      message: "metadata.timestamp must be ISO-8601",
    });
  }

  const bomRefs = new Set<string>();
  for (const [index, component] of document.components.entries()) {
    if (bomRefs.has(component["bom-ref"])) {
      issues.push({
        path: `components.${index}.bom-ref`,
        code: "duplicate_bom_ref",
        message: `duplicate bom-ref ${component["bom-ref"]}`,
      });
    }
    bomRefs.add(component["bom-ref"]);

    for (const [propertyIndex, property] of component.properties.entries()) {
      if (
        (property.name.endsWith("Hash") ||
          property.name.endsWith("Sha256") ||
          property.name === "workspace-dev:policyBundleHash") &&
        !HEX64.test(property.value)
      ) {
        issues.push({
          path: `components.${index}.properties.${propertyIndex}.value`,
          code: "invalid_hash",
          message: `${property.name} must be a lowercase sha256 hex string`,
        });
      }
      if (
        property.name === "workspace-dev:operatorEndpointReference" &&
        !property.value.includes("[redacted]")
      ) {
        issues.push({
          path: `components.${index}.properties.${propertyIndex}.value`,
          code: "invalid_value",
          message:
            "operator endpoint references must retain the [redacted] placeholder",
        });
      }
      const redacted = redactHighRiskSecrets(property.value, REDACTION_PLACEHOLDER);
      if (redacted !== property.value) {
        issues.push({
          path: `components.${index}.properties.${propertyIndex}.value`,
          code: "secret_leak",
          message: `${property.name} contains high-risk secret-shaped content`,
        });
      }
    }

    if (
      component.type === "data" &&
      (component.data === undefined ||
        component.data.length === 0 ||
        component.data[0]?.governance.owners.length === 0)
    ) {
      issues.push({
        path: `components.${index}.data`,
        code: "missing_data_provenance",
        message: "data components must declare governance owners",
      });
    }
  }

  for (const role of ML_BOM_ROLE_ORDER) {
    if (!document.components.some((component) => component["bom-ref"] === `model:${role}`)) {
      issues.push({
        path: "components",
        code: "missing_role",
        message: `missing model binding for role ${role}`,
      });
    }
  }

  if (document.citations.length === 0) {
    issues.push({
      path: "citations",
      code: "missing_citation",
      message: "at least one CycloneDX 1.7 citation is required",
    });
  }
  for (const [index, citation] of document.citations.entries()) {
    if (!ISO_TIMESTAMP.test(citation.timestamp)) {
      issues.push({
        path: `citations.${index}.timestamp`,
        code: "invalid_timestamp",
        message: "citation timestamp must be ISO-8601",
      });
    }
    if (citation.pointers.length === 0) {
      issues.push({
        path: `citations.${index}.pointers`,
        code: "missing_citation",
        message: "citation must reference at least one JSON Pointer",
      });
    }
  }

  return { valid: issues.length === 0, issues };
};

export const writeMlBomArtifact = async (
  input: WriteMlBomArtifactInput,
): Promise<WriteMlBomArtifactResult> => {
  const validation = validateMlBomDocument(input.document);
  if (!validation.valid) {
    throw new Error(
      `writeMlBomArtifact: refusing to persist invalid ML-BOM (${validation.issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")})`,
    );
  }

  const artifactPath = join(
    input.runDir,
    ML_BOM_ARTIFACT_DIRECTORY,
    ML_BOM_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(input.document)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return {
    artifactPath,
    bytes,
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
  };
};

export const summarizeMlBomArtifact = (input: {
  bytes: Uint8Array;
  document: MlBomDocument;
}): MlBomSummary => ({
  schemaVersion: ML_BOM_ARTIFACT_SCHEMA_VERSION,
  filename: `${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
  sha256: createHash("sha256").update(input.bytes).digest("hex"),
  bytes: input.bytes.byteLength,
  componentCounts: {
    data: input.document.components.filter((component) => component.type === "data")
      .length,
    models: input.document.components.filter(
      (component) => component.type === "machine-learning-model",
    ).length,
  },
  citations: input.document.citations.length,
});
