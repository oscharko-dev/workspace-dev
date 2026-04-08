import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_VIEWPORT,
  captureScreenshot,
  captureFromProject,
  resolveCaptureConfig,
  waitWithTimeout,
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

test("resolveCaptureConfig rejects invalid capture settings", () => {
  assert.throws(
    () =>
      resolveCaptureConfig({
        viewport: { width: 0, height: 1080, deviceScaleFactor: 1 },
      }),
    /viewport\.width/,
  );

  assert.throws(
    () =>
      resolveCaptureConfig({
        viewport: { width: 1920, height: -1, deviceScaleFactor: 1 },
      }),
    /viewport\.height/,
  );

  assert.throws(
    () =>
      resolveCaptureConfig({
        viewport: { width: 1920, height: 1080, deviceScaleFactor: 0 },
      }),
    /viewport\.deviceScaleFactor/,
  );

  assert.throws(
    () =>
      resolveCaptureConfig({
        timeoutMs: 0,
      }),
    /timeoutMs/,
  );
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

test("waitWithTimeout clears the timeout handle after the wrapped promise settles", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let clearTimeoutCalls = 0;
  let unrefCalls = 0;

  const timeoutHandle = {
    unref: () => {
      unrefCalls += 1;
      return timeoutHandle;
    },
  } as unknown as ReturnType<typeof setTimeout>;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
    void handler;
    void timeout;
    return timeoutHandle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    void handle;
    clearTimeoutCalls += 1;
  }) as typeof clearTimeout;

  try {
    const result = await waitWithTimeout({
      promise: Promise.resolve("done"),
      timeoutMs: 50,
    });

    assert.deepEqual(result, { status: "settled", value: "done" });
    assert.equal(unrefCalls, 1);
    assert.equal(clearTimeoutCalls, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

const createTempProject = async (files: Record<string, string | Buffer>): Promise<string> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-capture-"));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const absolutePath = path.join(projectDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }),
  );
  return projectDir;
};

test("captureFromProject serves query-string assets correctly", async () => {
  const projectDir = await createTempProject({
    "index.html": `<!doctype html>
<html>
  <body style="margin: 0">
    <script src="/main.js?v=123"></script>
  </body>
</html>
`,
    "main.js": `
      const banner = document.createElement("div");
      banner.textContent = "query-string asset loaded";
      banner.style.height = "1600px";
      banner.style.background = "rgb(31, 41, 55)";
      banner.style.color = "white";
      document.body.appendChild(banner);
    `,
  });

  try {
    const result = await captureFromProject({ projectDir });
    assert.ok(
      result.height > 1400,
      `Expected query-string asset to load and expand the page, got height ${String(result.height)}`,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("captureFromProject serves built asset MIME types correctly", async () => {
  const projectDir = await createTempProject({
    "index.html": `<!doctype html>
<html>
  <body style="margin: 0">
    <script src="/main.js"></script>
  </body>
</html>
`,
    "main.js": `
      (async () => {
        const checks = [
          ["/fonts/inter.woff2", "font/woff2"],
          ["/images/hero.webp", "image/webp"],
          ["/images/logo.avif", "image/avif"],
          ["/assets/source.map", "application/json; charset=utf-8"]
        ];

        const results = await Promise.all(checks.map(async ([url, expected]) => {
          const response = await fetch(url);
          return response.headers.get("content-type") === expected;
        }));

        if (results.every(Boolean)) {
          const banner = document.createElement("div");
          banner.textContent = "mime assets loaded";
          banner.style.height = "1600px";
          banner.style.background = "rgb(15, 23, 42)";
          banner.style.color = "white";
          document.body.appendChild(banner);
        }
      })();
    `,
    "fonts/inter.woff2": Buffer.from("fake-font"),
    "images/hero.webp": Buffer.from("fake-webp"),
    "images/logo.avif": Buffer.from("fake-avif"),
    "assets/source.map": Buffer.from("{}\n"),
  });

  try {
    const result = await captureFromProject({ projectDir });
    assert.ok(
      result.height > 1400,
      `Expected MIME-typed assets to load and expand the page, got height ${String(result.height)}`,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("captureScreenshot fails fast on invalid capture configuration", async () => {
  await assert.rejects(
    () =>
      captureScreenshot({
        url: "http://127.0.0.1:1",
        config: {
          viewport: { width: 0, height: 720, deviceScaleFactor: 1 },
        },
      }),
    /viewport\.width/,
  );
});
