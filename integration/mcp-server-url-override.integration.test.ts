import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultFigmaMcpEnrichmentLoader } from "../src/job-engine/figma-hybrid-enrichment.js";

/**
 * Verifies the `WORKSPACE_DEV_MCP_SERVER_URL` env override wired into
 * `figma-hybrid-enrichment.ts`. The override exists so Playwright (and node
 * integration tests) can point the runtime resolver at the in-process MCP
 * mock server without changing `DEFAULT_MCP_SERVER_URL` in production code.
 */

const ENV_KEY = "WORKSPACE_DEV_MCP_SERVER_URL";
const INSECURE_ENV = "WORKSPACE_ALLOW_INSECURE_MCP";

const withEnv = async (
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> => {
  const previous = Object.entries(overrides).map(
    ([key]) => [key, process.env[key]] as const,
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const makeRecordingFetch = (): {
  fetch: typeof fetch;
  urls: string[];
} => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    urls.push(url);
    return new Response(
      JSON.stringify({ error: { message: "halt", code: 500 } }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch: fetchImpl, urls };
};

const parseRecordedUrls = (urls: string[]): URL[] => urls.map((url) => new URL(url));

test("WORKSPACE_DEV_MCP_SERVER_URL override routes MCP traffic through the mock URL", async () => {
  const overrideUrl = "http://127.0.0.1:54321/mcp";
  await withEnv(
    {
      [ENV_KEY]: overrideUrl,
      [INSECURE_ENV]: "true",
    },
    async () => {
      const rest = makeRecordingFetch();
      const mcp = makeRecordingFetch();
      const loader = createDefaultFigmaMcpEnrichmentLoader({
        timeoutMs: 250,
        maxRetries: 1,
        maxScreenCandidates: 1,
      });
      try {
        await loader({
          figmaFileKey: "fk",
          rawFile: {
            document: {
              id: "0:1",
              type: "DOCUMENT",
              name: "root",
              children: [
                { id: "1:2", type: "FRAME", name: "primary", children: [] },
              ],
            },
          },
          figmaRestFetch: rest.fetch,
          figmaMcpFetch: mcp.fetch,
        });
      } catch {
        // loader is allowed to fail once REST + MCP error out
      }

      assert.ok(
        parseRecordedUrls(mcp.urls).some((u) => u.href === overrideUrl),
        `expected mock URL in MCP fetches, got: ${mcp.urls.join(", ")}`,
      );
      assert.ok(
        parseRecordedUrls(mcp.urls).every((u) => u.href === overrideUrl),
        `expected only the configured override URL under override, got: ${mcp.urls.join(", ")}`,
      );
    },
  );
});

test("unset WORKSPACE_DEV_MCP_SERVER_URL keeps production MCP URL", async () => {
  await withEnv(
    { [ENV_KEY]: undefined, [INSECURE_ENV]: undefined },
    async () => {
      const rest = makeRecordingFetch();
      const mcp = makeRecordingFetch();
      const loader = createDefaultFigmaMcpEnrichmentLoader({
        timeoutMs: 250,
        maxRetries: 1,
        maxScreenCandidates: 1,
      });
      try {
        await loader({
          figmaFileKey: "fk",
          rawFile: {
            document: {
              id: "0:1",
              type: "DOCUMENT",
              name: "root",
              children: [
                { id: "1:2", type: "FRAME", name: "primary", children: [] },
              ],
            },
          },
          figmaRestFetch: rest.fetch,
          figmaMcpFetch: mcp.fetch,
        });
      } catch {
        // intentionally ignored
      }

      assert.ok(
        parseRecordedUrls(mcp.urls).every((u) => u.hostname !== "127.0.0.1"),
        `expected no override URL, got: ${mcp.urls.join(", ")}`,
      );
    },
  );
});

test("malformed WORKSPACE_DEV_MCP_SERVER_URL falls back to production MCP URL", async () => {
  await withEnv(
    {
      [ENV_KEY]: "://not-a-url",
      [INSECURE_ENV]: "true",
    },
    async () => {
      const rest = makeRecordingFetch();
      const mcp = makeRecordingFetch();
      const loader = createDefaultFigmaMcpEnrichmentLoader({
        timeoutMs: 250,
        maxRetries: 1,
        maxScreenCandidates: 1,
      });
      try {
        await loader({
          figmaFileKey: "fk",
          rawFile: {
            document: {
              id: "0:1",
              type: "DOCUMENT",
              name: "root",
              children: [
                { id: "1:2", type: "FRAME", name: "primary", children: [] },
              ],
            },
          },
          figmaRestFetch: rest.fetch,
          figmaMcpFetch: mcp.fetch,
        });
      } catch {
        // intentionally ignored
      }

      assert.ok(
        parseRecordedUrls(mcp.urls).every(
          (u) => u.origin === "https://mcp.figma.com" && u.pathname === "/mcp",
        ),
        `expected malformed override to fall back to production MCP URL, got: ${mcp.urls.join(", ")}`,
      );
    },
  );
});
