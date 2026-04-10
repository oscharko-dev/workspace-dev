# ADR-0001: Multi-Screen Visual Comparison

- **Status**: Accepted
- **Date**: 2026-04-10
- **Issue**: #837
- **Deciders**: Lead session (autonomous workflow)

## Context

Issue #837 asks the visual benchmark to compare multiple screens per Figma fixture in a single run, produce per-screen scores, an aggregate, and flag missing/added screens. The persistence layer is _already_ partly screen-aware:

- `baseline.json` is schema `version: 3`, keyed by `fixtureId + screenId` with optional `screenName`. Parser lives in `integration/visual-benchmark-runner.ts:255-339` and the committed file is `integration/fixtures/visual-benchmark/baseline.json:1-36`.
- `history.json` is `version: 2`, same shape; parser in `integration/visual-benchmark-history.ts:44-130`, committed file `integration/fixtures/visual-benchmark/history.json:1-146`.
- `VisualBenchmarkScoreEntry` and `VisualBenchmarkDelta` already carry optional `screenId` / `screenName` (`integration/visual-benchmark-runner.ts:57-79`).
- Trend summaries and regression alerts already thread `screenId` through (`integration/visual-benchmark-regression.ts:20-43`).

What is **not** screen-aware today:

1. **Physical fixture layout** — each `integration/fixtures/visual-benchmark/<fixture-id>/` still holds exactly one `reference.png`, one `figma.json`, and a `metadata.json` (`version: 1`) whose `source.nodeId` names a single Figma node (`integration/fixtures/visual-benchmark/simple-form/metadata.json:1-19`). See fixture IO helpers at `integration/visual-benchmark.helpers.ts:38-46,233-246`.
2. **Enumeration** — `listVisualBenchmarkFixtureIds` returns directory names (`integration/visual-benchmark.helpers.ts:248-254`). There is no screen enumerator. `loadVisualQualityScreenContext` derives "the one screen" from `metadata.source.nodeId` (`integration/visual-benchmark-runner.ts:776-785`).
3. **Runner contract** — `runVisualBenchmarkFixture` returns a single `{ fixtureId, score }` (`integration/visual-benchmark.execution.ts:390-399`). `executeVisualBenchmarkFixture` pulls _one_ `actual.png` out of `visual-quality/` per fixture (`integration/visual-benchmark.execution.ts:331-382`). The pipeline under `validate.project` currently captures _one_ screenshot per generated project.
4. **Security guards** — `assertAllowedFixtureId` forbids path separators and `..` segments (`integration/visual-benchmark.helpers.ts:195-217`). There is no equivalent `assertAllowedScreenId`. Screen IDs are Figma node IDs of the form `2:10001` containing a colon — a character whose filesystem handling differs per OS (Windows ADS, macOS display-as-slash, etc).
5. **Per-job mode** — `ui-src/e2e/visual-parity.live.spec.ts:17-25` still points at a single baseline file `ui-src/e2e/fixtures/visual-parity-soll.png`. It is an independent Playwright test and does NOT share code with the benchmark runner.

Five fixtures are committed; each has exactly one screen; the CI workflow `.github/workflows/visual-benchmark.yml` runs `pnpm benchmark:visual` on every PR to `dev`. A design that requires re-shooting those references would stall on CI for days. A design that requires renaming directories would churn every fixture at once.

## Decision Drivers

1. **Do not re-shoot references on the merge commit.** The current committed `reference.png` files are the source of truth and carry review history. Migration must be in-place.
2. **Persistence is stable; fan-out is the gap.** `baseline.json` v3 and `history.json` v2 already model the target shape. The ADR must not re-version them.
3. **Filesystem safety first.** Figma node IDs (`2:10001`) are not safe filenames; a screen-name-based path is even worse (Unicode, German umlauts, spaces, slashes). The security posture must be explicit.
4. **Backward compatible single-screen fixtures.** A fixture with exactly one screen must continue to work without a `screens[]` array in its metadata; the runner must still emit one row per single-screen fixture.
5. **Reversibility.** If multi-screen fan-out turns out to have a bad signal-to-noise ratio (e.g. one broken screen poisoning the aggregate), the team must be able to revert the enumeration change without touching persistence.
6. **No hypothetical generality.** This ADR must support the documented five fixtures and the next realistic case (2-5 screens per fixture), not a 200-screen mega-fixture.
7. **Single source of truth for "what screens exist in a fixture".** Files-on-disk and declared lists must not diverge silently.

