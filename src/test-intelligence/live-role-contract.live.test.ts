import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveVisualSidecarBundle,
  parseTestIntelligenceRunArgs,
} from "../test-intelligence-run-cli.js";
import {
  formatLiveRoleContractSmokeReport,
  runLiveRoleContractSmoke,
} from "./live-role-contract-smoke.js";
import {
  findMissingRequiredLiveEnv,
  formatMissingRequiredLiveEnvMessage,
  isLiveSmokeEnabled,
  LIVE_SMOKE_SKIP_MESSAGE,
  requireLiveSmokeApiKey,
} from "./visual-sidecar-client.live-env.js";

test("live role contract smoke: every configured role satisfies its runtime contract", async (t) => {
  if (!isLiveSmokeEnabled()) {
    t.skip(LIVE_SMOKE_SKIP_MESSAGE);
    return;
  }

  const missing = findMissingRequiredLiveEnv();
  assert.deepEqual(missing, [], formatMissingRequiredLiveEnvMessage(missing));
  requireLiveSmokeApiKey("live role-contract smoke");

  const options = parseTestIntelligenceRunArgs(
    [
      "--figma-json-file",
      "/tmp/workspace-dev-live-role-contract-smoke.json",
      "--enable-visual-sidecar",
    ],
    process.env,
  );
  const bundle = buildLiveVisualSidecarBundle(options, process.env);

  const report = await runLiveRoleContractSmoke(bundle);
  const formatted = formatLiveRoleContractSmokeReport(report);
  process.stdout.write(`${formatted}\n`);
  assert.equal(report.ok, true, formatted);
});
