# Demo Sample Output — Test-View-04

This directory contains the committed sample output of the
`figma_to_qc_test_cases` production runner from the live re-run on
2026-05-05 against Figma file `LATywBmBgvfBp1VvwUsGNB`, node `1-48176`
("Test-View-04"). It is referenced by the demo walk-through script in
`docs/demo-2026-05-pre-client.md` (Issue #1908) and is intended as a
self-contained sample set that the bank customer can drill into after
the demo.

## How this output was produced

```sh
FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 \
node dist/cli.js test-intelligence run \
  --figma-url "https://www.figma.com/design/LATywBmBgvfBp1VvwUsGNB/Test-View-04?node-id=1-48176" \
  --output ./demo-output/LATywBmBgvfBp1VvwUsGNB \
  --mode deterministic_llm \
  --enable-visual-sidecar \
  --custom-context-markdown ./docs/demo-2026-05-pre-client-context.md \
  --finops-budget ./docs/demo-2026-05-pre-client-finops-budget.json
```

Job id of the captured run: `ti-cli-1778014435317`. CLI exit code: `3`
(policy-blocked) — the EU-Banking-Default policy refused to clear all
four cases for downstream export. This is the demo's compliance-block
moment and is documented in detail in the Drehbuch.

## Layout

```
demo-output/LATywBmBgvfBp1VvwUsGNB/
├── README.md                                  (this file)
├── tc-<id>_<slug>.md                          customer-facing test case markdown (4 files)
├── testfaelle.md                              combined customer markdown
└── _runner-output/
    └── jobs/ti-cli-1778014435317/
        └── test-intelligence/
            ├── business-intent-ir.json        normalized Figma IR
            ├── compiled-prompt.json           deterministic LLM prompt + visualBinding
            ├── compiled-prompt-logic-judge.json
            ├── generated-testcases.json       full GeneratedTestCaseList
            ├── coverage-report.json           field/action/validation coverage ratios
            ├── policy-report.json             EU-Banking-Default verdicts
            ├── validation-report.json
            ├── visual-sidecar-result.json     Mistral primary + Llama fallback attempts
            ├── genealogy.json                 source DAG (figma + visual + custom_md)
            ├── production-runner-evidence-seal.json   sha256 manifest + DSSE-style seal
            ├── wave1-validation-evidence-manifest.json
            ├── wave1-validation-evidence-manifest.sha256
            ├── untrusted-content-normalization-report.json
            ├── agent-role-runs/
            │   ├── test_generation.json
            │   └── logic_judge.json           live Logic-Judge verdict
            ├── customer-markdown/
            │   ├── testfaelle.md              combined
            │   └── tc-<id>_<slug>.md          per-case
            ├── context-budget/
            │   └── test_generation.json
            └── finops/
                └── budget-report.json         per-role token spend, deterministic
```

## Audit-question coverage

For the six audit questions from Epic #1892, see the table at the end
of `docs/demo-2026-05-pre-client.md`. Each row points to a specific
file and JSONPath in this directory.

## Determinism notes

- All hashes (`sha256` fields, `cacheKey`, `manifestSha256`,
  `evidenceSeal.predicate.subject[*].digest`) are stable across reruns
  with the same inputs and the same prompt-template version.
- Live LLM responses (`generated-testcases.json`, `agent-role-runs/`)
  vary per run; a re-run will produce different test-case IDs and
  different judge findings. The committed sample is one specific run.
- The replay-cache directory `_runner-output/test-intelligence/replay-cache/`
  was excluded from this sample to keep the size bounded.

## Reproducing the run

The exact CLI invocation is in the `docs/demo-2026-05-pre-client.md`
Drehbuch under §3 (CLI-Aufruf). Operator must export the live
Azure AI Foundry credentials (`WORKSPACE_TEST_SPACE_*` env vars) and
`FIGMA_ACCESS_TOKEN` before invoking; the CLI will not load the `.env`
file automatically. Reproduction does not require any code change to
this branch.
