import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ingestJiraPaste } from "./jira-paste-ingest.js";

const request = (body: string) =>
  ingestJiraPaste({
    request: { jobId: "job-xss", format: "auto", body },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });

test("jira-paste-html-xss: pasted markdown and plain text executable payloads are refused", async () => {
  const fixture = await readFile(
    new URL("./fixtures/adversarial-jira-html-xss.paste.txt", import.meta.url),
    "utf8",
  );
  for (const body of [
    fixture,
    "Key: PAY-1\nSummary: x\nStatus: Open\nDescription: <svg onload='alert(1)'></svg>",
    "Key: PAY-1\nSummary: x\nStatus: Open\nDescription: [x](javascript:alert(1))",
    "Key: PAY-1\nSummary: x\nStatus: Open\nDescription: <img src=x onerror='alert(1)'>",
  ]) {
    const result = request(body);
    assert.equal(result.ok, false, body);
    if (!result.ok) {
      assert.equal(result.code, "paste_html_injection_refused");
      assert.equal(result.statusCode, 400);
    }
  }
});

test("jira-paste-html-xss: safe markdown paste still ingests without executable content", () => {
  const result = request(
    [
      "# PAY-1",
      "",
      "Summary: Safe markdown paste",
      "Status: Open",
      "Description: Reviewer confirms the approval workflow.",
    ].join("\n"),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.result.jiraIssueIr);
  assert.equal(serialized.includes("<script"), false);
  assert.equal(serialized.includes("javascript:"), false);
});
