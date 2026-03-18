import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FigmaJsonByteLimitError,
  formatFigmaPayloadPath,
  parseJsonTextWithByteLimit,
  readJsonFileWithByteLimit,
  safeParseFigmaPayload,
  summarizeFigmaPayloadValidationError
} from "./figma-payload-validation.js";

const createValidPayload = () => ({
  name: "Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "1:1",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 640 },
            children: []
          }
        ]
      }
    ]
  }
});

const toIssuePaths = (
  result: ReturnType<typeof safeParseFigmaPayload>
): string[] => {
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => formatFigmaPayloadPath({ path: issue.path }));
};

test("safeParseFigmaPayload accepts valid payload and keeps semantic shape intact", () => {
  const payload = createValidPayload();
  const snapshot = structuredClone(payload);

  const result = safeParseFigmaPayload({ input: payload });

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  assert.deepEqual(result.data, payload);
  assert.deepEqual(payload, snapshot);
});

test("safeParseFigmaPayload rejects non-object root", () => {
  const result = safeParseFigmaPayload({ input: [] });

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.deepEqual(toIssuePaths(result), ["(root)"]);
  assert.match(result.error.issues[0]?.message ?? "", /root must be an object/i);
});

test("safeParseFigmaPayload rejects missing document object", () => {
  const result = safeParseFigmaPayload({ input: { name: "Missing document" } });

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.deepEqual(toIssuePaths(result), ["document"]);
  assert.match(result.error.issues[0]?.message ?? "", /document must be an object/i);
});

test("safeParseFigmaPayload rejects when document.children is not an array", () => {
  const result = safeParseFigmaPayload({
    input: {
      name: "Bad children",
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: "not-an-array"
      }
    }
  });

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(toIssuePaths(result).includes("document.children"), true);
});

test("safeParseFigmaPayload reports missing node id with exact path", () => {
  const payload = createValidPayload();
  payload.document.children[0] = {
    type: "CANVAS",
    children: []
  };

  const result = safeParseFigmaPayload({ input: payload });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(toIssuePaths(result).includes("document.children[0].id"), true);
});

test("safeParseFigmaPayload reports missing node type with exact path", () => {
  const payload = createValidPayload();
  payload.document.children[0] = {
    id: "0:1",
    children: []
  };

  const result = safeParseFigmaPayload({ input: payload });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(toIssuePaths(result).includes("document.children[0].type"), true);
});

test("safeParseFigmaPayload reports non-object child entry with exact path", () => {
  const payload = createValidPayload();
  payload.document.children = [null as unknown as typeof payload.document.children[number]];

  const result = safeParseFigmaPayload({ input: payload });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  const paths = toIssuePaths(result);
  assert.equal(paths.includes("document.children[0]"), true);
});

test("summarizeFigmaPayloadValidationError includes first path and issue count", () => {
  const result = safeParseFigmaPayload({
    input: {
      document: {
        id: "",
        type: "FRAME",
        children: "bad"
      }
    }
  });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  const summary = summarizeFigmaPayloadValidationError({ error: result.error });
  assert.match(summary, /^document\.id:/);
  assert.match(summary, /\+\d+ more issues?/);
});

test("parseJsonTextWithByteLimit parses valid JSON under byte limit", () => {
  const parsed = parseJsonTextWithByteLimit({
    text: '{"name":"Demo"}',
    maxBytes: 1_024,
    sourceLabel: "inline-json"
  }) as { name: string };
  assert.equal(parsed.name, "Demo");
});

test("parseJsonTextWithByteLimit throws FigmaJsonByteLimitError for oversized payload text", () => {
  assert.throws(
    () =>
      parseJsonTextWithByteLimit({
        text: '{"payload":"abcdefghijklmnopqrstuvwxyz"}',
        maxBytes: 12,
        sourceLabel: "inline-json"
      }),
    (error: unknown) => {
      assert.equal(error instanceof FigmaJsonByteLimitError, true);
      return true;
    }
  );
});

test("readJsonFileWithByteLimit streams and parses JSON file under limit", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-payload-"));
  const jsonPath = path.join(tempDir, "payload.json");
  await writeFile(jsonPath, '{"document":{"id":"0:0","type":"DOCUMENT","children":[]}}', "utf8");
  try {
    const parsed = (await readJsonFileWithByteLimit({
      filePath: jsonPath,
      maxBytes: 10_000
    })) as { document: { id: string } };
    assert.equal(parsed.document.id, "0:0");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readJsonFileWithByteLimit throws FigmaJsonByteLimitError for oversized file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-payload-limit-"));
  const jsonPath = path.join(tempDir, "payload.json");
  await writeFile(jsonPath, '{"payload":"abcdefghijklmnopqrstuvwxyz"}', "utf8");
  try {
    await assert.rejects(
      () =>
        readJsonFileWithByteLimit({
          filePath: jsonPath,
          maxBytes: 12
        }),
      (error: unknown) => {
        assert.equal(error instanceof FigmaJsonByteLimitError, true);
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
