/**
 * Subprocessor register artifact (Issue #2174).
 *
 * Replaces the Markdown-only register from Issue #2113
 * (`docs/dora/subprocessor-register.md`) with a typed, machine-verifiable
 * JSON artifact that ships per run alongside `compliance-annotations.json`
 * and `compliance-coverage-report.json`. DORA Art. 28 + GDPR Ch. V
 * require a machine-readable, timestamped subprocessor record that an
 * auditor can cross-reference programmatically; the Markdown register
 * cannot be automatically validated.
 *
 * The register is the **source of truth**: the on-disk Markdown at
 * `docs/dora/subprocessor-register.md` is regenerated from this module
 * by `scripts/render-subprocessor-register.mjs` and a CI dev-gate
 * (`scripts/check-subprocessor-register.mjs`) fails the build if drift
 * is detected. Hand-edits to the Markdown are rejected.
 *
 * The builder is pure: identical inputs produce identical canonical
 * JSON bytes. The Markdown renderer is deterministic. The internal
 * Merkle root is a SHA-256 binary tree over the canonical-JSON-
 * serialised entries, so a single root pin lets a downstream verifier
 * detect drift in either the subprocessor list or the cross-border
 * transfer list without re-hashing the whole file.
 */

import { createHash } from "node:crypto";

