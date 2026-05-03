# `src/test-intelligence/fixtures/`

This directory holds every checked-in fixture consumed by the
`pnpm run test:ti-eval` lane. Fixtures are organised by **suite**;
each suite owns a fixed naming convention and a matching loader in
`src/test-intelligence/`.

| Suite                        | Loader                                           | File-name prefix                          |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Wave-1 POC                   | `poc-fixtures.ts`                                | `poc-onboarding`, `poc-payment-auth`      |
| Wave-4 multi-source release  | `multi-source-fixtures.ts`                       | `release-multisource-*`                   |
| Adversarial inputs           | `adversarial-fixtures.test.ts`                   | `adversarial-*`                           |
| Issue-pinned export goldens  | `export-pipeline.golden.test.ts` and friends     | `issue-1364.*`, `issue-1365.*`            |
| MA-0 archetype baseline      | `baseline-fixtures.ts`                           | `baseline-*` _(this document)_            |

The rest of this README is about the **MA-0 archetype baseline suite**
introduced by Issue #1762 and consumed by Story #1754.

---

## MA-0 archetype baseline suite

The MA-0 baseline pins the seven mask archetypes a production
Figma-to-test-intelligence run is expected to handle. Each archetype is
synthetic, deterministic, hand-validated, and reproducible across runs
so that later waves (MA-1 .. MA-5) can `diff` their eval results
against this baseline without comparing apples to oranges.

### The seven archetypes

| Archetype id                  | Archetype          | What it pins                                                                 |
| ----------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `baseline-simple-form`        | simple form        | A single submit form with text and numeric inputs and one primary action.    |
| `baseline-calculation`        | calculation        | An input → derived value flow with explicit rounding and formatting rules.   |
| `baseline-optional-fields`    | optional fields    | Mandatory + optional + cross-field-required inputs on the same screen.       |
| `baseline-multi-context`      | multi-context      | Figma + Jira + customer-markdown describing the same Open-Account flow.      |
| `baseline-ambiguous-rules`    | ambiguous rules    | Rules that defer to external authorities and must surface as openQuestions.  |
| `baseline-complex-mask`       | complex mask       | Five logical groups, conditional sections, and repeating rows.               |
| `baseline-validation-heavy`   | validation-heavy   | Regex, range, cross-field, and async-shape rules on every field.             |

### File layout

For an archetype with id `<id>`:

```
fixtures/
├── <id>.figma.json                     # required: normalised Figma input
├── <id>.jira.json                      # optional: Jira REST snapshot
├── <id>.custom.md                      # optional: customer-supplied markdown
└── <id>.expected.summary.json          # required: hand-curated baseline metrics
└── eval-baseline-<archetype>.json      # required: deterministic MA-0 eval snapshot
```

- `<id>.figma.json` matches `IntentDerivationFigmaInput`
  (see `src/test-intelligence/intent-derivation.ts`). It is what
  `deriveBusinessTestIntentIr` consumes.
- `<id>.jira.json`, when present, holds a minimal Jira REST `issues`
  payload that names the same flow.
- `<id>.custom.md`, when present, is plain Markdown describing
  business rules that did not make it into the design or the ticket.
- `<id>.expected.summary.json` is a hand-curated snapshot listing the
  archetype's screen / node / field / action / validation / navigation
  counts and a free-text intent. The companion test
  (`baseline-fixtures.test.ts`) asserts that running
  `deriveBusinessTestIntentIr` over the figma input produces those
  exact counts. It also re-canonicalises the file through
  `canonicalJson` to assert byte-stability.
- `eval-baseline-<archetype>.json` stores the deterministic MA-0
  single-pass eval snapshot used by Issue #1763. The archetype token is
  the fixture id without the leading `baseline-` prefix, so
  `baseline-simple-form` maps to `eval-baseline-simple-form.json`.
  These files pin the coverage-type counters, duplicate rate, generic
  expected-result rate, ambiguous-case assumption marking rate,
  per-case traceability ref counts, a deterministic human-review sample
  snapshot, and the synthetic FinOps/token metrics used by the
  air-gapped PR lane.

Only `baseline-multi-context` ships the optional `*.jira.json` and
`*.custom.md` companions. The other six archetypes intentionally
leave them out so the matrix stays readable.

### Hard rules

- **No raw screenshots.** Fixtures must be plain text (`.json`,
  `.md`). Visual coverage lives in the Wave-1 POC mask SVGs;
  archetype baselines are intentionally text-only.
- **No secrets.** Fixtures are diffed in PRs and inlined into eval
  reports. Tokens, API keys and PEM bodies are forbidden. The test
  enforces this with a regex sweep on every file.
- **Deterministic content only.** Default values must be synthetic
  — no real customer data, no real bank account, no real tax id.
- **Canonical-JSON snapshots.** `*.expected.summary.json` parses
  back to the byte-stable form produced by `canonicalJson`. The
  test asserts this on every run. The same rule applies to the
  `eval-baseline-*.json` artifacts.

### How to add a new archetype

1. Pick an id that starts with `baseline-` and uses kebab-case.
2. Author `<id>.figma.json` with the screens / nodes you want to
   pin. Keep it small — one or two screens is enough.
3. If the archetype is multi-context, author `<id>.jira.json` and
   `<id>.custom.md`. Otherwise omit them.
4. Run the derivation locally to count
   `detectedFields`, `detectedActions`, `detectedValidations` and
   `detectedNavigation`. Record those numbers in
   `<id>.expected.summary.json` together with the archetype's
   intent and any operator-curated open-question keywords.
5. Rebuild the deterministic MA-0 eval artifact for the archetype and
   persist it as `eval-baseline-<archetype>.json`.
6. Append the new id to `BASELINE_ARCHETYPE_FIXTURE_IDS` in
   `src/test-intelligence/baseline-fixtures.ts` and to the table
   above.
7. Run `pnpm run test:ti-eval`. The companion tests will fail with
   a precise diff if any of the counts disagree with the figma
   input or if the eval snapshot drifts, which is exactly the
   regression signal MA-0 is meant to give.

### Why this suite is small on purpose

Every archetype here is curated. The goal is **not** breadth —
that lives in the Wave-4 multi-source release suite and the
adversarial suite — but a minimal, hand-verified set of inputs
whose expected outputs we can reason about by eye. Adding a new
archetype is a deliberate act, not a routine maintenance step.
