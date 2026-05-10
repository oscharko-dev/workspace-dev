import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  FORMAL_VERIFICATION_REPORT_ARTIFACT_FILENAME,
  FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION,
  FormalSpecParseError,
  FormalVerificationHardGateError,
  G10_FORMAL_VERIFICATION_PASS,
  assertFormalVerificationPass,
  buildFormalVerificationReport,
  renderFormalVerificationReportJson,
  renderFormalVerificationReportText,
  verifyFormalVerificationSpec,
} from "./formal-verification.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const PSD2_SPEC_PATH =
  "src/test-intelligence/formal-verification/specs/psd2-sca-art-97.smv";
const MIFID_SPEC_PATH =
  "src/test-intelligence/formal-verification/specs/mifid-ii-art-25.smv";
const PASSING_FIXTURE_PATH = "fixtures/formal-verification/passing.smv";
const FAILING_FIXTURE_PATH = "fixtures/formal-verification/failing.smv";

const loadSpec = async (rel: string): Promise<{
  specPath: string;
  specSource: string;
}> => ({
  specPath: rel,
  specSource: await readFile(path.join(REPO_ROOT, rel), "utf8"),
});

test("artifact filename + schema version constants are stable", () => {
  assert.equal(
    FORMAL_VERIFICATION_REPORT_ARTIFACT_FILENAME,
    "formal-verification-report.json",
  );
  assert.equal(FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION, "1.0.0");
  assert.equal(G10_FORMAL_VERIFICATION_PASS, "G10_FORMAL_VERIFICATION_PASS");
});

test("passing fixture verifies", async () => {
  const spec = await loadSpec(PASSING_FIXTURE_PATH);
  const result = verifyFormalVerificationSpec(spec);
  assert.equal(result.verdict, "pass");
  assert.equal(result.module, "main");
  assert.ok(result.reachableStateCount > 0);
  for (const f of result.formulae) {
    assert.equal(f.verdict, "pass", `formula failed: ${f.formula}`);
    assert.equal(f.counterexample, undefined);
  }
});

test("PSD2 SCA spec verifies all three properties", async () => {
  const spec = await loadSpec(PSD2_SPEC_PATH);
  const result = verifyFormalVerificationSpec(spec);
  assert.equal(result.verdict, "pass");
  assert.equal(result.formulae.length, 3);
  for (const f of result.formulae) {
    assert.equal(f.verdict, "pass", `PSD2 formula failed: ${f.formula}`);
  }
});

test("MiFID II suitability spec verifies all three properties", async () => {
  const spec = await loadSpec(MIFID_SPEC_PATH);
  const result = verifyFormalVerificationSpec(spec);
  assert.equal(result.verdict, "pass");
  assert.equal(result.formulae.length, 3);
  for (const f of result.formulae) {
    assert.equal(f.verdict, "pass", `MiFID II formula failed: ${f.formula}`);
  }
});

test("failing fixture is detected and reports a counterexample", async () => {
  const spec = await loadSpec(FAILING_FIXTURE_PATH);
  const result = verifyFormalVerificationSpec(spec);
  assert.equal(result.verdict, "fail");
  const failing = result.formulae.find((f) => f.verdict === "fail");
  assert.ok(failing, "expected at least one failing formula");
  assert.ok(failing.counterexample, "expected a counterexample on fail");
  assert.ok(
    failing.counterexample.trace.length >= 1,
    "counterexample trace must include at least the initial state",
  );
  assert.match(failing.counterexample.explanation, /counterexample length/u);
});

