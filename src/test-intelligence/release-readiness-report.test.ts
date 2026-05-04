import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_RELEASE_READINESS_GATE_IDS,
  ALLOWED_RELEASE_READINESS_GATE_STATUSES,
  RELEASE_READINESS_ARTIFACT_DIRECTORY,
  RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
  RELEASE_READINESS_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ReleaseReadinessGateId,
  type ReleaseReadinessGateResult,
} from "../contracts/index.js";
import {
  buildReleaseReadinessReport,
  isReleaseReadinessGateResult,
  isReleaseReadinessReport,
  parseReleaseReadinessReport,
  RELEASE_READINESS_GATE_SPECS,
  serializeReleaseReadinessReport,
  writeReleaseReadinessReport,
} from "./release-readiness-report.js";

const RELEASE_ID = "release-readiness-test-001";
const GENERATED_AT = "2026-05-04T12:34:56.000Z";

const passedGate = (
  gateId: ReleaseReadinessGateId,
  command: string,
): ReleaseReadinessGateResult => ({
  gateId,
  command,
  status: "passed",
  exitCode: 0,
  durationMs: 1234,
  logPath: `artifacts/release-readiness/logs/${gateId}.log`,
  attribution: [],
});

const buildAllPassingGates = (): ReleaseReadinessGateResult[] =>
  RELEASE_READINESS_GATE_SPECS.map((spec) =>
    passedGate(spec.gateId, spec.command),
  );

test("ALLOWED_RELEASE_READINESS_GATE_IDS lists all twelve issue-#1803 gates exactly once", () => {
  const expected: readonly ReleaseReadinessGateId[] = [
    "typecheck",
    "test",
    "test_ti_eval",
    "test_ti_live_e2e",
    "lint_no_telemetry",
    "lint_secrets_all",
    "lint_agent_boundaries",
    "lint_ts_style",
    "build",
    "release_ml_bom_emit",
    "release_merkle_roundtrip",
    "release_library_coverage_report",
  ];
  assert.deepEqual([...ALLOWED_RELEASE_READINESS_GATE_IDS], expected);
  assert.equal(
    new Set(ALLOWED_RELEASE_READINESS_GATE_IDS).size,
    ALLOWED_RELEASE_READINESS_GATE_IDS.length,
    "gate ids must be unique",
  );
});

test("ALLOWED_RELEASE_READINESS_GATE_STATUSES is the closed set { passed, failed, skipped }", () => {
  assert.deepEqual(
    [...ALLOWED_RELEASE_READINESS_GATE_STATUSES],
    ["passed", "failed", "skipped"],
  );
});

test("RELEASE_READINESS_GATE_SPECS aligns with the canonical gate-id list", () => {
  assert.equal(
    RELEASE_READINESS_GATE_SPECS.length,
    ALLOWED_RELEASE_READINESS_GATE_IDS.length,
  );
  for (let index = 0; index < RELEASE_READINESS_GATE_SPECS.length; index += 1) {
    const spec = RELEASE_READINESS_GATE_SPECS[index]!;
    assert.equal(spec.gateId, ALLOWED_RELEASE_READINESS_GATE_IDS[index]);
    assert.match(spec.command, /^pnpm /);
  }
  // Only test_ti_live_e2e is opt-in.
  const liveOptIn = RELEASE_READINESS_GATE_SPECS.filter(
    (spec) => spec.livePolicy === "live_credentials_required",
  );
  assert.equal(liveOptIn.length, 1);
  assert.equal(liveOptIn[0]?.gateId, "test_ti_live_e2e");
});

test("buildReleaseReadinessReport returns gates in canonical order regardless of input order", () => {
  const shuffled = [...buildAllPassingGates()].reverse();
  const report = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates: shuffled,
  });
  assert.equal(report.passed, true);
  assert.equal(report.releaseId, RELEASE_ID);
  assert.equal(report.generatedAt, GENERATED_AT);
  assert.equal(report.schemaVersion, RELEASE_READINESS_REPORT_SCHEMA_VERSION);
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.gates.length, ALLOWED_RELEASE_READINESS_GATE_IDS.length);
  for (let index = 0; index < report.gates.length; index += 1) {
    assert.equal(
      report.gates[index]?.gateId,
      ALLOWED_RELEASE_READINESS_GATE_IDS[index],
    );
  }
});

