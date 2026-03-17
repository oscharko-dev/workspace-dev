import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DesignIR } from "../parity/types.js";
import { exportImageAssetsFromFigma } from "./image-export.js";

const createIrWithImages = (): DesignIR => {
  return {
    sourceName: "image-export",
    tokens: {
      palette: {
        primary: "#d4001a",
        secondary: "#1f2937",
        background: "#ffffff",
        text: "#111111",
        success: "#16a34a",
        warning: "#d97706",
        error: "#dc2626",
        info: "#0288d1",
        divider: "#1111111f",
        action: {
          active: "#1111118a",
          hover: "#d4001a0a",
          selected: "#d4001a14",
          disabled: "#11111142",
          disabledBackground: "#1111111f",
          focus: "#d4001a1f"
        }
      },
      borderRadius: 8,
      spacingBase: 8,
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16
    },
    screens: [
      {
        id: "screen-a",
        name: "A",
        layoutMode: "NONE",
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "img:png:1",
            name: "Hero",
            nodeType: "RECTANGLE",
            type: "image",
            width: 200,
            height: 120
          },
          {
            id: "img:svg:2",
            name: "Vector Illustration",
            nodeType: "VECTOR",
            type: "image",
            width: 64,
            height: 64
          },
          {
            id: "wrapper",
            name: "Wrapper",
            nodeType: "FRAME",
            type: "container",
            children: [
              {
                id: "img:png:3",
                name: "Nested image",
                nodeType: "FRAME",
                type: "image",
                width: 40,
                height: 40
              }
            ]
          }
        ]
      }
    ]
  };
};

