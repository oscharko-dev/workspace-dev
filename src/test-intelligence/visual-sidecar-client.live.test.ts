import assert from "node:assert/strict";
import test from "node:test";

import type { VisualScreenDescription } from "../contracts/index.js";
import {
  buildLiveVisualSidecarBundle,
  parseTestIntelligenceRunArgs,
} from "../test-intelligence-run-cli.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import {
  loadWave1ValidationCaptureFixture,
  loadWave1ValidationFixture,
} from "./validation-fixtures.js";
import {
  findMissingRequiredLiveEnv,
  formatMissingRequiredLiveEnvMessage,
  isLiveSmokeEnabled,
  LIVE_SMOKE_SKIP_MESSAGE,
  requireLiveSmokeApiKey,
} from "./visual-sidecar-client.live-env.js";
import { describeVisualScreens } from "./visual-sidecar-client.js";

test("live visual sidecar smoke: fixture capture describes through role-separated Azure deployments", async (t) => {
  if (!isLiveSmokeEnabled()) {
    t.skip(LIVE_SMOKE_SKIP_MESSAGE);
    return;
  }

  const missing = findMissingRequiredLiveEnv();
  assert.deepEqual(
    missing,
    [],
    formatMissingRequiredLiveEnvMessage(missing),
  );
  requireLiveSmokeApiKey("live visual-sidecar smoke");

  const fixture = await loadWave1ValidationFixture("validation-onboarding");
  const { captures } = await loadWave1ValidationCaptureFixture(
    "validation-onboarding",
  );
  const options = parseTestIntelligenceRunArgs(
    [
      "--figma-json-file",
      "/tmp/workspace-dev-live-visual-sidecar-smoke.json",
      "--enable-visual-sidecar",
    ],
    process.env,
  );
  const bundle = buildLiveVisualSidecarBundle(options, process.env);

  const { result } = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-live-visual-sidecar-smoke",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: deriveBusinessTestIntentIr({ figma: fixture.figma }),
    primaryDeployment: bundle.visualPrimary.deployment,
  });

  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.ok(result.visual.length > 0);
  assert.ok(result.visual.every(hasKnownScreenId));
  assert.equal(result.captureIdentities.length, captures.length);
  assert.equal(
    bundle.testGeneration.declaredCapabilities.imageInputSupport,
    false,
  );
});

const hasKnownScreenId = (screen: VisualScreenDescription): boolean =>
  typeof screen.screenId === "string" && screen.screenId.length > 0;
