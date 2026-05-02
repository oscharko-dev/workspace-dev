import assert from "node:assert/strict";
import test from "node:test";
import { redactHighRiskSecrets } from "./secret-redaction.js";

const REDACTED = "[REDACTED]";

// ---------------------------------------------------------------------------
// Existing label-anchored patterns — coverage assertions to guard against
// regression while the new bare-token patterns are added. (Issue #1667.)
// ---------------------------------------------------------------------------

test("label-anchored: redacts repoToken=value", () => {
  const out = redactHighRiskSecrets("repoToken=ghp_secret_abc123", REDACTED);
  assert.equal(out.includes("ghp_secret_abc123"), false);
  assert.match(out, /repoToken=\[REDACTED]/);
});

test("label-anchored: redacts Authorization: Bearer ...", () => {
  const out = redactHighRiskSecrets(
    "Authorization: Bearer eyJabc.def.ghi",
    REDACTED,
  );
  assert.equal(out.includes("eyJabc.def.ghi"), false);
});

test("label-anchored: redacts JSON token field", () => {
  const out = redactHighRiskSecrets(`{"token":"some_secret_value"}`, REDACTED);
  assert.equal(out.includes("some_secret_value"), false);
});

// ---------------------------------------------------------------------------
// Issue #1667 (audit-2026-05): bare-token shape patterns. The error /
// sanitization pipeline must replace the credential even when the
// surrounding label has been stripped upstream.
// ---------------------------------------------------------------------------

test("bare JWT (eyJ... . ... . ...) is redacted in free text", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const out = redactHighRiskSecrets(
    `token invalid: ${jwt} please rotate`,
    REDACTED,
  );
  assert.equal(out.includes(jwt), false);
  assert.match(out, /\[REDACTED]/);
});

test("bare GitHub PAT (ghp_...) is redacted", () => {
  const pat = "ghp_" + "A".repeat(40);
  const out = redactHighRiskSecrets(
    `error referenced ${pat} in stack`,
    REDACTED,
  );
  assert.equal(out.includes(pat), false);
});

test("bare Figma personal access token (figd_...) is redacted", () => {
  const figd = "figd_" + "A".repeat(50);
  const out = redactHighRiskSecrets(
    `Figma error body: ${figd} from upstream`,
    REDACTED,
  );
  assert.equal(out.includes(figd), false);
});

test("bare Atlassian PAT (ATATT3...) is redacted", () => {
  const atatt = "ATATT3" + "A".repeat(60);
  const out = redactHighRiskSecrets(`Jira reply: ${atatt}`, REDACTED);
  assert.equal(out.includes(atatt), false);
});

test("bare AWS access-key id (AKIA*) is redacted", () => {
  const akia = "AKIA" + "A".repeat(16);
  const out = redactHighRiskSecrets(`fetch failed for ${akia}`, REDACTED);
  assert.equal(out.includes(akia), false);
});

test("bare Slack bot token (xoxb-...) is redacted", () => {
  const slack = "xoxb-12345-67890-" + "A".repeat(20);
  const out = redactHighRiskSecrets(`token ${slack} expired`, REDACTED);
  assert.equal(out.includes(slack), false);
});

test("bare-token redaction does NOT trigger on short identifiers", () => {
  // "eyJabc" alone is too short for the JWT pattern (needs 16+ char
  // header + 16+ char body + 16+ char sig). Same for short ghp_ etc.
  const benign = "see issue #abc-123 (lookup id eyJabc)";
  const out = redactHighRiskSecrets(benign, REDACTED);
  assert.equal(out, benign);
});

test("bare-token redaction is composable with label-anchored redaction in one message", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const figd = "figd_" + "B".repeat(50);
  const message = `repoToken=ghp_outer_secret_value123 mid Bearer ${jwt} suffix ${figd}`;
  const out = redactHighRiskSecrets(message, REDACTED);
  assert.equal(out.includes("ghp_outer_secret_value123"), false);
  assert.equal(out.includes(jwt), false);
  assert.equal(out.includes(figd), false);
});

// ---------------------------------------------------------------------------
// Property: redactor never enlarges the secret count and never re-emits
// the placeholder verbatim where a credential used to be.
// ---------------------------------------------------------------------------

test("redactor is idempotent: applying twice equals applying once", () => {
  const message = `error: token figd_${"X".repeat(50)} invalid`;
  const once = redactHighRiskSecrets(message, REDACTED);
  const twice = redactHighRiskSecrets(once, REDACTED);
  assert.equal(once, twice);
});
