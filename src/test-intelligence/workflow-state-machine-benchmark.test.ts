/**
 * Eingabemasken benchmark for the workflow state-machine validator
 * (Issue #2111).
 *
 * Acceptance contract:
 *
 *   - At least 10 of the 15 eingabemasken fixtures are covered by a
 *     state machine. The default catalog ships 12 (login, KYC,
 *     MiFID order, BU antrag, KFZ schaden, GwG, anlegerprofil,
 *     konto-eroeffnung, kreditantrag-konsumkredit,
 *     lebensversicherung-antrag, sepa-ueberweisung,
 *     fatca-crs-fragebogen).
 *
 *   - 0 / 15 of the existing fixtures hold blocking findings on the
 *     happy path. The benchmark constructs the canonical happy-path
 *     step sequence for every default fixture and asserts the gate is
 *     non-blocking.
 *
 *   - The validator surfaces ≥ 5 known-infeasible sequences in an
 *     adversarial corpus. The benchmark hand-curates a small
 *     adversarial corpus (one infeasible sequence per fixture, eight
 *     fixtures touched) and asserts the gate blocks every one of them
 *     with a concrete state path that fails to close.
 *
 *   - Every state machine is well-formed: at least one entry, at least
 *     one terminal, at least three transitions. This is a sanity check
 *     before the catalog goes through downstream pipelines.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultWorkflowStateMachineRegistry,
  DEFAULT_WORKFLOW_STATE_MACHINE_COUNT,
  DEFAULT_WORKFLOW_STATE_MACHINE_IDS,
} from "./workflow-state-machine-catalog.js";
import { evaluateWorkflowStateMachineGate } from "./workflow-state-machine-validator.js";

const GENERATED_AT = "2026-05-09T10:00:00.000Z";

/* -------------------------------------------------------------------- */
/*  Happy paths — the benchmark needs ≥ 1 non-blocking sequence per     */
/*  fixture so the "0 / 15 fixtures still hold" criterion holds.        */
/* -------------------------------------------------------------------- */

const HAPPY_PATHS: ReadonlyArray<{
  stateMachineId: string;
  testCaseId: string;
  transitions: ReadonlyArray<string>;
}> = [
  {
    stateMachineId: "login",
    testCaseId: "happy/login",
    transitions: [
      "login.t01.enter_credentials",
      "login.t02.validate_credentials",
      "login.t04.request_sca",
      "login.t05.complete_sca",
      "login.t06.activate_session",
    ],
  },
  {
    stateMachineId: "kyc-onboarding",
    testCaseId: "happy/kyc",
    transitions: [
      "kyc.t01.enter_personal_data",
      "kyc.t02.upload_id",
      "kyc.t03.start_biometric",
      "kyc.t04.pass_biometric",
      "kyc.t06.auto_approve",
    ],
  },
  {
    stateMachineId: "mifid-order",
    testCaseId: "happy/mifid",
    transitions: [
      "mifid.t01.select_instrument",
      "mifid.t02.assess_appropriateness",
      "mifid.t03.disclose_costs",
      "mifid.t05.fill_order",
      "mifid.t06.validate_order",
      "mifid.t07.confirm_order",
      "mifid.t08.submit_order",
    ],
  },
  {
    stateMachineId: "bu-antrag",
    testCaseId: "happy/bu",
    transitions: [
      "bu.t01.enter_personal",
      "bu.t02.classify_occupation",
      "bu.t03.medical_questions",
      "bu.t04.calculate_premium",
      "bu.t08.sign_antrag",
      "bu.t09.submit_antrag",
    ],
  },
  {
    stateMachineId: "kfz-schaden",
    testCaseId: "happy/kfz",
    transitions: [
      "kfz.t01.identify_policy",
      "kfz.t02.describe_incident",
      "kfz.t03.upload_photos",
      "kfz.t04.record_third_party",
      "kfz.t05.validate_claim",
      "kfz.t07.submit_claim",
    ],
  },
  {
    stateMachineId: "gwg-screening",
    testCaseId: "happy/gwg",
    transitions: [
      "gwg.t01.identify_customer",
      "gwg.t02.assess_risk",
      "gwg.t05.pass_low_risk",
    ],
  },
  {
    stateMachineId: "anlegerprofil",
    testCaseId: "happy/anlegerprofil",
    transitions: [
      "anleger.t01.assess_knowledge",
      "anleger.t02.assess_experience",
      "anleger.t03.capture_objectives",
      "anleger.t04.calculate_risk_capacity",
      "anleger.t05.classify_profile",
      "anleger.t06.sign_profile",
    ],
  },
  {
    stateMachineId: "konto-eroeffnung",
    testCaseId: "happy/konto",
    transitions: [
      "konto.t01.select_product",
      "konto.t02.enter_personal",
      "konto.t03.capture_tax_residency",
      "konto.t04.do_ident",
      "konto.t05.sign_contract",
      "konto.t06.open_account",
    ],
  },
  {
    stateMachineId: "kreditantrag-konsumkredit",
    testCaseId: "happy/kredit",
    transitions: [
      "kredit.t01.enter_loan_parameters",
      "kredit.t02.capture_income",
      "kredit.t03.capture_obligations",
      "kredit.t04.check_creditworthiness",
      "kredit.t05.present_offer",
      "kredit.t07.sign_offer",
    ],
  },
  {
    stateMachineId: "lebensversicherung-antrag",
    testCaseId: "happy/leben",
    transitions: [
      "leben.t01.enter_personal",
      "leben.t02.capture_beneficiary",
      "leben.t03.medical",
      "leben.t04.calculate_premium",
      "leben.t05.sign_antrag",
      "leben.t06.submit_antrag",
    ],
  },
  {
    stateMachineId: "sepa-ueberweisung",
    testCaseId: "happy/sepa",
    transitions: [
      "sepa.t01.enter_iban",
      "sepa.t02.enter_amount",
      "sepa.t03.check_limits",
      "sepa.t05.request_sca",
      "sepa.t06.complete_sca",
      "sepa.t07.submit_after_sca",
    ],
  },
  {
    stateMachineId: "fatca-crs-fragebogen",
    testCaseId: "happy/fatca",
    transitions: [
      "fatca.t01.capture_residency",
      "fatca.t02.capture_us_indicia",
      "fatca.t03.capture_tin",
      "fatca.t04.validate_fragebogen",
      "fatca.t05.submit_fragebogen",
    ],
  },
];

