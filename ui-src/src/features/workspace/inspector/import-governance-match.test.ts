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

  it("matches plain tokens case-insensitively", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["secret"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/screens/SECRET/Reset.tsx"],
      }),
    ).toBe(true);
  });

  it("matches literal metacharacter tokens as plain text", () => {
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["(auth)"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/screens/auth/Home.tsx"],
      }),
    ).toBe(false);
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["C++"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/lib/C++/Home.tsx"],
      }),
    ).toBe(true);
    expect(
      isSecuritySensitiveInspectorSelection({
        patterns: ["(auth)"],
        screens: [],
        manifest: null,
        generatedFiles: ["src/screens/(AUTH)/Home.tsx"],
      }),
    ).toBe(true);
  });
});
