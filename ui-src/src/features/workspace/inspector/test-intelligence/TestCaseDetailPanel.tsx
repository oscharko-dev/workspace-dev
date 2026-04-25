// ---------------------------------------------------------------------------
// Test case detail panel (Issue #1367)
//
// Shows preconditions, test data, ordered steps, expected results,
// assumptions, open questions, Figma trace references, and review/policy
// state for the selected test case. Also surfaces approve/reject/needs-
// clarification/note actions wired through the parent component.
// ---------------------------------------------------------------------------

import { useState, type JSX } from "react";
import {
  formatConfidence,
  formatPolicyDecisionBadge,
  formatPriorityBadge,
  formatReviewStateBadge,
  formatRiskCategoryLabel,
  formatTestTypeLabel,
  formatVisualSidecarOutcomeBadge,
  resolveEffectiveReviewState,
} from "./formatters";
import type {
  GeneratedTestCase,
  PolicyDecision,
  PolicyViolation,
  QcMappingPreviewEntry,
  ReviewSnapshotEntry,
  VisualSidecarRecord,
} from "./types";

export type ReviewActionKind =
  | "approve"
  | "reject"
  | "needs-clarification"
  | "note";

export interface TestCaseDetailPanelProps {
  testCase: GeneratedTestCase;
  reviewSnapshot?: ReviewSnapshotEntry;
  policyDecision?: PolicyDecision;
  policyViolations: readonly PolicyViolation[];
  /**
   * Whether the current operator session has a Bearer token configured. When
   * false, the action buttons render disabled with an explanatory message
   * so reviewers see why writes are unavailable instead of being silently
   * blocked at submission time.
   */
  bearerTokenAvailable: boolean;
  /**
   * In-flight action label (e.g. "approve") when a request is pending.
   * Disables every action while present.
   */
  pendingAction: ReviewActionKind | null;
  /**
   * Optional inline error message rendered above the action buttons after
   * a failed submission. Cleared when the user retries or selects another
   * test case.
   */
  actionError: string | null;
  /** Optional reviewer handle prefilled into action submissions. */
  reviewerHandle?: string;
  /** Visual sidecar validation rows matching this case's Figma screen refs. */
  visualRecords: readonly VisualSidecarRecord[];
  /** QC/export mapping row for this case, when the export preview exists. */
  qcMappingEntry?: QcMappingPreviewEntry;
  onAction: (input: { action: ReviewActionKind; note?: string }) => void;
  /**
   * Whether the resolved server-side four-eyes policy requires two
   * distinct authenticated principals before the case may reach
   * `approved`. When `true`, the UI labels the approve button as
   * primary/secondary based on the current snapshot state and refuses
   * to send the action when it would obviously be rejected by the
   * server (same actor / approving an edit they authored).
   */
  fourEyesEnforced: boolean;
  approvers: readonly string[];
  /** Sorted enforcement reasons surfaced beneath the four-eyes notice. */
  fourEyesReasons?: readonly string[];
  /** Identity of the primary approver, when recorded. */
  primaryReviewer?: string;
  /** Identity of the actor that recorded the most recent edit, when any. */
  lastEditor?: string;
}

const NOTE_MAX_LENGTH = 1024;

