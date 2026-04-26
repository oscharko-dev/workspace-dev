import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
} from "../contracts/index.js";
import {
  buildWave1PocEvidenceManifest,
  computeWave1PocEvidenceManifestDigest,
  verifyWave1PocEvidenceFromDisk,
  verifyWave1PocEvidenceManifest,
  writeWave1PocEvidenceManifest,
  type BuildEvidenceArtifactRecord,
} from "./evidence-manifest.js";
import { canonicalJson } from "./content-hash.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const manifestIntegrityPayloadDigest = (
  manifest: ReturnType<typeof buildWave1PocEvidenceManifest>,
): string => {
  const payload = { ...manifest };
  delete payload.manifestIntegrity;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
};

const baseInput = (
  artifacts: ReadonlyArray<BuildEvidenceArtifactRecord>,
): Parameters<typeof buildWave1PocEvidenceManifest>[0] => ({
  fixtureId: "poc-onboarding",
  jobId: "job-1366",
  generatedAt: GENERATED_AT,
  modelDeployments: {
    testGeneration: "gpt-oss-120b-mock",
    visualPrimary: "llama-4-maverick-vision",
  },
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  exportProfileId: "opentext-alm-default",
  exportProfileVersion: "1.0.0",
  promptHash: ZERO,
  schemaHash: ZERO,
  inputHash: ZERO,
  cacheKeyDigest: ZERO,
  artifacts,
});

test("evidence-manifest: stamps schema/contract versions and hard invariants", () => {
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  assert.equal(
    manifest.schemaVersion,
    WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  );
  assert.equal(manifest.contractVersion, CONTRACT_VERSION);
  assert.equal(
    manifest.testIntelligenceContractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
  assert.equal(manifest.rawScreenshotsIncluded, false);
  assert.equal(manifest.imagePayloadSentToTestGeneration, false);
  assert.deepEqual(manifest.manifestIntegrity?.algorithm, "sha256");
  assert.match(manifest.manifestIntegrity?.hash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(
    manifest.manifestIntegrity?.hash,
    manifestIntegrityPayloadDigest(manifest),
  );
});

test("evidence-manifest: records direct visual sidecar summary when supplied", () => {
  const manifest = buildWave1PocEvidenceManifest({
    ...baseInput([
      {
        filename: "visual-sidecar-result.json",
        bytes: utf8('{"result":{"outcome":"success"}}'),
        category: "visual_sidecar",
      },
    ]),
    visualSidecar: {
      selectedDeployment: "llama-4-maverick-vision",
      fallbackReason: "none",
      confidenceSummary: { min: 0.9, max: 0.95, mean: 0.92 },
      resultArtifactSha256: ZERO,
    },
  });

  assert.deepEqual(manifest.visualSidecar, {
    selectedDeployment: "llama-4-maverick-vision",
    fallbackReason: "none",
    confidenceSummary: { min: 0.9, max: 0.95, mean: 0.92 },
    resultArtifactSha256: ZERO,
  });
});

test("evidence-manifest: artifacts are sorted by filename and de-duplicated", () => {
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      { filename: "b.json", bytes: utf8("first"), category: "validation" },
      { filename: "a.json", bytes: utf8("first"), category: "validation" },
      // Later occurrences overwrite earlier ones.
      { filename: "a.json", bytes: utf8("second"), category: "validation" },
    ]),
  );
  assert.deepEqual(
    manifest.artifacts.map((a) => a.filename),
    ["a.json", "b.json"],
  );
  // The retained entry for `a.json` reflects the second byte stream.
  const a = manifest.artifacts.find((x) => x.filename === "a.json");
  assert.ok(a);
  assert.equal(a.bytes, utf8("second").byteLength);
});

test("evidence-manifest: accepts safe relative artifact paths", () => {
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "finops/budget-report.json",
        bytes: utf8("x"),
        category: "finops",
      },
    ]),
  );
  assert.equal(manifest.artifacts[0]?.filename, "finops/budget-report.json");
});