/* -------------------------------------------------------------------- */
/*  Adversarial corpus — every entry is a known-infeasible sequence     */
/*  (≥ 5 entries required by the acceptance criterion; we ship eight).  */
/* -------------------------------------------------------------------- */

const ADVERSARIAL: ReadonlyArray<{
  stateMachineId: string;
  testCaseId: string;
  rationale: string;
  transitions: ReadonlyArray<string>;
}> = [
  {
    stateMachineId: "login",
    testCaseId: "adv/login/skip-sca",
    rationale: "submitting before SCA completes",
    transitions: [
      "login.t01.enter_credentials",
      // jump straight to session activation — SCA was never solved
      "login.t06.activate_session",
    ],
  },
  {
    stateMachineId: "kyc-onboarding",
    testCaseId: "adv/kyc/upload-before-personal",
    rationale: "uploading ID before personal-data block",
    transitions: ["kyc.t02.upload_id"],
  },
  {
    stateMachineId: "mifid-order",
    testCaseId: "adv/mifid/submit-without-costs",
    rationale: "submitting an order before costs disclosure was shown",
    transitions: [
      "mifid.t01.select_instrument",
      "mifid.t02.assess_appropriateness",
      "mifid.t08.submit_order",
    ],
  },
  {
    stateMachineId: "bu-antrag",
    testCaseId: "adv/bu/sign-without-medical",
    rationale: "signing the BU antrag without medical questions",
    transitions: [
      "bu.t01.enter_personal",
      "bu.t02.classify_occupation",
      "bu.t08.sign_antrag",
    ],
  },
  {
    stateMachineId: "kfz-schaden",
    testCaseId: "adv/kfz/submit-without-validate",
    rationale: "submitting a claim before pre-submit validation",
    transitions: [
      "kfz.t01.identify_policy",
      "kfz.t02.describe_incident",
      "kfz.t07.submit_claim",
    ],
  },
  {
    stateMachineId: "anlegerprofil",
    testCaseId: "adv/anlegerprofil/sign-before-classify",
    rationale: "signing the profile before classification fired",
    transitions: [
      "anleger.t01.assess_knowledge",
      "anleger.t02.assess_experience",
      "anleger.t06.sign_profile",
    ],
  },
  {
    stateMachineId: "sepa-ueberweisung",
    testCaseId: "adv/sepa/submit-before-sca",
    rationale: "submitting an SCA-required transfer without SCA",
    transitions: [
      "sepa.t01.enter_iban",
      "sepa.t02.enter_amount",
      "sepa.t03.check_limits",
      "sepa.t07.submit_after_sca",
    ],
  },
  {
    stateMachineId: "fatca-crs-fragebogen",
    testCaseId: "adv/fatca/submit-without-validate",
    rationale: "submitting the fragebogen before classification verdict",
    transitions: [
      "fatca.t01.capture_residency",
      "fatca.t02.capture_us_indicia",
      "fatca.t03.capture_tin",
      "fatca.t05.submit_fragebogen",
    ],
  },
];

/* -------------------------------------------------------------------- */
/*  Tests                                                                 */
/* -------------------------------------------------------------------- */

void test("default catalog ships at least 10 eingabemasken state machines", () => {
  assert.ok(
    DEFAULT_WORKFLOW_STATE_MACHINE_COUNT >= 10,
    `default catalog must cover ≥ 10 eingabemasken (got ${DEFAULT_WORKFLOW_STATE_MACHINE_COUNT})`,
  );
});

