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

// ---------------------------------------------------------------------------
// PR #1724 follow-up: mid-word bare-JWT redaction. The bare-JWT pattern
// uses `\b` boundaries on both ends. A real-world failure mode is a JWT
// concatenated with a non-credential identifier through a single `-`,
// e.g. an Azure error body of the form
// "request-id-eyJhbGc...payload.signature went wrong". The non-word `-`
// character introduces a word boundary so the JWT must still be redacted
// even though it is not surrounded by whitespace.
// ---------------------------------------------------------------------------

test("bare JWT preceded by 'prefix-' (no label, hyphen boundary) is redacted", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  for (const prefixed of [
    `prefix-${jwt}`,
    `request-id-${jwt}`,
    `[trace-id]-${jwt}`,
    `customer-${jwt}-suffix`,
    `--${jwt}--`,
  ]) {
    const message = `error body: ${prefixed} please rotate`;
    const out = redactHighRiskSecrets(message, REDACTED);
    assert.equal(
      out.includes(jwt),
      false,
      `JWT leaked through mid-word redaction for shape: ${prefixed}`,
    );
    assert.match(out, /\[REDACTED]/);
  }
});

test("bare JWT inside a colon-delimited shape (no label) is redacted", () => {
  const jwt =
    "eyJraWQiOiJhYmNkZWZnaGlqa2xtbm9w" +
    ".eyJpc3MiOiJodHRwczovL2lkLmF6dXJlLmNvbSI" +
    ".U2lnbmF0dXJlVmFsdWVfMDEyMzQ1Njc4OQ";
  // Common shape from Azure / OAuth error bodies where the JWT is wedged
  // between identifiers separated by `:` (a non-word char).
  const message = `request-id:trace-foo:${jwt}:span-bar`;
  const out = redactHighRiskSecrets(message, REDACTED);
  assert.equal(out.includes(jwt), false);
});

test("bare JWT directly concatenated to alnum prefix without separator is NOT redacted (intentional)", () => {
  // This documents the current `\b`-anchored behaviour: when a JWT is
  // concatenated to alnum word characters with NO separating non-word
  // character, the leading `\b` cannot fire and the credential is left
  // alone. Customers that need full coverage should rely on the
  // label-anchored patterns (Authorization: Bearer ...) or normalise the
  // payload before redaction. We pin this contract so a future regex
  // change does not silently flip it without an audit trail.
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
    ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ" +
    ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const message = `prefixconcat${jwt}suffix`;
  const out = redactHighRiskSecrets(message, REDACTED);
  // Pre-existing contract: alnum-concatenated bare JWT is NOT redacted.
  // Asserting equality here means a future maintainer who changes the
  // pattern (e.g. to drop `\b`) breaks this test deliberately.
  assert.equal(out, message);
});
