import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile } from "node:fs/promises";
import path, { extname } from "node:path";

export interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface CaptureConfig {
  viewport: ViewportConfig;
  waitForNetworkIdle: boolean;
  waitForFonts: boolean;
  waitForAnimations: boolean;
  timeoutMs: number;
  fullPage: boolean;
}

export interface CaptureResult {
  screenshotBuffer: Buffer;
  width: number;
  height: number;
  viewport: ViewportConfig;
}

export const DEFAULT_VIEWPORT: ViewportConfig = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
};

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  viewport: { ...DEFAULT_VIEWPORT },
  waitForNetworkIdle: true,
  waitForFonts: true,
  waitForAnimations: true,
  timeoutMs: 30_000,
  fullPage: true,
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const assertPositiveNumber = ({
  value,
  fieldName,
}: {
  value: unknown;
  fieldName: string;
}): number => {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new Error(`${fieldName} must be a finite number greater than 0.`);
  }
  return value;
};

const assertPositiveInteger = ({
  value,
  fieldName,
}: {
  value: unknown;
  fieldName: string;
}): number => {
  const positiveNumber = assertPositiveNumber({ value, fieldName });
  if (!Number.isInteger(positiveNumber)) {
    throw new Error(`${fieldName} must be an integer greater than 0.`);
  }
  return positiveNumber;
};

export const resolveCaptureConfig = (
  partial?: Partial<CaptureConfig & { viewport?: Partial<ViewportConfig> }>,
): CaptureConfig => {
  if (!partial) {
    return { ...DEFAULT_CAPTURE_CONFIG, viewport: { ...DEFAULT_VIEWPORT } };
  }

  const viewport: ViewportConfig = {
    width: assertPositiveInteger({
      value: partial.viewport?.width ?? DEFAULT_VIEWPORT.width,
      fieldName: "viewport.width",
    }),
    height: assertPositiveInteger({
      value: partial.viewport?.height ?? DEFAULT_VIEWPORT.height,
      fieldName: "viewport.height",
    }),
    deviceScaleFactor: assertPositiveNumber({
      value: partial.viewport?.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor,
      fieldName: "viewport.deviceScaleFactor",
    }),
  };

  return {
    viewport,
    waitForNetworkIdle:
      partial.waitForNetworkIdle ?? DEFAULT_CAPTURE_CONFIG.waitForNetworkIdle,
    waitForFonts:
      partial.waitForFonts ?? DEFAULT_CAPTURE_CONFIG.waitForFonts,
    waitForAnimations:
      partial.waitForAnimations ?? DEFAULT_CAPTURE_CONFIG.waitForAnimations,
    timeoutMs: assertPositiveInteger({
      value: partial.timeoutMs ?? DEFAULT_CAPTURE_CONFIG.timeoutMs,
      fieldName: "timeoutMs",
    }),
    fullPage: partial.fullPage ?? DEFAULT_CAPTURE_CONFIG.fullPage,
  };
};

const parsePngDimensions = (
  buffer: Buffer,
): { width: number; height: number } => {
  const PNG_SIGNATURE_LENGTH = 8;
  const IHDR_CHUNK_TYPE_OFFSET = 12;
  const IHDR_WIDTH_OFFSET = 16;
  const IHDR_HEIGHT_OFFSET = 20;
  const MINIMUM_IHDR_END = 24;

  if (buffer.length < MINIMUM_IHDR_END) {
    throw new Error("Buffer too small to be a valid PNG");
  }

  const signature = buffer.subarray(0, PNG_SIGNATURE_LENGTH);
  if (
    signature[0] !== 0x89 ||
    signature[1] !== 0x50 ||
    signature[2] !== 0x4e ||
    signature[3] !== 0x47
  ) {
    throw new Error("Buffer does not contain a valid PNG signature");
  }

  const chunkType = buffer.subarray(IHDR_CHUNK_TYPE_OFFSET, IHDR_WIDTH_OFFSET);
  if (
    chunkType[0] !== 0x49 ||
    chunkType[1] !== 0x48 ||
    chunkType[2] !== 0x44 ||
    chunkType[3] !== 0x52
  ) {
    throw new Error("First PNG chunk is not IHDR");
  }

  const width = buffer.readUInt32BE(IHDR_WIDTH_OFFSET);
  const height = buffer.readUInt32BE(IHDR_HEIGHT_OFFSET);

  return { width, height };
};

