import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
  REGION_ATTESTATION_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type RegionAttestationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { generateAuditDossier } from "./audit-dossier.js";
import { verifyAuditDossierBundle } from "./audit-dossier-verify.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const fixtureRoot = path.join(
  repoRoot,
  "fixtures",
  "test-intelligence",
  "audit-dossiers",
);
const acceptedRunDir = path.join(fixtureRoot, "accepted-run");
const expectedBundleDir = path.join(fixtureRoot, "expected-bundle");
const signingKeyPath = path.join(
  fixtureRoot,
  "operator-ed25519.private-key.json",
);
const bundlePrefix = path.join(
  expectedBundleDir,
  "ti-cli-1778405189341-audit-dossier",
);

const fixedMetadata = {
  gitSha: "fixture-git-sha-2175",
  benchmarkProtocolVersion:
    "docs/test-intelligence/local-benchmark-protocol.md@fixture",
  harnessVersion: "1.0.0-fixture",
  ictRegisterRef: "ict://tier1/eu-banking-default/2026-05-10",
} as const;

test("audit-dossier: generates a verifiable bundle for the accepted run fixture", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-"));
  try {
    const result = await generateAuditDossier({
      runDir: acceptedRunDir,
      outputDir: tempDir,
      signKeyPath: signingKeyPath,
      ...fixedMetadata,
    });
    const generated = await Promise.all([
      readFile(result.manifestPath),
      readFile(result.signaturePath),
      readFile(result.pdfPath),
      readFile(result.merkleProofPath),
    ]);
    for (const bytes of generated) {
      assert.ok(bytes.byteLength > 0);
    }
    const verification = await verifyAuditDossierBundle(result.manifestPath);
    assert.equal(verification.ok, true, JSON.stringify(verification.failures));
    assert.equal(verification.runId, "ti-cli-1778405189341");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: verify passes for the checked-in expected bundle", async () => {
  const result = await verifyAuditDossierBundle(`${bundlePrefix}.json`);
  assert.equal(result.ok, true);
  assert.equal(result.runId, "ti-cli-1778405189341");
  assert.equal(result.failures.length, 0);
});

test("contracts: region attestation report is canonical-json stable", () => {
  const report: RegionAttestationReport = {
    schemaVersion: REGION_ATTESTATION_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: "job-2177-audit",
    generatedAt: "2026-05-10T10:15:00.000Z",
    artifacts: [
      {
        filename: "finops/budget-report.json",
        artifactHash: "a".repeat(64),
        regionAttestations: [
          {
            schemaVersion: REGION_ATTESTATION_SCHEMA_VERSION,
            artifactHash: "b".repeat(64),
            deploymentId: "gpt-oss-120b",
            servedFromRegion: "eu-central-1",
            observedAtUtc: "2026-05-10T10:15:00.000Z",
            attestedBy: "azure-instance-metadata",
            attestationSignatureHex: "c".repeat(64),
          },
        ],
      },
    ],
    distinctRegions: ["eu-central-1", "switzerland-north"],
  };
  const serialized = canonicalJson(report);
  assert.equal(
    canonicalJson(JSON.parse(serialized) as RegionAttestationReport),
    serialized,
  );
  assert.equal(
    REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
    "region-attestations.json",
  );
});

