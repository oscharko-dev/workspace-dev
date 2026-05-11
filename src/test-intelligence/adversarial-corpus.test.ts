/**
 * Adversarial corpus CI gate (Issue #2122).
 *
 * Loads `fixtures/adversarial-corpus/catalog.json`, asserts shape +
 * coverage invariants, then runs every entry through its corresponding
 * defense layer and asserts the observed report matches the entry's
 * declared expected outcome. Failure modes:
 *
 *   - structural defects in the catalog (missing field, wrong enum, ...)
 *   - any entry's defense outcome differs from `expectedOutcome`
 *   - fewer than `ADVERSARIAL_CORPUS_MIN_ENTRY_COUNT` entries
 *   - any required AC category has zero entries
 *   - quarterly review checkpoint has passed without an update
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADVERSARIAL_CORPUS_CATEGORIES,
  ADVERSARIAL_CORPUS_MIN_ENTRY_COUNT,
  ADVERSARIAL_CORPUS_SCHEMA_VERSION,
  adversarialCorpusCoversAllRequiredCategories,
  isAdversarialCorpusReviewOverdue,
  loadAdversarialCorpus,
  loadAndRunAdversarialCorpusGate,
  runAdversarialCorpusGate,
  validateAdversarialCorpus,
  type AdversarialCorpus,
  type AdversarialCorpusEntry,
} from "./adversarial-corpus.js";

const loadOnce = (() => {
  let cached: Promise<AdversarialCorpus> | null = null;
  return (): Promise<AdversarialCorpus> => {
    if (cached === null) cached = loadAdversarialCorpus();
    return cached;
  };
})();

describe("adversarial-corpus: catalog shape", () => {
  test("loads with the expected schemaVersion", async () => {
    const corpus = await loadOnce();
    assert.equal(corpus.schemaVersion, ADVERSARIAL_CORPUS_SCHEMA_VERSION);
  });

  test("declares every required category from the AC", async () => {
    const corpus = await loadOnce();
    const declared = new Set(corpus.categories.map((c) => c.id));
    for (const required of ADVERSARIAL_CORPUS_CATEGORIES) {
      assert.ok(
        declared.has(required),
        `category ${required} missing from declared list`,
      );
    }
  });

  test("has at least the minimum entry count", async () => {
    const corpus = await loadOnce();
    assert.ok(
      corpus.entries.length >= ADVERSARIAL_CORPUS_MIN_ENTRY_COUNT,
      `expected >= ${ADVERSARIAL_CORPUS_MIN_ENTRY_COUNT} entries, got ${corpus.entries.length}`,
    );
  });

  test("every required category has at least one entry", async () => {
    const corpus = await loadOnce();
    assert.ok(
      adversarialCorpusCoversAllRequiredCategories(corpus),
      "at least one required category has zero entries",
    );
  });

  test("entry ids are unique", async () => {
    const corpus = await loadOnce();
    const ids = corpus.entries.map((e: AdversarialCorpusEntry) => e.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate entry ids");
  });

  test("entry citations are non-empty", async () => {
    const corpus = await loadOnce();
    for (const entry of corpus.entries) {
      assert.ok(
        entry.citation.trim().length > 0,
        `entry ${entry.id} has empty citation`,
      );
    }
  });

  test("provenance: design-time generation by mistral-large-3", async () => {
    const corpus = await loadOnce();
    assert.equal(corpus.generatedBy.model, "mistral-large-3");
    assert.equal(corpus.generatedBy.modelIssueRef, "#2099");
    assert.equal(corpus.generatedBy.designTime, true);
    assert.equal(corpus.generatedBy.smeReviewed, true);
    assert.ok(corpus.generatedBy.smeReviewers.length > 0);
  });

  test("references the parent epic and issue", async () => {
    const corpus = await loadOnce();
    assert.equal(corpus.issueRef, "#2122");
    assert.equal(corpus.epicRef, "#2098");
    assert.equal(corpus.reviewCadence, "quarterly");
  });
});

describe("adversarial-corpus: gate", () => {
  test("runAdversarialCorpusGate: every entry passes its expected outcome", async () => {
    const { report } = await loadAndRunAdversarialCorpusGate();
    if (report.failures.length > 0) {
      const summary = report.failures
        .map((f) => `  - ${f.id} (${f.category}): ${f.reason}`)
        .join("\n");
      assert.fail(
        `${report.failures.length} corpus entries failed the gate:\n${summary}`,
      );
    }
    assert.equal(report.failCount, 0);
    assert.equal(report.passCount, report.entryCount);
  });
});

describe("adversarial-corpus: review cadence", () => {
  test("nextReviewDue is in the future relative to lastReviewedAt", async () => {
    const corpus = await loadOnce();
    const last = Date.parse(corpus.lastReviewedAt);
    const next = Date.parse(corpus.nextReviewDue);
    assert.ok(!Number.isNaN(last));
    assert.ok(!Number.isNaN(next));
    assert.ok(
      next > last,
      "nextReviewDue must be after lastReviewedAt",
    );
  });

  test("isAdversarialCorpusReviewOverdue: not overdue at lastReviewedAt", async () => {
    const corpus = await loadOnce();
    const lastReviewed = new Date(corpus.lastReviewedAt);
    assert.equal(
      isAdversarialCorpusReviewOverdue(corpus, lastReviewed),
      false,
    );
  });

  test("isAdversarialCorpusReviewOverdue: overdue past nextReviewDue", async () => {
    const corpus = await loadOnce();
    const due = new Date(corpus.nextReviewDue);
    const overdue = new Date(due.getTime() + 86_400_000);
    assert.equal(isAdversarialCorpusReviewOverdue(corpus, overdue), true);
  });
});

describe("adversarial-corpus: validator", () => {
  test("rejects unknown schemaVersion", () => {
    assert.throws(
      () =>
        validateAdversarialCorpus({
          schemaVersion: "0.0.0",
          version: "x",
          generatedAt: "x",
          lastReviewedAt: "x",
          nextReviewDue: "x",
          reviewCadence: "quarterly",
          issueRef: "#x",
          epicRef: "#x",
          generatedBy: {
            model: "x",
            modelIssueRef: "#x",
            designTime: true,
            smeReviewed: true,
            smeReviewers: ["x"],
          },
          categories: [],
          entries: [],
        }),
      /schemaVersion/,
    );
  });

  test("rejects an entry with an unknown category", () => {
    assert.throws(
      () =>
        validateAdversarialCorpus({
          schemaVersion: ADVERSARIAL_CORPUS_SCHEMA_VERSION,
          version: "x",
          generatedAt: "x",
          lastReviewedAt: "x",
          nextReviewDue: "x",
          reviewCadence: "quarterly",
          issueRef: "#x",
          epicRef: "#x",
          generatedBy: {
            model: "x",
            modelIssueRef: "#x",
            designTime: true,
            smeReviewed: true,
            smeReviewers: ["x"],
          },
          categories: [],
          entries: [
            {
              id: "x-1",
              category: "not_a_real_category",
              title: "x",
              payloadKind: "markdown",
              payload: "x",
              expectedOutcome: {
                surface: "input",
                outcome: "ok",
                nonZeroCounts: ["zeroWidthCharacters"],
              },
              citation: "x",
            },
          ],
        }),
      /not_a_real_category/,
    );
  });

  test("rejects an output-side outcome paired with a non-output payloadKind", () => {
    assert.throws(
      () =>
        validateAdversarialCorpus({
          schemaVersion: ADVERSARIAL_CORPUS_SCHEMA_VERSION,
          version: "x",
          generatedAt: "x",
          lastReviewedAt: "x",
          nextReviewDue: "x",
          reviewCadence: "quarterly",
          issueRef: "#x",
          epicRef: "#x",
          generatedBy: {
            model: "x",
            modelIssueRef: "#x",
            designTime: true,
            smeReviewed: true,
            smeReviewers: ["x"],
          },
          categories: [],
          entries: [
            {
              id: "x-1",
              category: "output_side_shell",
              title: "x",
              payloadKind: "markdown",
              payload: "rm -rf /",
              expectedOutcome: {
                surface: "output",
                category: "shell_metacharacters",
              },
              citation: "x",
            },
          ],
        }),
      /payloadKind=output-string/,
    );
  });
});

describe("adversarial-corpus: gate (synthetic mismatch)", () => {
  test("flags an entry whose expected outcome does not match the defense", async () => {
    const corpus = await loadOnce();
    // Tamper with one entry's expected outcome and confirm the gate
    // surfaces the mismatch as a failure rather than swallowing it.
    const tampered: AdversarialCorpus = {
      ...corpus,
      entries: corpus.entries.map((entry, idx) => {
        if (idx !== 0) return entry;
        if (entry.expectedOutcome.surface === "input") {
          return {
            ...entry,
            expectedOutcome: {
              surface: "input",
              outcome: entry.expectedOutcome.outcome,
              nonZeroCounts: ["sentinelLayerNames"],
            },
          };
        }
        return entry;
      }),
    };
    const report = runAdversarialCorpusGate(tampered);
    if (corpus.entries[0]?.expectedOutcome.surface === "input") {
      assert.ok(
        report.failures.length >= 1,
        "expected at least one failure after tampering with entry[0]",
      );
    }
  });
});
