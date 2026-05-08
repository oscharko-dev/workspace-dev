/**
 * Human-review agent envelope (Issue #2038).
 *
 * The human-review agent is a deterministic envelope around an
 * optional human-in-the-loop escalation channel. By default the
 * agent emits a "dry-run marker" — a structured rationale carrying
 * the disagreement context but no actual reviewer interaction. When a
 * principal id and rationale are supplied it produces a fully signed
 * envelope ready for persistence into `judge-consensus.json`.
 *
 * Hard invariants:
 *
 *   - `principalHash` is sha256 of the supplied principal id; the
 *     raw id is never persisted.
 *   - `rationale` is length-capped to
 *     {@link HUMAN_REVIEW_RATIONALE_MAX_CHARS} and refused when it
 *     contains LF/CR/U+2028/U+2029 — defence in depth so reviewer
 *     prose never smuggles line endings into evidence.
 *   - `decidedAt` is an ISO-8601 timestamp the caller supplies; the
 *     module is clock-free.
 *   - The dry-run marker carries `verdict = "deferred"` and
 *     `reviewerKind = "dry_run_marker"` so downstream consumers can
 *     distinguish offline analysis from a live decision.
 */

import { createHash } from "node:crypto";

import {
  HUMAN_REVIEW_DECISION_SCHEMA_VERSION,
  HUMAN_REVIEW_RATIONALE_MAX_CHARS,
  HUMAN_REVIEW_VERDICT_LABELS,
  type HumanReviewDecision,
  type HumanReviewReviewerKind,
  type HumanReviewVerdictLabel,
  type JudgeDisagreementDecisionLabel,
} from "../contracts/index.js";
import {
  isHex64,
  isHumanReviewReviewerKind,
} from "./cross-family-judge-policy.js";

const FORBIDDEN_RATIONALE_CHARS: readonly string[] = Object.freeze([
  "\n",
  "\r",
  "\u2028",
  "\u2029",
]);

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const DRY_RUN_PRINCIPAL_ID = "dry-run-marker" as const;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const assertRationale = (rationale: string, where: string): void => {
  if (typeof rationale !== "string") {
    throw new TypeError(`${where}: rationale must be a string`);
  }
  if (rationale.length === 0) {
    throw new TypeError(`${where}: rationale must be a non-empty string`);
  }
  if (rationale.length > HUMAN_REVIEW_RATIONALE_MAX_CHARS) {
    throw new RangeError(
      `${where}: rationale exceeds HUMAN_REVIEW_RATIONALE_MAX_CHARS (${HUMAN_REVIEW_RATIONALE_MAX_CHARS}), got ${rationale.length}`,
    );
  }
  for (const ch of FORBIDDEN_RATIONALE_CHARS) {
    if (rationale.includes(ch)) {
      const codepoint = ch
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0");
      throw new RangeError(
        `${where}: rationale contains a forbidden control / line-separator codepoint (U+${codepoint})`,
      );
    }
  }
};

const assertDecidedAt = (decidedAt: string, where: string): void => {
  if (typeof decidedAt !== "string" || decidedAt.length === 0) {
    throw new TypeError(`${where}: decidedAt must be a non-empty string`);
  }
  if (!ISO_8601.test(decidedAt)) {
    throw new RangeError(
      `${where}: decidedAt must be a strict ISO-8601 timestamp, got "${decidedAt}"`,
    );
  }
};

const assertVerdict = (
  verdict: HumanReviewVerdictLabel,
  where: string,
): void => {
  const value: string = verdict;
  if (!(HUMAN_REVIEW_VERDICT_LABELS as readonly string[]).includes(value)) {
    throw new RangeError(
      `${where}: verdict "${value}" is not a known HumanReviewVerdictLabel`,
    );
  }
};

const assertReviewerKind = (
  kind: HumanReviewReviewerKind,
  where: string,
): void => {
  if (!isHumanReviewReviewerKind(kind)) {
    const value: string = kind;
    throw new RangeError(
      `${where}: reviewerKind "${value}" is not a known HumanReviewReviewerKind`,
    );
  }
};

const KNOWN_TRIGGER_LABELS: readonly string[] = [
  "majority_decision",
  "split_decision",
  "unanimous_accept",
  "unanimous_reject",
  "unanimous_repair",
];

const assertTriggeredBy = (
  triggeredBy: JudgeDisagreementDecisionLabel,
  where: string,
): void => {
  const value: string = triggeredBy;
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(
      `${where}: triggeredBy must be a non-empty JudgeDisagreementDecisionLabel`,
    );
  }
  if (!KNOWN_TRIGGER_LABELS.includes(value)) {
    throw new RangeError(
      `${where}: triggeredBy "${value}" is not a known JudgeDisagreementDecisionLabel`,
    );
  }
};

