import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import { buildJiraIssueIr, type JiraAdfSource } from "./jira-issue-ir.js";

const ISO = "2026-04-26T12:34:56.000Z";

const adf = (content: unknown[]): JiraAdfSource => ({
  kind: "adf",
  json: JSON.stringify({ type: "doc", version: 1, content }),
});

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

test("Jira IR snapshot: canonical-JSON byte-stable for a fixed input", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1234",
    issueType: "story",
    summary: "Onboard customer",
    description: adf([
      para("First paragraph."),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [para("Item one")],
          },
        ],
      },
    ]),
    status: "In Progress",
    priority: "High",
    labels: ["banking", "onboarding"],
    components: ["api"],
    fixVersions: ["v1.0.0"],
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const json1 = canonicalJson(result.ir);
  const json2 = canonicalJson(result.ir);
  assert.equal(json1, json2);
  // Spot-check a few invariants in the serialized form
  const parsed = JSON.parse(json1);
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.issueKey, "PAY-1234");
  assert.equal(parsed.issueType, "story");
  assert.equal(parsed.priority, "High");
  assert.equal(parsed.dataMinimization.descriptionIncluded, true);
  assert.equal(parsed.dataMinimization.commentsIncluded, false);
  assert.equal(parsed.dataMinimization.attachmentsIncluded, false);
  assert.equal(parsed.dataMinimization.linksIncluded, false);
  assert.equal(parsed.dataMinimization.unknownCustomFieldsExcluded, 0);
  // contentHash is included in the canonical JSON
  assert.equal(typeof parsed.contentHash, "string");
  assert.match(parsed.contentHash, /^[0-9a-f]{64}$/);
  // No raw URLs / account IDs / media IDs from any synthetic source.
  // `indexOf` keeps CodeQL's URL-substring-sanitization rule satisfied
  // — these are content-leak assertions, not hostname validators.
  for (const banned of [
    "https://",
    "http://",
    "atlassian.net",
    "downloadUrl",
  ]) {
    assert.equal(
      parsed.descriptionPlain.indexOf(banned),
      -1,
      `descriptionPlain leaked ${banned}`,
    );
  }
});

test("Jira IR snapshot: persistedIR.json structural invariants", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "task",
    summary: "Fix login bug",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    customFields: [
      {
        id: "customfield_10100",
        name: "Acceptance Criteria",
        value: "- Can log in\n- Can log out",
      },
    ],
    fieldSelection: {
      acceptanceCriterionFieldIds: ["customfield_10100"],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Hard contract: arrays sorted/deduped + present
  assert.deepEqual(result.ir.labels, []);
  assert.deepEqual(result.ir.components, []);
  assert.deepEqual(result.ir.fixVersions, []);
  // Acceptance criteria preserved with stable IDs
  assert.deepEqual(
    result.ir.acceptanceCriteria.map((ac) => ac.id),
    ["ac.0", "ac.1"],
  );
  // Always-present audit metadata
  assert.equal(
    typeof result.ir.dataMinimization.descriptionIncluded,
    "boolean",
  );
  assert.equal(typeof result.ir.dataMinimization.commentsDropped, "number");
});
