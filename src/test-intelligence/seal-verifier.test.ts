import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENEALOGY_ARTIFACT_FILENAME,
  PROVENANCE_ARTIFACT_FILENAME,
  REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildProductionRunnerEvidenceSeal,
  PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  serializeProductionRunnerEvidenceSeal,
} from "./production-runner-evidence.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";
import {
  DEFAULT_SEAL_VERIFY_KEY_LABEL,
  ReplayDeterminismHardGateError,
  assertReplayDeterminismVerifiedFromDisk,
  G9_REPLAY_DETERMINISM_VERIFIED,
  renderSealVerificationJsonReport,
  renderSealVerificationTextReport,
  verifySealBundle,
} from "./seal-verifier.js";

const sha256Hex = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

interface FixtureBundle {
  readonly runDir: string;
  readonly cleanup: () => Promise<void>;
  readonly finopsFilename: string;
  readonly genealogyFilename: string;
}

const buildFixtureBundle = async (input?: {
  readonly includeProvenance?: boolean;
  readonly includeRegionAttestations?: boolean;
}): Promise<FixtureBundle> => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "seal-verifier-"));
  const finopsFilename = "finops/budget-report.json";
  await mkdir(path.join(runDir, "finops"), { recursive: true });

  const finopsReport = {
    schemaVersion: "1.0.0",
    contractVersion: "1.23.0",
    jobId: "ti-test-2178",
    generatedAt: "2026-05-10T10:00:00.000Z",
    bySource: {
      generator: {
        callCount: 1,
        deployment: "gpt-oss-120b",
        idempotentReplayHits: 0,
        inFlightDedupHits: 0,
        modelRevision: "gpt-oss-120b@test",
        tierLabel: "heavy" as const,
        tokensIn: 10,
        tokensOut: 5,
        costMinorUnits: 0,
      },
    },
    bySourceTotal: { callCount: 1, costMinorUnits: 0 },
    bySourceSealedAt: "2026-05-10T10:00:00.000Z",
  } as const;
  const finopsBytes = `${canonicalJson(finopsReport)}\n`;
  await writeFile(path.join(runDir, finopsFilename), finopsBytes, "utf8");

  const harnessFilename = "agent-participation.json";
  const harnessBytes = `${canonicalJson({ schemaVersion: "1.0.0", participants: [] })}\n`;
  await writeFile(path.join(runDir, harnessFilename), harnessBytes, "utf8");

  const genealogyFilename = GENEALOGY_ARTIFACT_FILENAME;
  const genealogyBytes = `${canonicalJson({ schemaVersion: "1.0.0", nodes: [] })}\n`;
  await writeFile(path.join(runDir, genealogyFilename), genealogyBytes, "utf8");
  const genealogyDagHash = sha256Hex(Buffer.from(genealogyBytes, "utf8"));

  const seal = buildProductionRunnerEvidenceSeal({
    jobId: finopsReport.jobId,
    generatedAt: finopsReport.generatedAt,
    harnessArtifactFilenames: [harnessFilename],
    headOfChainHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
    chainLength: 0,
    finopsArtifactFilename: finopsFilename,
    bySourceHash: computePerSourceCostBreakdownHashFromReport(finopsReport),
    genealogyDagHash,
    visualEvidenceHashes: [],
  });
  await writeFile(
    path.join(runDir, PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME),
    serializeProductionRunnerEvidenceSeal(seal),
    "utf8",
  );

  if (input?.includeProvenance) {
    const provenance = {
      "@context": [
        "https://www.w3.org/ns/prov-o.jsonld",
        { ti: "https://oscharko.dev/test-intelligence#" },
      ],
      "@graph": [
        {
          "@id": `urn:ti:artifact:${harnessFilename}`,
          "ti:artifactPath": harnessFilename,
          "ti:sha256": sha256Hex(Buffer.from(harnessBytes, "utf8")),
        },
      ],
    };
    await writeFile(
      path.join(runDir, PROVENANCE_ARTIFACT_FILENAME),
      `${canonicalJson(provenance)}\n`,
      "utf8",
    );
  }
  if (input?.includeRegionAttestations) {
    const report = {
      schemaVersion: "1.0.0",
      contractVersion: "1.23.0",
      jobId: finopsReport.jobId,
      generatedAt: finopsReport.generatedAt,
      attestations: [
        {
          filename: finopsFilename,
          artifactHash: sha256Hex(Buffer.from(finopsBytes, "utf8")),
          regionAttestations: [
            {
              schemaVersion: "1.0.0",
              artifactHash: sha256Hex(Buffer.from(finopsBytes, "utf8")),
              deploymentId: "gpt-oss-120b",
              servedFromRegion: "eu-central-1",
              observedAtUtc: "2026-05-10T10:00:00.000Z",
              attestedBy: "azure-instance-metadata",
              attestationSignatureHex: "ab".repeat(32),
            },
          ],
        },
      ],
    };
    await writeFile(
      path.join(runDir, REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME),
      `${canonicalJson(report)}\n`,
      "utf8",
    );
  }

  return {
    runDir,
    finopsFilename,
    genealogyFilename,
    cleanup: async () => {
      await rm(runDir, { recursive: true, force: true });
    },
  };
};

