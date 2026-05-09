#!/usr/bin/env tsx

/**
 * Per-deployment model card generator for the EU AI Act Article 13
 * transparency artifact (Issue #2112).
 *
 * The generator builds the deterministic model-card pair (JSON twin +
 * markdown rendering) for the eu-banking-default profile and writes it
 * under `docs/eu-ai-act/model-cards/`. The CI hook in the dev quality
 * gate runs the generator with `--check`: it regenerates the bundle
 * into a temp directory, compares it byte-for-byte against the committed
 * artefacts, and fails the run if a drift is detected. This keeps the
 * card in lock-step with the routing policy, contract version, and
 * domain-invariant catalog without trapping every PR on a manual
 * regeneration step.
 *
 * Usage:
 *   tsx scripts/generate-model-card.ts            # write artefacts
 *   tsx scripts/generate-model-card.ts --check    # verify, do not write
 *
 * The `generatedAt` timestamp is sourced from `MODEL_CARD_GENERATED_AT_PIN`
 * — a manually-bumped constant in `model-card.ts` — so the generator
 * output is byte-stable across CI runs on different days. Operators
 * bump the pin whenever the card content is re-committed. The pin
 * mirrors the `FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT` convention used
 * by the faithfulness fixtures.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  MODEL_CARD_DOCS_DIRNAME,
  MODEL_CARD_GENERATED_AT_PIN,
  MODEL_CARD_JSON_FILENAME_SUFFIX,
  MODEL_CARD_MD_FILENAME_SUFFIX,
  buildModelCard,
  renderModelCardMarkdown,
  serializeModelCard,
} from "../src/test-intelligence/model-card.js";
import { EU_BANKING_DEFAULT_POLICY_PROFILE_ID } from "../src/contracts/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

interface ParsedArgs {
  readonly check: boolean;
}

const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  let check = false;
  for (const arg of argv) {
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      // eslint-disable-next-line no-console -- CLI usage line
      console.log(
        "Usage: tsx scripts/generate-model-card.ts [--check]\n\n" +
          "  --check   Verify on-disk artefacts match the generator output. Do not write.\n",
      );
      process.exit(0);
    }
    throw new Error(`generate-model-card: unknown argument "${arg}"`);
  }
  return { check };
};

const resolveGeneratedAt = (): string => MODEL_CARD_GENERATED_AT_PIN;

const writeAtomic = async (
  outputPath: string,
  payload: string,
): Promise<void> => {
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, payload, "utf8");
  await rename(tmpPath, outputPath);
};

const readIfExists = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = resolveGeneratedAt();

  const card = buildModelCard({ generatedAt });
  const jsonPayload = serializeModelCard(card);
  const mdPayload = renderModelCardMarkdown(card);

  const dir = join(repoRoot, MODEL_CARD_DOCS_DIRNAME);
  const jsonPath = join(
    dir,
    `${EU_BANKING_DEFAULT_POLICY_PROFILE_ID}${MODEL_CARD_JSON_FILENAME_SUFFIX}`,
  );
  const mdPath = join(
    dir,
    `${EU_BANKING_DEFAULT_POLICY_PROFILE_ID}${MODEL_CARD_MD_FILENAME_SUFFIX}`,
  );

  if (args.check) {
    const issues: string[] = [];
    const onDiskJson = await readIfExists(jsonPath);
    const onDiskMd = await readIfExists(mdPath);
    if (onDiskJson === undefined) {
      issues.push(`missing: ${jsonPath}`);
    } else if (onDiskJson !== jsonPayload) {
      issues.push(
        `drift: ${jsonPath} differs from generator output. Run \`pnpm run model-card:generate\` and commit the result.`,
      );
    }
    if (onDiskMd === undefined) {
      issues.push(`missing: ${mdPath}`);
    } else if (onDiskMd !== mdPayload) {
      issues.push(
        `drift: ${mdPath} differs from generator output. Run \`pnpm run model-card:generate\` and commit the result.`,
      );
    }
    if (issues.length > 0) {
      for (const line of issues) {
        // eslint-disable-next-line no-console -- CLI failure surface
        console.error(line);
      }
      process.exit(1);
    }
    // eslint-disable-next-line no-console -- CLI success surface
    console.log(
      `model-card:check ok (${EU_BANKING_DEFAULT_POLICY_PROFILE_ID}, generatedAt=${generatedAt})`,
    );
    return;
  }

  await writeAtomic(jsonPath, jsonPayload);
  await writeAtomic(mdPath, mdPayload);
  // eslint-disable-next-line no-console -- CLI success surface
  console.log(
    `wrote ${jsonPath}\nwrote ${mdPath}\n(generatedAt=${generatedAt})`,
  );
};

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI failure surface
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
