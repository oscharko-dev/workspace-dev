import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "./types.js";
import type {
  StorybookCatalogArtifact,
  StorybookEvidenceArtifact,
  StorybookPublicComponentsArtifact,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact,
  StorybookThemeDiagnostic
} from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isNonNegativeNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
};

export const parseStorybookCatalogArtifact = ({
  input
}: {
  input: string;
}): StorybookCatalogArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    !isRecord(parsed) ||
    parsed.artifact !== "storybook.catalog" ||
    !Array.isArray(parsed.entries) ||
    !Array.isArray(parsed.families)
  ) {
    throw new Error("Expected a storybook.catalog artifact with entry and family arrays.");
  }
  return parsed as unknown as StorybookCatalogArtifact;
};

export const parseStorybookEvidenceArtifact = ({
  input
}: {
  input: string;
}): StorybookEvidenceArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || parsed.artifact !== "storybook.evidence" || !Array.isArray(parsed.evidence)) {
    throw new Error("Expected a storybook.evidence artifact with an evidence array.");
  }
  return parsed as unknown as StorybookEvidenceArtifact;
};

export const parseStorybookTokensArtifact = ({
  input
}: {
  input: string;
}): StorybookPublicTokensArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("Expected a storybook.tokens artifact object.");
  }
  const extensions = parsed.$extensions;
  if (
    !isRecord(extensions) ||
    !isRecord(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY]) ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].artifact !== "storybook.tokens" ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].version !== 3 ||
    !Array.isArray(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics)
  ) {
    throw new Error("Expected a storybook.tokens artifact extension payload.");
  }
  return parsed as unknown as StorybookPublicTokensArtifact;
};

export const parseStorybookThemesArtifact = ({
  input
}: {
  input: string;
}): StorybookPublicThemesArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || parsed.name !== "storybook.themes") {
    throw new Error("Expected a storybook.themes artifact object.");
  }
  const extensions = parsed.$extensions;
  if (
    !isRecord(extensions) ||
    !isRecord(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY]) ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].artifact !== "storybook.themes" ||
    extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].version !== 3 ||
    !Array.isArray(extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics)
  ) {
    throw new Error("Expected a storybook.themes artifact extension payload.");
  }
  return parsed as unknown as StorybookPublicThemesArtifact;
};

export const parseStorybookComponentsArtifact = ({
  input
}: {
  input: string;
}): StorybookPublicComponentsArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || parsed.artifact !== "storybook.components" || !Array.isArray(parsed.components)) {
    throw new Error("Expected a storybook.components artifact with a components array.");
  }
  if (parsed.version !== 1) {
    throw new Error("Expected a storybook.components artifact version of 1.");
  }
  if (
    !isRecord(parsed.stats) ||
    !isNonNegativeNumber(parsed.stats.entryCount) ||
    !isNonNegativeNumber(parsed.stats.componentCount) ||
    !isNonNegativeNumber(parsed.stats.componentWithDesignReferenceCount) ||
    !isNonNegativeNumber(parsed.stats.propKeyCount)
  ) {
    throw new Error("Expected a storybook.components stats payload.");
  }
  for (const component of parsed.components) {
    if (
      !isRecord(component) ||
      typeof component.id !== "string" ||
      component.id.trim().length === 0 ||
      typeof component.name !== "string" ||
      component.name.trim().length === 0 ||
      typeof component.title !== "string" ||
      component.title.trim().length === 0 ||
      !isStringArray(component.propKeys) ||
      !isNonNegativeNumber(component.storyCount) ||
      typeof component.hasDesignReference !== "boolean" ||
      ("componentPath" in component &&
        component.componentPath !== undefined &&
        typeof component.componentPath !== "string")
    ) {
      throw new Error("Expected storybook.components entries to contain valid component metadata.");
    }
  }
  return parsed as unknown as StorybookPublicComponentsArtifact;
};

const toDiagnosticKey = (
  diagnostic: Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">
): string => {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.message,
    diagnostic.severity,
    diagnostic.themeId ?? "",
    diagnostic.tokenPath ?? []
  ]);
};

export const getFatalStorybookExtractionDiagnostics = ({
  tokensArtifact,
  themesArtifact
}: {
  tokensArtifact: StorybookPublicTokensArtifact;
  themesArtifact?: StorybookPublicThemesArtifact;
}): Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">> => {
  const diagnostics = [
    ...tokensArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics,
    ...(themesArtifact ? themesArtifact.$extensions[STORYBOOK_PUBLIC_EXTENSION_KEY].diagnostics : [])
  ].filter((diagnostic) => diagnostic.severity === "error");
  const byKey = new Map<string, (typeof diagnostics)[number]>();
  for (const diagnostic of diagnostics) {
    byKey.set(toDiagnosticKey(diagnostic), diagnostic);
  }
  return [...byKey.values()];
};

export const collectFatalStorybookDiagnostics: typeof getFatalStorybookExtractionDiagnostics =
  getFatalStorybookExtractionDiagnostics;
