import { beforeEach, describe, expect, it } from "vitest";
import { InspectorPanel } from "./InspectorPanel";

type InspectorPanelTestOnly = {
  isRecord: (...args: readonly unknown[]) => unknown;
  isFilesPayload: (...args: readonly unknown[]) => unknown;
  isDesignIrPayload: (...args: readonly unknown[]) => unknown;
  isComponentManifestPayload: (...args: readonly unknown[]) => unknown;
  isGenerationMetricsPayload: (...args: readonly unknown[]) => unknown;
  isLocalSyncFilePlanEntry: (...args: readonly unknown[]) => unknown;
  isLocalSyncSummary: (...args: readonly unknown[]) => unknown;
  isLocalSyncDryRunPayload: (...args: readonly unknown[]) => unknown;
  isLocalSyncApplyPayload: (...args: readonly unknown[]) => unknown;
  canWriteLocalSyncEntry: (...args: readonly unknown[]) => unknown;
  isAttentionSyncEntry: (...args: readonly unknown[]) => unknown;
  toLocalSyncStatusLabel: (...args: readonly unknown[]) => unknown;
  toLocalSyncActionLabel: (...args: readonly unknown[]) => unknown;
  getLocalSyncStatusClasses: (...args: readonly unknown[]) => unknown;
  createLocalSyncDecisionMap: (...args: readonly unknown[]) => unknown;
  toEndpointError: (...args: readonly unknown[]) => unknown;
  getStatusBadgeClasses: (...args: readonly unknown[]) => unknown;
  loadBoundariesEnabledPreference: (...args: readonly unknown[]) => unknown;
  toBoundariesForFile: (...args: readonly unknown[]) => unknown;
  findIrElementNode: (...args: readonly unknown[]) => unknown;
  irScreensToTreeNodes: (...args: readonly unknown[]) => unknown;
  findManifestEntry: (...args: readonly unknown[]) => unknown;
  toScalarControlInputValue: (...args: readonly unknown[]) => unknown;
  toPaddingControlInputValue: (...args: readonly unknown[]) => unknown;
  toLayoutControlInputValue: (...args: readonly unknown[]) => unknown;
  fieldLabel: (...args: readonly unknown[]) => unknown;
};

const __TEST_ONLY__ = (
  InspectorPanel as typeof InspectorPanel & {
    __TEST_ONLY__: InspectorPanelTestOnly;
  }
).__TEST_ONLY__!;

