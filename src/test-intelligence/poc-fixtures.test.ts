import assert from "node:assert/strict";
import test from "node:test";

import { WAVE1_POC_FIXTURE_IDS } from "../contracts/index.js";
import { isWave1PocFixtureId, loadWave1PocFixture } from "./poc-fixtures.js";

const ALL_FIXTURES = WAVE1_POC_FIXTURE_IDS;

test("poc-fixtures: ships at least one onboarding and one payment-style fixture", () => {
  assert.ok(ALL_FIXTURES.length >= 2, "expected at least two POC fixtures");
  assert.ok(ALL_FIXTURES.includes("poc-onboarding"));
  assert.ok(ALL_FIXTURES.includes("poc-payment-auth"));
});

test("poc-fixtures: isWave1PocFixtureId is a precise type guard", () => {
  assert.equal(isWave1PocFixtureId("poc-onboarding"), true);
  assert.equal(isWave1PocFixtureId("poc-payment-auth"), true);
  assert.equal(isWave1PocFixtureId("not-a-fixture"), false);
  assert.equal(isWave1PocFixtureId(""), false);
  assert.equal(isWave1PocFixtureId(undefined), false);
  assert.equal(isWave1PocFixtureId(123 as unknown), false);
});

test("poc-fixtures: loadWave1PocFixture refuses unknown ids", async () => {
  await assert.rejects(
    () => loadWave1PocFixture("nope" as never),
    /unknown fixtureId/,
  );
});

for (const fixtureId of ALL_FIXTURES) {
  test(`poc-fixtures: ${fixtureId} loads with figma + visual payloads`, async () => {
    const fixture = await loadWave1PocFixture(fixtureId);
    assert.equal(fixture.fixtureId, fixtureId);
    assert.ok(fixture.figma.screens.length > 0);
    assert.ok(fixture.visual.length > 0);
    assert.match(fixture.figmaPath, new RegExp(`${fixtureId}\\.figma\\.json$`));
    assert.match(
      fixture.visualPath,
      new RegExp(`${fixtureId}\\.visual\\.json$`),
    );
    // Each Figma screen has at least one node and the visual sidecar covers
    // the same screens (exact subset, not necessarily 1:1).
    const figmaScreenIds = new Set(
      fixture.figma.screens.map((s) => s.screenId),
    );
    for (const visual of fixture.visual) {
      assert.ok(
        figmaScreenIds.has(visual.screenId),
        `visual sidecar describes unknown screenId ${visual.screenId}`,
      );
      assert.ok(visual.regions.length > 0);
    }
  });
}

test("poc-fixtures: ships at least one visual image or mask fixture", async () => {
  const fixtures = await Promise.all(
    ALL_FIXTURES.map((fixtureId) => loadWave1PocFixture(fixtureId)),
  );
  const withImage = fixtures.filter(
    (fixture) => fixture.visualImageSha256 !== undefined,
  );
  assert.ok(withImage.length > 0, "expected a colocated visual image/mask");
  for (const fixture of withImage) {
    assert.match(fixture.visualImagePath ?? "", /\.mask\.svg$/);
    assert.match(fixture.visualImageSha256 ?? "", /^[0-9a-f]{64}$/);
  }
});
