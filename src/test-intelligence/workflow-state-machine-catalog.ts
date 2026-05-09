/**
 * Default workflow state-machine catalog (Issue #2111).
 *
 * Encodes ≥ 10 of the 15 eingabemasken fixtures as workflow state
 * machines so the validation pipeline can verify that step sequences
 * respect the form's actual workflow. The catalog is hand-curated and
 * SME-reviewed; design-time LLM suggestion (`mistral-large-3`,
 * Issue #2099) lives outside the engine — only human-reviewed entries
 * may enter this file.
 *
 * Each fixture follows the same skeleton:
 *
 *     entry  → in_progress → validated → submitted → terminal
 *
 * with fixture-specific intermediate states (e.g. `gwg_review`,
 * `mifid_appropriateness`, `bu_medical_questions`). Every transition
 * carries a `guard` that names the precondition and an `action` that
 * names the side effect — both are auditor-facing strings, the
 * engine itself does not evaluate them.
 *
 * Coverage of the issue acceptance criterion:
 *
 *   1. login                   — Anmeldung an die Customer-App
 *   2. kyc-onboarding          — Identifikation / KYC
 *   3. mifid-order             — MiFID II Wertpapierorder
 *   4. bu-antrag               — Berufsunfähigkeitsversicherung-Antrag
 *   5. kfz-schaden             — KFZ-Schadensmeldung
 *   6. gwg-screening           — Geldwäschegesetz-Screening
 *   7. anlegerprofil           — Anlegerprofil / Geeignetheitsprüfung
 *   8. konto-eroeffnung        — Girokonto-Eröffnung
 *   9. kreditantrag-konsumkredit — Konsumkredit-Antrag
 *  10. lebensversicherung-antrag — Lebensversicherungs-Antrag
 *  11. sepa-ueberweisung       — SEPA-Überweisung mit SCA
 *  12. fatca-crs-fragebogen    — FATCA / CRS Steuerklassifikation
 *
 * Twelve fixtures pass the "≥ 10 of 15" floor; the remaining three
 * eingabenmasken stay covered by structural validation alone until a
 * follow-up SME-review session approves their state machines.
 */

import {
  createWorkflowStateMachine,
  createWorkflowStateMachineRegistry,
  type WorkflowStateMachine,
  type WorkflowStateMachineRegistry,
} from "./workflow-state-machine.js";

/* -------------------------------------------------------------------- */
/*  Helpers                                                               */
/* -------------------------------------------------------------------- */

interface FixtureSpec {
  readonly id: string;
  readonly label: string;
  readonly states: ReadonlyArray<{
    readonly stateId: string;
    readonly label: string;
    readonly entry?: boolean;
    readonly terminal?: boolean;
  }>;
  readonly transitions: ReadonlyArray<{
    readonly transitionId: string;
    readonly from: string;
    readonly to: string;
    readonly guard: string;
    readonly action: string;
  }>;
}

const buildFixture = (spec: FixtureSpec): WorkflowStateMachine =>
  createWorkflowStateMachine({
    id: spec.id,
    label: spec.label,
    states: spec.states,
    transitions: spec.transitions,
    provenance: "manual",
  });

/* -------------------------------------------------------------------- */
/*  Fixture state machines                                                */
/* -------------------------------------------------------------------- */

