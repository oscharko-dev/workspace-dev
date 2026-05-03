# Adversarial-2025 fixture suite

Issue [#1776](https://github.com/oscharko-dev/workspace-dev/issues/1776) —
parent Story [#1757](https://github.com/oscharko-dev/workspace-dev/issues/1757)
(MA-2.5: Untrusted-Content Hardening).

This directory pins **seven** 2025-vintage prompt-injection carriers
that the production input pipeline must strip before any LLM is called.
Each fixture has a deterministic, byte-stable expected outcome asserted
inline in `src/test-intelligence/adversarial-2025.test.ts`, and is
mandatory in `pnpm run test:ti-eval`.

The carriers exercise every branch of
[`UntrustedContentNormalizer`](../../untrusted-content-normalizer.ts)
that ships from Issue #1774. No fixture mutates the production code
path; each is consumed read-only at test time.

## Suite manifest

| #  | Fixture file                                              | Carrier                              | Counter incremented            | Severity   | Expected outcome                          |
| -- | --------------------------------------------------------- | ------------------------------------ | ------------------------------ | ---------- | ----------------------------------------- |
| 1  | `figma-hidden-layer-injection.json`                       | `visible=false` Figma layer          | `figmaHiddenLayers`            | `info`     | `risk_signal_emitted` + `case_not_modified` |
| 2  | `figma-zero-opacity-injection.json`                       | `opacity=0` Figma layer              | `figmaZeroOpacityLayers`       | `info`     | `risk_signal_emitted` + `case_not_modified` |
| 3  | `figma-off-canvas-injection.json`                         | layer outside parent bounding box    | `figmaOffCanvasLayers`         | `warning`  | `risk_signal_emitted` + `case_not_modified` |
| 4  | `figma-fontsize-zero-injection.json`                      | `style.fontSize=0` Figma layer       | `figmaZeroFontSizeLayers`      | `warning`  | `risk_signal_emitted` + `case_not_modified` |
| 5  | `jira-adf-collapsed-node-injection.json`                  | ADF `expand` (collapsed) node        | `adfCollapsedNodes`            | `warning`  | `risk_signal_emitted` + `case_not_modified` |
| 6  | `custom-zero-width-unicode-injection.md`                  | U+200B/U+200C/U+200D + directive     | `zeroWidthCharacters` + `markdownInjectionMatches` | `critical` | `risk_signal_emitted` + `policy_route=needs_review` |
| 7  | `repair-thought-injection-forged-validator-line.json`     | forged "Validator said OK" + directive | `markdownInjectionMatches`     | `critical` | `risk_signal_emitted` + `policy_route=needs_review` |

### Outcome vocabulary

The three outcomes referenced in the table map to concrete
`UntrustedContentNormalizer` post-conditions:

- `risk_signal_emitted` — the relevant counter in
  `report.counts` is non-zero (an injection carrier was detected and
  attributed to its kind).
- `case_not_modified` — the post-normalization payload no longer
  contains the smuggled directive: hidden / zero-opacity / off-canvas /
  zero-fontsize Figma children are pruned from the projected tree, and
  the rejected ADF document yields `jiraAdfPlainText === ""`.
- `policy_route=needs_review` — `report.outcome === "needs_review"`,
  driven by the presence of at least one `critical`-severity carrier in
  `needsReviewReasons`.

## Determinism contract

- Every fixture is **canonical JSON** (or canonical UTF-8 markdown)
  with stable key ordering, so the assertion suite produces identical
  byte output across runs and across hosts. The test harness validates
  `report.outcome` and the precise counter value; it does not depend on
  natural-language matches against the smuggled directives.
- The fixtures contain **only** synthetic injection text. No real PII,
  no live secrets, no third-party trademarks. The strings are crafted
  to match the regex set in
  [`untrusted-content-normalizer.ts`](../../untrusted-content-normalizer.ts)
  (mirrored from `test-design-model.ts`).
- The injection text is wrapped by the carrier (hidden layer, zero
  opacity, off-canvas, zero font-size, ADF expand, zero-width unicode,
  forged-validator line). The normalizer drops or quarantines the
  carrier; the directive never reaches a downstream prompt.

## Adding a new adversarial-2025 fixture

1. Place the file in this directory.
2. Pick a carrier from the union in `untrusted-content-normalizer.ts`
   and craft a minimal payload that increments **exactly one** counter
   (cross-counter contamination defeats determinism).
3. Append a row to the manifest table above.
4. Add an inline assertion to `adversarial-2025.test.ts`.
5. Confirm `pnpm run test:ti-eval` is green.
