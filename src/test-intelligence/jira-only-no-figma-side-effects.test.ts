import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ingestAndPersistJiraPaste } from "./jira-paste-ingest.js";

test("jira-only-no-figma-side-effects: Jira paste ingestion writes only Jira source artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-only-"));
  try {
    const result = await ingestAndPersistJiraPaste({
      runDir: dir,
      request: {
        jobId: "job-jira-only",
        format: "plain_text",
        body: [
          "Key: PAY-1443",
          "Summary: Jira-only ingestion",
          "Status: Open",
          "Description: No Figma artifacts should be created.",
        ].join("\n"),
      },
      authorHandle: "alice",
      capturedAt: "2026-04-27T10:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const rootEntries = (await readdir(dir)).sort();
    assert.deepEqual(rootEntries, ["sources"]);
    const sourceEntries = (
      await readdir(join(dir, "sources", result.result.sourceId))
    ).sort();
    assert.deepEqual(sourceEntries, [
      "jira-issue-ir.json",
      "paste-provenance.json",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