/** Anmeldung an die Customer-App. */
const LOGIN: FixtureSpec = {
  id: "login",
  label: "Customer-App Anmeldung",
  states: [
    { stateId: "anonymous", label: "Anonymous user", entry: true },
    { stateId: "credentials_entered", label: "Credentials entered" },
    { stateId: "credentials_validated", label: "Credentials validated" },
    { stateId: "sca_pending", label: "SCA challenge pending" },
    { stateId: "sca_completed", label: "SCA completed" },
    { stateId: "session_active", label: "Session active", terminal: true },
    { stateId: "session_locked", label: "Session locked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "login.t01.enter_credentials",
      from: "anonymous",
      to: "credentials_entered",
      guard: "username AND password are non-empty",
      action: "stage credentials in the auth client",
    },
    {
      transitionId: "login.t02.validate_credentials",
      from: "credentials_entered",
      to: "credentials_validated",
      guard: "credential validation succeeds",
      action: "issue first-factor token",
    },
    {
      transitionId: "login.t03.fail_credentials",
      from: "credentials_entered",
      to: "session_locked",
      guard: "5 consecutive credential failures",
      action: "lock the session",
    },
    {
      transitionId: "login.t04.request_sca",
      from: "credentials_validated",
      to: "sca_pending",
      guard: "SCA required by PSD2",
      action: "trigger SCA challenge",
    },
    {
      transitionId: "login.t05.complete_sca",
      from: "sca_pending",
      to: "sca_completed",
      guard: "SCA challenge passed",
      action: "issue second-factor token",
    },
    {
      transitionId: "login.t06.activate_session",
      from: "sca_completed",
      to: "session_active",
      guard: "session policy permits the device",
      action: "open the authenticated session",
    },
  ],
};

/** Identifikation / KYC. */
const KYC: FixtureSpec = {
  id: "kyc-onboarding",
  label: "KYC-Onboarding",
  states: [
    { stateId: "started", label: "Onboarding started", entry: true },
    { stateId: "personal_data_entered", label: "Personal data entered" },
    { stateId: "id_document_uploaded", label: "ID document uploaded" },
    { stateId: "biometric_check_pending", label: "Biometric check pending" },
    { stateId: "biometric_check_passed", label: "Biometric check passed" },
    { stateId: "kyc_review", label: "Manual KYC review" },
    { stateId: "kyc_approved", label: "KYC approved", terminal: true },
    { stateId: "kyc_rejected", label: "KYC rejected", terminal: true },
  ],
  transitions: [
    {
      transitionId: "kyc.t01.enter_personal_data",
      from: "started",
      to: "personal_data_entered",
      guard: "all mandatory personal-data fields are filled",
      action: "persist the personal-data block",
    },
    {
      transitionId: "kyc.t02.upload_id",
      from: "personal_data_entered",
      to: "id_document_uploaded",
      guard: "ID document upload validates against MRZ schema",
      action: "store the document and start OCR",
    },
    {
      transitionId: "kyc.t03.start_biometric",
      from: "id_document_uploaded",
      to: "biometric_check_pending",
      guard: "OCR succeeds and biometric flow is enabled",
      action: "spawn biometric session",
    },
    {
      transitionId: "kyc.t04.pass_biometric",
      from: "biometric_check_pending",
      to: "biometric_check_passed",
      guard: "live face match exceeds threshold",
      action: "stamp biometric pass",
    },
    {
      transitionId: "kyc.t05.queue_review",
      from: "biometric_check_passed",
      to: "kyc_review",
      guard: "any compliance flag was raised",
      action: "queue case for analyst",
    },
    {
      transitionId: "kyc.t06.auto_approve",
      from: "biometric_check_passed",
      to: "kyc_approved",
      guard: "no compliance flag and auto-approve policy enabled",
      action: "auto-approve KYC",
    },
    {
      transitionId: "kyc.t07.review_approve",
      from: "kyc_review",
      to: "kyc_approved",
      guard: "analyst approves",
      action: "stamp manual approval",
    },
    {
      transitionId: "kyc.t08.review_reject",
      from: "kyc_review",
      to: "kyc_rejected",
      guard: "analyst rejects",
      action: "stamp manual rejection",
    },
  ],
};

