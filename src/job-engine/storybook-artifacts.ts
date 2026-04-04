import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobStageName } from "../contracts/index.js";
import { createPipelineError, getErrorMessage, type PipelineDiagnosticLimits } from "./errors.js";
import type { StageArtifactStore } from "./pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./pipeline/artifact-keys.js";
import { isWithinRoot } from "./preview.js";
import { buildStorybookCatalogArtifact, getStorybookCatalogOutputFileName, writeStorybookCatalogArtifact } from "../storybook/catalog.js";
import {
  buildStorybookEvidenceArtifact,
  getStorybookEvidenceOutputFileName,
  loadStorybookBuildContext,
  writeStorybookEvidenceArtifact
} from "../storybook/evidence.js";
import {
  buildStorybookPublicArtifacts,
  getStorybookPublicArtifactFileNames,
  writeStorybookPublicArtifacts
} from "../storybook/public-extracts.js";
import { getComponentMatchReportOutputFileName } from "../storybook/component-match-report.js";
import {
  getFatalStorybookExtractionDiagnostics,
  parseStorybookCatalogArtifact,
  parseStorybookComponentsArtifact,
  parseStorybookEvidenceArtifact,
  parseStorybookThemesArtifact,
  parseStorybookTokensArtifact
} from "../storybook/artifact-validation.js";
import type { StorybookCatalogArtifact, StorybookEvidenceArtifact, StorybookPublicArtifacts } from "../storybook/types.js";

export interface JobStorybookArtifactPaths {
  rootDir: string;
  internalDir: string;
  publicDir: string;
  catalogFile: string;
  evidenceFile: string;
  tokensFile: string;
  themesFile: string;
  componentsFile: string;
  figmaLibraryResolutionFile: string;
  componentMatchReportFile: string;
}

export interface GeneratedJobStorybookArtifacts {
  paths: JobStorybookArtifactPaths;
  catalogArtifact: StorybookCatalogArtifact;
  evidenceArtifact: StorybookEvidenceArtifact;
  publicArtifacts: StorybookPublicArtifacts;
}

interface StorybookArtifactCopyPathEntry {
  key: string;
  sourcePath: string;
  targetPath: string;
}

interface PrecomputedStorybookArtifacts {
  sourcePaths: {
    catalogFile: string;
    evidenceFile: string;
    tokensFile: string;
    themesFile: string;
    componentsFile: string;
  };
  catalogArtifact: StorybookCatalogArtifact;
  evidenceArtifact: StorybookEvidenceArtifact;
  publicArtifacts: StorybookPublicArtifacts;
}

const STORYBOOK_LIBRARY_RESOLUTION_FILE_NAME = "figma-library-resolution.json";

const hasFile = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const loadPrecomputedStorybookArtifacts = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<PrecomputedStorybookArtifacts | undefined> => {
  const publicFileNames = getStorybookPublicArtifactFileNames();
  const sourcePaths = {
    catalogFile: path.join(buildDir, getStorybookCatalogOutputFileName()),
    evidenceFile: path.join(buildDir, getStorybookEvidenceOutputFileName()),
    tokensFile: path.join(buildDir, publicFileNames.tokens),
    themesFile: path.join(buildDir, publicFileNames.themes),
    componentsFile: path.join(buildDir, publicFileNames.components)
  };
  const available = await Promise.all(Object.values(sourcePaths).map((filePath) => hasFile(filePath)));
  if (!available.every(Boolean)) {
    return undefined;
  }

  try {
    const [catalogArtifact, evidenceArtifact, tokensArtifact, themesArtifact, componentsArtifact] = await Promise.all([
      readFile(sourcePaths.catalogFile, "utf8"),
      readFile(sourcePaths.evidenceFile, "utf8"),
      readFile(sourcePaths.tokensFile, "utf8"),
      readFile(sourcePaths.themesFile, "utf8"),
      readFile(sourcePaths.componentsFile, "utf8")
    ]);

    return {
      sourcePaths,
      catalogArtifact: parseStorybookCatalogArtifact({
        input: catalogArtifact
      }),
      evidenceArtifact: parseStorybookEvidenceArtifact({
        input: evidenceArtifact
      }),
      publicArtifacts: {
        tokensArtifact: parseStorybookTokensArtifact({
          input: tokensArtifact
        }),
        themesArtifact: parseStorybookThemesArtifact({
          input: themesArtifact
        }),
        componentsArtifact: parseStorybookComponentsArtifact({
          input: componentsArtifact
        })
      }
    };
  } catch {
    return undefined;
  }
};
const toMissingReusableArtifactError = ({
  artifactKey,
  sourceJobId,
  sourceRequestedStorybookStaticDir,
  reason
}: {
  artifactKey: string;
  sourceJobId: string;
  sourceRequestedStorybookStaticDir: string;
  reason: string;
}): Error => {
  return new Error(
    `Source job '${sourceJobId}' declared storybookStaticDir '${sourceRequestedStorybookStaticDir}' ` +
      `but reusable artifact '${artifactKey}' ${reason}.`
  );
};

