/**
 * Tests for Issue #2185 — CLI flag parser + dispatcher for
 * `test-intelligence onboard`.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseTestIntelligenceOnboardArgs,
  runTestIntelligenceOnboardCommand,
  TEST_INTELLIGENCE_ONBOARD_HELP,
  TestIntelligenceOnboardOperatorError,
} from "./test-intelligence-onboard-cli.js";

const FIXED_NOW = "2026-05-11T08:00:00.000Z";

const makeRoot = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ti-onboard-cli-"));

const captureSink = () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    stdout: (chunk: string) => stdoutChunks.push(chunk),
    stderr: (chunk: string) => stderrChunks.push(chunk),
    out: () => stdoutChunks.join(""),
    err: () => stderrChunks.join(""),
  };
};

test("parseTestIntelligenceOnboardArgs accepts the documented flag set in provision mode", () => {
  const parsed = parseTestIntelligenceOnboardArgs([
    "--tenant-id",
    "acme-bank",
    "--legal-name",
    "Acme Bank AG",
    "--policy-profile",
    "eu-banking-default",
    "--output-root",
    "/tmp/onboard",
    "--force",
    "--environment-id",
    "staging",
    "--project-id",
    "core",
    "--jurisdiction",
    "DE",
    "--effective-date",
    "2026-05-11",
  ]);
  assert.equal(parsed.mode, "provision");
  if (parsed.mode !== "provision") return;
  assert.equal(parsed.tenantId, "acme-bank");
  assert.equal(parsed.legalName, "Acme Bank AG");
  assert.equal(parsed.policyProfileId, "eu-banking-default");
  assert.equal(parsed.outputRoot, "/tmp/onboard");
  assert.equal(parsed.force, true);
  assert.equal(parsed.environmentId, "staging");
  assert.equal(parsed.projectId, "core");
  assert.equal(parsed.jurisdiction, "DE");
  assert.equal(parsed.effectiveDate, "2026-05-11");
});

test("parseTestIntelligenceOnboardArgs accepts --doctor with the doctor-mode flag set", () => {
  const parsed = parseTestIntelligenceOnboardArgs([
    "--doctor",
    "--tenant-id",
    "acme-bank",
    "--output-root",
    "/tmp/onboard",
  ]);
  assert.equal(parsed.mode, "doctor");
  if (parsed.mode !== "doctor") return;
  assert.equal(parsed.tenantId, "acme-bank");
  assert.equal(parsed.outputRoot, "/tmp/onboard");
  assert.equal(parsed.environmentId, "prod");
});

test("parseTestIntelligenceOnboardArgs rejects unknown flags and missing required flags", () => {
  assert.throws(
    () =>
      parseTestIntelligenceOnboardArgs([
        "--tenant-id",
        "acme-bank",
        "--policy-profile",
        "eu-banking-default",
        "--output-root",
        "/tmp/x",
        "--legal-name",
        "Acme",
        "--unknown-flag",
        "value",
      ]),
    (err: unknown) => err instanceof TestIntelligenceOnboardOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceOnboardArgs([
        "--tenant-id",
        "acme-bank",
        "--output-root",
        "/tmp/x",
      ]),
    (err: unknown) =>
      err instanceof TestIntelligenceOnboardOperatorError &&
      /--legal-name is required/u.test(err.message),
  );
  // Doctor + provision-only flag is rejected so the operator notices the
  // typo instead of silently dropping it.
  assert.throws(
    () =>
      parseTestIntelligenceOnboardArgs([
        "--doctor",
        "--tenant-id",
        "acme-bank",
        "--output-root",
        "/tmp/x",
        "--legal-name",
        "Acme",
      ]),
    (err: unknown) =>
      err instanceof TestIntelligenceOnboardOperatorError &&
      /--legal-name is not valid with --doctor/u.test(err.message),
  );
});

test("parseTestIntelligenceOnboardArgs rejects duplicate flags", () => {
  assert.throws(
    () =>
      parseTestIntelligenceOnboardArgs([
        "--tenant-id",
        "acme-bank",
        "--tenant-id",
        "rival",
        "--legal-name",
        "Acme",
        "--policy-profile",
        "eu-banking-default",
        "--output-root",
        "/tmp/x",
      ]),
    (err: unknown) =>
      err instanceof TestIntelligenceOnboardOperatorError &&
      /--tenant-id may be specified at most once/u.test(err.message),
  );
});

test("runTestIntelligenceOnboardCommand exits 0 on a clean provision and prints next-step commands", async () => {
  const outputRoot = await makeRoot();
  try {
    const sink = captureSink();
    const code = await runTestIntelligenceOnboardCommand(
      {
        mode: "provision",
        tenantId: "acme-bank",
        legalName: "Acme Bank AG",
        policyProfileId: "eu-banking-default",
        outputRoot,
        force: false,
        environmentId: "prod",
        jurisdiction: "EU",
        effectiveDate: FIXED_NOW.slice(0, 10),
      },
      sink,
    );
    assert.equal(code, 0);
    assert.match(sink.out(), /Tenant onboarding complete/u);
    assert.match(sink.out(), /Public-key fingerprints/u);
    assert.equal(sink.err(), "");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("runTestIntelligenceOnboardCommand returns exit code 1 on operator error and 2 on doctor failure", async () => {
  const outputRoot = await makeRoot();
  try {
    const errSink = captureSink();
    const code1 = await runTestIntelligenceOnboardCommand(
      {
        mode: "provision",
        tenantId: "BAD ID",
        legalName: "Acme",
        policyProfileId: "eu-banking-default",
        outputRoot,
        force: false,
        environmentId: "prod",
        jurisdiction: "EU",
      },
      errSink,
    );
    assert.equal(code1, 1);
    assert.match(errSink.err(), /tenant-id/u);

    // Doctor on a non-existent tenant returns exit 2.
    const doctorSink = captureSink();
    const code2 = await runTestIntelligenceOnboardCommand(
      {
        mode: "doctor",
        tenantId: "ghost",
        outputRoot,
        environmentId: "prod",
      },
      doctorSink,
    );
    assert.equal(code2, 2);
    assert.match(doctorSink.out(), /Result: FAIL/u);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("TEST_INTELLIGENCE_ONBOARD_HELP documents the documented flag set", () => {
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /--tenant-id/u);
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /--legal-name/u);
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /--policy-profile/u);
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /--output-root/u);
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /--doctor/u);
  assert.match(TEST_INTELLIGENCE_ONBOARD_HELP, /Issue #2185/u);
});
