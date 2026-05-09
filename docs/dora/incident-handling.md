# DORA Mapping — ICT Incident Handling (Issue #2114)

**Scope:** DORA (Digital Operational Resilience Act) Article 10 mapping for
the structured incident-classification and escalation surface introduced by
Issue #2114. This document is a sibling to `docs/dora/multi-source.md` and
`docs/dora/subprocessor-register.md`; together they extend the top-level DORA
control mapping in `COMPLIANCE.md`.

**Regulation:** REGULATION (EU) 2022/2554 (DORA), Article 10
("ICT-related incident management process"), applicable to EU financial
entities and their ICT third-party service providers.

**Last reviewed:** 2026-05-10 (Issue #2114).

**Audience:** financial entities and other regulated operators who must
record, classify, and escalate ICT-related incidents arising from the
test-intelligence subsurface.

---

## 1. Surface summary

Issue #2114 closes the audit finding _"no automated incident-reporting
hook"_ by adding three composable primitives:

| Primitive            | Module                                              | Responsibility                                                                                                          |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `IncidentEvent`      | `src/contracts/index.ts`                            | Persisted event shape with `id`, `severity`, `category`, `observedAt`, `jobId`, `evidence: ManifestRef[]`, `rootCauseHypothesis`. |
| `IncidentClassifier` | `src/test-intelligence/incident-classifier.ts`      | Pure transform from `validationReport × policyReport × signals` to `IncidentReport`; stamps `reviewState`.              |
| `IncidentSink`       | `src/test-intelligence/incident-sink.ts`            | Operator-supplied persistence interface; default is filesystem (`<runDir>/<jobId>/incidents.json`, atomic rename).       |

The classifier is fully deterministic: identical inputs yield byte-
identical reports. The sink uses the same `${path}.${pid}.tmp → rename`
pattern as the review-store, so partial writes never reach disk.

---

## 2. Article 10 — ICT-related incident management

**Obligation:** Financial entities must define, establish, and implement an
ICT-related incident management process to detect, manage, and notify
ICT-related incidents, including classification by severity, identification
of root causes, and escalation to designated roles.

| Control                          | Implementation                                                                                                                                                                                                                                  | Evidence                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Typed incident classification    | `IncidentEvent.severity` is a closed enum (`low`, `medium`, `high`, `critical`); `IncidentEvent.category` is a closed enum of seven categories. New categories require a contract-version bump.                                                | `ALLOWED_INCIDENT_SEVERITIES`, `ALLOWED_INCIDENT_CATEGORIES`                                                      |
| Severity derivation rule         | Base formula `errorCount × riskWeight × (decisionWeight + 1)` mapped to `low/medium/high/critical`. Categorical bumps escalate beyond the formula (regulated-data PII → `critical`, gate bypass → `critical`, regulated compliance → `high`).   | `src/test-intelligence/incident-classifier.ts` — `baseSeverity`, `deriveFromPolicyReport`                          |
| Root-cause hypothesis            | Every emitted `IncidentEvent` carries a deterministic `rootCauseHypothesis` referencing the triggering test-case ids and the upstream rule pack. The hypothesis is auditor-readable and stable across replays of the same input.               | `IncidentEvent.rootCauseHypothesis`                                                                                |
| Evidence trail                   | Every event references persisted artifacts via `evidence: ManifestRef[]` (`{ filename, sha256 }`); the sink writes the full report into `incidents.json` next to the validation, policy, coverage, and review-events artifacts for the run.    | `INCIDENT_REPORT_ARTIFACT_FILENAME = "incidents.json"`                                                            |
| Pause-on-critical escalation     | When any classified event has `severity === "critical"`, the report stamps `reviewState: "incident_ack_required"`. Operators MUST treat that state as a pipeline pause: no export, no Jira write-back, no QC publish until acknowledgement.    | `requiresIncidentAck`, `IncidentReport.reviewState`                                                                |
| Operator escalation hook         | The `IncidentSink` interface is operator-supplied. Operators may forward to PagerDuty, OpsGenie, ServiceNow, or any internal incident-management system without modifying the package; the default sink writes the canonical artifact only.   | `IncidentSink` (`src/test-intelligence/incident-sink.ts`)                                                          |
| Replay determinism               | Reports are written via `canonicalJson` so that identical inputs produce byte-identical bytes; CI replay is verifiable from the per-run evidence manifest.                                                                                     | `src/test-intelligence/content-hash.ts`                                                                            |
| Closed list of incident categories | The seven categories defined in Issue #2114 (`pii_leakage`, `judge_disagreement_persistent`, `drift_alert`, `policy_gate_bypass`, `replay_cache_miss_unexpected`, `subprocessor_outage`, `compliance_rule_pack_violation`) are exported as a frozen list. | `ALLOWED_INCIDENT_CATEGORIES`                                                                                      |

---

## 3. Category sources

Each category sources from a specific upstream signal. Categories that do
not appear on a run are simply absent from the report.

| Category                              | Source                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pii_leakage`                         | `TestCasePolicyReport.decisions[].violations[].outcome` of `pii_in_test_data` or `visual_sidecar_possible_pii`.                                                     |
| `judge_disagreement_persistent`       | Policy outcomes `judge_refused` or `cross_modal_faithfulness_score_below_threshold`.                                                                                |
| `compliance_rule_pack_violation`      | Policy outcomes `ict_register_ref_required`, `regulated_risk_review_required`, `custom_context_risk_escalation`, or `multi_source_conflict_present`.                |
| `drift_alert`                         | Operator-supplied `IncidentSignal` (`kind: "drift_alert"`); typically wired to the drift canary CI gate output.                                                     |
| `policy_gate_bypass`                  | Operator-supplied `IncidentSignal` (`kind: "policy_gate_bypass"`, with `bypassedRule`); always emitted at `critical`.                                               |
| `replay_cache_miss_unexpected`        | Operator-supplied `IncidentSignal` (`kind: "replay_cache_miss_unexpected"`); raised when a deterministic step misses the replay cache against expectation.          |
| `subprocessor_outage`                 | Operator-supplied `IncidentSignal` (`kind: "subprocessor_outage"`, with `provider`); typically wired to the operator's gateway-side health probe or status feed.    |

---

## 4. Severity rubric

```
score = max(0, errorCount) × riskWeight × (decisionWeight + 1)
```

| Component        | Mapping                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorCount`     | `validationReport.errorCount` for the job.                                                                                                                       |
| `riskWeight`     | `low → 1`, `medium → 2`, `high → 3`, `regulated_data → 4`, `financial_transaction → 4`.                                                                          |
| `decisionWeight` | `approved → 0`, `needs_review → 1`, `blocked → 2`. Score uses `(decisionWeight + 1)` so that approved cases still produce a non-zero score in the presence of errors. |
| `score` thresholds | `< 2 → low`, `< 6 → medium`, `< 12 → high`, `≥ 12 → critical`.                                                                                                  |

Categorical bumps applied after the base formula:

- `pii_leakage` on a `regulated_data` or `financial_transaction` case →
  forced to `critical`.
- `policy_gate_bypass` → always `critical`.
- `compliance_rule_pack_violation` on a regulated case → at least `high`.
- Operator-supplied signals (`drift_alert`, `subprocessor_outage`,
  `replay_cache_miss_unexpected`) default to `high` when the operator does
  not pass an explicit severity.

---

## 5. Operator obligations

For every run that uses the test-intelligence pipeline, the operator MUST:

1. Wire an `IncidentSink` instance into their pipeline runner. The default
   `createFileSystemIncidentSink` is acceptable for air-gapped or on-prem
   deployments; cloud-hosted operators should compose it with a forwarder
   to their incident-management system.
2. Treat `reviewState: "incident_ack_required"` as a hard pipeline pause.
   The package never auto-exports past this state; an operator who chooses
   to override MUST record the override in a structured audit log of their
   own and treat it as a `policy_gate_bypass` incident in the next run.
3. Maintain operator-side classification SLAs that match DORA Art. 19
   notification windows for any `critical` incident routed by the sink.
4. Ensure that operator-supplied signals (drift, subprocessor outage,
   replay-cache miss, gate bypass) are produced by the same channels their
   own ICT-incident management process already monitors, so that the
   classifier output and the operator's own incident register stay coupled.

---

## 6. Replay verifiability

Every persisted `incidents.json` is stamped with
`schemaVersion: "1.0.0"` and the runtime
`TEST_INTELLIGENCE_CONTRACT_VERSION`. A replay against an unsupported
contract version fails closed. Because the report is written via
`canonicalJson` and the classifier is pure, two runs against the same
inputs produce byte-identical files; an auditor can re-derive the file
from the validation/policy reports plus the recorded signal stream.

---

## 7. CI / governance gates

- **Eingabemasken benchmark.** `incident-eingabemasken-benchmark.test.ts`
  drives the classifier against every archetype in the EU banking +
  insurance fixture catalog with the default green-run shape; the test
  asserts zero `critical` incidents and `reviewState: "ok"`. A regression
  that flips a default run into a `critical` incident is caught here.
- **Contract gate.** The new contract exports
  (`ALLOWED_INCIDENT_SEVERITIES`, `ALLOWED_INCIDENT_CATEGORIES`,
  `ALLOWED_INCIDENT_REVIEW_STATES`, `INCIDENT_REPORT_SCHEMA_VERSION`,
  `INCIDENT_REPORT_ARTIFACT_FILENAME`, `IncidentEvent`, `IncidentReport`,
  `ManifestRef`) are part of the typed contract surface; renaming or
  removing them is a contract-breaking change.
- **CODEOWNERS coupling.** `docs/dora/incident-handling.md` is reviewed by
  the same governance owners as the other DORA documents under
  `docs/dora/` so the audit-trail story stays consistent across articles.