import {
  SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME,
  SUBPROCESSOR_REGISTER_SCHEMA_VERSION,
  SUBPROCESSOR_REGISTER_VERSION,
  type CrossBorderTransferEntry,
  type SubprocessorEntry,
  type SubprocessorRegister,
  type SupportedHostingRegion,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export {
  SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME,
  SUBPROCESSOR_REGISTER_SCHEMA_VERSION,
  SUBPROCESSOR_REGISTER_VERSION,
};

/**
 * Pinned timestamp the entries were first added to the register. Used by
 * both the runtime builder and the build-time Markdown renderer so the
 * `addedAt` field stays byte-stable between regenerations and runs.
 *
 * Bump rule — when an entry is added or materially changed in a way
 * that should reset its replay-clock, update its individual `addedAt`
 * via the source constants below; never mutate this constant
 * retroactively for entries that already shipped.
 */
const REGISTER_ENTRIES_INITIAL_ADDED_AT = "2026-05-10T00:00:00Z" as const;

/**
 * Canonical, sorted source-of-truth list of subprocessors. Every entry
 * mirrors a row of `docs/dora/subprocessor-register.md` § 2 (Issue
 * #2113) and is tracked by its stable `subprocessorId`. The order here
 * is **not** load-bearing — the builder re-sorts before serialisation
 * — but keeping the file alphabetic makes review-time diffs readable.
 */
const SUBPROCESSOR_SOURCE: readonly SubprocessorEntry[] = Object.freeze([
  Object.freeze({
    subprocessorId: "document-ai-mistral",
    legalName:
      "Operator-selected Mistral-document-AI deployment (e.g. mistral-document-ai-2512)",
    purpose:
      "OCR + structured extraction over operator-supplied PDF / image attachments referenced in custom-context sources.",
    hostingRegion: "eu-west-1" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "personal-data-pseudonymised",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "DPA-operator",
      "SCC-2021-Module-2",
    ]) as readonly string[],
    retentionPolicy:
      "Stateless from the package's perspective. Operator must configure the deployment with retention floor of 0 days for prompt/response bodies.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
  Object.freeze({
    subprocessorId: "jira-ingestion-rest",
    legalName:
      "Operator-selected Atlassian Cloud tenant (*.atlassian.net) or self-hosted Jira Data Center",
    purpose:
      "Issue read access (Jira REST API v3) for multi-source test-intent ingestion. Paste-only fallback (jira_paste) is available when the REST path is unavailable or air-gapped.",
    hostingRegion: "operator-defined" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "personal-data-pseudonymised",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "Atlassian-DPA",
      "SCC-2021-Module-2",
    ]) as readonly string[],
    retentionPolicy:
      "Package persists only redacted Jira IR; raw API responses are not written. Operator-controlled retention on the upstream tenant.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
  Object.freeze({
    subprocessorId: "llm-gateway-text-generation",
    legalName:
      "Operator-selected LLM gateway (Azure OpenAI / Azure ML inference / equivalent)",
    purpose:
      "Structured test-case generation against a hand-rolled JSON-Schema; consumes Business Test Intent IR + Visual Sidecar IR and emits GeneratedTestCase[]. Never receives image payloads.",
    hostingRegion: "westeurope" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "personal-data-pseudonymised",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "DPA-operator",
      "SCC-2021-Module-2",
    ]) as readonly string[],
    retentionPolicy:
      "Package retention is zero — no prompt, completion, or response body persisted outside the per-run evidence directory; persisted artifacts are PII-redacted IR.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
  Object.freeze({
    subprocessorId: "object-storage-operator",
    legalName:
      "Operator-deployed object-storage backend (S3 / Azure Blob / GCS through operator filesystem layer)",
    purpose:
      "Operator-mounted backing store for the run-directory output. The package never calls any object-storage API directly.",
    hostingRegion: "operator-defined" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "evidence-artifacts",
      "personal-data-pseudonymised",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "DPA-operator",
    ]) as readonly string[],
    retentionPolicy:
      "Operator-controlled. Atomic-rename on artifact write ensures a partial write is never observed.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
  Object.freeze({
    subprocessorId: "operator-hook-egress",
    legalName:
      "Operator-supplied HookRuntimePolicy.allowedHttpHosts entries (per host pattern)",
    purpose:
      "Operator-configured outbound webhooks (incident-management, reviewer notifications, audit-log shipping). The package ships with no default allow-listed hosts.",
    hostingRegion: "operator-defined" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "evidence-metadata-only",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "DPA-operator",
    ]) as readonly string[],
    retentionPolicy:
      "Hook bodies use bodyTemplate with environment-variable placeholders; no raw screenshots, raw Jira responses, or raw paste bytes leave the host.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
  Object.freeze({
    subprocessorId: "visual-sidecar-vision",
    legalName:
      "Operator-selected multimodal vision deployment (e.g. llama-4-maverick-vision primary, phi-4-multimodal-poc fallback)",
    purpose:
      "Computes the Visual Sidecar IR from per-screen captures. Never sees raw test-intent text; the role-separation invariant keeps the structured-test-case generator deployment image-free.",
    hostingRegion: "westeurope" satisfies SupportedHostingRegion,
    dataCategories: Object.freeze([
      "personal-data-pseudonymised",
    ]) as readonly string[],
    contractualSafeguards: Object.freeze([
      "DPA-operator",
      "SCC-2021-Module-2",
    ]) as readonly string[],
    retentionPolicy:
      "The package never persists raw screenshot bytes (rawScreenshotsIncluded: false). Captures live in the gateway only for the duration of the inference call.",
    addedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
  }),
]) as readonly SubprocessorEntry[];

/**
 * Canonical, sorted source-of-truth list of cross-border transfer
 * records under GDPR Ch. V. Even intra-EEA flows are recorded with the
 * `adequacy-decision` mechanism for replay verifiability.
 */
const CROSS_BORDER_TRANSFER_SOURCE: readonly CrossBorderTransferEntry[] =
  Object.freeze([
    Object.freeze({
      transferId: "intra-eea-document-ai-northeurope",
      sourceRegion: "westeurope" satisfies SupportedHostingRegion,
      destinationRegion: "eu-west-1" satisfies SupportedHostingRegion,
      transferMechanism: "adequacy-decision",
      mechanismCitation: "docs/dpia/cross-border-transfer.md §2.3",
      purpose:
        "Document AI extraction within Mistral's EU region family from EEA-hosted runners.",
      approvedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
    }),
    Object.freeze({
      transferId: "intra-eea-llm-gateway-westeurope",
      sourceRegion: "westeurope" satisfies SupportedHostingRegion,
      destinationRegion: "westeurope" satisfies SupportedHostingRegion,
      transferMechanism: "adequacy-decision",
      mechanismCitation: "docs/dpia/cross-border-transfer.md §2.1",
      purpose:
        "Structured test-case generation inside the operator's EEA Azure region; intra-EEA flow recorded for replay verifiability.",
      approvedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
    }),
    Object.freeze({
      transferId: "intra-eea-visual-sidecar-westeurope",
      sourceRegion: "westeurope" satisfies SupportedHostingRegion,
      destinationRegion: "westeurope" satisfies SupportedHostingRegion,
      transferMechanism: "adequacy-decision",
      mechanismCitation: "docs/dpia/cross-border-transfer.md §2.2",
      purpose:
        "Visual sidecar inference inside the operator's EEA Azure region; intra-EEA flow recorded for replay verifiability.",
      approvedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
    }),
    Object.freeze({
      transferId: "operator-defined-jira-paste-fallback",
      sourceRegion: "operator-defined" satisfies SupportedHostingRegion,
      destinationRegion: "westeurope" satisfies SupportedHostingRegion,
      transferMechanism: "scc-2021",
      mechanismCitation: "docs/dpia/cross-border-transfer.md §3.1",
      purpose:
        "Jira REST or paste-only fallback from operator-controlled Atlassian tenant or air-gapped paste source into the EEA-hosted runner.",
      approvedAt: REGISTER_ENTRIES_INITIAL_ADDED_AT,
    }),
  ]) as readonly CrossBorderTransferEntry[];

/**
 * SHA-256 hex digest helper; identical to the one used by content-hash
 * for runtime artifacts. Local to this module so the `node:crypto`
 * import does not leak through the public type surface.
 */
const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Compute a SHA-256 binary Merkle root over the canonical-JSON
 * serialisation of a list of leaves. Identical leaves produce identical
 * roots; an empty list collapses to the SHA-256 of the empty string so
 * downstream consumers always receive a well-formed hex digest.
 *
 * The construction matches `provenance-graph.ts` (Issue #2037) so the
 * register Merkle root can be cross-checked against the provenance
 * graph's per-run record without a second algorithm citation.
 */
const computeMerkleRoot = (leaves: readonly unknown[]): string => {
  const leafHashes = leaves.map((leaf) => sha256Hex(canonicalJson(leaf)));
  const sorted = leafHashes
    .slice()
    .sort((left, right) => left.localeCompare(right));
  if (sorted.length === 0) return sha256Hex("");
  let level = sorted;
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(sha256Hex(`${left}:${right}`));
    }
    level = next;
  }
  return level[0]!;
};

