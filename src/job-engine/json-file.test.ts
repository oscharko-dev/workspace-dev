import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writePrettyJsonFile } from "./json-file.js";

test("writePrettyJsonFile matches JSON.stringify pretty output for representative values", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-json-file-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const filePath = path.join(rootDir, "payload.json");
  const createdAt = new Date("2026-04-03T10:15:00.000Z");
  const payload = {
    name: "Customer Board",
    createdAt,
    nested: {
      keep: true,
      omitUndefined: undefined,
      omitFunction: () => "ignored",
      array: ["alpha", undefined, null, { escaped: "\"quoted\"" }]
    },
    list: [
      {
        id: 1,
        labels: ["one", "two"]
      },
      {
        id: 2,
        value: null
      }
    ]
  };

  await writePrettyJsonFile({
    filePath,
    value: payload
  });

  assert.equal(await readFile(filePath, "utf8"), `${JSON.stringify(payload, null, 2)}\n`);
});
