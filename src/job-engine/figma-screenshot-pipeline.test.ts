import { describe, it, beforeEach, mock } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FigmaMcpScreenshotReference } from "../parity/types.js";
import {
  fetchFigmaScreenshots,
  persistFigmaScreenshotReferences,
  parseImageUrl,
} from "./figma-screenshot-pipeline.js";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const screenshot = (
  nodeId: string,
  purpose: FigmaMcpScreenshotReference["purpose"] = "quality-gate",
): FigmaMcpScreenshotReference => {
  return {
    nodeId,
    purpose,
    url: `https://api.figma.com/v1/images/test-key?ids=${encodeURIComponent(nodeId)}&format=png`,
  };
};

const jsonResponse = (body: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
};

const nodePayload = ({
  nodeId,
  width = 1280,
}: {
  nodeId: string;
  width?: number;
}): unknown => {
  return {
    nodes: {
      [nodeId]: {
        document: {
          absoluteBoundingBox: {
            width,
            height: 720,
          },
        },
      },
    },
  };
};

const imageLookupPayload = (nodeId: string): unknown => {
  return {
    images: {
      // Mirror the real Figma CDN host shape so the SSRF allowlist (Issue
      // #1681) accepts the URL. The real Figma `images` endpoint returns
      // signed URLs at `figma-alpha-api.s3.us-west-2.amazonaws.com`.
      [nodeId]: `https://figma-alpha-api.s3.us-west-2.amazonaws.com/${encodeURIComponent(nodeId)}.png`,
    },
  };
};

