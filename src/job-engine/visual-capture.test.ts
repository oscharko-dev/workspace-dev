import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { chromium } from "@playwright/test";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_VIEWPORT,
  REDUCED_MOTION_STYLE,
  captureScreenshot,
  captureFromProject,
  resolveCaptureContextOptions,
  resolveCaptureContextOptionsForBrowser,
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
  assert.deepEqual(config.stabilizeBeforeCapture, {
    enabled: false,
    maxAttempts: 5,
    intervalMs: 100,
    requireConsecutiveMatches: 2,
  });
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
  assert.deepEqual(config.stabilizeBeforeCapture, {
    enabled: false,
    maxAttempts: 5,
    intervalMs: 100,
    requireConsecutiveMatches: 2,
  });
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
    stabilizeBeforeCapture: {
      enabled: true,
      maxAttempts: 8,
      intervalMs: 50,
      requireConsecutiveMatches: 3,
    },
    timeoutMs: 5_000,
    fullPage: false,
  });

  assert.equal(config.viewport.width, 1920);
  assert.equal(config.viewport.height, 1080);
  assert.equal(config.viewport.deviceScaleFactor, 2);
  assert.equal(config.waitForNetworkIdle, false);
  assert.equal(config.waitForFonts, false);
  assert.equal(config.waitForAnimations, false);
  assert.deepEqual(config.stabilizeBeforeCapture, {
    enabled: true,
    maxAttempts: 8,
    intervalMs: 50,
    requireConsecutiveMatches: 3,
  });
  assert.equal(config.timeoutMs, 5_000);
  assert.equal(config.fullPage, false);
});

test("resolveCaptureContextOptions applies mobile device semantics for benchmark mobile viewport", () => {
  const config = resolveCaptureConfig({
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
    },
  });

  const contextOptions = resolveCaptureContextOptions(config);

  assert.equal(contextOptions.viewport.width, 390);
  assert.equal(contextOptions.viewport.height, 844);
  assert.equal(contextOptions.deviceScaleFactor, 3);
  assert.deepEqual(contextOptions.screen, {
    width: 390,
    height: 844,
  });
  assert.equal(contextOptions.isMobile, true);
  assert.equal(contextOptions.hasTouch, true);
  assert.match(contextOptions.userAgent ?? "", /Pixel 7/i);
});

test("resolveCaptureContextOptionsForBrowser strips unsupported Firefox isMobile while preserving mobile viewport semantics", () => {
  const config = resolveCaptureConfig({
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
    },
  });

  const contextOptions = resolveCaptureContextOptionsForBrowser(
    config,
    "firefox",
  );

  assert.equal(contextOptions.viewport.width, 390);
  assert.equal(contextOptions.viewport.height, 844);
  assert.equal(contextOptions.deviceScaleFactor, 3);
  assert.deepEqual(contextOptions.screen, {
    width: 390,
    height: 844,
  });
  assert.equal(contextOptions.isMobile, undefined);
  assert.equal(contextOptions.hasTouch, true);
  assert.match(contextOptions.userAgent ?? "", /Pixel 7/i);
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

  assert.throws(
    () =>
      resolveCaptureConfig({
        stabilizeBeforeCapture: {
          enabled: true,
          maxAttempts: 1,
          intervalMs: 10,
          requireConsecutiveMatches: 2,
        },
      }),
    /requireConsecutiveMatches/,
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
  assert.deepEqual(DEFAULT_CAPTURE_CONFIG.stabilizeBeforeCapture, {
    enabled: false,
    maxAttempts: 5,
    intervalMs: 100,
    requireConsecutiveMatches: 2,
  });
  assert.equal(DEFAULT_CAPTURE_CONFIG.timeoutMs, 30_000);
  assert.equal(DEFAULT_CAPTURE_CONFIG.fullPage, true);
});

