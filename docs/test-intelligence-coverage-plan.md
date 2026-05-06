# Test Intelligence Coverage Plan

The deterministic coverage planner emits a `CoveragePlan` before generator
execution. Prompt section `[4] CoveragePlan` carries that plan into the
generator request and includes an explicit `CoveragePlan.techniqueQuotas`
serialization so the model sees the per-screen minimum counts directly.

## Technique quota contract

- `CoveragePlan.techniqueQuotas` is a flattened list of `{ screenId, technique, minCount }`.
- Every entry with `minCount > 0` is a hard minimum for generator output.
- The full canonical plan remains available in the same prompt section as
  `CoveragePlan.full`.

## Supported technique set

Technique quotas use the generator's supported ISO/IEC/IEEE 29119-4 technique tags:

- `equivalence_partitioning`
- `boundary_value_analysis`
- `decision_table`
- `state_transition`
- `use_case`
- `exploratory`
- `error_guessing`
- `syntax_testing`
- `classification_tree`

The coverage planner may choose only the subset justified by the
`TestDesignModel`, but any quota it emits in `[4] CoveragePlan.techniqueQuotas`
must be honoured at generation time.