test("exportImageAssetsFromFigma exports PNG/SVG assets with deterministic map paths", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-image-export-ok-"));
  const logs: string[] = [];
  const metadataCalls: Array<{ format: string; ids: string[] }> = [];
  const downloadedAssets: string[] = [];

  const fetchImpl: typeof fetch = (async (input) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const url = new URL(rawUrl);
    if (url.hostname === "api.figma.com") {
      const format = url.searchParams.get("format") ?? "";
      const idsParam = url.searchParams.get("ids") ?? "";
      const decodedIds = decodeURIComponent(idsParam).split(",").filter((entry) => entry.length > 0);
      metadataCalls.push({
        format,
        ids: decodedIds
      });
      const images = Object.fromEntries(
        decodedIds.map((nodeId) => [nodeId, `https://assets.workspace-dev.local/${nodeId}.${format}`])
      );
      return new Response(JSON.stringify({ images }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    if (url.hostname === "assets.workspace-dev.local") {
      downloadedAssets.push(url.pathname);
      const payload = url.pathname.endsWith(".svg")
        ? `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
        : "PNG";
      return new Response(payload, { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await exportImageAssetsFromFigma({
    fileKey: "demo-key",
    accessToken: "token",
    ir: createIrWithImages(),
    generatedProjectDir: projectDir,
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 1,
    onLog: (message) => logs.push(message)
  });

  assert.equal(result.candidateCount, 3);
  assert.equal(result.exportedCount, 3);
  assert.equal(result.failedCount, 0);
  assert.ok(logs.some((entry) => entry.includes("candidates=3")));

  const mapEntries = Object.entries(result.imageAssetMap);
  assert.deepEqual(
    mapEntries.map(([nodeId]) => nodeId),
    ["img:png:1", "img:png:3", "img:svg:2"]
  );
  assert.ok(mapEntries.every(([, publicPath]) => publicPath.startsWith("/images/")));
  assert.ok(result.imageAssetMap["img:svg:2"]?.endsWith(".svg"));
  assert.ok(result.imageAssetMap["img:png:1"]?.endsWith(".png"));

  for (const publicPath of Object.values(result.imageAssetMap)) {
    const diskPath = path.join(projectDir, "public", publicPath.replace(/^\//, ""));
    const content = await readFile(diskPath, "utf8");
    assert.ok(content.length > 0);
  }

  assert.equal(downloadedAssets.length, 3);
  assert.deepEqual(
    metadataCalls.map((call) => call.format).sort((left, right) => left.localeCompare(right)),
    ["png", "svg"]
  );
});

test("exportImageAssetsFromFigma tolerates partial export failures and returns fallback-ready map", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-image-export-partial-"));
  const logs: string[] = [];

  const fetchImpl: typeof fetch = (async (input) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const url = new URL(rawUrl);
    if (url.hostname === "api.figma.com") {
      return new Response(
        JSON.stringify({
          images: {
            "img:png:1": null,
            "img:png:3": "https://assets.workspace-dev.local/broken.png",
            "img:svg:2": "https://assets.workspace-dev.local/ok.svg"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    if (url.hostname === "assets.workspace-dev.local" && url.pathname.endsWith("broken.png")) {
      return new Response("broken", { status: 500 });
    }

    if (url.hostname === "assets.workspace-dev.local" && url.pathname.endsWith("ok.svg")) {
      return new Response("<svg></svg>", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await exportImageAssetsFromFigma({
    fileKey: "demo-key",
    accessToken: "token",
    ir: createIrWithImages(),
    generatedProjectDir: projectDir,
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 1,
    onLog: (message) => logs.push(message)
  });

  assert.equal(result.candidateCount, 3);
  assert.equal(result.exportedCount, 1);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(Object.keys(result.imageAssetMap), ["img:svg:2"]);
  assert.ok(logs.some((entry) => entry.includes("warning")));
});

test("exportImageAssetsFromFigma skips network calls when there are no image candidates", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-image-export-none-"));
  let fetchCalls = 0;
  const irWithoutImages: DesignIR = {
    ...createIrWithImages(),
    screens: [
      {
        id: "screen-no-images",
        name: "No images",
        layoutMode: "NONE",
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "text-only",
            name: "Title",
            nodeType: "TEXT",
            type: "text",
            text: "Hello"
          }
        ]
      }
    ]
  };

  const fetchImpl: typeof fetch = (async () => {
    fetchCalls += 1;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  const result = await exportImageAssetsFromFigma({
    fileKey: "demo-key",
    accessToken: "token",
    ir: irWithoutImages,
    generatedProjectDir: projectDir,
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 1,
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.candidateCount, 0);
  assert.equal(result.exportedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(fetchCalls, 0);
});

test("exportImageAssetsFromFigma batches metadata requests deterministically", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-image-export-batch-"));
  const ids = Array.from({ length: 101 }, (_, index) => `img:${index + 1}`);
  const requestSizes: number[] = [];

  const ir: DesignIR = {
    ...createIrWithImages(),
    screens: [
      {
        id: "screen-batch",
        name: "Batch",
        layoutMode: "NONE",
        gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: ids.map((id) => ({
          id,
          name: id,
          nodeType: "RECTANGLE",
          type: "image" as const,
          width: 10,
          height: 10
        }))
      }
    ]
  };

  const fetchImpl: typeof fetch = (async (input) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const url = new URL(rawUrl);
    if (url.hostname === "api.figma.com") {
      const idsParam = decodeURIComponent(url.searchParams.get("ids") ?? "");
      const requestedIds = idsParam.split(",").filter((entry) => entry.length > 0);
      requestSizes.push(requestedIds.length);
      const images = Object.fromEntries(requestedIds.map((id) => [id, `https://assets.workspace-dev.local/${id}.png`]));
      return new Response(JSON.stringify({ images }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const result = await exportImageAssetsFromFigma({
    fileKey: "demo-key",
    accessToken: "token",
    ir,
    generatedProjectDir: projectDir,
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 1,
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.candidateCount, 101);
  assert.equal(result.exportedCount, 101);
  assert.deepEqual(requestSizes, [100, 1]);
});
