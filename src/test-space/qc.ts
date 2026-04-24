import type {
  WorkspaceTestSpaceCase,
  WorkspaceTestSpaceQcMappingDraft,
  WorkspaceTestSpaceRunRequestSummary,
} from "../contracts/index.js";
import { DEFAULT_TEST_SPACE_QC_WRITE_ENABLED } from "./constants.js";

export interface WorkspaceTestSpaceQcConnector {
  readonly connector: "opentext-alm-qc";
  buildDraft({
    runId,
    request,
    figmaSummary,
    testCases,
  }: {
    runId: string;
    request: WorkspaceTestSpaceRunRequestSummary;
    figmaSummary: Record<string, unknown>;
    testCases: WorkspaceTestSpaceCase[];
  }): Promise<WorkspaceTestSpaceQcMappingDraft>;
  writeDraft?(
    draft: WorkspaceTestSpaceQcMappingDraft,
  ): Promise<{ written: true }>;
}

function normalizeLabel(value: string): string {
  const collapsed = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "");
  return collapsed.length > 0 ? collapsed : "Test Space";
}

function buildCaseMappings(
  testCases: WorkspaceTestSpaceCase[],
): WorkspaceTestSpaceQcMappingDraft["caseMappings"] {
  return testCases.map((testCase) => ({
    caseId: testCase.id,
    title: testCase.title,
    priority: testCase.priority,
    stepCount: testCase.steps.length,
    coverageTags: [...testCase.coverageTags],
  }));
}

export function createDisabledWorkspaceTestSpaceQcConnector(): WorkspaceTestSpaceQcConnector {
  return {
    connector: "opentext-alm-qc",
    async buildDraft({ runId, request, figmaSummary, testCases }) {
      const contextSummary = normalizeLabel(request.businessContext.summary);
      const productName = normalizeLabel(
        request.businessContext.productName ?? contextSummary,
      );
      const suiteName = normalizeLabel(
        request.testSuiteName ?? `${contextSummary} Business Coverage`,
      );
      const screenCount =
        typeof figmaSummary.screenCount === "number"
          ? figmaSummary.screenCount
          : 0;

      return {
        connector: "opentext-alm-qc",
        writeEnabled: DEFAULT_TEST_SPACE_QC_WRITE_ENABLED,
        projectName: productName,
        testPlanName: `${suiteName} Plan`,
        testSetName: `${suiteName} Run ${runId.slice(0, 8)}`,
        caseMappings: buildCaseMappings(testCases).map((mapping, index) => ({
          ...mapping,
          coverageTags: [
            ...mapping.coverageTags,
            ...(index === 0 && screenCount > 0 ? ["screen-coverage"] : []),
          ],
        })),
      };
    },
  };
}
