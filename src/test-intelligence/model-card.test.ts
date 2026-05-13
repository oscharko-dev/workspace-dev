/**
 * Tests for the EU AI Act Article 13 model card generator (Issue #2112).
 *
 * Covers:
 *   - The generator pulls every section from compile-time data sources:
 *     routing policy (#2099), calibration ECE thresholds (#2107), domain
 *     invariants (#2108), inter-rater κ thresholds (#2109), faithfulness
 *     gates.
 *   - Output is byte-stable: two consecutive builds with the same input
 *     produce identical JSON and markdown.
 *   - The hand-rolled validator accepts the produced card and rejects
 *     malformed payloads.
 *   - The committed `docs/eu-ai-act/model-cards/eu-banking-default.*`
 *     artefacts are in lock-step with the generator (drift gate).
 *   - Markdown rendering enumerates every section the issue's
 *     acceptance criteria require.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  MODEL_ROUTING_ROLES,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
} from "../contracts/index.js";
import {
  CALIBRATION_ECE_THRESHOLDS,
  CALIBRATION_RISK_CATEGORIES,
} from "./calibration-metrics.js";
import { buildActiveDatasetInvariantRegistry } from "./domain-invariant-registry.js";
import { FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS } from "./faithfulness-eval.js";
import {
  INTER_RATER_GATE_THRESHOLDS,
  INTER_RATER_KAPPA_HARD_FLOOR,
  INTER_RATER_KAPPA_WARN_FLOOR,
  INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
  INTER_RATER_REVIEWER_SHARE_HARD_CAP,
  INTER_RATER_REVIEWER_SHARE_WARN_CAP,
} from "./inter-rater-agreement.js";
import {
  EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY,
  computeModelRoutingPolicyDigest,
} from "./model-routing-policy.js";
import {
  MODEL_CARD_DOCS_DIRNAME,
  MODEL_CARD_GENERATED_AT_PIN,
  MODEL_CARD_JSON_FILENAME_SUFFIX,
  MODEL_CARD_MD_FILENAME_SUFFIX,
  MODEL_CARD_SCHEMA_VERSION,
  buildModelCard,
  computeModelCardDigest,
  isModelCard,
  renderModelCardMarkdown,
  serializeModelCard,
} from "./model-card.js";
import { PROVIDER_TRAINING_DATA_STATEMENTS } from "./model-card-provider-statements.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const FIXED_GENERATED_AT = MODEL_CARD_GENERATED_AT_PIN;

const buildFixture = () =>
  buildModelCard({ generatedAt: FIXED_GENERATED_AT });

test("buildModelCard: pins schema and contract versions on the envelope", () => {
  const card = buildFixture();
  assert.equal(card.schemaVersion, MODEL_CARD_SCHEMA_VERSION);
  assert.equal(card.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(card.generatedAt, FIXED_GENERATED_AT);
});

test("buildModelCard: identity carries routing policy digest", () => {
  const card = buildFixture();
  assert.equal(card.identity.profileId, EU_BANKING_DEFAULT_POLICY_PROFILE_ID);
  assert.equal(
    card.identity.profileVersion,
    EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  );
  assert.equal(
    card.identity.routingPolicyId,
    EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY.policyId,
  );
  assert.equal(
    card.identity.routingPolicyVersion,
    EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY.policyVersion,
  );
  assert.equal(
    card.identity.routingPolicyDigest,
    computeModelRoutingPolicyDigest(EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY),
  );
  assert.match(card.identity.cardId, /^eu-banking-default@/);
  assert.match(card.identity.routingPolicyDigest, /^[0-9a-f]{64}$/);
});

test("buildModelCard: deployments section mirrors routing policy routes", () => {
  const card = buildFixture();
  assert.equal(
    card.deployments.length,
    EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY.routes.length,
  );
  for (const deployment of card.deployments) {
    assert.ok(
      (MODEL_ROUTING_ROLES as readonly string[]).includes(deployment.role),
      `deployment role "${deployment.role}" must be a registered routing role`,
    );
    assert.equal(deployment.providerId, "azure-ai-foundry");
    assert.equal(deployment.region, "eu");
    assert.ok(deployment.tierDescription.length > 0);
  }
});

test("buildModelCard: deployments are sorted (role, slot, tierLabel)", () => {
  const card = buildFixture();
  for (let index = 1; index < card.deployments.length; index += 1) {
    const previous = card.deployments[index - 1]!;
    const current = card.deployments[index]!;
    const cmp =
      previous.role.localeCompare(current.role, "en") ||
      previous.slot.localeCompare(current.slot, "en") ||
      previous.tierLabel.localeCompare(current.tierLabel, "en");
    assert.ok(cmp <= 0, `deployments out of order at index ${index}`);
  }
});

test("buildModelCard: architecture role summary covers every routing role", () => {
  const card = buildFixture();
  const summarisedRoles = new Set(
    card.architecture.roleSummary.map((entry) => entry.role),
  );
  for (const role of MODEL_ROUTING_ROLES) {
    assert.ok(
      summarisedRoles.has(role),
      `architecture.roleSummary missing role "${role}"`,
    );
  }
  for (const entry of card.architecture.roleSummary) {
    assert.ok(entry.description.length > 0);
  }
  assert.ok(card.architecture.safetyControls.length >= 5);
});

test("buildModelCard: performance.calibrationEce mirrors CALIBRATION_ECE_THRESHOLDS", () => {
  const card = buildFixture();
  for (const riskCategory of CALIBRATION_RISK_CATEGORIES) {
    const entry = card.performance.calibrationEce.find(
      (row) => row.riskCategory === riskCategory,
    );
    assert.ok(entry, `missing ECE entry for ${riskCategory}`);
    assert.equal(
      entry.maxExpectedCalibrationError,
      CALIBRATION_ECE_THRESHOLDS[riskCategory],
    );
    assert.ok(entry.description.length > 0);
  }
});

test("buildModelCard: performance.judgeAccuracy reflects exported κ thresholds", () => {
  const card = buildFixture();
  const judge = card.performance.judgeAccuracy;
  assert.equal(judge.kappaHardFloor, INTER_RATER_KAPPA_HARD_FLOOR);
  assert.equal(judge.kappaWarnFloor, INTER_RATER_KAPPA_WARN_FLOOR);
  assert.equal(
    judge.perScenarioGateMinPairs,
    INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
  );
  assert.equal(
    judge.reviewerShareHardCap,
    INTER_RATER_REVIEWER_SHARE_HARD_CAP,
  );
  assert.equal(
    judge.reviewerShareWarnCap,
    INTER_RATER_REVIEWER_SHARE_WARN_CAP,
  );
  assert.equal(judge.kappaHardFloor, INTER_RATER_GATE_THRESHOLDS.kappaHardFloor);
});

test("buildModelCard: performance.faithfulnessGates surfaces every threshold", () => {
  const card = buildFixture();
  const gateMetrics = new Set(
    card.performance.faithfulnessGates.map((gate) => gate.metric),
  );
  for (const metric of [
    "fieldCoverageRatio",
    "actionCoverageRatio",
    "traceFidelityScore",
    "hallucinatedIdRate",
  ]) {
    assert.ok(gateMetrics.has(metric), `missing faithfulness gate ${metric}`);
  }
  const fieldGate = card.performance.faithfulnessGates.find(
    (g) => g.metric === "fieldCoverageRatio",
  );
  assert.equal(
    fieldGate!.threshold,
    FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.fieldCoverageRatio,
  );
  const hallucinationGate = card.performance.faithfulnessGates.find(
    (g) => g.metric === "hallucinatedIdRate",
  );
  assert.equal(hallucinationGate!.bound, "maximum");
});

test("buildModelCard: domainInvariants enumerates every registered invariant with deterministic ordering", () => {
  const card = buildFixture();
  const registry = buildActiveDatasetInvariantRegistry();
  assert.equal(
    card.domainInvariants.registeredCount,
    registry.list().length,
  );
  const ids = card.domainInvariants.invariants.map((inv) => inv.invariantId);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, "en"));
  assert.deepEqual(ids, sorted);
  // Each EU banking compliance invariant should carry a legalSource entry.
  for (const inv of card.domainInvariants.invariants) {
    if (inv.invariantId.startsWith("INV-PSD2") || inv.invariantId.startsWith("INV-MIFID")) {
      assert.ok(inv.framework, `invariant ${inv.invariantId} missing framework`);
      assert.ok(inv.citation, `invariant ${inv.invariantId} missing citation`);
    }
  }
});

test("buildModelCard: trainingDataLineage carries provider statements with valid metadata", () => {
  const card = buildFixture();
  assert.ok(card.trainingDataLineage.summary.length > 0);
  assert.ok(card.trainingDataLineage.note.length > 0);
  assert.equal(
    card.trainingDataLineage.providerStatements.length,
    PROVIDER_TRAINING_DATA_STATEMENTS.length,
  );
  for (const statement of card.trainingDataLineage.providerStatements) {
    assert.ok(statement.providerId.length > 0);
    assert.ok(["transcribed-verbatim", "paraphrased", "unavailable"].includes(statement.fidelity));
    assert.match(statement.transcribedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(statement.sourceUrl, /^https?:\/\//);
    assert.ok(statement.statement.length > 0);
  }
});

test("buildModelCard: intendedUse and limitations are non-empty", () => {
  const card = buildFixture();
  assert.ok(card.intendedUse.primaryUseCase.length > 0);
  assert.ok(card.intendedUse.outOfScope.length > 0);
  assert.ok(card.intendedUse.intendedUsers.length > 0);
  assert.ok(card.intendedUse.operationalContext.length > 0);
  assert.ok(card.limitations.knownFailureModes.length > 0);
  assert.ok(card.limitations.unsupportedLocales.length > 0);
  assert.ok(card.limitations.edgeCases.length > 0);
});

test("buildModelCard: calibrationProvenance + updateCadence are populated", () => {
  const card = buildFixture();
  assert.ok(card.calibrationProvenance.goldSetComposition.length > 0);
  assert.ok(card.calibrationProvenance.interRaterProtocol.length > 0);
  assert.ok(card.calibrationProvenance.reviewerRotation.length > 0);
  assert.ok(card.updateCadence.driftDetectionTriggers.length > 0);
  assert.ok(card.updateCadence.recalibrationSchedule.length > 0);
});

test("buildModelCard: rejects non-ISO timestamps", () => {
  assert.throws(
    () => buildModelCard({ generatedAt: "not-a-date" }),
    /generatedAt must be ISO-8601/,
  );
});

test("serializeModelCard: byte-stable across two builds with same input", () => {
  const card1 = buildFixture();
  const card2 = buildFixture();
  assert.equal(serializeModelCard(card1), serializeModelCard(card2));
  assert.equal(renderModelCardMarkdown(card1), renderModelCardMarkdown(card2));
});

test("computeModelCardDigest: identical inputs produce identical digests", () => {
  const card1 = buildFixture();
  const card2 = buildFixture();
  assert.equal(computeModelCardDigest(card1), computeModelCardDigest(card2));
  assert.match(computeModelCardDigest(card1), /^[0-9a-f]{64}$/);
});

test("isModelCard: accepts a freshly built card and rejects malformed payloads", () => {
  const card = buildFixture();
  assert.equal(isModelCard(card), true);
  assert.equal(isModelCard(null), false);
  assert.equal(isModelCard({}), false);
  assert.equal(
    isModelCard({ ...card, schemaVersion: "0.0.0" }),
    false,
    "wrong schemaVersion should fail validator",
  );
  assert.equal(
    isModelCard({ ...card, generatedAt: "yesterday" }),
    false,
    "non-ISO generatedAt should fail validator",
  );
  assert.equal(
    isModelCard({ ...card, deployments: [] }),
    false,
    "empty deployments should fail validator",
  );
  assert.equal(
    isModelCard({
      ...card,
      identity: { ...card.identity, routingPolicyDigest: "not-a-hash" },
    }),
    false,
    "non-hex digest should fail validator",
  );
});

test("renderModelCardMarkdown: ends with a single trailing newline and contains every required heading", () => {
  const md = renderModelCardMarkdown(buildFixture());
  assert.ok(md.endsWith("\n"), "markdown must end with newline");
  assert.ok(!md.endsWith("\n\n\n"), "markdown must not end with multiple newlines");
  for (const heading of [
    "# Model card",
    "## 1. Intended use",
    "### Out of scope",
    "## 2. System architecture",
    "## 3. Per-role model deployments",
    "## 4. Training data lineage",
    "## 5. Performance",
    "### 5.1 Faithfulness gates",
    "### 5.2 Calibration (ECE per risk class)",
    "### 5.3 Judge accuracy (inter-rater κ)",
    "## 6. Limitations",
    "## 7. Calibration provenance",
    "## 8. Domain-invariant catalog",
    "## 9. Update cadence",
  ]) {
    assert.ok(md.includes(heading), `markdown missing heading "${heading}"`);
  }
});

test("renderModelCardMarkdown: deployment table includes every deployment", () => {
  const card = buildFixture();
  const md = renderModelCardMarkdown(card);
  for (const deployment of card.deployments) {
    assert.ok(
      md.includes(deployment.modelId),
      `markdown missing deployment "${deployment.modelId}"`,
    );
  }
});

test("renderModelCardMarkdown: deployment table escapes backslashes, pipes, and newlines", () => {
  const card = buildFixture();
  const firstDeployment = card.deployments[0];
  assert.ok(firstDeployment, "fixture must include at least one deployment");
  const md = renderModelCardMarkdown({
    ...card,
    deployments: [
      {
        ...firstDeployment,
        modelId: "aoai\\prod|blue\nslot",
      },
      ...card.deployments.slice(1),
    ],
  });

  assert.match(md, /aoai\\\\prod\\\|blue slot/u);
});

test("docs alignment: committed model card artefacts match the generator output", async () => {
  const card = buildModelCard({ generatedAt: FIXED_GENERATED_AT });
  const expectedJson = serializeModelCard(card);
  const expectedMd = renderModelCardMarkdown(card);

  const dir = path.join(repoRoot, MODEL_CARD_DOCS_DIRNAME);
  const jsonPath = path.join(
    dir,
    `${EU_BANKING_DEFAULT_POLICY_PROFILE_ID}${MODEL_CARD_JSON_FILENAME_SUFFIX}`,
  );
  const mdPath = path.join(
    dir,
    `${EU_BANKING_DEFAULT_POLICY_PROFILE_ID}${MODEL_CARD_MD_FILENAME_SUFFIX}`,
  );

  const onDiskJson = await readFile(jsonPath, "utf8");
  const onDiskMd = await readFile(mdPath, "utf8");

  // Cards on disk are pinned to FIXED_GENERATED_AT (stamp-day) so the
  // committed artefacts match the deterministic build.
  assert.equal(
    onDiskJson,
    expectedJson,
    `${jsonPath} drifted from generator output`,
  );
  assert.equal(
    onDiskMd,
    expectedMd,
    `${mdPath} drifted from generator output`,
  );
});
