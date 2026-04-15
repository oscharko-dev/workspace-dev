import assert from "node:assert/strict";
import test from "node:test";
import { formatFigmaPayloadPath, safeParseFigmaPayload, summarizeFigmaPayloadValidationError } from "./figma-payload-validation.js";

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

test("safeParseFigmaPayload reports deeply nested missing id with exact path", () => {
  const payload = {
    name: "Deeply nested",
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
              children: [
                {
                  // id intentionally omitted at depth 3
                  type: "FRAME",
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const result = safeParseFigmaPayload({ input: payload });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  const paths = toIssuePaths(result);
  assert.equal(
    paths.includes("document.children[0].children[0].children[0].id"),
    true
  );
});

test("safeParseFigmaPayload caps issues at MAX_VALIDATION_ISSUES and summary reports overflow", () => {
  const badChildren = Array.from({ length: 250 }, () => null);
  const result = safeParseFigmaPayload({
    input: {
      name: "Many invalid",
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: badChildren
      }
    }
  });

  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  assert.equal(result.error.issues.length <= 128, true);
  assert.equal(result.error.issues.length > 0, true);

  const summary = summarizeFigmaPayloadValidationError({ error: result.error });
  assert.match(summary, /\+\d+ more issues?/);
  const overflowMatch = summary.match(/\+(\d+) more issues?/);
  assert.ok(overflowMatch);
  assert.equal(Number(overflowMatch![1]) > 0, true);
});

test("safeParseFigmaPayload reports non-object absoluteBoundingBox with exact path", () => {
  const payload = {
    name: "Bad bbox",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          absoluteBoundingBox: "not-an-object",
          children: []
        }
      ]
    }
  };

  const result = safeParseFigmaPayload({ input: payload });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  const paths = toIssuePaths(result);
  assert.equal(
    paths.includes("document.children[0].absoluteBoundingBox"),
    true
  );
  const issue = result.error.issues.find(
    (entry) =>
      formatFigmaPayloadPath({ path: entry.path }) ===
      "document.children[0].absoluteBoundingBox"
  );
  assert.match(issue?.message ?? "", /absoluteBoundingBox must be an object/i);
});