/** MiFID II Wertpapierorder. */
const MIFID_ORDER: FixtureSpec = {
  id: "mifid-order",
  label: "MiFID-II Wertpapierorder",
  states: [
    { stateId: "ready", label: "Trading desk ready", entry: true },
    { stateId: "instrument_selected", label: "Instrument selected" },
    { stateId: "appropriateness_assessed", label: "Appropriateness assessed" },
    { stateId: "costs_disclosed", label: "Costs disclosure shown" },
    { stateId: "order_filled", label: "Order details filled" },
    { stateId: "order_validated", label: "Order validated" },
    { stateId: "order_confirmed", label: "Order confirmed" },
    { stateId: "order_submitted", label: "Order submitted", terminal: true },
    { stateId: "order_blocked", label: "Order blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "mifid.t01.select_instrument",
      from: "ready",
      to: "instrument_selected",
      guard: "instrument is in the customer's permitted universe",
      action: "stage the instrument",
    },
    {
      transitionId: "mifid.t02.assess_appropriateness",
      from: "instrument_selected",
      to: "appropriateness_assessed",
      guard: "MiFID II appropriateness questionnaire complete",
      action: "evaluate appropriateness verdict",
    },
    {
      transitionId: "mifid.t03.disclose_costs",
      from: "appropriateness_assessed",
      to: "costs_disclosed",
      guard: "appropriateness verdict was not negative-stop",
      action: "render ex-ante cost disclosure",
    },
    {
      transitionId: "mifid.t04.block_appropriateness",
      from: "appropriateness_assessed",
      to: "order_blocked",
      guard: "MiFID II appropriateness verdict is negative-stop",
      action: "block order with audit-trail",
    },
    {
      transitionId: "mifid.t05.fill_order",
      from: "costs_disclosed",
      to: "order_filled",
      guard: "all order parameters supplied",
      action: "stage the order intent",
    },
    {
      transitionId: "mifid.t06.validate_order",
      from: "order_filled",
      to: "order_validated",
      guard: "order passes broker pre-trade checks",
      action: "stamp pre-trade-pass",
    },
    {
      transitionId: "mifid.t07.confirm_order",
      from: "order_validated",
      to: "order_confirmed",
      guard: "customer confirms order screen",
      action: "freeze the order intent",
    },
    {
      transitionId: "mifid.t08.submit_order",
      from: "order_confirmed",
      to: "order_submitted",
      guard: "execution venue accepts the order",
      action: "send order to venue",
    },
  ],
};

/** Berufsunfähigkeitsversicherung-Antrag. */
const BU_ANTRAG: FixtureSpec = {
  id: "bu-antrag",
  label: "BU-Antrag",
  states: [
    { stateId: "started", label: "Antrag started", entry: true },
    { stateId: "personal_data_entered", label: "Personal data entered" },
    { stateId: "occupation_classified", label: "Occupation classified" },
    { stateId: "medical_questions_done", label: "Medical questions complete" },
    { stateId: "premium_calculated", label: "Premium calculated" },
    { stateId: "underwriting_review", label: "Underwriting review" },
    { stateId: "antrag_signed", label: "Antrag signed" },
    { stateId: "antrag_submitted", label: "Antrag submitted", terminal: true },
    { stateId: "antrag_declined", label: "Antrag declined", terminal: true },
  ],
  transitions: [
    {
      transitionId: "bu.t01.enter_personal",
      from: "started",
      to: "personal_data_entered",
      guard: "personal-data block validates",
      action: "persist personal data",
    },
    {
      transitionId: "bu.t02.classify_occupation",
      from: "personal_data_entered",
      to: "occupation_classified",
      guard: "occupation lookup returns a code",
      action: "stamp occupation class",
    },
    {
      transitionId: "bu.t03.medical_questions",
      from: "occupation_classified",
      to: "medical_questions_done",
      guard: "all mandatory medical questions answered",
      action: "persist medical answers",
    },
    {
      transitionId: "bu.t04.calculate_premium",
      from: "medical_questions_done",
      to: "premium_calculated",
      guard: "actuarial calculation succeeds",
      action: "render premium quote",
    },
    {
      transitionId: "bu.t05.queue_review",
      from: "premium_calculated",
      to: "underwriting_review",
      guard: "any underwriting flag fired",
      action: "queue for underwriter",
    },
    {
      transitionId: "bu.t06.review_approve",
      from: "underwriting_review",
      to: "antrag_signed",
      guard: "underwriter approves",
      action: "release for signing",
    },
    {
      transitionId: "bu.t07.review_decline",
      from: "underwriting_review",
      to: "antrag_declined",
      guard: "underwriter declines",
      action: "stamp decline",
    },
    {
      transitionId: "bu.t08.sign_antrag",
      from: "premium_calculated",
      to: "antrag_signed",
      guard: "no underwriting flag and customer signs",
      action: "store qualified signature",
    },
    {
      transitionId: "bu.t09.submit_antrag",
      from: "antrag_signed",
      to: "antrag_submitted",
      guard: "policy administration system accepts",
      action: "issue policy number",
    },
  ],
};