const copyReusableArtifact = async ({
  sourcePath,
  targetPath,
  artifactKey,
  sourceJobId,
  sourceRequestedStorybookStaticDir
}: {
  sourcePath: string;
  targetPath: string;
  artifactKey: string;
  sourceJobId: string;
  sourceRequestedStorybookStaticDir: string;
}): Promise<void> => {
  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  } catch (error) {
    throw toMissingReusableArtifactError({
      artifactKey,
      sourceJobId,
      sourceRequestedStorybookStaticDir,
      reason: `is unreadable at '${sourcePath}': ${getErrorMessage(error)}`
    });
  }
};

export const resolveStorybookStaticDir = ({
  storybookStaticDir,
  resolvedWorkspaceRoot,
  limits
}: {
  storybookStaticDir: string;
  resolvedWorkspaceRoot: string;
  limits: PipelineDiagnosticLimits;
}): string => {
  const resolvedPath = path.resolve(resolvedWorkspaceRoot, storybookStaticDir);
  if (!isWithinRoot({ candidatePath: resolvedPath, rootPath: resolvedWorkspaceRoot })) {
    throw createPipelineError({
      code: "E_STORYBOOK_STATIC_DIR_INVALID",
      stage: "figma.source",
      message:
        `Storybook static dir '${storybookStaticDir}' resolves outside the workspace root ` +
        `('${resolvedWorkspaceRoot}').`,
      limits
    });
  }
  return resolvedPath;
};

export const createJobStorybookArtifactPaths = ({ jobDir }: { jobDir: string }): JobStorybookArtifactPaths => {
  const rootDir = path.join(jobDir, "storybook");
  const internalDir = path.join(rootDir, "internal");
  const publicDir = path.join(rootDir, "public");
  const publicFileNames = getStorybookPublicArtifactFileNames();
  return {
    rootDir,
    internalDir,
    publicDir,
    catalogFile: path.join(internalDir, getStorybookCatalogOutputFileName()),
    evidenceFile: path.join(internalDir, getStorybookEvidenceOutputFileName()),
    tokensFile: path.join(publicDir, publicFileNames.tokens),
    themesFile: path.join(publicDir, publicFileNames.themes),
    componentsFile: path.join(publicDir, publicFileNames.components),
    figmaLibraryResolutionFile: path.join(publicDir, STORYBOOK_LIBRARY_RESOLUTION_FILE_NAME),
    componentMatchReportFile: path.join(publicDir, getComponentMatchReportOutputFileName())
  };
};