test("seal-verifier: happy path returns OK with merkle root and HMAC", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.failures.length, 0);
    assert.equal(report.jobId, "ti-test-2178");
    assert.match(report.merkleRoot ?? "", /^[0-9a-f]{64}$/u);
    assert.match(report.manifestHmacSha256 ?? "", /^[0-9a-f]{64}$/u);
    assert.match(report.hmacKeyFingerprint ?? "", /^[0-9a-f]{16}$/u);
    const ok = report.artifacts.filter((a) => a.status === "OK");
    assert.ok(ok.length >= 3, `expected at least 3 OK artifacts, got ${String(ok.length)}`);
    for (const cc of report.crossChecks) {
      if (cc.name === "finops_bySource_hash" || cc.name === "genealogy_dag_hash") {
        assert.equal(cc.ok, true, `${cc.name}: ${cc.detail}`);
      }
    }
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: tampered artifact yields TAMPERED + artifact_tampered failure", async () => {
  const fixture = await buildFixtureBundle();
  try {
    await writeFile(
      path.join(fixture.runDir, fixture.genealogyFilename),
      "{}",
      "utf8",
    );
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, false);
    const tampered = report.artifacts.find(
      (a) => a.reference === fixture.genealogyFilename,
    );
    assert.equal(tampered?.status, "TAMPERED");
    const code = report.failures.find(
      (f) => f.code === "artifact_tampered",
    );
    assert.ok(code !== undefined, "expected artifact_tampered failure");
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: missing artifact yields MISSING + artifact_missing failure", async () => {
  const fixture = await buildFixtureBundle();
  try {
    await rm(path.join(fixture.runDir, fixture.genealogyFilename));
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, false);
    const missing = report.artifacts.find(
      (a) => a.reference === fixture.genealogyFilename,
    );
    assert.equal(missing?.status, "MISSING");
    assert.ok(
      report.failures.some((f) => f.code === "artifact_missing"),
      "expected artifact_missing failure",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: bundle-extra files reported as EXTRA without failure", async () => {
  const fixture = await buildFixtureBundle();
  try {
    await writeFile(
      path.join(fixture.runDir, "stray-file.json"),
      `${canonicalJson({ stray: true })}\n`,
      "utf8",
    );
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    const extra = report.artifacts.find((a) => a.reference === "stray-file.json");
    assert.equal(extra?.status, "EXTRA");
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: missing seal returns seal_missing failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seal-verifier-empty-"));
  try {
    const report = await verifySealBundle({ bundleDir: dir });
    assert.equal(report.ok, false);
    assert.equal(report.failures[0]?.code, "seal_missing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seal-verifier: malformed seal returns seal_unparseable failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seal-verifier-bad-"));
  try {
    await writeFile(
      path.join(dir, PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME),
      "{not-json",
      "utf8",
    );
    const report = await verifySealBundle({ bundleDir: dir });
    assert.equal(report.ok, false);
    assert.equal(report.failures[0]?.code, "seal_unparseable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seal-verifier: --expected-merkle-root mismatch produces merkle_root_mismatch", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const report = await verifySealBundle({
      bundleDir: fixture.runDir,
      expectedMerkleRootHex: "0".repeat(64),
    });
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((f) => f.code === "merkle_root_mismatch"));
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: --expected-hmac mismatch produces hmac_mismatch", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const report = await verifySealBundle({
      bundleDir: fixture.runDir,
      expectedHmacHex: "0".repeat(64),
    });
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((f) => f.code === "hmac_mismatch"));
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: explicit key + matching expected-hmac round-trip succeeds", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const sealBytes = await readFile(
      path.join(
        fixture.runDir,
        PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
      ),
    );
    const seal = JSON.parse(Buffer.from(sealBytes).toString("utf8"));
    const key = Buffer.from("auditor-key-2178");
    const expected = createHmac("sha256", key)
      .update(canonicalJson(seal), "utf8")
      .digest("hex");
    const report = await verifySealBundle({
      bundleDir: fixture.runDir,
      key,
      expectedHmacHex: expected,
    });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.manifestHmacSha256, expected);
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: provenance.jsonld cross-link verifies consistently", async () => {
  const fixture = await buildFixtureBundle({ includeProvenance: true });
  try {
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    const cc = report.crossChecks.find((c) => c.name === "provenance_graph");
    assert.equal(cc?.ok, true, cc?.detail ?? "no provenance check");
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: region-attestations cross-link verifies against FinOps deployment ids", async () => {
  const fixture = await buildFixtureBundle({ includeRegionAttestations: true });
  try {
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    const cc = report.crossChecks.find((c) => c.name === "region_attestations");
    assert.equal(cc?.ok, true, cc?.detail ?? "no region check");
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: nested run-dir inside bundle root is auto-discovered", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const wrapper = await mkdtemp(path.join(os.tmpdir(), "seal-verifier-wrap-"));
    try {
      const innerDir = path.join(wrapper, "run-2178");
      await mkdir(innerDir, { recursive: true });
      // Move all fixture files into innerDir.
      const cp = spawnSync(
        "cp",
        ["-R", `${fixture.runDir}/.`, innerDir],
        { stdio: "ignore" },
      );
      assert.equal(cp.status, 0);
      const report = await verifySealBundle({ bundleDir: wrapper });
      assert.equal(report.ok, true, JSON.stringify(report.failures));
      assert.ok(report.sealPath.includes("run-2178"));
    } finally {
      await rm(wrapper, { recursive: true, force: true });
    }
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: tar.gz archive is extracted and verified", async () => {
  const probe = spawnSync("tar", ["--version"], { stdio: "ignore" });
  if (probe.status !== 0) {
    return; // Skip on hosts without tar.
  }
  const fixture = await buildFixtureBundle();
  try {
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), "seal-verifier-tar-"));
    try {
      const archive = path.join(archiveDir, "bundle.tar.gz");
      const res = spawnSync(
        "tar",
        ["-czf", archive, "-C", path.dirname(fixture.runDir), path.basename(fixture.runDir)],
        { stdio: "ignore" },
      );
      assert.equal(res.status, 0);
      const { extractSealBundleArchive } = await import(
        "../test-intelligence-run-cli.js"
      );
      const extracted = await extractSealBundleArchive(archive);
      try {
        const report = await verifySealBundle({ bundleDir: extracted.directory });
        assert.equal(report.ok, true, JSON.stringify(report.failures));
      } finally {
        await extracted.cleanup();
      }
    } finally {
      await rm(archiveDir, { recursive: true, force: true });
    }
  } finally {
    await fixture.cleanup();
  }
});