test("buildReleaseReadinessReport flags overall failure when any gate failed", () => {
  const gates = buildAllPassingGates();
  // Mark `test_ti_eval` as failed; expect top-level passed === false.
  const failingIndex = gates.findIndex((gate) => gate.gateId === "test_ti_eval");
  gates[failingIndex] = {
    ...gates[failingIndex]!,
    status: "failed",
    exitCode: 1,
    attribution: ["mutation_kill_rate_breach"],
  };
  const report = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates,
  });
  assert.equal(report.passed, false);
  assert.equal(report.gates[failingIndex]?.status, "failed");
});

test("buildReleaseReadinessReport allows skipped gates without failing the release", () => {
  const gates = buildAllPassingGates();
  const liveIndex = gates.findIndex(
    (gate) => gate.gateId === "test_ti_live_e2e",
  );
  gates[liveIndex] = {
    gateId: "test_ti_live_e2e",
    command: gates[liveIndex]!.command,
    status: "skipped",
    exitCode: null,
    durationMs: 0,
    logPath: null,
    attribution: ["live_credentials_absent"],
  };
  const report = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates,
  });
  assert.equal(report.passed, true);
  assert.equal(report.gates[liveIndex]?.status, "skipped");
});

test("buildReleaseReadinessReport rejects missing gates", () => {
  const gates = buildAllPassingGates().slice(1);
  assert.throws(() =>
    buildReleaseReadinessReport({
      releaseId: RELEASE_ID,
      generatedAt: GENERATED_AT,
      gates,
    }),
  );
});

test("buildReleaseReadinessReport rejects duplicate gates", () => {
  const gates = buildAllPassingGates();
  gates.push(passedGate("typecheck", "pnpm run typecheck"));
  assert.throws(() =>
    buildReleaseReadinessReport({
      releaseId: RELEASE_ID,
      generatedAt: GENERATED_AT,
      gates,
    }),
  );
});

test("buildReleaseReadinessReport rejects malformed releaseId / generatedAt", () => {
  const gates = buildAllPassingGates();
  assert.throws(() =>
    buildReleaseReadinessReport({
      releaseId: "",
      generatedAt: GENERATED_AT,
      gates,
    }),
  );
  assert.throws(() =>
    buildReleaseReadinessReport({
      releaseId: RELEASE_ID,
      generatedAt: "not-a-timestamp",
      gates,
    }),
  );
});

test("isReleaseReadinessGateResult enforces status/exitCode coherence", () => {
  // passed must have exitCode === 0
  assert.equal(
    isReleaseReadinessGateResult({
      gateId: "typecheck",
      command: "pnpm run typecheck",
      status: "passed",
      exitCode: 1,
      durationMs: 1,
      logPath: "artifacts/release-readiness/logs/typecheck.log",
      attribution: [],
    }),
    false,
  );
  // failed must have exitCode !== 0
  assert.equal(
    isReleaseReadinessGateResult({
      gateId: "typecheck",
      command: "pnpm run typecheck",
      status: "failed",
      exitCode: 0,
      durationMs: 1,
      logPath: "artifacts/release-readiness/logs/typecheck.log",
      attribution: ["wrong_exit_code"],
    }),
    false,
  );
  // skipped must have exitCode === null and logPath === null
  assert.equal(
    isReleaseReadinessGateResult({
      gateId: "test_ti_live_e2e",
      command: "pnpm run test:ti-live-e2e",
      status: "skipped",
      exitCode: 0,
      durationMs: 0,
      logPath: null,
      attribution: ["live_credentials_absent"],
    }),
    false,
  );
});

