# Reproducibility seal verification (Issue #2178)

This document is the auditor walk-through for the
`workspace-dev test-intelligence verify-seal` subcommand.

The harness emits `production-runner-evidence-seal.json`
(`#1990` family) for every run. The seal carries:

- The canonical filename list of every harness artifact in the run.
- The head-of-chain hash + chain length of the agent-harness checkpoint
  Merkle list (`#1944`).
- The FinOps `bySource` cost-breakdown content hash.
- The genealogy DAG content hash.
- Per-screen visual evidence hashes.
- Optional custom-context Markdown content hashes (`#1894`).

The seal is byte-stable per run for replay determinism (`#1944`).

`verify-seal` is the **self-contained** verifier. It runs against a
hand-off bundle (USB stick, archive, or a directory) and confirms the
seal without access to the original run dir or the operator's signing
infrastructure.

## What the verifier checks

1. **Per-artifact SHA-256.** Every artifact filename listed by the
   seal is recomputed from disk. Output: `OK`, `TAMPERED`, or
   `MISSING` per artifact. Files in the bundle that the seal does not
   reference are reported as `EXTRA` (informational; not a failure).
2. **Merkle root.** The verifier rebuilds a Merkle tree over the
   sorted `(filename, sha256)` leaves of every referenced artifact and
   reports the root. Compare against the operator-published value with
   `--expected-merkle-root <hex>`.
3. **HMAC over the canonical seal manifest.** HMAC-SHA256 over
   `canonicalJson(seal)` using the supplied key (`--key <path>`) or
   the deterministic default key
   (`sha256("workspace-dev:seal-verify:v1")`). The verifier prints
   the resulting HMAC and a 16-hex-char key fingerprint. Compare
   against the operator-published value with
   `--expected-hmac <hex>`.
4. **FinOps `bySource` hash cross-check.** Recomputes the
   per-source-cost-breakdown hash from the FinOps report and matches
   it against the seal value.
5. **Genealogy DAG content hash cross-check.** Recomputes the SHA-256
   of `genealogy.json` and matches it against the seal value.
6. **Provenance graph cross-link.** When `provenance.jsonld` is in the
   bundle, every `ti:sha256` annotation that targets a seal-referenced
   artifact must agree with the seal's view of that artifact. Use
   `verify-provenance` for the full Merkle-root verification of the
   provenance graph itself.
7. **Region attestation cross-check.** When
   `region-attestations.json` (`W6-3` / `#2177`) is in the bundle, the
   verifier confirms every attested `deploymentId` is present in the
   FinOps `bySource` deployment record.

## CLI usage

```sh
pnpm exec tsx src/cli.ts test-intelligence verify-seal \
  --bundle <path> \
  [--key <path>] \
  [--expected-hmac <hex>] \
  [--expected-merkle-root <hex>] \
  [--json] \
  [--output <path>]
```

`--bundle` accepts:

- A directory containing `production-runner-evidence-seal.json` (an
  existing run dir or one nested level inside the supplied dir).
- A `.tar` / `.tar.gz` / `.tgz` archive — extracted via the universal
  POSIX `tar` binary.
- A `.zip` archive — extracted via the universal POSIX `unzip` binary.

If `tar` or `unzip` is not on the auditor's `PATH`, extract the
archive manually and pass the resulting directory.

### Exit codes

- `0` — every artifact verified, all cross-checks consistent.
- `1` — operator misuse (missing flag, bad path, malformed hex flag).
- `2` — at least one tamper, missing artifact, mismatched expected
  HMAC / Merkle root, or cross-check failure.

### Output formats

The default human-readable report enumerates artifacts with
`OK / TAMPERED / MISSING / EXTRA` tags, lists cross-check results,
and (when failed) a structured failure list. Pass `--json` for the
canonical machine-readable JSON summary, and `--output <path>` to
write the report to a file instead of stdout.

## Standalone executable hand-off

Auditors often work air-gapped. Two officially supported hand-off
paths:

### 1. `pnpm` package install

```sh
git clone https://github.com/oscharko-dev/workspace-dev.git
cd workspace-dev
pnpm install --frozen-lockfile --prefer-offline
pnpm exec tsx src/cli.ts test-intelligence verify-seal --bundle <path>
```

Use this path when the auditor's host has a Node.js + pnpm toolchain.
The verifier itself has no extra Node dependencies beyond what the
runtime already pins.

### 2. Single-file `bun build --compile` executable

```sh
# On a build host with bun installed:
bun build src/cli.ts \
  --compile \
  --target=bun-linux-x64 \
  --outfile workspace-dev-verify-seal
# Hand off the resulting `workspace-dev-verify-seal` binary alongside
# the bundle, the operator key, and the published HMAC + Merkle root.
./workspace-dev-verify-seal test-intelligence verify-seal --bundle <path>
```

Swap `--target` for `bun-darwin-arm64`, `bun-darwin-x64`, or
`bun-linux-arm64` to match the auditor's hardware.

`pkg` (`@yao-pkg/pkg`) is an alternative when the auditor cannot run
`bun`-compiled binaries:

```sh
pnpm dlx @yao-pkg/pkg . \
  --targets node22-linux-x64 \
  --output workspace-dev-verify-seal
./workspace-dev-verify-seal test-intelligence verify-seal --bundle <path>
```

Both binaries embed a JS runtime and resolve `tar` / `unzip` from the
auditor's `PATH` — install them with `apt-get`, `brew`, or the
platform package manager on the air-gapped host before running.

## Operator publishing checklist

For each release that hands a sealed bundle to an external auditor,
publish out-of-band:

1. The bundle archive (`.tar.gz` recommended for cross-platform
   portability).
2. The HMAC-SHA256 hex digest of the canonical seal manifest, computed
   with the documented operator key.
3. The Merkle root hex digest produced by `verify-seal` against the
   bundle.
4. The 16-hex-char key fingerprint produced by `verify-seal` so the
   auditor can confirm they are using the same key.

## CI hard gate `G9_REPLAY_DETERMINISM_VERIFIED`

Every CI production-runner job replays the seal it just produced
through this verifier in-process before declaring the run complete
(`G9_REPLAY_DETERMINISM_VERIFIED`). Any drift between the in-process
seal-build path and the auditor-facing verifier fails CI immediately
— there is no escape hatch.

The replay runs after `G7` (provenance Merkle root agreement) and
after the existing post-write seal verification, so a green CI build
guarantees the bundle an external auditor receives will pass
`verify-seal` byte-for-byte.

## Backward compatibility

The verifier reads the existing seal schema (`schemaVersion = "1.0.0"`)
and does not require any new fields. It verifies seals produced by
past run sets — `G0`, `I0`, `J0`, `K0`, and `M0` multi-dataset —
without modification. The Merkle root and HMAC are derived **at verify
time** from the canonical seal manifest contents; they are not stored
in the seal itself.

## References

- Parent epic: [#2167](https://github.com/oscharko-dev/workspace-dev/issues/2167) — Test-Intelligence Tier-1 Production Roadmap (Wave 6)
- Predecessors: [#1944](https://github.com/oscharko-dev/workspace-dev/issues/1944) (replay determinism), [#2037](https://github.com/oscharko-dev/workspace-dev/issues/2037) (PROV-DM + Merkle), [#1990](https://github.com/oscharko-dev/workspace-dev/issues/1990) (evidence consistency)
- Standards: DORA Art. 28 (auditability), EU AI Act Art. 12 (record-keeping)
