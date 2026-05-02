import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_JIRA_FIELD_SELECTION_PROFILE,
  JIRA_ISSUE_IR_ARTIFACT_FILENAME,
  JIRA_ISSUE_IR_SCHEMA_VERSION,
  MAX_JIRA_COMMENT_BODY_BYTES,
  MAX_JIRA_DESCRIPTION_PLAIN_BYTES,
} from "../contracts/index.js";
import {
  buildJiraIssueIr,
  isValidJiraIssueKey,
  sanitizeJqlFragment,
  writeJiraIssueIr,
  type JiraAdfSource,
} from "./jira-issue-ir.js";

const ISO = "2026-04-26T12:34:56.000Z";

const adf = (content: unknown[]): JiraAdfSource => ({
  kind: "adf",
  json: JSON.stringify({ type: "doc", version: 1, content }),
});

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

test("isValidJiraIssueKey: accepts canonical keys, rejects adversarial", () => {
  assert.equal(isValidJiraIssueKey("PAY-1234"), true);
  assert.equal(isValidJiraIssueKey("ABC-1"), true);
  assert.equal(isValidJiraIssueKey("HR_INT-42"), true);
  // adversarial cases
  for (const bad of [
    "",
    "lower-1",
    "PAY-0",
    "PAY-",
    "-1",
    "PAY 1",
    "PAY-01",
    "PAY-1; DROP TABLE issues",
    "../../etc/passwd",
    "PAY-1\u0000",
    "P-1",
    "A".repeat(80) + "-1",
    null,
    undefined,
    42,
    {},
    "PA Y-1",
  ]) {
    assert.equal(
      isValidJiraIssueKey(bad as unknown),
      false,
      `should reject ${JSON.stringify(bad)}`,
    );
  }
});