const getContentTypeForExtension = (filePath: string): string => {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".eot":
      return "application/vnd.ms-fontobject";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
};

const isWithinProjectRoot = ({
  candidatePath,
  projectDir,
}: {
  candidatePath: string;
  projectDir: string;
}): boolean => {
  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedCandidatePath = path.resolve(candidatePath);
  return (
    resolvedCandidatePath === resolvedProjectDir ||
    resolvedCandidatePath.startsWith(`${resolvedProjectDir}${path.sep}`)
  );
};

const resolveRequestFilePath = ({
  projectDir,
  requestUrl,
  baseUrl,
}: {
  projectDir: string;
  requestUrl: string | undefined;
  baseUrl: string;
}): string => {
  const parsedUrl = new URL(requestUrl ?? "/", baseUrl);
  let pathname: string;

  try {
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Invalid request path '${parsedUrl.pathname}': ${message}`);
  }

  const rawSegments = pathname.split("/").filter((segment) => segment.length > 0);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Refusing to serve path traversal request '${pathname}'.`);
  }

  const normalizedPathname = path.posix.normalize(pathname);
  const safePathname = normalizedPathname === "/" ? "/index.html" : normalizedPathname;
  const relativePath = safePathname.startsWith("/") ? safePathname.slice(1) : safePathname;
  const candidatePath = path.resolve(projectDir, relativePath);

  if (!isWithinProjectRoot({ candidatePath, projectDir })) {
    throw new Error(`Refusing to serve path outside project root: '${pathname}'.`);
  }

  return candidatePath;
};

export const waitWithTimeout = async <T>(input: {
  promise: Promise<T>;
  timeoutMs: number;
}): Promise<{ status: "settled"; value: T } | { status: "timeout" }> => {
  const { promise, timeoutMs } = input;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve({ status: "timeout" });
    }, timeoutMs);
    if (typeof timeoutHandle === "object" && typeof timeoutHandle.unref === "function") {
      timeoutHandle.unref();
    }
  });

  const settledPromise = promise.then(
    (value) => {
      return { status: "settled" as const, value };
    },
    (error: unknown) => {
      if (!timedOut) {
        throw error;
      }
      return { status: "timeout" as const };
    },
  );

  try {
    return await Promise.race([settledPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
};

const findFreePort = (): Promise<number> => {
  return new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to obtain a port from net server"));
        return;
      }
      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });
};

const waitForServerReady = async (
  url: string,
  timeoutMs: number,
): Promise<void> => {
  const start = Date.now();
  const POLL_INTERVAL_MS = 200;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms`,
  );
};

interface PlaywrightBrowserType {
  launch(options?: { headless?: boolean }): Promise<PlaywrightBrowser>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options?: { timeout?: number; waitUntil?: string },
  ): Promise<unknown>;
  waitForLoadState(
    state: string,
    options?: { timeout?: number },
  ): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(options?: {
    fullPage?: boolean;
    type?: string;
  }): Promise<Buffer>;
}

const loadChromium = async (): Promise<PlaywrightBrowserType> => {
  try {
    const pw = await import("@playwright/test");
    return pw.chromium as PlaywrightBrowserType;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Failed to import @playwright/test. Ensure it is installed: ${message}`,
    );
  }
};

const WAIT_FOR_FONTS_EXPRESSION = "document.fonts.ready.then(() => undefined)";

const WAIT_FOR_ANIMATIONS_EXPRESSION = [
  "new Promise(resolve => {",
  "  const allAnimations = document.getAnimations();",
  "  if (allAnimations.length === 0) { resolve(); return; }",
  "  Promise.allSettled(allAnimations.map(a => a.finished)).then(() => resolve());",
  "})",
].join("\n");

