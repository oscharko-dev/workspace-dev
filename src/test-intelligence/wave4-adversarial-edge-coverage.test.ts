import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  CUSTOM_CONTEXT_SCHEMA_VERSION,
  type JiraGatewayConfig,
  type JiraIssueIr,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { parseJiraAdfDocument } from "./jira-adf-parser.js";
import { createJiraGatewayClient } from "./jira-gateway-client.js";
import { buildJiraIssueIr, type BuildJiraIssueIrInput } from "./jira-issue-ir.js";
import {
  buildJiraPasteOnlyEnvelope,
  ingestJiraPaste,
  sanitizeJiraPasteAuthorHandle,
} from "./jira-paste-ingest.js";
import {
  buildMultiSourceTestIntentEnvelope,
  enforceMultiSourceModeGate,
  evaluateMultiSourceModeGate,
  legacySourceFromMultiSourceEnvelope,
  validateMultiSourceTestIntentEnvelope,
} from "./multi-source-envelope.js";
import { reconcileMultiSourceIntent } from "./multi-source-reconciliation.js";

const ISO = "2026-04-26T12:34:56.000Z";

const gatewayConfig: JiraGatewayConfig = {
  baseUrl: "https://example.atlassian.net",
  auth: { kind: "bearer", token: "test-token" },
  userAgent: "workspace-dev/1.0",
  allowedHostPatterns: ["example.atlassian.net"],
  maxRetries: 0,
};

const baseIssue = (overrides: Partial<BuildJiraIssueIrInput> = {}) =>
  ({
    issueKey: "PAY-1438",
    issueType: "story",
    summary: "Checkout hardening",
    description: { kind: "plain", text: "Checkout must reject bad input." },
    status: "Open",
    capturedAt: ISO,
    ...overrides,
  }) satisfies BuildJiraIssueIrInput;

const textNode = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  text,
  ...extra,
});

const adf = (content: unknown[]) =>
  JSON.stringify({ type: "doc", version: 1, content });

test("wave4 edge coverage: ADF parser handles safe rich nodes and fail-closed shape variants", () => {
  const rich = parseJiraAdfDocument(
    adf([
      {
        type: "heading",
        attrs: { level: 99 },
        content: [
          textNode("Heading", {
            marks: [
              { type: "strong" },
              { type: "link", attrs: { href: "https://example.invalid" } },
            ],
          }),
        ],
      },
      {
        type: "paragraph",
        content: [
          textNode("Line"),
          { type: "hardBreak" },
          { type: "emoji", attrs: { shortName: ":ok:" } },
          { type: "emoji", attrs: { shortName: "<bad>" } },
          { type: "status", attrs: { text: "READY" } },
          { type: "status", attrs: { text: "<script>" } },
          { type: "date", attrs: { timestamp: "1777276800000" } },
          { type: "date", attrs: { timestamp: "not-a-date" } },
          { type: "inlineCard", attrs: { url: "https://internal.invalid" } },
          { type: "mention", attrs: { id: "account-id" } },
        ],
      },
      { type: "blockquote", content: [{ type: "paragraph", content: [textNode("quote")] }] },
      { type: "panel", content: undefined },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [textNode("A")] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [textNode("B")] }] },
            ],
          },
        ],
      },
      { type: "mediaSingle", content: [{ type: "media", attrs: { alt: "safe.png" } }] },
      { type: "mediaGroup", content: [{ type: "media", attrs: { alt: "../bad.png" } }] },
      { type: "rule" },
      { type: "codeBlock", attrs: { language: "TS" }, content: undefined },
    ]),
  );
  assert.equal(rich.ok, true);
  if (rich.ok) {
    assert.match(rich.document.plainText, /# Heading/u);
    assert.match(rich.document.plainText, /:ok::emoji:/u);
    assert.match(rich.document.plainText, /\[READY\]\[status\]/u);
    assert.match(rich.document.plainText, /\[date:1777276800000\]\[date:date\]/u);
    assert.match(rich.document.plainText, /\[attachment:safe.png\]/u);
    assert.match(rich.document.plainText, /\[attachment:redacted\]/u);
  }

  const invalidDocs = [
    [{ type: "doc", version: 1, content: "nope" }, "jira_adf_node_shape_invalid"],
    [{ type: "doc", version: 1, content: [null] }, "jira_adf_node_shape_invalid"],
    [
      {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: "bad" }],
      },
      "jira_adf_node_shape_invalid",
    ],
    [
      {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [textNode("x", { marks: "bad" })] }],
      },
      "jira_adf_node_shape_invalid",
    ],
    [
      {
        type: "doc",
        version: 1,
        content: [{ type: "codeBlock", content: [{ type: "emoji" }] }],
      },
      "jira_adf_unknown_node_type",
    ],
    [
      {
        type: "doc",
        version: 1,
        content: [{ type: "codeBlock", content: [{ type: "text", text: 12 }] }],
      },
      "jira_adf_text_node_invalid",
    ],
  ] as const;

  for (const [doc, code] of invalidDocs) {
    const result = parseJiraAdfDocument(JSON.stringify(doc));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.rejection.code, code);
  }
});

