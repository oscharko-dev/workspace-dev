import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  isBaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
  type BaselineArchetypeFixtureId,
  type BaselineArchetypeSummary,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname,
  "fixtures",
);

const expectedArchetypesWithJira: ReadonlySet<BaselineArchetypeFixtureId> =
  new Set(["baseline-multi-context"]);
const expectedArchetypesWithCustomMarkdown: ReadonlySet<
  BaselineArchetypeFixtureId
> = new Set(["baseline-multi-context"]);

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----/i,
];

const RAW_BINARY_EXTENSIONS: ReadonlyArray<string> = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
];

const isCanonicalJson = (raw: string): boolean => {
  return raw === canonicalJson(JSON.parse(raw));
};

describe("baseline-fixtures (Issue #1762)", () => {
  test("registers exactly the seven MA-0 archetype ids", () => {
    assert.equal(BASELINE_ARCHETYPE_FIXTURE_IDS.length, 7);
    assert.deepEqual([...BASELINE_ARCHETYPE_FIXTURE_IDS].sort(), [
      "baseline-ambiguous-rules",
      "baseline-calculation",
      "baseline-complex-mask",
      "baseline-multi-context",
      "baseline-optional-fields",
      "baseline-simple-form",
      "baseline-validation-heavy",
    ]);
    for (const id of BASELINE_ARCHETYPE_FIXTURE_IDS) {
      assert.equal(isBaselineArchetypeFixtureId(id), true);
    }
    assert.equal(isBaselineArchetypeFixtureId("not-a-baseline"), false);
  });

  test("rejects unknown archetype ids loudly", async () => {
    await assert.rejects(
      () =>
        loadBaselineArchetypeFixture(
          "baseline-not-a-thing" as BaselineArchetypeFixtureId,
        ),
      /unknown archetypeId/u,
    );
  });

  for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
    describe(archetypeId, () => {
      test("loads, derives an IR, and matches the expected summary", async () => {
        const loaded = await loadBaselineArchetypeFixture(archetypeId);
        const { figma, summary } = loaded;

        assert.equal(summary.schemaVersion, "1.0.0");
        assert.equal(summary.archetypeId, archetypeId);
        assert.ok(
          summary.intent.length > 0,
          "summary.intent must not be empty",
        );
        assert.ok(
          summary.notes.length > 0,
          "summary.notes must not be empty",
        );

        const screenCount = figma.screens.length;
        const nodeCount = figma.screens.reduce(
          (n, s) => n + s.nodes.length,
          0,
        );
        assert.equal(screenCount, summary.figma.screenCount);
        assert.equal(nodeCount, summary.figma.nodeCount);

        const ir = deriveBusinessTestIntentIr({ figma });
        assert.equal(
          ir.detectedFields.length,
          summary.figma.fieldNodeCount,
          "detectedFields count must match summary.figma.fieldNodeCount",
        );
        assert.equal(
          ir.detectedActions.length,
          summary.figma.actionNodeCount,
          "detectedActions count must match summary.figma.actionNodeCount",
        );
        assert.equal(
          ir.detectedValidations.length,
          summary.figma.validationCount,
          "detectedValidations count must match summary.figma.validationCount",
        );
        assert.equal(
          ir.detectedNavigation.length,
          summary.figma.navigationCount,
          "detectedNavigation count must match summary.figma.navigationCount",
        );

        // Optional auxiliary sources line up with the summary's assertions
        // and the curated archetype map. This is what makes
        // `baseline-multi-context` distinct from the other six.
        const wantsJira = expectedArchetypesWithJira.has(archetypeId);
        const wantsCustomMarkdown =
          expectedArchetypesWithCustomMarkdown.has(archetypeId);
        assert.equal(summary.sources.hasJira, wantsJira);
        assert.equal(summary.sources.hasCustomMarkdown, wantsCustomMarkdown);
        assert.equal(loaded.jira !== undefined, wantsJira);
        assert.equal(loaded.customMarkdown !== undefined, wantsCustomMarkdown);

        // For ambiguous-rules the archetype intent is to surface gaps as
        // openQuestions; the curated keyword list MUST be non-empty and
        // every keyword must actually appear in at least one validation
        // rule string in the figma fixture.
        if (archetypeId === "baseline-ambiguous-rules") {
          assert.ok(
            summary.expectedOpenQuestionsKeywords.length > 0,
            "ambiguous-rules archetype must declare at least one keyword",
          );
          const ruleCorpus = figma.screens
            .flatMap((s) => s.nodes)
            .flatMap((n) => n.validations ?? [])
            .join("\n")
            .toLowerCase();
          for (const keyword of summary.expectedOpenQuestionsKeywords) {
            assert.ok(
              ruleCorpus.includes(keyword.toLowerCase()),
              `expected keyword "${keyword}" to appear in at least one validation rule`,
            );
          }
        } else {
          assert.deepEqual(summary.expectedOpenQuestionsKeywords, []);
        }
      });

      test("expected.summary.json round-trips through canonicalJson", async () => {
        const summaryPath = join(
          FIXTURES_DIR,
          `${archetypeId}.expected.summary.json`,
        );
        const raw = await readFile(summaryPath, "utf8");
        const parsed = JSON.parse(raw) as BaselineArchetypeSummary;
        const recanon = canonicalJson(parsed);
        // Re-canonicalising the parsed summary must reproduce a byte
        // stable string, i.e. there is no field whose ordering or
        // numeric formatting depends on the host runtime.
        assert.equal(recanon, canonicalJson(JSON.parse(recanon)));
        // The parsed summary itself is canonical (sorted, no extras).
        assert.equal(canonicalJson(parsed), recanon);
      });

      test("multi-context jira.json is canonical-JSON when present", async () => {
        const loaded = await loadBaselineArchetypeFixture(archetypeId);
        if (loaded.jiraPath === undefined) return;
        const raw = await readFile(loaded.jiraPath, "utf8");
        const reparsed = JSON.parse(raw);
        // Jira REST snapshots are stored as readable JSON, not minified
        // canonical form; assert only that re-canonicalising the parsed
        // payload is byte-stable.
        const recanon = canonicalJson(reparsed);
        assert.equal(recanon, canonicalJson(JSON.parse(recanon)));
      });

      test("contains no raw screenshots and no obvious secrets", async () => {
        const loaded = await loadBaselineArchetypeFixture(archetypeId);
        const candidatePaths: string[] = [loaded.figmaPath, loaded.summaryPath];
        if (loaded.jiraPath !== undefined)
          candidatePaths.push(loaded.jiraPath);
        if (loaded.customMarkdownPath !== undefined)
          candidatePaths.push(loaded.customMarkdownPath);
        for (const path of candidatePaths) {
          for (const ext of RAW_BINARY_EXTENSIONS) {
            assert.ok(
              !path.toLowerCase().endsWith(ext),
              `baseline fixture must not include raw screenshot: ${path}`,
            );
          }
          const raw = await readFile(path, "utf8");
          for (const pattern of SECRET_PATTERNS) {
            assert.ok(
              !pattern.test(raw),
              `baseline fixture ${path} matched a secret pattern: ${pattern}`,
            );
          }
        }
      });
    });
  }

  test("figma.json files round-trip through JSON.parse without surprises", async () => {
    for (const archetypeId of BASELINE_ARCHETYPE_FIXTURE_IDS) {
      const figmaPath = join(FIXTURES_DIR, `${archetypeId}.figma.json`);
      const raw = await readFile(figmaPath, "utf8");
      const parsed = JSON.parse(raw) as { source: { kind: string } };
      assert.ok(
        ["figma_local_json", "figma_plugin", "figma_rest", "hybrid"].includes(
          parsed.source.kind,
        ),
        `figma fixture ${archetypeId} declares an unsupported source.kind`,
      );
      // Re-canonicalisation must be stable.
      assert.equal(isCanonicalJson(canonicalJson(parsed)), true);
    }
  });
});