## Considered Options

### Q1 — Physical fixture layout

#### Option 1A: Sibling PNGs with screen name as filename (`<fixture-id>/<screen-name>.png`)

- **Pros**: Matches the literal text of #837 ("`fixtures/visual-benchmark/<fixture-name>/<screen-name>.png`"). One less directory level.
- **Cons**: Screen names from Figma contain spaces, German umlauts, semicolons, slashes, and emoji. The committed `simple-form` screen name is `"Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1"` — that is not a safe filename on Windows or case-insensitive macOS, and sanitization introduces a lossy mapping that makes lookups ambiguous. Breaks the invariant "name is stable, filename is stable". No home for a second asset per screen (future `mask.png`, `report.json`).
- **Rejection rationale**: Unsafe + lossy. Violates security driver #3.

#### Option 1B: Screens subdirectory keyed by screen ID (`<fixture-id>/screens/<screen-id>/reference.png`) ← CHOSEN

- **Pros**: Screen ID (Figma node ID) is a stable, opaque identifier that does not change when designers rename a frame. Directory-per-screen gives each screen a natural home for `reference.png`, a future `mask.png`, and last-run artifacts mirrored from `artifacts/visual-benchmark/last-run/<fixture-id>/screens/<screen-id>/`. Single normalization point (strip the `:` for filesystem safety) with a deterministic, reversible mapping. Co-locating `metadata.json` at `<fixture-id>/metadata.json` keeps the per-fixture manifest in place. Single-screen fixtures can remain at `<fixture-id>/reference.png` (see migration).
- **Cons**: Adds a directory level. Requires a deterministic `screenId → path-safe token` mapping. Slightly higher discoverability cost for humans browsing files — mitigated by `metadata.json` listing human-readable `screenName`.
- **Why chosen**: Satisfies drivers 3, 4, 5 and 7. The opaque-ID layout is how every production visual-regression system we reviewed works (Percy, Chromatic, Playwright's own `__snapshots__`). Reversible: the layout can be abandoned by deleting the `screens/` subtree and renaming, without touching persistence.

#### Option 1C: Flat layout with manifest mapping (`<fixture-id>/ref-001.png` + `metadata.json` → name/id)

- **Pros**: Simplest possible filenames. No colon handling.
- **Cons**: The manifest becomes the _only_ source of truth for "which PNG is which screen". A git merge on `metadata.json` that leaves the file list consistent but swaps two mappings silently inverts references. Debugging relies on reading the manifest every time.
- **Rejection rationale**: Violates driver 7 (single source of truth on disk). Too easy to break through an innocent merge.

### Q2 — Screen enumeration

#### Option 2A: Enumerate from files on disk (`readdir screens/`)

- **Pros**: Zero duplication, no manifest drift. Obvious to anyone.
- **Cons**: No room for a `screenName` or a `weight` — would require stuffing those into the directory name (back to Option 1A's problems). No way to declare "this fixture has 3 screens, one is currently missing and that is an error" vs "this fixture has 3 screens, one is intentionally staged" because the file list _is_ the declaration.
- **Rejection rationale**: Blocks missing-screen detection (driver for Q5).

#### Option 2B: Declared in `metadata.json` `screens[]` array ← CHOSEN

- **Pros**: Single source of truth, co-located with the fixture's existing metadata, extendable to `screenName`, `weight`, `viewport`, `nodeId`. Schema evolution is a bounded patch (`version: 1 → 2`). Reads are one `JSON.parse`. The existing `metadata.json` already lives at `<fixture-id>/metadata.json` and carries `source.nodeId` / `source.nodeName` / `viewport` — we are extending, not introducing.
- **Cons**: Files on disk can drift from the declaration. Resolved by a strict cross-check in the runner: for each declared screen, the file must exist; for each file, it must be declared. Any mismatch is a hard error during baseline verification and a warn during benchmark runs.
- **Why chosen**: Satisfies drivers 1, 5, 7. Keeps the disk layout dumb and puts all semantics in one JSON file.

#### Option 2C: Derive from `figma.json` canvas children

- **Pros**: No duplication between design source and fixture metadata.
- **Cons**: The frozen `figma.json` already goes through `normalizeBenchmarkFigmaInput` at `integration/visual-benchmark.execution.ts:76-132` because the canvas structure is _not_ the runtime structure. The benchmark needs an explicit whitelist: we do not want renaming a frame in Figma to silently add or remove a benchmark screen. Also forces the runner to parse `figma.json` just to enumerate — a cost we pay per run.
- **Rejection rationale**: Couples the fixture's identity to a designer-editable field, which the whole frozen-fixture layer exists to decouple.

### Q3 — Runner return contract

#### Option 3A: Keep `runVisualBenchmarkFixture` returning one score; add a new `runVisualBenchmarkFixtureScreens` that returns N

- **Pros**: No breaking change. Callers who want one score call the old function.
- **Cons**: The "one score" flavor has to invent an aggregate over its own N-screen fan-out, so we end up with two parallel implementations. Every extension (`thresholdResult`, artifacts, screen context) now has two homes. Violates single-source-of-truth for the fan-out logic.
- **Rejection rationale**: Permanent code duplication cost for a migration window benefit.

#### Option 3B: Change the contract to return `{ fixtureId, screens: VisualBenchmarkScreenScore[], aggregateScore }` ← CHOSEN

- **Pros**: One fan-out path. `VisualBenchmarkScoreEntry` (the persisted row) stays 1:1 with a screen — no change to baseline / history schemas. The runner's `VisualBenchmarkResult.deltas` already models per-screen rows, so the table renderer in `formatVisualBenchmarkTable` (`integration/visual-benchmark-runner.ts:930-987`) degenerates naturally to "one row per screen across all fixtures plus an overall average". Aggregates computed from the screen scores. Single-screen fixtures render as "one row per fixture" because that is what they are.
- **Cons**: Every in-process caller of `runVisualBenchmarkFixture` needs to touch one line. Only one production caller exists (`computeVisualBenchmarkScores` at `integration/visual-benchmark-runner.ts:787-806`). Tests will need an update.
- **Why chosen**: Eliminates duplication. Driver 2: the persistence shape is already correct — the runner just needs to stop collapsing to one score per fixture.

#### Option 3C: Keep one score per fixture; compute the fixture-level aggregate inside the execution layer and expose screens only in artifacts

- **Pros**: No churn to the runner contract at all.
- **Cons**: The table, the alerts, and the trend summaries all lose their per-screen signal. The persistence schema is screen-keyed and would be forced back down to fixture-keyed at display time, which is worse than doing nothing.
- **Rejection rationale**: Throws away the screen-keyed persistence we already paid for.

### Q4 — Aggregate weighting

#### Option 4A: Arithmetic mean over screen scores — `mean(screenScores)`

- **Pros**: Simplest possible formula. Matches the current `overallCurrent` calculation at `integration/visual-benchmark-runner.ts:873-875`. No configuration surface.
- **Cons**: A 10-pixel header screen and a 5000-pixel dashboard screen get equal vote.
- **Observation**: In the current data, all five fixtures have comparable viewports, so mean and weighted-by-area agree within ±1 point.

#### Option 4B: Pixel-area-weighted mean — `Σ (w_i × s_i) / Σ w_i, w_i = width_i × height_i`

- **Pros**: A small popover does not drag the aggregate the same as a full-page dashboard.
- **Cons**: Inverted incentive: a fixture with one tiny screen and one huge one will have its small-screen regressions nearly invisible. Breaks local reasoning ("simple-form dropped 10 but the aggregate only moved 1"). Requires reading viewport on every aggregation.
- **Rejection rationale**: Obscures regressions in small-but-important screens.

#### Option 4C: Configurable per-screen weight with equal-mean default ← CHOSEN

- **Decision**: Default aggregate formula is `mean(screenScores)`. Each screen entry in `metadata.json` MAY declare an optional `weight: number` (positive, non-zero); if any screen in a fixture declares a weight, the aggregate becomes `Σ (w_i × s_i) / Σ w_i` over only that fixture's screens. If no weight is declared, the mean is used. The fixture-level aggregate is what lands in history/baseline/table; the benchmark-overall average is the mean of the fixture aggregates (same shape as today).
- **Pros**: Zero-config path is the obvious path. Teams can escalate individual fixtures without a global config change. The formula is documented in one place (`metadata.json` schema).
- **Cons**: Two code paths. Mitigated by keeping both in the same small function with one branch.
- **Why chosen**: Does not pre-commit to a weighting philosophy. Driver 6: the minimum viable aggregate is the mean; a weight is escape-hatch for the first fixture that needs it.

### Q5 — Missing / added screen handling

#### Option 5A: Error on any mismatch (block CI)

- **Pros**: Hard guarantee that baseline and disk agree.
- **Cons**: Makes every intentional screen addition a two-PR dance: PR1 adds baseline entry, PR2 adds the PNG. Brittle.
- **Rejection rationale**: Process friction without a proportional benefit.

#### Option 5B: Silently skip missing; silently score added screens ← CHOSEN FOR "added"

- **Pros**: Benchmark run never fails from a screen mismatch.
- **Cons**: "Silently skip missing" is exactly how drift goes unnoticed.
- **Rejection rationale for "missing"**: Silent is wrong.

#### Option 5C: Warn + emit `KpiAlert` + degrade gracefully ← CHOSEN (mixed)

- **Decision**:
  - **Declared in `metadata.json` but no `reference.png` on disk**: emit `KpiAlert { code: "ALERT_VISUAL_BENCHMARK_MISSING_SCREEN", severity: "warn" }`. Skip that screen from the fixture aggregate. Do not fail the run. The baseline entry (if present) is left intact — deleting it is a separate, deliberate baseline action.
  - **`reference.png` on disk but not declared in `metadata.json`**: emit `KpiAlert { code: "ALERT_VISUAL_BENCHMARK_ORPHAN_SCREEN", severity: "warn" }`. Do not score. Do not delete. This catches filesystem drift without punishing intentional reference updates mid-PR.
  - **Declared AND on disk but not in `baseline.json`**: score it. Persist it on next baseline update. `indicator: "unavailable"`. This is exactly how the current delta computation handles a new fixture (`integration/visual-benchmark-runner.ts:844-846`).
  - **In `baseline.json` but not declared in `metadata.json` for a currently-executing fixture**: emit `KpiAlert { code: "ALERT_VISUAL_BENCHMARK_STALE_BASELINE", severity: "warn" }`. Do not delete. The `pnpm visual:baseline update` flow is the only code path that deletes a baseline entry.
  - **Exit code**: warnings do NOT fail CI by default. A future `--strict-missing` flag can promote warnings to failures; out of scope for this ADR.
- **Why chosen**: Aligns with the existing `ALERT_VISUAL_QUALITY_DROP` pattern (`integration/visual-benchmark-regression.ts:145-154`). Alerts are machine-readable and route through the existing KPI pipeline. Warn, don't fail, don't corrupt.

### Q6 — Per-job mode extension

#### Option 6A: Extend `visual-parity.live.spec.ts` to loop over multiple baselines

- **Pros**: Direct.
- **Cons**: Creates a second implementation of "enumerate screens" inside a Playwright test. The Playwright test is already gated on `INSPECTOR_LIVE_E2E=1` and only runs when explicit live tokens are provided. Multi-screen generation in a per-job live path has deeper dependencies (the live job must actually produce N screenshots for N screens) that belong to the validate-project service, not this ADR.
- **Rejection rationale**: Scope creep into the per-job pipeline.

#### Option 6B: Leave per-job mode untouched in this ADR; add an explicit non-goal ← CHOSEN

- **Decision**: Per-job mode (`ui-src/e2e/visual-parity.live.spec.ts` and its single `visual-parity-soll.png` at `ui-src/e2e/fixtures/`) remains single-screen. Multi-screen for per-job mode is tracked as a follow-up that belongs to the `validate.project` service and is not in this ADR's scope. The benchmark runner is the only code path that fans out over screens.
- **Why chosen**: Keeps ADR-0001 focused on one decision. Driver 6: do not design for a use case that has not been asked for concretely.

#### Option 6C: Unify both paths behind a shared "screen enumerator" abstraction

- **Pros**: DRY.
- **Cons**: Premature — there are exactly two usages and they have different lifecycle constraints (benchmark is offline + frozen; per-job is live + on-demand).
- **Rejection rationale**: Rule of three. Not enough concrete call sites to justify extraction.

### Q7 — Security: screen ID to path mapping

#### Option 7A: Use raw screen ID as directory name

- **Cons**: Figma node IDs contain `:`. On Windows the `:` is reserved (NTFS Alternate Data Streams); on macOS the Finder displays `:` as `/`; git handles it but tooling often does not. Cross-platform foot-gun.
- **Rejection rationale**: Cross-platform hazard.

#### Option 7B: Hash the screen ID (`sha256(screenId).slice(0, 16)`)

- **Cons**: Opaque directory names; impossible to grep fixtures by screen. Requires a manifest to reverse the mapping.
- **Rejection rationale**: Unreviewable file layout.

#### Option 7C: Deterministic safe token with a strict allow-list ← CHOSEN

- **Decision**:
  - Define `toScreenIdToken(screenId: string): string` that replaces `:` with `_` and nothing else. Example: `"2:10001" → "2_10001"`.
  - Define `assertAllowedScreenId(value: string): string` analogous to `assertAllowedFixtureId`:
    - rejects empty / whitespace-only
    - rejects absolute paths
    - rejects any character outside `[A-Za-z0-9:_\-]` (explicitly rejects `/`, `\`, `.`, spaces, Unicode, and all path-traversal sequences)
    - rejects `..` as a substring
    - returns the trimmed original ID (NOT the token) for use as a map key
  - The path-safe token is ONLY used to form directory names. All in-memory, on-JSON, and on-alert references use the raw screen ID.
  - `resolveVisualBenchmarkScreenPaths(fixtureId, screenId)` calls `assertAllowedFixtureId` AND `assertAllowedScreenId` before joining paths. Double validation catches bugs where one helper is bypassed.
  - `assertAllowedScreenId` lives next to `assertAllowedFixtureId` in `integration/visual-benchmark.helpers.ts` so the two guards are reviewed together.
- **Pros**: Reversible, greppable, cross-platform safe, narrow allow-list. Mirrors the existing `assertAllowedFixtureId` posture.
- **Cons**: Restricts screen IDs to Figma's actual format (`<frameNum>:<nodeNum>`) — which is what Figma emits. If Figma ever changes its ID format to include unusual characters, this guard has to be updated deliberately (a feature, not a bug).
- **Why chosen**: Smallest attack surface. Explicit allow-list is auditable.

### Q8 — Migration path

#### Option 8A: Big-bang — rewrite all fixtures to the new layout in the introducing PR

- **Pros**: No dual-read code.
- **Cons**: Requires re-shooting or moving five `reference.png` files in one PR. Violates driver 1. Breaks the commit boundary that gives git blame context to past baseline moves.
- **Rejection rationale**: Fails driver 1.

#### Option 8B: Dual-path layout — accept both legacy `<fixture-id>/reference.png` AND new `<fixture-id>/screens/<token>/reference.png`, choose based on `metadata.json` shape ← CHOSEN

- **Decision**:
  - `metadata.json` grows `version: 2`. Old `version: 1` files continue to parse as "implicit single-screen fixture" (same `source.nodeId` used as the single screen's ID and name).
  - Physical layout: if `metadata.version === 1` OR `metadata.screens` is undefined OR `metadata.screens.length === 1`, the runner reads from `<fixture-id>/reference.png` (legacy path). If `metadata.screens.length > 1`, the runner reads from `<fixture-id>/screens/<token>/reference.png` for each declared screen.
  - This preserves all 5 committed fixtures bit-identically on the merge commit.
  - When a team adds a second screen to a fixture, they run a one-shot `pnpm visual:baseline migrate --fixture <id>` (implementor's task, not in this ADR) that:
    1. moves `<fixture-id>/reference.png` to `<fixture-id>/screens/<token-for-first-screen>/reference.png`
    2. rewrites `metadata.json` to `version: 2` with a populated `screens[]` array
    3. shoots a fresh `reference.png` for the second screen
  - Only fixtures that need multi-screen pay the migration cost, and they pay it at the moment they need it, not on the merge commit.
- **Pros**: Zero-churn merge. Lazy migration. One-fixture-at-a-time blast radius. Legacy path is <20 lines of branching in `resolveVisualBenchmarkFixturePaths`.
- **Cons**: Dual-path reader code lives until the last fixture migrates. Acceptable — the branch is tiny.
- **Why chosen**: Satisfies driver 1 absolutely.

#### Option 8C: Immediate migration with a shim — rewrite all fixtures but keep an alias file

- **Pros**: Single physical layout post-merge.
- **Cons**: Still re-shoots references (or moves files, changing hashes of commits that referenced them). Aliasing inside git is worse than a dual-reader.
- **Rejection rationale**: Maximum churn for minimum benefit.

## Decision

We will extend the visual benchmark with the following architecture:

**Physical layout** (Q1-B + Q8-B): committed fixtures continue to live at `integration/fixtures/visual-benchmark/<fixture-id>/reference.png` while `metadata.version === 1`. Multi-screen fixtures adopt `integration/fixtures/visual-benchmark/<fixture-id>/screens/<screenIdToken>/reference.png` and bump `metadata.version` to `2`. Single-screen fixtures may remain on the legacy path indefinitely.

**Metadata schema** (`metadata.json` v2) adds an optional `screens` array. Each entry is `{ screenId: string, screenName: string, nodeId: string, viewport: { width: number, height: number }, weight?: number }`. When `version === 1`, the runner synthesizes a one-element `screens[]` from the existing `source.nodeId` / `source.nodeName` / `viewport`, so v1 and v2 are operationally identical for single-screen fixtures.

**Enumeration** (Q2-B): the declared `screens[]` array in `metadata.json` is the single source of truth. Files on disk must match declared entries; mismatches are reported via `KpiAlert` (see Q5).

**Runner contract** (Q3-B): `runVisualBenchmarkFixture` returns `{ fixtureId, screens: VisualBenchmarkScreenScore[], aggregateScore: number }`. The persisted `VisualBenchmarkScoreEntry` shape does not change (it is already per-screen at `integration/visual-benchmark-runner.ts:57-62`). The CLI table renders one row per screen across all fixtures plus an overall average, unchanged for single-screen fixtures.

**Aggregate weighting** (Q4-C): default is arithmetic mean over a fixture's screen scores: `aggregateFixture = mean(screenScores)`. If any screen in a fixture declares an optional `weight > 0`, the fixture aggregate becomes `Σ (w_i × s_i) / Σ w_i`. The benchmark-wide overall average is the mean of fixture aggregates — same shape as the current `overallCurrent` at `integration/visual-benchmark-runner.ts:873-875`.

**Missing/added handling** (Q5-C): missing and orphan and stale-baseline screens emit `KpiAlert` records with codes `ALERT_VISUAL_BENCHMARK_MISSING_SCREEN`, `ALERT_VISUAL_BENCHMARK_ORPHAN_SCREEN`, `ALERT_VISUAL_BENCHMARK_STALE_BASELINE` respectively. Warnings do not fail CI. Missing screens are dropped from the fixture aggregate.

**Per-job mode** (Q6-B): `ui-src/e2e/visual-parity.live.spec.ts` is explicitly out of scope. Per-job multi-screen is a follow-up.

**Security** (Q7-C): add `assertAllowedScreenId(value: string): string` next to `assertAllowedFixtureId` in `integration/visual-benchmark.helpers.ts`. Accept only `[A-Za-z0-9:_\-]+`, reject `..`, reject absolute paths, trim. Path derivation uses a separate `toScreenIdToken` that replaces `:` with `_`. Every path resolution goes through BOTH `assertAllowedFixtureId` and `assertAllowedScreenId`.

**Migration** (Q8-B): dual-path reader. No existing fixture is moved. New multi-screen fixtures are created on the new layout. Individual fixtures migrate lazily, one PR each, using a future `pnpm visual:baseline migrate` helper.

## Consequences

### Positive

- Five committed fixtures merge unchanged. CI stays green at the merge commit.
- `baseline.json` v3 and `history.json` v2 stay at their current versions — no schema migration code.
- `VisualBenchmarkDelta` / `VisualBenchmarkScoreEntry` / trend summaries need no shape changes.
- Security posture is explicit and auditable — one new assertion, one new tokenization, both colocated with existing equivalents.
- The mean aggregate has a single line of logic; the weighted branch is opt-in per fixture.
- The dual-path reader is <20 lines and can be deleted the day the last fixture migrates.

### Negative / Risks

- Two physical layouts coexist until all fixtures migrate. Mitigated by (a) small branching footprint, (b) a single predicate (`metadata.screens && metadata.screens.length > 1`) governs the branch, (c) test coverage on both paths.
- `metadata.json` schema version bump (`v1 → v2`). Mitigated by v1 remaining readable with an implicit single-screen synthesis — no `metadata.json` rewrite required for committed fixtures.
- Alerts multiply: a fixture with 3 screens can emit up to 3 regression alerts where today it emits 1. Operators must be prepared for more noise. Mitigated by the existing `maxScoreDropPercent` tolerance and by the `neutralTolerance` band.
- The validate-project pipeline today produces exactly one screenshot per job via `captureFromProject`. Multi-screen benchmark execution requires either (a) running the pipeline N times per fixture (one per screen) or (b) extending `captureFromProject` to accept a screen ID. This ADR mandates (a) for the benchmark runner: one fan-out loop in `runVisualBenchmarkFixture` over `metadata.screens`, each iteration running a bounded `executeVisualBenchmarkFixture(fixtureId, { screen })`. The per-screen execution is an implementor concern.
- An "orphan file" is possible: a stray `screens/<token>/reference.png` not declared in `metadata.json`. The orphan alert catches it, but nothing cleans it up automatically. Acceptable — deliberate action should delete files.

### Neutral

- Individual screen scores land in `baseline.json`; the key remains `fixtureId + screenId`. The fixture-level aggregate is _not_ persisted as a synthetic `screenId = "__aggregate__"` row — it is recomputed on read to avoid dual-write drift.
- CLI table layout widens only if a fixture introduces a screen name longer than the current max; the column is already sized to `simple-form`'s long name and will remain readable.
- Future tooling (Storybook integration, PR comment bot) will consume per-screen rows identically to per-fixture rows today.
- **Screen ID stability depends on Figma**: if a designer deletes and recreates a frame, Figma assigns a new node ID. The baseline entry keyed to the old ID becomes stale and the new ID appears unbaselined. This is the same failure mode the current single-screen `metadata.source.nodeId` workflow already has. `ALERT_VISUAL_BENCHMARK_STALE_BASELINE` surfaces it without corrupting data.
- The `weight` field in `VisualBenchmarkFixtureScreenMetadata` is schema-declared in Phase 1 but the runner implements the mean branch only. The weighted branch lands when the first fixture needs it (rule of three — one real usage, not a speculative API). The schema field is cheap to document now so v2 `metadata.json` does not need another bump to add it.

## Implementation Notes

### Contracts the implementor should add

| File                                        | Addition                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integration/visual-benchmark.helpers.ts`   | `assertAllowedScreenId(value: string): string` — same structure as `assertAllowedFixtureId`, accepting only `[A-Za-z0-9:_\-]+`, rejecting `..`.                                                        |
| `integration/visual-benchmark.helpers.ts`   | `toScreenIdToken(screenId: string): string` — deterministic `replace(":", "_")`; pure function; no other substitutions.                                                                                |
| `integration/visual-benchmark.helpers.ts`   | `resolveVisualBenchmarkScreenPaths(fixtureId: string, screenId: string, options?): { referencePngPath: string, screenDir: string }` — calls both asserts, then joins `screens/<token>/reference.png`.  |
| `integration/visual-benchmark.helpers.ts`   | `VisualBenchmarkFixtureMetadata` extended with `version: 1 \| 2` and optional `screens: VisualBenchmarkFixtureScreenMetadata[]`.                                                                       |
| `integration/visual-benchmark.helpers.ts`   | `VisualBenchmarkFixtureScreenMetadata` = `{ screenId: string, screenName: string, nodeId: string, viewport: { width: number, height: number }, weight?: number }`.                                     |
| `integration/visual-benchmark.helpers.ts`   | `enumerateFixtureScreens(metadata): VisualBenchmarkFixtureScreenMetadata[]` — returns `metadata.screens` if present, otherwise synthesizes a one-element list from v1 `source`.                        |
| `integration/visual-benchmark.execution.ts` | `runVisualBenchmarkFixture` signature becomes `Promise<{ fixtureId: string, screens: VisualBenchmarkScreenScore[], aggregateScore: number }>`. Internal loop over `enumerateFixtureScreens(metadata)`. |
| `integration/visual-benchmark-runner.ts`    | `KpiAlert` codes `ALERT_VISUAL_BENCHMARK_MISSING_SCREEN`, `ALERT_VISUAL_BENCHMARK_ORPHAN_SCREEN`, `ALERT_VISUAL_BENCHMARK_STALE_BASELINE`.                                                             |
| `integration/visual-benchmark-runner.ts`    | `computeFixtureAggregate(screens: VisualBenchmarkScreenScore[]): number` — Phase 1 implements arithmetic mean only. The weighted branch is deferred until a fixture declares a weight (rule of three). |
| `src/parity/types-kpi.ts`                   | Declare the three new alert codes alongside `ALERT_VISUAL_QUALITY_DROP`.                                                                                                                               |

### Migration

1. **Phase 1 (this ADR PR, no fixture changes)**: implementor lands dual-path reader, new asserts, new `KpiAlert` codes, runner return shape. Test matrix covers (a) a synthetic in-memory multi-screen fixture, (b) all 5 committed single-screen fixtures still pass unchanged.
2. **Phase 2 (follow-up PRs, one per fixture needing multi-screen)**: each PR runs `pnpm visual:baseline migrate --fixture <id>` which moves `reference.png` into `screens/<token>/`, rewrites `metadata.json` to v2, shoots new reference PNGs for additional screens, and updates `baseline.json`.
3. **Phase 3 (when no fixture still uses v1)**: delete the legacy branch in `resolveVisualBenchmarkFixturePaths`. The deletion PR is a 20-line diff and touches no data.

### Security

`assertAllowedScreenId` MUST:

- reject the empty string and all-whitespace input
- reject `path.isAbsolute(value)`
- reject any character not in `/^[A-Za-z0-9:_\-]+$/`
- reject `..` as a substring
- be called BEFORE any `path.join` that incorporates a screen ID, both directly and transitively
- be called in tandem with `assertAllowedFixtureId` — the `resolveVisualBenchmarkScreenPaths` helper enforces both

`toScreenIdToken` MUST:

- be a pure function
- replace only `:` with `_`
- NOT perform any other transformation (no lowercasing, no NFC normalization, no length cap)
- be called ONLY from path derivation, never from JSON or log output

### Test strategy (invariants the implementor MUST cover)

1. A v1 `metadata.json` with no `screens` array produces a single-screen fixture whose baseline key matches the committed `baseline.json` entry byte-for-byte.
2. A v2 `metadata.json` with 1 screen produces the same aggregate as a v1 fixture with the same underlying PNG.
3. `assertAllowedScreenId("2:10001")` accepts; `assertAllowedScreenId("../foo")` rejects; `assertAllowedScreenId("foo/bar")` rejects; `assertAllowedScreenId("2:10001:extra")` accepts (format is designer-defined, colons are allowed); `assertAllowedScreenId("")` rejects.
4. `toScreenIdToken("2:10001")` returns `"2_10001"`; `toScreenIdToken("a_b")` returns `"a_b"` unchanged.
5. A declared screen with no file on disk emits exactly one `ALERT_VISUAL_BENCHMARK_MISSING_SCREEN` and is excluded from that fixture's aggregate.
6. An orphan file not in `metadata.json` emits exactly one `ALERT_VISUAL_BENCHMARK_ORPHAN_SCREEN`.
7. A fixture with 3 screens and weights `[1, 2, 1]` and scores `[80, 90, 100]` produces aggregate `90` (weighted mean: `(1*80 + 2*90 + 1*100) / 4 = 90`).
8. A fixture with 3 screens and no weights and scores `[80, 90, 100]` produces aggregate `90` (arithmetic mean).
9. The existing 5 committed fixtures produce a `baseline.json` byte-identical to today's when the new runner is executed against them.
10. `baseline.json` v3 parser continues to read existing files unchanged.

## Compatibility

- `baseline.json` stays at schema `version: 3`. No reader or writer changes for this schema are required.
- `history.json` stays at schema `version: 2`. No reader or writer changes required.
- `metadata.json` introduces `version: 2`. Readers accept both `version: 1` and `version: 2`. Writers emit `version: 2` only when `screens.length > 1`. The 5 committed fixtures remain `version: 1` until they are migrated.
- `runVisualBenchmarkFixture` changes its return shape. There is exactly one production caller (`computeVisualBenchmarkScores` at `integration/visual-benchmark-runner.ts:787-806`). Tests that stub `runVisualBenchmarkFixture` via `dependencies.runFixtureBenchmark` (see `VisualBenchmarkRunnerDependencies` at `integration/visual-benchmark-runner.ts:136-145`) must update their stubs — the alternative stub hook `dependencies.executeFixture` is unchanged.
- `runVisualBenchmark` (the top-level entry point) returns the same `VisualBenchmarkResult` shape it does today. No CLI-visible output change for single-screen fixtures.
- Per-job mode (`ui-src/e2e/visual-parity.live.spec.ts`, `ui-src/e2e/fixtures/visual-parity-soll.png`) is untouched.
- The `ALERT_VISUAL_QUALITY_DROP` code is preserved. The new `ALERT_VISUAL_BENCHMARK_*` codes join it in `src/parity/types-kpi.ts`.

## Related

- Issue #837 — Multi-Screen Visual Comparison
- Parent epic #826
- Benchmark mode #830
- Fixture management #831
- ADR-0000 (none yet; this is the first)