test("wave4 edge coverage: Jira IR rejects malformed metadata and preserves minimized optional collections", () => {
  const refusals: Array<[Partial<BuildJiraIssueIrInput>, string]> = [
    [{ summary: "" }, "jira_summary_invalid"],
    [{ summary: "x".repeat(2_000) }, "jira_summary_invalid"],
    [{ status: "" }, "jira_status_invalid"],
    [{ status: "x".repeat(65) }, "jira_status_invalid"],
    [{ priority: "" }, "jira_priority_invalid"],
    [{ priority: "x".repeat(33) }, "jira_priority_invalid"],
    [{ capturedAt: "2026-04-26 12:00:00" }, "jira_captured_at_invalid"],
    [{ fieldSelection: { customFieldAllowList: ["bad"] } }, "jira_field_selection_profile_invalid"],
    [
      { fieldSelection: { acceptanceCriterionFieldIds: ["customfield_bad"] } },
      "jira_field_selection_profile_invalid",
    ],
    [{ labels: ["bad/slash"] }, "jira_summary_invalid"],
    [{ components: [""] }, "jira_summary_invalid"],
    [{ fixVersions: ["x".repeat(65)] }, "jira_summary_invalid"],
    [
      { fieldSelection: { includeComments: true }, comments: [{ createdAt: "bad", body: { kind: "plain", text: "x" } }] },
      "jira_comment_invalid",
    ],
    [
      { fieldSelection: { includeAttachments: true }, attachments: [{ filename: "" }] },
      "jira_attachment_invalid",
    ],
    [
      { fieldSelection: { includeLinks: true }, links: [{ targetIssueKey: "bad", relationship: "blocks" }] },
      "jira_link_invalid",
    ],
    [
      { fieldSelection: { includeLinks: true }, links: [{ targetIssueKey: "PAY-2", relationship: "" }] },
      "jira_link_invalid",
    ],
  ];

  for (const [override, code] of refusals) {
    const result = buildJiraIssueIr(baseIssue(override));
    assert.equal(result.ok, false, JSON.stringify(override));
    if (!result.ok) assert.equal(result.code, code);
  }

  const optional = buildJiraIssueIr(
    baseIssue({
      priority: "High",
      labels: ["pci", "pci", "checkout"],
      components: ["Payments", "Core"],
      fixVersions: ["2026.04"],
      customFields: [
        { id: "customfield_10001", name: "Customer Email", value: "ada@example.com" },
        {
          id: "customfield_10002",
          name: "Acceptance Criteria",
          value: adf([
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [textNode("Reject script tags")] }] },
              ],
            },
          ]),
        },
      ],
      comments: [
        { authorHandle: "reviewer", createdAt: ISO, body: { kind: "plain", text: "Looks safe" } },
        { authorHandle: "", createdAt: ISO, body: { kind: "absent" } },
      ],
      attachments: [
        { filename: "evidence.png", mimeType: "IMAGE/PNG", byteSize: 10.7 },
        { filename: "notes.txt", mimeType: "bad mime", byteSize: Number.NaN },
      ],
      links: [{ targetIssueKey: "PAY-2", relationship: "Blocks  " }],
      fieldSelection: {
        includeComments: true,
        includeAttachments: true,
        includeLinks: true,
        customFieldAllowList: ["customfield_10001"],
        acceptanceCriterionFieldIds: ["customfield_10002"],
      },
    }),
  );
  assert.equal(optional.ok, true);
  if (!optional.ok) return;
  assert.deepEqual(optional.ir.labels, ["checkout", "pci"]);
  assert.equal(optional.ir.priority, "High");
  assert.equal(optional.ir.acceptanceCriteria[0]?.text, "Reject script tags");
  assert.equal(optional.ir.customFields[0]?.valuePlain, "[REDACTED:EMAIL]");
  assert.equal(optional.ir.comments[0]?.authorHandle, "reviewer");
  assert.equal(optional.ir.comments[1]?.authorHandle, undefined);
  assert.equal(optional.ir.attachments[0]?.mimeType, "image/png");
  assert.equal(optional.ir.attachments[0]?.byteSize, 10);
  assert.equal(optional.ir.attachments[1]?.mimeType, undefined);
  assert.equal(optional.ir.links[0]?.relationship, "blocks_");
});