export const captureScreenshot = async (input: {
  url: string;
  config?: Partial<CaptureConfig & { viewport?: Partial<ViewportConfig> }>;
  onLog?: (message: string) => void;
}): Promise<CaptureResult> => {
  const config = resolveCaptureConfig(input.config);
  const log = input.onLog ?? (() => undefined);

  const chromium = await loadChromium();

  log("Launching headless Chromium browser");
  let browser: PlaywrightBrowser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to launch Chromium browser: ${message}`);
  }

  try {
    const context = await browser.newContext({
      viewport: {
        width: config.viewport.width,
        height: config.viewport.height,
      },
      deviceScaleFactor: config.viewport.deviceScaleFactor,
    });

    const page = await context.newPage();

    log(`Navigating to ${input.url}`);
    await page.goto(input.url, {
      timeout: config.timeoutMs,
      waitUntil: "load",
    });

    if (config.waitForNetworkIdle) {
      log("Waiting for network idle");
      await page.waitForLoadState("networkidle", {
        timeout: config.timeoutMs,
      });
    }

    if (config.waitForFonts) {
      log("Waiting for fonts to load");
      const fontsResult = await waitWithTimeout({
        promise: page.evaluate(WAIT_FOR_FONTS_EXPRESSION),
        timeoutMs: config.timeoutMs,
      });
      if (fontsResult.status === "timeout") {
        log(`Font loading did not settle within ${config.timeoutMs}ms, proceeding with capture`);
      }
    }

    if (config.waitForAnimations) {
      log("Waiting for CSS animations to finish");
      const animationsResult = await waitWithTimeout({
        promise: page.evaluate<undefined>(WAIT_FOR_ANIMATIONS_EXPRESSION),
        timeoutMs: config.timeoutMs,
      });
      if (animationsResult.status === "timeout") {
        log(`CSS animations did not settle within ${config.timeoutMs}ms, proceeding with capture`);
      }
    }

    log("Capturing screenshot");
    const screenshotBuffer = await page.screenshot({
      fullPage: config.fullPage,
      type: "png",
    });

    const pngBuffer = Buffer.from(screenshotBuffer);
    const dimensions = parsePngDimensions(pngBuffer);

    log(
      `Screenshot captured: ${dimensions.width}x${dimensions.height}`,
    );

    return {
      screenshotBuffer: pngBuffer,
      width: dimensions.width,
      height: dimensions.height,
      viewport: { ...config.viewport },
    };
  } finally {
    await browser.close();
  }
};

export const captureFromProject = async (input: {
  projectDir: string;
  config?: Partial<CaptureConfig & { viewport?: Partial<ViewportConfig> }>;
  onLog?: (message: string) => void;
}): Promise<CaptureResult> => {
  const log = input.onLog ?? (() => undefined);
  const port = await findFreePort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  log(`Starting static file server on ${baseUrl}`);

  const server = createServer((req, res) => {
    let filePath: string;
    try {
      filePath = resolveRequestFilePath({
        projectDir: input.projectDir,
        requestUrl: req.url,
        baseUrl,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      res.writeHead(403);
      res.end(message);
      return;
    }

    readFile(filePath)
      .then((content) => {
        res.writeHead(200, {
          "Content-Type": getContentTypeForExtension(filePath),
        });
        res.end(content);
      })
      .catch((error: unknown) => {
        const code =
          error instanceof Error && "code" in error
            ? (error as NodeJS.ErrnoException).code
            : undefined;
        if (code === "ENOENT") {
          res.writeHead(404);
          res.end("Not Found");
        } else {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  try {
    const SERVER_READY_TIMEOUT_MS = 10_000;

    await waitForServerReady(baseUrl, SERVER_READY_TIMEOUT_MS);
    log("Static file server is ready");

    const captureInput: {
      url: string;
      config?: Partial<CaptureConfig & { viewport?: Partial<ViewportConfig> }>;
      onLog?: (message: string) => void;
    } = { url: baseUrl };

    if (input.config !== undefined) {
      captureInput.config = input.config;
    }
    if (input.onLog !== undefined) {
      captureInput.onLog = input.onLog;
    }

    return await captureScreenshot(captureInput);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    log("Static file server stopped");
  }
};
