# Deterministic Test-Data Oracle

Issue `#2071` adds a deterministic oracle that supplies authoritative
test data for field-covered test cases. The goal is simple: when the
intent IR exposes a resolvable validation rule, the pipeline must stop
the generator from inventing concrete values.

## Scope

The oracle resolves per-field validation rules from
`BusinessTestIntentIr.detectedValidations[*].rule` for the covered field
ids cited in `qualitySignals.coveredFieldIds`.

Current deterministic classes:

- `numeric range` and `numeric comparison`
- `integer range` and `integer comparison`
- `length`, `length range`, and `max characters`
- `ISO date`, `ISO time`, and `ISO datetime`
- `IBAN`, `BIC`, `ISIN`, German license plate, `numeric`, and
  `alphanumeric uppercase` format patterns

When the rule is unresolved, conditional, or computed without explicit
bounds, the oracle returns `resolvable: false` and the pipeline emits an
open question instead of concrete data.

## Pipeline Behavior

`runValidationPipeline(...)` and `runValidationPipelineWithSelfVerify(...)`
apply the deterministic oracle before semantic validation.

For every generated test case that cites covered field ids:

- `functional` and other positive-style cases receive oracle `valid`
  samples.
- `negative` and `validation` cases receive oracle `invalid` samples.
- `boundary` cases receive both `valid` and `invalid` samples.
- unresolved fields contribute `openQuestions` prefixed with
  `test-data oracle:`.

After reconciliation, semantic validation enforces that
`testData[*]` exactly matches the authoritative oracle output for
oracle-governed cases. Violations surface as
`test_data_oracle_violation`.

## Artifact

Every validation run now persists
`test-data-oracle-report.json`.

Shape summary:

- `jobId`
- `generatedAt`
- `oracleSeed`
- `cases[]`

Each case row contains:

- `testCaseId`
- `oracleResolvedFields[]`
- `oracleUnresolvedFields[]`
- `provenance[]`

`oracleResolvedFields[*].testDataEntries` shows the exact concrete values
that were allowed into the case. `oracleUnresolvedFields[*].openQuestion`
records the deterministic fallback text when the source rule could not be
resolved without inventing data.

## Worked Example

Input rule:

```text
Numeric in range 1000..50000
```

Functional case output:

```text
Amount: 1000.00 (boundary_min; from rule "Numeric in range 1000..50000")
Amount: 25500.00 (midpoint; from rule "Numeric in range 1000..50000")
Amount: 50000.00 (boundary_max; from rule "Numeric in range 1000..50000")
```

Boundary case output additionally includes:

```text
Amount: 999.99 (below_min_invalid; from rule "Numeric in range 1000..50000")
Amount: 50000.01 (above_max_invalid; from rule "Numeric in range 1000..50000")
```

Unresolved rule example:

```text
Required if Order-Typ is Limit
```

Output behavior:

- `testData` is emptied for the unresolved field.
- `openQuestions` receives a deterministic `test-data oracle: ...` entry.
- `test-data-oracle-report.json` records the field under
  `oracleUnresolvedFields`.

## Operational Notes

- The oracle seed is derived from the run `generatedAt` timestamp so
  time-relative date rules stay replay-stable.
- The report is persisted by both the validation-pipeline helper and the
  production runner.
- This feature governs `testData`. It does not attempt to rewrite every
  free-form sentence produced by the generator.