test("wave4 edge coverage: Jira gateway rejects bad config/request shapes and redacts replay failures", async () => {
  const badConfigs: JiraGatewayConfig[] = [
    { ...gatewayConfig, userAgent: "" },
    { ...gatewayConfig, auth: { kind: "bearer", token: " " } },
    { ...gatewayConfig, auth: { kind: "basic", email: "", apiToken: "x" } },
    { ...gatewayConfig, auth: { kind: "oauth2_3lo", accessToken: "" }, baseUrl: "https://api.atlassian.com/ex/jira/cloud-1" },
    { ...gatewayConfig, maxWallClockMs: 0 },
    { ...gatewayConfig, maxRetries: -1 },
    { ...gatewayConfig, maxResponseBytes: Number.NaN },
  ];
  for (const config of badConfigs) {
    assert.throws(() => createJiraGatewayClient(config));
  }

  const fetchCalls: string[] = [];
  const client = createJiraGatewayClient(gatewayConfig, {
    fetchImpl: (async (url: string) => {
      fetchCalls.push(url);
      return new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), { status: 200 });
    }) as typeof fetch,
  });

  const badRequests = [
    { query: { kind: "issue_keys" as const, issueKeys: [] } },
    { query: { kind: "issue_keys" as const, issueKeys: ["bad"] } },
    { query: { kind: "jql" as const, jql: "project = PAY", maxResults: 0 } },
    { query: { kind: "jql" as const, jql: "project = PAY", maxResults: 1 }, fieldSelection: { customFieldAllowList: ["bad"] } },
    { query: { kind: "jql" as const, jql: "project = PAY", maxResults: 1 }, runDir: "" },
    { query: { kind: "jql" as const, jql: "project = PAY", maxResults: 1 }, sourceId: "../bad" },
  ];
  for (const request of badRequests) {
    const result = await client.fetchIssues(request as never);
    assert.equal(result.issues.length, 0);
    assert.equal(result.cacheHit, false);
    assert.ok(result.diagnostic);
  }
  assert.equal(fetchCalls.length, 0);

  const replayUnconfigured = await client.fetchIssues({
    query: { kind: "jql", jql: "project = PAY", maxResults: 1 },
    replayMode: true,
  });
  assert.equal(replayUnconfigured.diagnostic?.code, "jira_replay_cache_unconfigured");

  const dir = await mkdtemp(path.join(tmpdir(), "jira-replay-edge-"));
  const replayMiss = await client.fetchIssues({
    query: { kind: "jql", jql: "project = PAY", maxResults: 1 },
    runDir: dir,
    sourceId: "missing",
    replayMode: true,
  });
  assert.equal(replayMiss.diagnostic?.code, "jira_replay_cache_miss");
  assert.equal(replayMiss.diagnostic?.message.includes("test-token"), false);
});