test("audit-dossier: verify fails when the Merkle proof is tampered", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-verify-"));
  try {
    for (const extension of [".json", ".sig", ".pdf", ".merkle.txt"]) {
      await writeFile(
        path.join(tempDir, `bundle${extension}`),
        await readFile(`${bundlePrefix}${extension}`),
      );
    }
    await writeFile(
      path.join(tempDir, "bundle.merkle.txt"),
      "tampered\n",
      "utf8",
    );
    const result = await verifyAuditDossierBundle(
      path.join(tempDir, "bundle.json"),
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((failure) => failure.code === "merkle_proof_mismatch"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: verify fails when the Merkle root is tampered", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-root-"));
  try {
    for (const extension of [".json", ".sig", ".pdf", ".merkle.txt"]) {
      await writeFile(
        path.join(tempDir, `bundle${extension}`),
        await readFile(`${bundlePrefix}${extension}`),
      );
    }
    const manifest = JSON.parse(
      await readFile(path.join(tempDir, "bundle.json"), "utf8"),
    ) as Record<string, unknown> & {
      provenance: Record<string, unknown>;
    };
    manifest.provenance = {
      ...manifest.provenance,
      merkleRoot: "deadbeef".repeat(8),
    };
    await writeFile(
      path.join(tempDir, "bundle.json"),
      canonicalJson(manifest),
      "utf8",
    );
    const result = await verifyAuditDossierBundle(
      path.join(tempDir, "bundle.json"),
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((failure) => failure.code === "merkle_root_mismatch"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: verify fails when the PDF is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-pdf-"));
  try {
    for (const extension of [".json", ".sig", ".merkle.txt"]) {
      await writeFile(
        path.join(tempDir, `bundle${extension}`),
        await readFile(`${bundlePrefix}${extension}`),
      );
    }
    const result = await verifyAuditDossierBundle(
      path.join(tempDir, "bundle.json"),
    );
    assert.equal(result.ok, false);
    assert.ok(
      result.failures.some((failure) => failure.code === "pdf_mismatch"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: verify returns manifest_unparseable for invalid manifest shape", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-shape-"));
  try {
    await writeFile(path.join(tempDir, "bundle.json"), "{}\n", "utf8");
    const result = await verifyAuditDossierBundle(
      path.join(tempDir, "bundle.json"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      {
        code: "manifest_unparseable",
        reference: path.join(tempDir, "bundle.json"),
        message: "Bundle manifest is malformed JSON.",
      },
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: generation fails clearly when a required artifact is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-missing-"));
  const runDir = path.join(tempDir, "run");
  await mkdir(runDir, { recursive: true });
  await cp(acceptedRunDir, runDir, { recursive: true });
  await rm(path.join(runDir, "incidents.json"));
  await assert.rejects(
    () =>
      generateAuditDossier({
        runDir,
        outputDir: path.join(tempDir, "out"),
        signKeyPath: signingKeyPath,
        ...fixedMetadata,
      }),
    /incidents\.json is missing/i,
  );
  await rm(tempDir, { recursive: true, force: true });
});

test("audit-dossier: generation fails when the provenance root does not match the attested leaf set", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audit-dossier-root-gen-"));
  const runDir = path.join(tempDir, "run");
  await mkdir(runDir, { recursive: true });
  await cp(acceptedRunDir, runDir, { recursive: true });
  const provenancePath = path.join(runDir, "provenance.jsonld");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8")) as {
    ["ti:merkleSeal"]: Record<string, unknown>;
  };
  provenance["ti:merkleSeal"] = {
    ...provenance["ti:merkleSeal"],
    root: "deadbeef".repeat(8),
  };
  await writeFile(provenancePath, canonicalJson(provenance), "utf8");
  await assert.rejects(
    () =>
      generateAuditDossier({
        runDir,
        outputDir: path.join(tempDir, "out"),
        signKeyPath: signingKeyPath,
        ...fixedMetadata,
      }),
    /Provenance Merkle root mismatch/i,
  );
  await rm(tempDir, { recursive: true, force: true });
});

test("audit-dossier: embeds the self-improving calibration refit history when proposals exist (Issue #2182)", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "audit-dossier-refit-history-"),
  );
  const outDir = path.join(tempDir, "out");
  const curvesDir = path.join(tempDir, "curves");
  const proposalsDir = path.join(curvesDir, "proposals");
  await mkdir(proposalsDir, { recursive: true });

  const baseProposal = {
    schemaVersion: "1.0.0",
    proposalId: "proposal-DE-DE-regulated_data-aaaaaaaaaaaaaaaa",
    locale: "DE-DE",
    riskClass: "regulated_data",
    previousCurveDigest: "",
    proposedCurveDigest: "deadbeef".repeat(8),
    heldOutEce: 0.011,
    heldOutKappa: 0.91,
    perClassHeldOutEce: {
      high: 0.014,
      regulated_data: 0.011,
      financial_transaction: 0.013,
    },
    proposedAt: "2026-05-11T00:00:00.000Z",
    ratifiedAt: "2026-05-11T01:00:00.000Z",
    rolledBack: false,
    trainSampleCount: 48,
    heldOutSampleCount: 12,
    proposedCurve: {
      schemaVersion: "1.0.0",
      locale: "DE-DE",
      riskClass: "regulated_data",
      intercept: -3.2,
      slope: 7.5,
      trainSampleCount: 48,
      heldOutSampleCount: 12,
      heldOutEce: 0.011,
      heldOutKappa: 0.91,
      perClassHeldOutEce: {
        high: 0.014,
        regulated_data: 0.011,
        financial_transaction: 0.013,
      },
      fittedAt: "2026-05-11T00:00:00.000Z",
      digest: "deadbeef".repeat(8),
    },
    gateEvaluation: {
      heldOutEcePassed: true,
      heldOutKappaPassed: true,
      relativeEceRegressionPassed: true,
      relativeKappaRegressionPassed: true,
      perClassEceRegressionPassed: true,
      currentHeldOutEce: 0.011,
      currentHeldOutKappa: 0.91,
      currentPerClassHeldOutEce: {
        high: 0.014,
        regulated_data: 0.011,
        financial_transaction: 0.013,
      },
      failedGates: [],
    },
  };
  await writeFile(
    path.join(proposalsDir, `${baseProposal.proposalId}.json`),
    canonicalJson(baseProposal),
    "utf8",
  );

  try {
    const result = await generateAuditDossier({
      runDir: acceptedRunDir,
      outputDir: outDir,
      signKeyPath: signingKeyPath,
      calibrationCurvesDir: curvesDir,
      ...fixedMetadata,
    });
    const refit = result.manifest.selfImprovingCalibrationRefitHistory;
    assert.notEqual(refit, undefined);
    assert.equal(refit?.proposalCount, 1);
    assert.equal(refit?.rolledBackCount, 0);
    assert.equal(refit?.rows[0]?.locale, "DE-DE");
    assert.equal(refit?.rows[0]?.riskClass, "regulated_data");
    assert.equal(refit?.rows[0]?.status, "ratified");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: embeds the resolved tenant bundle when present (Issue #2184)", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "audit-dossier-tenant-bundle-"),
  );
  const runDir = path.join(tempDir, "run");
  await cp(acceptedRunDir, runDir, { recursive: true });
  // Stage a minimal resolved-bundle artifact under the run directory.
  // The dossier should detect it and emit the customerBundle summary.
  const resolved = {
    schemaVersion: "1.0.0",
    bundle: {
      schemaVersion: "1.0.0",
      tenantId: "acme-bank",
      bundleVersion: "1.0.0",
      inheritsFromPolicyProfile: "eu-banking-default",
      riskClassTaxonomy: [
        {
          riskCategory: "regulated_data",
          customerLabel: "BAIT-Sensitive",
          mode: "review_only",
        },
      ],
      complianceHouseStandards: [
        { clauseId: "HS-AB-001", description: "Anti-fraud trace required" },
      ],
      designSystemTokens: [],
      terminologyGlossary: [
        { term: "Buchung", definition: "Booking record", locale: "de" },
      ],
      testCaseNamingConvention: { id: "TC-{module}-{nnn}" },
      contentHash: "a".repeat(64),
    },
    appliedOverrides: ["rules.reviewOnlyRiskCategories"],
    certification:
      "tenant bundle merged against base policy profile under hard allow-list and safety-floor invariants",
  };
  await writeFile(
    path.join(runDir, "tenant-bundle-resolved.json"),
    `${canonicalJson(resolved)}\n`,
    "utf8",
  );
  const outDir = path.join(tempDir, "out");
  try {
    const result = await generateAuditDossier({
      runDir,
      outputDir: outDir,
      signKeyPath: signingKeyPath,
      ...fixedMetadata,
    });
    const customerBundle = result.manifest.customerBundle;
    assert.notEqual(customerBundle, undefined);
    assert.equal(customerBundle?.tenantId, "acme-bank");
    assert.equal(customerBundle?.inheritsFromPolicyProfile, "eu-banking-default");
    assert.equal(customerBundle?.riskClassOverrideCount, 1);
    assert.equal(customerBundle?.complianceHouseStandardCount, 1);
    assert.equal(customerBundle?.terminologyGlossaryCount, 1);
    assert.equal(customerBundle?.hasNamingConvention, true);
    assert.deepEqual(customerBundle?.appliedOverrides, [
      "rules.reviewOnlyRiskCategories",
    ]);
    assert.ok(
      result.manifest.sourceArtifacts.some(
        (a) => a.filename === "tenant-bundle-resolved.json",
      ),
    );
    // Bundle is the only customer-specific section the renderer adds —
    // the PDF page count grows when the new heading is rendered.
    assert.ok(result.manifest.bundle.pdfSha256.length > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("audit-dossier: manifest excludes raw prompts and screenshots", async () => {
  const manifest = JSON.parse(
    await readFile(`${bundlePrefix}.json`, "utf8"),
  ) as { sourceArtifacts: Array<{ filename: string }> };
  assert.equal(
    manifest.sourceArtifacts.some(
      (artifact) =>
        artifact.filename.includes("compiled-prompt") ||
        artifact.filename.endsWith(".png"),
    ),
    false,
  );
});
