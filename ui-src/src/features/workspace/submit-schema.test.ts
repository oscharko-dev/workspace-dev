import { describe, expect, it } from "vitest";
import { workspaceSubmitSchema, toWorkspaceSubmitPayload } from "./submit-schema";

describe("workspaceSubmitSchema", () => {
  it("requires repo fields when Git/PR is enabled", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaFileKey: "file-key",
      figmaAccessToken: "figd_token",
      enableGitPr: true,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(false);
  });

  it("creates deterministic submit payload", () => {
    const parsed = workspaceSubmitSchema.parse({
      figmaFileKey: " file-key ",
      figmaAccessToken: " figd_token ",
      enableGitPr: false,
      repoUrl: "",
      repoToken: "",
      projectName: " demo ",
      targetPath: " apps/generated "
    });

    const payload = toWorkspaceSubmitPayload({ formData: parsed });

    expect(payload).toEqual({
      figmaFileKey: "file-key",
      figmaAccessToken: "figd_token",
      repoUrl: undefined,
      repoToken: undefined,
      enableGitPr: false,
      projectName: "demo",
      targetPath: "apps/generated",
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic"
    });
  });
});
