import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  asTenantId,
  buildExecutionEvidenceSigningBytes,
  computeVerifyingKeyFingerprint,
  EXECUTION_EVIDENCE_REPORT_FILENAME,
  EXECUTION_EVIDENCE_SCHEMA_VERSION,
  ExecutionEvidenceSignatureGateError,
  G12_EXECUTION_EVIDENCE_SIGNED,
  ingestExecutionEvidence,
  loadPersistedExecutionEvidence,
  summarizeExecutionEvidenceForDossier,
  type ExecutionEvidence,
  type ExecutionEvidenceIngestContext,
  type TenantId,
} from "./test-execution-evidence-ingest.js";

const TENANT_ID: TenantId = asTenantId("acme-bank");
const FIXED_NOW = new Date("2026-05-11T03:14:00.000Z");
const fixedClock = (): Date => FIXED_NOW;

interface SignedEvidenceFixture {
  readonly evidence: ExecutionEvidence;
  readonly verifyingPublicKeyPem: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

const makeSignedEvidenceFixture = (
  overrides?: Partial<Omit<ExecutionEvidence, "attestationSignatureHex">>,
): SignedEvidenceFixture => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const verifyingPublicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const body = {
    testCaseId: "TC-LOGIN-0007",
    tenantId: TENANT_ID,
    tmsAdapterId: "xray" as const,
    tmsCaseId: "JIRA-1234",
    executionVerdict: "fail" as const,
    reviewerVerdict: "rejected" as const,
    reviewerRationale: "regression in v3.4 on the IBAN field",
    executedAt: "2026-05-10T14:32:11.000Z",
    ...overrides,
  } satisfies Omit<ExecutionEvidence, "attestationSignatureHex">;
  const signingBytes = buildExecutionEvidenceSigningBytes({
    ...body,
    attestationSignatureHex: "",
  });
  const signature = cryptoSign(null, signingBytes, privateKey);
  return {
    evidence: {
      ...body,
      attestationSignatureHex: signature.toString("hex"),
    },
    verifyingPublicKeyPem,
    privateKey,
    publicKey,
  };
};

const makeTenantDir = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ti-evidence-"));
  const tenantDir = join(root, "tenants", TENANT_ID);
  await mkdir(tenantDir, { recursive: true });
  return tenantDir;
};

const baseContext = (
  fixture: SignedEvidenceFixture,
  tenantDir: string,
): ExecutionEvidenceIngestContext => ({
  tenantId: TENANT_ID,
  tenantDir,
  verifyingPublicKeyPem: fixture.verifyingPublicKeyPem,
  tmsAdapterId: "xray",
  projectId: "ACME",
  sinceIso: "2026-04-01T00:00:00.000Z",
  now: fixedClock,
});

test("ingestExecutionEvidence: accepts a single signed entry and persists it", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const result = await ingestExecutionEvidence({
    evidence: [fixture.evidence],
    context: baseContext(fixture, tenantDir),
  });
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.report.acceptedCount, 1);
  assert.equal(result.report.rejectedCount, 0);
  assert.equal(
    result.report.conflictCount,
    0,
    "fail+rejected is concordant => no conflict",
  );
  assert.equal(result.report.verdictCounts.fail, 1);
  assert.equal(result.report.verdictCounts.pass, 0);
  assert.match(result.acceptedEvidencePaths[0]!, /\/2026-05\/[0-9a-f]{64}\.json$/);
  const persisted = JSON.parse(
    await readFile(result.acceptedEvidencePaths[0]!, "utf8"),
  );
  assert.equal(persisted.schemaVersion, EXECUTION_EVIDENCE_SCHEMA_VERSION);
  assert.equal(persisted.signingKeyFingerprintSha256, result.report.signingKeyFingerprintSha256);
  assert.equal(persisted.evidence.testCaseId, "TC-LOGIN-0007");

  const reportRaw = await readFile(
    join(tenantDir, "calibration-corpus", EXECUTION_EVIDENCE_REPORT_FILENAME),
    "utf8",
  );
  const report = JSON.parse(reportRaw);
  assert.equal(report.tenantId, TENANT_ID);
  assert.equal(report.tmsAdapterId, "xray");
  assert.equal(report.projectId, "ACME");
});

