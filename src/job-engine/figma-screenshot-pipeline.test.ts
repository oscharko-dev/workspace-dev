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
      [nodeId]: `https://cdn.example.test/${encodeURIComponent(nodeId)}.png`,
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
          url.startsWith("https://cdn.example.test/"),
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

      strictEqual(mockFetch.mock.callCount(), 2);
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

      strictEqual(attemptCount, 1);
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

    it("does not retry on 4xx client errors", async () => {
      let attemptCount = 0;
      const mockFetch = mock.fn(async () => {
        attemptCount += 1;
        return new Response(null, { status: 404 });
      });

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
      ];

      const result = await fetchFigmaScreenshots({
        screenshots,
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 3,
        },
      });

      strictEqual(attemptCount, 1);
      strictEqual(result.failedCount, 1);
    });

    it("fetches screenshots concurrently", async () => {
      let activeRequests = 0;
      let maxConcurrent = 0;
      const mockFetch = mock.fn(async () => {
        activeRequests += 1;
        maxConcurrent = Math.max(maxConcurrent, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests -= 1;
        return new Response(Buffer.from([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        });
      });

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
        { nodeId: "3:4", purpose: "quality-gate" },
        { nodeId: "5:6", purpose: "quality-gate" },
      ];

      await fetchFigmaScreenshots({
        screenshots,
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 1280,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      ok(maxConcurrent > 1);
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
