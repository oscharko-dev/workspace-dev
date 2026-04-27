import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMultiSourceTestIntentEnvelope, validateMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";
import { ingestJiraPaste } from "./jira-paste-ingest.js";

const ingest = async (fixture: string) => {
  const body = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  const result = ingestJiraPaste({
    request: { jobId: "job-paste-collision", format: "plain_text", body },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.code);
  return result.result.sourceRef;
};

test("multi-source-paste-collision: same Jira issue with different pasted bytes raises paste_collision", async () => {
  const a = await ingest("adversarial-paste-collision-a.paste.txt");
  const b = await ingest("adversarial-paste-collision-b.paste.txt");
  assert.notEqual(a.contentHash, b.contentHash);
  assert.equal(a.canonicalIssueKey, b.canonicalIssueKey);

  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      { ...a, sourceId: "jira-paste-a" },
      { ...b, sourceId: "jira-paste-b" },
    ],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const validation = validateMultiSourceTestIntentEnvelope(envelope);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(
      validation.issues.some(
        (issue) => issue.code === "duplicate_jira_paste_collision",
      ),
      true,
    );
  }
});