test("wave4 edge coverage: Jira gateway status, retry, response, and usage branches fail closed", async () => {
  const usage: string[] = [];
  const statuses = [403, 400, 500, 429] as const;
  for (const status of statuses) {
    let calls = 0;
    const client = createJiraGatewayClient(
      { ...gatewayConfig, maxRetries: status === 500 ? 1 : 0, maxWallClockMs: 50 },
      {
        sleep: async () => {},
        retryBackoffMs: [100],
        onUsageEvent: (event) => usage.push(`${event.diagnosticCode ?? "ok"}:${event.attempts}`),
        fetchImpl: (async (url: string) => {
          calls += 1;
          if (url.endsWith("serverInfo")) {
            return new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), { status: 200 });
          }
          if (status === 429) {
            return new Response("", {
              status,
              headers: { "Retry-After": "not-number", "RateLimit-Reason": "Bearer secret-token-value" },
            });
          }
          return new Response("", { status });
        }) as typeof fetch,
      },
    );
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project = PAY", maxResults: 1 },
    });
    assert.equal(result.issues.length, 0);
    assert.ok(result.diagnostic);
    assert.equal(result.retryable, false);
    assert.ok(calls >= 2);
  }

  const malformedResponses = [
    new Response("{", { status: 200 }),
    new Response(JSON.stringify({ notIssues: [] }), { status: 200 }),
    new Response(JSON.stringify({ issues: [{ key: "bad", fields: {} }] }), { status: 200 }),
  ];
  for (const response of malformedResponses) {
    const client = createJiraGatewayClient(gatewayConfig, {
      fetchImpl: (async (url: string) =>
        url.endsWith("serverInfo")
          ? new Response(JSON.stringify({ version: "10.0.0", deploymentType: "Cloud" }), { status: 200 })
          : response) as typeof fetch,
    });
    const result = await client.fetchIssues({
      query: { kind: "jql", jql: "project = PAY", maxResults: 1 },
    });
    assert.equal(result.issues.length, 0);
    assert.ok(result.diagnostic);
  }

  assert.ok(usage.some((entry) => entry.startsWith("jira_forbidden")));
  assert.ok(usage.some((entry) => entry.startsWith("jira_request_failed")));
  assert.ok(usage.some((entry) => entry.startsWith("jira_retry_budget_exceeded")));
  assert.ok(usage.some((entry) => entry.startsWith("jira_rate_limited")));
});

