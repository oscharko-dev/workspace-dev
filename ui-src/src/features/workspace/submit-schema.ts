import { z } from "zod";
import type { ImportIntent } from "./inspector/paste-input-classifier";

const optionalString = z.string().trim().optional().or(z.literal(""));

export const FIGMA_PASTE_MAX_BYTES = 6 * 1024 * 1024;
export const FIGMA_PASTE_MAX_LABEL = `${
  FIGMA_PASTE_MAX_BYTES / (1024 * 1024)
} MiB`;

export const WORKSPACE_FIGMA_SOURCE_MODES = [
  "rest",
  "hybrid",
  "local_json",
  "figma_paste",
  "figma_plugin",
] as const;

export type WorkspaceFigmaSourceMode =
  (typeof WORKSPACE_FIGMA_SOURCE_MODES)[number];

const INLINE_FIGMA_SOURCE_MODES = new Set<WorkspaceFigmaSourceMode>([
  "figma_paste",
  "figma_plugin",
]);

export const workspaceSubmitSchema = z
  .object({
    figmaFileKey: optionalString,
    figmaAccessToken: optionalString,
    figmaJsonPath: optionalString,
    figmaJsonPayload: optionalString,
    storybookStaticDir: optionalString,
    customerProfilePath: optionalString,
    figmaSourceMode: z.enum(WORKSPACE_FIGMA_SOURCE_MODES).default("rest"),
    enableGitPr: z.boolean(),
    repoUrl: optionalString,
    repoToken: optionalString,
    projectName: optionalString,
    targetPath: optionalString,
  })
  .superRefine((value, context) => {
    const isInlineFigmaSourceMode = INLINE_FIGMA_SOURCE_MODES.has(
      value.figmaSourceMode,
    );

    if (isInlineFigmaSourceMode) {
      if (!value.figmaJsonPayload || !value.figmaJsonPayload.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPayload"],
          message: `Figma JSON payload is required for ${value.figmaSourceMode} mode.`,
        });
      } else if (
        new TextEncoder().encode(value.figmaJsonPayload).length >
        FIGMA_PASTE_MAX_BYTES
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPayload"],
          message: `Figma JSON payload must be ${FIGMA_PASTE_MAX_LABEL} or less.`,
        });
      }
    } else if (value.figmaSourceMode === "local_json") {
      if (!value.figmaJsonPath || !value.figmaJsonPath.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPath"],
          message: "Figma JSON path is required for local_json mode.",
        });
      }
    } else {
      if (!value.figmaFileKey || !value.figmaFileKey.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaFileKey"],
          message: "This field is required.",
        });
      }

      if (!value.figmaAccessToken || !value.figmaAccessToken.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaAccessToken"],
          message: "This field is required.",
        });
      }
    }

    if (!value.enableGitPr) {
      return;
    }

    if (!value.repoUrl || !value.repoUrl.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoUrl"],
        message: "Repo URL is required when Git/PR is enabled.",
      });
    }

    if (!value.repoToken || !value.repoToken.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoToken"],
        message: "Repo token is required when Git/PR is enabled.",
      });
    }
  });

export type WorkspaceSubmitFormData = z.input<typeof workspaceSubmitSchema>;

export interface WorkspaceSubmitPayload {
  figmaFileKey?: string | undefined;
  figmaAccessToken?: string | undefined;
  figmaJsonPath?: string | undefined;
  figmaJsonPayload?: string | undefined;
  storybookStaticDir?: string | undefined;
  customerProfilePath?: string | undefined;
  repoUrl?: string | undefined;
  repoToken?: string | undefined;
  enableGitPr: boolean;
  projectName?: string | undefined;
  targetPath?: string | undefined;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: "deterministic";
}

export interface InspectorBootstrapPayload {
  figmaSourceMode: "figma_paste" | "figma_plugin";
  figmaJsonPayload: string;
  llmCodegenMode: "deterministic";
  enableGitPr: false;
  importIntent?: ImportIntent;
  originalIntent?: ImportIntent;
  intentCorrected?: boolean;
}

function toOptionalString({
  value,
}: {
  value: string | undefined;
}): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

export function toWorkspaceSubmitPayload({
  formData,
}: {
  formData: WorkspaceSubmitFormData;
}): WorkspaceSubmitPayload {
  const mode = formData.figmaSourceMode ?? "rest";

  if (INLINE_FIGMA_SOURCE_MODES.has(mode)) {
    return {
      figmaSourceMode: mode,
      figmaJsonPayload: formData.figmaJsonPayload?.trim(),
      enableGitPr: false,
      projectName: toOptionalString({ value: formData.projectName }),
      targetPath: toOptionalString({ value: formData.targetPath }),
      storybookStaticDir: toOptionalString({
        value: formData.storybookStaticDir,
      }),
      customerProfilePath: toOptionalString({
        value: formData.customerProfilePath,
      }),
      llmCodegenMode: "deterministic",
    };
  }

  if (mode === "local_json") {
    return {
      figmaSourceMode: "local_json",
      figmaJsonPath: toOptionalString({ value: formData.figmaJsonPath }),
      storybookStaticDir: toOptionalString({
        value: formData.storybookStaticDir,
      }),
      customerProfilePath: toOptionalString({
        value: formData.customerProfilePath,
      }),
      enableGitPr: formData.enableGitPr,
      repoUrl: toOptionalString({ value: formData.repoUrl }),
      repoToken: toOptionalString({ value: formData.repoToken }),
      projectName: toOptionalString({ value: formData.projectName }),
      targetPath: toOptionalString({ value: formData.targetPath }),
      llmCodegenMode: "deterministic",
    };
  }

  return {
    figmaFileKey: toOptionalString({ value: formData.figmaFileKey }),
    figmaAccessToken: toOptionalString({ value: formData.figmaAccessToken }),
    figmaSourceMode: mode,
    storybookStaticDir: toOptionalString({
      value: formData.storybookStaticDir,
    }),
    customerProfilePath: toOptionalString({
      value: formData.customerProfilePath,
    }),
    repoUrl: toOptionalString({ value: formData.repoUrl }),
    repoToken: toOptionalString({ value: formData.repoToken }),
    enableGitPr: formData.enableGitPr,
    projectName: toOptionalString({ value: formData.projectName }),
    targetPath: toOptionalString({ value: formData.targetPath }),
    llmCodegenMode: "deterministic",
  };
}

export function toInspectorBootstrapPayload({
  figmaJsonPayload,
  importIntent,
  originalIntent,
  intentCorrected,
}: {
  figmaJsonPayload: string;
  importIntent?: ImportIntent;
  originalIntent?: ImportIntent;
  intentCorrected?: boolean;
}): InspectorBootstrapPayload {
  const figmaSourceMode =
    importIntent === "FIGMA_PLUGIN_ENVELOPE" ? "figma_plugin" : "figma_paste";
  return {
    figmaSourceMode,
    figmaJsonPayload,
    llmCodegenMode: "deterministic",
    enableGitPr: false,
    ...(importIntent !== undefined ? { importIntent } : {}),
    ...(originalIntent !== undefined ? { originalIntent } : {}),
    ...(intentCorrected !== undefined ? { intentCorrected } : {}),
  };
}
