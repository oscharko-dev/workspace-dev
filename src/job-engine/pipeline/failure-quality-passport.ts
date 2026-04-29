import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspacePipelineQualityWarning,
  WorkspacePipelineScope,
} from "../../contracts/index.js";
import type { PipelineExecutionContext } from "./context.js";
import type { PipelineQualityGeneratedFileInput } from "./quality-passport.js";
import {
  buildPipelineQualityPassport,
  writePipelineQualityPassport,
} from "./quality-passport.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import type { WorkspacePipelineError } from "../types.js";

interface CodegenSummaryLike {
  generatedPaths?: readonly string[];
  mappingCoverage?: {
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  llmWarnings?: readonly { code: string; message: string }[];
  mappingWarnings?: readonly { code: string; message: string }[];
  iconWarnings?: readonly { code?: string; message: string }[];
}

const toPipelineScope = (
  request: PipelineExecutionContext["job"]["request"],
): WorkspacePipelineScope => {
  if (request.selectedNodeIds && request.selectedNodeIds.length > 0) {
    return "selection";
  }
  if (request.figmaNodeId && request.figmaNodeId.trim().length > 0) {
    return "node";
  }
  return "board";
};

const toSafeGeneratedProjectRelativePath = ({
  generatedProjectDir,
  relativePath,
}: {
  generatedProjectDir: string;
  relativePath: string;
}): string | undefined => {
  const root = path.resolve(generatedProjectDir);
  const candidate = path.resolve(generatedProjectDir, relativePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return path.relative(root, candidate).split(path.sep).join("/");
};

const collectGeneratedFiles = async ({
  generatedPaths,
  generatedProjectDir,
}: {
  generatedPaths: readonly string[];
  generatedProjectDir: string;
}): Promise<PipelineQualityGeneratedFileInput[]> => {
  const files: PipelineQualityGeneratedFileInput[] = [];
  const safeRelativePaths = new Set<string>();
  for (const generatedPath of generatedPaths) {
    const relativePath = toSafeGeneratedProjectRelativePath({
      generatedProjectDir,
      relativePath: generatedPath,
    });
    if (relativePath === undefined || relativePath === "quality-passport.json") {
      continue;
    }
    safeRelativePaths.add(relativePath);
  }
  for (const relativePath of [...safeRelativePaths].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const absolutePath = path.join(generatedProjectDir, relativePath);
    try {
      files.push({
        path: relativePath,
        content: await readFile(absolutePath),
      });
    } catch {
      files.push({ path: relativePath });
    }
  }
  return files;
};

const collectWarnings = ({
  codegenSummary,
  context,
  error,
}: {
  codegenSummary: CodegenSummaryLike | undefined;
  context: PipelineExecutionContext;
  error: WorkspacePipelineError;
}): WorkspacePipelineQualityWarning[] => {
  const warnings: WorkspacePipelineQualityWarning[] = [
    {
      code: error.code,
      severity: "error",
      message: error.message,
      source: error.stage,
    },
  ];

  for (const diagnostic of [
    ...(error.diagnostics ?? []),
    ...(context.getCollectedDiagnostics() ?? []),
  ]) {
    warnings.push({
      code: diagnostic.code,
      severity: diagnostic.severity === "error" ? "error" : diagnostic.severity,
      message: diagnostic.message,
      source: diagnostic.stage,
    });
  }
  for (const warning of codegenSummary?.llmWarnings ?? []) {
    warnings.push({
      code: warning.code,
      severity: "warning",
      message: warning.message,
      source: "codegen.generate",
    });
  }
  for (const warning of codegenSummary?.mappingWarnings ?? []) {
    warnings.push({
      code: warning.code,
      severity: "warning",
      message: warning.message,
      source: "component.mapping",
    });
  }
  for (const warning of codegenSummary?.iconWarnings ?? []) {
    warnings.push({
      code: warning.code ?? "ICON_FALLBACK",
      severity: "warning",
      message: warning.message,
      source: "icon.render",
    });
  }
  return warnings;
};

export const persistFailureQualityPassport = async ({
  context,
  error,
}: {
  context: PipelineExecutionContext;
  error: WorkspacePipelineError;
}): Promise<string | undefined> => {
  if (await context.artifactStore.getReference(STAGE_ARTIFACT_KEYS.qualityPassportFile)) {
    return context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.qualityPassportFile);
  }

  const codegenSummary = await context.artifactStore.getValue<CodegenSummaryLike>(
    STAGE_ARTIFACT_KEYS.codegenSummary,
  );
  const mappingCoverage = codegenSummary?.mappingCoverage;
  const semanticTotal =
    mappingCoverage === undefined
      ? 0
      : Math.max(0, Math.trunc(mappingCoverage.totalCandidateNodes));
  const semanticFallbacks =
    mappingCoverage === undefined
      ? 0
      : Math.max(0, Math.trunc(mappingCoverage.fallbackNodes));
  const passport = buildPipelineQualityPassport({
    pipelineMetadata: context.pipelineMetadata,
    sourceMode: context.resolvedFigmaSourceMode,
    scope: toPipelineScope(context.job.request),
    selectedNodeCount: context.job.request.selectedNodeIds?.length ?? 0,
    generatedFiles: await collectGeneratedFiles({
      generatedPaths: codegenSummary?.generatedPaths ?? [],
      generatedProjectDir: context.paths.generatedProjectDir,
    }),
    validationStages: context.job.stages.map((stage) => ({
      name: stage.name,
      status: stage.status,
    })),
    validationStatus: "failed",
    tokenCoverage: { covered: 0, total: 0, status: "not_run" },
    semanticCoverage:
      mappingCoverage === undefined
        ? { covered: 0, total: 0, status: "not_run" }
        : {
            covered: Math.max(0, semanticTotal - semanticFallbacks),
            total: semanticTotal,
            status: "failed",
          },
    warnings: collectWarnings({ codegenSummary, context, error }),
    metadata: {
      jobId: context.job.jobId,
      mode: context.mode,
      failureCode: error.code,
      failureStage: error.stage,
      pipelineDisplayName: context.pipelineMetadata.pipelineDisplayName,
    },
  });
  const passportPath = await writePipelineQualityPassport({
    passport,
    destinationDir: context.paths.generatedProjectDir,
  });
  await context.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.qualityPassport,
    stage: error.stage,
    value: passport,
  });
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.qualityPassportFile,
    stage: error.stage,
    absolutePath: passportPath,
  });
  context.job.artifacts.qualityPassportFile = passportPath;
  return passportPath;
};
