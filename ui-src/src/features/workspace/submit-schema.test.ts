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
      storybookStaticDir: " storybook-static/customer ",
      customerProfilePath: " profiles/customer-profile.json ",
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
      storybookStaticDir: "storybook-static/customer",
      customerProfilePath: "profiles/customer-profile.json",
      repoUrl: undefined,
      repoToken: undefined,
      enableGitPr: false,
      projectName: "demo",
      targetPath: "apps/generated",
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic"
    });
  });

  it("supports hybrid submit payloads", () => {
    const parsed = workspaceSubmitSchema.parse({
      figmaFileKey: "file-key",
      figmaAccessToken: "figd_token",
      figmaSourceMode: "hybrid",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    const payload = toWorkspaceSubmitPayload({ formData: parsed });

    expect(payload.figmaSourceMode).toBe("hybrid");
    expect(payload.llmCodegenMode).toBe("deterministic");
  });

  it("accepts local_json mode with figmaJsonPath", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/path/to/figma-export.json",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(true);
  });

  it("requires figmaJsonPath when local_json is selected", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaSourceMode: "local_json",
      figmaJsonPath: "",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("figmaJsonPath");
    }
  });

  it("does not require figmaFileKey or figmaAccessToken for local_json", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/data/export.json",
      figmaFileKey: "",
      figmaAccessToken: "",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(true);
  });

  it("requires figmaFileKey and figmaAccessToken for rest mode", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaSourceMode: "rest",
      figmaFileKey: "",
      figmaAccessToken: "",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("figmaFileKey");
      expect(paths).toContain("figmaAccessToken");
    }
  });

  it("creates local_json payload with figmaJsonPath and omits REST-only fields", () => {
    const parsed = workspaceSubmitSchema.parse({
      figmaSourceMode: "local_json",
      figmaJsonPath: " /data/export.json ",
      storybookStaticDir: " storybook-static/customer ",
      customerProfilePath: " profiles/customer-profile.json ",
      enableGitPr: false,
      repoUrl: "",
      repoToken: ""
    });

    const payload = toWorkspaceSubmitPayload({ formData: parsed });

    expect(payload).toEqual({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/data/export.json",
      storybookStaticDir: "storybook-static/customer",
      customerProfilePath: "profiles/customer-profile.json",
      enableGitPr: false,
      repoUrl: undefined,
      repoToken: undefined,
      projectName: undefined,
      targetPath: undefined,
      llmCodegenMode: "deterministic"
    });

    expect(payload.figmaFileKey).toBeUndefined();
    expect(payload.figmaAccessToken).toBeUndefined();
  });

  it("requires repo fields for local_json when Git/PR is enabled", () => {
    const parsed = workspaceSubmitSchema.safeParse({
      figmaSourceMode: "local_json",
      figmaJsonPath: "/data/export.json",
      enableGitPr: true,
      repoUrl: "",
      repoToken: ""
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("repoUrl");
      expect(paths).toContain("repoToken");
    }
  });
});