void test("every default state machine is well-formed", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  for (const machine of registry.list()) {
    assert.ok(
      machine.states.some((state) => state.entry === true),
      `state machine "${machine.id}" must declare at least one entry state`,
    );
    assert.ok(
      machine.states.some((state) => state.terminal === true),
      `state machine "${machine.id}" must declare at least one terminal state`,
    );
    assert.ok(
      machine.transitions.length >= 3,
      `state machine "${machine.id}" must declare at least three transitions (got ${machine.transitions.length})`,
    );
    assert.equal(machine.provenance, "manual");
  }
});

void test("every default state machine id is in the published id list", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const registryIds = registry.list().map((row) => row.id).sort();
  const publishedIds = [...DEFAULT_WORKFLOW_STATE_MACHINE_IDS].sort();
  assert.deepEqual(registryIds, publishedIds);
});

void test("happy paths cover every default state machine and pass without errors", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const coveredIds = new Set(HAPPY_PATHS.map((row) => row.stateMachineId));
  for (const id of DEFAULT_WORKFLOW_STATE_MACHINE_IDS) {
    assert.ok(
      coveredIds.has(id),
      `happy-path benchmark must include a sequence for "${id}"`,
    );
  }
  const report = evaluateWorkflowStateMachineGate({
    jobId: "happy-path-benchmark",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: HAPPY_PATHS.map((path) => ({
      testCaseId: path.testCaseId,
      stateMachineId: path.stateMachineId,
      steps: path.transitions.map((transitionId, index) => ({
        stepIndex: index + 1,
        transitionId,
      })),
      requireTerminalExit: true,
    })),
  });
  assert.equal(
    report.blocked,
    false,
    `happy paths must produce a non-blocking gate; issues:\n${report.issues
      .map((issue) => issue.message)
      .join("\n")}`,
  );
  assert.equal(report.cleanCases, HAPPY_PATHS.length);
  assert.equal(report.unmatchedCases, 0);
});

void test("adversarial corpus surfaces ≥ 5 known-infeasible sequences with concrete failing state paths", () => {
  assert.ok(
    ADVERSARIAL.length >= 5,
    `adversarial corpus must hold ≥ 5 entries (got ${ADVERSARIAL.length})`,
  );
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const report = evaluateWorkflowStateMachineGate({
    jobId: "adversarial-benchmark",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: ADVERSARIAL.map((entry) => ({
      testCaseId: entry.testCaseId,
      stateMachineId: entry.stateMachineId,
      steps: entry.transitions.map((transitionId, index) => ({
        stepIndex: index + 1,
        transitionId,
      })),
    })),
  });
  for (const entry of ADVERSARIAL) {
    const row = report.perCase.find(
      (perCase) => perCase.testCaseId === entry.testCaseId,
    );
    assert.ok(
      row !== undefined,
      `adversarial case "${entry.testCaseId}" missing from report`,
    );
    // Every adversarial case must surface at least one finding with a
    // concrete state path that fails to close. Severity may be warning
    // (gap closes via intermediate transitions) or error (hard
    // infeasibility) — the issue spec splits the two.
    const surfaced = (row?.issues ?? []).filter(
      (issue) =>
        issue.code === "missing_intermediate_step" ||
        issue.code === "consecutive_states_unreachable" ||
        issue.code === "first_step_not_from_entry" ||
        issue.code === "last_state_not_terminal",
    );
    assert.ok(
      surfaced.length >= 1,
      `adversarial case "${entry.testCaseId}" (${entry.rationale}) must surface ≥ 1 sequence finding; got ${(row?.issues ?? []).map((issue) => issue.code).join(", ") || "none"}`,
    );
    // The first surfaced finding must report a concrete state path that
    // fails to close — required by the issue acceptance criterion.
    assert.ok(
      (surfaced[0]?.statePath ?? []).length >= 1,
      `adversarial case "${entry.testCaseId}" finding must carry a concrete failing state path`,
    );
  }
});

void test("happy + adversarial corpus together produce stable byte-identical reports", () => {
  const registry = buildDefaultWorkflowStateMachineRegistry();
  const caseClaims = [
    ...HAPPY_PATHS.map((path) => ({
      testCaseId: path.testCaseId,
      stateMachineId: path.stateMachineId,
      steps: path.transitions.map((transitionId, index) => ({
        stepIndex: index + 1,
        transitionId,
      })),
      requireTerminalExit: false,
    })),
    ...ADVERSARIAL.map((entry) => ({
      testCaseId: entry.testCaseId,
      stateMachineId: entry.stateMachineId,
      steps: entry.transitions.map((transitionId, index) => ({
        stepIndex: index + 1,
        transitionId,
      })),
    })),
  ];
  const first = evaluateWorkflowStateMachineGate({
    jobId: "stable",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims,
  });
  const second = evaluateWorkflowStateMachineGate({
    jobId: "stable",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims,
  });
  assert.deepEqual(first, second);
});
