import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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
  assert.equal(onlineArtifact.summary.resolved, 1);
  assert.equal(onlineArtifact.summary.partial, 0);
  assert.equal(onlineArtifact.summary.error, 0);
  assert.equal(onlineArtifact.summary.cacheHit, 0);
  assert.equal(onlineArtifact.summary.offlineReused, 0);
  assert.equal(onlineArtifact.entries[0]?.status, "resolved");
  assert.equal(onlineArtifact.entries[0]?.resolutionSource, "live");
  assert.equal(onlineArtifact.entries[0]?.canonicalFamilyName, "Button");
  assert.deepEqual(onlineArtifact.entries[0]?.variantProperties, [
    {
      property: "State",
      values: ["Primary"]
    }
  ]);
  assert.equal(calls.length, 2);

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
  assert.equal(offlineArtifact.summary.resolved, 1);
  assert.equal(offlineArtifact.summary.cacheHit, 1);
  assert.equal(offlineArtifact.summary.offlineReused, 1);
  assert.equal(offlineArtifact.entries[0]?.resolutionSource, "cache");
  assert.equal(offlineArtifact.entries[0]?.canonicalFamilyName, "Button");
  assert.equal(offlineArtifact.entries[0]?.publishedComponent?.fileKey, "lib-file");
  assert.equal(offlineArtifact.entries[0]?.publishedComponentSet?.fileKey, "lib-file");
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
    ["E_LIBRARY_OFFLINE_CACHE_MISS", "E_LIBRARY_OFFLINE_COMPONENT_SET_CACHE_MISS"]
  );
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
  assert.equal(artifact.summary.resolved, 0);
  assert.equal(artifact.summary.partial, 0);
  assert.equal(artifact.summary.error, 1);
  assert.equal(artifact.entries[0]?.status, "error");
  assert.deepEqual(
    artifact.entries[0]?.issues?.map((issue) => issue.code).sort(),
    ["E_LIBRARY_ASSET_NOT_FOUND", "E_LIBRARY_ASSET_NOT_FOUND"]
  );
});
