/**
 * Tests for Issue #2185 — self-service customer-onboarding CLI core.
 */

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EU_BANKING_DEFAULT_POLICY_PROFILE_ID } from "../contracts/index.js";
import { parseAndCanonicalizeTenantBundle } from "./tenant-bundle.js";
import {
  AUDIT_DOSSIER_PRIVATE_KEY_FILENAME,
  AUDIT_DOSSIER_PUBLIC_KEY_FILENAME,
  REGION_ATTESTATION_KEY_FILENAME,
  REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
  REVIEWER_SIGNING_PUBLIC_KEY_FILENAME,
  TENANT_ICT_REGISTER_FILENAME,
  TENANT_ONBOARDING_BUNDLE_FILENAME,
  TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME,
  TENANT_ONBOARDING_EVIDENCE_FILENAME,
  TENANT_ONBOARDING_FINGERPRINTS_FILENAME,
  TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
  TenantOnboardingValidationError,
  runTenantOnboarding,
  runTenantOnboardingDoctor,
} from "./tenant-onboarding.js";

const FIXED_NOW = () => new Date("2026-05-11T08:00:00.000Z");

const makeOutputRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ti-onboard-"));

const tenantDirOf = (root: string, tenantId: string): string =>
  join(root, "tenants", tenantId);