export const generateStorybookArtifactsForJob = async ({
  storybookStaticDir,
  jobDir,
  artifactStore,
  stage,
  limits
}: {
  storybookStaticDir: string;
  jobDir: string;
  artifactStore: StageArtifactStore;
  stage: WorkspaceJobStageName;
  limits: PipelineDiagnosticLimits;
}): Promise<GeneratedJobStorybookArtifacts> => {
  const artifactPaths = createJobStorybookArtifactPaths({ jobDir });
  const precomputedArtifacts = await loadPrecomputedStorybookArtifacts({
    buildDir: storybookStaticDir
  });
  if (precomputedArtifacts) {
    const fatalDiagnostics = getFatalStorybookExtractionDiagnostics({
      tokensArtifact: precomputedArtifacts.publicArtifacts.tokensArtifact,
      themesArtifact: precomputedArtifacts.publicArtifacts.themesArtifact
    });
    if (fatalDiagnostics.length === 0) {
      await Promise.all([
        copyReusableArtifact({
          sourcePath: precomputedArtifacts.sourcePaths.evidenceFile,
          targetPath: artifactPaths.evidenceFile,
          artifactKey: STAGE_ARTIFACT_KEYS.storybookEvidence,
          sourceJobId: "storybook-build",
          sourceRequestedStorybookStaticDir: storybookStaticDir
        }),
        copyReusableArtifact({
          sourcePath: precomputedArtifacts.sourcePaths.catalogFile,
          targetPath: artifactPaths.catalogFile,
          artifactKey: STAGE_ARTIFACT_KEYS.storybookCatalog,
          sourceJobId: "storybook-build",
          sourceRequestedStorybookStaticDir: storybookStaticDir
        }),
        copyReusableArtifact({
          sourcePath: precomputedArtifacts.sourcePaths.tokensFile,
          targetPath: artifactPaths.tokensFile,
          artifactKey: STAGE_ARTIFACT_KEYS.storybookTokens,
          sourceJobId: "storybook-build",
          sourceRequestedStorybookStaticDir: storybookStaticDir
        }),
        copyReusableArtifact({
          sourcePath: precomputedArtifacts.sourcePaths.themesFile,
          targetPath: artifactPaths.themesFile,
          artifactKey: STAGE_ARTIFACT_KEYS.storybookThemes,
          sourceJobId: "storybook-build",
          sourceRequestedStorybookStaticDir: storybookStaticDir
        }),
        copyReusableArtifact({
          sourcePath: precomputedArtifacts.sourcePaths.componentsFile,
          targetPath: artifactPaths.componentsFile,
          artifactKey: STAGE_ARTIFACT_KEYS.storybookComponents,
          sourceJobId: "storybook-build",
          sourceRequestedStorybookStaticDir: storybookStaticDir
        })
      ]);
      await artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.storybookEvidence,
        stage,
        absolutePath: artifactPaths.evidenceFile
      });
      await artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.storybookCatalog,
        stage,
        absolutePath: artifactPaths.catalogFile
      });
      await artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.storybookTokens,
        stage,
        absolutePath: artifactPaths.tokensFile
      });
      await artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.storybookThemes,
        stage,
        absolutePath: artifactPaths.themesFile
      });
      await artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.storybookComponents,
        stage,
        absolutePath: artifactPaths.componentsFile
      });

      return {
        paths: artifactPaths,
        catalogArtifact: precomputedArtifacts.catalogArtifact,
        evidenceArtifact: precomputedArtifacts.evidenceArtifact,
        publicArtifacts: precomputedArtifacts.publicArtifacts
      };
    }
  }
  const buildContext = await loadStorybookBuildContext({
    buildDir: storybookStaticDir
  });
  const evidenceArtifact = await buildStorybookEvidenceArtifact({
    buildDir: storybookStaticDir,
    buildContext
  });
  const catalogArtifact = await buildStorybookCatalogArtifact({
    buildDir: storybookStaticDir,
    buildContext,
    evidenceArtifact
  });
  const publicArtifacts = await buildStorybookPublicArtifacts({
    buildDir: storybookStaticDir,
    buildContext,
    evidenceArtifact,
    catalogArtifact
  });
  const fatalDiagnostics = getFatalStorybookExtractionDiagnostics({
    tokensArtifact: publicArtifacts.tokensArtifact,
    themesArtifact: publicArtifacts.themesArtifact
  });
  if (fatalDiagnostics.length > 0) {
    throw createPipelineError({
      code: "E_STORYBOOK_TOKEN_EXTRACTION_INVALID",
      stage,
      message: `Storybook token extraction failed with ${fatalDiagnostics.length} fatal diagnostic(s).`,
      diagnostics: fatalDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        suggestion:
          "Fix the authoritative Storybook theme, CSS, or story token surfaces so all required classes resolve to static tokens.",
        stage,
        severity: "error",
        ...(diagnostic.themeId ? { details: { themeId: diagnostic.themeId, tokenPath: diagnostic.tokenPath ?? [] } } : {})
      })),
      limits
    });
  }

  const evidenceFile = await writeStorybookEvidenceArtifact({
    buildDir: storybookStaticDir,
    artifact: evidenceArtifact,
    outputFilePath: artifactPaths.evidenceFile
  });
  const catalogFile = await writeStorybookCatalogArtifact({
    buildDir: storybookStaticDir,
    artifact: catalogArtifact,
    outputFilePath: artifactPaths.catalogFile
  });
  const { writtenFiles } = await writeStorybookPublicArtifacts({
    artifacts: publicArtifacts,
    outputDirPath: artifactPaths.publicDir
  });

  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage,
    absolutePath: evidenceFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookCatalog,
    stage,
    absolutePath: catalogFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage,
    absolutePath: writtenFiles.tokens
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage,
    absolutePath: writtenFiles.themes
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    stage,
    absolutePath: writtenFiles.components
  });

  return {
    paths: artifactPaths,
    catalogArtifact,
    evidenceArtifact,
    publicArtifacts
  };
};

