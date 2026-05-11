# Subprocessor Register — JSON schema reference

**Issue:** #2174 — Test-Intelligence Wave 5 (DORA Art. 28 machine-
verifiable subprocessor register).

**Artifact filename:** `subprocessor-register.json`
(`SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME`).

**Artifact schema version:** `1.0.0`
(`SUBPROCESSOR_REGISTER_SCHEMA_VERSION`).

**Register content version:** `1.0.0`
(`SUBPROCESSOR_REGISTER_VERSION`; tracks the documented register
content; bumped on every register-content change).

This document describes the typed shape of the per-run
`subprocessor-register.json` artifact emitted by the test-intelligence
production runner. The human-readable register at
`docs/dora/subprocessor-register.md` is auto-generated from the same TS
source-of-truth (`src/test-intelligence/subprocessor-register.ts`); the
JSON artifact is the **machine-verifiable** form an auditor can cross-
reference programmatically against
`compliance-annotations.json`,
`compliance-coverage-report.json`, and the run's `provenance.jsonld`.

---

## 1. Top-level shape

```ts
interface SubprocessorRegister {
  readonly schemaVersion: typeof SUBPROCESSOR_REGISTER_SCHEMA_VERSION;
  readonly registerVersion: typeof SUBPROCESSOR_REGISTER_VERSION;
  readonly generatedAt: string;
  readonly subprocessors: readonly SubprocessorEntry[];
  readonly crossBorderTransfers: readonly CrossBorderTransferEntry[];
  readonly merkleRoot: string;
}
```

| Field                  | Type                                   | Notes                                                                                                                  |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | string literal                         | Pinned to `SUBPROCESSOR_REGISTER_SCHEMA_VERSION`. Bumped on breaking shape changes.                                    |
| `registerVersion`      | string literal                         | Pinned to `SUBPROCESSOR_REGISTER_VERSION`. Bumped on every content change to the documented register.                  |
| `generatedAt`          | ISO-8601 string                        | Per-run timestamp at emission time.                                                                                    |
| `subprocessors`        | readonly `SubprocessorEntry[]`         | Sorted ascending by `subprocessorId`.                                                                                  |
| `crossBorderTransfers` | readonly `CrossBorderTransferEntry[]`  | Sorted ascending by `transferId`.                                                                                      |
| `merkleRoot`           | 64-char lowercase hex string (SHA-256) | SHA-256 binary Merkle root over the canonical-JSON serialisation of the (sorted) entry list. Subprocessors first, then transfers. Empty list → SHA-256 of the empty string. |

The artifact is emitted with a single trailing newline so the on-disk
SHA-256 is reproducible by `git hash-object` (matches every other
test-intelligence artifact convention).

---

## 2. `SubprocessorEntry`

```ts
interface SubprocessorEntry {
  readonly subprocessorId: string;
  readonly legalName: string;
  readonly purpose: string;
  readonly hostingRegion: SupportedHostingRegion;
  readonly dataCategories: readonly string[];
  readonly contractualSafeguards: readonly string[];
  readonly soc2ReportRef?: string;
  readonly iso27001ReportRef?: string;
  readonly retentionPolicy: string;
  readonly addedAt: string;
}
```

