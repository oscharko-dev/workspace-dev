import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import {
  ML_BOM_ARTIFACT_DIRECTORY,
  ML_BOM_ARTIFACT_FILENAME,
  ML_BOM_ARTIFACT_SCHEMA_VERSION,
  ML_BOM_CYCLONEDX_SPEC_VERSION,
  buildMlBomDocument,
  summarizeMlBomArtifact,
  validateMlBomDocument,
  writeMlBomArtifact,
  type MlBomDocument,
} from "./ml-bom.js";

const GENERATED_AT = "2026-05-04T08:00:00.000Z";

const buildFixture = (): MlBomDocument =>
  buildMlBomDocument({
    generatedAt: GENERATED_AT,
    signingMode: "sigstore",
    policyProfile: cloneEuBankingDefaultProfile(),
    modelBindings: [
      {
        role: "test_generation",
        deployment: "gpt-oss-120b-mock",
        modelRevision: "gpt-oss-120b-2026-04-25",
        gatewayRelease: "wave1-poc-mock",
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_chat",
      },
      {
        role: "visual_primary",
        deployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision-2026-04-25",
        gatewayRelease: "wave1-poc-mock",
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_responses",
      },
      {
        role: "visual_fallback",
        deployment: "phi-4-multimodal-poc",
        modelRevision: "phi-4-multimodal-poc-2026-04-25",
        gatewayRelease: "wave1-poc-mock",
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_responses",
      },
    ],
  });

test("buildMlBomDocument emits a CycloneDX 1.7 ML-BOM with citations and data provenance", () => {
  const document = buildFixture();

  assert.equal(document.bomFormat, "CycloneDX");
  assert.equal(document.specVersion, ML_BOM_CYCLONEDX_SPEC_VERSION);
  assert.equal(document.version, 1);
  assert.match(document.serialNumber, /^urn:uuid:/);
  assert.equal(document.components.length, 4);
  assert.equal(
    document.components.filter((component) => component.type === "machine-learning-model")
      .length,
    3,
  );
  assert.equal(document.citations.length >= 3, true);

  const policyComponent = document.components.find(
    (component) => component["bom-ref"] === "data:policy-bundle",
  );
  assert.ok(policyComponent);
  assert.equal(policyComponent?.type, "data");
  assert.equal(policyComponent?.data?.[0]?.governance.owners.length, 1);
  assert.equal(
    policyComponent?.properties.some(
      (property) => property.name === "workspace-dev:policyBundleHash",
    ),
    true,
  );

  for (const role of ["test_generation", "visual_primary", "visual_fallback"] as const) {
    const component = document.components.find(
      (entry) => entry["bom-ref"] === `model:${role}`,
    );
    assert.ok(component, `missing model component for ${role}`);
    const properties = new Map(
      component?.properties.map((property) => [property.name, property.value]),
    );
    assert.match(
      String(properties.get("workspace-dev:promptTemplateHash")),
      /^[0-9a-f]{64}$/,
    );
    assert.match(
      String(properties.get("workspace-dev:systemPromptHash")),
      /^[0-9a-f]{64}$/,
    );
    assert.match(
      String(properties.get("workspace-dev:operatorEndpointReference")),
      /\[redacted\]/,
    );
  }

  const validation = validateMlBomDocument(document);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues, null, 2));
});

test("buildMlBomDocument is deterministic for the same release inputs", () => {
  const first = buildFixture();
  const second = buildFixture();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("validateMlBomDocument rejects missing endpoint redaction and missing citations", () => {
  const invalid = buildFixture();
  invalid.citations = [];
  const model = invalid.components.find(
    (component) => component["bom-ref"] === "model:test_generation",
  );
  const endpoint = model?.properties.find(
    (property) => property.name === "workspace-dev:operatorEndpointReference",
  );
  if (endpoint) {
    endpoint.value = "https://gateway.example.test/openai/v1";
  }

  const validation = validateMlBomDocument(invalid);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) => issue.code === "missing_citation"),
    true,
  );
  assert.equal(
    validation.issues.some(
      (issue) => issue.code === "invalid_value",
    ),
    true,
  );
});

test("writeMlBomArtifact persists the canonical artifact and summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ml-bom-"));
  try {
    const document = buildFixture();
    const written = await writeMlBomArtifact({ document, runDir: root });
    const summary = summarizeMlBomArtifact({ document, bytes: written.bytes });

    assert.equal(summary.schemaVersion, ML_BOM_ARTIFACT_SCHEMA_VERSION);
    assert.equal(
      summary.filename,
      `${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
    );
    assert.equal(summary.componentCounts.models, 3);
    assert.equal(summary.componentCounts.data, 1);
    const raw = await readFile(written.artifactPath, "utf8");
    const parsed = JSON.parse(raw) as MlBomDocument;
    assert.equal(parsed.specVersion, ML_BOM_CYCLONEDX_SPEC_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
