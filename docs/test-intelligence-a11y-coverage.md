# Form-screen accessibility coverage eval

> Closes #1905. Companion gate to
> [`policy:form-screen-needs-accessibility-case`](../src/test-intelligence/policy-gate.ts)
> and the deterministic synthesiser in
> [`validation-harness.ts`](../src/test-intelligence/validation-harness.ts).

The Form-screen A11y-Coverage-Eval is a deterministic, offline gate that
checks whether the generator's output carries at least one accessibility
test case anchored to every form screen in the Business Test Intent IR.
It complements the existing policy gate by adding a per-screen,
canonical-JSON eval report so dashboards and reviewers can audit
coverage without scraping job-level violations.

## Motivation

The Demo run on 2026-05-05 (`ti-cli-1777975419948`) was blocked by the
EU-Banking default policy with `missing_accessibility_case` because the
generator produced no a11y cases for a form screen. The policy gate
caught the failure but no eval measured how often it happened.
Issue #1905 closes that gap by:

1. Adding an explicit generator-prompt directive that every form screen
   MUST be covered by at least one accessibility test case (mirrored as
   the [`GENERATOR_FORM_SCREEN_A11Y_RULE`](../src/test-intelligence/agent-role-profile.ts)
   constant and injected into the prompt-compiler `SYSTEM_PROMPT` /
   `USER_PROMPT_PREAMBLE`).
2. Bumping `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` from `1.1.0` to
   `1.2.0` so cached generator outputs that pre-date the directive
   cannot satisfy the eval via replay-cache hit.
3. Adding the
   [`a11y-coverage-eval.ts`](../src/test-intelligence/a11y-coverage-eval.ts)
   module: per-screen coverage accounting, hard gate, soft target,
   per-screen JSON report.
4. Adding the `missing_form_screen_a11y_case` finding code to the
   [`logic-judge` coverage hard-gate](../src/test-intelligence/logic-judge.ts)
   so the existing repair loop drives regeneration with the canonical
   accessibility instruction.

## WCAG 2.2 AA pillars

The eval pins six pillars per form screen, surfaced in
`A11Y_WCAG_22_AA_PILLAR_IDS` and the per-screen artifact:

