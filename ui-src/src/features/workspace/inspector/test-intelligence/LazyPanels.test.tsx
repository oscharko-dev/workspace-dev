import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentFindingsPanel } from "./AgentFindingsPanel";
import { CoveragePlanPanel } from "./CoveragePlanPanel";
import { IterationsPanel } from "./IterationsPanel";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel";
import { buildTestCase } from "./test-fixtures";
import type {
  AgentIterationsArtifact,
  CoveragePlan,
  JudgePanelVerdict,
  AdversarialGapFinding,
} from "./types";

afterEach(() => {
  cleanup();
});

const structuredCoveragePlan: CoveragePlan = {
  schemaVersion: "1.0.0",
  jobId: "job-1",
  perScreen: [
    {
      screenId: "screen-login",
      techniqueQuotas: [
        {
          technique: "decision_table",
          minCount: 2,
        },
        {
          technique: "boundary_value",
          minCount: 1,
        },
      ],
    },
  ],
  perElement: [
    {
      screenId: "screen-login",
      elementId: "field-email",
      mustHaveCase: true,
      riskClass: "medium",
    },
  ],
  minimumCases: [
    {
      requirementId: "min-1",
      technique: "boundary_analysis",
      reasonCode: "required_signal",
      targetIds: ["field-email", "field-password"],
      sourceRefs: ["jira-primary"],
      visualRefs: ["screen-login"],
    },
  ],
  recommendedCases: [
    {
      requirementId: "rec-1",
      technique: "negative_testing",
      reasonCode: "risk_follow_up",
      targetIds: ["action-submit"],
      sourceRefs: ["jira-primary"],
      visualRefs: [],
    },
  ],
  techniques: ["boundary_analysis", "negative_testing"],
  mutationKillRateTarget: 0.58,
};

const legacyCoveragePlan: CoveragePlan = {
  schemaVersion: "1.0.0",
  jobId: "job-legacy",
  minimumCases: [
    {
      requirementId: "legacy-min-1",
      technique: "boundary_analysis",
      reasonCode: "required_signal",
      targetIds: ["field-email"],
      sourceRefs: ["jira-primary"],
      visualRefs: ["screen-login"],
    },
  ],
  recommendedCases: [
    {
      requirementId: "legacy-rec-1",
      technique: "negative_testing",
      reasonCode: "risk_follow_up",
      targetIds: ["action-submit"],
      sourceRefs: ["jira-primary"],
      visualRefs: [],
    },
  ],
  techniques: ["boundary_analysis"],
  mutationKillRateTarget: 0.58,
};

const judgePanelVerdicts: readonly JudgePanelVerdict[] = [
  {
    schemaVersion: "1.0.0",
    testCaseId: "tc-1",
    criterion: "traceability",
    perJudge: [
      {
        judgeId: "judge-a",
        modelBinding: "mock",
        score: 0.9,
        calibratedScore: 0.9,
        verdict: "fail",
        reason: "Trace link was incomplete.",
      },
    ],
    agreement: "both_fail",
    resolvedSeverity: "critical",
    escalationRoute: "needs_review",
  },
];

const adversarialGapFindings: readonly AdversarialGapFinding[] = [
  {
    schemaVersion: "1.0.0",
    findingId: "gap-1",
    kind: "missing_case",
    severity: "major",
    summary: "Missing negative-path case for invalid credentials.",
    sourceRefs: ["jira-primary"],
    ruleRefs: ["rule-1"],
    relatedMutationIds: ["mut-1"],
    missingCaseType: "negative",
  },
];

const agentIterations: AgentIterationsArtifact = {
  schemaVersion: "1.0.0",
  contractVersion: "1.0.0",
  jobId: "job-1",
  generatedAt: "2026-05-04T10:00:00.000Z",
  iterations: [
    {
      iteration: 2,
      roleStepId: "repair-pass",
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "2026-05-04T10:01:00.000Z",
      outcome: "needs_repair",
      findingsCount: 3,
      parentHash: "abcdef1234567890abcdef1234567890",
    },
  ],
};