test("isReleaseReadinessReport rejects gates not in canonical order", () => {
  const gates = buildAllPassingGates();
  // Swap two adjacent gates.
  [gates[0], gates[1]] = [gates[1]!, gates[0]!];
  const report = {
    schemaVersion: RELEASE_READINESS_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    passed: true,
    gates,
  };
  assert.equal(isReleaseReadinessReport(report), false);
});

test("isReleaseReadinessReport rejects mismatched top-level passed", () => {
  const gates = buildAllPassingGates();
  const report = {
    schemaVersion: RELEASE_READINESS_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    passed: false, // contradicts: every gate is passed
    gates,
  };
  assert.equal(isReleaseReadinessReport(report), false);
});

test("serialize/parse round-trip is byte-stable for byte-identical inputs", () => {
  const reportA = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates: buildAllPassingGates(),
  });
  const reportB = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates: [...buildAllPassingGates()].reverse(),
  });
  const serializedA = serializeReleaseReadinessReport(reportA);
  const serializedB = serializeReleaseReadinessReport(reportB);
  assert.equal(serializedA, serializedB);
  assert.ok(serializedA.endsWith("\n"));
  const parsed = parseReleaseReadinessReport(serializedA);
  assert.ok(parsed);
  assert.equal(parsed?.passed, true);
  assert.equal(parsed?.gates.length, ALLOWED_RELEASE_READINESS_GATE_IDS.length);
});

test("parseReleaseReadinessReport rejects payloads without trailing newline", () => {
  const report = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates: buildAllPassingGates(),
  });
  const serialized = serializeReleaseReadinessReport(report);
  assert.equal(parseReleaseReadinessReport(serialized.replace(/\n$/, "")), undefined);
});

test("parseReleaseReadinessReport rejects unknown gate ids", () => {
  const report = buildReleaseReadinessReport({
    releaseId: RELEASE_ID,
    generatedAt: GENERATED_AT,
    gates: buildAllPassingGates(),
  });
  const tampered = {
    ...report,
    gates: [
      { ...report.gates[0], gateId: "rogue_gate" },
      ...report.gates.slice(1),
    ],
  };
  assert.equal(
    parseReleaseReadinessReport(`${JSON.stringify(tampered)}\n`),
    undefined,
  );
});

test("writeReleaseReadinessReport persists the artifact under the canonical filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-readiness-write-"));
  try {
    const report = buildReleaseReadinessReport({
      releaseId: RELEASE_ID,
      generatedAt: GENERATED_AT,
      gates: buildAllPassingGates(),
    });
    const written = await writeReleaseReadinessReport({
      report,
      runDir: root,
    });
    assert.equal(
      written.artifactPath,
      join(root, RELEASE_READINESS_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(written.artifactPath, "utf8");
    assert.equal(onDisk, written.serialized);
    const reparsed = parseReleaseReadinessReport(onDisk);
    assert.ok(reparsed);
    assert.equal(reparsed?.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeReleaseReadinessReport refuses an invalid report", async () => {
  const root = await mkdtemp(join(tmpdir(), "release-readiness-bad-"));
  try {
    const broken = {
      schemaVersion: RELEASE_READINESS_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      releaseId: RELEASE_ID,
      generatedAt: GENERATED_AT,
      passed: true,
      gates: [],
    };
    await assert.rejects(
      // Cast through unknown so we can exercise the runtime guard
      // without bypassing typechecking elsewhere.
      writeReleaseReadinessReport({
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        report: broken as unknown as Parameters<
          typeof writeReleaseReadinessReport
        >[0]["report"],
        runDir: root,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RELEASE_READINESS_ARTIFACT_DIRECTORY is committed-to-evidence path", () => {
  // The release pipeline commits the report under evidence/release-readiness/
  // (Issue #1803, "Report is canonical-JSON and committed to evidence").
  assert.equal(
    RELEASE_READINESS_ARTIFACT_DIRECTORY,
    "evidence/release-readiness",
  );
  assert.equal(
    RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
    "release-readiness-report.json",
  );
});
