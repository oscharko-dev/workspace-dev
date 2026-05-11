import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { FigmaAnalysis } from "../parity/figma-analysis.js";
import type { FigmaFileResponse } from "./types.js";
import { resolveFigmaLibraryResolutionArtifact } from "./figma-library-resolution.js";

const createAnalysis = (): FigmaAnalysis =>
  ({
    artifactVersion: 1,
    sourceName: "Test Board",
    summary: {},
    tokenSignals: {},
    layoutGraph: {
      pages: [],
      sections: [],
      frames: [],
      edges: []
    },
    componentFamilies: [
      {
        familyKey: "button-family",
        familyName: "Button",
        componentIds: ["1:100"],
        componentSetIds: ["1:200"],
        referringNodeIds: ["instance-1"],
        nodeCount: 1,
        variantProperties: [
          {
            property: "State",
            values: ["Primary"]
          }
        ]
      }
    ],
    externalComponents: [
      {
        componentId: "1:100",
        componentSetId: "1:200",
        familyKey: "button-family",
        familyName: "Button",
        referringNodeIds: ["instance-1"]
      }
    ],
    frameVariantGroups: [],
    appShellSignals: [],
    componentDensity: {
      densestFrames: [],
      sparsestFrames: [],
      averageFamilyCoverage: 0
    },
    diagnostics: []
  }) as FigmaAnalysis;

const createFile = (): FigmaFileResponse => ({
  name: "Test Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": {
      key: "cmp-key",
      name: "Button/Primary",
      description: "Primary button",
      componentSetId: "1:200",
      remote: true
    }
  },
  componentSets: {
    "1:200": {
      key: "set-key",
      name: "Button",
      description: "Button family",
      remote: true
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: []
  }
});

const createVariantMergeAnalysis = (): FigmaAnalysis =>
  ({
    ...createAnalysis(),
    componentFamilies: [
      {
        ...createAnalysis().componentFamilies[0]!,
        variantProperties: [
          {
            property: "Mode",
            values: ["Standalone"]
          }
        ]
      }
    ]
  }) as FigmaAnalysis;

const createVariantMergeFile = (): FigmaFileResponse => ({
  name: "Test Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": {
      key: "cmp-key",
      name: "Button/Primary, State=Pressed",
      description: "Primary button",
      componentSetId: "1:200",
      remote: true
    }
  },
  componentSets: {
    "1:200": {
      key: "set-key",
      name: "Button, Size=Large, Tone=Warm",
      description: "Button family",
      remote: true
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: []
  }
});

const createOverlappingAnalysis = (): FigmaAnalysis =>
  ({
    ...createAnalysis(),
    componentFamilies: [
      ...createAnalysis().componentFamilies,
      {
        familyKey: "badge-family",
        familyName: "Badge",
        componentIds: ["1:101"],
        componentSetIds: ["1:201"],
        referringNodeIds: ["instance-2"],
        nodeCount: 1,
        variantProperties: [
          {
            property: "Tone",
            values: ["Secondary"]
          }
        ]
      }
    ],
    externalComponents: [
      ...createAnalysis().externalComponents,
      {
        componentId: "1:101",
        componentSetId: "1:201",
        familyKey: "badge-family",
        familyName: "Badge",
        referringNodeIds: ["instance-2"]
      }
    ]
  }) as FigmaAnalysis;

const createOverlappingFile = (): FigmaFileResponse => ({
  name: "Test Board",
  lastModified: "2026-04-01T00:00:00Z",
  components: {
    "1:100": {
      key: "cmp-key",
      name: "Button/Primary",
      description: "Primary button",
      componentSetId: "1:200",
      remote: true
    },
    "1:101": {
      key: "cmp-key-2",
      name: "Badge/Secondary",
      description: "Secondary badge",
      componentSetId: "1:201",
      remote: true
    }
  },
  componentSets: {
    "1:200": {
      key: "set-key",
      name: "Button",
      description: "Button family",
      remote: true
    },
    "1:201": {
      key: "set-key-2",
      name: "Badge",
      description: "Badge family",
      remote: true
    }
  },
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: []
  }
});

const createLegacySeedAnalysis = (): FigmaAnalysis => createAnalysis();

const createLegacySeedFile = (): FigmaFileResponse => createFile();

