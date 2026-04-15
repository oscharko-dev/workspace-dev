import { describe, expect, it } from "vitest";
import { isSecuritySensitiveInspectorSelection } from "./import-governance-match";

describe("isSecuritySensitiveInspectorSelection", () => {
  it("matches security-sensitive patterns against design IR node names", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["password"],
        screens: [
          {
            name: "Login",
            generatedFile: "src/screens/Login.tsx",
            children: [{ name: "Password field" }],
          },
        ],
        manifest: null,
        generatedFiles: [],
      }),
    ).toBe(true);
  });

  it("matches security-sensitive patterns against manifest names and file paths", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["auth", "billing"],
        screens: [],
        manifest: {
          screens: [
            {
              screenName: "Settings",
              file: "src/screens/Settings.tsx",
              components: [
                {
                  irNodeName: "AuthTokenInput",
                  irNodeType: "input",
                  file: "src/components/AuthTokenInput.tsx",
                },
              ],
            },
          ],
        },
        generatedFiles: [],
      }),
    ).toBe(true);
  });

  it("matches security-sensitive patterns against generated file paths", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["admin"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/routes/admin/Users.tsx"],
      }),
    ).toBe(true);
  });

  it("ignores invalid regexes and returns false when nothing matches", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["[invalid", "secret"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/screens/Home.tsx"],
      }),
    ).toBe(false);
  });
});
