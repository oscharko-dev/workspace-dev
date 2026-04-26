/**
 * Unit + integration tests for the per-job LBOM emitter (Issue #1378).
 *
 * Covers:
 *   - Document shape (CycloneDX 1.6 ML-BOM): bomFormat, specVersion, version,
 *     serialNumber, metadata, model + data components, dependencies graph.
 *   - Hard invariants: CycloneDX metadata properties for secretsIncluded /
 *     rawPromptsIncluded / rawScreenshotsIncluded.
 *   - Validator: positive run on a freshly built document and negative
 *     diagnostics for malformed documents (bad bomFormat / specVersion /
 *     hash / serialNumber / dependency ref / secret leak / raw prompt leak).
 *   - Redaction regression: high-risk secret patterns inside a deployment
 *     label or policy id are sanitised before they reach the artifact.
 *   - Byte stability: same input → byte-identical canonical JSON.
 *   - Visual fallback signal: success with `fallbackReason !== "none"` flips
 *     the metadata + visual_fallback component property to `"true"`.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_LBOM_MODEL_ROLES,
  CONTRACT_VERSION,
  LBOM_ARTIFACT_DIRECTORY,
  LBOM_ARTIFACT_FILENAME,
  LBOM_ARTIFACT_SCHEMA_VERSION,
  LBOM_CYCLONEDX_SPEC_VERSION,
  type TestCasePolicyProfile,
  type VisualSidecarResult,
  type Wave1PocLbomDocument,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildLbomDocument,
  isAllowedVisualFallbackReason,
  lbomDataKindFromBomRef,
  summarizeLbomArtifact,
  validateLbomDocument,
  writeLbomArtifact,
} from "./lbom-emitter.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";

const GENERATED_AT = "2026-04-26T12:00:00.000Z";

const SAMPLE_HASHES = {
  promptHash: "a".repeat(64),
  schemaHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  cacheKeyDigest: "d".repeat(64),
};

const baseInput = (
  overrides?: Partial<Parameters<typeof buildLbomDocument>[0]>,
): Parameters<typeof buildLbomDocument>[0] => ({
  fixtureId: "poc-onboarding",
  jobId: "job-test-1378",
  generatedAt: GENERATED_AT,
  modelDeployments: {
    testGeneration: "gpt-oss-120b-mock",
    visualPrimary: "llama-4-maverick-vision",
    visualFallback: "phi-4-multimodal-poc",
  },
  policyProfile: cloneEuBankingDefaultProfile(),
  exportProfile: { id: "opentext-alm-default", version: "1.0.0" },
  hashes: SAMPLE_HASHES,
  testGenerationBinding: {
    modelRevision: "gpt-oss-120b-2026-04-25",
    gatewayRelease: "wave1-poc-mock",
  },
  ...(overrides ?? {}),
});

const findComponent = (
  doc: Wave1PocLbomDocument,
  bomRef: string,
): Wave1PocLbomDocument["components"][number] | undefined =>
  doc.components.find((component) => component["bom-ref"] === bomRef);

const propertyMap = (
  properties: ReadonlyArray<{ name: string; value: string }>,
): Map<string, string> => new Map(properties.map((p) => [p.name, p.value]));

test("buildLbomDocument: emits a CycloneDX 1.6 ML-BOM with all required roots", () => {
  const doc = buildLbomDocument(baseInput());
  assert.equal(doc.bomFormat, "CycloneDX");
  assert.equal(doc.specVersion, LBOM_CYCLONEDX_SPEC_VERSION);
  assert.equal(doc.version, 1);
  assert.match(
    doc.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(doc.metadata.timestamp, GENERATED_AT);
  assert.equal(doc.metadata.tools.components[0]?.name, "workspace-dev");
  assert.equal(doc.metadata.tools.components[0]?.version, CONTRACT_VERSION);
  assert.equal(doc.metadata.component["bom-ref"], "job:job-test-1378");
  const metadataProps = propertyMap(doc.metadata.properties);
  assert.equal(metadataProps.get("workspace-dev:secretsIncluded"), "false");
  assert.equal(metadataProps.get("workspace-dev:rawPromptsIncluded"), "false");
  assert.equal(
    metadataProps.get("workspace-dev:rawScreenshotsIncluded"),
    "false",
  );
});

test("buildLbomDocument: emits exactly the three required model roles + two data components", () => {
  const doc = buildLbomDocument(baseInput());
  const models = doc.components.filter(
    (component) => component.type === "machine-learning-model",
  );
  const data = doc.components.filter((component) => component.type === "data");
  assert.equal(models.length, 3);
  assert.equal(data.length, 2);
  for (const role of ALLOWED_LBOM_MODEL_ROLES) {
    const component = findComponent(doc, `model:${role}`);
    assert.ok(component, `expected component for role ${role}`);
    assert.equal(component?.type, "machine-learning-model");
  }
  assert.ok(findComponent(doc, "data:few-shot-bundle"));
  assert.ok(findComponent(doc, "data:policy-profile"));
});

test("buildLbomDocument: model components carry deployment + role + image-input + fallback properties", () => {
  const doc = buildLbomDocument(baseInput());
  const generator = findComponent(doc, "model:test_generation");
  assert.ok(generator);
  assert.equal(generator?.name, "gpt-oss-120b");
  if (generator?.type === "machine-learning-model") {
    const propMap = propertyMap(generator.properties);
    assert.equal(propMap.get("workspace-dev:role"), "test_generation");
    assert.equal(propMap.get("workspace-dev:deployment"), "gpt-oss-120b-mock");
    assert.equal(propMap.get("workspace-dev:format"), "unknown");
    assert.equal(propMap.get("workspace-dev:imageInputSupport"), "false");
    assert.equal(propMap.get("workspace-dev:licenseStatus"), "unknown");
    assert.equal(propMap.get("workspace-dev:provider"), "unknown");
    assert.equal(propMap.get("workspace-dev:fallbackUsed"), "false");
    assert.equal(
      generator.modelCard.modelParameters?.task,
      "structured-test-case-generation",
    );
    assert.ok(
      (generator.modelCard.considerations?.useCases ?? []).length > 0,
      "considerations.useCases must be populated",
    );
    assert.ok(
      (generator.modelCard.considerations?.ethicalConsiderations ?? []).every(
        (risk) => typeof risk.name === "string" && risk.name.length > 0,
      ),
      "ethical considerations must use CycloneDX risk objects",
    );
  } else {
    assert.fail("expected test_generation to be machine-learning-model");
  }

  const visualPrimary = findComponent(doc, "model:visual_primary");
  if (visualPrimary?.type === "machine-learning-model") {
    const propMap = propertyMap(visualPrimary.properties);
    assert.equal(propMap.get("workspace-dev:imageInputSupport"), "true");
    assert.equal(propMap.get("workspace-dev:role"), "visual_primary");
  } else {
    assert.fail("expected visual_primary component");
  }
});

test("buildLbomDocument: optional visual model identity and weights flow into components", () => {
  const doc = buildLbomDocument(
    baseInput({
      visualModelBindings: {
        visual_primary: {
          modelRevision: "llama-4-maverick-vision@test",
          gatewayRelease: "mock@2026.04",
          compatibilityMode: "openai_chat",
          provider: "operator-configured",
          licenseStatus: "unknown",
        },
        visual_fallback: {
          modelRevision: "phi-4-multimodal-poc@test",
          gatewayRelease: "mock@2026.04",
          compatibilityMode: "openai_chat",
          provider: "operator-configured",
          licenseStatus: "unknown",
        },
      },
      weightsSha256: {
        visual_primary: "a".repeat(64),
        visual_fallback: "b".repeat(64),
      },
    }),
  );

  const primary = findComponent(doc, "model:visual_primary");
  assert.equal(primary?.type, "machine-learning-model");
  if (primary?.type !== "machine-learning-model") return;
  const props = propertyMap(primary.properties);
  assert.equal(primary.version, "llama-4-maverick-vision@test");
  assert.equal(props.get("workspace-dev:gatewayRelease"), "mock@2026.04");
  assert.equal(props.get("workspace-dev:format"), "openai_chat");
  assert.equal(props.get("workspace-dev:provider"), "operator-configured");
  assert.equal(props.get("workspace-dev:licenseStatus"), "unknown");
  assert.equal(primary.hashes?.[0]?.content, "a".repeat(64));
});

test("buildLbomDocument: few-shot bundle component carries promptHash + schemaHash", () => {
  const doc = buildLbomDocument(baseInput());
  const bundle = findComponent(doc, "data:few-shot-bundle");
  assert.ok(bundle);
  if (bundle?.type === "data") {
    const hashContents = bundle.hashes.map((h) => h.content).sort();
    assert.deepEqual(
      hashContents,
      [SAMPLE_HASHES.promptHash, SAMPLE_HASHES.schemaHash].sort(),
    );
    assert.ok(bundle.hashes.every((h) => h.alg === "SHA-256"));
  } else {
    assert.fail("expected few-shot-bundle data component");
  }
});

test("buildLbomDocument: policy-profile component hashes the canonical profile object", () => {
  const profile = cloneEuBankingDefaultProfile();
  const expected = sha256Hex(profile);
  const doc = buildLbomDocument(baseInput({ policyProfile: profile }));
  const policy = findComponent(doc, "data:policy-profile");
  if (policy?.type === "data") {
    assert.equal(policy.hashes[0]?.content, expected);
    assert.equal(policy.name, profile.id);
    assert.equal(policy.version, profile.version);
  } else {
    assert.fail("expected policy-profile data component");
  }
});

test("buildLbomDocument: dependencies form a closed graph rooted at the job subject", () => {
  const doc = buildLbomDocument(baseInput());
  const refs = new Set(doc.components.map((component) => component["bom-ref"]));
  refs.add(doc.metadata.component["bom-ref"]);
  for (const dep of doc.dependencies) {
    assert.ok(
      refs.has(dep.ref),
      `dependency ref ${dep.ref} must point at a known bom-ref`,
    );
    for (const child of dep.dependsOn) {
      assert.ok(
        refs.has(child),
        `dependsOn ${child} must point at a known bom-ref`,
      );
    }
  }
});

test("buildLbomDocument: serialNumber is byte-stable across rebuilds with identical inputs", () => {
  const docA = buildLbomDocument(baseInput());
  const docB = buildLbomDocument(baseInput());
  assert.equal(canonicalJson(docA), canonicalJson(docB));
});

test("buildLbomDocument: serialNumber differs when cacheKeyDigest changes", () => {
  const docA = buildLbomDocument(baseInput());
  const docB = buildLbomDocument(
    baseInput({ hashes: { ...SAMPLE_HASHES, cacheKeyDigest: "e".repeat(64) } }),
  );
  assert.notEqual(docA.serialNumber, docB.serialNumber);
});

test("buildLbomDocument: visual sidecar success with fallback flips metadata + component flag", () => {
  const sidecar: VisualSidecarResult = {
    outcome: "success",
    selectedDeployment: "phi-4-multimodal-poc",
    fallbackReason: "primary_unavailable",
    visual: [],
    captureIdentities: [],
    attempts: [],
    confidenceSummary: { min: 0.5, max: 0.9, mean: 0.7 },
    validationReport: {
      schemaVersion: "1.0.0",
      generatedAt: GENERATED_AT,
      blocked: false,
      issues: [],
      passed: [],
      jobId: "job-test-1378",
      primaryDeployment: "llama-4-maverick-vision",
    } as VisualSidecarResult extends { validationReport: infer V } ? V : never,
  } as VisualSidecarResult;
  const doc = buildLbomDocument(baseInput({ visualSidecar: sidecar }));
  const props = propertyMap(doc.metadata.properties);
  assert.equal(props.get("workspace-dev:visualFallbackUsed"), "true");
  assert.equal(
    props.get("workspace-dev:visualFallbackReason"),
    "primary_unavailable",
  );
  assert.equal(
    props.get("workspace-dev:visualSelectedDeployment"),
    "phi-4-multimodal-poc",
  );
  const fallback = findComponent(doc, "model:visual_fallback");
  if (fallback?.type === "machine-learning-model") {
    const fallbackProps = propertyMap(fallback.properties);
    assert.equal(fallbackProps.get("workspace-dev:fallbackUsed"), "true");
  }
});

test("buildLbomDocument: rejects non-hex hash inputs", () => {
  assert.throws(
    () =>
      buildLbomDocument(
        baseInput({ hashes: { ...SAMPLE_HASHES, promptHash: "not-hex" } }),
      ),
    /promptHash must be a sha256 hex string/,
  );
});

test("validateLbomDocument: passes on a freshly built document", () => {
  const doc = buildLbomDocument(baseInput());
  const result = validateLbomDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.issues.length, 0);
});

test("validateLbomDocument: catches invalid bomFormat", () => {
  const doc = buildLbomDocument(baseInput()) as Wave1PocLbomDocument & {
    bomFormat: string;
  };
  const tampered = { ...doc, bomFormat: "SPDX" };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.path === "bomFormat"));
});

test("validateLbomDocument: catches invalid specVersion", () => {
  const doc = buildLbomDocument(baseInput());
  const tampered = { ...doc, specVersion: "1.5" } as unknown as Record<
    string,
    unknown
  >;
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.path === "specVersion"));
});

test("validateLbomDocument: catches invalid serialNumber", () => {
  const doc = buildLbomDocument(baseInput());
  const tampered = { ...doc, serialNumber: "not-a-uuid" };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (i) => i.path === "serialNumber" && i.code === "invalid_serial_number",
    ),
  );
});

test("validateLbomDocument: catches non-hex hash content", () => {
  const doc = buildLbomDocument(baseInput()) as Wave1PocLbomDocument;
  const components = doc.components.map((c) => ({ ...c }));
  const policyComponent = components.find(
    (c) => c["bom-ref"] === "data:policy-profile",
  );
  if (policyComponent?.type === "data") {
    policyComponent.hashes = [{ alg: "SHA-256", content: "ZZZ" }];
  }
  const tampered = { ...doc, components };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((i) => i.code === "invalid_hash"),
    `expected invalid_hash issue, got ${JSON.stringify(result.issues)}`,
  );
});

test("validateLbomDocument: catches duplicate bom-ref entries", () => {
  const doc = buildLbomDocument(baseInput());
  const components = [...doc.components, { ...doc.components[0]! }];
  const tampered = { ...doc, components };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "duplicate_bom_ref"));
});

test("validateLbomDocument: catches dangling dependency refs", () => {
  const doc = buildLbomDocument(baseInput());
  const dependencies = [
    {
      ref: "model:nonexistent",
      dependsOn: ["data:few-shot-bundle"],
    },
  ];
  const tampered = { ...doc, dependencies };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "unknown_dependency_ref"));
});

test("validateLbomDocument: catches a flipped invariant", () => {
  const doc = buildLbomDocument(baseInput());
  const tampered = {
    ...doc,
    metadata: {
      ...doc.metadata,
      properties: doc.metadata.properties.map((property) =>
        property.name === "workspace-dev:secretsIncluded"
          ? { ...property, value: "true" }
          : property,
      ),
    },
  };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (i) => i.path === "metadata.properties.workspace-dev:secretsIncluded",
    ),
  );
});

test("validateLbomDocument: catches raw `contents` payload on a data component", () => {
  const doc = buildLbomDocument(baseInput());
  const components = doc.components.map((c) =>
    c["bom-ref"] === "data:few-shot-bundle"
      ? {
          ...c,
          contents: {
            attachment: { contentType: "text/plain", content: "raw" },
          },
        }
      : c,
  );
  const tampered = { ...doc, components };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "raw_prompt_leak"));
});

test("validateLbomDocument: catches a high-risk secret pattern in a property value", () => {
  const doc = buildLbomDocument(baseInput()) as Wave1PocLbomDocument;
  const components = doc.components.map((c) => ({
    ...c,
    properties: [...c.properties],
  }));
  const generator = components.find(
    (c) => c["bom-ref"] === "model:test_generation",
  );
  if (generator) {
    generator.properties.push({
      name: "leak",
      // pragma: allowlist secret — synthetic Bearer-shaped string for the negative test
      value: "Authorization: Bearer abcdef0123456789",
    });
  }
  const tampered = { ...doc, components };
  const result = validateLbomDocument(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === "secret_leak"));
});

test("buildLbomDocument: redacts a deployment label that smells like a secret", () => {
  const doc = buildLbomDocument(
    baseInput({
      modelDeployments: {
        testGeneration: "gpt-oss-120b-mock",
        // pragma: allowlist secret — synthetic Bearer-shaped string for redaction regression
        visualPrimary: "Bearer abcdef0123456789",
        visualFallback: "phi-4-multimodal-poc",
      },
    }),
  );
  const visualPrimary = findComponent(doc, "model:visual_primary");
  if (visualPrimary?.type === "machine-learning-model") {
    const props = propertyMap(visualPrimary.properties);
    const deployment = props.get("workspace-dev:deployment") ?? "";
    assert.ok(
      !deployment.includes("abcdef0123456789"),
      `expected redaction; got ${deployment}`,
    );
  }
});

test("writeLbomArtifact: persists canonical JSON under runDir/lbom and validates", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-lbom-"));
  const doc = buildLbomDocument(baseInput());
  const result = await writeLbomArtifact({ document: doc, runDir });
  assert.equal(
    result.filename,
    `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
  );
  assert.ok(
    result.artifactPath.endsWith(
      `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
    ),
  );
  const onDisk = await readFile(result.artifactPath, "utf8");
  assert.equal(onDisk, canonicalJson(doc));
  const parsed = JSON.parse(onDisk) as Wave1PocLbomDocument;
  const validation = validateLbomDocument(parsed);
  assert.equal(
    validation.valid,
    true,
    JSON.stringify(validation.issues, null, 2),
  );
});

test("writeLbomArtifact: refuses to persist an invalid document", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-lbom-bad-"));
  const doc = buildLbomDocument(baseInput()) as Wave1PocLbomDocument;
  const tampered = {
    ...doc,
    metadata: {
      ...doc.metadata,
      properties: doc.metadata.properties.map((property) =>
        property.name === "workspace-dev:secretsIncluded"
          ? { ...property, value: "true" }
          : property,
      ),
    },
  } as unknown as Wave1PocLbomDocument;
  await assert.rejects(
    () => writeLbomArtifact({ document: tampered, runDir }),
    /refusing to persist invalid LBOM/,
  );
});

test("summarizeLbomArtifact: counts components and reports the visual fallback flag", () => {
  const doc = buildLbomDocument(baseInput());
  const bytes = new TextEncoder().encode(canonicalJson(doc));
  const summary = summarizeLbomArtifact({ document: doc, bytes });
  assert.equal(summary.schemaVersion, LBOM_ARTIFACT_SCHEMA_VERSION);
  assert.equal(summary.componentCounts.models, 3);
  assert.equal(summary.componentCounts.data, 2);
  assert.equal(summary.bytes, bytes.byteLength);
  assert.match(summary.sha256, /^[0-9a-f]{64}$/);
  assert.equal(summary.visualFallbackUsed, false);
  assert.equal(
    summary.filename,
    `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
  );
});

test("lbomDataKindFromBomRef: maps known data-component bom-refs", () => {
  assert.equal(
    lbomDataKindFromBomRef("data:few-shot-bundle"),
    "few_shot_bundle",
  );
  assert.equal(lbomDataKindFromBomRef("data:policy-profile"), "policy_profile");
  assert.equal(lbomDataKindFromBomRef("model:test_generation"), undefined);
});

test("isAllowedVisualFallbackReason: matches the contract enum", () => {
  assert.equal(isAllowedVisualFallbackReason("none"), true);
  assert.equal(isAllowedVisualFallbackReason("primary_unavailable"), true);
  assert.equal(isAllowedVisualFallbackReason("primary_quota_exceeded"), true);
  assert.equal(isAllowedVisualFallbackReason("policy_downgrade"), true);
  assert.equal(isAllowedVisualFallbackReason("nope"), false);
});

test("buildLbomDocument: properties are sorted by name (deterministic)", () => {
  const doc = buildLbomDocument(baseInput());
  for (const component of doc.components) {
    const names = component.properties.map((p) => p.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  }
  const meta = doc.metadata.properties.map((p) => p.name);
  assert.deepEqual(meta, [...meta].sort());
});

test("buildLbomDocument: matches a fresh policy profile clone", () => {
  const profile: TestCasePolicyProfile = cloneEuBankingDefaultProfile();
  const doc = buildLbomDocument(baseInput({ policyProfile: profile }));
  const component = findComponent(doc, "data:policy-profile");
  if (component?.type === "data") {
    assert.equal(component.name, profile.id);
    assert.equal(component.version, profile.version);
  } else {
    assert.fail("expected policy-profile component");
  }
});