export const reuseStorybookArtifactsFromSourceJob = async ({
  sourceArtifactStore,
  targetArtifactStore,
  sourceJobId,
  sourceRequestedStorybookStaticDir,
  targetJobDir,
  stage
}: {
  sourceArtifactStore: StageArtifactStore;
  targetArtifactStore: StageArtifactStore;
  sourceJobId: string;
  sourceRequestedStorybookStaticDir: string;
  targetJobDir: string;
  stage: WorkspaceJobStageName;
}): Promise<JobStorybookArtifactPaths> => {
  const targetPaths = createJobStorybookArtifactPaths({ jobDir: targetJobDir });

  const requiredEntries: StorybookArtifactCopyPathEntry[] = [];
  const optionalEntries: StorybookArtifactCopyPathEntry[] = [];
  const requiredArtifactMappings = [
    { key: STAGE_ARTIFACT_KEYS.storybookCatalog, targetPath: targetPaths.catalogFile },
    { key: STAGE_ARTIFACT_KEYS.storybookEvidence, targetPath: targetPaths.evidenceFile },
    { key: STAGE_ARTIFACT_KEYS.storybookTokens, targetPath: targetPaths.tokensFile },
    { key: STAGE_ARTIFACT_KEYS.storybookThemes, targetPath: targetPaths.themesFile },
    { key: STAGE_ARTIFACT_KEYS.storybookComponents, targetPath: targetPaths.componentsFile }
  ] as const;
  const optionalArtifactMappings = [
    { key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution, targetPath: targetPaths.figmaLibraryResolutionFile },
    { key: STAGE_ARTIFACT_KEYS.componentMatchReport, targetPath: targetPaths.componentMatchReportFile }
  ] as const;

  for (const mapping of requiredArtifactMappings) {
    const sourcePath = await sourceArtifactStore.getPath(mapping.key);
    if (!sourcePath) {
      throw toMissingReusableArtifactError({
        artifactKey: mapping.key,
        sourceJobId,
        sourceRequestedStorybookStaticDir,
        reason: "is missing"
      });
    }
    requiredEntries.push({
      key: mapping.key,
      sourcePath,
      targetPath: mapping.targetPath
    });
  }

  for (const mapping of optionalArtifactMappings) {
    const sourcePath = await sourceArtifactStore.getPath(mapping.key);
    if (!sourcePath) {
      continue;
    }
    optionalEntries.push({
      key: mapping.key,
      sourcePath,
      targetPath: mapping.targetPath
    });
  }

  for (const entry of [...requiredEntries, ...optionalEntries]) {
    await copyReusableArtifact({
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      artifactKey: entry.key,
      sourceJobId,
      sourceRequestedStorybookStaticDir
    });
    await targetArtifactStore.setPath({
      key: entry.key,
      stage,
      absolutePath: entry.targetPath
    });
  }

  return targetPaths;
};
