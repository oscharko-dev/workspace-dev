import type { MappingGateMode } from "./types-core.js";

export type ComponentMappingSource = "local_override" | "code_connect_import";

export interface ComponentMappingRule {
  id?: number;
  boardKey: string;
  nodeId: string;
  componentName: string;
  importPath: string;
  propContract?: Record<string, unknown>;
  priority: number;
  source: ComponentMappingSource;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  status: "passed" | "warned" | "failed";
  policy?: MappingPolicy;
}