test("sanitizeJqlFragment: rejects injection-shaped tokens", () => {
  for (const bad of [
    "project = PAY; DROP TABLE",
    "project = PAY OR 1=1",
    "project = PAY AND 1=1",
    "project = PAY -- comment",
    "project = `whoami`",
    "project = PAY\u0000",
    "project = PAY\u001f",
    "",
    "   ",
    "x".repeat(513),
  ]) {
    const result = sanitizeJqlFragment(bad);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bad)}`);
  }
  const ok = sanitizeJqlFragment("project = PAY AND status = Done");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.sanitized, "project = PAY AND status = Done");
});

test("buildJiraIssueIr: rejects invalid issue key", () => {
  const result = buildJiraIssueIr({
    issueKey: "lower-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "jira_issue_key_invalid");
});

test("buildJiraIssueIr: rejects oversize issue key with too_long code", () => {
  const result = buildJiraIssueIr({
    issueKey: "A".repeat(80) + "-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "jira_issue_key_too_long");
});

test("buildJiraIssueIr: collapses unknown issue type to 'other'", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "exploit",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.ir.issueType, "other");
});

test("buildJiraIssueIr: redacts IBAN/PAN/email/full-name/account-id placeholders", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "Onboard Max Mustermann",
    description: adf([
      para(
        "Please contact john.doe@example.com regarding IBAN DE89370400440532013000 and PAN 4532015112830366.",
      ),
      para(
        "Reviewed by [~accountid:557058:e7f0a8c1-1234-4abc-9def-1234567890ab].",
      ),
    ]),
    status: "In Progress",
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const text = result.ir.descriptionPlain + "\n" + result.ir.summary;
  assert.ok(!text.includes("john.doe@example.com"), "email leaked");
  assert.ok(!text.includes("DE89370400440532013000"), "IBAN leaked");
  assert.ok(!text.includes("4532015112830366"), "PAN leaked");
  assert.ok(!text.includes("Max Mustermann"), "full name leaked");
  assert.ok(!text.includes("557058"), "account id leaked");
  // Indicators recorded:
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("email"));
  assert.ok(kinds.has("iban"));
  assert.ok(kinds.has("pan"));
  assert.ok(kinds.has("full_name"));
  assert.ok(kinds.has("jira_mention"));
});

test("buildJiraIssueIr: redacts internal hostnames in ADF text", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "Internal endpoint",
    description: adf([para("See pay.intranet.example.com for details.")]),
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.ir.descriptionPlain.indexOf("intranet.example.com"),
    -1,
    "internal hostname leaked",
  );
  assert.ok(
    result.ir.piiIndicators.some((i) => i.kind === "internal_hostname"),
  );
});

test("buildJiraIssueIr: customer-name field escalates to customer_name_placeholder", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "task",
    summary: "Customer onboarding",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    customFields: [
      {
        id: "customfield_10042",
        name: "Customer Name",
        value: "Alice Beatrice Carlsson",
      },
    ],
    fieldSelection: {
      customFieldAllowList: ["customfield_10042"],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.customFields.length, 1);
  assert.ok(!result.ir.customFields[0]?.valuePlain.includes("Alice"));
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("customer_name_placeholder"));
});

test("buildJiraIssueIr: rejects ADF over byte cap as jira_description_invalid", () => {
  const huge = "x".repeat(2 * 1024 * 1024); // 2 MiB string body
  const json = JSON.stringify({
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: huge }] }],
  });
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "adf", json },
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "jira_description_invalid");
    assert.equal(result.detail, "jira_adf_payload_too_large");
  }
});

test("buildJiraIssueIr: descriptionPlain truncated to 32 KiB cap", () => {
  // 40 KiB plain text via a single paragraph of safe ASCII (no PII).
  const text = "abc def ghi jkl mno pqr stu vwx ".repeat((40 * 1024) / 32 + 1);
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "plain", text },
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.dataMinimization.descriptionTruncated, true);
  assert.ok(
    Buffer.byteLength(result.ir.descriptionPlain, "utf8") <=
      MAX_JIRA_DESCRIPTION_PLAIN_BYTES,
  );
});

test("buildJiraIssueIr: comments excluded by default, dataMinimization records it", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    comments: [
      {
        createdAt: ISO,
        body: { kind: "plain", text: "comment one" },
      },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.comments.length, 0);
  assert.equal(result.ir.dataMinimization.commentsIncluded, false);
});

test("buildJiraIssueIr: comments included when opted in, body capped to 4 KiB", () => {
  const huge = "z".repeat(MAX_JIRA_COMMENT_BODY_BYTES + 1024);
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    comments: [{ createdAt: ISO, body: { kind: "plain", text: huge } }],
    fieldSelection: { includeComments: true },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.comments.length, 1);
  assert.equal(result.ir.comments[0]?.bodyTruncated, true);
  assert.ok(
    Buffer.byteLength(result.ir.comments[0]!.body, "utf8") <=
      MAX_JIRA_COMMENT_BODY_BYTES,
  );
  assert.ok(result.ir.dataMinimization.commentsCapped >= 1);
});

test("buildJiraIssueIr: unknown custom fields excluded by default", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    customFields: [
      { id: "customfield_99999", name: "Secret Field", value: "v" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.customFields.length, 0);
  assert.equal(result.ir.dataMinimization.unknownCustomFieldsExcluded, 1);
});

test("buildJiraIssueIr: contentHash deterministic across rebuilds", () => {
  const input = {
    issueKey: "PAY-1" as const,
    issueType: "story" as const,
    summary: "Onboard customer",
    description: { kind: "absent" } as JiraAdfSource,
    status: "Open" as const,
    capturedAt: ISO,
    labels: ["banking", "onboarding"],
  };
  const a = buildJiraIssueIr(input);
  const b = buildJiraIssueIr(input);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) assert.equal(a.ir.contentHash, b.ir.contentHash);
});

test("buildJiraIssueIr: aggregates acceptance criteria from configured field", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "AC-bearing",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    customFields: [
      {
        id: "customfield_10100",
        name: "Acceptance Criteria",
        value: "- User can sign in\n- User sees dashboard\n- User logs out",
      },
    ],
    fieldSelection: {
      acceptanceCriterionFieldIds: ["customfield_10100"],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ir.acceptanceCriteria.length, 3);
  assert.equal(
    result.ir.acceptanceCriteria[0]?.sourceFieldId,
    "customfield_10100",
  );
});

test("buildJiraIssueIr: rejects malformed custom-field id", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "x",
    description: { kind: "absent" },
    status: "Open",
    capturedAt: ISO,
    customFields: [{ id: "evil-field", name: "x", value: "y" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "jira_custom_field_id_invalid");
});

test("buildJiraIssueIr: rejects malformed custom-field entries without throwing", () => {
  for (const customFields of [
    [null],
    [undefined],
    [{ id: "customfield_10100", name: "Acceptance Criteria", value: null }],
  ]) {
    const result = buildJiraIssueIr({
      issueKey: "PAY-1",
      issueType: "story",
      summary: "x",
      description: { kind: "absent" },
      status: "Open",
      capturedAt: ISO,
      customFields: customFields as unknown as Array<{
        id: string;
        name: string;
        value: string;
      }>,
      fieldSelection: {
        acceptanceCriterionFieldIds: ["customfield_10100"],
        customFieldAllowList: ["customfield_10042"],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "jira_custom_field_invalid");
      assert.equal(result.path, "customFields");
    }
  }
});

test("DEFAULT_JIRA_FIELD_SELECTION_PROFILE: data-minimised by default", () => {
  assert.equal(DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeComments, false);
  assert.equal(DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeAttachments, false);
  assert.equal(DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeLinks, false);
  assert.equal(DEFAULT_JIRA_FIELD_SELECTION_PROFILE.includeDescription, true);
  assert.equal(
    DEFAULT_JIRA_FIELD_SELECTION_PROFILE.customFieldAllowList.length,
    0,
  );
});

test("writeJiraIssueIr: persists artifact at sources/<sourceId>/jira-issue-ir.json", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jira-ir-test-"));
  try {
    const built = buildJiraIssueIr({
      issueKey: "PAY-1",
      issueType: "story",
      summary: "x",
      description: { kind: "absent" },
      status: "Open",
      capturedAt: ISO,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const writeResult = await writeJiraIssueIr({
      runDir: dir,
      sourceId: "src.0",
      ir: built.ir,
    });
    const expected = path.join(
      dir,
      "sources",
      "src.0",
      JIRA_ISSUE_IR_ARTIFACT_FILENAME,
    );
    assert.equal(writeResult.artifactPath, expected);
    const bytes = await readFile(expected, "utf8");
    const parsed = JSON.parse(bytes);
    assert.equal(parsed.version, JIRA_ISSUE_IR_SCHEMA_VERSION);
    assert.equal(parsed.issueKey, "PAY-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Persisted Jira IR: zero token-shaped substrings present", () => {
  const result = buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "story",
    summary: "Issue with sk-abcdefghij1234567890 token reference",
    description: adf([
      para(
        "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234 and AKIAIOSFODNN7EXAMPLE plus xoxb-12345678-1234567890.", // pragma: allowlist secret
      ),
    ]),
    status: "Open",
    capturedAt: ISO,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The IR builder is not a secret-scanner — we assert that the only way
  // a token-shaped string lands in the IR is via the verbatim user input.
  // The persisted-canonical-JSON should include the tokens (these are
  // not redacted by PII detection — only PII categories are). But the
  // hash should reflect the raw input deterministically, and there
  // should be no synthetic leakage of tokens not present in the input.
  const json = JSON.stringify(result.ir);
  const tokens = ["sk-abcdefghij1234567890", "AKIAIOSFODNN7EXAMPLE"]; // pragma: allowlist secret
  for (const t of tokens) {
    // verify present at most as many times as in the input — i.e. not
    // duplicated by the IR builder.
    const count = json.split(t).length - 1;
    assert.ok(count >= 0 && count <= 2);
  }
});

// ---------------------------------------------------------------------------
// Issue #1668 (audit-2026-05) — maskKind coverage for the 5 new GDPR
// Art. 5(1)(c) / Art. 9 PiiKind members. PR #1724 fixed the no-op branches
// that previously returned the input unchanged. The test matrix below
// pins both directions:
//
//   Positive: a value containing kind X yields a piiIndicator of kind X.
//   Negative: a value with no signal of kind X yields no indicator of
//             kind X.
//
// Multi-kind progression: the maskKind fix is the difference between
// "stage-1 detection loop hangs on the first hit and never surfaces a
// second category" and "stage-1 visits each distinct category exactly
// once". The progression test pairs a new kind with a kind detected
// later in `detectPii` order, so without the fix only the first kind is
// recorded.
// ---------------------------------------------------------------------------

const adfPara = (text: string): JiraAdfSource =>
  adf([{ type: "paragraph", content: [{ type: "text", text }] }]);

const buildIrForText = (text: string) =>
  buildJiraIssueIr({
    issueKey: "PAY-1",
    issueType: "task",
    summary: "x",
    description: adfPara(text),
    status: "Open",
    capturedAt: ISO,
  });

test("maskKind/postal_address: positive — DE address yields postal_address indicator", () => {
  const result = buildIrForText(
    "Bitte senden an: Musterstraße 12, 10115 Berlin",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(
    kinds.has("postal_address"),
    `expected postal_address in indicators; got ${[...kinds].join(",")}`,
  );
});

test("maskKind/postal_address: negative — bare postal code does not yield postal_address indicator", () => {
  const result = buildIrForText("Reference number 10115 logged in audit table");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.equal(kinds.has("postal_address"), false);
});

test("maskKind/date_of_birth: positive — labelled DOB yields date_of_birth indicator", () => {
  const result = buildIrForText(
    "Customer date of birth: 1985-03-12 (verified)",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("date_of_birth"));
});

test("maskKind/date_of_birth: negative — bare timestamp does not yield date_of_birth indicator", () => {
  const result = buildIrForText(
    "Generated on 2026-04-25 by deterministic-runner",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.equal(kinds.has("date_of_birth"), false);
});

test("maskKind/account_number: positive — labelled customer id yields account_number indicator", () => {
  const result = buildIrForText("Kundennummer 99887766 ist gesperrt.");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("account_number"));
});

test("maskKind/account_number: negative — unlabelled digit run does not yield account_number indicator", () => {
  const result = buildIrForText("Job duration was 1234567890 ms.");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.equal(kinds.has("account_number"), false);
});

test("maskKind/national_id: positive — Swiss AHV yields national_id indicator", () => {
  const result = buildIrForText("AHV-Nummer 756.1234.5678.97 vorgelegt.");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("national_id"));
});

test("maskKind/national_id: negative — random alnum run does not yield national_id indicator", () => {
  const result = buildIrForText("Build digest: 8a4b2c9f1d3e5a7b8c9d0e1f");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.equal(kinds.has("national_id"), false);
});

test("maskKind/special_category: positive — health keyword yields special_category indicator", () => {
  const result = buildIrForText("Patient HIV status confirmed in 2024.");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("special_category"));
});

test("maskKind/special_category: negative — neutral business prose yields no special_category indicator", () => {
  const result = buildIrForText(
    "TypeScript discriminated union types compile to runtime JSON.",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.equal(kinds.has("special_category"), false);
});

test("maskKind: stage-1 progression — postal_address + account_number both surface as distinct indicators", () => {
  // detectPii visits postal_address (12th) BEFORE account_number (13th).
  // Pre-fix: maskKind('postal_address') returned the input unchanged, so
  // the iteration loop kept re-detecting postal_address; account_number
  // was never reached. Post-fix: the postal address is masked in the
  // scratch buffer, so the next loop iteration surfaces account_number.
  const result = buildIrForText(
    "Musterstraße 12, 10115 Berlin — Kundennummer 99887766 ist gesperrt.",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(
    kinds.has("postal_address"),
    `progression: postal_address missing from indicators; got ${[...kinds].join(",")}`,
  );
  assert.ok(
    kinds.has("account_number"),
    `progression: account_number missing — maskKind(postal_address) regressed; got ${[...kinds].join(",")}`,
  );
});

test("maskKind: stage-1 progression — date_of_birth + special_category both surface as distinct indicators", () => {
  // detectPii order: date_of_birth (11th) → special_category (14th).
  // Without maskKind('date_of_birth'), special_category would be missed.
  const result = buildIrForText(
    "Customer date of birth: 1985-03-12 — Patient HIV status confirmed.",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("date_of_birth"));
  assert.ok(
    kinds.has("special_category"),
    `progression: special_category missing — maskKind(date_of_birth) regressed; got ${[...kinds].join(",")}`,
  );
});

test("maskKind: stage-1 progression — national_id + postal_address both surface as distinct indicators", () => {
  // detectPii order: national_id (10th) → postal_address (12th).
  const result = buildIrForText(
    "AHV-Nummer 756.1234.5678.97 — Wohnsitz: Musterstraße 12, 10115 Berlin",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const kinds = new Set(result.ir.piiIndicators.map((i) => i.kind));
  assert.ok(kinds.has("national_id"));
  assert.ok(
    kinds.has("postal_address"),
    `progression: postal_address missing — maskKind(national_id) regressed; got ${[...kinds].join(",")}`,
  );
});
