import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("audit-dossier: generates byte-stable bundle for the accepted run fixture", async () => {
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
    const expected = await Promise.all([
      readFile(`${bundlePrefix}.json`),
      readFile(`${bundlePrefix}.sig`),
      readFile(`${bundlePrefix}.pdf`),
      readFile(`${bundlePrefix}.merkle.txt`),
    ]);
    for (let index = 0; index < generated.length; index += 1) {
      assert.deepEqual(generated[index], expected[index]);
    }
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