test("assertReplayDeterminismVerifiedFromDisk: throws G9 hard-gate error on tamper", async () => {
  const fixture = await buildFixtureBundle();
  try {
    await writeFile(
      path.join(fixture.runDir, fixture.genealogyFilename),
      "{}",
      "utf8",
    );
    let thrown: unknown;
    try {
      await assertReplayDeterminismVerifiedFromDisk(fixture.runDir);
    } catch (error) {
      thrown = error;
    }
    assert.ok(
      thrown instanceof ReplayDeterminismHardGateError,
      "expected ReplayDeterminismHardGateError",
    );
    assert.equal(
      (thrown as ReplayDeterminismHardGateError).code,
      G9_REPLAY_DETERMINISM_VERIFIED,
    );
    assert.match(
      (thrown as Error).message,
      /G9_REPLAY_DETERMINISM_VERIFIED/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("assertReplayDeterminismVerifiedFromDisk: succeeds on unmodified bundle", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const report = await assertReplayDeterminismVerifiedFromDisk(fixture.runDir);
    assert.equal(report.ok, true);
  } finally {
    await fixture.cleanup();
  }
});

test("renderSealVerificationTextReport: includes per-artifact tags + cross-checks", async () => {
  const fixture = await buildFixtureBundle({ includeProvenance: true });
  try {
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    const text = renderSealVerificationTextReport(report);
    assert.match(text, /seal verification (OK|FAILED)/);
    assert.match(text, /artifacts:/);
    assert.match(text, /OK\s+/);
    assert.match(text, /cross-checks:/);
    assert.match(text, /finops_bySource_hash/);
  } finally {
    await fixture.cleanup();
  }
});

test("renderSealVerificationJsonReport: emits canonical JSON terminating in newline", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    const text = renderSealVerificationJsonReport(report);
    assert.ok(text.endsWith("\n"));
    const parsed = JSON.parse(text.trimEnd());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.jobId, "ti-test-2178");
  } finally {
    await fixture.cleanup();
  }
});

