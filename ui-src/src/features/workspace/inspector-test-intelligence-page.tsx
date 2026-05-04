// ---------------------------------------------------------------------------
// Test Intelligence Inspector page (Issue #1367)
//
// Mounted at `/workspace/ui/inspector/test-intelligence`. Reads jobId from
// query params or from the picker on the empty state. Renders the test case
// list, detail panel, policy summary, coverage panel, and visual sidecar
// panel side-by-side. Handles empty / loading / failed / partial-result
// states explicitly per Issue #1367 acceptance criteria.
// ---------------------------------------------------------------------------

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../lib/http";
import { CoveragePanel } from "./inspector/test-intelligence/CoveragePanel";
import { PolicySummaryPanel } from "./inspector/test-intelligence/PolicySummaryPanel";
import {
  TestCaseDetailPanel,
  type ReviewActionKind,
} from "./inspector/test-intelligence/TestCaseDetailPanel";
import {
  TestCaseListPanel,
  type TestCaseListEntry,
} from "./inspector/test-intelligence/TestCaseListPanel";
import { TestCasesCardGrid } from "./inspector/test-intelligence/TestCasesCardGrid";
import { VisualSidecarPanel } from "./inspector/test-intelligence/VisualSidecarPanel";
import { ConflictResolutionPanel } from "./inspector/test-intelligence/conflict-resolution-panel";
import { CustomerDownloadsBar } from "./inspector/test-intelligence/CustomerDownloadsBar";
import { FigmaUrlTab } from "./inspector/test-intelligence/figma-url-tab";
import { JiraWritePanel } from "./inspector/test-intelligence/jira-write-panel";
import { JobHistoryStrip } from "./inspector/test-intelligence/JobHistoryStrip";
import { MultiSourceIngestionPanel } from "./inspector/test-intelligence/multi-source-ingestion-panel";
import { SourceListPanel } from "./inspector/test-intelligence/source-list-panel";
import { fetchTestIntelligenceJobs } from "./inspector/test-intelligence/api";
import {
  safeReadStorage,
  safeWriteStorage,
} from "./inspector/test-intelligence/safe-storage";
import { useTestIntelligenceJob } from "./inspector/test-intelligence/useTestIntelligenceJob";
import type {
  ExportReport,
  PolicyDecisionRecord,
  PolicyViolation,
  QcMappingPreviewArtifact,
  QcMappingPreviewEntry,
  ReviewSnapshotEntry,
  TestIntelligenceJobSummary,
  VisualSidecarRecord,
} from "./inspector/test-intelligence/types";

const REVIEWER_HANDLE_STORAGE_KEY = "workspace-dev:ti-reviewer-handle:v1";
const REVIEWER_BEARER_STORAGE_KEY = "workspace-dev:ti-reviewer-bearer:v1";
const MULTI_SOURCE_STORAGE_KEY_PREFIX = "workspace-dev:ti-multisource-";
type TestIntelligenceTab =
  | "overview"
  | "coverage-plan"
  | "agent-findings"
  | "iterations"
  | "open-questions"
  | "catch-up-brief"
  | "evidence-status"
  | "role-monitor"
  | "multi-source";

const LazyCoveragePlanPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/CoveragePlanPanel"))
    .CoveragePlanPanel,
}));

const LazyAgentFindingsPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/AgentFindingsPanel"))
    .AgentFindingsPanel,
}));

const LazyIterationsPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/IterationsPanel"))
    .IterationsPanel,
}));

const LazyOpenQuestionsPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/OpenQuestionsPanel"))
    .OpenQuestionsPanel,
}));

const LazyEvidenceStatusPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/EvidenceStatusPanel"))
    .EvidenceStatusPanel,
}));

const LazyCatchUpBriefPanel = lazy(async () => ({
  default: (await import("./inspector/test-intelligence/CatchUpBriefPanel"))
    .CatchUpBriefPanel,
}));

const LazyRoleMonitorTimelinePanel = lazy(async () => ({
  default: (
    await import("./inspector/test-intelligence/RoleMonitorTimelinePanel")
  ).RoleMonitorTimelinePanel,
}));

const normalizeReviewerStorageSegment = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return "anonymous";
  const normalized = trimmed.replace(/[^a-z0-9._-]+/g, "-");
  return normalized.length > 0 ? normalized.slice(0, 64) : "anonymous";
};

const multiSourceStorageKey = (reviewerHandle: string): string =>
  `${MULTI_SOURCE_STORAGE_KEY_PREFIX}${normalizeReviewerStorageSegment(reviewerHandle)}:v1`;

const parseStoredTab = (value: string): TestIntelligenceTab =>
  value === "coverage-plan" ||
  value === "agent-findings" ||
  value === "iterations" ||
  value === "open-questions" ||
  value === "catch-up-brief" ||
  value === "evidence-status" ||
  value === "role-monitor" ||
  value === "multi-source"
    ? value
    : "overview";