| Pillar id              | WCAG 2.2 AA success criterion                                  | Description |
| ---------------------- | -------------------------------------------------------------- | ----------- |
| `tab-order`            | 2.4.3 Focus Order (Level A)                                    | All focusable controls are reachable in a logical order via the keyboard. |
| `focus-indicator`      | 2.4.7 Focus Visible (Level AA) + 2.4.13 Focus Appearance       | Every interactive control shows a visible focus indicator, respecting `prefers-reduced-motion` (analogous to #1701). |
| `label-for-input`      | 1.3.1 Info and Relationships (Level A) + 4.1.2 Name, Role, Value | Every input field has a programmatically associated visible label. |
| `error-announcements`  | 3.3.1 Error Identification (Level A) + 4.1.3 Status Messages   | Validation errors are surfaced via `aria-live` so assistive tech announces them. |
| `color-contrast`       | 1.4.3 Contrast (Minimum) (Level AA) + 1.4.11 Non-text Contrast | Form action buttons and their disabled states meet AA contrast against the background. |
| `keyboard-trap-freedom`| 2.1.2 No Keyboard Trap (Level A)                               | Focus can always be moved away from any control with the keyboard alone. |

The pillar list is closed and stable — review tooling can branch on the
`A11yWcag22AaPillarId` enum without sniffing freeform strings.

## Hard gate vs. soft target

| Threshold                        | Default | Severity   | Verdict effect                                  |
| -------------------------------- | ------: | ---------- | ----------------------------------------------- |
| `hardThresholdPerScreen`         |       1 | `error`    | Trips `verdict.passed=false` and emits a repair instruction. |
| `softTargetPerScreen` (advisory) |       4 | `warning`  | Surfaces in the per-screen report; does NOT trip the gate. |

The hard gate matches the policy-gate semantics: every form screen must
carry at least one anchored accessibility case (`type=accessibility`
with a `figmaTraceRefs[].screenId` that points at the form screen). The
soft target reflects the WCAG 2.2 AA pillar count; it lets dashboards
flag screens that pass the gate but only carry a single composite a11y
case.

## Anchoring rule

A test case satisfies the eval for screen `X` when **both**:

1. `testCase.type === "accessibility"`, and
2. `testCase.figmaTraceRefs` contains an entry with `screenId === X`.

Cases that cover screen-X fields indirectly (via covered field ids) but
do not carry an anchored trace **do not count**. This mirrors the policy
gate, which already enforces an anchored trace.

## Repair-instruction trigger

When the hard gate trips, the eval emits one repair instruction per
missing screen using the canonical template from
[`agent-role-profile.ts`](../src/test-intelligence/agent-role-profile.ts):

```
Add at least one accessibility test case for screen {screenId} covering
keyboard navigation, focus order, and screen-reader announcements.
```

The same string is rendered by the logic-judge `missing_form_screen_a11y_case`
finding so the repair-loop sees one consolidated instruction across both
gates.

## Per-screen report

Each fixture writes a canonical-JSON artifact to
`storybook-static/eval-reports/a11y-<fixture>.json`. The artifact carries:

- `profileId: "wcag-2.2-aa-form-screen"` and `schemaVersion`.
- `metrics` — `formScreenCount`, `formScreensWithCoverage`,
  `formScreensMeetingSoftTarget`, `totalA11yCases`,
  `screenCoverageRatio`.
- `verdict` — `passed` and the list of failures (severity-tagged).
- `perScreen[]` — one entry per form screen with `fieldCount`,
  `a11yCaseCoverage`, `matchedTestCaseIds`, `hardGatePassed`,
  `softTargetPassed`, and the closed `expectedPillars` enum.
- `repairInstructions[]` — one canonical instruction per missing screen.

Round-tripping through `JSON.parse(canonicalJson(artifact))` is a
no-op; identical inputs produce byte-identical artifacts so the file is
safe to diff in PRs.

## Fixture coverage

The eval is exercised against:

- All seven baseline archetype fixtures (`baseline-simple-form`,
  `baseline-calculation`, `baseline-optional-fields`,
  `baseline-multi-context`, `baseline-ambiguous-rules`,
  `baseline-complex-mask`, `baseline-validation-heavy`).
- The two Wave 1 validation fixtures (`validation-onboarding`,
  `validation-payment-auth`) — `validation-onboarding` is the fixture
  the demo replay (Test-View-04, 2026-05-05) blocked on.

The deterministic synthesiser in `validation-harness.ts` already emits
one composite a11y case per form screen, so every shipped fixture
passes the hard gate. The negative direction is covered by a unit test
that constructs a list with no anchored a11y case.

## Run instructions

```bash
# Hard-gate run (writes per-screen reports under storybook-static/eval-reports/):
pnpm run test:ti-a11y

# Local report write to a custom directory:
tsx scripts/run-a11y-coverage-eval.ts --output-dir tmp/eval-reports
```

The runner exits non-zero on any hard-gate (`error`-severity) failure
and prints the offending `(screen, threshold, observed)` triple for
attribution. Soft-target warnings are surfaced in the per-screen
artifacts but do NOT fail the runner.

## Repair-loop interaction

Issue #1900 introduced the bounded-iteration repair loop; Issue #1901
added the post-LLM coverage hard-gate. The new
`missing_form_screen_a11y_case` finding code emits at error severity,
so an `accept` verdict is upgraded to `repair`, and the consolidated
repair instruction is dispatched to the regenerator on the next
iteration. The synthesiser's a11y case satisfies the gate
deterministically, so the repair loop converges in one iteration on
every fixture in the suite.
