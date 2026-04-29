import type { WorkspaceComponentMappingRule } from "../../contracts/index.js";
import type { ComponentMappingWarning } from "../../parity/types-mapping.js";

export interface CodegenGenerateStageInput {
  figmaFileKey?: string;
  figmaAccessToken?: string;
  boardKeySeed: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  customerProfileDesignSystemConfigSource?: "storybook_first";
  retryTargets?: string[];
}

export interface CodegenFailedTarget {
  kind: "generated_file";
  stage: "codegen.generate";
  targetId: string;
  displayName: string;
  filePath: string;
  emittedScreenId: string;
}

export interface CodegenGenerateSummary {
  generatedPaths: string[];
  failedTargets?: CodegenFailedTarget[];
  generationMetrics?: Record<string, unknown>;
  themeApplied?: boolean;
  screenApplied?: number;
  screenTotal?: number;
  screenRejected?: unknown[];
  llmWarnings?: Array<{ code: string; message: string }>;
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  mappingDiagnostics?: Record<string, unknown>;
  mappingWarnings?: ComponentMappingWarning[];
  iconWarnings?: Array<{ code?: string; message: string }>;
}
