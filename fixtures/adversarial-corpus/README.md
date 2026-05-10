# Adversarial Corpus (Issue #2122)

Curated, versioned catalogue of adversarial payloads exercised by the
test-intelligence stack. Sister to the legacy `adversarial-2025` fixture
suite under `src/test-intelligence/fixtures/adversarial-2025/`, but
broader: the catalog covers the full prompt-injection attack surface
defined in the [#2122 acceptance criteria](https://github.com/oscharkowski/workspace-dev/issues/2122),
not only the carriers that the untrusted-content normalizer drops.

## Files

- `catalog.json` — single source of truth. Versioned JSON (`schemaVersion`,
  calendar `version`, `lastReviewedAt`, `nextReviewDue`).
- `README.md` — this file.

## Schema (per entry)

```jsonc
{
  "id": "pi-direct-001",                       // stable, kebab-case
  "category": "prompt_injection_direct",        // 1 of 15 declared categories
  "title": "Plain ignore-previous-instructions in markdown body",
  "payloadKind": "markdown" | "text-field" | "jira-adf"
              | "figma-document" | "output-string",
  "payload": "...",                            // shape depends on payloadKind
  "expectedOutcome": {
    // input-side carriers (untrusted-content normalizer)
    "surface": "input",
    "outcome": "ok" | "needs_review",
    "nonZeroCounts": ["markdownInjectionMatches", ...]
  } | {
    // output-side deny-list (semantic-content sanitization)
    "surface": "output",
    "category": "shell_metacharacters" | "jndi_log4shell" | ...
  },
  "citation": "OWASP LLM01 / NIST AI 100-2 AML.T0051 / ..."
}
```

Optional repeat annotations expand a small payload to a target byte
count at gate time without bloating `catalog.json`:

- `payloadRepeatBytes`: for `markdown` and `text-field`. Repeats the
  payload string until its UTF-8 size reaches the target.
- `payloadAdfTextRepeatBytes`: for `jira-adf`. Replaces the literal
  marker `__REPEAT__` inside the payload with `"X"`-padding so the
  parsed plain text crosses the per-element byte cap.

## Categories

The 15 declared categories trace directly to the AC:

| Category | AC bucket |
| --- | --- |
| `prompt_injection_direct` | prompt injection (direct) |
| `prompt_injection_indirect_figma` | prompt injection (indirect via Figma text) |
| `prompt_injection_indirect_jira` | prompt injection (indirect via Jira) |
| `prompt_injection_indirect_markdown` | prompt injection (indirect via custom markdown) |
| `data_exfiltration` | data exfiltration attempts |
| `instruction_following_hijack` | instruction-following hijack |
| `role_confusion` | role-confusion |
| `output_side_shell` | output-side injection (shell) |
| `output_side_jndi` | output-side injection (JNDI) |
| `output_side_xss` | output-side injection (XSS) |
| `oracle_bypass` | oracle bypass attempts |
| `ranking_manipulation` | ranking-manipulation |
| `context_stuffing` | context-stuffing |
| `charset_tricks_zero_width` | charset-tricks (zero-width) |
| `charset_tricks_rtl_override` | charset-tricks (RTL override) |

## CI gate

`src/test-intelligence/adversarial-corpus.test.ts` is a node:test suite
that loads `catalog.json`, dispatches every entry to the corresponding
defense layer, and asserts the observed report matches the entry's
`expectedOutcome`. The gate fails the build if any entry's outcome
diverges, and is included in `pnpm test`.

## Quarterly review

`lastReviewedAt` and `nextReviewDue` track the quarterly checkpoint. At
each review the security maintainers add new attacks from threat
intelligence, retire entries that no longer represent realistic threats,
and bump `version` (calendar versioning, `YYYY.MM.DD`). The CI suite
fails if `nextReviewDue` is in the past, so a missed review surfaces as
a red build instead of silent rot.

## Provenance

Candidate attacks were generated at design-time using
`mistral-large-3` (Issue [#2099](https://github.com/oscharkowski/workspace-dev/issues/2099))
and reviewed by the test-intelligence and security maintainers before
landing. The generation step is **design-time only** — the corpus
itself is committed JSON, and no model is invoked at gate time.