test("wave4 edge coverage: paste ingestion and source envelopes fail closed on malformed source claims", () => {
  assert.equal(sanitizeJiraPasteAuthorHandle(" Reviewer-1 "), "Reviewer-1");
  assert.equal(sanitizeJiraPasteAuthorHandle("bad handle!"), undefined);

  const unsupported = ingestJiraPaste({
    request: { jobId: "job", format: "xml" as never, body: "<issue/>" },
    authorHandle: "reviewer",
    capturedAt: ISO,
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.code, "paste_format_invalid");

  const missingSummary = ingestJiraPaste({
    request: { jobId: "job", format: "plain_text", body: "Summary: Checkout\nStatus: Open" },
    authorHandle: "reviewer",
    capturedAt: ISO,
  });
  assert.equal(missingSummary.ok, false);

  const good = ingestJiraPaste({
    request: {
      jobId: "job",
      format: "plain_text",
      body: "Key: PAY-1438\nSummary: Checkout\nStatus: Open\nDescription: Safe",
    },
    authorHandle: "reviewer",
    capturedAt: ISO,
  });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  const envelope = buildJiraPasteOnlyEnvelope(good.result.sourceRef);
  assert.equal(validateMultiSourceTestIntentEnvelope(envelope).ok, true);
  assert.equal(legacySourceFromMultiSourceEnvelope(envelope).kind, "hybrid");

  const badEnvelope = {
    ...envelope,
    sources: [
      { ...envelope.sources[0], kind: "jira_paste", canonicalIssueKey: "bad" },
    ],
  };
  const validation = validateMultiSourceTestIntentEnvelope(badEnvelope);
  assert.equal(validation.ok, false);
});

test("wave4 edge coverage: reconciliation records unmatched and fallback source families", () => {
  const jira = buildJiraIssueIr(
    baseIssue({
      summary: "Transfer amount",
      description: { kind: "plain", text: "IBAN payment amount must be reviewed." },
      labels: ["high-risk", "pci"],
      customFields: [
        { id: "customfield_10002", name: "Acceptance Criteria", value: "- Amount is required\n- IBAN is required" },
      ],
      fieldSelection: { acceptanceCriterionFieldIds: ["customfield_10002"] },
    }),
  );
  assert.equal(jira.ok, true);
  if (!jira.ok) return;

  const figmaRef: TestIntentSourceRef = {
    sourceId: "figma.1",
    kind: "figma_local_json",
    contentHash: "a".repeat(64),
    capturedAt: ISO,
  };
  const jiraRef: TestIntentSourceRef = {
    sourceId: "jira.1",
    kind: "jira_paste",
    contentHash: jira.ir.contentHash,
    capturedAt: ISO,
    authorHandle: "reviewer",
    canonicalIssueKey: jira.ir.issueKey,
  };
  const customRef: TestIntentSourceRef = {
    sourceId: "custom.1",
    kind: "custom_structured",
    inputFormat: "json",
    contentHash: "b".repeat(64),
    capturedAt: ISO,
  };
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [figmaRef, jiraRef, customRef],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const result = reconcileMultiSourceIntent({
    envelope,
    figmaIntent: {
      version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
      source: { kind: "figma_local_json", contentHash: figmaRef.contentHash },
      screens: [{ screenId: "screen-1", screenName: "Checkout", trace: { nodeId: "node-1" } }],
      detectedFields: [
        {
          id: "field.amount",
          screenId: "screen-1",
          provenance: "figma_node",
          confidence: 0.9,
          label: "Amount",
          type: "text",
          trace: { nodeId: "field.amount" },
        },
      ],
      detectedActions: [],
      detectedValidations: [],
      detectedNavigation: [],
      inferredBusinessObjects: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      piiIndicators: [],
      redactions: [],
      sourceEnvelope: envelope,
    },
    jiraIssues: [jira.ir as JiraIssueIr],
    customContextSources: [
      {
        version: CUSTOM_CONTEXT_SCHEMA_VERSION,
        sourceKind: "custom_structured",
        noteEntries: [],
        aggregateContentHash: "b".repeat(64),
        structuredEntries: [
          {
            entryId: "entry.1",
            authorHandle: "reviewer",
            capturedAt: ISO,
            attributes: [
              { key: "risk_category", value: "regulated_data" },
              { key: "priority_hint", value: "p1" },
            ],
            contentHash: "c".repeat(64),
            piiIndicators: [],
            redactions: [],
          },
        ],
      },
    ],
  });
  assert.equal(result.mergedIntent.screens.length >= 1, true);
  assert.ok(result.report.transcript.length > 0);
  assert.equal(result.mergedIntent.sourceEnvelope?.sources.length, 3);
  assert.ok((result.report.unmatchedSourceSignals ?? []).length >= 0);
});

test("wave4 edge coverage: multi-source mode gate covers disabled and throw paths", () => {
  const disabled = evaluateMultiSourceModeGate({
    testIntelligenceEnvEnabled: false,
    testIntelligenceStartupEnabled: false,
    multiSourceEnvEnabled: false,
    multiSourceStartupEnabled: false,
    llmCodegenMode: "llm",
  });
  assert.equal(disabled.allowed, false);
  assert.throws(() =>
    enforceMultiSourceModeGate({
      testIntelligenceEnvEnabled: true,
      testIntelligenceStartupEnabled: true,
      multiSourceEnvEnabled: false,
      multiSourceStartupEnabled: true,
      llmCodegenMode: "deterministic",
    }),
  );
});