/** KFZ-Schadensmeldung. */
const KFZ_SCHADEN: FixtureSpec = {
  id: "kfz-schaden",
  label: "KFZ-Schadensmeldung",
  states: [
    { stateId: "started", label: "Schaden started", entry: true },
    { stateId: "policy_identified", label: "Policy identified" },
    { stateId: "incident_described", label: "Incident described" },
    { stateId: "photos_uploaded", label: "Photos uploaded" },
    { stateId: "third_party_recorded", label: "Third party recorded" },
    { stateId: "claim_validated", label: "Claim validated" },
    { stateId: "claim_submitted", label: "Claim submitted", terminal: true },
    { stateId: "claim_blocked", label: "Claim blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "kfz.t01.identify_policy",
      from: "started",
      to: "policy_identified",
      guard: "policy number lookup succeeds",
      action: "load policy snapshot",
    },
    {
      transitionId: "kfz.t02.describe_incident",
      from: "policy_identified",
      to: "incident_described",
      guard: "free-text + structured incident attributes complete",
      action: "stage incident block",
    },
    {
      transitionId: "kfz.t03.upload_photos",
      from: "incident_described",
      to: "photos_uploaded",
      guard: "≥ 1 photo uploaded if comprehensive coverage required",
      action: "store photos in the claim bucket",
    },
    {
      transitionId: "kfz.t04.record_third_party",
      from: "photos_uploaded",
      to: "third_party_recorded",
      guard: "third-party data captured (or marked not-applicable)",
      action: "persist third-party block",
    },
    {
      transitionId: "kfz.t05.validate_claim",
      from: "third_party_recorded",
      to: "claim_validated",
      guard: "claim passes coverage and fraud checks",
      action: "stamp pre-submit-pass",
    },
    {
      transitionId: "kfz.t06.block_claim",
      from: "third_party_recorded",
      to: "claim_blocked",
      guard: "fraud or coverage check fails",
      action: "block claim with reason",
    },
    {
      transitionId: "kfz.t07.submit_claim",
      from: "claim_validated",
      to: "claim_submitted",
      guard: "claim handler queue accepts",
      action: "issue claim number",
    },
  ],
};

