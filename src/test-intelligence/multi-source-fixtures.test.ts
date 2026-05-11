import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_CONFLICT_RESOLUTION_POLICIES,
  ALLOWED_TEST_INTENT_SOURCE_KINDS,
} from "../contracts/index.js";
import {
  isWave4ProductionReadinessFixtureId,
  loadWave4ProductionReadinessFixture,
  WAVE4_PRODUCTION_READINESS_FIXTURE_IDS,
} from "./multi-source-fixtures.js";
import { validateMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";

const EXPECTED_NEGATIVE_FIXTURE_REFUSALS = {
  "release-multisource-all-sources-with-conflict":
    "duplicate_jira_paste_collision",
  "release-multisource-custom-markdown-adversarial":
    "primary_source_required",
} as const;

test("multi-source-fixtures: ships every Wave 4.I production-readiness fixture id", () => {
  assert.equal(WAVE4_PRODUCTION_READINESS_FIXTURE_IDS.length, 12);
  assert.ok(
    WAVE4_PRODUCTION_READINESS_FIXTURE_IDS.includes(
      "release-multisource-onboarding",
    ),
  );
  assert.ok(
    WAVE4_PRODUCTION_READINESS_FIXTURE_IDS.includes(
      "release-multisource-payment-with-conflict",
    ),
  );
  assert.ok(
    WAVE4_PRODUCTION_READINESS_FIXTURE_IDS.includes(
      "release-multisource-custom-markdown-adversarial",
    ),
  );
});

test("multi-source-fixtures: isWave4ProductionReadinessFixtureId is a precise type guard", () => {
  assert.equal(
    isWave4ProductionReadinessFixtureId("release-multisource-onboarding"),
    true,
  );
  assert.equal(isWave4ProductionReadinessFixtureId("nope"), false);
  assert.equal(isWave4ProductionReadinessFixtureId(""), false);
  assert.equal(isWave4ProductionReadinessFixtureId(undefined), false);
  assert.equal(isWave4ProductionReadinessFixtureId(123 as unknown), false);
});

test("multi-source-fixtures: loadWave4ProductionReadinessFixture refuses unknown ids", async () => {
  await assert.rejects(
    () => loadWave4ProductionReadinessFixture("nope" as never),
    /unknown fixtureId/,
  );
});

for (const fixtureId of WAVE4_PRODUCTION_READINESS_FIXTURE_IDS) {
  test(`multi-source-fixtures: ${fixtureId} loads with a valid envelope shape`, async () => {
    const fixture = await loadWave4ProductionReadinessFixture(fixtureId);
    assert.equal(fixture.fixtureId, fixtureId);
    assert.match(
      fixture.envelopePath,
      new RegExp(`${fixtureId}\\.envelope\\.json$`),
    );
    const envelope = fixture.envelope;
    assert.equal(envelope.version, "1.0.0");
    assert.ok(Array.isArray(envelope.sources));
    assert.ok(envelope.sources.length >= 1);
    assert.ok(
      (ALLOWED_CONFLICT_RESOLUTION_POLICIES as readonly string[]).includes(
        envelope.conflictResolutionPolicy,
      ),
    );
    for (const ref of envelope.sources) {
      assert.ok(typeof ref.sourceId === "string");
      assert.ok(
        (ALLOWED_TEST_INTENT_SOURCE_KINDS as readonly string[]).includes(
          ref.kind,
        ),
        `unexpected kind ${ref.kind}`,
      );
      assert.match(
        ref.contentHash,
        /^[0-9a-f]{64}$/,
        `bad contentHash on ${ref.sourceId}`,
      );
      assert.match(
        ref.capturedAt,
        /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/,
      );
    }
    assert.match(envelope.aggregateContentHash, /^[0-9a-f]{64}$/);
  });
}

for (const fixtureId of WAVE4_PRODUCTION_READINESS_FIXTURE_IDS) {
  const expectedRefusal =
    EXPECTED_NEGATIVE_FIXTURE_REFUSALS[
      fixtureId as keyof typeof EXPECTED_NEGATIVE_FIXTURE_REFUSALS
    ];

  test(`multi-source-fixtures: ${fixtureId} has expected validator outcome`, async () => {
    const fixture = await loadWave4ProductionReadinessFixture(fixtureId);
    const validation = validateMultiSourceTestIntentEnvelope(fixture.envelope);
    if (expectedRefusal === undefined) {
      assert.equal(validation.ok, true);
      return;
    }
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(
        validation.issues.some((issue) => issue.code === expectedRefusal),
        true,
      );
    }
  });
}

test("multi-source-fixtures: onboarding fixture exposes figma + jira-rest + custom JSON inputs", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  assert.notEqual(fixture.figmaJson, undefined);
  assert.notEqual(fixture.visualJson, undefined);
  assert.notEqual(fixture.jiraRestResponse, undefined);
  assert.notEqual(fixture.customContextJson, undefined);
  assert.equal(fixture.jiraPasteText, undefined);
  assert.equal(fixture.customContextMarkdown, undefined);
});

test("multi-source-fixtures: paste-only fixture omits Figma / REST inputs", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-paste-only-airgap",
  );
  assert.equal(fixture.figmaJson, undefined);
  assert.equal(fixture.jiraRestResponse, undefined);
  assert.notEqual(fixture.jiraPasteText, undefined);
});

test("multi-source-fixtures: markdown adversarial fixture exposes markdown body only", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-custom-markdown-adversarial",
  );
  assert.equal(fixture.figmaJson, undefined);
  assert.equal(fixture.jiraRestResponse, undefined);
  assert.equal(fixture.jiraPasteText, undefined);
  assert.equal(fixture.customContextJson, undefined);
  assert.notEqual(fixture.customContextMarkdown, undefined);
  assert.match(
    fixture.customContextMarkdown ?? "",
    /<script>alert\(1\)<\/script>/u,
  );
});

test("multi-source-fixtures: payment-with-conflict fixture exposes a Jira input (paste or REST)", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-payment-with-conflict",
  );
  const hasJiraInput =
    fixture.jiraPasteText !== undefined ||
    fixture.jiraRestResponse !== undefined;
  assert.equal(hasJiraInput, true);
});

test("multi-source-fixtures: air-gap fixtures omit Figma JSON", async () => {
  const pasteAirgap = await loadWave4ProductionReadinessFixture(
    "release-multisource-paste-only-airgap",
  );
  const jiraPasteAirgap = await loadWave4ProductionReadinessFixture(
    "release-multisource-jira-paste-only-airgap",
  );
  assert.equal(pasteAirgap.figmaJson, undefined);
  assert.equal(jiraPasteAirgap.figmaJson, undefined);
});

test("multi-source-fixtures: onboarding fixture envelope has version 1.0.0 and >=1 source", async () => {
  const fixture = await loadWave4ProductionReadinessFixture(
    "release-multisource-onboarding",
  );
  assert.equal(fixture.envelope.version, "1.0.0");
  assert.ok(fixture.envelope.sources.length >= 1);
});
