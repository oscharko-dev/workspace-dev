/**
 * Incident sink (Issue #2114, DORA Art. 10).
 *
 * Operator-supplied interface for persisting `IncidentReport`s. The
 * default file-system implementation writes one `incidents.json` per
 * job directory, atomically renamed from a `.tmp` sibling so a crashed
 * write never leaves a partial artifact behind. Operators may
 * substitute a sink that forwards to their incident-management system.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  INCIDENT_REPORT_ARTIFACT_FILENAME,
  type IncidentReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export interface RecordIncidentReportInput {
  readonly report: IncidentReport;
}

export interface RecordIncidentReportResult {
  readonly artifactPath: string;
  readonly bytesWritten: number;
}

/**
 * Operator-supplied sink for persisted incident reports. Implementations
 * MUST be idempotent on identical inputs and MUST not retain references
 * to the report after the returned promise settles.
 */
export interface IncidentSink {
  recordReport(
    input: RecordIncidentReportInput,
  ): Promise<RecordIncidentReportResult>;
}

export interface CreateFileSystemIncidentSinkInput {
  /**
   * Base directory under which a per-job subdirectory is created. The
   * sink writes `<destinationDir>/<jobId>/incidents.json`.
   */
  readonly destinationDir: string;
}

const STABLE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

const writeAtomicJson = async (
  path: string,
  payload: unknown,
): Promise<number> => {
  const serialized = canonicalJson(payload);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return Buffer.byteLength(serialized, "utf8");
};

/**
 * Default file-system `IncidentSink`. Writes `incidents.json` per job
 * directory using the same atomic-rename pattern as the review store.
 */
export const createFileSystemIncidentSink = (
  input: CreateFileSystemIncidentSinkInput,
): IncidentSink => {
  if (typeof input.destinationDir !== "string" || input.destinationDir === "") {
    throw new Error(
      'createFileSystemIncidentSink: "destinationDir" must be a non-empty string.',
    );
  }
  const destinationDir = resolve(input.destinationDir);

  return {
    async recordReport(
      { report }: RecordIncidentReportInput,
    ): Promise<RecordIncidentReportResult> {
      if (
        typeof report.jobId !== "string" ||
        report.jobId === "" ||
        !STABLE_SEGMENT_RE.test(report.jobId)
      ) {
        throw new Error(
          `IncidentSink.recordReport: report.jobId must match ${STABLE_SEGMENT_RE.source}.`,
        );
      }
      const jobDir = resolve(destinationDir, report.jobId);
      const relativeJobDir = relative(destinationDir, jobDir);
      if (
        relativeJobDir === ".." ||
        relativeJobDir.startsWith(`..${sep}`) ||
        isAbsolute(relativeJobDir)
      ) {
        throw new Error(
          "IncidentSink.recordReport: resolved jobDir escapes destinationDir.",
        );
      }
      await mkdir(jobDir, { recursive: true });
      const artifactPath = join(jobDir, INCIDENT_REPORT_ARTIFACT_FILENAME);
      const bytesWritten = await writeAtomicJson(artifactPath, report);
      return { artifactPath, bytesWritten };
    },
  };
};