interface TabDefinition {
  id: TestIntelligenceTab;
  label: string;
}

const PRIMARY_TAB_DEFINITIONS: readonly TabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "coverage-plan", label: "Coverage Plan" },
  { id: "agent-findings", label: "Agent Findings" },
  { id: "iterations", label: "Iterations" },
  { id: "open-questions", label: "Open Questions" },
  { id: "catch-up-brief", label: "Catch-Up Brief" },
  { id: "evidence-status", label: "Evidence Status" },
  { id: "role-monitor", label: "Role Monitor Timeline" },
] as const;

function BackIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="size-4"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface RuntimeStatus {
  testIntelligenceEnabled?: boolean;
  testIntelligenceMultiSourceEnabled?: boolean;
  testIntelligenceJiraGatewayConfigured?: boolean;
}

function isRuntimeStatus(value: unknown): value is RuntimeStatus {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface TestIntelligenceInnerProps {
  jobId: string;
  bearerToken: string;
  reviewerHandle: string;
  multiSourceEnabled: boolean;
  jiraGatewayConfigured: boolean;
  onBearerTokenChange: (value: string) => void;
  onReviewerHandleChange: (value: string) => void;
  onSelectJob: (jobId: string) => void;
}

function buildTestCaseListEntries(props: {
  bundle: ReturnType<typeof useTestIntelligenceJob>["bundle"];
  reviewSnapshot: Record<string, ReviewSnapshotEntry>;
  policyByCase: Record<string, PolicyDecisionRecord>;
}): TestCaseListEntry[] {
  const cases = props.bundle?.generatedTestCases?.testCases ?? [];
  return cases.map((testCase) => {
    const snapshot = props.reviewSnapshot[testCase.id];
    const policyRecord = props.policyByCase[testCase.id];
    return {
      testCase,
      ...(snapshot ? { reviewState: snapshot.state } : {}),
      ...(policyRecord ? { policyDecision: policyRecord.decision } : {}),
      policyBlocked: policyRecord?.decision === "blocked",
      approverCount: snapshot?.approvers.length ?? 0,
    };
  });
}

function buildCatchUpBrief(props: {
  bundle: ReturnType<typeof useTestIntelligenceJob>["bundle"];
  listEntries: readonly TestCaseListEntry[];
}): string[] {
  const items: string[] = [];
  if ((props.bundle?.parseErrors.length ?? 0) > 0) {
    items.push(
      `Resolve ${props.bundle?.parseErrors.length ?? 0} partial-result artifact parse issue(s) before final review decisions.`,
    );
  }
  const needsReviewCount =
    props.bundle?.reviewSnapshot?.needsReviewCount ??
    props.listEntries.filter((entry) => entry.reviewState === "needs_review")
      .length;
  if (needsReviewCount > 0) {
    items.push(`${needsReviewCount} generated case(s) still need reviewer attention.`);
  }
  const unresolvedConflictCount =
    props.bundle?.multiSourceReconciliation?.conflicts.filter(
      (conflict) => conflict.effectiveState !== "resolved",
    ).length ?? 0;
  if (unresolvedConflictCount > 0) {
    items.push(
      `Resolve ${unresolvedConflictCount} multi-source conflict(s) before relying on reconciled findings.`,
    );
  }
  const evidenceIssues =
    (props.bundle?.judgePanelVerdicts?.filter(
      (verdict) => verdict.escalationRoute === "needs_review",
    ).length ?? 0) +
    (props.bundle?.adversarialGapFindings?.length ?? 0);
  if (evidenceIssues > 0) {
    items.push(
      `${evidenceIssues} agent finding(s) may require follow-up before export or transfer.`,
    );
  }
  return items.slice(0, 3);
}

function TestIntelligenceTabList({
  tabs,
  selectedTab,
  onSelect,
}: {
  tabs: readonly TabDefinition[];
  selectedTab: TestIntelligenceTab;
  onSelect: (tab: TestIntelligenceTab) => void;
}): JSX.Element {
  const tabListId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div
      data-testid="ti-tablist"
      role="tablist"
      aria-label="Test intelligence views"
      id={tabListId}
      className="flex flex-wrap items-center gap-2"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`ti-tab-${tab.id}`}
          aria-selected={selectedTab === tab.id}
          aria-controls={`ti-panel-${tab.id}`}
          tabIndex={selectedTab === tab.id ? 0 : -1}
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
              return;
            }
            event.preventDefault();
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const nextIndex = (index + direction + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            if (!nextTab) return;
            onSelect(nextTab.id);
            tabRefs.current[nextIndex]?.focus();
          }}
          className={`cursor-pointer rounded border px-2 py-1 text-[11px] ${
            selectedTab === tab.id
              ? "border-[#4eba87]/40 bg-emerald-950/20 text-[#4eba87]"
              : "border-white/10 bg-[#171717] text-white/60"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function CatchUpBriefPanel({ items }: { items: readonly string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section
      data-testid="ti-catch-up-brief"
      aria-label="Catch-up brief"
      className="rounded border border-sky-500/25 bg-sky-950/15 px-4 py-3 text-[12px] text-sky-100"
    >
      <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-sky-200">
        Catch-Up Brief
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function TestIntelligenceInner({
  jobId,
  bearerToken,
  reviewerHandle,
  multiSourceEnabled,
  jiraGatewayConfigured,
  onBearerTokenChange,
  onReviewerHandleChange,
  onSelectJob,
}: TestIntelligenceInnerProps): JSX.Element {
  const job = useTestIntelligenceJob({
    jobId,
    bearerToken,
    reviewerHandle,
  });
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(
    null,
  );
  const [selectedTab, setSelectedTab] = useState<TestIntelligenceTab>(() =>
    parseStoredTab(safeReadStorage(multiSourceStorageKey(reviewerHandle))),
  );
  const selectedTabStorageKey = useMemo(
    () => multiSourceStorageKey(reviewerHandle),
    [reviewerHandle],
  );

  useEffect(() => {
    safeWriteStorage(selectedTabStorageKey, selectedTab);
  }, [selectedTab, selectedTabStorageKey]);

  useEffect(() => {
    if (selectedTab === "multi-source" && !multiSourceEnabled) {
      setSelectedTab("overview");
    }
  }, [multiSourceEnabled, selectedTab]);

  const reviewSnapshotByCase = useMemo<
    Record<string, ReviewSnapshotEntry>
  >(() => {
    const map: Record<string, ReviewSnapshotEntry> = {};
    const entries =
      job.reviewState?.snapshot.perTestCase ??
      job.bundle?.reviewSnapshot?.perTestCase ??
      [];
    for (const entry of entries) {
      map[entry.testCaseId] = entry;
    }
    return map;
  }, [job.bundle?.reviewSnapshot, job.reviewState?.snapshot.perTestCase]);

  const policyByCase = useMemo<Record<string, PolicyDecisionRecord>>(() => {
    const map: Record<string, PolicyDecisionRecord> = {};
    for (const decision of job.bundle?.policyReport?.decisions ?? []) {
      map[decision.testCaseId] = decision;
    }
    return map;
  }, [job.bundle?.policyReport?.decisions]);

  const listEntries = useMemo(
    () =>
      buildTestCaseListEntries({
        bundle: job.bundle,
        reviewSnapshot: reviewSnapshotByCase,
        policyByCase,
      }),
    [job.bundle, policyByCase, reviewSnapshotByCase],
  );

  const effectiveSelectedTestCaseId =
    selectedTestCaseId !== null
      ? selectedTestCaseId
      : (listEntries[0]?.testCase.id ?? null);
  const selectedEntry =
    listEntries.find(
      (entry) => entry.testCase.id === effectiveSelectedTestCaseId,
    ) ?? null;
  const selectedSnapshot = selectedEntry
    ? reviewSnapshotByCase[selectedEntry.testCase.id]
    : undefined;
  const selectedPolicyDecision = selectedEntry
    ? policyByCase[selectedEntry.testCase.id]
    : undefined;
  const selectedPolicyViolations: readonly PolicyViolation[] =
    selectedPolicyDecision?.violations ?? [];
  const selectedScreenIds = useMemo(() => {
    return new Set(
      selectedEntry?.testCase.figmaTraceRefs.map((ref) => ref.screenId) ?? [],
    );
  }, [selectedEntry]);
  const selectedVisualRecords = useMemo<readonly VisualSidecarRecord[]>(() => {
    if (selectedScreenIds.size === 0) return [];
    return (
      job.bundle?.visualSidecarReport?.records.filter((record) =>
        selectedScreenIds.has(record.screenId),
      ) ?? []
    );
  }, [job.bundle?.visualSidecarReport?.records, selectedScreenIds]);
  const selectedQcMappingEntry = useMemo<
    QcMappingPreviewEntry | undefined
  >(() => {
    if (!selectedEntry) return undefined;
    return job.bundle?.qcMappingPreview?.entries.find(
      (entry) => entry.testCaseId === selectedEntry.testCase.id,
    );
  }, [job.bundle?.qcMappingPreview?.entries, selectedEntry]);
  const availableTabs = useMemo<readonly TabDefinition[]>(() => {
    return multiSourceEnabled
      ? [
          ...PRIMARY_TAB_DEFINITIONS,
          { id: "multi-source", label: "Multi-Source" },
        ]
      : [...PRIMARY_TAB_DEFINITIONS];
  }, [multiSourceEnabled]);
  const catchUpBriefItems = useMemo(
    () => buildCatchUpBrief({ bundle: job.bundle, listEntries }),
    [job.bundle, listEntries],
  );

  const handleAction = useCallback(
    ({ action, note }: { action: ReviewActionKind; note?: string }) => {
      if (!selectedEntry) return;
      const reviewActionKind =
        action === "needs-clarification" ? "note" : action;
      const metadata =
        action === "needs-clarification"
          ? ({ needsClarification: true } as const)
          : undefined;
      void job.submitAction({
        action: reviewActionKind,
        testCaseId: selectedEntry.testCase.id,
        ...(note !== undefined ? { note } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      });
    },
    [job, selectedEntry],
  );

  const isLoading =
    job.bundleStatus === "loading" || job.reviewStateStatus === "loading";
  const bundleErrorIs404 =
    job.bundleError !== null && job.bundleError.startsWith("JOB_NOT_FOUND");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
      <ReviewerSettingsBar
        reviewerHandle={reviewerHandle}
        bearerToken={bearerToken}
        onReviewerHandleChange={onReviewerHandleChange}
        onBearerTokenChange={onBearerTokenChange}
        onRefresh={() => {
          void job.refresh();
        }}
      />

      <TestIntelligenceTabList
        tabs={availableTabs}
        selectedTab={selectedTab}
        onSelect={setSelectedTab}
      />

      {bundleErrorIs404 ? (
        <section
          data-testid="ti-page-empty-job"
          role="status"
          className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-8 text-center text-sm text-white/60"
        >
          No test-intelligence artifacts were found for job{" "}
          <span className="font-mono text-white/85">{jobId}</span>.
        </section>
      ) : isLoading && !job.bundle ? (
        <section
          data-testid="ti-page-loading"
          role="status"
          aria-live="polite"
          className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-8 text-center text-sm text-white/60"
        >
          Loading test-intelligence artifacts…
        </section>
      ) : job.bundleStatus === "error" ? (
        <section
          data-testid="ti-page-error"
          role="alert"
          className="rounded border border-rose-500/30 bg-rose-950/20 px-4 py-4 text-sm text-rose-200"
        >
          {job.bundleError}
        </section>
      ) : (
        <CatchUpBriefPanel items={catchUpBriefItems} />
      )}
      {bundleErrorIs404 ||
      (isLoading && !job.bundle) ||
      job.bundleStatus === "error" ? null : selectedTab === "multi-source" ? (
        <div
          id="ti-panel-multi-source"
          role="tabpanel"
          aria-labelledby="ti-tab-multi-source"
          className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"
        >
          <div className="flex flex-col gap-4">
            <MultiSourceIngestionPanel
              key={jobId}
              jobId={jobId}
              bearerToken={bearerToken}
              sources={job.bundle?.sourceRefs ?? []}
              sourceEnvelope={job.bundle?.sourceEnvelope}
              jiraGatewayConfigured={jiraGatewayConfigured}
              onIngested={job.refresh}
            />
            <SourceListPanel
              sources={job.bundle?.sourceRefs ?? []}
              canRemove={bearerToken.length > 0}
              onRemove={async (sourceId) => {
                const { deleteInspectorSource } =
                  await import("./inspector/test-intelligence/api");
                const result = await deleteInspectorSource({
                  jobId,
                  sourceId,
                  bearerToken,
                });
                if (result.ok) {
                  await job.refresh();
                }
              }}
            />
          </div>
          <ConflictResolutionPanel
            conflicts={job.bundle?.multiSourceReconciliation?.conflicts ?? []}
            sourceRefs={job.bundle?.sourceRefs ?? []}
            decisions={job.bundle?.conflictDecisions}
            onResolve={async (input) => {
              const { postConflictResolution } =
                await import("./inspector/test-intelligence/api");
              const result = await postConflictResolution({
                jobId,
                conflictId: input.conflictId,
                action: input.action,
                ...(input.selectedSourceId !== undefined
                  ? { selectedSourceId: input.selectedSourceId }
                  : {}),
                ...(input.selectedNormalizedValue !== undefined
                  ? { selectedNormalizedValue: input.selectedNormalizedValue }
                  : {}),
                bearerToken,
              });
              if (result.ok) {
                await job.refresh();
              }
            }}
          />
        </div>
      ) : (
        <div
          id={`ti-panel-${selectedTab}`}
          role="tabpanel"
          aria-labelledby={`ti-tab-${selectedTab}`}
          className="flex flex-col gap-4"
        >
          {job.bundle && job.bundle.parseErrors.length > 0 ? (
            <section
              data-testid="ti-page-parse-errors"
              role="alert"
              className="rounded border border-amber-500/30 bg-amber-950/15 px-4 py-3 text-[12px] text-amber-200"
            >
              <h2 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                Partial result
              </h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {job.bundle.parseErrors.map((error, index) => (
                  <li
                    key={`${error.artifact}-${String(index)}`}
                    data-testid={`ti-page-parse-error-${index}`}
                  >
                    {error.filename}: {error.reason} — {error.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <PolicySummaryPanel
            policy={job.bundle?.policyReport}
            validation={job.bundle?.validationReport}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 text-sm font-semibold text-white">
                  Generated test cases
                </h2>
                <div className="flex items-center gap-2">
                  {job.reviewStateError ? (
                    <span
                      data-testid="ti-page-review-state-error"
                      className="rounded border border-amber-500/30 bg-amber-950/20 px-1.5 py-[1px] text-[10px] text-amber-200"
                    >
                      Review state unavailable
                    </span>
                  ) : null}
                  <CustomerDownloadsBar jobId={jobId} />
                </div>
              </header>
              <TestCasesCardGrid
                testCases={listEntries.map((e) => e.testCase)}
                selectedTestCaseId={selectedTestCaseId}
                onSelect={(id) => {
                  setSelectedTestCaseId(id);
                }}
              />
              <TestCaseListPanel
                entries={listEntries}
                selectedTestCaseId={selectedTestCaseId}
                onSelect={(id) => {
                  setSelectedTestCaseId(id);
                }}
              />
            </div>

            <div className="flex flex-col gap-3">
              {selectedEntry ? (
                <TestCaseDetailPanel
                  testCase={selectedEntry.testCase}
                  {...(selectedSnapshot
                    ? { reviewSnapshot: selectedSnapshot }
                    : {})}
                  {...(selectedPolicyDecision
                    ? { policyDecision: selectedPolicyDecision.decision }
                    : {})}
                  policyViolations={selectedPolicyViolations}
                  bearerTokenAvailable={bearerToken.length > 0}
                  pendingAction={
                    job.pendingAction === null
                      ? null
                      : job.pendingAction === "note"
                        ? "note"
                        : job.pendingAction === "approve"
                          ? "approve"
                          : job.pendingAction === "reject"
                            ? "reject"
                            : null
                  }
                  actionError={job.actionError}
                  reviewerHandle={reviewerHandle}
                  visualRecords={selectedVisualRecords}
                  {...(selectedQcMappingEntry
                    ? { qcMappingEntry: selectedQcMappingEntry }
                    : {})}
                  {...(job.bundle?.sourceRefs
                    ? { sourceRefs: job.bundle.sourceRefs }
                    : {})}
                  {...(job.bundle?.testCaseProvenance?.[
                    selectedEntry.testCase.id
                  ]
                    ? {
                        provenance:
                          job.bundle.testCaseProvenance[
                            selectedEntry.testCase.id
                          ],
                      }
                    : {})}
                  onAction={handleAction}
                  fourEyesEnforced={selectedSnapshot?.fourEyesEnforced ?? false}
                  approvers={selectedSnapshot?.approvers ?? []}
                  {...(selectedSnapshot?.fourEyesReasons
                    ? { fourEyesReasons: selectedSnapshot.fourEyesReasons }
                    : {})}
                  {...(selectedSnapshot?.primaryReviewer
                    ? { primaryReviewer: selectedSnapshot.primaryReviewer }
                    : {})}
                  {...(selectedSnapshot?.lastEditor
                    ? { lastEditor: selectedSnapshot.lastEditor }
                    : {})}
                />
              ) : (
                <section
                  data-testid="ti-page-no-selection"
                  className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-8 text-center text-sm text-white/55"
                >
                  Select a test case to inspect its detail.
                </section>
              )}
              {selectedTab === "overview" ? (
                <>
                  <CoveragePanel coverage={job.bundle?.coverageReport} />
                  <VisualSidecarPanel report={job.bundle?.visualSidecarReport} />
                  <ExportDiagnosticsPanel
                    mapping={job.bundle?.qcMappingPreview}
                    exportReport={job.bundle?.exportReport}
                  />
                  <JiraWritePanel
                    key={jobId}
                    jobId={jobId}
                    bearerToken={bearerToken}
                    onWriteComplete={() => {
                      void job.refresh();
                    }}
                  />
                  <JobHistoryStripContainer
                    selectedJobId={jobId}
                    onSelect={onSelectJob}
                  />
                </>
              ) : (
                <Suspense
                  fallback={
                    <section className="rounded border border-white/10 bg-[#171717] px-4 py-6 text-center text-[12px] text-white/45">
                      Loading panel…
                    </section>
                  }
                >
                  {selectedTab === "coverage-plan" ? (
                    <LazyCoveragePlanPanel
                      coveragePlan={job.bundle?.coveragePlan}
                    />
                  ) : selectedTab === "agent-findings" ? (
                    <LazyAgentFindingsPanel
                      judgePanelVerdicts={job.bundle?.judgePanelVerdicts}
                      adversarialGapFindings={
                        job.bundle?.adversarialGapFindings
                      }
                    />
                  ) : selectedTab === "iterations" ? (
                    <LazyIterationsPanel
                      agentIterations={job.bundle?.agentIterations}
                    />
                  ) : selectedTab === "open-questions" ? (
                    <LazyOpenQuestionsPanel
                      testCases={job.bundle?.generatedTestCases?.testCases ?? []}
                    />
                  ) : selectedTab === "catch-up-brief" ? (
                    <LazyCatchUpBriefPanel
                      briefs={job.bundle?.catchUpBriefs}
                    />
                  ) : selectedTab === "evidence-status" ? (
                    <LazyEvidenceStatusPanel
                      jobId={jobId}
                      bearerToken={bearerToken}
                    />
                  ) : selectedTab === "role-monitor" ? (
                    <LazyRoleMonitorTimelinePanel jobId={jobId} />
                  ) : null}
                </Suspense>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface JobHistoryStripContainerProps {
  selectedJobId: string;
  onSelect: (jobId: string) => void;
}

/**
 * Right-rail job history container. Owns the jobs query so the strip
 * itself stays presentational. Empty / failure / loading states are
 * folded into the empty list — the strip already handles "no rows".
 */
function JobHistoryStripContainer({
  selectedJobId,
  onSelect,
}: JobHistoryStripContainerProps): JSX.Element {
  const query = useQuery({
    queryKey: ["test-intelligence", "job-history-strip"],
    queryFn: fetchTestIntelligenceJobs,
    staleTime: 30_000,
  });
  const jobs = useMemo<TestIntelligenceJobSummary[]>(() => {
    const outcome = query.data;
    if (outcome === undefined || !outcome.ok) return [];
    return outcome.value;
  }, [query.data]);
  return (
    <JobHistoryStrip
      jobs={jobs}
      selectedJobId={selectedJobId}
      onSelect={onSelect}
    />
  );
}

interface ExportDiagnosticsPanelProps {
  mapping: QcMappingPreviewArtifact | undefined;
  exportReport: ExportReport | undefined;
}

function ExportDiagnosticsPanel({
  mapping,
  exportReport,
}: ExportDiagnosticsPanelProps): JSX.Element {
  if (!mapping && !exportReport) {
    return (
      <section
        data-testid="ti-export-diagnostics"
        aria-label="QC export diagnostics"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No QC mapping or export report has been emitted yet.
      </section>
    );
  }

  const blockedMappings =
    mapping?.entries.filter((entry) => !entry.exportable) ?? [];

  return (
    <section
      data-testid="ti-export-diagnostics"
      aria-label="QC export diagnostics"
      className={`flex flex-col gap-3 rounded border p-4 ${
        exportReport?.refused || blockedMappings.length > 0
          ? "border-rose-500/30 bg-rose-950/15"
          : "border-white/10 bg-[#171717]"
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">
          QC export diagnostics
        </h2>
        {mapping ? (
          <span className="text-[10px] text-white/45">
            profile {mapping.profileId} v{mapping.profileVersion}
          </span>
        ) : null}
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        <ExportStat
          label="Mapped cases"
          value={String(mapping?.entries.length ?? 0)}
          testId="ti-export-mapped-count"
        />
        <ExportStat
          label="Blocked mappings"
          value={String(blockedMappings.length)}
          testId="ti-export-blocked-count"
        />
        <ExportStat
          label="Exported artifacts"
          value={String(exportReport?.artifacts.length ?? 0)}
          testId="ti-export-artifact-count"
        />
      </div>

      {exportReport?.refused ? (
        <section
          data-testid="ti-export-refusal-codes"
          aria-label="Export refusal codes"
          className="rounded border border-rose-500/30 bg-rose-950/20 px-3 py-2"
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-rose-200">
            Export refused
          </h3>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {exportReport.refusalCodes.map((code, index) => (
              <li
                key={`${code}-${String(index)}`}
                data-testid={`ti-export-refusal-code-${index}`}
                className="break-words font-mono text-[11px] text-white/85"
              >
                {code}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {blockedMappings.length > 0 ? (
        <section
          data-testid="ti-export-blocked-mappings"
          aria-label="Blocked QC mappings"
          className="rounded border border-amber-500/30 bg-amber-950/15 px-3 py-2"
        >
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
            Blocking mapping reasons
          </h3>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {blockedMappings.map((entry) => (
              <li
                key={entry.testCaseId}
                data-testid={`ti-export-blocked-mapping-${entry.testCaseId}`}
                className="break-words text-[11px] text-white/85"
              >
                <span className="font-mono text-white">{entry.testCaseId}</span>
                <span className="text-white/35"> · </span>
                <span>{entry.blockingReasons.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {exportReport && exportReport.visualEvidenceHashes.length > 0 ? (
        <p
          data-testid="ti-export-visual-evidence"
          className="m-0 break-words text-[11px] text-white/55"
        >
          Visual evidence hashes:{" "}
          <span className="font-mono text-white/70">
            {exportReport.visualEvidenceHashes
              .map((hash) => hash.slice(0, 12))
              .join(", ")}
          </span>
        </p>
      ) : null}
    </section>
  );
}

interface ExportStatProps {
  label: string;
  value: string;
  testId: string;
}

function ExportStat({ label, value, testId }: ExportStatProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

interface ReviewerSettingsBarProps {
  reviewerHandle: string;
  bearerToken: string;
  onReviewerHandleChange: (value: string) => void;
  onBearerTokenChange: (value: string) => void;
  onRefresh: () => void;
}

function ReviewerSettingsBar({
  reviewerHandle,
  bearerToken,
  onReviewerHandleChange,
  onBearerTokenChange,
  onRefresh,
}: ReviewerSettingsBarProps): JSX.Element {
  return (
    <section
      data-testid="ti-reviewer-settings"
      aria-label="Reviewer session settings"
      className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-[#171717] px-3 py-2 text-[11px] text-white/65"
    >
      <label className="flex items-center gap-2">
        Reviewer
        <input
          data-testid="ti-reviewer-handle-input"
          type="text"
          value={reviewerHandle}
          onChange={(event) => {
            onReviewerHandleChange(event.target.value);
          }}
          maxLength={128}
          placeholder="alice"
          className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
        />
      </label>
      <label className="flex items-center gap-2">
        Bearer token
        <input
          data-testid="ti-reviewer-bearer-input"
          type="password"
          value={bearerToken}
          onChange={(event) => {
            onBearerTokenChange(event.target.value);
          }}
          placeholder="set to enable writes"
          className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
        />
      </label>
      <button
        type="button"
        data-testid="ti-refresh-button"
        onClick={onRefresh}
        className="cursor-pointer rounded border border-white/15 bg-[#0a0a0a] px-2 py-1 text-[11px] font-medium text-white/65 transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
      >
        Refresh
      </button>
      <p
        data-testid="ti-reviewer-bearer-warning"
        role="note"
        className="m-0 basis-full text-[10px] text-amber-200/85"
      >
        The bearer token is held in <code>sessionStorage</code> and discarded
        when this tab closes — never logged, embedded in URLs, or sent to
        third-party services. Use a short-lived token whenever possible.
      </p>
    </section>
  );
}

interface JobPickerProps {
  onSelect: (jobId: string) => void;
}

function JobPicker({ onSelect }: JobPickerProps): JSX.Element {
  const query = useQuery({
    queryKey: ["test-intelligence", "job-list"],
    queryFn: fetchTestIntelligenceJobs,
  });
  const [manualJobId, setManualJobId] = useState("");

  return (
    <section
      data-testid="ti-page-job-picker"
      aria-label="Select a test-intelligence job"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <h2 className="m-0 text-sm font-semibold text-white">Select a job</h2>
      <p className="m-0 text-[12px] text-white/55">
        Pick a test-intelligence job that has artifacts in the local artifact
        root, or paste a job id manually.
      </p>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (manualJobId.trim().length > 0) {
            onSelect(manualJobId.trim());
          }
        }}
      >
        <input
          data-testid="ti-job-picker-input"
          type="text"
          value={manualJobId}
          onChange={(event) => {
            setManualJobId(event.target.value);
          }}
          placeholder="job id (e.g. validation-onboarding)"
          className="flex-1 rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
        />
        <button
          type="submit"
          data-testid="ti-job-picker-submit"
          className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87] transition hover:bg-emerald-950/40"
        >
          Inspect
        </button>
      </form>

      {query.isPending ? (
        <p className="m-0 text-[11px] text-white/55">Loading job list…</p>
      ) : query.data && query.data.ok ? (
        query.data.value.length === 0 ? (
          <p
            data-testid="ti-job-picker-empty"
            className="m-0 text-[11px] text-white/55"
          >
            No artifacts found in the test-intelligence root yet.
          </p>
        ) : (
          <ul
            data-testid="ti-job-picker-list"
            className="m-0 flex list-none flex-col gap-1 p-0"
          >
            {query.data.value.map((entry) => (
              <JobPickerRow
                key={entry.jobId}
                entry={entry}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )
      ) : (
        <p
          data-testid="ti-job-picker-error"
          role="alert"
          className="m-0 rounded border border-amber-500/30 bg-amber-950/15 px-2 py-1 text-[11px] text-amber-200"
        >
          {query.data?.ok === false
            ? query.data.message
            : "Could not load job list."}
        </p>
      )}
    </section>
  );
}

interface JobPickerRowProps {
  entry: TestIntelligenceJobSummary;
  onSelect: (jobId: string) => void;
}

function JobPickerRow({ entry, onSelect }: JobPickerRowProps): JSX.Element {
  const presentArtifacts = Object.entries(entry.hasArtifacts)
    .filter(([, present]) => present)
    .map(([key]) => key);
  return (
    <li
      data-testid={`ti-job-picker-row-${entry.jobId}`}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
    >
      <button
        type="button"
        onClick={() => {
          onSelect(entry.jobId);
        }}
        className="flex w-full cursor-pointer flex-col items-start gap-0.5 bg-transparent text-left"
      >
        <span className="font-mono text-[12px] text-white">{entry.jobId}</span>
        <span className="text-[10px] text-white/55">
          {presentArtifacts.length === 0
            ? "no artifacts on disk"
            : presentArtifacts.join(", ")}
        </span>
      </button>
    </li>
  );
}

export function InspectorTestIntelligencePage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get("jobId") ?? "";
  const [reviewerHandle, setReviewerHandle] = useState(() =>
    safeReadStorage(REVIEWER_HANDLE_STORAGE_KEY, "local"),
  );
  const [bearerToken, setBearerToken] = useState(() =>
    safeReadStorage(REVIEWER_BEARER_STORAGE_KEY, "session"),
  );

  const handleReviewerHandleChange = useCallback((value: string): void => {
    setReviewerHandle(value);
    safeWriteStorage(REVIEWER_HANDLE_STORAGE_KEY, value, "local");
  }, []);

  const handleBearerTokenChange = useCallback((value: string): void => {
    setBearerToken(value);
    safeWriteStorage(REVIEWER_BEARER_STORAGE_KEY, value, "session");
  }, []);

  const runtimeStatus = useQuery({
    queryKey: ["workspace", "runtime-status"],
    queryFn: async () => {
      const response = await fetchJson<RuntimeStatus>({ url: "/workspace" });
      if (!response.ok || !isRuntimeStatus(response.payload)) {
        return { testIntelligenceEnabled: false } satisfies RuntimeStatus;
      }
      return response.payload;
    },
  });

  const featureEnabled = runtimeStatus.data?.testIntelligenceEnabled !== false;
  const multiSourceEnabled =
    runtimeStatus.data?.testIntelligenceMultiSourceEnabled === true;
  const jiraGatewayConfigured =
    runtimeStatus.data?.testIntelligenceJiraGatewayConfigured === true;

  const handleSelectJob = useCallback(
    (selectedJobId: string): void => {
      const next = new URLSearchParams(searchParams);
      next.set("jobId", selectedJobId);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return (
    <div
      data-testid="ti-page"
      className="flex h-screen flex-col overflow-hidden bg-[#101010] text-white"
    >
      <header className="shrink-0 border-b border-[#000000] bg-[#171717]">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigate("/workspace/ui/inspector");
              }}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-white/60 transition hover:border-white/10 hover:bg-[#000000] hover:text-[#4eba87]"
            >
              <BackIcon />
              Back
            </button>
            <div className="h-4 w-px bg-[#333333]" />
            <div className="flex items-baseline gap-2">
              <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                Test Intelligence
              </h1>
              <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                inspector
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {jobId ? (
              <span className="rounded border border-white/10 bg-[#0a0a0a] px-2 py-1 font-mono text-[10px] text-white/55">
                job {jobId}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!featureEnabled ? (
          <section
            data-testid="ti-page-feature-disabled"
            role="alert"
            className="m-4 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200"
          >
            Test Intelligence is disabled on this workspace. Set
            <span className="font-mono">
              {" "}
              FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1{" "}
            </span>
            and start the server with
            <span className="font-mono"> testIntelligence.enabled=true </span>
            to enable this page.
          </section>
        ) : jobId.length === 0 ? (
          <div className="flex flex-col gap-4 px-4 py-4">
            <FigmaUrlTab
              onSubmitted={(submittedJobId) => {
                handleSelectJob(submittedJobId);
              }}
            />
            <JobPicker onSelect={handleSelectJob} />
          </div>
        ) : (
          <TestIntelligenceInner
            jobId={jobId}
            bearerToken={bearerToken}
            reviewerHandle={reviewerHandle}
            multiSourceEnabled={multiSourceEnabled}
            jiraGatewayConfigured={jiraGatewayConfigured}
            onBearerTokenChange={handleBearerTokenChange}
            onReviewerHandleChange={handleReviewerHandleChange}
            onSelectJob={handleSelectJob}
          />
        )}
      </main>
    </div>
  );
}