test("DEFAULT_SEAL_VERIFY_KEY_LABEL is the documented sentinel", () => {
  assert.equal(DEFAULT_SEAL_VERIFY_KEY_LABEL, "workspace-dev:seal-verify:v1");
});

test("seal-verifier: rejects seal that names an artifact outside the run dir", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const sealPath = path.join(
      fixture.runDir,
      "production-runner-evidence-seal.json",
    );
    const seal = JSON.parse(
      Buffer.from(await readFile(sealPath)).toString("utf8"),
    );
    seal.harnessArtifactFilenames = [...seal.harnessArtifactFilenames, "../escape.json"];
    await writeFile(sealPath, canonicalJson(seal), "utf8");
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, false);
    const escape = report.artifacts.find(
      (a) => a.reference === "../escape.json",
    );
    assert.equal(escape?.status, "TAMPERED");
    assert.ok(
      report.failures.some(
        (f) =>
          f.code === "artifact_tampered" && f.reference === "../escape.json",
      ),
      "expected artifact_tampered failure for ../escape.json",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: visual-sidecar cross-check detects drift between seal hashes and sidecar refs", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const sealPath = path.join(
      fixture.runDir,
      "production-runner-evidence-seal.json",
    );
    const seal = JSON.parse(
      Buffer.from(await readFile(sealPath)).toString("utf8"),
    );
    seal.visualEvidenceHashes = [
      {
        screenId: "screen-A",
        modelDeployment: "m-1",
        evidenceHash: "a".repeat(64),
      },
    ];
    await writeFile(sealPath, canonicalJson(seal), "utf8");
    // Sidecar disagrees: different evidenceHash.
    const sidecar = {
      schemaVersion: "1.0.0",
      contractVersion: "1.23.0",
      visualEvidenceRefs: [
        {
          screenId: "screen-A",
          modelDeployment: "m-1",
          evidenceHash: "b".repeat(64),
        },
      ],
    };
    await writeFile(
      path.join(fixture.runDir, "visual-sidecar-result.json"),
      `${canonicalJson(sidecar)}\n`,
      "utf8",
    );
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    const cc = report.crossChecks.find(
      (c) => c.name === "visual_sidecar_evidence",
    );
    assert.equal(cc?.ok, false, cc?.detail ?? "no visual cross-check");
    assert.equal(report.ok, false);
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: visual-sidecar missing when seal references visuals fails closed", async () => {
  const fixture = await buildFixtureBundle();
  try {
    const sealPath = path.join(
      fixture.runDir,
      "production-runner-evidence-seal.json",
    );
    const seal = JSON.parse(
      Buffer.from(await readFile(sealPath)).toString("utf8"),
    );
    seal.visualEvidenceHashes = [
      {
        screenId: "screen-A",
        modelDeployment: "m-1",
        evidenceHash: "a".repeat(64),
      },
    ];
    await writeFile(sealPath, canonicalJson(seal), "utf8");
    const report = await verifySealBundle({ bundleDir: fixture.runDir });
    assert.equal(report.ok, false);
    const cc = report.crossChecks.find(
      (c) => c.name === "visual_sidecar_evidence",
    );
    assert.equal(cc?.ok, false);
  } finally {
    await fixture.cleanup();
  }
});

test("seal-verifier: checked-in fixture bundle verifies clean", async () => {
  const repoRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
  );
  const fixture = path.join(
    repoRoot,
    "fixtures",
    "test-intelligence",
    "seal-bundles",
    "sample-bundle",
  );
  const report = await verifySealBundle({ bundleDir: fixture });
  assert.equal(
    report.ok,
    true,
    JSON.stringify(report.failures, null, 2),
  );
  assert.equal(report.jobId, "ti-sample-2178");
  for (const cc of report.crossChecks) {
    assert.equal(cc.ok, true, `${cc.name}: ${cc.detail}`);
  }
});
