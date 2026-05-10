# 2026-05-10 — Issue #2122: Adversarial corpus expansion (curated 50+ attacks)

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2122](https://github.com/oscharkowski/workspace-dev/issues/2122) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 3 — P3 reach SOTA bar

## Context

Pre-#2122 adversarial coverage lived in two places:

1. The `adversarial-2025` fixture suite under `src/test-intelligence/fixtures/adversarial-2025/` — seven hand-rolled fixtures pinning each carrier the [`normalizeUntrustedContent`](../../src/test-intelligence/untrusted-content-normalizer.ts) layer drops (hidden Figma layers, zero-opacity, off-canvas, zero-fontsize, sentinel name, ADF-collapse, zero-width).
2. A small adversarial sub-suite inside [`hallucination-eval.ts`](../../src/test-intelligence/hallucination-eval.ts) that proves prompt-injection text inside an IR field cannot inflate the hallucination rate.

Together they cover the *carriers* the input-side normalizer recognises. But the AC for #2122 calls for a much broader, **categorical** corpus that also exercises:

- Output-side deny-list categories (shell, JNDI, XSS, command substitution, encoded payloads, dangerous URL schemes) handled by [`detectSuspiciousContent`](../../src/test-intelligence/semantic-content-sanitization.ts).
- Indirect-injection vectors not previously curated as a coherent set: Jira ADF bodies, custom markdown attachments, and bidirectional-control charset tricks.
- Conceptual attack classes (data exfiltration, instruction-following hijack, role confusion, oracle bypass, ranking manipulation, context stuffing) mapped to the deterministic defenses they should trip.

Per the parent epic's framing, the existing defense layers were already audited robust (no Critical/High in the security audit) — #2122 formalises the evidence by turning each attack class into a versioned fixture with a deterministic expected outcome, and gates CI on it.

## Decision

We add a top-level `fixtures/adversarial-corpus/` catalogue, a thin loader + gate module, and a node:test suite. The catalog is the single source of truth; the gate executes every entry against the appropriate defense layer at CI time; ADR + README pin the quarterly review checkpoint.

### 1. Catalog layout — `fixtures/adversarial-corpus/`

- [`catalog.json`](../../fixtures/adversarial-corpus/catalog.json) — versioned JSON with calendar `version` (`YYYY.MM.DD`), `lastReviewedAt`, `nextReviewDue`, `reviewCadence: "quarterly"`, generation provenance, declared categories, and 50+ entries.
- [`README.md`](../../fixtures/adversarial-corpus/README.md) — schema reference + quarterly-review process.

Per-entry shape (closed): `id`, `category` (one of 15), `title`, `payloadKind` (`markdown` | `text-field` | `jira-adf` | `figma-document` | `output-string`), `payload`, optional repeat annotations for context-stuffing, `expectedOutcome` (input-side carrier set or output-side deny-list category), `citation`.

### 2. Category coverage

The 15 declared categories trace 1:1 to the AC. The launch corpus ships 56 entries (≥ AC floor of 50), distributed:

| Category | Entries | Defense layer |
| --- | ---: | --- |
| `prompt_injection_direct` | 4 | input — markdown injection patterns |
| `prompt_injection_indirect_figma` | 5 | input — figma carriers (hidden / zero-op / off-canvas / sentinel / zero-fontsize) |
| `prompt_injection_indirect_jira` | 4 | input — ADF + secret/PII/zero-width |
| `prompt_injection_indirect_markdown` | 4 | input — markdown injection patterns |
| `data_exfiltration` | 4 | input — `redactHighRiskSecrets` (AWS, Slack, JWT, Bearer) |
| `instruction_following_hijack` | 4 | input — markdown injection patterns |
| `role_confusion` | 3 | input — markdown role-tag pattern |
| `output_side_shell` | 4 | output — `shell_metacharacters` |
| `output_side_jndi` | 3 | output — `jndi_log4shell` |
| `output_side_xss` | 4 | output — `script_tag`, `html_event_handler`, `dangerous_url_scheme` |
| `oracle_bypass` | 4 | output — `command_substitution` |
| `ranking_manipulation` | 3 | output — `encoded_payload_base64`, `encoded_payload_hex`, `dangerous_url_scheme` |
| `context_stuffing` | 3 | input — `elementsTruncated` byte cap |
| `charset_tricks_zero_width` | 4 | input — `zeroWidthCharacters` |
| `charset_tricks_rtl_override` | 3 | input — `zeroWidthCharacters` (post-#2122 widening) |

### 3. Bidi-override defense widening

`untrusted-content-normalizer.ts:ZERO_WIDTH_RE` previously matched only `U+200B`, `U+200C`, `U+200D`, `U+FEFF`. The corpus surfaced that bidirectional override / isolate codepoints (Trojan-Source, Boucher & Anderson 2021) survived a normalisation pass — visually flipping a label without leaving any deterministic trace.

We widened the class to also include `U+2028` LSEP, `U+2029` PSEP, `U+202A`–`U+202E` (embedding/override + pop), and `U+2066`–`U+2069` (isolate + pop). The persisted `zeroWidthCharacters` count name is preserved for backwards compatibility with consumers of the report contract — only the regex's character set widened. All 36 existing normalizer tests still pass byte-identically.

### 4. Loader, validator, and gate

[`src/test-intelligence/adversarial-corpus.ts`](../../src/test-intelligence/adversarial-corpus.ts) is a single, dependency-light module:

- `loadAdversarialCorpus(input?)` reads + parses + validates the catalog. Schema mismatches throw `AdversarialCorpusValidationError` with the JSON-Pointer-style path of the offending field.
- `runAdversarialCorpusGate(corpus)` dispatches each entry to its defense layer:
  - input-side → `normalizeUntrustedContent({ markdown | jiraAdf | figma | textFields })`, asserts `outcome` matches and every key in `nonZeroCounts` is `> 0`.
  - output-side → `detectSuspiciousContent(payload)`, asserts the returned `category` matches.
- `loadAndRunAdversarialCorpusGate()` is the convenience wrapper used by the CI test.
- `isAdversarialCorpusReviewOverdue(corpus, today)` is pure (no clock IO) so the test can assert review-cadence enforcement deterministically.

### 5. CI gate

[`adversarial-corpus.test.ts`](../../src/test-intelligence/adversarial-corpus.test.ts) is a `node:test` suite covering: schema shape, category coverage, ≥ 50 entries, unique ids, non-empty citations, design-time provenance (`mistral-large-3` from #2099, SME-reviewed), and the deterministic gate run. A synthetic-mismatch test confirms the gate surfaces failures rather than swallowing them. The suite ships under the standard `pnpm test` glob so a regression turns the build red.

### 6. Quarterly review

`lastReviewedAt` and `nextReviewDue` pin the cadence. The `nextReviewDue is in the future relative to lastReviewedAt` test enforces ordering at every CI run, and `isAdversarialCorpusReviewOverdue` is reserved for the upcoming quarterly-review job to fail loudly when the cadence is missed. The launch checkpoint:

- `lastReviewedAt`: 2026-05-10
- `nextReviewDue`: 2026-08-10

### 7. Provenance

The catalog records `generatedBy.model = "mistral-large-3"` and `generatedBy.modelIssueRef = "#2099"`. Generation happened **at design time** (the catalog itself is committed JSON; no model is invoked at gate time), and SME-review by the test-intelligence + security maintainers is encoded in `smeReviewers`. The validator rejects a catalog that drops either `designTime: true` or `smeReviewed: true`, so a future bulk-LLM regeneration cannot land without a renewed SME signoff.

## Consequences

**Closes acceptance criteria:**

- ✅ `fixtures/adversarial-corpus/` with versioned attack catalogue
- ✅ All 15 required categories present with at least one entry each
- ✅ Each entry: `{ id, category, payload, expectedOutcome, citation }`
- ✅ 56 entries (above the 50 minimum)
- ✅ CI gate: every attack must produce its expected outcome
- ✅ Quarterly review checkpoint (`reviewCadence: "quarterly"`, `nextReviewDue` enforced)
- ✅ `mistral-large-3` (#2099) used to **generate** candidate attacks at design-time; SME-reviewed before commit
- ✅ Documented in `docs/decisions/` (this ADR)

**Net surface change:**

- New file `fixtures/adversarial-corpus/catalog.json` + `README.md`.
- New module `src/test-intelligence/adversarial-corpus.ts` + `.test.ts`, additive re-exports from `src/test-intelligence/index.ts`.
- One additive widening in `untrusted-content-normalizer.ts:ZERO_WIDTH_RE`. Carrier name and report shape unchanged.

No `src/contracts/index.ts` types changed; no `TEST_INTELLIGENCE_CONTRACT_VERSION` bump. The corpus + gate are operator/CI-facing inside the test-intelligence namespace.

**Trade-offs:**

- *JSON, not TypeScript.* The catalog is data, not code; JSON keeps the diff trivial for SME reviewers and is consumable by future tooling without a TypeScript build step. The price is a hand-written validator instead of structural type-checking — paid for once in `validateAdversarialCorpus`.
- *Repeat annotations instead of inlined 32 KB blobs.* Context-stuffing entries store a small marker plus `payloadRepeatBytes`/`payloadAdfTextRepeatBytes` so the catalog stays under 50 KB and remains code-review-able. The runner inflates them deterministically at gate time.
- *No model at gate time.* The corpus is the committed output of a design-time generation step; the gate is a pure deterministic check. We accept that net-new attacks discovered in production must be added to the catalog through the quarterly-review process rather than auto-discovered.
- *`zeroWidthCharacters` count name kept despite the widened regex.* Renaming the count (e.g. `invisibleControlCharacters`) would have churned the persisted report contract for downstream consumers. We document the wider class in the source comment instead.