describe("lazy inspector panels", () => {
  it("renders CoveragePlanPanel empty and populated states", () => {
    const { rerender } = render(<CoveragePlanPanel coveragePlan={undefined} />);
    expect(screen.getByTestId("ti-coverage-plan-panel")).toHaveTextContent(
      /No deterministic coverage plan artifact is available/i,
    );

    rerender(
      <CoveragePlanPanel
        coveragePlan={{
          schemaVersion: "1.0.0",
          jobId: "job-empty-structured",
          perScreen: [],
          perElement: [],
          techniques: [],
          mutationKillRateTarget: 0.58,
        }}
      />,
    );
    expect(
      screen.getByTestId("ti-coverage-plan-screen-quotas"),
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId("ti-coverage-plan-element-targets"),
    ).toHaveTextContent("0");
    expect(screen.getByTestId("ti-coverage-plan-screen-list")).toHaveTextContent(
      "Per-screen technique quotas: none.",
    );
    expect(
      screen.getByTestId("ti-coverage-plan-element-list"),
    ).toHaveTextContent("Per-element coverage targets: none.");

    rerender(<CoveragePlanPanel coveragePlan={structuredCoveragePlan} />);
    expect(
      screen.getByTestId("ti-coverage-plan-screen-quotas"),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("ti-coverage-plan-element-targets"),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("ti-coverage-plan-screen-list")).toHaveTextContent(
      "screen-login",
    );
    expect(screen.getByTestId("ti-coverage-plan-screen-list")).toHaveTextContent(
      "decision table x2",
    );
    expect(
      screen.getByTestId("ti-coverage-plan-element-list"),
    ).toHaveTextContent("field-email");
    expect(
      screen.getByTestId("ti-coverage-plan-element-list"),
    ).toHaveTextContent("required");
    expect(
      screen.getByTestId("ti-coverage-plan-element-list"),
    ).toHaveTextContent("Risk class: medium");
  });

  it("falls back to legacy coverage requirements when structured fields are absent", () => {
    render(<CoveragePlanPanel coveragePlan={legacyCoveragePlan} />);
    expect(screen.getByTestId("ti-coverage-plan-minimum")).toHaveTextContent(
      "1",
    );
    expect(
      screen.getByTestId("ti-coverage-plan-minimum-list"),
    ).toHaveTextContent("boundary analysis");
    expect(
      screen.getByTestId("ti-coverage-plan-recommended-list"),
    ).toHaveTextContent("risk follow up");
  });

  it("renders the empty requirement list when a coverage section has no items", () => {
    render(
      <CoveragePlanPanel
        coveragePlan={{ ...legacyCoveragePlan, minimumCases: [], recommendedCases: [] }}
      />,
    );
    expect(
      screen.getByTestId("ti-coverage-plan-recommended-list"),
      ).toHaveTextContent("Recommended follow-up: none.");
  });

  it("renders AgentFindingsPanel empty and populated states", () => {
    const { rerender } = render(
      <AgentFindingsPanel
        judgePanelVerdicts={undefined}
        adversarialGapFindings={undefined}
      />,
    );
    expect(screen.getByTestId("ti-agent-findings-panel")).toHaveTextContent(
      /No judge or gap-finder findings were emitted/i,
    );

    rerender(
      <AgentFindingsPanel
        judgePanelVerdicts={judgePanelVerdicts}
        adversarialGapFindings={adversarialGapFindings}
      />,
    );
    expect(screen.getByTestId("ti-agent-findings-panel")).toHaveTextContent(
      "2 findings",
    );
    expect(screen.getByTestId("ti-agent-findings-panel")).toHaveTextContent(
      "traceability",
    );
    expect(screen.getByTestId("ti-agent-findings-panel")).toHaveTextContent(
      "Missing negative-path case for invalid credentials.",
    );
  });

  it("renders OpenQuestionsPanel empty and populated states", () => {
    const emptyCase = buildTestCase({ assumptions: [], openQuestions: [] });
    const populatedCase = buildTestCase({
      openQuestions: ["Should SSO fallback be covered in this run?"],
    });
    const { rerender } = render(<OpenQuestionsPanel testCases={[emptyCase]} />);
    expect(screen.getByTestId("ti-open-questions-panel")).toHaveTextContent(
      /No open assumptions or questions are recorded/i,
    );

    rerender(<OpenQuestionsPanel testCases={[populatedCase]} />);
    expect(screen.getByTestId("ti-open-questions-panel")).toHaveTextContent(
      "2 items",
    );
    expect(screen.getByTestId("ti-open-questions-panel")).toHaveTextContent(
      "The auth backend is reachable",
    );
    expect(screen.getByTestId("ti-open-questions-panel")).toHaveTextContent(
      "Should SSO fallback be covered in this run?",
    );
  });

  it("renders IterationsPanel empty and populated states", () => {
    const { rerender } = render(<IterationsPanel agentIterations={undefined} />);
    expect(screen.getByTestId("ti-iterations-panel")).toHaveTextContent(
      /No repair iteration log is available/i,
    );

    rerender(<IterationsPanel agentIterations={agentIterations} />);
    expect(screen.getByTestId("ti-iterations-panel")).toHaveTextContent(
      "1 recorded",
    );
    expect(screen.getByTestId("ti-iterations-panel")).toHaveTextContent(
      "repair-pass",
    );
    expect(screen.getByTestId("ti-iterations-panel")).toHaveTextContent(
      "needs repair",
    );
    expect(screen.getByTestId("ti-iterations-panel")).toHaveTextContent(
      "abcdef123456",
    );
  });
});