/** Input shape consumed by {@link buildHumanReviewDecision}. */
export interface BuildHumanReviewDecisionInput {
  /** Reviewer kind. Default: `"dry_run_marker"`. */
  readonly reviewerKind?: HumanReviewReviewerKind;
  /**
   * Stable reviewer principal identifier. The agent hashes it with
   * sha256 — the raw id is never persisted. When omitted the dry-run
   * marker principal id is used.
   */
  readonly principalId?: string;
  /**
   * Optional pre-computed sha256 hex of the principal id. When set
   * `principalId` is ignored. Allows callers to feed an externally
   * computed principal hash without re-hashing.
   */
  readonly principalHash?: string;
  /** Final verdict the reviewer cast. */
  readonly verdict: HumanReviewVerdictLabel;
  /** Length-capped rationale (no chain-of-thought, no PII). */
  readonly rationale: string;
  /** ISO-8601 timestamp at which the decision was recorded. */
  readonly decidedAt: string;
  /** Disagreement decision label that triggered escalation. */
  readonly triggeredBy: JudgeDisagreementDecisionLabel;
}

/**
 * Build a deterministic, validated {@link HumanReviewDecision}
 * envelope. Throws on any structural violation — never returns a
 * partially-validated record.
 */
export const buildHumanReviewDecision = (
  input: BuildHumanReviewDecisionInput,
): HumanReviewDecision => {
  const where = "buildHumanReviewDecision";
  const reviewerKind: HumanReviewReviewerKind =
    input.reviewerKind ?? "dry_run_marker";
  assertReviewerKind(reviewerKind, where);
  assertVerdict(input.verdict, where);
  assertRationale(input.rationale, where);
  assertDecidedAt(input.decidedAt, where);
  assertTriggeredBy(input.triggeredBy, where);

  let principalHash: string;
  if (input.principalHash !== undefined) {
    if (!isHex64(input.principalHash)) {
      throw new RangeError(
        `${where}: principalHash must be 64 lowercase hex chars (sha256), got "${input.principalHash}"`,
      );
    }
    principalHash = input.principalHash;
  } else {
    const principalId =
      input.principalId !== undefined && input.principalId.length > 0
        ? input.principalId
        : DRY_RUN_PRINCIPAL_ID;
    if (
      reviewerKind === "principal" &&
      (input.principalId === undefined || input.principalId.length === 0)
    ) {
      throw new TypeError(
        `${where}: reviewerKind "principal" requires a non-empty principalId or pre-computed principalHash`,
      );
    }
    principalHash = sha256Hex(principalId);
  }

  return Object.freeze({
    schemaVersion: HUMAN_REVIEW_DECISION_SCHEMA_VERSION,
    reviewerKind,
    principalHash,
    verdict: input.verdict,
    rationale: input.rationale,
    decidedAt: input.decidedAt,
    triggeredBy: input.triggeredBy,
  });
};

/**
 * Build the default dry-run marker. The dry-run marker:
 *
 *   - Carries `verdict = "deferred"` so the panel verdict is not
 *     overridden when no live reviewer is available.
 *   - Hashes a fixed `dry-run-marker` principal id so the artifact
 *     is byte-stable for byte-identical inputs.
 *   - Caps the rationale at the contract limit and refuses smuggled
 *     line endings.
 */
export const buildDryRunHumanReviewMarker = (input: {
  readonly rationale: string;
  readonly decidedAt: string;
  readonly triggeredBy: JudgeDisagreementDecisionLabel;
}): HumanReviewDecision =>
  buildHumanReviewDecision({
    reviewerKind: "dry_run_marker",
    verdict: "deferred",
    rationale: input.rationale,
    decidedAt: input.decidedAt,
    triggeredBy: input.triggeredBy,
  });

/**
 * Validate a reloaded {@link HumanReviewDecision} (e.g., from disk).
 * Throws on any structural violation; does not mutate input.
 */
export const assertHumanReviewDecisionInvariants = (
  decision: HumanReviewDecision,
): void => {
  const where = `HumanReviewDecision[${decision.principalHash}]`;
  const schemaVersion: string = decision.schemaVersion;
  if (schemaVersion !== HUMAN_REVIEW_DECISION_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must be "${HUMAN_REVIEW_DECISION_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  assertReviewerKind(decision.reviewerKind, where);
  if (!isHex64(decision.principalHash)) {
    throw new RangeError(
      `${where}: principalHash must be 64 lowercase hex chars (sha256)`,
    );
  }
  assertVerdict(decision.verdict, where);
  assertRationale(decision.rationale, where);
  assertDecidedAt(decision.decidedAt, where);
  assertTriggeredBy(decision.triggeredBy, where);
};

/** sha256 hex of an arbitrary stable principal id. Helper for callers. */
export const hashPrincipalId = (principalId: string): string => {
  if (typeof principalId !== "string" || principalId.length === 0) {
    throw new TypeError(
      "hashPrincipalId: principalId must be a non-empty string",
    );
  }
  return sha256Hex(principalId);
};