test("runTenantOnboarding lays down every required artifact", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    const result = await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });
    const tenantDir = tenantDirOf(outputRoot, "acme-bank");
    assert.equal(result.tenantId, "acme-bank");
    assert.equal(result.tenantDirectory, tenantDir);

    const entries = (await readdir(tenantDir)).sort();
    assert.deepEqual(entries, [
      TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME,
      TENANT_ICT_REGISTER_FILENAME,
      TENANT_ONBOARDING_EVIDENCE_FILENAME,
      TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
      TENANT_ONBOARDING_BUNDLE_FILENAME,
    ].sort());

    const signingKeyEntries = (
      await readdir(join(tenantDir, TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME))
    ).sort();
    assert.deepEqual(signingKeyEntries, [
      AUDIT_DOSSIER_PRIVATE_KEY_FILENAME,
      AUDIT_DOSSIER_PUBLIC_KEY_FILENAME,
      REGION_ATTESTATION_KEY_FILENAME,
      REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
      REVIEWER_SIGNING_PUBLIC_KEY_FILENAME,
      TENANT_ONBOARDING_FINGERPRINTS_FILENAME,
    ].sort());

    // Bundle round-trips through W8-2.
    const bundleRaw = await readFile(result.bundlePath, "utf8");
    const parsed = parseAndCanonicalizeTenantBundle(bundleRaw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.bundle.tenantId, "acme-bank");
    assert.equal(
      parsed.bundle.inheritsFromPolicyProfile,
      EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    );

    // ICT register has DORA-Art-28 metadata + tenant scope + fingerprints.
    const ict = JSON.parse(
      await readFile(result.ictRegisterPath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(ict["regulation"], "DORA-Art-28");
    assert.equal(ict["tenantId"], "acme-bank");
    const ictScope = ict["tenantScope"] as Record<string, unknown>;
    assert.equal(ictScope["tenantId"], "acme-bank");
    assert.equal(ictScope["environmentId"], "prod");
    const fp = ict["signingKeyFingerprints"] as Record<string, unknown>;
    assert.equal(typeof fp["auditDossierEd25519Sha256"], "string");
    assert.equal(typeof fp["regionAttestationHmacSha256"], "string");
    assert.equal(typeof fp["reviewerSigningEd25519Sha256"], "string");

    // Evidence ties everything together.
    const evidence = JSON.parse(
      await readFile(result.evidencePath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(evidence["tenantId"], "acme-bank");
    assert.equal(typeof evidence["evidenceContentHash"], "string");

    // Summary printed copy-pasteable next-step commands.
    assert.match(result.summaryReport, /test-intelligence onboard --doctor/u);
    assert.match(result.summaryReport, /test-intelligence run --tenant-bundle/u);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboarding generates valid Ed25519 keys with fingerprints matching the ICT register", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    const result = await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });

    const auditPriv = await readFile(
      join(
        result.tenantDirectory,
        TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
        AUDIT_DOSSIER_PRIVATE_KEY_FILENAME,
      ),
      "utf8",
    );
    const auditKey = createPrivateKey({ key: auditPriv, format: "pem" });
    assert.equal(auditKey.asymmetricKeyType, "ed25519");
    const auditPub = createPublicKey(auditKey);
    const auditDer = auditPub.export({ format: "der", type: "spki" }) as Buffer;
    const expectedAuditFp = await import("node:crypto").then((mod) =>
      mod
        .createHash("sha256")
        .update(new Uint8Array(auditDer.buffer, auditDer.byteOffset, auditDer.byteLength))
        .digest("hex"),
    );
    assert.equal(result.fingerprints.auditDossierEd25519Sha256, expectedAuditFp);

    const reviewerPriv = await readFile(
      join(
        result.tenantDirectory,
        TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
        REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
      ),
      "utf8",
    );
    const reviewerKey = createPrivateKey({ key: reviewerPriv, format: "pem" });
    assert.equal(reviewerKey.asymmetricKeyType, "ed25519");

    const region = await readFile(
      join(
        result.tenantDirectory,
        TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
        REGION_ATTESTATION_KEY_FILENAME,
      ),
      "utf8",
    );
    assert.match(region.trim(), /^[0-9a-f]{64}$/u);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboarding refuses to overwrite without --force", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });
    await assert.rejects(
      () =>
        runTenantOnboarding({
          tenantId: "acme-bank",
          legalName: "Acme Bank AG",
          policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
          outputRoot,
          now: FIXED_NOW,
        }),
      (err: unknown) =>
        err instanceof TenantOnboardingValidationError &&
        err.code === "TENANT_ONBOARDING_DIRECTORY_EXISTS",
    );
    await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      force: true,
      now: FIXED_NOW,
    });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboarding rejects unknown policy profile and bad tenant id", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    await assert.rejects(
      () =>
        runTenantOnboarding({
          tenantId: "BAD ID with spaces",
          legalName: "Acme Bank AG",
          policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
          outputRoot,
        }),
      (err: unknown) =>
        err instanceof TenantOnboardingValidationError &&
        err.code === "TENANT_ONBOARDING_INVALID_TENANT_ID",
    );
    await assert.rejects(
      () =>
        runTenantOnboarding({
          tenantId: "acme-bank",
          legalName: "Acme Bank AG",
          policyProfileId: "ghost-profile",
          outputRoot,
        }),
      (err: unknown) =>
        err instanceof TenantOnboardingValidationError &&
        err.code === "TENANT_ONBOARDING_UNKNOWN_POLICY_PROFILE",
    );
    await assert.rejects(
      () =>
        runTenantOnboarding({
          tenantId: "acme-bank",
          legalName: "",
          policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
          outputRoot,
        }),
      (err: unknown) =>
        err instanceof TenantOnboardingValidationError &&
        err.code === "TENANT_ONBOARDING_INVALID_LEGAL_NAME",
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboardingDoctor passes on a freshly-onboarded tenant", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });
    const report = await runTenantOnboardingDoctor({
      tenantId: "acme-bank",
      outputRoot,
    });
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
    assert.equal(report.orphanedFiles.length, 0);
    assert.ok(
      report.checks.some(
        (c) => c.name === "tenant-bundle" && c.ok,
      ),
    );
    assert.ok(
      report.checks.some(
        (c) => c.name === "audit-dossier-private-key" && c.ok,
      ),
    );
    assert.ok(
      report.checks.some(
        (c) => c.name === "region-attestation-key" && c.ok,
      ),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboardingDoctor detects missing keys and orphaned files", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    const result = await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });
    // Remove a required signing key.
    await rm(
      join(
        result.tenantDirectory,
        TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
        REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
      ),
    );
    // Drop an unexpected file at the top level.
    await writeFile(
      join(result.tenantDirectory, "stray-note.txt"),
      "operator note",
    );
    const report = await runTenantOnboardingDoctor({
      tenantId: "acme-bank",
      outputRoot,
    });
    assert.equal(report.ok, false);
    assert.ok(report.orphanedFiles.includes("stray-note.txt"));
    assert.ok(
      report.checks.some(
        (c) => c.name === "reviewer-signing-private-key" && !c.ok,
      ),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboardingDoctor flags a tenant-scope mismatch as a multi-tenant isolation violation", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    const result = await runTenantOnboarding({
      tenantId: "acme-bank",
      legalName: "Acme Bank AG",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      outputRoot,
      now: FIXED_NOW,
    });
    // Tamper with the ICT register: pretend it belongs to a different tenant.
    const ictRaw = await readFile(result.ictRegisterPath, "utf8");
    const ict = JSON.parse(ictRaw) as Record<string, unknown>;
    ict["tenantId"] = "rival-bank";
    (ict["tenantScope"] as Record<string, unknown>)["tenantId"] = "rival-bank";
    await writeFile(result.ictRegisterPath, JSON.stringify(ict, null, 2));

    const report = await runTenantOnboardingDoctor({
      tenantId: "acme-bank",
      outputRoot,
    });
    assert.equal(report.ok, false);
    assert.ok(
      report.checks.some(
        (c) =>
          c.name === `${TENANT_ICT_REGISTER_FILENAME}-tenant-scope` && !c.ok,
      ),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTenantOnboardingDoctor returns a single failure when the tenant directory does not exist", async () => {
  const outputRoot = await makeOutputRoot();
  try {
    const report = await runTenantOnboardingDoctor({
      tenantId: "ghost-bank",
      outputRoot,
    });
    assert.equal(report.ok, false);
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0]?.name, "tenant-directory");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
