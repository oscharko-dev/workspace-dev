import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  INCIDENT_REPORT_ARTIFACT_FILENAME,
  INCIDENT_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type IncidentReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { createFileSystemIncidentSink } from "./incident-sink.js";

const JOB_ID = "job-incident-sink";
const OBSERVED_AT = "2026-05-10T12:34:56.000Z";

const buildReport = (overrides: Partial<IncidentReport> = {}): IncidentReport => ({
  schemaVersion: INCIDENT_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId: JOB_ID,
  generatedAt: OBSERVED_AT,
  reviewState: "ok",
  events: [],
  ...overrides,
});

const mkTempDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "incident-sink-"));

test("incident-sink: writes incidents.json into <destinationDir>/<jobId>/ atomically", async () => {
  const dir = await mkTempDir();
  try {
    const sink = createFileSystemIncidentSink({ destinationDir: dir });
    const report = buildReport({
      reviewState: "incident_ack_required",
      events: [
        {
          id: "0123456789abcdef",
          severity: "critical",
          category: "pii_leakage",
          observedAt: OBSERVED_AT,
          jobId: JOB_ID,
          evidence: [{ filename: "validation-report.json", sha256: "a".repeat(64) }],
          rootCauseHypothesis: "raw IBAN observed in step.data",
        },
      ],
    });
    const result = await sink.recordReport({ report });
    assert.equal(
      result.artifactPath,
      join(dir, JOB_ID, INCIDENT_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = JSON.parse(await readFile(result.artifactPath, "utf8"));
    assert.deepEqual(onDisk, report);
    // Atomic-rename invariant: no leftover .tmp sibling.
    const entries = await readdir(join(dir, JOB_ID));
    assert.deepEqual(entries.sort(), [INCIDENT_REPORT_ARTIFACT_FILENAME]);
    // Bytes written matches canonical-JSON length.
    assert.equal(result.bytesWritten, Buffer.byteLength(canonicalJson(report), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("incident-sink: persisted bytes are byte-stable for identical reports (canonical JSON)", async () => {
  const dir = await mkTempDir();
  try {
    const sink = createFileSystemIncidentSink({ destinationDir: dir });
    const report = buildReport();
    await sink.recordReport({ report });
    const first = await readFile(
      join(dir, JOB_ID, INCIDENT_REPORT_ARTIFACT_FILENAME),
      "utf8",
    );
    await sink.recordReport({ report });
    const second = await readFile(
      join(dir, JOB_ID, INCIDENT_REPORT_ARTIFACT_FILENAME),
      "utf8",
    );
    assert.equal(first, second);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("incident-sink: rejects empty destinationDir at construction time", () => {
  assert.throws(
    () => createFileSystemIncidentSink({ destinationDir: "" }),
    /destinationDir/,
  );
});

test("incident-sink: rejects empty jobId at write time", async () => {
  const dir = await mkTempDir();
  try {
    const sink = createFileSystemIncidentSink({ destinationDir: dir });
    await assert.rejects(
      sink.recordReport({ report: buildReport({ jobId: "" }) }),
      /jobId/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("incident-sink: rejects path-traversal jobId values", async () => {
  const dir = await mkTempDir();
  try {
    const sink = createFileSystemIncidentSink({ destinationDir: dir });
    await assert.rejects(
      sink.recordReport({ report: buildReport({ jobId: "../escape" }) }),
      /jobId/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
