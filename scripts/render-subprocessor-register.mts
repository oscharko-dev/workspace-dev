#!/usr/bin/env tsx
/**
 * Regenerate `docs/dora/subprocessor-register.md` from the canonical
 * TS source-of-truth in `src/test-intelligence/subprocessor-register.ts`
 * (Issue #2174).
 *
 * Usage:
 *   pnpm exec tsx scripts/render-subprocessor-register.mts          # write
 *   pnpm exec tsx scripts/render-subprocessor-register.mts --check  # diff-only
 *
 * The renderer is deterministic: identical TS source → identical
 * Markdown bytes. CI invokes `--check` to fail the build on drift.
 *
 * The doc-time `generatedAt` is pinned to
 * `SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED` so the on-disk Markdown
 * stays byte-stable across local regenerations until the source
 * content moves; the per-run JSON artifact uses the run timestamp.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildSubprocessorRegister,
  renderSubprocessorRegisterMarkdown,
  SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED,
} from "../src/test-intelligence/subprocessor-register.js";

const DOC_RELATIVE_PATH = "docs/dora/subprocessor-register.md";

const renderCanonicalMarkdown = (): string => {
  const register = buildSubprocessorRegister({
    generatedAt: `${SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED}T00:00:00Z`,
  });
  return `${renderSubprocessorRegisterMarkdown(register)}\n`;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const docPath = join(repoRoot, DOC_RELATIVE_PATH);

  const expected = renderCanonicalMarkdown();

  if (checkOnly) {
    let observed: string;
    try {
      observed = await readFile(docPath, "utf8");
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        process.stderr.write(
          `error: ${DOC_RELATIVE_PATH} is missing. ` +
            `Run \`pnpm run docs:render-subprocessor-register\` to regenerate it.\n`,
        );
        process.exit(2);
      }
      throw error;
    }
    if (observed !== expected) {
      process.stderr.write(
        `error: ${DOC_RELATIVE_PATH} is out of sync with the canonical TS ` +
          `source (\`src/test-intelligence/subprocessor-register.ts\`). ` +
          `Run \`pnpm run docs:render-subprocessor-register\` to regenerate it.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${DOC_RELATIVE_PATH} is in sync.\n`);
    return;
  }

  await writeFile(docPath, expected, "utf8");
  process.stdout.write(
    `wrote ${DOC_RELATIVE_PATH} (${expected.length} bytes)\n`,
  );
};

void main().catch((error: unknown) => {
  const message =
    error !== null && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
});