test("buildFormalVerificationReport is byte-deterministic for fixed inputs", async () => {
  const specs = await Promise.all([
    loadSpec(PSD2_SPEC_PATH),
    loadSpec(MIFID_SPEC_PATH),
    loadSpec(PASSING_FIXTURE_PATH),
  ]);
  const a = buildFormalVerificationReport({
    specs,
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  const b = buildFormalVerificationReport({
    specs,
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  assert.equal(
    renderFormalVerificationReportJson(a),
    renderFormalVerificationReportJson(b),
  );
});

test("buildFormalVerificationReport sorts specs alphabetically by specPath", async () => {
  const specs = [
    await loadSpec(MIFID_SPEC_PATH),
    await loadSpec(PSD2_SPEC_PATH),
    await loadSpec(PASSING_FIXTURE_PATH),
  ];
  const report = buildFormalVerificationReport({
    specs,
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  const orderedPaths = report.specs.map((s) => s.specPath);
  const sortedPaths = [...orderedPaths].sort((x, y) => x.localeCompare(y));
  assert.deepEqual(orderedPaths, sortedPaths);
});

test("report summary matches per-formula totals", async () => {
  const specs = await Promise.all([
    loadSpec(PSD2_SPEC_PATH),
    loadSpec(MIFID_SPEC_PATH),
  ]);
  const report = buildFormalVerificationReport({
    specs,
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  assert.equal(report.summary.specCount, 2);
  let totalFormulae = 0;
  let totalPass = 0;
  let totalFail = 0;
  for (const spec of report.specs) {
    totalFormulae += spec.formulae.length;
    for (const f of spec.formulae) {
      if (f.verdict === "pass") totalPass += 1;
      else totalFail += 1;
    }
  }
  assert.equal(report.summary.formulaCount, totalFormulae);
  assert.equal(report.summary.passCount, totalPass);
  assert.equal(report.summary.failCount, totalFail);
  assert.equal(report.summary.verdict, totalFail === 0 ? "pass" : "fail");
});

test("assertFormalVerificationPass throws when any formula fails", async () => {
  const failingSpec = await loadSpec(FAILING_FIXTURE_PATH);
  const report = buildFormalVerificationReport({
    specs: [failingSpec],
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  assert.throws(
    () => assertFormalVerificationPass(report),
    (err: unknown): err is FormalVerificationHardGateError =>
      err instanceof FormalVerificationHardGateError &&
      err.code === G10_FORMAL_VERIFICATION_PASS &&
      err.failures.length >= 1,
  );
});

test("assertFormalVerificationPass is a no-op when verdict is pass", async () => {
  const passingSpec = await loadSpec(PASSING_FIXTURE_PATH);
  const report = buildFormalVerificationReport({
    specs: [passingSpec],
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  assert.doesNotThrow(() => assertFormalVerificationPass(report));
});

test("renderFormalVerificationReportText includes per-spec verdict header", async () => {
  const specs = await Promise.all([
    loadSpec(PSD2_SPEC_PATH),
    loadSpec(MIFID_SPEC_PATH),
  ]);
  const report = buildFormalVerificationReport({
    specs,
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  const text = renderFormalVerificationReportText(report);
  assert.match(text, /formal-verification PASS/u);
  assert.match(text, new RegExp(PSD2_SPEC_PATH.replace(/[/.-]/gu, "[/.-]")));
  assert.match(text, new RegExp(MIFID_SPEC_PATH.replace(/[/.-]/gu, "[/.-]")));
});

test("parser rejects an empty spec", () => {
  assert.throws(
    () =>
      verifyFormalVerificationSpec({
        specPath: "empty.smv",
        specSource: "",
      }),
    (err: unknown) => err instanceof FormalSpecParseError,
  );
});

test("parser rejects a spec missing LTLSPEC / CTLSPEC", () => {
  const source = `MODULE main
VAR state : { a, b };
ASSIGN
  init(state) := a;
  next(state) := case
    state = a : b;
    state = b : a;
    TRUE      : state;
  esac;
`;
  assert.throws(
    () =>
      verifyFormalVerificationSpec({
        specPath: "no-formulae.smv",
        specSource: source,
      }),
    /no LTLSPEC \/ CTLSPEC/u,
  );
});

test("parser supports CTLSPEC with AG / AF operators", () => {
  const source = `MODULE main
VAR state : { a, b };
ASSIGN
  init(state) := a;
  next(state) := case
    state = a : b;
    state = b : b;
    TRUE      : state;
  esac;
CTLSPEC AG ( state = a -> AF state = b )
`;
  const result = verifyFormalVerificationSpec({
    specPath: "ctlspec.smv",
    specSource: source,
  });
  assert.equal(result.verdict, "pass");
});

test("parser supports CTLSPEC with E[...U...] / A[...U...]", () => {
  const source = `MODULE main
VAR state : { a, b, c };
ASSIGN
  init(state) := a;
  next(state) := case
    state = a : b;
    state = b : c;
    state = c : c;
    TRUE      : state;
  esac;
CTLSPEC A [ state != c U state = c ]
`;
  const result = verifyFormalVerificationSpec({
    specPath: "ctl-until.smv",
    specSource: source,
  });
  assert.equal(result.verdict, "pass");
});

test("counterexample trace contains valid reachable states", async () => {
  const failingSpec = await loadSpec(FAILING_FIXTURE_PATH);
  const result = verifyFormalVerificationSpec(failingSpec);
  const failing = result.formulae.find((f) => f.verdict === "fail");
  assert.ok(failing && failing.counterexample);
  for (const state of failing.counterexample.trace) {
    assert.ok(typeof state.id === "string" && state.id.length > 0);
    assert.ok(Object.keys(state.valuation).length > 0);
  }
});

test("spec source SHA-256 is exposed in the per-spec result", async () => {
  const spec = await loadSpec(PASSING_FIXTURE_PATH);
  const result = verifyFormalVerificationSpec(spec);
  assert.match(result.specSha256, /^[0-9a-f]{64}$/u);
});

test("spec exceeding max bytes is rejected at parse time", () => {
  const huge = `MODULE main\nVAR x : { a };\nASSIGN init(x) := a;\nLTLSPEC G x = a\n${"-- pad\n".repeat(20000)}`;
  assert.throws(
    () =>
      verifyFormalVerificationSpec({
        specPath: "huge.smv",
        specSource: huge,
      }),
    /exceeds max size/u,
  );
});

test("parser rejects DEFINE (reserved but unsupported in pilot)", () => {
  const source = `MODULE main
VAR x : { a, b };
DEFINE p := x = a;
ASSIGN init(x) := a;
  next(x) := x;
LTLSPEC G p
`;
  assert.throws(
    () =>
      verifyFormalVerificationSpec({
        specPath: "with-define.smv",
        specSource: source,
      }),
    /DEFINE sections are not supported/u,
  );
});

test("LTL formula with X operator translates to AX under CTL semantics", () => {
  const source = `MODULE main
VAR state : { a, b };
ASSIGN
  init(state) := a;
  next(state) := case
    state = a : b;
    state = b : b;
    TRUE      : state;
  esac;
LTLSPEC G ( state = a -> X state = b )
`;
  const result = verifyFormalVerificationSpec({
    specPath: "ltl-x.smv",
    specSource: source,
  });
  assert.equal(result.verdict, "pass");
});

test("ranged-integer variables are accepted and bounded", () => {
  const source = `MODULE main
VAR
  counter : 0 .. 2;
  state   : { a, b };
ASSIGN
  init(state)   := a;
  init(counter) := 0;
  next(state) := case
    state = a : b;
    state = b : b;
    TRUE      : state;
  esac;
  next(counter) := case
    state = a & counter < 2 : counter + 1;
    TRUE                    : counter;
  esac;
LTLSPEC G ( state = b -> counter >= 0 )
`;
  const result = verifyFormalVerificationSpec({
    specPath: "ranged.smv",
    specSource: source,
  });
  assert.equal(result.verdict, "pass");
});

test("renderFormalVerificationReportJson emits canonical newline-terminated JSON", async () => {
  const spec = await loadSpec(PASSING_FIXTURE_PATH);
  const report = buildFormalVerificationReport({
    specs: [spec],
    generatedAt: "2026-05-10T00:00:00.000Z",
  });
  const json = renderFormalVerificationReportJson(report);
  assert.equal(json.at(-1), "\n");
  const parsed = JSON.parse(json) as { schemaVersion: string };
  assert.equal(parsed.schemaVersion, FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION);
});

test("buildFormalVerificationReport rejects malformed generatedAt", async () => {
  const spec = await loadSpec(PASSING_FIXTURE_PATH);
  assert.throws(
    () =>
      buildFormalVerificationReport({
        specs: [spec],
        generatedAt: "not-an-iso-timestamp",
      }),
    /generatedAt must be an ISO-8601 timestamp/u,
  );
});