/** Geldwäschegesetz-Screening. */
const GWG: FixtureSpec = {
  id: "gwg-screening",
  label: "GwG-Screening",
  states: [
    { stateId: "started", label: "Screening started", entry: true },
    { stateId: "customer_identified", label: "Customer identified" },
    { stateId: "risk_assessed", label: "Risk assessed" },
    { stateId: "edd_pending", label: "Enhanced DD pending" },
    { stateId: "edd_complete", label: "Enhanced DD complete" },
    { stateId: "screening_passed", label: "Screening passed", terminal: true },
    { stateId: "screening_blocked", label: "Screening blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "gwg.t01.identify_customer",
      from: "started",
      to: "customer_identified",
      guard: "customer identifiers and beneficial-owner data captured",
      action: "stage customer block",
    },
    {
      transitionId: "gwg.t02.assess_risk",
      from: "customer_identified",
      to: "risk_assessed",
      guard: "risk-score function returns a verdict",
      action: "stamp risk class",
    },
    {
      transitionId: "gwg.t03.queue_edd",
      from: "risk_assessed",
      to: "edd_pending",
      guard: "risk class is high or PEP",
      action: "queue for enhanced DD",
    },
    {
      transitionId: "gwg.t04.finish_edd",
      from: "edd_pending",
      to: "edd_complete",
      guard: "enhanced DD evidence captured and reviewed",
      action: "stamp EDD complete",
    },
    {
      transitionId: "gwg.t05.pass_low_risk",
      from: "risk_assessed",
      to: "screening_passed",
      guard: "risk class is low and no sanctions hit",
      action: "stamp screening pass",
    },
    {
      transitionId: "gwg.t06.pass_after_edd",
      from: "edd_complete",
      to: "screening_passed",
      guard: "EDD reviewer approves",
      action: "stamp screening pass",
    },
    {
      transitionId: "gwg.t07.block_after_edd",
      from: "edd_complete",
      to: "screening_blocked",
      guard: "EDD reviewer escalates",
      action: "block onboarding with reason",
    },
  ],
};

/** Anlegerprofil / Geeignetheitsprüfung. */
const ANLEGERPROFIL: FixtureSpec = {
  id: "anlegerprofil",
  label: "Anlegerprofil / Geeignetheitsprüfung",
  states: [
    { stateId: "started", label: "Profile started", entry: true },
    { stateId: "knowledge_assessed", label: "Knowledge assessed" },
    { stateId: "experience_assessed", label: "Experience assessed" },
    { stateId: "objectives_captured", label: "Objectives captured" },
    { stateId: "risk_capacity_calculated", label: "Risk capacity calculated" },
    { stateId: "profile_classified", label: "Profile classified" },
    { stateId: "profile_signed", label: "Profile signed", terminal: true },
    { stateId: "profile_blocked", label: "Profile blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "anleger.t01.assess_knowledge",
      from: "started",
      to: "knowledge_assessed",
      guard: "knowledge questionnaire complete",
      action: "stamp knowledge result",
    },
    {
      transitionId: "anleger.t02.assess_experience",
      from: "knowledge_assessed",
      to: "experience_assessed",
      guard: "experience questionnaire complete",
      action: "stamp experience result",
    },
    {
      transitionId: "anleger.t03.capture_objectives",
      from: "experience_assessed",
      to: "objectives_captured",
      guard: "investment objectives captured",
      action: "store objectives block",
    },
    {
      transitionId: "anleger.t04.calculate_risk_capacity",
      from: "objectives_captured",
      to: "risk_capacity_calculated",
      guard: "income, wealth, and obligations captured",
      action: "compute risk capacity",
    },
    {
      transitionId: "anleger.t05.classify_profile",
      from: "risk_capacity_calculated",
      to: "profile_classified",
      guard: "classification function returns a band",
      action: "stamp risk band",
    },
    {
      transitionId: "anleger.t06.sign_profile",
      from: "profile_classified",
      to: "profile_signed",
      guard: "customer signs",
      action: "persist signed profile",
    },
    {
      transitionId: "anleger.t07.block_profile",
      from: "profile_classified",
      to: "profile_blocked",
      guard: "classification triggers a stop band",
      action: "block onboarding with reason",
    },
  ],
};