/** Sort + freeze a SubprocessorEntry list by stable identifier. */
const sortSubprocessors = (
  entries: readonly SubprocessorEntry[],
): readonly SubprocessorEntry[] =>
  Object.freeze(
    entries
      .slice()
      .sort((left, right) =>
        left.subprocessorId.localeCompare(right.subprocessorId),
      )
      .map((entry) =>
        Object.freeze({
          ...entry,
          dataCategories: Object.freeze(
            [...entry.dataCategories].sort((left, right) =>
              left.localeCompare(right),
            ),
          ) as readonly string[],
          contractualSafeguards: Object.freeze(
            [...entry.contractualSafeguards].sort((left, right) =>
              left.localeCompare(right),
            ),
          ) as readonly string[],
        }),
      ),
  ) as readonly SubprocessorEntry[];

/** Sort + freeze a CrossBorderTransferEntry list by stable identifier. */
const sortTransfers = (
  entries: readonly CrossBorderTransferEntry[],
): readonly CrossBorderTransferEntry[] =>
  Object.freeze(
    entries
      .slice()
      .sort((left, right) => left.transferId.localeCompare(right.transferId))
      .map((entry) => Object.freeze({ ...entry })),
  ) as readonly CrossBorderTransferEntry[];

export interface BuildSubprocessorRegisterInput {
  /** ISO-8601 timestamp stamped into the register at emission time. */
  readonly generatedAt: string;
  /**
   * Optional override for the subprocessor list. Defaults to the
   * canonical source-of-truth declared in this module. Used by tests
   * that assert builder determinism for synthetic inputs.
   */
  readonly subprocessors?: readonly SubprocessorEntry[];
  /**
   * Optional override for the cross-border transfer list. Defaults to
   * the canonical source-of-truth declared in this module.
   */
  readonly crossBorderTransfers?: readonly CrossBorderTransferEntry[];
}

/**
 * Build the SubprocessorRegister artifact. Pure: identical inputs always
 * produce identical canonical JSON bytes (the entry lists are sorted,
 * the Merkle root is over canonical-JSON leaves, and every nested
 * collection is frozen).
 */
export const buildSubprocessorRegister = (
  input: BuildSubprocessorRegisterInput,
): SubprocessorRegister => {
  const subprocessors = sortSubprocessors(
    input.subprocessors ?? SUBPROCESSOR_SOURCE,
  );
  const crossBorderTransfers = sortTransfers(
    input.crossBorderTransfers ?? CROSS_BORDER_TRANSFER_SOURCE,
  );
  const merkleRoot = computeMerkleRoot([
    ...subprocessors,
    ...crossBorderTransfers,
  ]);
  return Object.freeze({
    schemaVersion: SUBPROCESSOR_REGISTER_SCHEMA_VERSION,
    registerVersion: SUBPROCESSOR_REGISTER_VERSION,
    generatedAt: input.generatedAt,
    subprocessors,
    crossBorderTransfers,
    merkleRoot,
  });
};

/**
 * Canonical-JSON serialisation of a SubprocessorRegister, with a
 * trailing newline to match the convention used by every other
 * test-intelligence artifact written through `writeAtomicBytes`.
 */