const toVariantPropertyMap = (
  properties: Array<{
    property: string;
    values: string[];
  }>
): Record<string, string[]> => {
  return Object.fromEntries(properties.map((property) => [property.property, [...property.values].sort()]));
};

const createFetchImpl = ({
  responses,
  calls
}: {
  responses: Record<
    string,
    {
      status: number;
      body: unknown;
    }
  >;
  calls: string[];
}): typeof fetch => {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    calls.push(url);
    const response = responses[url];
    assert.ok(response, `Unexpected fetch URL: ${url}`);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: {
        "content-type": "application/json"
      }
    });
  };
};

test("resolveFigmaLibraryResolutionArtifact resolves live metadata and reuses cache for local_json", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-"));
  const calls: string[] = [];
  const fetchImpl = createFetchImpl({
    calls,
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary",
            description: "Primary button"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 200,
        body: {
          meta: {
            key: "set-key",
            file_key: "lib-file",
            node_id: "10:10",
            name: "Button",
            description: "Button family"
          }
        }
      }
    }
  });

  const onlineArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(onlineArtifact);
  assert.equal(onlineArtifact.artifact, "figma.library_resolution");
  assert.equal(onlineArtifact.version, 1);
  assert.equal(onlineArtifact.figmaSourceMode, "rest");
  assert.equal(onlineArtifact.summary.total, 1);
  assert.equal(onlineArtifact.summary.resolved, 1);
  assert.equal(onlineArtifact.summary.partial, 0);
  assert.equal(onlineArtifact.summary.error, 0);
  assert.equal(onlineArtifact.summary.cacheHit, 0);
  assert.equal(onlineArtifact.summary.offlineReused, 0);
  assert.equal(onlineArtifact.entries[0]?.status, "resolved");
  assert.equal(onlineArtifact.entries[0]?.resolutionSource, "live");
  assert.equal(onlineArtifact.entries[0]?.canonicalFamilyName, "Button");
  assert.equal(onlineArtifact.entries[0]?.canonicalFamilyNameSource, "published_component_set");
  assert.deepEqual(onlineArtifact.entries[0]?.variantProperties, [
    {
      property: "state",
      values: ["Primary"]
    }
  ]);
  assert.equal(calls.length, 2);
  const cachedAssetFiles = (await readdir(cacheDir)).filter((name) => name.startsWith("figma-library-resolution-asset-"));
  assert.equal(cachedAssetFiles.length, 2);

  const offlineArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "local_json",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(offlineArtifact);
  assert.equal(offlineArtifact.artifact, "figma.library_resolution");
  assert.equal(offlineArtifact.figmaSourceMode, "local_json");
  assert.equal(offlineArtifact.summary.total, 1);
  assert.equal(offlineArtifact.summary.resolved, 1);
  assert.equal(offlineArtifact.summary.cacheHit, 1);
  assert.equal(offlineArtifact.summary.offlineReused, 1);
  assert.equal(offlineArtifact.entries[0]?.resolutionSource, "cache");
  assert.equal(offlineArtifact.entries[0]?.canonicalFamilyName, "Button");
  assert.equal(offlineArtifact.entries[0]?.publishedComponent?.fileKey, "lib-file");
  assert.equal(offlineArtifact.entries[0]?.publishedComponentSet?.fileKey, "lib-file");
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact reuses cached assets when only part of the key set overlaps", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-overlap-"));
  const seededFetchCalls: string[] = [];
  const seededFetchImpl = createFetchImpl({
    calls: seededFetchCalls,
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 200,
        body: {
          meta: {
            key: "set-key",
            file_key: "lib-file",
            node_id: "10:10",
            name: "Button"
          }
        }
      }
    }
  });

  const seededArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl: seededFetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(seededArtifact);
  assert.equal(seededFetchCalls.length, 2);

  const overlappingArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createOverlappingAnalysis(),
    file: createOverlappingFile(),
    figmaSourceMode: "local_json",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(overlappingArtifact);
  assert.equal(overlappingArtifact.summary.total, 2);
  assert.equal(overlappingArtifact.summary.resolved, 1);
  assert.equal(overlappingArtifact.summary.partial, 1);
  assert.equal(overlappingArtifact.summary.cacheHit, 1);
  assert.equal(overlappingArtifact.summary.offlineReused, 1);
  const resolvedEntry = overlappingArtifact.entries.find((entry) => entry.componentId === "1:100");
  const partialEntry = overlappingArtifact.entries.find((entry) => entry.componentId === "1:101");
  assert.equal(resolvedEntry?.resolutionSource, "cache");
  assert.equal(resolvedEntry?.status, "resolved");
  assert.equal(partialEntry?.resolutionSource, "local_catalog");
  assert.equal(partialEntry?.status, "partial");
  assert.deepEqual(partialEntry?.issues?.map((issue) => issue.code).sort(), [
    "E_LIBRARY_CACHE_ENTRY_MISSING",
    "E_LIBRARY_COMPONENT_SET_CACHE_ENTRY_MISSING"
  ]);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact only persists successful live lookups for offline replay", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-success-only-"));
  const fetchImpl = createFetchImpl({
    calls: [],
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 403,
        body: {
          message: "Missing scope"
        }
      }
    }
  });

  const liveArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(liveArtifact);
  const cachedAssetFiles = (await readdir(cacheDir)).filter((name) => name.startsWith("figma-library-resolution-asset-"));
  assert.equal(cachedAssetFiles.length, 1);

  const offlineArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "local_json",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(offlineArtifact);
  assert.equal(offlineArtifact.summary.resolved, 0);
  assert.equal(offlineArtifact.summary.partial, 1);
  assert.equal(offlineArtifact.summary.cacheHit, 1);
  assert.equal(offlineArtifact.entries[0]?.resolutionSource, "cache");
  assert.deepEqual(
    offlineArtifact.entries[0]?.issues?.map((issue) => issue.code).sort(),
    ["E_LIBRARY_COMPONENT_SET_CACHE_ENTRY_MISSING"]
  );
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact replays legacy fingerprint cache entries in local_json mode", async () => {
  const seedCacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-legacy-seed-"));
  const seedArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createLegacySeedAnalysis(),
    file: createLegacySeedFile(),
    figmaSourceMode: "rest",
    cacheDir: seedCacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl: createFetchImpl({
      calls: [],
      responses: {
        "https://api.figma.com/v1/components/cmp-key": {
          status: 200,
          body: {
            meta: {
              key: "cmp-key",
              file_key: "lib-file",
              node_id: "10:20",
              name: "Button/Primary"
            }
          }
        },
        "https://api.figma.com/v1/component_sets/set-key": {
          status: 200,
          body: {
            meta: {
              key: "set-key",
              file_key: "lib-file",
              node_id: "10:10",
              name: "Button"
            }
          }
        }
      }
    }),
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(seedArtifact);

  const legacyCacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-legacy-"));
  const legacyCacheFilePath = path.join(legacyCacheDir, `figma-library-resolution-${seedArtifact.fingerprint}.json`);
  await writeFile(
    legacyCacheFilePath,
    `${JSON.stringify(
      {
        version: 1,
        fingerprint: seedArtifact.fingerprint,
        cachedAt: Date.now(),
        componentKeys: ["cmp-key"],
        componentSetKeys: ["set-key"],
        componentResults: {
          "cmp-key": {
            status: "ok",
            meta: seedArtifact.entries[0]?.publishedComponent
          }
        },
        componentSetResults: {
          "set-key": {
            status: "ok",
            meta: seedArtifact.entries[0]?.publishedComponentSet
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const offlineArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createLegacySeedAnalysis(),
    file: createLegacySeedFile(),
    figmaSourceMode: "local_json",
    cacheDir: legacyCacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(offlineArtifact);
  assert.equal(offlineArtifact.summary.resolved, 1);
  assert.equal(offlineArtifact.summary.partial, 0);
  assert.equal(offlineArtifact.summary.cacheHit, 1);
  assert.equal(offlineArtifact.summary.offlineReused, 1);
  assert.equal(offlineArtifact.entries[0]?.resolutionSource, "cache");
  assert.equal(offlineArtifact.entries[0]?.canonicalFamilyName, "Button");
  await rm(seedCacheDir, { recursive: true, force: true });
  await rm(legacyCacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact merges published, analysis, and local variant hints", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-variant-"));
  const fetchImpl = createFetchImpl({
    calls: [],
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary, State=Pressed"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 200,
        body: {
          meta: {
            key: "set-key",
            file_key: "lib-file",
            node_id: "10:10",
            name: "Button, Size=Large, Tone=Warm"
          }
        }
      }
    }
  });

  const liveArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createVariantMergeAnalysis(),
    file: {
      ...createVariantMergeFile(),
      components: {
        "1:100": {
          key: "cmp-key",
          name: "Button/Primary, Density=Compact",
          description: "Primary button",
          componentSetId: "1:200",
          remote: true
        }
      },
      componentSets: {
        "1:200": {
          key: "set-key",
          name: "Button, Tone=Local",
          description: "Button family",
          remote: true
        }
      }
    },
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(liveArtifact);
  const variantPropertyMap = toVariantPropertyMap(liveArtifact.entries[0]?.variantProperties ?? []);
  assert.deepEqual(variantPropertyMap, {
    density: ["Compact"],
    mode: ["Standalone"],
    size: ["Large"],
    state: ["Pressed"],
    tone: ["Local", "Warm"]
  });

  const offlineArtifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createVariantMergeAnalysis(),
    file: {
      ...createVariantMergeFile(),
      components: {
        "1:100": {
          key: "cmp-key",
          name: "Button/Primary, Density=Compact",
          description: "Primary button",
          componentSetId: "1:200",
          remote: true
        }
      },
      componentSets: {
        "1:200": {
          key: "set-key",
          name: "Button, Tone=Local",
          description: "Button family",
          remote: true
        }
      }
    },
    figmaSourceMode: "local_json",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(offlineArtifact);
  assert.equal(offlineArtifact.entries[0]?.resolutionSource, "cache");
  assert.deepEqual(toVariantPropertyMap(offlineArtifact.entries[0]?.variantProperties ?? []), variantPropertyMap);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact reports partial local_json results when no cache is available", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-miss-"));

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "local_json",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used in local_json mode");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.resolved, 0);
  assert.equal(artifact.summary.partial, 1);
  assert.equal(artifact.summary.error, 0);
  assert.equal(artifact.entries[0]?.status, "partial");
  assert.equal(artifact.entries[0]?.resolutionSource, "local_catalog");
  assert.equal(artifact.entries[0]?.canonicalFamilyName, "Button");
  assert.deepEqual(
    artifact.entries[0]?.issues?.map((issue) => issue.code).sort(),
    [
      "E_LIBRARY_CACHE_ENTRY_MISSING",
      "E_LIBRARY_COMPONENT_SET_CACHE_ENTRY_MISSING"
    ]
  );
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records partial live results when component-set lookup is forbidden", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-partial-"));
  const fetchImpl = createFetchImpl({
    calls: [],
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 403,
        body: {
          message: "Missing scope"
        }
      }
    }
  });

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.partial, 1);
  assert.equal(artifact.summary.error, 0);
  assert.equal(artifact.entries[0]?.status, "partial");
  assert.equal(artifact.entries[0]?.canonicalFamilyName, "Button/Primary");
  assert.equal(artifact.entries[0]?.publishedComponent?.name, "Button/Primary");
  assert.deepEqual(artifact.entries[0]?.issues?.map((issue) => issue.code), ["E_LIBRARY_ASSET_FORBIDDEN"]);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records errors when published component metadata is missing", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-error-"));
  const fetchImpl = createFetchImpl({
    calls: [],
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 404,
        body: {
          message: "Component not found"
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 404,
        body: {
          message: "Component set not found"
        }
      }
    }
  });

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.resolved, 0);
  assert.equal(artifact.summary.partial, 0);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  assert.equal(artifact.entries[0]?.issues?.length, 2);
  const componentIssue = artifact.entries[0]?.issues?.find((issue) => issue.scope === "component");
  const componentSetIssue = artifact.entries[0]?.issues?.find((issue) => issue.scope === "component_set");
  assert.equal(componentIssue?.code, "E_LIBRARY_ASSET_NOT_FOUND");
  assert.equal(componentIssue?.retriable, false);
  assert.equal(componentSetIssue?.code, "E_LIBRARY_ASSET_NOT_FOUND");
  assert.equal(componentSetIssue?.retriable, false);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact returns undefined when no external components exist", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-empty-"));
  const emptyAnalysis = {
    ...createAnalysis(),
    externalComponents: [],
    componentFamilies: []
  } as FigmaAnalysis;

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: emptyAnalysis,
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl: async () => {
      throw new Error("network should not be used when there are no external components");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.equal(artifact, undefined);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact marks all entries as error when access token is missing", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-notoken-"));

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fetchImpl: async () => {
      throw new Error("network should not be used without a token");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  assert.equal(artifact.entries[0]?.issues?.length, 2);
  const tokenComponentIssue = artifact.entries[0]?.issues?.find((issue) => issue.scope === "component");
  const tokenComponentSetIssue = artifact.entries[0]?.issues?.find((issue) => issue.scope === "component_set");
  assert.equal(tokenComponentIssue?.code, "E_LIBRARY_ACCESS_TOKEN_MISSING");
  assert.equal(tokenComponentIssue?.retriable, false);
  assert.equal(tokenComponentSetIssue?.code, "E_LIBRARY_ACCESS_TOKEN_MISSING");
  assert.equal(tokenComponentSetIssue?.retriable, false);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact retries with Bearer token on PAT 403 with invalid token body", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-bearer-"));
  const calls: string[] = [];
  let componentCallCount = 0;
  let componentSetCallCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    calls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url.includes("/components/")) {
      componentCallCount += 1;
      if (headers["X-Figma-Token"] && componentCallCount === 1) {
        return new Response(JSON.stringify({ message: "Invalid token" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.includes("/component_sets/")) {
      componentSetCallCount += 1;
      if (headers["X-Figma-Token"] && componentSetCallCount === 1) {
        return new Response(JSON.stringify({ message: "Invalid token" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          meta: {
            key: "set-key",
            file_key: "lib-file",
            node_id: "10:10",
            name: "Button"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.resolved, 1);
  assert.equal(artifact.summary.error, 0);
  assert.equal(artifact.entries[0]?.status, "resolved");
  assert.equal(artifact.entries[0]?.canonicalFamilyName, "Button");
  assert.ok(componentCallCount >= 2, "component endpoint should have been called at least twice (PAT + Bearer)");
  assert.ok(componentSetCallCount >= 2, "component_set endpoint should have been called at least twice (PAT + Bearer)");
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact abort signal cancels retry wait", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-abort-"));
  const abortController = new AbortController();
  let fetchCallCount = 0;

  const fetchImpl: typeof fetch = async () => {
    fetchCallCount += 1;
    if (fetchCallCount === 1) {
      setTimeout(() => { abortController.abort(); }, 10);
      return new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "cmp-key",
          file_key: "lib-file",
          node_id: "10:20",
          name: "Button/Primary"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const start = Date.now();
  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: {
      ...createFile(),
      componentSets: {}
    },
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 3,
    abortSignal: abortController.signal
  });
  const elapsed = Date.now() - start;

  assert.ok(artifact);
  assert.ok(elapsed < 3_000, `Expected abort to cancel retry wait quickly, but took ${elapsed}ms`);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records error when component key is missing from catalog", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-nokey-"));
  const analysis = {
    ...createAnalysis(),
    externalComponents: [
      {
        componentId: "1:999",
        componentSetId: "1:200",
        familyKey: "button-family",
        familyName: "Button",
        referringNodeIds: ["instance-1"]
      }
    ]
  } as FigmaAnalysis;
  const file: FigmaFileResponse = {
    ...createFile(),
    components: {},
    componentSets: {}
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis,
    file,
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl: async () => {
      throw new Error("network should not be used when component key is missing");
    },
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.total, 1);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const keyIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_COMPONENT_KEY_MISSING");
  assert.ok(keyIssue, "Expected E_LIBRARY_COMPONENT_KEY_MISSING issue");
  assert.equal(keyIssue?.scope, "component");
  const setKeyIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_COMPONENT_SET_KEY_MISSING");
  assert.ok(setKeyIssue, "Expected E_LIBRARY_COMPONENT_SET_KEY_MISSING issue");
  assert.equal(setKeyIssue?.scope, "component_set");
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records error when API returns unparseable JSON", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-parse-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url.includes("/components/")) {
      return new Response("not-valid-json{{{", {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "set-key",
          file_key: "lib-file",
          node_id: "10:10",
          name: "Button"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const parseIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_ASSET_PARSE");
  assert.ok(parseIssue, "Expected E_LIBRARY_ASSET_PARSE issue");
  assert.equal(parseIssue?.scope, "component");
  assert.equal(parseIssue?.retriable, false);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records error when API returns invalid payload structure", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-invalid-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url.includes("/components/")) {
      return new Response(JSON.stringify({ data: "no meta field" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "set-key",
          file_key: "lib-file",
          node_id: "10:10",
          name: "Button"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const invalidIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_ASSET_INVALID");
  assert.ok(invalidIssue, "Expected E_LIBRARY_ASSET_INVALID issue");
  assert.equal(invalidIssue?.scope, "component");
  assert.equal(invalidIssue?.retriable, false);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records error when API returns server error after retries", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-http-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url.includes("/components/")) {
      return new Response(JSON.stringify({ message: "Internal Server Error" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "set-key",
          file_key: "lib-file",
          node_id: "10:10",
          name: "Button"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const httpIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_ASSET_HTTP");
  assert.ok(httpIssue, "Expected E_LIBRARY_ASSET_HTTP issue");
  assert.equal(httpIssue?.scope, "component");
  assert.equal(httpIssue?.retriable, true);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records error on network failure after retries", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-network-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url.includes("/components/")) {
      throw new Error("ECONNREFUSED: connection refused");
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "set-key",
          file_key: "lib-file",
          node_id: "10:10",
          name: "Button"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const networkIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_ASSET_NETWORK");
  assert.ok(networkIssue, "Expected E_LIBRARY_ASSET_NETWORK issue");
  assert.equal(networkIssue?.scope, "component");
  assert.equal(networkIssue?.retriable, false);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact records timeout error after retries", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-timeout-"));
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    if (url.includes("/components/")) {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      throw abortError;
    }
    return new Response(
      JSON.stringify({
        meta: {
          key: "set-key",
          file_key: "lib-file",
          node_id: "10:10",
          name: "Button"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  const timeoutIssue = artifact.entries[0]?.issues?.find((issue) => issue.code === "E_LIBRARY_ASSET_TIMEOUT");
  assert.ok(timeoutIssue, "Expected E_LIBRARY_ASSET_TIMEOUT issue");
  assert.equal(timeoutIssue?.scope, "component");
  assert.equal(timeoutIssue?.retriable, true);
  await rm(cacheDir, { recursive: true, force: true });
});

test("resolveFigmaLibraryResolutionArtifact evicts stale cache entries beyond limit", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-library-resolution-evict-"));
  await mkdir(cacheDir, { recursive: true });
  for (let i = 0; i < 55; i++) {
    const fileName = `figma-library-resolution-asset-component-fake${String(i).padStart(3, "0")}.json`;
    await writeFile(
      path.join(cacheDir, fileName),
      JSON.stringify({ version: 1, cachedAt: Date.now() - (55 - i) * 1000, assetKind: "component", key: `k${i}`, result: { status: "ok", meta: { key: `k${i}`, fileKey: "f", nodeId: "n", name: "N" } } }),
      "utf8"
    );
  }

  const filesBefore = (await readdir(cacheDir)).filter((name) => name.startsWith("figma-library-resolution-asset-"));
  assert.equal(filesBefore.length, 55);

  const fetchImpl = createFetchImpl({
    calls: [],
    responses: {
      "https://api.figma.com/v1/components/cmp-key": {
        status: 200,
        body: {
          meta: {
            key: "cmp-key",
            file_key: "lib-file",
            node_id: "10:20",
            name: "Button/Primary"
          }
        }
      },
      "https://api.figma.com/v1/component_sets/set-key": {
        status: 200,
        body: {
          meta: {
            key: "set-key",
            file_key: "lib-file",
            node_id: "10:10",
            name: "Button"
          }
        }
      }
    }
  });

  const artifact = await resolveFigmaLibraryResolutionArtifact({
    analysis: createAnalysis(),
    file: createFile(),
    figmaSourceMode: "rest",
    cacheDir,
    fileKey: "board-key",
    accessToken: "token",
    fetchImpl,
    timeoutMs: 1_000,
    maxRetries: 1
  });

  assert.ok(artifact);
  assert.equal(artifact.summary.resolved, 1);

  const filesAfter = (await readdir(cacheDir)).filter((name) => name.startsWith("figma-library-resolution-asset-"));
  assert.ok(filesAfter.length <= 50, `Expected at most 50 cache files after eviction, got ${filesAfter.length}`);
  await rm(cacheDir, { recursive: true, force: true });
});