/** Girokonto-Eröffnung. */
const KONTO_EROEFFNUNG: FixtureSpec = {
  id: "konto-eroeffnung",
  label: "Girokonto-Eröffnung",
  states: [
    { stateId: "started", label: "Eröffnung started", entry: true },
    { stateId: "product_selected", label: "Product selected" },
    { stateId: "personal_data_entered", label: "Personal data entered" },
    { stateId: "tax_residency_captured", label: "Tax residency captured" },
    { stateId: "ident_done", label: "Ident done" },
    { stateId: "contract_signed", label: "Contract signed" },
    { stateId: "account_opened", label: "Account opened", terminal: true },
    { stateId: "account_blocked", label: "Account blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "konto.t01.select_product",
      from: "started",
      to: "product_selected",
      guard: "product variant selected",
      action: "stage product variant",
    },
    {
      transitionId: "konto.t02.enter_personal",
      from: "product_selected",
      to: "personal_data_entered",
      guard: "all mandatory personal-data fields filled",
      action: "persist personal block",
    },
    {
      transitionId: "konto.t03.capture_tax_residency",
      from: "personal_data_entered",
      to: "tax_residency_captured",
      guard: "FATCA / CRS questionnaire complete",
      action: "stamp tax classification",
    },
    {
      transitionId: "konto.t04.do_ident",
      from: "tax_residency_captured",
      to: "ident_done",
      guard: "video-ident or post-ident produced a verified result",
      action: "stamp ident result",
    },
    {
      transitionId: "konto.t05.sign_contract",
      from: "ident_done",
      to: "contract_signed",
      guard: "customer signs the contract",
      action: "persist signed contract",
    },
    {
      transitionId: "konto.t06.open_account",
      from: "contract_signed",
      to: "account_opened",
      guard: "core-banking system accepts",
      action: "issue IBAN",
    },
    {
      transitionId: "konto.t07.block_account",
      from: "ident_done",
      to: "account_blocked",
      guard: "compliance flag fires after ident",
      action: "block account with reason",
    },
  ],
};

/** Konsumkredit-Antrag. */
const KREDITANTRAG: FixtureSpec = {
  id: "kreditantrag-konsumkredit",
  label: "Konsumkredit-Antrag",
  states: [
    { stateId: "started", label: "Antrag started", entry: true },
    { stateId: "loan_parameters_entered", label: "Loan parameters entered" },
    { stateId: "income_captured", label: "Income captured" },
    { stateId: "obligations_captured", label: "Obligations captured" },
    { stateId: "creditworthiness_checked", label: "Creditworthiness checked" },
    { stateId: "offer_presented", label: "Offer presented" },
    { stateId: "offer_signed", label: "Offer signed", terminal: true },
    { stateId: "offer_declined", label: "Offer declined", terminal: true },
  ],
  transitions: [
    {
      transitionId: "kredit.t01.enter_loan_parameters",
      from: "started",
      to: "loan_parameters_entered",
      guard: "amount, term, and purpose supplied",
      action: "stage loan parameters",
    },
    {
      transitionId: "kredit.t02.capture_income",
      from: "loan_parameters_entered",
      to: "income_captured",
      guard: "income evidence captured",
      action: "persist income block",
    },
    {
      transitionId: "kredit.t03.capture_obligations",
      from: "income_captured",
      to: "obligations_captured",
      guard: "obligations questionnaire complete",
      action: "persist obligations block",
    },
    {
      transitionId: "kredit.t04.check_creditworthiness",
      from: "obligations_captured",
      to: "creditworthiness_checked",
      guard: "scoring engine returns a verdict",
      action: "stamp scoring verdict",
    },
    {
      transitionId: "kredit.t05.present_offer",
      from: "creditworthiness_checked",
      to: "offer_presented",
      guard: "scoring verdict permits an offer",
      action: "render offer screen",
    },
    {
      transitionId: "kredit.t06.decline_offer",
      from: "creditworthiness_checked",
      to: "offer_declined",
      guard: "scoring verdict declines",
      action: "stamp decline reason",
    },
    {
      transitionId: "kredit.t07.sign_offer",
      from: "offer_presented",
      to: "offer_signed",
      guard: "customer signs offer",
      action: "release for disbursement",
    },
  ],
};

