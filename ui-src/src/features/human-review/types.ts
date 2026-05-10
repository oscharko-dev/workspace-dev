/**
 * Wire-format mirrors of the human-review queue contract types
 * (Issue #2179). Kept narrow on purpose — the UI consumes only the
 * fields it needs to display + decide. The authoritative type lives in
 * `src/contracts/index.ts` (`HumanReviewQueueItem`, `HumanReviewVerdict`).
 */

export type HumanReviewQueueVerdictLabel = "approved" | "rejected" | "revised";

export interface JudgeDisagreementJudgeEntry {
  readonly judgeId: string;
  readonly family: string;
  readonly modelId: string;
  readonly verdict: string;
}

export interface JudgeDisagreementSnapshot {
  readonly decision: string;
  readonly escalation: string;
  readonly disagreementRate: number;
  readonly judges: readonly JudgeDisagreementJudgeEntry[];
}

export interface HumanReviewQueueItem {
  readonly itemId: string;
  readonly tenantId: string;
  readonly profileId: string;
  readonly runId: string;
  readonly testCaseId: string;
  readonly judgeDisagreement: JudgeDisagreementSnapshot;
  readonly proposedDecision: string;
  readonly enqueuedAt: string;
  readonly slaDeadlineAt: string;
}

export interface HumanReviewVerdictBody {
  readonly schemaVersion: string;
  readonly contractVersion: string;
  readonly itemId: string;
  readonly reviewerPrincipalHash: string;
  readonly verdict: HumanReviewQueueVerdictLabel;
  readonly rationale: string;
  readonly revisedTestCase?: Record<string, unknown>;
  readonly decidedAt: string;
  readonly publicKeyFingerprintSha256: string;
  readonly publicKeyPem: string;
}

export interface HumanReviewVerdict extends HumanReviewVerdictBody {
  readonly signatureHex: string;
}
