import assert from "node:assert/strict";
import test from "node:test";

import { WAVE1_VALIDATION_FIXTURE_IDS } from "../contracts/index.js";
import { isWave1ValidationFixtureId, loadWave1ValidationFixture } from "./validation-fixtures.js";

const ALL_FIXTURES = WAVE1_VALIDATION_FIXTURE_IDS;

test("validation-fixtures: ships at least one onboarding and one payment-style fixture", () => {
  assert.ok(ALL_FIXTURES.length >= 2, "expected at least two validation fixtures");
  assert.ok(ALL_FIXTURES.includes("validation-onboarding"));
  assert.ok(ALL_FIXTURES.includes("validation-payment-auth"));
});

test("validation-fixtures: isWave1ValidationFixtureId is a precise type guard", () => {
  assert.equal(isWave1ValidationFixtureId("validation-onboarding"), true);
  assert.equal(isWave1ValidationFixtureId("validation-payment-auth"), true);
  assert.equal(isWave1ValidationFixtureId("not-a-fixture"), false);
  assert.equal(isWave1ValidationFixtureId(""), false);
  assert.equal(isWave1ValidationFixtureId(undefined), false);
  assert.equal(isWave1ValidationFixtureId(123 as unknown), false);
});

test("validation-fixtures: loadWave1ValidationFixture refuses unknown ids", async () => {
  await assert.rejects(
    () => loadWave1ValidationFixture("nope" as never),
    /unknown fixtureId/,
  );
});

for (const fixtureId of ALL_FIXTURES) {
  test(`validation-fixtures: ${fixtureId} loads with figma + visual payloads`, async () => {
    const fixture = await loadWave1ValidationFixture(fixtureId);
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

test("validation-fixtures: ships at least one visual image or mask fixture", async () => {
  const fixtures = await Promise.all(
    ALL_FIXTURES.map((fixtureId) => loadWave1ValidationFixture(fixtureId)),
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