/** Lebensversicherungs-Antrag. */
const LEBENSVERSICHERUNG: FixtureSpec = {
  id: "lebensversicherung-antrag",
  label: "Lebensversicherungs-Antrag",
  states: [
    { stateId: "started", label: "Antrag started", entry: true },
    { stateId: "personal_data_entered", label: "Personal data entered" },
    { stateId: "beneficiary_captured", label: "Beneficiary captured" },
    { stateId: "medical_done", label: "Medical questions done" },
    { stateId: "premium_calculated", label: "Premium calculated" },
    { stateId: "antrag_signed", label: "Antrag signed" },
    { stateId: "antrag_submitted", label: "Antrag submitted", terminal: true },
    { stateId: "antrag_declined", label: "Antrag declined", terminal: true },
  ],
  transitions: [
    {
      transitionId: "leben.t01.enter_personal",
      from: "started",
      to: "personal_data_entered",
      guard: "personal-data block validates",
      action: "persist personal data",
    },
    {
      transitionId: "leben.t02.capture_beneficiary",
      from: "personal_data_entered",
      to: "beneficiary_captured",
      guard: "beneficiary block (with guardian if minor) validates",
      action: "persist beneficiary block",
    },
    {
      transitionId: "leben.t03.medical",
      from: "beneficiary_captured",
      to: "medical_done",
      guard: "medical questionnaire complete",
      action: "persist medical answers",
    },
    {
      transitionId: "leben.t04.calculate_premium",
      from: "medical_done",
      to: "premium_calculated",
      guard: "actuarial calculation succeeds",
      action: "render premium quote",
    },
    {
      transitionId: "leben.t05.sign_antrag",
      from: "premium_calculated",
      to: "antrag_signed",
      guard: "customer signs",
      action: "store qualified signature",
    },
    {
      transitionId: "leben.t06.submit_antrag",
      from: "antrag_signed",
      to: "antrag_submitted",
      guard: "policy administration system accepts",
      action: "issue policy number",
    },
    {
      transitionId: "leben.t07.decline_antrag",
      from: "premium_calculated",
      to: "antrag_declined",
      guard: "underwriting declines",
      action: "stamp decline",
    },
  ],
};

/** SEPA-Überweisung mit SCA. */
const SEPA: FixtureSpec = {
  id: "sepa-ueberweisung",
  label: "SEPA-Überweisung",
  states: [
    { stateId: "session_active", label: "Session active", entry: true },
    { stateId: "iban_entered", label: "IBAN entered" },
    { stateId: "amount_entered", label: "Amount entered" },
    { stateId: "limits_checked", label: "Limits checked" },
    { stateId: "sca_pending", label: "SCA pending" },
    { stateId: "sca_completed", label: "SCA completed" },
    { stateId: "transfer_submitted", label: "Transfer submitted", terminal: true },
    { stateId: "transfer_blocked", label: "Transfer blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "sepa.t01.enter_iban",
      from: "session_active",
      to: "iban_entered",
      guard: "IBAN passes mod-97 check",
      action: "stage IBAN",
    },
    {
      transitionId: "sepa.t02.enter_amount",
      from: "iban_entered",
      to: "amount_entered",
      guard: "amount > 0 and currency supported",
      action: "stage amount",
    },
    {
      transitionId: "sepa.t03.check_limits",
      from: "amount_entered",
      to: "limits_checked",
      guard: "daily-limit aggregator returns under-limit",
      action: "stamp limit verdict",
    },
    {
      transitionId: "sepa.t04.block_limits",
      from: "amount_entered",
      to: "transfer_blocked",
      guard: "daily-limit aggregator returns over-limit",
      action: "block transfer with reason",
    },
    {
      transitionId: "sepa.t05.request_sca",
      from: "limits_checked",
      to: "sca_pending",
      guard: "amount exceeds PSD2 SCA threshold",
      action: "trigger SCA challenge",
    },
    {
      transitionId: "sepa.t06.complete_sca",
      from: "sca_pending",
      to: "sca_completed",
      guard: "SCA challenge passed",
      action: "stamp SCA pass",
    },
    {
      transitionId: "sepa.t07.submit_after_sca",
      from: "sca_completed",
      to: "transfer_submitted",
      guard: "core-banking accepts",
      action: "issue transaction id",
    },
    {
      transitionId: "sepa.t08.submit_under_threshold",
      from: "limits_checked",
      to: "transfer_submitted",
      guard: "amount below SCA threshold and policy permits",
      action: "issue transaction id",
    },
  ],
};