| Field                   | Required | Notes                                                                                                                                                                        |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subprocessorId`        | yes      | Stable kebab-case identifier. Used as the cross-link key cited from `compliance-annotations.json`.                                                                           |
| `legalName`             | yes      | Contractual / legal name (operator-selected vendor where the package itself ships no default).                                                                               |
| `purpose`               | yes      | One-sentence purpose in the test-intelligence pipeline.                                                                                                                      |
| `hostingRegion`         | yes      | One of `SUPPORTED_HOSTING_REGIONS`.                                                                                                                                          |
| `dataCategories`        | yes      | Sorted, deduplicated data-classification tokens (e.g. `"personal-data-pseudonymised"`, `"evidence-metadata-only"`).                                                          |
| `contractualSafeguards` | yes      | Sorted, deduplicated contractual safeguard citations (e.g. `"DPA-operator"`, `"SCC-2021-Module-2"`).                                                                         |
| `soc2ReportRef`         | no       | Optional SOC 2 Type II citation. Omitted when not applicable.                                                                                                                |
| `iso27001ReportRef`     | no       | Optional ISO/IEC 27001 certificate citation. Omitted when not applicable.                                                                                                    |
| `retentionPolicy`       | yes      | Retention policy floor the operator must meet.                                                                                                                               |
| `addedAt`               | yes      | ISO-8601 timestamp the entry was first added to the register. Pinned in the TS source so `addedAt` does not regenerate every run.                                            |

---

## 3. `CrossBorderTransferEntry`

```ts
interface CrossBorderTransferEntry {
  readonly transferId: string;
  readonly sourceRegion: SupportedHostingRegion;
  readonly destinationRegion: SupportedHostingRegion;
  readonly transferMechanism:
    | "scc-2021"
    | "adequacy-decision"
    | "bcr"
    | "consent"
    | "other";
  readonly mechanismCitation: string;
  readonly purpose: string;
  readonly approvedAt: string;
}
```

`transferMechanism` values:

| Value                | Meaning                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `scc-2021`           | 2021 EU Standard Contractual Clauses (Module 2 / 3 as appropriate; the citation field names the module). |
| `adequacy-decision`  | Intra-EEA flow or Commission-recognised third-country adequacy decision.                                 |
| `bcr`                | Binding Corporate Rules.                                                                                 |
| `consent`            | GDPR Art. 49(1)(a) explicit consent (rare and narrow).                                                   |
| `other`              | Reserved for derogations the operator documents in their own register.                                   |

Even intra-EEA transfers are recorded for replay verifiability so an
auditor can reconstruct which transfer mechanism was active at a given
run timestamp.

---

## 4. Cross-links

The `subprocessor-register.json` artifact is consumed by:

- **`compliance-annotations.json`** — every annotation that references a
  subprocessor cites its `subprocessorId`; the annotation artifact
  carries a top-level
  `subprocessorRegisterRef: { artifactFilename, schemaVersion, registerVersion, merkleRoot }`
  pinning the register that was active for the run.
- **`provenance.jsonld`** — the per-run record carries
  `ti:subprocessorRegisterMerkleRoot` at the bundle level and adds a
  `prov:Entity` artifact node for the register file with the same SHA-256
  digest the JSON-LD verifier already enforces for every other run-bundle
  artifact.
- **`wave1-validation-evidence-manifest.json`** — already carries
  `subprocessorRegisterVersion` (Issue #2113); the new artifact appears
  in the manifest's `artifacts[]` list with category `"manifest"`.

---

## 5. Determinism guarantees

- **Byte-stable canonical JSON.** Identical inputs produce identical
  artifact bytes. Object keys are sorted; arrays are sorted by stable
  identifier; redundant whitespace is stripped.
- **Reproducible Merkle root.** The root is a SHA-256 binary tree over
  the canonical-JSON-serialised entries. The construction matches
  `provenance-graph.ts` (Issue #2037) so a verifier can cross-check the
  register against the provenance graph without a second algorithm
  citation.
- **Build-time Markdown parity.** The on-disk
  `docs/dora/subprocessor-register.md` is regenerated from the same TS
  source-of-truth at build time; CI fails on drift.

---

## 6. See also

- `docs/dora/subprocessor-register.md` — auto-generated human-readable
  register.
- `docs/dpia/cross-border-transfer.md` — paired ADR for the cross-
  border transfer story per region pair.
- `src/contracts/index.ts` — `SubprocessorRegister`,
  `SubprocessorEntry`, `CrossBorderTransferEntry`, and the
  `SUPPORTED_HOSTING_REGIONS` constant.
- `src/test-intelligence/subprocessor-register.ts` — canonical TS
  source-of-truth, builder, and Markdown renderer.
- `scripts/render-subprocessor-register.mts` — build-time Markdown
  regenerator and CI quality gate (`--check`).
