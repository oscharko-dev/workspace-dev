/**
 * Unit tests for the file-pairing utility.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/437
 */
import { describe, it, expect } from "vitest";
import { suggestPairedFile } from "./file-pairing";

describe("suggestPairedFile", () => {
  const allFiles = [
    "src/components/Button.tsx",
    "src/components/Button.styles.ts",
    "src/components/Card.tsx",
    "src/screens/HomeScreen.tsx",
    "src/screens/SettingsScreen.tsx"
  ];

  it("returns null when only one file exists", () => {
    const result = suggestPairedFile("only.tsx", null, ["only.tsx"]);
    expect(result).toBeNull();
  });

  it("suggests filename stem match when no manifest", () => {
    const result = suggestPairedFile("src/components/Button.tsx", null, allFiles);
    expect(result).toBe("src/components/Button.styles.ts");
  });

  it("excludes the primary file from results", () => {
    const result = suggestPairedFile("src/components/Button.styles.ts", null, allFiles);
    expect(result).toBe("src/components/Button.tsx");
    expect(result).not.toBe("src/components/Button.styles.ts");
  });

  it("falls back to first different file when no stem match", () => {
    const result = suggestPairedFile("src/screens/HomeScreen.tsx", null, allFiles);
    // No other file has stem "HomeScreen", so should pick first non-primary
    expect(result).toBe("src/components/Button.tsx");
  });

  it("uses manifest-based pairing when available", () => {
    const manifest = {
      screens: [
        {
          screenId: "screen-1",
          file: "src/screens/HomeScreen.tsx",
          components: [
            { irNodeId: "node-1", file: "src/screens/HomeScreen.tsx" },
            { irNodeId: "node-1", file: "src/components/Button.tsx" }
          ]
        }
      ]
    };
    const result = suggestPairedFile("src/screens/HomeScreen.tsx", manifest, allFiles);
    // Should find Button.tsx since it shares irNodeId "node-1"
    expect(result).toBe("src/components/Button.tsx");
  });

  it("prefers manifest match over stem match", () => {
    const manifest = {
      screens: [
        {
          screenId: "screen-1",
          file: "src/screens/HomeScreen.tsx",
          components: [
            { irNodeId: "node-A", file: "src/components/Button.tsx" },
            { irNodeId: "node-A", file: "src/components/Card.tsx" }
          ]
        }
      ]
    };
    // Button.tsx shares node-A with Card.tsx — manifest match
    // Button.styles.ts shares stem "Button" — stem match
    // Manifest should win
    const result = suggestPairedFile("src/components/Button.tsx", manifest, allFiles);
    expect(result).toBe("src/components/Card.tsx");
  });

  it("returns null for empty file list", () => {
    const result = suggestPairedFile("foo.tsx", null, []);
    expect(result).toBeNull();
  });

  it("handles manifest with no matching irNodeIds gracefully", () => {
    const manifest = {
      screens: [
        {
          screenId: "screen-1",
          file: "src/screens/HomeScreen.tsx",
          components: [
            { irNodeId: "unrelated", file: "src/screens/SettingsScreen.tsx" }
          ]
        }
      ]
    };
    // Button.tsx is not in the manifest at all — falls back to stem
    const result = suggestPairedFile("src/components/Button.tsx", manifest, allFiles);
    expect(result).toBe("src/components/Button.styles.ts");
  });
});