test("evidence-manifest: verifies safe nested artifact paths on disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  try {
    await mkdir(join(dir, "finops"), { recursive: true });
    await writeFile(join(dir, "finops", "budget-report.json"), "x");
    const manifest = buildWave1PocEvidenceManifest(
      baseInput([
        {
          filename: "finops/budget-report.json",
          bytes: utf8("x"),
          category: "finops",
        },
      ]),
    );
    const result = await verifyWave1PocEvidenceManifest({
      manifest,
      artifactsDir: dir,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.mutated, []);
    assert.deepEqual(result.resized, []);
    assert.deepEqual(result.unexpected, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evidence-manifest: refuses unsafe relative filenames", () => {
  assert.throws(
    () =>
      buildWave1PocEvidenceManifest(
        baseInput([
          {
            filename: "../alpha.json",
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /path traversal/,
  );
});

test("evidence-manifest: refuses Windows-shaped artifact paths on every host", () => {
  for (const filename of [
    "C:/Windows/System32/config.json",
    "C:relative.json",
    "\\\\server\\share\\artifact.json",
  ]) {
    assert.throws(
      () =>
        buildWave1PocEvidenceManifest(
          baseInput([
            {
              filename,
              bytes: utf8("x"),
              category: "validation",
            },
          ]),
        ),
      /relative path, not absolute/,
      `${filename} must be rejected deterministically`,
    );
  }
});

test("evidence-manifest: invalid filename diagnostics escape unsafe code units", () => {
  let newlineError: Error | undefined;
  try {
    buildWave1PocEvidenceManifest(
      baseInput([
        {
          filename: "line\nbreak.json",
          bytes: utf8("x"),
          category: "validation",
        },
      ]),
    );
  } catch (err) {
    newlineError = err as Error;
  }
  assert.ok(newlineError);
  assert.match(
    newlineError.message,
    /"line\\nbreak\.json".*control characters/,
  );
  assert.equal(newlineError.message.includes("line\nbreak"), false);

  let delError: Error | undefined;
  try {
    buildWave1PocEvidenceManifest(
      baseInput([
        {
          filename: "del\u007f.json",
          bytes: utf8("x"),
          category: "validation",
        },
      ]),
    );
  } catch (err) {
    delError = err as Error;
  }
  assert.ok(delError);
  assert.match(delError.message, /"del\\u007f\.json".*control characters/);
  assert.equal(delError.message.includes("\u007f"), false);

  assert.throws(
    () =>
      buildWave1PocEvidenceManifest(
        baseInput([
          {
            filename: `bad${String.fromCharCode(0xd800)}name.json`,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /"bad\\ud800name\.json".*lone UTF-16 surrogate/,
  );
});

test("evidence-manifest: refuses non-sha256 hash inputs", () => {
  assert.throws(
    () =>
      buildWave1PocEvidenceManifest({
        ...baseInput([]),
        promptHash: "not-a-hash",
      }),
    /must be a sha256 hex string/,
  );
  assert.throws(
    () =>
      buildWave1PocEvidenceManifest({
        ...baseInput([]),
        visualSidecar: {
          selectedDeployment: "llama-4-maverick-vision",
          fallbackReason: "none",
          confidenceSummary: { min: 0.9, max: 0.95, mean: 0.92 },
          resultArtifactSha256: "not-a-hash",
        },
      }),
    /visualSidecar\.resultArtifactSha256 must be a sha256 hex string/,
  );
});

test("evidence-manifest: byte length and sha256 match the input bytes", () => {
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      { filename: "x.json", bytes: utf8("hello"), category: "validation" },
    ]),
  );
  assert.equal(manifest.artifacts[0]?.bytes, 5);
  assert.match(manifest.artifacts[0]?.sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("evidence-manifest: verify returns ok when artifacts match disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  await writeFile(join(dir, "beta.json"), '{"b":2}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
      { filename: "beta.json", bytes: utf8('{"b":2}'), category: "review" },
    ]),
  );
  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.mutated, []);
  assert.deepEqual(result.resized, []);
});

test("evidence-manifest: verify detects single-byte mutation fail-closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  // Mutate one byte on disk after the manifest is built.
  await writeFile(join(dir, "alpha.json"), '{"a":2}');
  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, ["alpha.json"]);
  assert.deepEqual(result.missing, []);
});

test("evidence-manifest: verify reports missing artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["alpha.json"]);
  assert.deepEqual(result.mutated, []);
});

test("evidence-manifest: verify detects byte-length resize", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":111111}'); // 12 bytes vs manifest 7
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
  });
  assert.equal(result.ok, false);
  assert.ok(result.resized.includes("alpha.json"));
  assert.ok(result.mutated.includes("alpha.json"));
});

test("evidence-manifest: verify reports unexpected files when rejectUnexpected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  await writeFile(join(dir, "stray.txt"), "stray");
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
    rejectUnexpected: true,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, ["stray.txt"]);
});

