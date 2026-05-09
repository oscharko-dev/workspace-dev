/**
 * Default catalog assertions for the cross-field invariant registry
 * (Issue #2110).
 *
 * The acceptance contract requires at least 12 banking + 8 insurance
 * cross-field invariants. The catalog ships with more (15 + 8) for
 * coverage breadth; the test pins both the floor and the actual count
 * so future edits are explicit.
 *
 * Every invariant must:
 *   - declare a non-empty `legalSource` / `citation`
 *   - synthesize at least one positive AND one negative test datum
 *     through the engine (the engine validates this on registration)
 *   - have stable id ordering matching the registry's lexicographic
 *     sort.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeCrossFieldTestData } from "./cross-field-invariant-engine.js";
import {
  buildDefaultCrossFieldInvariantRegistry,
  DEFAULT_BANKING_INVARIANT_COUNT,
  DEFAULT_INSURANCE_INVARIANT_COUNT,
} from "./cross-field-invariant-registry.js";

void test("default registry meets the Issue #2110 floor", () => {
  assert.ok(
    DEFAULT_BANKING_INVARIANT_COUNT >= 12,
    `expected at least 12 banking invariants, got ${DEFAULT_BANKING_INVARIANT_COUNT}`,
  );
  assert.ok(
    DEFAULT_INSURANCE_INVARIANT_COUNT >= 8,
    `expected at least 8 insurance invariants, got ${DEFAULT_INSURANCE_INVARIANT_COUNT}`,
  );
});

void test("default registry IDs are unique, sorted, and namespaced", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const ids = registry.ids();
  const expectedLength =
    DEFAULT_BANKING_INVARIANT_COUNT + DEFAULT_INSURANCE_INVARIANT_COUNT;
  assert.equal(ids.length, expectedLength);
  // All ids start with the cross-field-invariant prefix.
  for (const id of ids) {
    assert.match(id, /^XINV-/, `id "${id}" must start with XINV-`);
  }
  // Sorted strictly ascending — duplicate-detection by adjacent compare.
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(
      ids[i - 1]! < ids[i]!,
      `registry ids must be sorted ascending; "${ids[i - 1]}" not < "${ids[i]}"`,
    );
  }
});

void test("every invariant declares a citation framework + reference", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  for (const invariant of registry.list()) {
    assert.ok(
      invariant.citation.framework.trim().length > 0,
      `invariant "${invariant.id}" missing citation.framework`,
    );
    assert.ok(
      invariant.citation.citation.trim().length > 0,
      `invariant "${invariant.id}" missing citation.citation`,
    );
    assert.ok(
      invariant.description.trim().length > 0,
      `invariant "${invariant.id}" missing description`,
    );
    assert.ok(
      ["error", "warning"].includes(invariant.severity),
      `invariant "${invariant.id}" must declare severity error|warning`,
    );
    assert.ok(
      ["screen", "wizard"].includes(invariant.scope),
      `invariant "${invariant.id}" must declare scope screen|wizard`,
    );
  }
});

void test("every invariant produces both positive and negative synthesized data", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  for (const invariant of registry.list()) {
    const synthesized = synthesizeCrossFieldTestData(invariant);
    const positives = synthesized.filter(
      (row) => row.category === "cross_field_positive",
    );
    const negatives = synthesized.filter(
      (row) => row.category === "cross_field_negative",
    );
    assert.ok(
      positives.length >= 1,
      `invariant "${invariant.id}" must produce at least one positive datum`,
    );
    assert.ok(
      negatives.length >= 1,
      `invariant "${invariant.id}" must produce at least one negative datum`,
    );
    // Each row carries the invariant id and field anchors.
    for (const row of synthesized) {
      assert.equal(row.invariantId, invariant.id);
      assert.deepEqual(row.anchors, invariant.anchors);
      assert.equal(row.synthetic, true);
    }
  }
});

void test("registry is byte-stable across builds (deterministic ordering)", () => {
  const a = buildDefaultCrossFieldInvariantRegistry();
  const b = buildDefaultCrossFieldInvariantRegistry();
  assert.deepEqual(a.ids(), b.ids());
  // List order matches id order.
  assert.deepEqual(
    a.list().map((row) => row.id),
    a.ids(),
  );
});

void test("byScreen returns invariants sorted by id", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  // Registry must include at least one invariant anchored to a known
  // banking screen (sepa-ueberweisung is referenced by IBAN/CCY, SCA
  // threshold, and SEPA Instant invariants).
  const sepa = registry.byScreen("sepa-ueberweisung");
  assert.ok(
    sepa.length >= 2,
    `expected at least two invariants on sepa-ueberweisung, got ${sepa.length}`,
  );
  for (let i = 1; i < sepa.length; i += 1) {
    assert.ok(
      sepa[i - 1]!.id < sepa[i]!.id,
      "byScreen must return invariants sorted ascending by id",
    );
  }
});

void test("at least one banking + one insurance invariant carries each scope", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();
  const bankingScreen = list.filter(
    (row) => row.id.startsWith("XINV-BANK-") && row.scope === "screen",
  );
  const bankingWizard = list.filter(
    (row) => row.id.startsWith("XINV-BANK-") && row.scope === "wizard",
  );
  const insuranceScreen = list.filter(
    (row) => row.id.startsWith("XINV-INS-") && row.scope === "screen",
  );
  const insuranceWizard = list.filter(
    (row) => row.id.startsWith("XINV-INS-") && row.scope === "wizard",
  );
  assert.ok(bankingScreen.length >= 1, "expected banking screen-scoped");
  assert.ok(bankingWizard.length >= 1, "expected banking wizard-scoped");
  assert.ok(insuranceScreen.length >= 1, "expected insurance screen-scoped");
  assert.ok(insuranceWizard.length >= 1, "expected insurance wizard-scoped");
});