export const serializeSubprocessorRegister = (
  register: SubprocessorRegister,
): string => `${canonicalJson(register)}\n`;

const renderRegionList = (region: SupportedHostingRegion): string => region;

const renderStringList = (values: readonly string[]): string => {
  if (values.length === 0) return "—";
  return values.map((value) => `\`${value}\``).join(", ");
};

const renderSubprocessorRow = (entry: SubprocessorEntry): string => {
  const lines: string[] = [
    `### ${entry.subprocessorId}`,
    "",
    `**Legal name.** ${entry.legalName}`,
    "",
    `**Purpose.** ${entry.purpose}`,
    "",
    `**Hosting region.** \`${renderRegionList(entry.hostingRegion)}\``,
    "",
    `**Data categories.** ${renderStringList(entry.dataCategories)}`,
    "",
    `**Contractual safeguards.** ${renderStringList(entry.contractualSafeguards)}`,
    "",
    `**Retention policy.** ${entry.retentionPolicy}`,
    "",
    `**Added at.** \`${entry.addedAt}\``,
  ];
  if (entry.soc2ReportRef !== undefined) {
    lines.push("", `**SOC 2 report.** ${entry.soc2ReportRef}`);
  }
  if (entry.iso27001ReportRef !== undefined) {
    lines.push("", `**ISO/IEC 27001.** ${entry.iso27001ReportRef}`);
  }
  return lines.join("\n");
};

const renderTransferRow = (entry: CrossBorderTransferEntry): string =>
  [
    `### ${entry.transferId}`,
    "",
    `**Source region → destination region.** \`${entry.sourceRegion}\` → \`${entry.destinationRegion}\``,
    "",
    `**Transfer mechanism.** \`${entry.transferMechanism}\``,
    "",
    `**Mechanism citation.** ${entry.mechanismCitation}`,
    "",
    `**Purpose.** ${entry.purpose}`,
    "",
    `**Approved at.** \`${entry.approvedAt}\``,
  ].join("\n");

/**
 * Pinned timestamp the auto-generated Markdown is stamped with at build
 * time. The runtime artifact carries the per-run `generatedAt`; the
 * Markdown deliberately uses a separate, register-version-coupled
 * timestamp so the on-disk doc stays byte-stable across local
 * regenerations until the source content moves.
 *
 * Bump rule — update on the same PR that bumps a register entry's
 * `addedAt` or {@link SUBPROCESSOR_REGISTER_VERSION}.
 */
export const SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED =
  "2026-05-10" as const;

/**
 * Render the auto-generated Markdown register from the canonical JSON
 * artifact. Deterministic: identical input produces identical output.
 *
 * The output is the **only** acceptable content of
 * `docs/dora/subprocessor-register.md`; the dev-gate
 * (`scripts/check-subprocessor-register.mjs`) refuses any drift.
 */
