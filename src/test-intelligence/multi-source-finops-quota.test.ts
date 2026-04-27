/**
 * Tests for the FinOps source-quota helpers introduced for Wave 4.I
 * (Issue #1439): `checkJiraApiQuota`, `checkJiraPasteQuota`,
 * `checkCustomContextQuota`, and the `sourceQuotas` validation block on
 * `validateFinOpsBudgetEnvelope`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CUSTOM_CONTEXT_BYTES_PER_JOB,
  MAX_JIRA_API_REQUESTS_PER_JOB,
  MAX_JIRA_PASTE_BYTES_PER_JOB,
  type FinOpsBudgetEnvelope,
} from "../contracts/index.js";
import {
  EU_BANKING_DEFAULT_FINOPS_BUDGET,
  checkCustomContextQuota,
  checkJiraApiQuota,
  checkJiraPasteQuota,
  validateFinOpsBudgetEnvelope,
} from "./finops-budget.js";
import { createFinOpsUsageRecorder } from "./finops-report.js";

const emptyEnvelope: FinOpsBudgetEnvelope = {
  budgetId: "empty",
  budgetVersion: "1.0.0",
  roles: {},
};

test("checkJiraApiQuota: passes when planned calls are under the EU-banking cap", () => {
  const result = checkJiraApiQuota(EU_BANKING_DEFAULT_FINOPS_BUDGET, 1);
  assert.equal(result.ok, true);
  assert.equal(result.breachReason, undefined);
});

test("checkJiraApiQuota: passes at exactly the cap", () => {
  const result = checkJiraApiQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_JIRA_API_REQUESTS_PER_JOB,
  );
  assert.equal(result.ok, true);
});

test("checkJiraApiQuota: breaches when planned calls exceed the cap", () => {
  const result = checkJiraApiQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_JIRA_API_REQUESTS_PER_JOB + 1,
  );
  assert.equal(result.ok, false);
  assert.equal(result.breachReason, "jira_api_quota_exceeded");
  assert.match(result.message ?? "", /exceeds maxJiraApiRequestsPerJob/);
});

test("checkJiraPasteQuota: passes when paste bytes are under the EU-banking cap", () => {
  const result = checkJiraPasteQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_JIRA_PASTE_BYTES_PER_JOB - 1,
  );
  assert.equal(result.ok, true);
});

test("checkJiraPasteQuota: breaches when paste bytes exceed the cap", () => {
  const result = checkJiraPasteQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_JIRA_PASTE_BYTES_PER_JOB + 1,
  );
  assert.equal(result.ok, false);
  assert.equal(result.breachReason, "jira_paste_quota_exceeded");
  assert.match(result.message ?? "", /maxJiraPasteBytesPerJob/);
});

test("checkCustomContextQuota: passes when input bytes are under the EU-banking cap", () => {
  const result = checkCustomContextQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_CUSTOM_CONTEXT_BYTES_PER_JOB - 1,
  );
  assert.equal(result.ok, true);
});

test("checkCustomContextQuota: breaches when input bytes exceed the cap", () => {
  const result = checkCustomContextQuota(
    EU_BANKING_DEFAULT_FINOPS_BUDGET,
    MAX_CUSTOM_CONTEXT_BYTES_PER_JOB + 1,
  );
  assert.equal(result.ok, false);
  assert.equal(result.breachReason, "custom_context_quota_exceeded");
  assert.match(result.message ?? "", /maxCustomContextBytesPerJob/);
});

test("source-quota helpers: pass with an empty envelope (no caps configured)", () => {
  assert.equal(checkJiraApiQuota(emptyEnvelope, 999_999).ok, true);
  assert.equal(checkJiraPasteQuota(emptyEnvelope, 999_999_999).ok, true);
  assert.equal(checkCustomContextQuota(emptyEnvelope, 999_999_999).ok, true);
});

test("validateFinOpsBudgetEnvelope: accepts a valid sourceQuotas block", () => {
  const envelope: FinOpsBudgetEnvelope = {
    budgetId: "with-source-quotas",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: 10,
      maxJiraPasteBytesPerJob: 1024,
      maxCustomContextBytesPerJob: 4096,
    },
  };
  const result = validateFinOpsBudgetEnvelope(envelope);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateFinOpsBudgetEnvelope: rejects negative sourceQuotas fields", () => {
  const envelope: FinOpsBudgetEnvelope = {
    budgetId: "negative-quotas",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: -1,
      maxJiraPasteBytesPerJob: -10,
      maxCustomContextBytesPerJob: -100,
    },
  };
  const result = validateFinOpsBudgetEnvelope(envelope);
  assert.equal(result.valid, false);
  const paths = result.errors.map((err) => err.path);
  assert.ok(paths.includes("$.sourceQuotas.maxJiraApiRequestsPerJob"));
  assert.ok(paths.includes("$.sourceQuotas.maxJiraPasteBytesPerJob"));
  assert.ok(paths.includes("$.sourceQuotas.maxCustomContextBytesPerJob"));
});

test("validateFinOpsBudgetEnvelope: rejects non-integer sourceQuotas fields", () => {
  const envelope: FinOpsBudgetEnvelope = {
    budgetId: "fractional-quotas",
    budgetVersion: "1.0.0",
    roles: {},
    sourceQuotas: {
      maxJiraApiRequestsPerJob: 1.5,
    },
  };
  const result = validateFinOpsBudgetEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (err) => err.path === "$.sourceQuotas.maxJiraApiRequestsPerJob",
    ),
  );
});

test("EU_BANKING_DEFAULT_FINOPS_BUDGET.sourceQuotas matches the contract constants", () => {
  assert.notEqual(EU_BANKING_DEFAULT_FINOPS_BUDGET.sourceQuotas, undefined);
  const sq = EU_BANKING_DEFAULT_FINOPS_BUDGET.sourceQuotas;
  assert.ok(sq !== undefined);
  assert.equal(sq.maxJiraApiRequestsPerJob, MAX_JIRA_API_REQUESTS_PER_JOB);
  assert.equal(sq.maxJiraPasteBytesPerJob, MAX_JIRA_PASTE_BYTES_PER_JOB);
  assert.equal(
    sq.maxCustomContextBytesPerJob,
    MAX_CUSTOM_CONTEXT_BYTES_PER_JOB,
  );
});

test("createFinOpsUsageRecorder: accepts recordIngestBytes for ingest roles", () => {
  const recorder = createFinOpsUsageRecorder();
  assert.doesNotThrow(() => {
    recorder.recordIngestBytes("jira_paste_ingest", 4096);
    recorder.recordIngestBytes("custom_context_ingest", 8192);
  });
  const snapshot = recorder.snapshot();
  const paste = snapshot.find((entry) => entry.role === "jira_paste_ingest");
  const custom = snapshot.find(
    (entry) => entry.role === "custom_context_ingest",
  );
  assert.ok(paste !== undefined);
  assert.ok(custom !== undefined);
  assert.equal(paste.ingestBytes, 4096);
  assert.equal(custom.ingestBytes, 8192);
});