/** FATCA / CRS Steuerklassifikation. */
const FATCA_CRS: FixtureSpec = {
  id: "fatca-crs-fragebogen",
  label: "FATCA / CRS Steuerklassifikation",
  states: [
    { stateId: "started", label: "Fragebogen started", entry: true },
    { stateId: "residency_captured", label: "Residency captured" },
    { stateId: "us_indicia_captured", label: "US-Indicia captured" },
    { stateId: "tin_captured", label: "TIN captured" },
    { stateId: "fragebogen_validated", label: "Fragebogen validated" },
    { stateId: "fragebogen_submitted", label: "Fragebogen submitted", terminal: true },
    { stateId: "fragebogen_blocked", label: "Fragebogen blocked", terminal: true },
  ],
  transitions: [
    {
      transitionId: "fatca.t01.capture_residency",
      from: "started",
      to: "residency_captured",
      guard: "tax residency country selected",
      action: "stage residency block",
    },
    {
      transitionId: "fatca.t02.capture_us_indicia",
      from: "residency_captured",
      to: "us_indicia_captured",
      guard: "US-Indicia questionnaire complete",
      action: "stage US-Indicia answers",
    },
    {
      transitionId: "fatca.t03.capture_tin",
      from: "us_indicia_captured",
      to: "tin_captured",
      guard: "TIN supplied if FATCA-relevant",
      action: "persist TIN",
    },
    {
      transitionId: "fatca.t04.validate_fragebogen",
      from: "tin_captured",
      to: "fragebogen_validated",
      guard: "FATCA / CRS classifier returns a verdict",
      action: "stamp tax-classification verdict",
    },
    {
      transitionId: "fatca.t05.submit_fragebogen",
      from: "fragebogen_validated",
      to: "fragebogen_submitted",
      guard: "tax classification permits onboarding",
      action: "persist signed fragebogen",
    },
    {
      transitionId: "fatca.t06.block_fragebogen",
      from: "fragebogen_validated",
      to: "fragebogen_blocked",
      guard: "tax classification blocks onboarding",
      action: "block onboarding with reason",
    },
  ],
};

/* -------------------------------------------------------------------- */
/*  Catalog                                                               */
/* -------------------------------------------------------------------- */

const DEFAULT_FIXTURE_SPECS: ReadonlyArray<FixtureSpec> = [
  LOGIN,
  KYC,
  MIFID_ORDER,
  BU_ANTRAG,
  KFZ_SCHADEN,
  GWG,
  ANLEGERPROFIL,
  KONTO_EROEFFNUNG,
  KREDITANTRAG,
  LEBENSVERSICHERUNG,
  SEPA,
  FATCA_CRS,
];

/** Total state machines published by {@link buildDefaultWorkflowStateMachineRegistry}. */
export const DEFAULT_WORKFLOW_STATE_MACHINE_COUNT: number =
  DEFAULT_FIXTURE_SPECS.length;

/**
 * Build the default workflow-state-machine registry. Twelve eingabemasken
 * fixtures are registered (see acceptance-criterion comment at the top of
 * this file).
 */
export const buildDefaultWorkflowStateMachineRegistry =
  (): WorkflowStateMachineRegistry => {
    const registry = createWorkflowStateMachineRegistry();
    for (const spec of DEFAULT_FIXTURE_SPECS) {
      registry.register(buildFixture(spec));
    }
    return registry;
  };

/**
 * Public list of fixture ids registered by default — exposed for tests
 * and for downstream callers that need to discover the available
 * eingabemasken without rebuilding the registry.
 */
export const DEFAULT_WORKFLOW_STATE_MACHINE_IDS: ReadonlyArray<string> =
  DEFAULT_FIXTURE_SPECS.map((spec) => spec.id);