export function TestCaseDetailPanel({
  testCase,
  reviewSnapshot,
  policyDecision,
  policyViolations,
  bearerTokenAvailable,
  pendingAction,
  actionError,
  reviewerHandle,
  visualRecords,
  qcMappingEntry,
  onAction,
  fourEyesEnforced,
  approvers,
  fourEyesReasons,
  primaryReviewer,
  lastEditor,
}: TestCaseDetailPanelProps): JSX.Element {
  const [note, setNote] = useState("");
  const reviewBadge = formatReviewStateBadge(
    resolveEffectiveReviewState(reviewSnapshot?.state, testCase.reviewState),
  );
  const priorityBadge = formatPriorityBadge(testCase.priority);
  const policyBadge = policyDecision
    ? formatPolicyDecisionBadge(policyDecision)
    : null;

  const blockingViolations = policyViolations.filter(
    (violation) => violation.severity === "error",
  );
  const warningViolations = policyViolations.filter(
    (violation) => violation.severity === "warning",
  );

  const currentReviewState = reviewSnapshot?.state;
  const isAwaitingSecondary =
    fourEyesEnforced && currentReviewState === "pending_secondary_approval";
  const approverSelfBlock =
    fourEyesEnforced &&
    typeof reviewerHandle === "string" &&
    reviewerHandle.length > 0 &&
    ((isAwaitingSecondary && primaryReviewer === reviewerHandle) ||
      lastEditor === reviewerHandle);
  const approveBlocked =
    !bearerTokenAvailable ||
    policyDecision === "blocked" ||
    blockingViolations.length > 0 ||
    pendingAction !== null ||
    approverSelfBlock;
  const writeBlockedReason = !bearerTokenAvailable
    ? "Set the test-intelligence review bearer token to enable review actions."
    : policyDecision === "blocked" || blockingViolations.length > 0
      ? "Policy violations block approval until they are resolved."
      : approverSelfBlock
        ? "Four-eyes policy requires a different reviewer for this approval. Switch handle to proceed."
        : null;
  const approveLabel = fourEyesEnforced
    ? isAwaitingSecondary
      ? pendingAction === "approve"
        ? "Approving as second reviewer…"
        : "Approve as second reviewer"
      : pendingAction === "approve"
        ? "Approving as first reviewer…"
        : "Approve as first reviewer"
    : pendingAction === "approve"
      ? "Approving…"
      : "Approve";

  const submitAction = (action: ReviewActionKind): void => {
    const trimmedNote = note.trim();
    onAction({
      action,
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
    });
    if (action !== "note" || trimmedNote.length === 0) {
      setNote("");
    }
  };

  return (
    <section
      data-testid="ti-test-case-detail"
      aria-label={`Test case ${testCase.id} detail`}
      className="flex flex-col gap-4 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-white/45">
            {testCase.id}
          </span>
          <span
            className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${reviewBadge.className}`}
            data-testid="ti-detail-review-state"
          >
            {reviewBadge.label}
          </span>
          {policyBadge ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${policyBadge.className}`}
              data-testid="ti-detail-policy-decision"
            >
              {policyBadge.label}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase ${priorityBadge.className}`}
          >
            {priorityBadge.label}
          </span>
          <span className="text-[10px] text-white/50">
            {formatTestTypeLabel(testCase.type)} ·{" "}
            {formatRiskCategoryLabel(testCase.riskCategory)}
          </span>
        </div>
        <h2 className="m-0 break-words text-base font-semibold text-white">
          {testCase.title}
        </h2>
        <p className="m-0 break-words text-[12px] leading-relaxed text-white/65">
          {testCase.objective}
        </p>
        {fourEyesEnforced ? (
          <div
            data-testid="ti-detail-four-eyes-notice"
            className="m-0 flex flex-col gap-1 rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200"
          >
            <p className="m-0 font-semibold">
              Four-eyes review enforced. Two distinct approvers are required
              before this case may be approved.
            </p>
            {fourEyesReasons && fourEyesReasons.length > 0 ? (
              <p
                data-testid="ti-detail-four-eyes-reasons"
                className="m-0 text-amber-200/85"
              >
                Reason{fourEyesReasons.length > 1 ? "s" : ""}:{" "}
                {fourEyesReasons.join(", ")}
              </p>
            ) : null}
            {primaryReviewer ? (
              <p
                data-testid="ti-detail-four-eyes-primary"
                className="m-0 text-amber-200/85"
              >
                First approver:{" "}
                <span className="font-mono">{primaryReviewer}</span>. A second
                distinct approver is required.
              </p>
            ) : null}
          </div>
        ) : null}
        {approvers.length > 0 ? (
          <p
            data-testid="ti-detail-approvers"
            className="m-0 text-[11px] text-white/55"
          >
            Approvers: {approvers.join(", ")}
          </p>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailList
          testId="ti-detail-preconditions"
          label="Preconditions"
          items={testCase.preconditions}
        />
        <DetailList
          testId="ti-detail-test-data"
          label="Test data"
          items={testCase.testData}
        />
      </div>

      <section
        aria-label="Test steps"
        className="flex flex-col gap-2"
        data-testid="ti-detail-steps"
      >
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/55">
          Steps
        </h3>
        {testCase.steps.length === 0 ? (
          <p className="m-0 text-[12px] text-white/55">No steps recorded.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {testCase.steps.map((step) => (
              <li
                key={step.index}
                data-testid={`ti-detail-step-${step.index}`}
                className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-white/45">
                    Step {step.index}
                  </span>
                  <span className="break-words text-[12px] text-white">
                    {step.action}
                  </span>
                </div>
                {step.data ? (
                  <p className="m-0 mt-1 break-words text-[11px] text-white/55">
                    <span className="text-white/35">Data:</span> {step.data}
                  </p>
                ) : null}
                {step.expected ? (
                  <p className="m-0 mt-1 break-words text-[11px] text-white/55">
                    <span className="text-white/35">Expected:</span>{" "}
                    {step.expected}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <DetailList
        testId="ti-detail-expected-results"
        label="Expected results"
        items={testCase.expectedResults}
      />

      <section
        aria-label="Figma trace references"
        className="flex flex-col gap-2"
        data-testid="ti-detail-figma-trace"
      >
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/55">
          Figma trace references
        </h3>
        {testCase.figmaTraceRefs.length === 0 ? (
          <p className="m-0 text-[12px] text-amber-300/75">
            No Figma trace references — coverage may be incomplete.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {testCase.figmaTraceRefs.map((ref, index) => (
              <li
                key={`${ref.screenId}-${ref.nodeId ?? "screen"}-${String(index)}`}
                data-testid="ti-detail-figma-trace-row"
                className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-1.5 text-[11px] text-white/65"
              >
                <span className="font-mono text-white/85">{ref.screenId}</span>
                {ref.nodeId ? (
                  <>
                    <span className="text-white/35"> · </span>
                    <span className="font-mono text-white/65">
                      {ref.nodeId}
                    </span>
                  </>
                ) : null}
                {ref.nodeName ? (
                  <>
                    <span className="text-white/35"> · </span>
                    <span className="text-white/85">{ref.nodeName}</span>
                  </>
                ) : null}
                {ref.nodePath ? (
                  <p className="m-0 break-words text-[10px] text-white/45">
                    {ref.nodePath}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <VisualObservations
        records={visualRecords}
        qcMappingEntry={qcMappingEntry}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailList
          testId="ti-detail-assumptions"
          label="Assumptions"
          items={testCase.assumptions}
          emptyHint="No assumptions recorded."
        />
        <DetailList
          testId="ti-detail-open-questions"
          label="Open questions"
          items={testCase.openQuestions}
          emptyHint="No open questions."
        />
      </div>

      {policyViolations.length > 0 ? (
        <section
          data-testid="ti-detail-policy-violations"
          aria-label="Policy violations for this test case"
          className={`flex flex-col gap-2 rounded border px-3 py-2 ${
            blockingViolations.length > 0
              ? "border-rose-500/30 bg-rose-950/15"
              : "border-amber-500/30 bg-amber-950/15"
          }`}
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/85">
            Policy violations
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {[...blockingViolations, ...warningViolations].map(
              (violation, index) => (
                <li
                  key={`${violation.rule}-${String(index)}`}
                  data-testid={`ti-detail-policy-violation-${index}`}
                  className="break-words text-[11px] text-white/85"
                >
                  <span
                    className={
                      violation.severity === "error"
                        ? "font-semibold text-rose-200"
                        : "font-semibold text-amber-200"
                    }
                  >
                    {violation.outcome}
                  </span>
                  <span className="text-white/35"> · </span>
                  <span>{violation.reason}</span>
                  {violation.path ? (
                    <span className="ml-1 font-mono text-[10px] text-white/45">
                      ({violation.path})
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      <section
        data-testid="ti-detail-actions"
        aria-label="Review actions"
        className="flex flex-col gap-2 rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
      >
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
          Review actions
        </h3>
        {writeBlockedReason ? (
          <p
            data-testid="ti-detail-actions-disabled"
            className="m-0 rounded border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-200"
          >
            {writeBlockedReason}
          </p>
        ) : null}
        {actionError ? (
          <p
            data-testid="ti-detail-actions-error"
            role="alert"
            className="m-0 rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200"
          >
            {actionError}
          </p>
        ) : null}
        <label
          className="flex flex-col gap-1 text-[11px] text-white/65"
          htmlFor="ti-detail-note"
        >
          Reviewer note (optional)
        </label>
        <textarea
          id="ti-detail-note"
          data-testid="ti-detail-note-input"
          value={note}
          onChange={(event) => {
            setNote(event.target.value.slice(0, NOTE_MAX_LENGTH));
          }}
          maxLength={NOTE_MAX_LENGTH}
          rows={3}
          className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 text-[12px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
          placeholder="Add context, evidence, or a clarification request"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="ti-detail-action-approve"
            disabled={approveBlocked}
            onClick={() => {
              submitAction("approve");
            }}
            className="cursor-pointer rounded border border-emerald-500/30 bg-emerald-950/30 px-2 py-1 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {approveLabel}
          </button>
          <button
            type="button"
            data-testid="ti-detail-action-reject"
            disabled={!bearerTokenAvailable || pendingAction !== null}
            onClick={() => {
              submitAction("reject");
            }}
            className="cursor-pointer rounded border border-rose-500/30 bg-rose-950/30 px-2 py-1 text-[11px] font-medium text-rose-200 transition hover:border-rose-400/60 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "reject" ? "Rejecting…" : "Reject"}
          </button>
          <button
            type="button"
            data-testid="ti-detail-action-needs-clarification"
            disabled={!bearerTokenAvailable || pendingAction !== null}
            onClick={() => {
              submitAction("needs-clarification");
            }}
            className="cursor-pointer rounded border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "needs-clarification"
              ? "Sending…"
              : "Needs clarification"}
          </button>
          <button
            type="button"
            data-testid="ti-detail-action-note"
            disabled={
              !bearerTokenAvailable ||
              pendingAction !== null ||
              note.trim().length === 0
            }
            onClick={() => {
              submitAction("note");
            }}
            className="cursor-pointer rounded border border-white/15 bg-[#1d1d1d] px-2 py-1 text-[11px] font-medium text-white/75 transition hover:border-white/35 hover:bg-[#262626] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "note" ? "Saving note…" : "Add note"}
          </button>
          {reviewerHandle ? (
            <span className="text-[10px] text-white/45">
              as <span className="font-mono">{reviewerHandle}</span>
            </span>
          ) : null}
        </div>
      </section>
    </section>
  );
}

interface VisualObservationsProps {
  records: readonly VisualSidecarRecord[];
  qcMappingEntry: QcMappingPreviewEntry | undefined;
}

function VisualObservations({
  records,
  qcMappingEntry,
}: VisualObservationsProps): JSX.Element {
  const visualProvenance = qcMappingEntry?.visualProvenance;

  if (records.length === 0 && !qcMappingEntry) {
    return (
      <section
        data-testid="ti-detail-visual-observations"
        aria-label="Visual observations"
        className="rounded border border-dashed border-white/10 bg-[#0f0f0f] px-3 py-3 text-[12px] text-white/45"
      >
        No visual observations or QC mapping preview are linked to this case.
      </section>
    );
  }

  return (
    <section
      data-testid="ti-detail-visual-observations"
      aria-label="Visual observations"
      className="flex flex-col gap-2 rounded border border-white/10 bg-[#0f0f0f] px-3 py-3"
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/55">
        Visual observations
      </h3>

      {records.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {records.map((record) => (
            <li
              key={record.screenId}
              data-testid={`ti-detail-visual-record-${record.screenId}`}
              className="rounded border border-white/10 bg-[#0a0a0a] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-white">
                  {record.screenId}
                </span>
                <span className="text-[10px] text-white/55">
                  role{" "}
                  <span className="font-mono text-white/80">
                    visual_sidecar
                  </span>
                </span>
                <span className="text-[10px] text-white/55">
                  deployment{" "}
                  <span className="font-mono text-white/80">
                    {record.deployment}
                  </span>
                </span>
                <span className="text-[10px] text-white/55">
                  confidence{" "}
                  <span className="font-mono text-white/80">
                    {formatConfidence(record.meanConfidence)}
                  </span>
                </span>
                <span className="text-[10px] text-white/55">
                  ambiguity{" "}
                  <span className="font-mono text-white/80">
                    {record.issues.length}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {record.outcomes.map((outcome) => {
                  const badge = formatVisualSidecarOutcomeBadge(outcome);
                  return (
                    <span
                      key={`${record.screenId}-${outcome}`}
                      className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {qcMappingEntry ? (
        <section
          data-testid="ti-detail-qc-mapping"
          aria-label="QC mapping preview"
          className="rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 text-[11px] text-white/65"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white/85">
              QC export preview
            </span>
            <span
              className={
                qcMappingEntry.exportable ? "text-emerald-200" : "text-rose-200"
              }
            >
              {qcMappingEntry.exportable ? "Exportable" : "Blocked"}
            </span>
            <span className="font-mono text-white/55">
              {qcMappingEntry.targetFolderPath}
            </span>
          </div>
          {qcMappingEntry.blockingReasons.length > 0 ? (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
              {qcMappingEntry.blockingReasons.map((reason, index) => (
                <li
                  key={`${reason}-${String(index)}`}
                  data-testid={`ti-detail-qc-blocking-reason-${index}`}
                  className="break-words text-rose-200"
                >
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
          {visualProvenance ? (
            <dl
              data-testid="ti-detail-qc-visual-provenance"
              className="m-0 mt-2 grid gap-1 text-[10px] sm:grid-cols-2"
            >
              <ProvenanceTerm
                label="Fallback"
                value={visualProvenance.fallbackReason}
              />
              <ProvenanceTerm
                label="Confidence"
                value={formatConfidence(visualProvenance.confidenceMean)}
              />
              <ProvenanceTerm
                label="Ambiguity"
                value={String(visualProvenance.ambiguityCount)}
              />
              <ProvenanceTerm
                label="Evidence"
                value={visualProvenance.evidenceHash.slice(0, 12)}
              />
            </dl>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

interface ProvenanceTermProps {
  label: string;
  value: string;
}

function ProvenanceTerm({ label, value }: ProvenanceTermProps): JSX.Element {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0 text-white/40">{label}</dt>
      <dd className="m-0 min-w-0 break-words font-mono text-white/75">
        {value}
      </dd>
    </div>
  );
}

interface DetailListProps {
  label: string;
  items: readonly string[];
  testId: string;
  emptyHint?: string;
}

function DetailList({
  label,
  items,
  testId,
  emptyHint,
}: DetailListProps): JSX.Element {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-1"
      data-testid={testId}
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/55">
        {label}
      </h3>
      {items.length === 0 ? (
        <p className="m-0 text-[12px] text-white/45">{emptyHint ?? "—"}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((item, index) => (
            <li
              key={`${testId}-${String(index)}`}
              className="break-words text-[12px] text-white/85"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