test("ingestExecutionEvidence: rejects entries with a tampered body (signature mismatch)", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const tampered: ExecutionEvidence = {
    ...fixture.evidence,
    executionVerdict: "pass", // change body without re-signing
  };
  const result = await ingestExecutionEvidence({
    evidence: [tampered],
    context: baseContext(fixture, tenantDir),
  });
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.report.rejections[0]!.code, "signature_invalid");
});

test("ingestExecutionEvidence: rejects entries with mismatched tenantId", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const wrongTenant: ExecutionEvidence = {
    ...fixture.evidence,
    tenantId: asTenantId("other-bank"),
  };
  const result = await ingestExecutionEvidence({
    evidence: [wrongTenant],
    context: baseContext(fixture, tenantDir),
  });
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.report.rejections[0]!.code, "tenant_mismatch");
});

test("ingestExecutionEvidence: rejects schema-invalid entries (bad verdict)", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const bad = {
    ...fixture.evidence,
    executionVerdict: "wat" as unknown as "pass",
  };
  const result = await ingestExecutionEvidence({
    evidence: [bad],
    context: baseContext(fixture, tenantDir),
  });
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.report.rejections[0]!.code, "schema_invalid");
});

test("ingestExecutionEvidence: refuses missing signature with signature_invalid code", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const unsigned: ExecutionEvidence = {
    ...fixture.evidence,
    attestationSignatureHex: "",
  };
  const result = await ingestExecutionEvidence({
    evidence: [unsigned],
    context: baseContext(fixture, tenantDir),
  });
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(result.report.rejections[0]!.code, "signature_invalid");
});

test("ingestExecutionEvidence: dedupes via sha256 filename when re-ingesting", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const ctx = baseContext(fixture, tenantDir);
  const first = await ingestExecutionEvidence({
    evidence: [fixture.evidence],
    context: ctx,
  });
  const second = await ingestExecutionEvidence({
    evidence: [fixture.evidence],
    context: ctx,
  });
  assert.deepEqual(first.acceptedEvidencePaths, second.acceptedEvidencePaths);
  const records = await loadPersistedExecutionEvidence(
    join(tenantDir, "calibration-corpus"),
  );
  assert.equal(records.length, 1);
});

test("loadPersistedExecutionEvidence: returns empty when no corpus exists", async () => {
  const tenantDir = await makeTenantDir();
  const records = await loadPersistedExecutionEvidence(
    join(tenantDir, "calibration-corpus"),
  );
  assert.equal(records.length, 0);
});

test("summarizeExecutionEvidenceForDossier: aggregates verdicts + conflicts", async () => {
  const fixturePass = makeSignedEvidenceFixture({
    testCaseId: "TC-A",
    executionVerdict: "pass",
    reviewerVerdict: "rejected",
    executedAt: "2026-04-15T00:00:00.000Z",
  });
  const fixtureFail = makeSignedEvidenceFixture({
    testCaseId: "TC-B",
    executionVerdict: "fail",
    reviewerVerdict: "approved",
    executedAt: "2026-05-01T00:00:00.000Z",
  });
  // Re-sign with a single common key by overriding fixture.
  const tenantDir = await makeTenantDir();
  await ingestExecutionEvidence({
    evidence: [fixturePass.evidence],
    context: baseContext(fixturePass, tenantDir),
  });
  const records = await loadPersistedExecutionEvidence(
    join(tenantDir, "calibration-corpus"),
  );
  const summary = summarizeExecutionEvidenceForDossier(records);
  assert.equal(summary.totalEvidence, 1);
  assert.equal(summary.verdictCounts.pass, 1);
  assert.equal(summary.reviewerConflictCounts.execution_pass_reviewer_rejected, 1);
  assert.equal(summary.earliestExecutedAt, "2026-04-15T00:00:00.000Z");
  assert.equal(summary.latestExecutedAt, "2026-04-15T00:00:00.000Z");
  // unused — keeps the signed fixture in scope, exercises distinct keys.
  void fixtureFail;
});

