import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FIGMA_PAYLOAD_SCHEMA_VERSION,
  TestIntelligenceFigmaExportOperatorError,
  parseFigmaExportArgs,
  runFigmaExport,
  runFigmaExportCli,
} from "./test-intelligence-figma-export-cli.js";

test("parseFigmaExportArgs requires --figma-url, --output, and a token", () => {
  assert.throws(
    () => parseFigmaExportArgs([], {}),
    /--figma-url is required/u,
  );
  assert.throws(
    () =>
      parseFigmaExportArgs(
        ["--figma-url", "https://figma.com/design/abc"],
        {},
      ),
    /--output is required/u,
  );
  assert.throws(
    () =>
      parseFigmaExportArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/out.json",
        ],
        {},
      ),
    /token/u,
  );
});

test("parseFigmaExportArgs takes the token from FIGMA_ACCESS_TOKEN env var", () => {
  const parsed = parseFigmaExportArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc/title",
      "--output",
      "/tmp/out.json",
    ],
    { FIGMA_ACCESS_TOKEN: "from-env" },
  );
  assert.equal(parsed.figmaToken, "from-env");
  assert.equal(parsed.figmaUrl, "https://figma.com/design/abc/title");
});

test("parseFigmaExportArgs prefers --figma-token over the env var", () => {
  const parsed = parseFigmaExportArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/out.json",
      "--figma-token",
      "from-flag",
    ],
    { FIGMA_ACCESS_TOKEN: "from-env" },
  );
  assert.equal(parsed.figmaToken, "from-flag");
});

test("parseFigmaExportArgs rejects unknown flags and HELP sentinel", () => {
  assert.throws(
    () => parseFigmaExportArgs(["--unknown"], {}),
    /Unknown flag/u,
  );
  assert.throws(
    () => parseFigmaExportArgs(["--help"], {}),
    (err) =>
      err instanceof TestIntelligenceFigmaExportOperatorError &&
      err.message === "__HELP__",
  );
});

test("parseFigmaExportArgs parses --timeout-ms when positive integer", () => {
  const parsed = parseFigmaExportArgs(
    [
      "--figma-url",
      "https://figma.com/design/abc",
      "--output",
      "/tmp/out.json",
      "--figma-token",
      "t",
      "--timeout-ms",
      "5000",
    ],
    {},
  );
  assert.equal(parsed.timeoutMs, 5000);
  assert.throws(
    () =>
      parseFigmaExportArgs(
        [
          "--figma-url",
          "https://figma.com/design/abc",
          "--output",
          "/tmp/out.json",
          "--figma-token",
          "t",
          "--timeout-ms",
          "-1",
        ],
        {},
      ),
    /positive integer/u,
  );
});

test("runFigmaExport packages the snapshot under the canonical schema and exits 0", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "figma-export-"));
  try {
    const fakeFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.match(url, /api\.figma\.com\/v1\/files\/abc/u);
      return new Response(
        JSON.stringify({
          name: "Test File",
          lastModified: "2026-05-11T10:00:00.000Z",
          document: { id: "0:1", type: "DOCUMENT", children: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    // Patch globalThis.fetch temporarily — the figma-rest-adapter uses
    // globalThis.fetch by default and the CLI doesn't expose fetchImpl
    // injection.
    const priorFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof globalThis.fetch;
    try {
      const destination = join(outputDir, "figma-payload.json");
      const result = await runFigmaExport({
        figmaUrl: "https://figma.com/design/abc/title",
        outputPath: destination,
        figmaToken: "t",
        nowUtcIso: "2026-05-11T11:00:00.000Z",
      });
      assert.equal(result.path, destination);
      assert.equal(result.fileKey, "abc");
      const raw = await readFile(destination, "utf8");
      const payload = JSON.parse(raw) as Record<string, unknown>;
      assert.equal(payload.schemaVersion, FIGMA_PAYLOAD_SCHEMA_VERSION);
      assert.equal(payload.exportedAt, "2026-05-11T11:00:00.000Z");
      assert.equal(payload.fileKey, "abc");
      assert.equal(payload.name, "Test File");
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runFigmaExport writes into a directory when --output is a folder path", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "figma-export-dir-"));
  try {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          name: "X",
          document: { id: "0:1", type: "DOCUMENT" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const priorFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof globalThis.fetch;
    try {
      const result = await runFigmaExport({
        figmaUrl: "https://figma.com/design/abc",
        outputPath: outputDir,
        figmaToken: "t",
      });
      assert.equal(result.path, join(outputDir, "figma-payload.json"));
    } finally {
      globalThis.fetch = priorFetch;
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("runFigmaExportCli returns exit code 1 on operator error", async () => {
  const stderr: string[] = [];
  const code = await runFigmaExportCli([], {
    stdout: () => {},
    stderr: (chunk) => stderr.push(chunk),
    env: {},
  });
  assert.equal(code, 1);
  assert.ok(stderr.join("").includes("--figma-url is required"));
});

test("runFigmaExportCli surfaces --help with exit code 0", async () => {
  const stdout: string[] = [];
  const code = await runFigmaExportCli(["--help"], {
    stdout: (chunk) => stdout.push(chunk),
    stderr: () => {},
    env: {},
  });
  assert.equal(code, 0);
  assert.ok(stdout.join("").includes("figma-export"));
});
