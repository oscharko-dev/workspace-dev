# Test-intelligence prompt-template changelog

This file records every non-PATCH bump of
`TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` (declared in
`src/contracts/index.ts`). PATCH bumps that preserve
token-byte-equivalence on the baseline-fixture set are intentionally
omitted — the semver constant in `src/contracts/index.ts` and the
git-history of `src/test-intelligence/prompt-compiler.ts` are sufficient
provenance for those.

## Semver semantics

| Bump | Meaning |
|------|---------|
| **PATCH** | Wording fixes that preserve token-byte-equivalence on the baseline-fixture set (typos, comment-only edits inside the compiled prompt body, equivalent-byte rewordings). |
| **MINOR** | New sections, additional instructions, or new optional directives that remain backwards-compatible with prior generator outputs. The existing `covered*` arrays, `figmaTraceRefs` schema, and evidence shape are unchanged. |
| **MAJOR** | Breaking section reordering, evidence-schema changes, or removal of a directive contract previously relied on by a downstream judge (Logic-Judge, Faithfulness-Judge, A11y-Judge). |

Every non-PATCH bump records:

- **Scope** — the prompt sections and downstream consumers affected.
- **Motivation** — the operator-facing reason (issue link).
- **Expected verdict-deltas** — qualitative drift on the baseline-fixture
  set. "None" is a valid value when a directive only forbids a previously
  underspecified behavior.

## Operator workflow when bumping

1. Edit `src/test-intelligence/prompt-compiler.ts` (or any rule it
   imports from `src/test-intelligence/agent-role-profile.ts`).
2. Bump `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` in
   `src/contracts/index.ts` per the semver table above.
3. Update `docs/test-intelligence-prompt-template-version.lock.json` with
   the new version and the new content hash of
   `src/test-intelligence/prompt-compiler.ts` (the CI guard prints the
   expected hash on failure; copy it verbatim).
4. Add a changelog entry to this file for any **MINOR** or **MAJOR** bump.
5. Update the explicit version snapshot in
   `src/test-intelligence/validation-pipeline.golden.test.ts`,
   `src/test-intelligence/export-pipeline.golden.test.ts`, and
   `src/test-intelligence/qc-alm-dry-run.golden.test.ts` so the bump is
   visible in the PR diff.

The CI guard `scripts/check-prompt-template-version.mjs` (wired into
`.github/workflows/pr-quality-gate.yml`) fails the build when any of
those steps are skipped.

---

## 1.6.0 — Issue #2015 — Filter decorative UI nodes from generator input

**Bump type:** MINOR.

**Scope:** Generator user-prompt `[2] TestDesignModel` payload — the
`screen.elements` and `screen.actions` arrays are now filtered through
`isCoverageRelevantElementLike` / `isCoverageRelevantActionLike` before
being emitted, so decorative Figma text nodes (`<Radio>`, `<TextField>`,
`<Stack> FormControlLabel | Radio`, standalone `EUR`, `Text`,
`(optional)`, value-only labels) never reach the model.

**Motivation:** Issue #2015 — benchmark dataset
`T7l7m8T8501lxLZZFQrwJC` was blocked by `technique_quota_breach`
because decorative React component placeholders surfaced as Figma text
nodes drove the per-screen technique quotas and produced standalone
customer test cases for `<Radio>`, `Text`, and `EUR`. The generator
must be fed only meaningful business/UI targets so coverage and quotas
align with what a customer would actually test.

**Expected verdict-deltas on baseline:** No regression on meaningful
screens; per-screen technique quotas decrease on Figma-rich fixtures
because decorative text nodes no longer become required equivalence
partitions; customer markdown stops emitting standalone test cases for
placeholder labels.

## 1.5.0 — PR #1984 — Customer-context trace hygiene

**Bump type:** MINOR.

**Scope:** Generator system prompt and `[5] CustomerDomainContext`
section header. Custom Markdown / customer-domain context remains an
authoritative evidence source, but the prompt now explicitly forbids
placing that provenance into `figmaTraceRefs`.

**Motivation:** `figmaTraceRefs` are consumed as real Figma screen/node
trace anchors by coverage and customer-facing evidence. Citing
`custom_context_markdown` there polluted Figma coverage signals and made
non-Figma evidence look like a Figma node. The generator must instead
record customer-context influence through `assumptions` or
`openQuestions` entries prefixed with `custom_context_markdown:`.

**Expected verdict-deltas on baseline:** No schema regression expected.
Traceability becomes stricter: Figma coverage should only reflect real
Figma screens/nodes, while customer-context provenance remains visible
through assumptions/open questions.

## 1.4.0 — Issue #1942 — Hard-gated technique-quota enforcement

**Bump type:** MINOR.

**Scope:** Generator user-prompt preamble. Pulls
`GENERATOR_TECHNIQUE_QUOTA_RULE` from
`src/test-intelligence/agent-role-profile.ts` into the compiled prompt
body so the quota directive is byte-identical between the prompt the
model sees and the runner-side enforcement gate.

**Motivation:** PRs #1942 hard-gated unmet technique quotas at runtime;
the prompt directive was previously implicit via the role-profile and
could drift from the runtime gate. Embedding the rule string keeps prompt
and gate in lock-step.

**Expected verdict-deltas on baseline:** No regression on the
baseline-fixture set; technique-coverage on Jira-only jobs improves
because the generator now sees the quota directive on the user-prompt
side as well as the system-prompt side.

## 1.3.0 — Issue #1941 — Dedicated `[5] CustomerDomainContext` section

**Bump type:** MINOR.

**Scope:** Generator system prompt — promoted `custom_context_markdown`
from a generic untrusted-data block to a dedicated, role-tagged
authoritative-evidence section for customer banking and insurance rules.
Adds new citation paths (`figmaTraceRefs.screenId="custom_context_markdown"`
and `assumptions/openQuestions` entries prefixed with
`custom_context_markdown:`).

**Motivation:** Customer-supplied domain rules were being conflated with
generic user-text; downstream judges could not reason about their
provenance. Issue #1941 made the source first-class.

**Expected verdict-deltas on baseline:** Faithfulness improves on
domain-rule fixtures (`custom-context-markdown.fixture`); no regression
on figma-only or jira-only fixtures.

## 1.2.0 — Issue #1905 — Form-screen accessibility directive

**Bump type:** MINOR.

**Scope:** Generator system prompt and user-prompt preamble. Adds the
explicit "every form screen MUST emit at least one type=accessibility
test case" directive, sourced from
`GENERATOR_FORM_SCREEN_A11Y_RULE` in
`src/test-intelligence/agent-role-profile.ts`.

**Motivation:** Replay-cache could serve generator outputs that
pre-dated the policy-gate `policy:form-screen-needs-accessibility-case`,
producing reports with zero a11y cases on form fixtures. Bumping the
prompt-template version forces a cache miss.

**Expected verdict-deltas on baseline:** A11y-coverage rises on the form
fixtures (`simple-form`, `payment-card`, `login-mfa`); no regression on
non-form fixtures.
