/**
 * Evidence integrity tests (Issue #1369 Part B + Issue #1410 hardening).
 *
 * Covers:
 *   - Round-trip success: build + write + verify returns ok
 *   - Multi-artifact mutation: ALL mutations reported, not just the first
 *   - Byte-length resize (additive append) is detected
 *   - Byte-length resize (truncate) is detected
 *   - Manifest-mutation (modelDeployments field) is detected
 *   - rawScreenshotsIncluded mutation detectability
 *   - Filename injection: null byte, every C0 control + DEL, lone UTF-16
 *     surrogates, directory traversal, >255 bytes, plus a property-based
 *     fuzz over the unsafe code-point range (Issue #1410)
 *   - Hash collision-resistance proxy: identical bytes → identical hashes
 *   - rejectUnexpected catches an extra file in the run dir
 *   - Missing artifact (deleted post-write) is detected
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  CONTRACT_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_VALIDATION_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  type Wave1ValidationEvidenceManifest,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildWave1ValidationEvidenceManifest,
  computeWave1ValidationEvidenceManifestDigest,
  verifyWave1ValidationEvidenceFromDisk,
  verifyWave1ValidationEvidenceManifest,
  writeWave1ValidationEvidenceManifest,
  type BuildEvidenceArtifactRecord,
} from "./evidence-manifest.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const baseInput = (
  artifacts: ReadonlyArray<BuildEvidenceArtifactRecord>,
): Parameters<typeof buildWave1ValidationEvidenceManifest>[0] => ({
  fixtureId: "validation-onboarding",
  jobId: "job-1369",
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

const withDir = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "ti-1369-evidence-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// Write an artifact to disk and return the path.
const writeArtifact = (dir: string, filename: string, content: string) =>
  writeFile(join(dir, filename), content, "utf8");

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

test("evidence-tampering: round-trip success — build + write + verify returns ok", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    await writeWave1ValidationEvidenceManifest({ manifest, destinationDir: dir });

    const { result } = await verifyWave1ValidationEvidenceFromDisk(dir);

    assert.equal(result.ok, true, "round-trip must verify ok");
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.mutated, []);
    assert.deepEqual(result.resized, []);
    assert.deepEqual(result.unexpected, []);
    assert.equal(result.manifestIntegrity?.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Multi-artifact mutation
// ---------------------------------------------------------------------------

test("evidence-tampering: multi-artifact mutation — ALL mutations reported, not just first", async () => {
  await withDir(async (dir) => {
    const alphaOriginal = '{"a":1}';
    const betaOriginal = '{"b":2}';
    const gammaOriginal = '{"g":3}';

    await writeArtifact(dir, "alpha.json", alphaOriginal);
    await writeArtifact(dir, "beta.json", betaOriginal);
    await writeArtifact(dir, "gamma.json", gammaOriginal);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(alphaOriginal),
          category: "validation",
        },
        {
          filename: "beta.json",
          bytes: utf8(betaOriginal),
          category: "review",
        },
        {
          filename: "gamma.json",
          bytes: utf8(gammaOriginal),
          category: "export",
        },
      ]),
    );

    // Mutate alpha and beta after the manifest is built; gamma stays intact.
    await writeArtifact(dir, "alpha.json", '{"a":99}');
    await writeArtifact(dir, "beta.json", '{"b":99}');

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "verify must fail when multiple artifacts are mutated",
    );
    assert.ok(
      result.mutated.includes("alpha.json"),
      "alpha.json mutation must be reported",
    );
    assert.ok(
      result.mutated.includes("beta.json"),
      "beta.json mutation must be reported",
    );
    assert.ok(
      !result.mutated.includes("gamma.json"),
      "gamma.json must NOT be reported as mutated",
    );
    assert.equal(
      result.mutated.length,
      2,
      "exactly two mutations must be reported",
    );
  });
});

// ---------------------------------------------------------------------------
// Byte-length resize detection
// ---------------------------------------------------------------------------

test("evidence-tampering: byte-length resize (additive append) is detected", async () => {
  await withDir(async (dir) => {
    const original = '{"v":1}';
    await writeArtifact(dir, "artifact.json", original);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "artifact.json",
          bytes: utf8(original),
          category: "policy",
        },
      ]),
    );

    // Append bytes — same leading content, longer file.
    await writeArtifact(
      dir,
      "artifact.json",
      original + ",extra content appended by attacker",
    );

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest,
      artifactsDir: dir,
    });

    assert.equal(result.ok, false, "additive resize must be detected");
    assert.ok(
      result.resized.includes("artifact.json"),
      "resized must list the file",
    );
    assert.ok(
      result.mutated.includes("artifact.json"),
      "hash mismatch must also be reported",
    );
  });
});

test("evidence-tampering: byte-length resize (truncate) is detected", async () => {
  await withDir(async (dir) => {
    const original =
      '{"payload":"large content that will be truncated by an attacker"}';
    await writeArtifact(dir, "artifact.json", original);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "artifact.json",
          bytes: utf8(original),
          category: "policy",
        },
      ]),
    );

    // Truncate to fewer bytes.
    await writeArtifact(dir, "artifact.json", '{"x":1}');

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest,
      artifactsDir: dir,
    });

    assert.equal(result.ok, false, "truncation must be detected");
    assert.ok(
      result.resized.includes("artifact.json"),
      "resized must list the truncated file",
    );
    assert.ok(
      result.mutated.includes("artifact.json"),
      "hash mismatch must also be reported",
    );
  });
});

// ---------------------------------------------------------------------------
// Manifest-mutation detection
// ---------------------------------------------------------------------------

test("evidence-tampering: manifest modelDeployments mutation is detected on re-verify", async () => {
  // An attacker replaces the manifest on disk with a modified version that
  // changes modelDeployments. Artifact bytes still match, so the verifier must
  // fail closed on the tampered manifest metadata itself.
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    const manifestPath = await writeWave1ValidationEvidenceManifest({
      manifest,
      destinationDir: dir,
    });

    // Tamper: read manifest from disk, alter modelDeployments, re-write.
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed["modelDeployments"] = { testGeneration: "attacker-model" };
    await writeFile(manifestPath, JSON.stringify(parsed), "utf8");

    const tamperedManifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as Wave1ValidationEvidenceManifest;

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest: tamperedManifest,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "manifest metadata mutation must fail verification",
    );
    assert.ok(
      result.mutated.includes(WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      "tampered manifest metadata must be reported as a manifest mutation",
    );
    assert.equal(
      result.manifestIntegrity?.ok,
      false,
      "manifest self-attestation must reject the metadata rewrite",
    );
    assert.equal(
      result.manifestIntegrity?.expectedHash,
      manifest.manifestIntegrity?.hash,
      "self-attestation must compare against the original stamped manifest hash",
    );
    assert.notEqual(
      result.manifestIntegrity?.actualHash,
      manifest.manifestIntegrity?.hash,
      "tampered manifest metadata must recompute to a different hash",
    );
  });
});

test("evidence-tampering: valid-looking manifest metadata rewrite is detected by default disk verify", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    const expectedManifestSha256 =
      computeWave1ValidationEvidenceManifestDigest(manifest);
    const manifestPath = await writeWave1ValidationEvidenceManifest({
      manifest,
      destinationDir: dir,
    });

    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed["modelDeployments"] = { testGeneration: "gpt-oss-120b" };
    parsed["policyProfileId"] = "attacker-profile";
    await writeFile(manifestPath, JSON.stringify(parsed), "utf8");

    const defaultVerification = await verifyWave1ValidationEvidenceFromDisk(dir);
    const { result } = await verifyWave1ValidationEvidenceFromDisk(dir, {
      expectedManifestSha256,
    });

    assert.equal(
      defaultVerification.result.ok,
      false,
      "valid-looking manifest metadata rewrite must fail default digest-witness verification",
    );
    assert.ok(
      defaultVerification.result.mutated.includes(
        WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
      ),
      "default digest mismatch must be reported as a manifest mutation",
    );
    assert.equal(
      defaultVerification.result.manifestIntegrity?.ok,
      false,
      "default disk verify must reject the self-attestation mismatch",
    );
    assert.equal(
      result.ok,
      false,
      "valid-looking manifest metadata rewrite must fail trusted-digest verification",
    );
    assert.ok(
      result.mutated.includes(WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      "trusted digest mismatch must be reported as a manifest mutation",
    );
    assert.equal(
      result.manifestIntegrity?.ok,
      false,
      "trusted-digest verify must also report the self-attestation mismatch",
    );
  });
});

test("evidence-tampering: rawScreenshotsIncluded mutation from false to true is detected", async () => {
  // The manifest carries rawScreenshotsIncluded: false as a hard type-level
  // invariant. An attacker who modifies the JSON file on disk can flip it to
  // true; the verifier must reject that metadata mutation even when artifact
  // bytes still match.
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    const manifestPath = await writeWave1ValidationEvidenceManifest({
      manifest,
      destinationDir: dir,
    });

    // Tamper: flip rawScreenshotsIncluded.
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(
      parsed["rawScreenshotsIncluded"],
      false,
      "must start as false",
    );
    parsed["rawScreenshotsIncluded"] = true;
    await writeFile(manifestPath, JSON.stringify(parsed), "utf8");

    const tamperedManifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as Wave1ValidationEvidenceManifest;

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest: tamperedManifest,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "rawScreenshotsIncluded flip must fail verification",
    );
    assert.ok(
      result.mutated.includes(WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      "tampered manifest invariant must be reported as a manifest mutation",
    );
    assert.equal(
      result.manifestIntegrity?.ok,
      false,
      "manifest self-attestation must reject the invariant rewrite",
    );
    // Confirm the tampered value is visible.
    assert.equal(
      (tamperedManifest as unknown as Record<string, unknown>)[
        "rawScreenshotsIncluded"
      ],
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Filename injection
// ---------------------------------------------------------------------------

test("evidence-tampering: filename with null byte is refused", () => {
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: "valid\x00inject.json",
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /control characters/,
    "null byte in filename must be rejected before filesystem writes",
  );
});

// Issue #1410 — every C0 control + DEL must be rejected at the contract
// boundary so the failure mode is deterministic and platform-independent
// (filesystems on Windows/Linux/macOS disagree about which of these the
// kernel itself rejects). The test uses the exhaustive 0x00..=0x1F + 0x7F
// set rather than a sample, so the property holds for every code unit.
test("evidence-tampering: every C0 control character (0x00–0x1F) + DEL (0x7F) in filename is refused", () => {
  const codes: number[] = [];
  for (let c = 0x00; c <= 0x1f; c += 1) codes.push(c);
  codes.push(0x7f);

  for (const code of codes) {
    const ch = String.fromCharCode(code);
    assert.throws(
      () =>
        buildWave1ValidationEvidenceManifest(
          baseInput([
            {
              filename: `valid${ch}inject.json`,
              bytes: utf8("x"),
              category: "validation",
            },
          ]),
        ),
      /control characters/,
      `code 0x${code.toString(16).padStart(2, "0")} must be rejected as a control character`,
    );
  }
});

// Issue #1410 — common whitespace controls (tab, LF, CR, VT, FF) get a
// dedicated test because they are the most likely vector when an attacker
// crafts a filename via JSON injection or copy/paste from a misencoded
// source.
test("evidence-tampering: whitespace control chars (tab, LF, CR, VT, FF) in filename are refused", () => {
  for (const ch of ["\t", "\n", "\r", "\v", "\f"]) {
    assert.throws(
      () =>
        buildWave1ValidationEvidenceManifest(
          baseInput([
            {
              filename: `name${ch}.json`,
              bytes: utf8("x"),
              category: "validation",
            },
          ]),
        ),
      /control characters/,
      `whitespace control ${JSON.stringify(ch)} must be rejected`,
    );
  }
});

// Issue #1410 — lone UTF-16 surrogates encode invalid Unicode and produce
// replacement characters or throw when re-encoded as UTF-8 by external
// systems (filesystems, JSON consumers, downstream auditors). Reject them
// at the contract boundary.
test("evidence-tampering: filename with a lone high surrogate is refused", () => {
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: `valid${String.fromCharCode(0xd800)}inject.json`,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /lone UTF-16 surrogate/,
    "lone high surrogate must be rejected",
  );
});

test("evidence-tampering: filename with a lone low surrogate is refused", () => {
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: `valid${String.fromCharCode(0xdc00)}inject.json`,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /lone UTF-16 surrogate/,
    "lone low surrogate must be rejected",
  );
});

test("evidence-tampering: filename ending with an unpaired high surrogate is refused", () => {
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: `tail${String.fromCharCode(0xd800)}`,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /lone UTF-16 surrogate/,
    "trailing high surrogate must be rejected (no following low surrogate)",
  );
});

test("evidence-tampering: filename with a high surrogate followed by a non-low-surrogate is refused", () => {
  // High surrogate followed by an ordinary BMP character (not a low
  // surrogate) is invalid.
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: `mid${String.fromCharCode(0xd800)}A.json`,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /lone UTF-16 surrogate/,
    "high surrogate not followed by a low surrogate must be rejected",
  );
});

// Counter-example: a properly-paired surrogate (an astral-plane character
// such as an emoji) is *not* lone and must be accepted, so the validator
// does not over-reject legitimate Unicode filenames.
test("evidence-tampering: filename with a valid astral character (paired surrogates) is accepted", () => {
  const manifest = buildWave1ValidationEvidenceManifest(
    baseInput([
      // U+1F512 LOCK — encoded as the surrogate pair D83D DD12. Length 2 in
      // UTF-16 code units; valid Unicode.
      {
        filename: "lock-\u{1F512}.json",
        bytes: utf8("x"),
        category: "validation",
      },
    ]),
  );
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0]?.filename, "lock-\u{1F512}.json");
});

// Issue #1410 — fast-check property: for any code unit in the unsafe
// ranges (C0 controls, DEL, lone surrogates), splicing it into an
// otherwise-valid filename must cause a RangeError. The randomly-picked
// position exercises start, middle, and end placements without enumerating
// them by hand.
test("evidence-tampering: property — any unsafe code unit in any position is refused", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: 0x00, max: 0x1f }),
        fc.constant(0x7f),
        fc.integer({ min: 0xd800, max: 0xdfff }),
      ),
      fc.nat({ max: 16 }),
      (code, rawPos) => {
        const base = "alpha-beta.json";
        const pos = rawPos % (base.length + 1);
        const filename =
          base.slice(0, pos) + String.fromCharCode(code) + base.slice(pos);
        try {
          buildWave1ValidationEvidenceManifest(
            baseInput([{ filename, bytes: utf8("x"), category: "validation" }]),
          );
        } catch (err) {
          if (!(err instanceof RangeError)) return false;
          return /control characters|lone UTF-16 surrogate/.test(err.message);
        }
        return false;
      },
    ),
    { numRuns: 256 },
  );
});

// Issue #1410 — fail-closed defence in depth: a manifest in which the
// builder check has been bypassed (e.g. an attacker rewrote the JSON file
// on disk to inject a control-char filename) must still be rejected by
// the verifier path so the integrity report is fail-closed.
test("evidence-tampering: verifier rejects manifests whose artifact entries carry unsafe filenames", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);
    const validManifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );

    // Forge a sibling manifest whose artifact filename contains a null
    // byte. Because the constructor refuses this input, build a plain
    // object that mirrors the schema and cast it through `unknown`.
    const tampered = {
      ...validManifest,
      artifacts: [
        {
          ...validManifest.artifacts[0],
          filename: "alpha\x00.json",
        },
      ],
    } as unknown as Wave1ValidationEvidenceManifest;

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest: tampered,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "manifest carrying a control-char filename must fail verification",
    );
    assert.ok(
      result.mutated.includes(WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      "tampered filename must be reported as a manifest mutation",
    );
  });
});

test("evidence-tampering: verifier rejects manifests whose artifact entries carry lone surrogates", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);
    const validManifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );

    const tampered = {
      ...validManifest,
      artifacts: [
        {
          ...validManifest.artifacts[0],
          filename: `alpha${String.fromCharCode(0xd800)}.json`,
        },
      ],
    } as unknown as Wave1ValidationEvidenceManifest;

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest: tampered,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "manifest carrying a lone surrogate filename must fail verification",
    );
    assert.ok(
      result.mutated.includes(WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      "lone-surrogate filename must be reported as a manifest mutation",
    );
  });
});

test("evidence-tampering: filename with directory traversal (../) is refused", () => {
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: "../etc/passwd",
            bytes: utf8("root:x:0:0"),
            category: "validation",
          },
        ]),
      ),
    /path traversal/,
    "directory traversal filename must be refused",
  );
});

test("evidence-tampering: absolute filename is refused", () => {
  // Multi-segment relative paths are allowed since #1371 (FinOps writes
  // `finops/budget-report.json`); the security boundary is "must be
  // relative + no traversal", not "must be a basename". Absolute paths
  // remain refused.
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: "/etc/passwd",
            bytes: utf8("root:x:0:0"),
            category: "validation",
          },
        ]),
      ),
    /must be a relative path/,
    "absolute filename must be refused",
  );
});

test("evidence-tampering: filename longer than 255 bytes is refused", () => {
  const longName = "a".repeat(256) + ".json";
  assert.throws(
    () =>
      buildWave1ValidationEvidenceManifest(
        baseInput([
          {
            filename: longName,
            bytes: utf8("x"),
            category: "validation",
          },
        ]),
      ),
    /255 bytes/,
    "filename length >255 must be refused by the builder",
  );
});

// ---------------------------------------------------------------------------
// Hash collision-resistance proxy
// ---------------------------------------------------------------------------

test("evidence-tampering: identical bytes in two artifacts produce identical sha256", () => {
  const sharedContent = utf8('{"canonical":true,"value":42}');

  const manifest = buildWave1ValidationEvidenceManifest(
    baseInput([
      { filename: "copy-a.json", bytes: sharedContent, category: "validation" },
      { filename: "copy-b.json", bytes: sharedContent, category: "review" },
    ]),
  );

  const a = manifest.artifacts.find((x) => x.filename === "copy-a.json");
  const b = manifest.artifacts.find((x) => x.filename === "copy-b.json");
  assert.ok(a, "copy-a.json must be present");
  assert.ok(b, "copy-b.json must be present");
  assert.equal(
    a?.sha256,
    b?.sha256,
    "identical canonical bytes must produce identical sha256 (canonicalization sanity check)",
  );
  assert.equal(a?.bytes, b?.bytes, "byte lengths must match");
  assert.match(a?.sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("evidence-tampering: different bytes produce different sha256", () => {
  const manifest = buildWave1ValidationEvidenceManifest(
    baseInput([
      { filename: "x.json", bytes: utf8('{"v":1}'), category: "validation" },
      { filename: "y.json", bytes: utf8('{"v":2}'), category: "review" },
    ]),
  );

  const x = manifest.artifacts.find((a) => a.filename === "x.json");
  const y = manifest.artifacts.find((a) => a.filename === "y.json");
  assert.ok(x && y);
  assert.notEqual(
    x.sha256,
    y.sha256,
    "different bytes must produce different sha256",
  );
});

// ---------------------------------------------------------------------------
// rejectUnexpected
// ---------------------------------------------------------------------------

test("evidence-tampering: rejectUnexpected catches extra file dropped in run dir", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    await writeWave1ValidationEvidenceManifest({ manifest, destinationDir: dir });

    // Attacker drops a stray file.
    await writeArtifact(dir, "injected-payload.json", '{"evil":true}');

    const { result } = await verifyWave1ValidationEvidenceFromDisk(dir, {
      rejectUnexpected: true,
    });

    assert.equal(
      result.ok,
      false,
      "unexpected file must cause verification to fail",
    );
    assert.ok(
      result.unexpected.includes("injected-payload.json"),
      "injected file must be listed in unexpected",
    );
  });
});

test("evidence-tampering: rejectUnexpected=false ignores extra files (default behaviour)", async () => {
  await withDir(async (dir) => {
    const content = '{"v":1}';
    await writeArtifact(dir, "alpha.json", content);
    await writeArtifact(dir, "sibling-log.txt", "debug log");

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(content),
          category: "validation",
        },
      ]),
    );
    await writeWave1ValidationEvidenceManifest({ manifest, destinationDir: dir });

    const { result } = await verifyWave1ValidationEvidenceFromDisk(dir);

    assert.equal(
      result.ok,
      true,
      "sibling files must not cause failure when rejectUnexpected is false",
    );
    assert.deepEqual(result.unexpected, []);
  });
});

// ---------------------------------------------------------------------------
// Missing artifact
// ---------------------------------------------------------------------------

test("evidence-tampering: missing artifact (deleted post-write) is detected", async () => {
  await withDir(async (dir) => {
    const aContent = '{"a":1}';
    const bContent = '{"b":2}';
    await writeArtifact(dir, "alpha.json", aContent);
    await writeArtifact(dir, "beta.json", bContent);

    const manifest = buildWave1ValidationEvidenceManifest(
      baseInput([
        {
          filename: "alpha.json",
          bytes: utf8(aContent),
          category: "validation",
        },
        { filename: "beta.json", bytes: utf8(bContent), category: "review" },
      ]),
    );

    // Delete beta after manifest is built.
    await rm(join(dir, "beta.json"));

    const result = await verifyWave1ValidationEvidenceManifest({
      manifest,
      artifactsDir: dir,
    });

    assert.equal(
      result.ok,
      false,
      "missing artifact must cause verification to fail",
    );
    assert.ok(
      result.missing.includes("beta.json"),
      "beta.json must be listed as missing",
    );
    assert.ok(
      !result.missing.includes("alpha.json"),
      "alpha.json must not be listed as missing",
    );
  });
});
