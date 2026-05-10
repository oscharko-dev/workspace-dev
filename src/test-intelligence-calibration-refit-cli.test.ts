import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseTestIntelligenceCalibrationRefitArgs,
  runTestIntelligenceCalibrationRefitCommand,
  TEST_INTELLIGENCE_CALIBRATION_REFIT_HELP,
} from "./test-intelligence-calibration-refit-cli.js";
import { CalibrationRefitOperatorError } from "./test-intelligence/self-improving-calibration.js";
import type { CalibrationGoldEntry } from "./test-intelligence/self-improving-calibration.js";

const REPO_ROOT = join(import.meta.dirname ?? "", "..");
const OPERATOR_KEY_PATH = join(
  REPO_ROOT,
  "fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json",
);

const buildSeparableEntries = (count: number): readonly CalibrationGoldEntry[] => {
  const out: CalibrationGoldEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const positive = i % 2 === 0;
    out.push({
      entryId: `entry-${String(i).padStart(4, "0")}`,
      locale: "DE-DE",
      riskClass: "regulated_data",
      rawScore: positive ? 0.95 : 0.05,
      humanVerdict: positive ? 1 : 0,
      source: "human_review",
      recordedAt: "2026-05-10T00:00:00.000Z",
    });
  }
  return out;
};

const writeGoldFile = async (
  entries: readonly CalibrationGoldEntry[],
): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "ti-cli-refit-gold-"));
  const path = join(dir, "gold.json");
  await writeFile(path, JSON.stringify({ entries }), "utf8");
  return path;
};

const collectingSink = (): {
  stdout: string;
  stderr: string;
  sink: { stdout(m: string): void; stderr(m: string): void };
} => {
  const captured = { stdout: "", stderr: "" };
  return {
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
    sink: {
      stdout(m) {
        captured.stdout += m;
      },
      stderr(m) {
        captured.stderr += m;
      },
    },
  };
};

// ---------------------------------------------------------------------------
// parseTestIntelligenceCalibrationRefitArgs
// ---------------------------------------------------------------------------

test("calibration-refit CLI: rejects unknown locale", () => {
  assert.throws(
    () =>
      parseTestIntelligenceCalibrationRefitArgs([
        "--locale",
        "EN-US",
        "--risk-class",
        "regulated_data",
        "--gold-entries",
        "/dev/null",
        "--proposed-at",
        "2026-05-11T00:00:00.000Z",
        "--dry-run",
      ]),
    CalibrationRefitOperatorError,
  );
});

test("calibration-refit CLI: rejects unknown risk-class", () => {
  assert.throws(
    () =>
      parseTestIntelligenceCalibrationRefitArgs([
        "--locale",
        "DE-DE",
        "--risk-class",
        "low",
        "--gold-entries",
        "/dev/null",
        "--proposed-at",
        "2026-05-11T00:00:00.000Z",
        "--dry-run",
      ]),
    CalibrationRefitOperatorError,
  );
});

test("calibration-refit CLI: dry-run does not require sign key", () => {
  const opts = parseTestIntelligenceCalibrationRefitArgs([
    "--locale",
    "DE-DE",
    "--risk-class",
    "regulated_data",
    "--gold-entries",
    "/tmp/g.json",
    "--proposed-at",
    "2026-05-11T00:00:00.000Z",
    "--dry-run",
  ]);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.signKeyPath, undefined);
});

test("calibration-refit CLI: ratification requires sign-key + decided-at", () => {
  assert.throws(
    () =>
      parseTestIntelligenceCalibrationRefitArgs([
        "--locale",
        "DE-DE",
        "--risk-class",
        "regulated_data",
        "--gold-entries",
        "/tmp/g.json",
        "--proposed-at",
        "2026-05-11T00:00:00.000Z",
      ]),
    CalibrationRefitOperatorError,
  );
});

test("calibration-refit CLI: HELP text mentions hard rollback safety", () => {
  assert.match(
    TEST_INTELLIGENCE_CALIBRATION_REFIT_HELP,
    /hard rollback safety/i,
  );
});

// ---------------------------------------------------------------------------
// runTestIntelligenceCalibrationRefitCommand — end-to-end happy path
// ---------------------------------------------------------------------------

test("calibration-refit CLI: dry-run writes a proposal record and exits 0", async () => {
  const goldPath = await writeGoldFile(buildSeparableEntries(60));
  const curvesDir = await mkdtemp(join(tmpdir(), "ti-cli-refit-curves-"));
  const sink = collectingSink();
  try {
    const code = await runTestIntelligenceCalibrationRefitCommand(
      {
        locale: "DE-DE",
        riskClass: "regulated_data",
        goldEntriesFile: goldPath,
        curvesDir,
        proposedAt: "2026-05-11T00:00:00.000Z",
        dryRun: true,
        forceRollback: false,
        allowedKeyFingerprints: [],
      },
      sink.sink,
    );
    assert.equal(code, 0);
    assert.equal(sink.stderr, "");
    const summary = JSON.parse(sink.stdout) as {
      readonly proposalId: string;
      readonly rolledBack: boolean;
    };
    assert.equal(typeof summary.proposalId, "string");
    assert.equal(summary.rolledBack, false);
  } finally {
    await rm(goldPath, { recursive: true, force: true });
    await rm(curvesDir, { recursive: true, force: true });
  }
});

test("calibration-refit CLI: ratify path signs the proposal and promotes the curve", async () => {
  const goldPath = await writeGoldFile(buildSeparableEntries(60));
  const curvesDir = await mkdtemp(join(tmpdir(), "ti-cli-refit-curves-"));
  const sink = collectingSink();
  try {
    const code = await runTestIntelligenceCalibrationRefitCommand(
      {
        locale: "DE-DE",
        riskClass: "regulated_data",
        goldEntriesFile: goldPath,
        curvesDir,
        proposedAt: "2026-05-11T00:00:00.000Z",
        dryRun: false,
        forceRollback: false,
        signKeyPath: OPERATOR_KEY_PATH,
        decidedAt: "2026-05-11T01:00:00.000Z",
        allowedKeyFingerprints: [],
      },
      sink.sink,
    );
    assert.equal(code, 0);
    const production = JSON.parse(
      await readFile(join(curvesDir, "DE-DE__regulated_data.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(production.locale, "DE-DE");
    assert.equal(production.riskClass, "regulated_data");
  } finally {
    await rm(goldPath, { recursive: true, force: true });
    await rm(curvesDir, { recursive: true, force: true });
  }
});
