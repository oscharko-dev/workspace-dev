import type { WorkspaceComponentMappingRule, WorkspaceComponentMappingSource } from "../contracts/index.js";
import type { MappingGateMode } from "./types-core.js";

export type ComponentMappingSource = WorkspaceComponentMappingSource;

export type ComponentMappingRule = WorkspaceComponentMappingRule;

export type ComponentMappingWarningCode =
  | "W_COMPONENT_MAPPING_MISSING"
  | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH"
  | "W_COMPONENT_MAPPING_DISABLED"
  | "W_COMPONENT_MAPPING_BROAD_PATTERN";

export interface ComponentMappingWarning {
  code: ComponentMappingWarningCode;
  message: string;
}

export interface ComponentMappingCoverage {
  boardKey: string;
  totalMappings: number;
  enabledMappings: number;
  bySource: Record<ComponentMappingSource, number>;
}

export interface MappingPolicy {
  enabled: boolean;
  mode: MappingGateMode;
  minCoverageRatio?: number;
  minUsedMappings?: number;
  maxContractMismatchCount?: number;
  maxMissingMappingCount?: number;
}

export interface MappingCoverageMetrics {
  usedMappings: number;
  fallbackNodes: number;
  totalCandidateNodes: number;
  coverageRatio: number;
  contractMismatchCount: number;
  missingMappingCount: number;
  disabledMappingCount: number;
  broadPatternCount: number;
  status: "passed" | "warned" | "failed";
  policy?: MappingPolicy;
}