test("evidence-manifest: malformed artifact metadata fails closed without throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = {
    ...buildWave1PocEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8('{"a":1}'),
          category: "validation",
        },
      ]),
    ),
    artifacts: [null],
  } as unknown as Wave1PocEvidenceManifest;

  const result = await verifyWave1PocEvidenceManifest({
    manifest,
    artifactsDir: dir,
    rejectUnexpected: true,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
  assert.deepEqual(result.unexpected, ["alpha.json"]);
});

test("evidence-manifest: write + verify round-trip via verifyWave1PocEvidenceFromDisk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const path = await writeWave1PocEvidenceManifest({
    manifest,
    destinationDir: dir,
  });
  assert.match(
    path,
    new RegExp(`${WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME}$`),
  );
  const persistedRaw = await readFile(path, "utf8");
  // Persisted content is canonicalJson — re-parse and check shape.
  const reparsed = JSON.parse(persistedRaw);
  assert.equal(
    reparsed.schemaVersion,
    WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  );
  const persistedDigest = await readFile(
    join(dir, WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME),
    "utf8",
  );
  assert.equal(
    persistedDigest,
    `${computeWave1PocEvidenceManifestDigest(manifest)}\n`,
  );

  const { result } = await verifyWave1PocEvidenceFromDisk(dir);
  assert.equal(result.ok, true);
  assert.equal(result.manifestIntegrity?.ok, true);
});

test("evidence-manifest: default disk verifier detects valid metadata rewrites via digest witness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const expectedManifestSha256 =
    computeWave1PocEvidenceManifestDigest(manifest);
  const manifestPath = await writeWave1PocEvidenceManifest({
    manifest,
    destinationDir: dir,
  });

  const tampered = {
    ...(JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >),
    modelDeployments: { testGeneration: "gpt-oss-120b" },
    policyProfileId: "attacker-profile",
  };
  await writeFile(manifestPath, JSON.stringify(tampered), "utf8");

  const { result } = await verifyWave1PocEvidenceFromDisk(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
  assert.equal(result.manifestIntegrity?.ok, false);
  assert.equal(
    result.manifestIntegrity?.expectedHash,
    manifest.manifestIntegrity?.hash,
  );
  assert.notEqual(
    result.manifestIntegrity?.actualHash,
    manifest.manifestIntegrity?.hash,
  );

  const explicit = await verifyWave1PocEvidenceFromDisk(dir, {
    expectedManifestSha256,
  });
  assert.deepEqual(explicit.result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
});

test("evidence-manifest: direct verifier detects valid-looking metadata rewrite via self-attestation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const tamperedManifest = {
    ...manifest,
    modelDeployments: { testGeneration: "gpt-oss-120b" },
    policyProfileId: "attacker-profile",
  } as Wave1PocEvidenceManifest;

  const result = await verifyWave1PocEvidenceManifest({
    manifest: tamperedManifest,
    artifactsDir: dir,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
  assert.equal(result.manifestIntegrity?.ok, false);
  assert.equal(
    result.manifestIntegrity?.expectedHash,
    manifest.manifestIntegrity?.hash,
  );
  assert.notEqual(
    result.manifestIntegrity?.actualHash,
    manifest.manifestIntegrity?.hash,
  );
});

test("evidence-manifest: current manifest missing self-attestation fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  const manifestWithoutIntegrity = { ...manifest };
  delete manifestWithoutIntegrity.manifestIntegrity;

  const result = await verifyWave1PocEvidenceManifest({
    manifest: manifestWithoutIntegrity,
    artifactsDir: dir,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
  assert.equal(result.manifestIntegrity?.ok, false);
  assert.equal(result.manifestIntegrity?.expectedHash, undefined);
  assert.match(result.manifestIntegrity?.actualHash ?? "", /^[0-9a-f]{64}$/);
});

test("evidence-manifest: missing digest witness fails closed on disk verify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ti-poc-evidence-"));
  await writeFile(join(dir, "alpha.json"), '{"a":1}');
  const manifest = buildWave1PocEvidenceManifest(
    baseInput([
      {
        filename: "alpha.json",
        bytes: utf8('{"a":1}'),
        category: "validation",
      },
    ]),
  );
  await writeWave1PocEvidenceManifest({
    manifest,
    destinationDir: dir,
  });
  await rm(join(dir, WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME));

  const { result } = await verifyWave1PocEvidenceFromDisk(dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.mutated, [
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  ]);
});
