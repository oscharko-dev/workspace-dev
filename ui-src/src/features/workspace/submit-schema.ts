import { z } from "zod";

const requiredString = z.string().trim().min(1, "This field is required.");
const optionalString = z.string().trim().optional().or(z.literal(""));

export const workspaceSubmitSchema = z
  .object({
    figmaFileKey: requiredString,
    figmaAccessToken: requiredString,
    enableGitPr: z.boolean(),
    repoUrl: optionalString,
    repoToken: optionalString,
    projectName: optionalString,
    targetPath: optionalString
  })
  .superRefine((value, context) => {
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

export type WorkspaceSubmitFormData = z.infer<typeof workspaceSubmitSchema>;

export interface WorkspaceSubmitPayload {
  figmaFileKey: string;
  figmaAccessToken: string;
  repoUrl?: string;
  repoToken?: string;
  enableGitPr: boolean;
  projectName?: string;
  targetPath?: string;
  figmaSourceMode: "rest";
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
  return {
    figmaFileKey: formData.figmaFileKey.trim(),
    figmaAccessToken: formData.figmaAccessToken.trim(),
    repoUrl: toOptionalString({ value: formData.repoUrl }),
    repoToken: toOptionalString({ value: formData.repoToken }),
    enableGitPr: formData.enableGitPr,
    projectName: toOptionalString({ value: formData.projectName }),
    targetPath: toOptionalString({ value: formData.targetPath }),
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  };
}