const startTestServer = (
  html: string,
): Promise<{ server: Server; port: number }> => {
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

let chromiumAvailabilityPromise:
  | Promise<{ available: true } | { available: false; reason: string }>
  | undefined;

const getChromiumAvailability = async (): Promise<
  { available: true } | { available: false; reason: string }
> => {
  chromiumAvailabilityPromise ??= (async () => {
    const executablePath = chromium.executablePath();
    try {
      await access(executablePath, fsConstants.X_OK);
      return { available: true } as const;
    } catch {
      return {
        available: false,
        reason: `Chromium executable is unavailable at '${executablePath}'.`,
      } as const;
    }
  })();

  return await chromiumAvailabilityPromise;
};

const skipIfChromiumUnavailable = async (
  context: TestContext,
): Promise<void> => {
  const availability = await getChromiumAvailability();
  if (!availability.available) {
    context.skip(availability.reason);
  }
};

test("captureScreenshot captures a page served by a local HTTP server", async (context) => {
  await skipIfChromiumUnavailable(context);
  const { server, port } = await startTestServer(
    "<html><body><h1>Test</h1></body></html>",
  );

  try {
    const result = await captureScreenshot({
      url: `http://127.0.0.1:${port}`,
    });

    assert.ok(
      result.screenshotBuffer.length > 0,
      "Screenshot buffer should not be empty",
    );

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

test("captureScreenshot respects viewport configuration", async (context) => {
  await skipIfChromiumUnavailable(context);
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

    assert.ok(
      result.screenshotBuffer.length > 0,
      "Screenshot buffer should not be empty",
    );
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

const createTempProject = async (
  files: Record<string, string | Buffer>,
): Promise<string> => {
  const projectDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-capture-"),
  );
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const absolutePath = path.join(projectDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }),
  );
  return projectDir;
};

test("captureFromProject serves query-string assets correctly", async (context) => {
  await skipIfChromiumUnavailable(context);
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

test("captureFromProject serves built asset MIME types correctly", async (context) => {
  await skipIfChromiumUnavailable(context);
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

test("REDUCED_MOTION_STYLE neutralizes animations and transitions", () => {
  assert.match(REDUCED_MOTION_STYLE, /animation-duration:\s*0ms/);
  assert.match(REDUCED_MOTION_STYLE, /animation-delay:\s*0ms/);
  assert.match(REDUCED_MOTION_STYLE, /transition-duration:\s*0ms/);
  assert.match(REDUCED_MOTION_STYLE, /transition-delay:\s*0ms/);
  assert.match(REDUCED_MOTION_STYLE, /scroll-behavior:\s*auto/);
  assert.match(REDUCED_MOTION_STYLE, /caret-color:\s*transparent/);
});

test("captureScreenshot produces byte-identical screenshots across runs of an animated page", async (context) => {
  await skipIfChromiumUnavailable(context);
  const { server, port } = await startTestServer(
    `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; background: #fff; }
      @keyframes pulse {
        from { transform: translateX(0px); opacity: 0.2; }
        to { transform: translateX(120px); opacity: 1; }
      }
      .animated {
        width: 80px;
        height: 80px;
        background: rgb(220, 38, 38);
        animation: pulse 1s infinite alternate;
        transition: background-color 2s linear;
      }
      input { caret-color: rgb(0, 0, 0); }
    </style>
  </head>
  <body>
    <div class="animated"></div>
    <input value="x" />
  </body>
</html>`,
  );

  try {
    const first = await captureScreenshot({
      url: `http://127.0.0.1:${port}`,
      config: {
        viewport: { width: 320, height: 200 },
        fullPage: false,
        waitForNetworkIdle: false,
      },
    });
    const second = await captureScreenshot({
      url: `http://127.0.0.1:${port}`,
      config: {
        viewport: { width: 320, height: 200 },
        fullPage: false,
        waitForNetworkIdle: false,
      },
    });

    assert.equal(
      Buffer.compare(first.screenshotBuffer, second.screenshotBuffer),
      0,
      "Two captures of the same animated page should be byte-identical when reduced-motion CSS is applied",
    );
  } finally {
    await closeServer(server);
  }
});
