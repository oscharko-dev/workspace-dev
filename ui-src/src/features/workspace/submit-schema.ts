import { z } from "zod";

const optionalString = z.string().trim().optional().or(z.literal(""));

export const workspaceSubmitSchema = z
  .object({
    figmaFileKey: optionalString,
    figmaAccessToken: optionalString,
    figmaJsonPath: optionalString,
    storybookStaticDir: optionalString,
    customerProfilePath: optionalString,
    figmaSourceMode: z.enum(["rest", "hybrid", "local_json"]).default("rest"),
    enableGitPr: z.boolean(),
    repoUrl: optionalString,
    repoToken: optionalString,
    projectName: optionalString,
    targetPath: optionalString
  })
  .superRefine((value, context) => {
    if (value.figmaSourceMode === "local_json") {
      if (!value.figmaJsonPath || !value.figmaJsonPath.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaJsonPath"],
          message: "Figma JSON path is required for local_json mode."
        });
      }
    } else {
      if (!value.figmaFileKey || !value.figmaFileKey.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaFileKey"],
          message: "This field is required."
        });
      }

      if (!value.figmaAccessToken || !value.figmaAccessToken.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["figmaAccessToken"],
          message: "This field is required."
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
        message: "Repo URL is required when Git/PR is enabled."
      });
    }

    if (!value.repoToken || !value.repoToken.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoToken"],
        message: "Repo token is required when Git/PR is enabled."
      });
    }
  });

export type WorkspaceSubmitFormData = z.input<typeof workspaceSubmitSchema>;

export interface WorkspaceSubmitPayload {
  figmaFileKey?: string | undefined;
  figmaAccessToken?: string | undefined;
  figmaJsonPath?: string | undefined;
  storybookStaticDir?: string | undefined;
  customerProfilePath?: string | undefined;
  repoUrl?: string | undefined;
  repoToken?: string | undefined;
  enableGitPr: boolean;
  projectName?: string | undefined;
  targetPath?: string | undefined;
  figmaSourceMode: "rest" | "hybrid" | "local_json";
  llmCodegenMode: "deterministic";
}

function toOptionalString({ value }: { value: string | undefined }): string | undefined {
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
  formData
}: {
  formData: WorkspaceSubmitFormData;
}): WorkspaceSubmitPayload {
  const mode = formData.figmaSourceMode ?? "rest";

  if (mode === "local_json") {
    return {
      figmaSourceMode: "local_json",
      figmaJsonPath: toOptionalString({ value: formData.figmaJsonPath }),
      storybookStaticDir: toOptionalString({ value: formData.storybookStaticDir }),
      customerProfilePath: toOptionalString({ value: formData.customerProfilePath }),
      enableGitPr: formData.enableGitPr,
      repoUrl: toOptionalString({ value: formData.repoUrl }),
      repoToken: toOptionalString({ value: formData.repoToken }),
      projectName: toOptionalString({ value: formData.projectName }),
      targetPath: toOptionalString({ value: formData.targetPath }),
      llmCodegenMode: "deterministic"
    };
  }

  return {
    figmaFileKey: toOptionalString({ value: formData.figmaFileKey }),
    figmaAccessToken: toOptionalString({ value: formData.figmaAccessToken }),
    figmaSourceMode: mode,
    storybookStaticDir: toOptionalString({ value: formData.storybookStaticDir }),
    customerProfilePath: toOptionalString({ value: formData.customerProfilePath }),
    repoUrl: toOptionalString({ value: formData.repoUrl }),
    repoToken: toOptionalString({ value: formData.repoToken }),
    enableGitPr: formData.enableGitPr,
    projectName: toOptionalString({ value: formData.projectName }),
    targetPath: toOptionalString({ value: formData.targetPath }),
    llmCodegenMode: "deterministic"
  };
}
