/**
 * Tests for the customer-markdown ZIP bundle (Issue #1747).
 *
 * Validates byte stability, the presence of every promised entry, and
 * the path-traversal guard on the reader.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCustomerMarkdownZipBundle,
  readCustomerMarkdownZipInputs,
  type CustomerMarkdownZipBundle,
} from "./customer-markdown-zip.js";
import { canonicalJson } from "./content-hash.js";

const fixedBundle = (
  overrides: Partial<CustomerMarkdownZipBundle> = {},
): CustomerMarkdownZipBundle => ({
  jobId: "job-zip",
  combinedMarkdown: "# Testfälle\n\nbody\n",
  perCase: [
    { filename: "tc-001.md", body: "# TC-001\n" },
    { filename: "tc-002.md", body: "# TC-002\n" },
  ],
  businessIntentIrJson: canonicalJson({ schemaVersion: "1.0.0", intents: [] }),
  evidenceManifestJson: canonicalJson({ artifacts: [] }),
  regulatoryRelevanceSummaryJson: canonicalJson({
    totalCases: 2,
    domains: { banking: 1, general: 1 },
    cases: [],
  }),
  ...overrides,
});

const findEocd = (zip: Buffer): number => {
  // EOCD signature 0x06054b50; scan from the back, no comment so it's
  // exactly 22 bytes from EOF.
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
};

const totalEntries = (zip: Buffer): number => {
  const eocd = findEocd(zip);
  assert.ok(eocd >= 0, "EOCD record not found");
  return zip.readUInt16LE(eocd + 10);
};

test("buildCustomerMarkdownZipBundle includes all five logical entries", () => {
  const zip = buildCustomerMarkdownZipBundle(fixedBundle());
  // 5 entries: combined + 2 per-case + IR + manifest + regSummary = 6 here
  // (2 per-case in the fixture). Spec says "all 5 entries present" referring
  // to the 5 logical kinds — combined, per-case, IR, manifest, summary —
  // so per-case counts as one logical kind even with N files.
  // Total physical entries: 1 (combined) + 2 (per-case) + 1 (IR) + 1 (manifest) + 1 (summary) = 6
  assert.equal(totalEntries(zip), 6);
});

test("buildCustomerMarkdownZipBundle is byte-stable for identical inputs", () => {
  const a = buildCustomerMarkdownZipBundle(fixedBundle());
  const b = buildCustomerMarkdownZipBundle(fixedBundle());
  assert.equal(a.equals(b), true);
});

test("buildCustomerMarkdownZipBundle omits manifest entry when not provided", () => {
  const noManifest = fixedBundle();
  // Strip the optional field deliberately by reconstructing.
  const stripped: CustomerMarkdownZipBundle = {
    jobId: noManifest.jobId,
    combinedMarkdown: noManifest.combinedMarkdown,
    perCase: noManifest.perCase,
    businessIntentIrJson: noManifest.businessIntentIrJson,
    regulatoryRelevanceSummaryJson: noManifest.regulatoryRelevanceSummaryJson,
  };
  const zip = buildCustomerMarkdownZipBundle(stripped);
  // 1 combined + 2 per-case + 1 IR + 1 summary = 5
  assert.equal(totalEntries(zip), 5);
});

test("buildCustomerMarkdownZipBundle output unzips with the system unzip CLI", async () => {
  const zip = buildCustomerMarkdownZipBundle(fixedBundle());
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-zip-test-"));
  try {
    const zipPath = path.join(tempRoot, "bundle.zip");
    await writeFile(zipPath, zip);
    const outDir = path.join(tempRoot, "out");
    await mkdir(outDir, { recursive: true });
    // -o: overwrite without prompting; -q: quiet.
    execFileSync("unzip", ["-oq", zipPath, "-d", outDir]);
    const fs = await import("node:fs/promises");
    const expectedFiles = [
      "testfaelle.md",
      "cases/tc-001.md",
      "cases/tc-002.md",
      "business-intent-ir.json",
      "evidence-manifest.json",
      "regulatoryRelevance-summary.json",
    ];
    for (const rel of expectedFiles) {
      const stat = await fs.stat(path.join(outDir, rel)).catch(() => null);
      assert.ok(stat !== null, `expected entry missing: ${rel}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("readCustomerMarkdownZipInputs returns not_found when job dir is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-zip-read-"));
  try {
    const result = await readCustomerMarkdownZipInputs({
      artifactRoot: tempRoot,
      jobId: "missing-job",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.reason, "not_found");
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("readCustomerMarkdownZipInputs rejects path-traversal jobIds", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-zip-traversal-"));
  try {
    const result = await readCustomerMarkdownZipInputs({
      artifactRoot: tempRoot,
      jobId: "../../../etc",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.reason, "path_outside_root");
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("readCustomerMarkdownZipInputs assembles a bundle from on-disk artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-zip-roundtrip-"));
  try {
    const tiDir = path.join(tempRoot, "jobs", "job-X", "test-intelligence");
    const mdDir = path.join(tiDir, "customer-markdown");
    await mkdir(mdDir, { recursive: true });
    await writeFile(path.join(mdDir, "testfaelle.md"), "# Testfälle\nbody\n");
    await writeFile(path.join(mdDir, "tc-001.md"), "# TC-001\n");
    await writeFile(path.join(mdDir, "tc-002.md"), "# TC-002\n");
    const ir = canonicalJson({ schemaVersion: "1.0.0", intents: [] });
    await writeFile(path.join(tiDir, "business-intent-ir.json"), ir);
    const tcList = canonicalJson({
      schemaVersion: "1.0.0",
      jobId: "job-X",
      testCases: [
        {
          id: "tc-001",
          title: "Antrag absenden",
          regulatoryRelevance: { domain: "banking", rationale: "BIC field" },
        },
        {
          id: "tc-002",
          title: "Allgemein",
        },
      ],
    });
    await writeFile(path.join(tiDir, "generated-test-cases.json"), tcList);
    const result = await readCustomerMarkdownZipInputs({
      artifactRoot: tempRoot,
      jobId: "job-X",
    });
    assert.equal(result.ok, true);
    if (result.ok === true) {
      assert.equal(result.bundle.jobId, "job-X");
      assert.equal(result.bundle.perCase.length, 2);
      assert.match(result.bundle.combinedMarkdown, /Testfälle/);
      const summary = JSON.parse(
        result.bundle.regulatoryRelevanceSummaryJson,
      ) as {
        totalCases: number;
        domains: Record<string, number>;
      };
      assert.equal(summary.totalCases, 2);
      assert.equal(summary.domains.banking, 1);
      assert.equal(summary.domains.unknown, 1);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
