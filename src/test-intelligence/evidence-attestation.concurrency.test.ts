/**
 * Concurrency safety test for `persistWave1ValidationAttestation`'s atomic
 * rename idiom (Issue #1377 follow-up).
 *
 * The temp filename is `${path}.${pid}.${randomUUID()}.tmp`. Even with
 * many same-pid same-millisecond writers running concurrently, the
 * UUID component guarantees a collision-free temp path so concurrent
 * persistence does not corrupt or lose any of the writers' content.
 *
 * The test runs N parallel persists into the SAME run directory, each
 * with a different envelope payload, and asserts that the final on-disk
 * file equals one of the input envelopes (last-writer-wins semantic is
 * acceptable; partial-write or "no file at all" is not).
 */

import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WAVE1_VALIDATION_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_VALIDATION_ATTESTATIONS_DIRECTORY,
  type Wave1ValidationAttestationDsseEnvelope,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildUnsignedWave1ValidationAttestationEnvelope,
  buildWave1ValidationAttestationStatement,
  persistWave1ValidationAttestation,
} from "./evidence-attestation.js";
import {
  buildWave1ValidationEvidenceManifest,
  computeWave1ValidationEvidenceManifestDigest,
  writeWave1ValidationEvidenceManifest,
} from "./evidence-manifest.js";

const ZERO = "0".repeat(64);
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

test("evidence-attestation [concurrency]: 16 parallel persists into the same run dir produce a complete file with no leftover .tmp", async (t) => {
  const runDir = await mkdtemp(join(tmpdir(), "wave1-validation-concur-"));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  // Manifest is the same across all writers — what differs is the
  // envelope payload (each writer uses a unique jobId variant). Note:
  // the manifest goes through writeWave1ValidationEvidenceManifest once; the
  // race is purely on the attestation envelope.
  const intent = utf8('{"intent":"concurrency"}\n');
  const baseManifest = buildWave1ValidationEvidenceManifest({
    fixtureId: "validation-onboarding",
    jobId: "concurrency-job",
    generatedAt: "2026-04-26T00:00:00.000Z",
    modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    exportProfileId: "opentext-alm-default",
    exportProfileVersion: "1.0.0",
    promptHash: ZERO,
    schemaHash: ZERO,
    inputHash: ZERO,
    cacheKeyDigest: ZERO,
    artifacts: [
      {
        filename: "business-intent-ir.json",
        bytes: intent,
        category: "intent",
      },
    ],
  });
  await writeWave1ValidationEvidenceManifest({
    manifest: baseManifest,
    destinationDir: runDir,
  });
  const manifestSha256 = computeWave1ValidationEvidenceManifestDigest(baseManifest);

  const writerCount = 16;
  const envelopes: Wave1ValidationAttestationDsseEnvelope[] = [];
  const persistPromises: Promise<unknown>[] = [];
  for (let i = 0; i < writerCount; i += 1) {
    // Each writer uses an envelope with a different `payload` byte
    // payload. They share the same on-disk filename, so they race on
    // the rename target. UUID-based temp names guarantee no collision.
    const synthetic: Wave1ValidationAttestationDsseEnvelope = {
      ...buildUnsignedWave1ValidationAttestationEnvelope(
        buildWave1ValidationAttestationStatement({
          manifest: baseManifest,
          manifestSha256,
          signingMode: "unsigned",
        }),
      ),
      payload: Buffer.from(`writer-${i}-payload`, "utf8").toString("base64"),
    };
    envelopes.push(synthetic);
    persistPromises.push(
      persistWave1ValidationAttestation({ envelope: synthetic, runDir }),
    );
  }
  await Promise.all(persistPromises);

  // The final file must exist and parse as a known envelope variant.
  const onDisk = await readFile(
    join(
      runDir,
      WAVE1_VALIDATION_ATTESTATIONS_DIRECTORY,
      WAVE1_VALIDATION_ATTESTATION_ARTIFACT_FILENAME,
    ),
    "utf8",
  );
  const expectedJsonVariants = envelopes.map((e) => canonicalJson(e));
  assert.ok(
    expectedJsonVariants.includes(onDisk),
    `final file content does not match any of the ${writerCount} writers' canonical envelopes`,
  );

  // No leftover *.tmp file should remain in the attestations dir.
  const dirEntries = await readdir(
    join(runDir, WAVE1_VALIDATION_ATTESTATIONS_DIRECTORY),
  );
  const tmpLeftovers = dirEntries.filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(
    tmpLeftovers,
    [],
    `unexpected leftover temp files after concurrent persists: ${tmpLeftovers.join(", ")}`,
  );
});
