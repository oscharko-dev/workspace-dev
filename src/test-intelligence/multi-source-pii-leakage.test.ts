import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";
import { ingestAndPersistJiraPaste } from "./jira-paste-ingest.js";
import { compilePrompt } from "./prompt-compiler.js";

test("multi-source-pii-leakage: Jira + custom context artifacts and compiled prompt never persist raw PII", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "multi-source-pii-"));
  const fullName = "Max Mustermann";
  const email = "max.mustermann@sparkasse.de";
  const iban = "DE89370400440532013000";
  const pan = "4111111111111111";

  const jira = await ingestAndPersistJiraPaste({
    runDir,
    request: {
      jobId: "job-ms-pii",
      format: "plain_text",
      body: [
        "Issue Key: PAY-7",
        `Summary: Customer ${fullName}`,
        "Status: Open",
        `Description: notify ${email}; account ${iban}; card ${pan}`,
      ].join("\n"),
    },
    authorHandle: "alice",
    capturedAt: "2026-04-27T10:00:00.000Z",
  });
  assert.equal(jira.ok, true);
  if (!jira.ok) return;

  const markdown = canonicalizeCustomContextMarkdown(
    `# Contact ${fullName}\n\n- Email ${email}\n- IBAN ${iban}\n- PAN ${pan}\n`,
  );
  assert.equal(markdown.ok, true);
  if (!markdown.ok) return;

  const compiled = compilePrompt({
    jobId: "job-ms-pii",
    intent: {
      version: "1.0.0",
      source: { kind: "jira_paste", contentHash: jira.result.jiraIssueIr.contentHash },
      screens: [{ screenId: "s-1", screenName: "Payments" }],
      detectedFields: [
        {
          id: "s-1::field::customer-name",
          screenId: "s-1",
          trace: { nodeId: "customer-name" },
          provenance: "jira_import",
          confidence: 0.9,
          label: "[REDACTED:FULL_NAME]",
          type: "text",
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
    },
    customContext: {
      markdownSections: [
        {
          sourceId: "custom-context-markdown",
          entryId: "entry-1",
          ...markdown.value,
        },
      ],
      structuredAttributes: [],
    },
    modelBinding: {
      modelRevision: "gpt-oss-120b@2026-04-27",
      gatewayRelease: "mock",
      seed: 42,
    },
    policyBundleVersion: "policy-2026-04-27",
    visualBinding: {
      schemaVersion: "1.0.0",
      selectedDeployment: "llama-4-maverick-vision",
      fallbackReason: "none",
      screenCount: 0,
      fixtureImageHash: "f".repeat(64),
    },
  });

  const jiraArtifact = await readFile(
    jira.result.jiraIssueIrArtifactPath,
    "utf8",
  );
  const provenanceArtifact = await readFile(
    jira.result.pasteProvenanceArtifactPath,
    "utf8",
  );
  const compiledArtifact = JSON.stringify(compiled.artifacts);

  for (const raw of [fullName, email, iban, pan]) {
    assert.equal(jiraArtifact.includes(raw), false, raw);
    assert.equal(provenanceArtifact.includes(raw), false, raw);
    assert.equal(compiledArtifact.includes(raw), false, raw);
  }
});

test("multi-source-pii-leakage: property redacts email-shaped custom context values deterministically", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc
        .tuple(
          fc.string({ minLength: 3, maxLength: 12, unit: fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))) }),
          fc.string({ minLength: 3, maxLength: 8, unit: fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))) }),
        )
        .map(([local, domain]) => `${local}@${domain}.example`),
      async (email) => {
        const result = canonicalizeCustomContextMarkdown(`- Contact: ${email}\n`);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        const serialized = JSON.stringify(result.value);
        assert.equal(serialized.includes(email), false);
      },
    ),
    { seed: 20260427, numRuns: 256 },
  );
});