describe("InspectorPanel helper coverage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("validates payload guards and sync plan payloads", () => {
    expect(__TEST_ONLY__.isRecord({ ok: true })).toBe(true);
    expect(__TEST_ONLY__.isRecord(null)).toBe(false);
    expect(__TEST_ONLY__.isFilesPayload({ jobId: "job-1", files: [] })).toBe(
      true,
    );
    expect(__TEST_ONLY__.isFilesPayload({ jobId: "job-1" })).toBe(false);
    expect(
      __TEST_ONLY__.isDesignIrPayload({ jobId: "job-1", screens: [] }),
    ).toBe(true);
    expect(
      __TEST_ONLY__.isComponentManifestPayload({
        jobId: "job-1",
        screens: [],
      }),
    ).toBe(true);
    expect(__TEST_ONLY__.isGenerationMetricsPayload({ anything: true })).toBe(
      true,
    );

    const entry = {
      path: "src/screens/Home.tsx",
      action: "overwrite",
      status: "conflict",
      reason: "destination_modified_since_sync",
      decision: "write",
      selectedByDefault: true,
      sizeBytes: 123,
      message: "needs review",
    };
    expect(__TEST_ONLY__.isLocalSyncFilePlanEntry(entry)).toBe(true);
    expect(
      __TEST_ONLY__.isLocalSyncFilePlanEntry({
        ...entry,
        action: "delete",
      }),
    ).toBe(false);

    const summary = {
      totalFiles: 1,
      selectedFiles: 1,
      createCount: 0,
      overwriteCount: 1,
      conflictCount: 1,
      untrackedCount: 0,
      unchangedCount: 0,
      totalBytes: 123,
      selectedBytes: 123,
    };
    expect(__TEST_ONLY__.isLocalSyncSummary(summary)).toBe(true);
    expect(
      __TEST_ONLY__.isLocalSyncDryRunPayload({
        jobId: "job-1",
        sourceJobId: "job-0",
        boardKey: "board-1",
        targetPath: "apps/demo",
        scopePath: "src/screens/Home.tsx",
        destinationRoot: "/tmp/demo",
        files: [entry],
        summary,
        confirmationToken: "token",
        confirmationExpiresAt: "2026-04-12T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      __TEST_ONLY__.isLocalSyncApplyPayload({
        jobId: "job-1",
        sourceJobId: "job-0",
        boardKey: "board-1",
        targetPath: "apps/demo",
        scopePath: "src/screens/Home.tsx",
        destinationRoot: "/tmp/demo",
        files: [entry],
        summary,
        appliedAt: "2026-04-12T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("derives local sync labels, classes, and decisions", () => {
    const createEntry = {
      path: "a",
      action: "create",
      status: "create",
      reason: "new_file",
      decision: "write",
      selectedByDefault: true,
      sizeBytes: 10,
      message: "",
    } as const;
    const skipEntry = {
      ...createEntry,
      path: "b",
      action: "none",
      status: "unchanged",
      reason: "already_matches_generated",
      decision: "skip",
    } as const;

    expect(__TEST_ONLY__.canWriteLocalSyncEntry(createEntry)).toBe(true);
    expect(__TEST_ONLY__.canWriteLocalSyncEntry(skipEntry)).toBe(false);
    expect(
      __TEST_ONLY__.isAttentionSyncEntry({
        ...createEntry,
        status: "conflict",
      }),
    ).toBe(true);
    expect(
      __TEST_ONLY__.isAttentionSyncEntry({
        ...createEntry,
        status: "untracked",
      }),
    ).toBe(true);
    expect(__TEST_ONLY__.isAttentionSyncEntry(createEntry)).toBe(false);

    expect(__TEST_ONLY__.toLocalSyncStatusLabel("create")).toBe("Create");
    expect(__TEST_ONLY__.toLocalSyncStatusLabel("overwrite")).toBe(
      "Managed overwrite",
    );
    expect(__TEST_ONLY__.toLocalSyncStatusLabel("conflict")).toBe("Conflict");
    expect(__TEST_ONLY__.toLocalSyncStatusLabel("untracked")).toBe(
      "Untracked",
    );
    expect(__TEST_ONLY__.toLocalSyncStatusLabel("unchanged")).toBe(
      "Up to date",
    );

    expect(__TEST_ONLY__.toLocalSyncActionLabel("create")).toBe("Will create");
    expect(__TEST_ONLY__.toLocalSyncActionLabel("overwrite")).toBe(
      "Will overwrite",
    );
    expect(__TEST_ONLY__.toLocalSyncActionLabel("none")).toBe(
      "No write needed",
    );

    expect(__TEST_ONLY__.getLocalSyncStatusClasses("create")).toContain(
      "emerald",
    );
    expect(__TEST_ONLY__.getLocalSyncStatusClasses("overwrite")).toContain(
      "sky",
    );
    expect(__TEST_ONLY__.getLocalSyncStatusClasses("conflict")).toContain(
      "rose",
    );
    expect(__TEST_ONLY__.getLocalSyncStatusClasses("untracked")).toContain(
      "amber",
    );
    expect(__TEST_ONLY__.getLocalSyncStatusClasses("unchanged")).toContain(
      "slate",
    );

    expect(
      __TEST_ONLY__.createLocalSyncDecisionMap([createEntry, skipEntry]),
    ).toEqual({ a: "write", b: "skip" });
  });

  it("normalizes endpoint and badge helpers", () => {
    expect(
      __TEST_ONLY__.toEndpointError({
        status: 500,
        payload: null,
        fallbackCode: "FALLBACK",
        fallbackMessage: "Fallback message",
      }),
    ).toEqual({
      status: 500,
      code: "FALLBACK",
      message: "Fallback message",
    });
    expect(
      __TEST_ONLY__.toEndpointError({
        status: 422,
        payload: { error: "INVALID", message: "Bad request" },
        fallbackCode: "FALLBACK",
        fallbackMessage: "Fallback message",
      }),
    ).toEqual({
      status: 422,
      code: "INVALID",
      message: "Bad request",
    });

    expect(__TEST_ONLY__.getStatusBadgeClasses("ready")).toContain("#4eba87");
    expect(__TEST_ONLY__.getStatusBadgeClasses("loading")).toContain("white");
    expect(__TEST_ONLY__.getStatusBadgeClasses("empty")).toContain("amber");
    expect(__TEST_ONLY__.getStatusBadgeClasses("error")).toContain("rose");
  });

  it("loads the boundaries preference from session storage", () => {
    expect(__TEST_ONLY__.loadBoundariesEnabledPreference()).toBe(false);
    window.sessionStorage.setItem("workspace-dev:inspector-boundaries:v1", "1");
    expect(__TEST_ONLY__.loadBoundariesEnabledPreference()).toBe(true);
  });

  it("derives boundaries, finds manifest entries, and walks design-ir trees", () => {
    const manifest = {
      jobId: "job-1",
      screens: [
        {
          screenId: "screen-home",
          screenName: "Home",
          file: "src/screens/Home.tsx",
          components: [
            {
              irNodeId: "node-1",
              irNodeName: "Button",
              irNodeType: "button",
              file: "src/screens/Home.tsx",
              startLine: 10,
              endLine: 12,
            },
            {
              irNodeId: "node-1",
              irNodeName: "Button",
              irNodeType: "button",
              file: "src/screens/Home.tsx",
              startLine: 10,
              endLine: 12,
            },
          ],
        },
      ],
    };

    expect(
      __TEST_ONLY__.toBoundariesForFile({
        manifest,
        filePath: "src/screens/Home.tsx",
      }),
    ).toEqual([
      {
        irNodeId: "node-1",
        irNodeName: "Button",
        irNodeType: "button",
        startLine: 10,
        endLine: 12,
      },
    ]);
    expect(
      __TEST_ONLY__.toBoundariesForFile({ manifest: null, filePath: null }),
    ).toEqual([]);

    const screens = [
      {
        id: "screen-home",
        name: "Home",
        generatedFile: "src/screens/Home.tsx",
        children: [
          {
            id: "node-1",
            name: "Button",
            type: "button",
            children: [
              {
                id: "node-2",
                name: "Label",
                type: "text",
              },
            ],
          },
        ],
      },
    ];

    expect(__TEST_ONLY__.findIrElementNode(screens, "screen-home")).toEqual({
      id: "screen-home",
      name: "Home",
      type: "screen",
    });
    expect(__TEST_ONLY__.findIrElementNode(screens, "node-2")).toEqual({
      id: "node-2",
      name: "Label",
      type: "text",
    });
    expect(__TEST_ONLY__.findIrElementNode(screens, "missing")).toBeNull();

    expect(__TEST_ONLY__.irScreensToTreeNodes(screens)).toEqual([
      {
        id: "screen-home",
        name: "Home",
        type: "screen",
        children: [
          {
            id: "node-1",
            name: "Button",
            type: "button",
            children: [
              {
                id: "node-2",
                name: "Label",
                type: "text",
              },
            ],
          },
        ],
      },
    ]);

    expect(__TEST_ONLY__.findManifestEntry("screen-home", manifest)).toEqual({
      screen: manifest.screens[0],
      entry: null,
    });
    expect(__TEST_ONLY__.findManifestEntry("node-1", manifest)).toEqual({
      screen: manifest.screens[0],
      entry: manifest.screens[0]?.components[0] ?? null,
    });
    expect(__TEST_ONLY__.findManifestEntry("missing", manifest)).toBeNull();
  });

  it("normalizes control inputs and human-readable field labels", () => {
    expect(__TEST_ONLY__.toScalarControlInputValue(12)).toBe("12");
    expect(__TEST_ONLY__.toScalarControlInputValue("16")).toBe("16");
    expect(__TEST_ONLY__.toScalarControlInputValue(null)).toBe("");

    expect(
      __TEST_ONLY__.toPaddingControlInputValue({
        top: 1,
        right: 2,
        bottom: 3,
        left: 4,
      }),
    ).toEqual({
      top: "1",
      right: "2",
      bottom: "3",
      left: "4",
    });
    expect(
      __TEST_ONLY__.toPaddingControlInputValue("invalid"),
    ).toEqual({});

    expect(__TEST_ONLY__.toLayoutControlInputValue("HORIZONTAL")).toBe(
      "HORIZONTAL",
    );
    expect(__TEST_ONLY__.toLayoutControlInputValue(320)).toBe("320");

    expect(__TEST_ONLY__.fieldLabel("fillColor")).toBe("Fill color");
    expect(__TEST_ONLY__.fieldLabel("opacity")).toBe("Opacity");
    expect(__TEST_ONLY__.fieldLabel("cornerRadius")).toBe("Corner radius");
    expect(__TEST_ONLY__.fieldLabel("fontSize")).toBe("Font size");
    expect(__TEST_ONLY__.fieldLabel("fontWeight")).toBe("Font weight");
    expect(__TEST_ONLY__.fieldLabel("fontFamily")).toBe("Font family");
    expect(__TEST_ONLY__.fieldLabel("padding")).toBe("Padding");
    expect(__TEST_ONLY__.fieldLabel("width")).toBe("Width");
    expect(__TEST_ONLY__.fieldLabel("height")).toBe("Height");
    expect(__TEST_ONLY__.fieldLabel("layoutMode")).toBe("Layout mode");
    expect(__TEST_ONLY__.fieldLabel("primaryAxisAlignItems")).toBe(
      "Primary axis align",
    );
    expect(__TEST_ONLY__.fieldLabel("counterAxisAlignItems")).toBe(
      "Counter axis align",
    );
    expect(__TEST_ONLY__.fieldLabel("required")).toBe("Required");
    expect(__TEST_ONLY__.fieldLabel("validationType")).toBe("Validation type");
    expect(__TEST_ONLY__.fieldLabel("validationMessage")).toBe(
      "Validation message",
    );
    expect(__TEST_ONLY__.fieldLabel("validationMinLength")).toBe(
      "validationMinLength",
    );
    expect(__TEST_ONLY__.fieldLabel("validationMaxLength")).toBe(
      "validationMaxLength",
    );
    expect(__TEST_ONLY__.fieldLabel("validationPattern")).toBe(
      "validationPattern",
    );
    expect(__TEST_ONLY__.fieldLabel("validationMin")).toBe("validationMin");
    expect(__TEST_ONLY__.fieldLabel("validationMax")).toBe("validationMax");
  });
});