describe("figma-screenshot-pipeline", () => {
  describe("fetchFigmaScreenshots", () => {
    it("fetches Figma image lookup URLs before downloading PNG screenshots", async () => {
      const requestedUrls: string[] = [];
      const mockFetch = mock.fn(async (url: string) => {
        requestedUrls.push(url);
        if (url.includes("/v1/files/")) {
          return jsonResponse(
            nodePayload({ nodeId: new URL(url).searchParams.get("ids") ?? "" }),
          );
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(
            imageLookupPayload(new URL(url).searchParams.get("ids") ?? ""),
          );
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2"), screenshot("3:4")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 2);
      strictEqual(result.failedCount, 0);
      strictEqual(result.totalCount, 2);
      deepStrictEqual(result.referenceImageMap.get("1:2"), PNG_BUFFER);
      deepStrictEqual(result.referenceImageMap.get("3:4"), PNG_BUFFER);
      strictEqual(
        requestedUrls.filter((url) => url.includes("/v1/images/")).length,
        2,
      );
      strictEqual(
        requestedUrls.filter((url) =>
          url.startsWith("https://figma-alpha-api.s3.us-west-2.amazonaws.com/"),
        ).length,
        2,
      );
    });

    it("filters to only quality-gate screenshots", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          return jsonResponse(
            nodePayload({ nodeId: new URL(url).searchParams.get("ids") ?? "" }),
          );
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(
            imageLookupPayload(new URL(url).searchParams.get("ids") ?? ""),
          );
        }
        return new Response(PNG_BUFFER);
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [
          screenshot("1:2"),
          screenshot("3:4", "context"),
          screenshot("5:6"),
        ],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.totalCount, 2);
      strictEqual(result.fetchedCount, 2);
      strictEqual(mockFetch.mock.callCount(), 6);
    });

    it("handles invalid PNG downloads as failures", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId: "1:2" }));
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(imageLookupPayload("1:2"));
        }
        return new Response(Buffer.from([]), {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 0);
      strictEqual(result.failedCount, 1);
      ok(
        result.failedNodeIds.some((failure) =>
          failure.reason.includes("invalid PNG"),
        ),
      );
    });

    it("retries on retryable Figma API errors", async () => {
      let nodeRequestCount = 0;
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          nodeRequestCount += 1;
          if (nodeRequestCount < 3) {
            return new Response(null, { status: 503 });
          }
          return jsonResponse(nodePayload({ nodeId: "1:2" }));
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(imageLookupPayload("1:2"));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 3,
        },
      });

      strictEqual(nodeRequestCount, 3);
      strictEqual(result.fetchedCount, 1);
      strictEqual(result.failedCount, 0);
    });

    it("fails after max retries are exceeded", async () => {
      const mockFetch = mock.fn(
        async () => new Response(null, { status: 503 }),
      );

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      // Per #1671: geometry probe and 1× image-render run in parallel, so
      // both retry-chains exhaust independently before Promise.all settles
      // — 2 attempts × 2 endpoints = 4. The failure is still surfaced as a
      // single per-screenshot rejection.
      strictEqual(mockFetch.mock.callCount(), 4);
      strictEqual(result.fetchedCount, 0);
      strictEqual(result.failedCount, 1);
    });

    it("isolates failures per screenshot", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        const nodeId = new URL(url).searchParams.get("ids") ?? "";
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId }));
        }
        if (url.includes("/v1/images/") && nodeId === "3:4") {
          return new Response(null, { status: 404 });
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(imageLookupPayload(nodeId));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2"), screenshot("3:4")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 1);
      strictEqual(result.failedCount, 1);
      ok(result.referenceImageMap.has("1:2"));
      ok(!result.referenceImageMap.has("3:4"));
    });

    it("calculates scale from the source node width", async () => {
      let imageLookupUrl = "";
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId: "1:2", width: 1000 }));
        }
        if (url.includes("/v1/images/")) {
          imageLookupUrl = url;
          return jsonResponse(imageLookupPayload("1:2"));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 500,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(new URL(imageLookupUrl).searchParams.get("scale"), "0.5");
    });

    it("clamps scale to the Figma-supported range", async () => {
      let imageLookupUrl = "";
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId: "1:2", width: 1000 }));
        }
        if (url.includes("/v1/images/")) {
          imageLookupUrl = url;
          return jsonResponse(imageLookupPayload("1:2"));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 4000,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(new URL(imageLookupUrl).searchParams.get("scale"), "3");
    });

    it("does not retry on 4xx client errors", async () => {
      let attemptCount = 0;
      const mockFetch = mock.fn(async () => {
        attemptCount += 1;
        return new Response(null, { status: 404 });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 3,
        },
      });

      // Per #1671: geometry probe and 1× image-render run in parallel.
      // Each endpoint gets exactly one attempt because 4xx is not retried;
      // 1 × 2 endpoints = 2. The screenshot is still recorded as a single
      // failure.
      strictEqual(attemptCount, 2);
      strictEqual(result.failedCount, 1);
    });

    it("retries transport errors without leaking the access token in logs", async () => {
      const logs: string[] = [];
      let nodeRequestCount = 0;
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("/v1/files/")) {
          nodeRequestCount += 1;
          if (nodeRequestCount === 1) {
            throw new Error("socket reset for secret-token");
          }
          return jsonResponse(nodePayload({ nodeId: "1:2" }));
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(imageLookupPayload("1:2"));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "secret-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
          onLog: (message) => logs.push(message),
        },
      });

      strictEqual(nodeRequestCount, 2);
      strictEqual(result.fetchedCount, 1);
      ok(logs.some((log) => log.includes("transport error")));
      ok(logs.every((log) => !log.includes("secret-token")));
    });

    it("redacts access tokens from failed-node reasons and failure logs", async () => {
      const logs: string[] = [];
      const mockFetch = mock.fn(async () => {
        throw new Error("download failed for secret-token");
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "secret-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 0,
          onLog: (message) => logs.push(message),
        },
      });

      strictEqual(result.failedCount, 1);
      ok(result.failedNodeIds[0]?.reason.includes("[REDACTED]"));
      ok(
        result.failedNodeIds.every(
          (failure) => !failure.reason.includes("secret-token"),
        ),
      );
      ok(logs.every((log) => !log.includes("secret-token")));
    });

    it("runs the geometry probe and the image-render request in parallel per node (#1671)", async () => {
      // Regression guard for #1671: the per-node chain used to be
      // sequential (geometry → imageUrl → png). The geometry probe and a
      // 1× image-render are independent given fileKey + nodeId, so they
      // must overlap in time. We assert this by tracking the number of
      // simultaneously-in-flight first-stage requests across both
      // endpoints — it must reach 2 for at least one moment per node.
      let activeStage1 = 0;
      let maxConcurrentStage1 = 0;
      const mockFetch = mock.fn(async (url: string) => {
        const nodeId = new URL(url).searchParams.get("ids") ?? "";
        if (url.includes("/v1/files/") || url.includes("/v1/images/")) {
          activeStage1 += 1;
          maxConcurrentStage1 = Math.max(maxConcurrentStage1, activeStage1);
          await new Promise((resolve) => setTimeout(resolve, 15));
          activeStage1 -= 1;
          if (url.includes("/v1/files/")) {
            return jsonResponse(nodePayload({ nodeId }));
          }
          return jsonResponse(imageLookupPayload(nodeId));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 1);
      ok(
        maxConcurrentStage1 >= 2,
        `expected geometry+image to overlap, observed max concurrency ${String(maxConcurrentStage1)}`,
      );
    });

    it("reuses the parallel 1× image-render when the resolved scale is exactly 1 (#1671)", async () => {
      // When sourceWidth equals desiredWidth, scale == 1 and the
      // tentative parallel image-render is reusable. Result: 2 round-trips
      // per node (geometry + image) plus the PNG download = 3 mockFetch
      // calls — never 4 (which would mean we re-rendered unnecessarily).
      let imageLookupCount = 0;
      const mockFetch = mock.fn(async (url: string) => {
        const nodeId = new URL(url).searchParams.get("ids") ?? "";
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId, width: 1280 }));
        }
        if (url.includes("/v1/images/")) {
          imageLookupCount += 1;
          return jsonResponse(imageLookupPayload(nodeId));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 1);
      strictEqual(
        imageLookupCount,
        1,
        "scale=1 path must not re-issue an image-render",
      );
      strictEqual(mockFetch.mock.callCount(), 3);
    });

    it("re-issues the image-render when the resolved scale differs from 1 (#1671)", async () => {
      // Behaviour-preserving guard: when sourceWidth ≠ desiredWidth, the
      // pipeline must end with a PNG fetched via the *corrected*-scale
      // imageUrl, not the tentative 1× one. We capture the URL handed to
      // the PNG download and assert its `scale` query parameter.
      let pngFetchedFromUrl = "";
      const mockFetch = mock.fn(async (url: string) => {
        const nodeId = new URL(url).searchParams.get("ids") ?? "";
        if (url.includes("/v1/files/")) {
          return jsonResponse(nodePayload({ nodeId, width: 2560 }));
        }
        if (url.includes("/v1/images/")) {
          // Echo the requested scale into the returned signed URL so we
          // can verify which lookup the PNG download came from.
          const scale = new URL(url).searchParams.get("scale") ?? "1";
          return jsonResponse({
            images: {
              [nodeId]: `https://figma-alpha-api.s3.us-west-2.amazonaws.com/${encodeURIComponent(nodeId)}-scale-${scale}.png`,
            },
          });
        }
        pngFetchedFromUrl = url;
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      const result = await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 1);
      ok(
        pngFetchedFromUrl.includes("scale-0.5"),
        `expected PNG download URL to come from the scale=0.5 image-render, got: ${pngFetchedFromUrl}`,
      );
      ok(
        !pngFetchedFromUrl.includes("scale-1.png"),
        "must not download the tentative 1× render when scale ≠ 1",
      );
    });

    it("fetches screenshot references concurrently", async () => {
      let activeNodeRequests = 0;
      let maxConcurrentNodeRequests = 0;
      const mockFetch = mock.fn(async (url: string) => {
        const nodeId = new URL(url).searchParams.get("ids") ?? "";
        if (url.includes("/v1/files/")) {
          activeNodeRequests += 1;
          maxConcurrentNodeRequests = Math.max(
            maxConcurrentNodeRequests,
            activeNodeRequests,
          );
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeNodeRequests -= 1;
          return jsonResponse(nodePayload({ nodeId }));
        }
        if (url.includes("/v1/images/")) {
          return jsonResponse(imageLookupPayload(nodeId));
        }
        return new Response(PNG_BUFFER, {
          headers: { "content-type": "image/png" },
        });
      });

      await fetchFigmaScreenshots({
        screenshots: [screenshot("1:2"), screenshot("3:4"), screenshot("5:6")],
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      ok(maxConcurrentNodeRequests > 1);
    });
  });

  describe("persistFigmaScreenshotReferences", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = join(tmpdir(), `test-screenshots-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
    });

    it("persists images to disk with deterministic safe filenames", async () => {
      const referenceImageMap = new Map([
        ["1:2", PNG_BUFFER],
        ["5:6", PNG_BUFFER],
      ]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
      });

      strictEqual(result.size, 2);
      ok(result.has("1:2"));
      ok(result.has("5:6"));
      ok(/reference-1_2-[a-f0-9]{8}\.png$/.test(result.get("1:2") ?? ""));
      ok(/reference-5_6-[a-f0-9]{8}\.png$/.test(result.get("5:6") ?? ""));
      deepStrictEqual(await readFile(result.get("1:2") ?? ""), PNG_BUFFER);
    });

    it("creates output directory if it does not exist", async () => {
      const nestedDir = join(tmpDir, "nested", "dir");
      const referenceImageMap = new Map([["1:2", PNG_BUFFER]]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: nestedDir,
      });

      strictEqual(result.size, 1);
      ok(result.has("1:2"));
    });

    it("sanitizes path-unsafe node IDs in filenames", async () => {
      const referenceImageMap = new Map([["node/with:chars", PNG_BUFFER]]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
      });

      const filePath = result.get("node/with:chars") ?? "";
      ok(/reference-node_with_chars-[a-f0-9]{8}\.png$/.test(filePath));
    });

    it("logs operations when onLog is provided", async () => {
      const logs: string[] = [];
      const referenceImageMap = new Map([["1:2", PNG_BUFFER]]);

      await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
        onLog: (msg) => logs.push(msg),
      });

      ok(logs.some((log) => log.includes("Persisted reference image")));
    });
  });

  describe("parseImageUrl", () => {
    it("parses valid Figma image URLs", () => {
      const url =
        "https://api.figma.com/v1/images/abc123?ids=1%3A2&format=png&scale=1";
      const result = parseImageUrl(url);

      ok(result !== null);
      strictEqual(result.fileKey, "abc123");
      strictEqual(result.nodeId, "1:2");
    });

    it("decodes URL-encoded fileKey", () => {
      const url =
        "https://api.figma.com/v1/images/abc%20123?ids=1%3A2&format=png&scale=1";
      const result = parseImageUrl(url);

      ok(result !== null);
      strictEqual(result.fileKey, "abc 123");
    });

    it("returns null for invalid URLs", () => {
      const result = parseImageUrl("not-a-url");
      strictEqual(result, null);
    });

    it("returns null when fileKey is missing", () => {
      const url = "https://api.figma.com/v1/images/?ids=1%3A2";
      const result = parseImageUrl(url);
      strictEqual(result, null);
    });

    it("returns null when nodeId is missing", () => {
      const url = "https://api.figma.com/v1/images/abc123?format=png";
      const result = parseImageUrl(url);
      strictEqual(result, null);
    });
  });
});
