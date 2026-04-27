import { describe, it, beforeEach, mock } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FigmaMcpScreenshotReference } from "../parity/types.js";
import {
  fetchFigmaScreenshots,
  persistFigmaScreenshotReferences,
  parseImageUrl,
} from "./figma-screenshot-pipeline.js";

describe("figma-screenshot-pipeline", () => {
  describe("fetchFigmaScreenshots", () => {
    it("fetches and returns quality-gate screenshots", async () => {
      const mockFetch = mock.fn(async () =>
        Promise.resolve(
          new Response(Buffer.from([1, 2, 3, 4]), {
            headers: { "content-type": "image/png" },
          }),
        ),
      );

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
        { nodeId: "3:4", purpose: "quality-gate" },
      ];

      const result = await fetchFigmaScreenshots({
        screenshots,
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
      strictEqual(result.referenceImageMap.size, 2);
    });

    it("filters to only quality-gate screenshots", async () => {
      const mockFetch = mock.fn(async () =>
        Promise.resolve(
          new Response(Buffer.from([1, 2, 3, 4]), {
            headers: { "content-type": "image/png" },
          }),
        ),
      );

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
        { nodeId: "3:4", purpose: "reference" },
        { nodeId: "5:6", purpose: "quality-gate" },
      ];

      const result = await fetchFigmaScreenshots({
        screenshots,
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
      strictEqual(mockFetch.mock.callCount(), 2);
    });

    it("handles empty response buffers as failures", async () => {
      const mockFetch = mock.fn(async () =>
        Promise.resolve(
          new Response(Buffer.from([]), {
            headers: { "content-type": "image/png" },
          }),
        ),
      );

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
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 0);
      strictEqual(result.failedCount, 1);
      ok(result.failedNodeIds.some((f) => f.reason === "Empty image response"));
    });

    it("retries on 5xx errors", async () => {
      let attemptCount = 0;
      const mockFetch = mock.fn(async () => {
        attemptCount += 1;
        if (attemptCount < 3) {
          return new Response(null, { status: 503 });
        }
        return new Response(Buffer.from([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        });
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

      strictEqual(result.fetchedCount, 1);
      strictEqual(result.failedCount, 0);
    });

    it("fails after max retries exceeded", async () => {
      const mockFetch = mock.fn(async () =>
        Promise.resolve(new Response(null, { status: 503 })),
      );

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
          maxRetries: 1,
        },
      });

      strictEqual(result.fetchedCount, 0);
      strictEqual(result.failedCount, 1);
      ok(result.failedNodeIds.length > 0);
    });

    it("isolates failures per screenshot", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        if (url.includes("1%3A2")) {
          return new Response(Buffer.from([1, 2, 3, 4]), {
            headers: { "content-type": "image/png" },
          });
        }
        return new Response(null, { status: 404 });
      });

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
        { nodeId: "3:4", purpose: "quality-gate" },
      ];

      const result = await fetchFigmaScreenshots({
        screenshots,
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

    it("calculates scale correctly", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        ok(url.includes("scale=0.5"));
        return new Response(Buffer.from([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        });
      });

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
      ];

      await fetchFigmaScreenshots({
        screenshots,
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 640,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      ok(mockFetch.mock.calledWith);
    });

    it("clamps scale to [0.5, 3]", async () => {
      const mockFetch = mock.fn(async (url: string) => {
        const scale = new URL(url).searchParams.get("scale");
        strictEqual(scale, "3");
        return new Response(Buffer.from([1, 2, 3, 4]), {
          headers: { "content-type": "image/png" },
        });
      });

      const screenshots: FigmaMcpScreenshotReference[] = [
        { nodeId: "1:2", purpose: "quality-gate" },
      ];

      await fetchFigmaScreenshots({
        screenshots,
        config: {
          fileKey: "test-key",
          accessToken: "test-token",
          desiredWidth: 4000,
          fetchImpl: mockFetch,
          maxRetries: 1,
        },
      });

      ok(mockFetch.mock.calledWith);
    });
  });

  describe("persistFigmaScreenshotReferences", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = join(tmpdir(), `test-screenshots-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
    });

    it("persists images to disk with correct naming", async () => {
      const referenceImageMap = new Map([
        ["1:2", Buffer.from([1, 2, 3, 4])],
        ["5:6", Buffer.from([5, 6, 7, 8])],
      ]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
      });

      strictEqual(result.size, 2);
      ok(result.has("1:2"));
      ok(result.has("5:6"));
      ok(result.get("1:2")?.includes("reference-1-2.png"));
      ok(result.get("5:6")?.includes("reference-5-6.png"));
    });

    it("creates output directory if it doesn't exist", async () => {
      const nestedDir = join(tmpDir, "nested", "dir");
      const referenceImageMap = new Map([["1:2", Buffer.from([1, 2, 3, 4])]]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: nestedDir,
      });

      strictEqual(result.size, 1);
      ok(result.has("1:2"));
    });

    it("replaces colons with dashes in filenames", async () => {
      const referenceImageMap = new Map([
        ["123:456:789", Buffer.from([1, 2, 3, 4])],
      ]);

      const result = await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
      });

      const filePath = result.get("123:456:789");
      ok(filePath?.includes("reference-123-456-789.png"));
    });

    it("logs operations when onLog provided", async () => {
      const logs: string[] = [];
      const referenceImageMap = new Map([["1:2", Buffer.from([1, 2, 3, 4])]]);

      await persistFigmaScreenshotReferences({
        referenceImageMap,
        outputDirectory: tmpDir,
        onLog: (msg) => logs.push(msg),
      });

      ok(logs.some((l) => l.includes("Persisted reference image")));
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
