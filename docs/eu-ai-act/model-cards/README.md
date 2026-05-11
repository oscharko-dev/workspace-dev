# Model cards (EU AI Act Article 13)

Per-deployment model cards live here. Each card documents one cohesive
deployment bundle of the workspace-dev test-intelligence runtime — its
intended use, multi-agent architecture, the per-role model deployments
selected by the routing policy, training-data lineage as published by
each model provider, the calibration and judge-accuracy gates that
bound runtime behaviour, the domain-invariant catalog, known
limitations, and the post-market update cadence.

The cards discharge the EU AI Act Article 13 transparency obligation
(capability + limitation disclosure) for the deployment bundle they
describe. They do not, by themselves, classify the runtime as a
high-risk AI system under Annex III; that determination remains with
the operator.

## Files

For each profile + routing-policy bundle:

- `<profile>.model-card.md` — human-readable rendering.
- `<profile>.model-card.json` — machine-readable JSON twin (canonical
  JSON; the same content as the markdown).

The two files are byte-stable projections of the same generator output.
Editing them by hand is unsupported; the CI gate regenerates and
asserts no drift.

## Regeneration

```sh
pnpm run model-card:generate    # write the artefact pair
pnpm run model-card:check       # verify on-disk artefacts (CI gate)
```

The `generatedAt` timestamp is sourced from the
`MODEL_CARD_GENERATED_AT_PIN` constant in
`src/test-intelligence/model-card.ts`. Bump the pin when you regenerate
and re-commit the artefacts; the drift gate compares on-disk artefacts
against the generator output at this pinned timestamp, so the gate
never fires on calendar drift alone. Mirrors the
`FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT` convention used by the
faithfulness fixtures.

When any of the following changes, regenerate and commit the result:

- Routing policy (`src/test-intelligence/model-routing-policy.ts`)
- Calibration ECE thresholds (`src/test-intelligence/calibration-metrics.ts`)
- Inter-rater κ thresholds (`src/test-intelligence/inter-rater-agreement.ts`)
- Faithfulness gate thresholds (`src/test-intelligence/faithfulness-eval.ts`)
- Domain-invariant catalog (`src/test-intelligence/domain-invariant-registry.ts`)
- Provider training-data statements (`src/test-intelligence/model-card-provider-statements.ts`)
- Curated copy in `src/test-intelligence/model-card.ts`
- Contract version (`TEST_INTELLIGENCE_CONTRACT_VERSION`)

The drift gate fails the PR with a clear `pnpm run model-card:generate`
remediation hint when the committed artefacts disagree with the
generator output.

## Provenance

- Generator: `scripts/generate-model-card.ts`
- Builder: `src/test-intelligence/model-card.ts`
- Tests: `src/test-intelligence/model-card.test.ts`
- CI hook: `.github/workflows/dev-quality-gate.yml` (`model-card:check`
  step in the `quality` job)

Closes Issue #2112.