export const renderSubprocessorRegisterMarkdown = (
  register: SubprocessorRegister,
): string => {
  const sections: string[] = [
    "# Subprocessor Register — workspace-dev",
    "",
    "<!--",
    "  AUTO-GENERATED FROM `src/test-intelligence/subprocessor-register.ts`.",
    "  DO NOT EDIT BY HAND. Regenerate with:",
    "      pnpm run docs:render-subprocessor-register",
    "  CI fails on any drift between this file and the canonical TS source.",
    "  Issue #2174 — DORA Art. 28 machine-verifiable subprocessor register.",
    "-->",
    "",
    `**Register schema version:** \`${register.schemaVersion}\` ` +
      `(\`SUBPROCESSOR_REGISTER_SCHEMA_VERSION\`).`,
    "",
    `**Register content version:** \`${register.registerVersion}\` ` +
      `(\`SUBPROCESSOR_REGISTER_VERSION\`).`,
    "",
    `**Merkle root (SHA-256 over sorted entries):** \`${register.merkleRoot}\`.`,
    "",
    `**Last reviewed:** ${SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED} (Issue #2174).`,
    "",
    "**Scope.** ICT third-party / subprocessor register for `workspace-dev`",
    "test-intelligence deployments. Closes the M0 audit finding LOW-1 against",
    "Issue #2113 by replacing the Markdown-only register with a typed,",
    "machine-verifiable JSON artifact (`subprocessor-register.json`) shipped",
    "per run alongside `compliance-annotations.json` and",
    "`compliance-coverage-report.json` (DORA Art. 28 + GDPR Ch. V).",
    "",
    "**Audience.** Financial entities and other regulated operators preparing",
    "their own DORA register-of-information and GDPR Ch. V transfer",
    "assessment. The operator remains the controller; this document",
    "enumerates the dependencies the package itself depends on or invokes,",
    "plus the dependencies it allows the operator to introduce through the",
    "configurable hook surface.",
    "",
    "---",
    "",
    "## 1. Operator-versus-package boundary",
    "",
    "`workspace-dev` is an operator-deployed package. The operator selects,",
    "hosts, and contracts every external service the test-intelligence",
    "pipeline relies on at runtime. The package does not call any default",
    "cloud endpoint — every outbound call is gated by:",
    "",
    "- a feature flag (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` and, where",
    "  applicable, `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`),",
    "- an operator-supplied configuration (gateway URL, deployment names,",
    "  host allow-list), and",
    "- the deterministic `llmCodegenMode` mode-lock invariant.",
    "",
    "Operators must transcribe the relevant rows into their own DORA Art.",
    "28(3) register-of-information with their concrete vendor identity,",
    "agreement reference, and criticality classification.",
    "",
    "---",
    "",
    "## 2. Subprocessor entries",
    "",
    "Every entry below corresponds to one record in the typed",
    "`SubprocessorRegister.subprocessors` array. The `subprocessorId`",
    "column is the stable cross-reference key cited from",
    "`compliance-annotations.json`.",
    "",
  ];

  for (const entry of register.subprocessors) {
    sections.push(renderSubprocessorRow(entry));
    sections.push("");
  }

  sections.push(
    "---",
    "",
    "## 3. Cross-border transfer records",
    "",
    "Every entry below corresponds to one record in the typed",
    "`SubprocessorRegister.crossBorderTransfers` array. Even intra-EEA",
    "flows are recorded for replay verifiability so an auditor can",
    "reconstruct which transfer mechanism was active at a given run",
    "timestamp.",
    "",
  );

  for (const entry of register.crossBorderTransfers) {
    sections.push(renderTransferRow(entry));
    sections.push("");
  }

  sections.push(
    "---",
    "",
    "## 4. Replay verifiability",
    "",
    "Every Wave 1 Validation evidence manifest carries",
    "`subprocessorRegisterVersion`; every run-bundle ships the typed",
    `\`${SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME}\` artifact next to`,
    "`compliance-annotations.json`. A replay can verify which register was",
    "active for the run by:",
    "",
    "1. Reading `wave1-validation-evidence-manifest.json` →",
    "   `subprocessorRegisterVersion`.",
    `2. Reading \`${SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME}\` → \`merkleRoot\``,
    "   and matching it against the Merkle root carried in",
    "   `provenance.jsonld` (`ti:subprocessorRegisterMerkleRoot`).",
    "3. Looking up the matching tag of",
    "   `docs/dora/subprocessor-register.md` and",
    "   `docs/dpia/cross-border-transfer.md` in the repository at that",
    "   version.",
    "",
    "---",
    "",
    "## 5. CI / governance gates",
    "",
    "- **Schema-version export gate.** `SUBPROCESSOR_REGISTER_SCHEMA_VERSION`",
    "  and `SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME` are asserted in",
    "  `src/contract-version.test.ts` as part of the contract runtime",
    "  export snapshot.",
    "- **Drift gate.** `pnpm run verify:subprocessor-register` fails CI if",
    "  the on-disk Markdown drifts from the canonical TS source.",
    "- **Manifest gate.** `validateWave1ValidationEvidenceManifestMetadata`",
    "  rejects manifests whose `subprocessorRegisterVersion` does not equal",
    "  the current constant.",
    "",
    "---",
    "",
    "## 6. See also",
    "",
    "- `docs/dora/subprocessor-register-schema.md` — schema reference for",
    "  the typed `SubprocessorRegister` artifact.",
    "- `docs/dpia/cross-border-transfer.md` — paired ADR for the cross-",
    "  border transfer story per Azure deployment region pair.",
    "- `docs/dora/multi-source.md` — DORA mapping for the multi-source",
    "  test-intelligence surface (Wave 4 extension).",
    "- `COMPLIANCE.md` — top-level DORA / GDPR / EU AI Act control mapping.",
    "- `src/contracts/index.ts` — `SubprocessorRegister` interface,",
    "  `SUBPROCESSOR_REGISTER_VERSION`, `SUBPROCESSOR_REGISTER_SCHEMA_VERSION`,",
    "  `SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME`.",
    "- `src/test-intelligence/subprocessor-register.ts` — canonical TS",
    "  source-of-truth and Markdown renderer.",
    "",
  );

  return sections.join("\n");
};
