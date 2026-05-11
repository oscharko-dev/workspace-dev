/**
 * Unit tests for node-diff-resolution.
 *
 * Covers: same-file mapping, changed-file mapping, unmapped fallback scenarios,
 * and no-previous-manifest edge cases.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/448
 */
import { describe, expect, it } from "vitest";
import {
  resolveNodeDiffMapping,
  isNodeScopedDiffAvailable,
  nodeDiffUnavailableReason,
  type ManifestPayload
} from "./node-diff-resolution";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeManifest(overrides?: Partial<ManifestPayload>): ManifestPayload {
  return {
    jobId: "prev-job-001",
    screens: [
      {
        screenId: "screen-1",
        screenName: "LoginScreen",
        file: "src/screens/LoginScreen.tsx",
        components: [
          {
            irNodeId: "node-1",
            irNodeName: "EmailInput",
            irNodeType: "input",
            file: "src/screens/LoginScreen.tsx",
            startLine: 10,
            endLine: 25
          },
          {
            irNodeId: "node-2",
            irNodeName: "SubmitButton",
            irNodeType: "button",
            file: "src/screens/LoginScreen.tsx",
            startLine: 30,
            endLine: 45
          }
        ]
      },
      {
        screenId: "screen-2",
        screenName: "DashboardScreen",
        file: "src/screens/DashboardScreen.tsx",
        components: [
          {
            irNodeId: "node-3",
            irNodeName: "StatsCard",
            irNodeType: "container",
            file: "src/screens/DashboardScreen.tsx",
            startLine: 5,
            endLine: 20
          }
        ]
      }
    ],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveNodeDiffMapping", () => {
  it("returns no-previous-manifest when manifest is null", () => {
    const result = resolveNodeDiffMapping("node-1", "src/screens/LoginScreen.tsx", null);
    expect(result.status).toBe("no-previous-manifest");
    expect(result.previousMapping).toBeNull();
    expect(result.fileChanged).toBe(false);
  });

  it("returns unmapped-in-current when currentFile is null", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping("node-1", null, manifest);
    expect(result.status).toBe("unmapped-in-current");
    expect(result.previousMapping).toBeNull();
    expect(result.fileChanged).toBe(false);
  });

  it("resolves same-file component mapping", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping(
      "node-1",
      "src/screens/LoginScreen.tsx",
      manifest
    );
    expect(result.status).toBe("mapped");
    expect(result.previousMapping).toEqual({
      file: "src/screens/LoginScreen.tsx",
      startLine: 10,
      endLine: 25
    });
    expect(result.fileChanged).toBe(false);
  });

  it("detects file change when node moved to a different file", () => {
    const manifest = makeManifest();
    // node-1 is in LoginScreen.tsx in the previous job,
    // but now the current job has it in a different file
    const result = resolveNodeDiffMapping(
      "node-1",
      "src/components/EmailInput.tsx",
      manifest
    );
    expect(result.status).toBe("mapped");
    expect(result.previousMapping).toEqual({
      file: "src/screens/LoginScreen.tsx",
      startLine: 10,
      endLine: 25
    });
    expect(result.fileChanged).toBe(true);
  });

  it("resolves screen-level mapping", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping(
      "screen-1",
      "src/screens/LoginScreen.tsx",
      manifest
    );
    expect(result.status).toBe("mapped");
    expect(result.previousMapping).toEqual({
      file: "src/screens/LoginScreen.tsx",
      startLine: 1,
      endLine: 1
    });
    expect(result.fileChanged).toBe(false);
  });

  it("resolves screen-level mapping with file change", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping(
      "screen-2",
      "src/screens/NewDashboard.tsx",
      manifest
    );
    expect(result.status).toBe("mapped");
    expect(result.previousMapping).toEqual({
      file: "src/screens/DashboardScreen.tsx",
      startLine: 1,
      endLine: 1
    });
    expect(result.fileChanged).toBe(true);
  });

  it("returns unmapped-in-previous when node does not exist in previous manifest", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping(
      "node-new-999",
      "src/screens/LoginScreen.tsx",
      manifest
    );
    expect(result.status).toBe("unmapped-in-previous");
    expect(result.previousMapping).toBeNull();
    expect(result.fileChanged).toBe(false);
  });

  it("resolves component from second screen", () => {
    const manifest = makeManifest();
    const result = resolveNodeDiffMapping(
      "node-3",
      "src/screens/DashboardScreen.tsx",
      manifest
    );
    expect(result.status).toBe("mapped");
    expect(result.previousMapping).toEqual({
      file: "src/screens/DashboardScreen.tsx",
      startLine: 5,
      endLine: 20
    });
    expect(result.fileChanged).toBe(false);
  });
});

describe("isNodeScopedDiffAvailable", () => {
  it("returns true when status is mapped", () => {
    expect(
      isNodeScopedDiffAvailable({
        status: "mapped",
        previousMapping: { file: "a.tsx", startLine: 1, endLine: 10 },
        fileChanged: false
      })
    ).toBe(true);
  });

  it("returns false when status is unmapped-in-previous", () => {
    expect(
      isNodeScopedDiffAvailable({
        status: "unmapped-in-previous",
        previousMapping: null,
        fileChanged: false
      })
    ).toBe(false);
  });

  it("returns false when status is unmapped-in-current", () => {
    expect(
      isNodeScopedDiffAvailable({
        status: "unmapped-in-current",
        previousMapping: null,
        fileChanged: false
      })
    ).toBe(false);
  });

  it("returns false when status is no-previous-manifest", () => {
    expect(
      isNodeScopedDiffAvailable({
        status: "no-previous-manifest",
        previousMapping: null,
        fileChanged: false
      })
    ).toBe(false);
  });
});

describe("nodeDiffUnavailableReason", () => {
  it("returns null for mapped status", () => {
    expect(nodeDiffUnavailableReason("mapped")).toBeNull();
  });

  it("returns a reason for unmapped-in-previous", () => {
    const reason = nodeDiffUnavailableReason("unmapped-in-previous");
    expect(reason).toContain("not present in the previous generation");
  });

  it("returns a reason for unmapped-in-current", () => {
    const reason = nodeDiffUnavailableReason("unmapped-in-current");
    expect(reason).toContain("not mapped to a specific code region");
  });

  it("returns a reason for no-previous-manifest", () => {
    const reason = nodeDiffUnavailableReason("no-previous-manifest");
    expect(reason).toContain("manifest is not available");
  });
});