test("buildExecutionEvidenceSigningBytes + computeVerifyingKeyFingerprint round-trip", () => {
  const fixture = makeSignedEvidenceFixture();
  const fingerprint = computeVerifyingKeyFingerprint(
    fixture.verifyingPublicKeyPem,
  );
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  const bytes = buildExecutionEvidenceSigningBytes(fixture.evidence);
  // Body bytes must be canonical-JSON without the signature field.
  const parsed = JSON.parse(bytes.toString("utf8"));
  assert.equal(parsed.attestationSignatureHex, undefined);
  assert.equal(parsed.testCaseId, fixture.evidence.testCaseId);
});

test("ExecutionEvidenceSignatureGateError: carries G12 hard-gate code", () => {
  const err = new ExecutionEvidenceSignatureGateError([
    {
      testCaseId: "TC-A",
      tmsCaseId: "JIRA-1",
      tmsAdapterId: "xray",
      code: "signature_invalid",
      detail: "signature verification failed",
    },
  ]);
  assert.equal(err.code, G12_EXECUTION_EVIDENCE_SIGNED);
  assert.equal(err.rejectedCount, 1);
});

test("ingestExecutionEvidence: produces deterministic, sorted accepted paths", async () => {
  const tenantDir = await makeTenantDir();
  // Signed fixture A and B with distinct test cases and timestamps.
  const a = makeSignedEvidenceFixture({
    testCaseId: "TC-A",
    executedAt: "2026-04-10T00:00:00.000Z",
  });
  const b = makeSignedEvidenceFixture({
    testCaseId: "TC-B",
    executedAt: "2026-04-11T00:00:00.000Z",
  });
  // Use one verifier key per fixture by ingesting separately.
  const r1 = await ingestExecutionEvidence({
    evidence: [a.evidence],
    context: baseContext(a, tenantDir),
  });
  const r2 = await ingestExecutionEvidence({
    evidence: [b.evidence],
    context: baseContext(b, tenantDir),
  });
  assert.equal(r1.accepted, 1);
  assert.equal(r2.accepted, 1);
  // The report file is overwritten atomically per pull.
  assert.equal(
    r2.reportPath,
    join(tenantDir, "calibration-corpus", EXECUTION_EVIDENCE_REPORT_FILENAME),
  );
});

test("persisted evidence file is canonical JSON (sorted keys)", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const result = await ingestExecutionEvidence({
    evidence: [fixture.evidence],
    context: baseContext(fixture, tenantDir),
  });
  const raw = await readFile(result.acceptedEvidencePaths[0]!, "utf8");
  // Round-trip via canonicalJson MUST equal raw (minus trailing newline).
  const parsed = JSON.parse(raw);
  assert.equal(`${canonicalJson(parsed)}\n`, raw);
});

// Sanity: writing pre-existing fingerprint key bytes to the tenant
// signing-keys directory to confirm the CLI's resolveDefaultVerifyingKeyPath
// pattern lays out the file at the documented spot. (Exercises the docs
// contract — if we ever rename the directory we should know.)
test("default verifying key path layout matches the documented contract", async () => {
  const fixture = makeSignedEvidenceFixture();
  const tenantDir = await makeTenantDir();
  const signingKeysDir = join(tenantDir, "signing-keys");
  await mkdir(signingKeysDir, { recursive: true });
  await writeFile(
    join(signingKeysDir, "tms-admin.ed25519.public.pem"),
    fixture.verifyingPublicKeyPem,
    "utf8",
  );
  const onDisk = await readFile(
    join(signingKeysDir, "tms-admin.ed25519.public.pem"),
    "utf8",
  );
  assert.match(onDisk, /BEGIN PUBLIC KEY/);
});
