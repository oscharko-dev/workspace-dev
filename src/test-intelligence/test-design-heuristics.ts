import type {
  SourceMixPlan,
  SourceMixPlanPromptSection,
  TestIntentSourceMixKind,
} from "../contracts/index.js";

export interface TestDesignHeuristic {
  readonly heuristicId: string;
  readonly order: number;
  readonly title: string;
  readonly rationale: string;
}

const COMMON_HEURISTICS: readonly TestDesignHeuristic[] = [
  {
    heuristicId: "screen_baseline_walkthrough",
    order: 10,
    title: "Screen Baseline Walkthrough",
    rationale:
      "Start from each screen's initial state before layering rule, transition, and edge coverage.",
  },
] as const;

const HEURISTICS_BY_KIND: Readonly<Record<TestIntentSourceMixKind, readonly TestDesignHeuristic[]>> =
  {
    figma_only: [
      {
        heuristicId: "stateful_visual_flow_probe",
        order: 20,
        title: "Stateful Visual Flow Probe",
        rationale:
          "Figma-backed jobs should exercise state transitions and visible control combinations derived from the screen model.",
      },
    ],
    jira_rest_only: [
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
    jira_paste_only: [
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
    figma_jira_rest: [
      {
        heuristicId: "stateful_visual_flow_probe",
        order: 20,
        title: "Stateful Visual Flow Probe",
        rationale:
          "Figma-backed jobs should exercise state transitions and visible control combinations derived from the screen model.",
      },
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
    figma_jira_paste: [
      {
        heuristicId: "stateful_visual_flow_probe",
        order: 20,
        title: "Stateful Visual Flow Probe",
        rationale:
          "Figma-backed jobs should exercise state transitions and visible control combinations derived from the screen model.",
      },
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
    figma_jira_mixed: [
      {
        heuristicId: "stateful_visual_flow_probe",
        order: 20,
        title: "Stateful Visual Flow Probe",
        rationale:
          "Figma-backed jobs should exercise state transitions and visible control combinations derived from the screen model.",
      },
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
    jira_mixed: [
      {
        heuristicId: "jira_rule_matrix",
        order: 30,
        title: "Jira Rule Matrix",
        rationale:
          "Requirement-heavy Jira jobs should emphasize deterministic rule partitioning and decision coverage.",
      },
    ],
  } as const;

const HEURISTICS_BY_PROMPT_SECTION: Readonly<
  Record<SourceMixPlanPromptSection, readonly TestDesignHeuristic[]>
> = {
  figma_intent: [],
  jira_requirements: [],
  custom_context: [
    {
      heuristicId: "supporting_context_edge_probe",
      order: 40,
      title: "Supporting Context Edge Probe",
      rationale:
        "Supplementary context should bias coverage toward ambiguity, notes, and reviewer-oriented edge probes.",
    },
  ],
  custom_context_markdown: [
    {
      heuristicId: "supporting_context_edge_probe",
      order: 40,
      title: "Supporting Context Edge Probe",
      rationale:
        "Supplementary context should bias coverage toward ambiguity, notes, and reviewer-oriented edge probes.",
    },
  ],
  reconciliation_report: [
    {
      heuristicId: "cross_source_reconciliation",
      order: 50,
      title: "Cross-Source Reconciliation",
      rationale:
        "Mixed-source jobs should reserve deterministic probes for source disagreement and reviewer reconciliation paths.",
    },
  ],
} as const;

export const selectTestDesignHeuristics = (input: {
  sourceMixPlan?: SourceMixPlan;
} = {}): readonly TestDesignHeuristic[] => {
  const heuristics: TestDesignHeuristic[] = [...COMMON_HEURISTICS];

  if (input.sourceMixPlan !== undefined) {
    heuristics.push(...HEURISTICS_BY_KIND[input.sourceMixPlan.kind]);
    for (const promptSection of input.sourceMixPlan.promptSections) {
      heuristics.push(...HEURISTICS_BY_PROMPT_SECTION[promptSection]);
    }
  }

  return [...new Map(heuristics.map((heuristic) => [heuristic.heuristicId, heuristic])).values()].sort(
    (left, right) =>
      left.order - right.order ||
      left.heuristicId.localeCompare(right.heuristicId),
  );
};
