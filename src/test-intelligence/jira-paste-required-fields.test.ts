import assert from "node:assert/strict";
import test from "node:test";

import { ingestJiraPaste } from "./jira-paste-ingest.js";

test("jira-paste-required-fields: missing issue key is refused fail-closed", () => {
  const result = ingestJiraPaste({
    request: {
      jobId: "job-paste-missing-key",
      format: "plain_text",
      body: ["Summary: Missing issue key", "Status: Open"].join("\n"),
    },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "paste_issue_key_missing");
});

test("jira-paste-required-fields: Jira-shaped JSON without a summary fails closed during IR validation", () => {
  const missingSummary = ingestJiraPaste({
    request: {
      jobId: "job-paste-missing-summary",
      format: "adf_json",
      body: JSON.stringify({
        key: "PAY-42",
        fields: {
          status: { name: "Open" },
        },
      }),
    },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });
  assert.equal(missingSummary.ok, false);
  if (!missingSummary.ok) assert.equal(missingSummary.code, "paste_jira_ir_invalid");
});
