import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_VIEWPORT,
  captureScreenshot,
  resolveCaptureConfig,
} from "./visual-capture.js";

test("resolveCaptureConfig returns defaults when no config provided", () => {
  const config = resolveCaptureConfig();

  assert.deepEqual(config.viewport, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  });
  assert.equal(config.waitForNetworkIdle, true);
  assert.equal(config.waitForFonts, true);
  assert.equal(config.waitForAnimations, true);
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.fullPage, true);
});

test("resolveCaptureConfig merges partial viewport config", () => {
  const config = resolveCaptureConfig({ viewport: { width: 800 } });

  assert.equal(config.viewport.width, 800);
  assert.equal(config.viewport.height, 720);
  assert.equal(config.viewport.deviceScaleFactor, 1);
});

test("resolveCaptureConfig merges partial capture config", () => {
  const config = resolveCaptureConfig({ timeoutMs: 10_000 });

  assert.equal(config.timeoutMs, 10_000);
  assert.equal(config.waitForNetworkIdle, true);
  assert.equal(config.waitForFonts, true);
  assert.equal(config.waitForAnimations, true);
  assert.equal(config.fullPage, true);
  assert.deepEqual(config.viewport, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  });
});

test("resolveCaptureConfig handles full override", () => {
  const config = resolveCaptureConfig({
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    waitForNetworkIdle: false,
    waitForFonts: false,
    waitForAnimations: false,
    timeoutMs: 5_000,
    fullPage: false,
  });

  assert.equal(config.viewport.width, 1920);
  assert.equal(config.viewport.height, 1080);
  assert.equal(config.viewport.deviceScaleFactor, 2);
  assert.equal(config.waitForNetworkIdle, false);
  assert.equal(config.waitForFonts, false);
  assert.equal(config.waitForAnimations, false);
  assert.equal(config.timeoutMs, 5_000);
  assert.equal(config.fullPage, false);
});

test("DEFAULT_VIEWPORT has expected values", () => {
  assert.equal(DEFAULT_VIEWPORT.width, 1280);
  assert.equal(DEFAULT_VIEWPORT.height, 720);
  assert.equal(DEFAULT_VIEWPORT.deviceScaleFactor, 1);
});

test("DEFAULT_CAPTURE_CONFIG has expected values", () => {
  assert.deepEqual(DEFAULT_CAPTURE_CONFIG.viewport, {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  });
  assert.equal(DEFAULT_CAPTURE_CONFIG.waitForNetworkIdle, true);
  assert.equal(DEFAULT_CAPTURE_CONFIG.waitForFonts, true);
  assert.equal(DEFAULT_CAPTURE_CONFIG.waitForAnimations, true);
  assert.equal(DEFAULT_CAPTURE_CONFIG.timeoutMs, 30_000);
  assert.equal(DEFAULT_CAPTURE_CONFIG.fullPage, true);
});

const startTestServer = (html: string): Promise<{ server: Server; port: number }> => {
  return new Promise<{ server: Server; port: number }>((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
};

const closeServer = (server: Server): Promise<void> => {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
};

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

test("captureScreenshot captures a page served by a local HTTP server", async () => {
  const { server, port } = await startTestServer(
    "<html><body><h1>Test</h1></body></html>",
  );

  try {
    const result = await captureScreenshot({
      url: `http://127.0.0.1:${port}`,
    });

    assert.ok(result.screenshotBuffer.length > 0, "Screenshot buffer should not be empty");

    for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
      const expected = PNG_MAGIC_BYTES[i];
      assert.equal(
        result.screenshotBuffer[i],
        expected,
        `PNG magic byte at index ${i} should be ${String(expected)}`,
      );
    }

    assert.ok(result.width > 0, "Width should be positive");
    assert.ok(result.height > 0, "Height should be positive");

    assert.equal(result.viewport.width, DEFAULT_VIEWPORT.width);
    assert.equal(result.viewport.height, DEFAULT_VIEWPORT.height);
    assert.equal(
      result.viewport.deviceScaleFactor,
      DEFAULT_VIEWPORT.deviceScaleFactor,
    );
  } finally {
    await closeServer(server);
  }
});

test("captureScreenshot respects viewport configuration", async () => {
  const { server, port } = await startTestServer(
    "<html><body><h1>Custom Viewport</h1></body></html>",
  );

  try {
    const result = await captureScreenshot({
      url: `http://127.0.0.1:${port}`,
      config: {
        viewport: { width: 800, height: 600 },
        fullPage: false,
      },
    });

    assert.equal(result.viewport.width, 800);
    assert.equal(result.viewport.height, 600);
    assert.equal(
      result.viewport.deviceScaleFactor,
      DEFAULT_VIEWPORT.deviceScaleFactor,
    );

    assert.ok(result.screenshotBuffer.length > 0, "Screenshot buffer should not be empty");
    assert.ok(result.width > 0, "Width should be positive");
    assert.ok(result.height > 0, "Height should be positive");
  } finally {
    await closeServer(server);
  }
});
