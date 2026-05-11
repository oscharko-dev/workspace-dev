import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { sanitizeJqlFragment } from "./jira-issue-ir.js";

test("property: sanitizeJqlFragment rejects curated JQL injection vectors", () => {
  const injectionCorpus = [
    "project = TEST --",
    "project = TEST;",
    "project = `TEST`",
    "project = TEST OR 1 = 1",
    "issueKey IN (APP-1) AND 1=1",
    "1 = 1",
    "OR 1=1",
    "AND   1 =   1",
    "project=X\nOR\n1=1",
    "project=X\r\nOR 1=1",
    "project = TEST\x00",
  ];

  for (const vector of injectionCorpus) {
    const result = sanitizeJqlFragment(vector);
    assert.equal(result.ok, false);
  }
});

test("property: sanitizeJqlFragment preserves safe identifiers and values", () => {
  fc.assert(
    fc.property(fc.stringMatching(/^[A-Z][A-Z0-9_]{1,8}-[1-9][0-9]{0,5}$/), (issueKey) => {
      const fragment = `issueKey = ${issueKey}`;
      const result = sanitizeJqlFragment(fragment);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.sanitized, fragment);
    }),
    { numRuns: 100 }
  );
});
