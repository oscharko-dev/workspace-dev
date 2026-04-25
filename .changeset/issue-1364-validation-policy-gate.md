---
"workspace-dev": minor
---

Add test-case validation, policy gate, coverage report, and visual-sidecar gate for Issue #1364.

- Export `runValidationPipeline`, `runAndPersistValidationPipeline`, `validateGeneratedTestCases`, `evaluatePolicyGate`, `computeCoverageReport`, `detectDuplicateTestCases`, `validateVisualSidecar`, and the `EU_BANKING_DEFAULT_POLICY_PROFILE` from `src/test-intelligence/`.
- Add the test-case validation, policy, coverage, and visual-sidecar artifact surface to the public contract (contracts 3.23.0): `TEST_CASE_VALIDATION_REPORT_*`, `TEST_CASE_POLICY_REPORT_*`, `TEST_CASE_COVERAGE_REPORT_*`, `VISUAL_SIDECAR_VALIDATION_REPORT_*`, `EU_BANKING_DEFAULT_POLICY_PROFILE_ID`, `EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION`, plus runtime allow-lists and typed shapes for issues, decisions, outcomes, profile rules, coverage buckets, and duplicate pairs.
- Persist `generated-testcases.json`, `validation-report.json`, `policy-report.json`, `coverage-report.json`, and (when visual input is supplied) `visual-sidecar-validation-report.json` deterministically via canonical JSON + atomic tmp+rename writes.
- Block downstream review/export when validation finds any error, when the `eu-banking-default` policy gate marks the job blocked (PII in test data, missing trace, missing expected results, QC mapping not exportable, missing accessibility case for form screens, visual-sidecar prompt-injection-like text), or when the visual-sidecar gate is blocked.
- Golden fixture (`issue-1364.expected.*.json`) covers the simple-form intent through the full pipeline; property tests cover Jaccard symmetry/bounds and duplicate-pair lex ordering.
