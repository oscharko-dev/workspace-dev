#!/usr/bin/env node
/**
 * Issue #1678 (audit-2026-05 Wave 1): structural lint that asserts every
 * `*_SCHEMA_NAME` export in the source tree satisfies Azure OpenAI's
 * `response_format.json_schema.name` grammar (`^[a-zA-Z0-9_-]{1,64}$`).
 *
 * Cheap, deterministic, no runtime deps. Catches the regression that broke
 * the entire #1359 priority feature in #1676 (dotted names rejected by Azure
 * with HTTP 422).
 *
 * Usage:
 *   node scripts/check-schema-names.mjs        # default: walks ./src
 *   node scripts/check-schema-names.mjs <dir>  # alternate root
 *
 * Exit codes:
 *   0  every *_SCHEMA_NAME constant is Azure-valid
 *   1  one or more violations found (printed to stderr)
 *
 * Templates with `${VAR}` substitutions are validated by stripping the
 * substitution and asserting the literal portion is itself Azure-valid; the
 * runtime value still depends on the substituted constant, but a malformed
 * literal (e.g. dot, slash) cannot be hidden behind a template variable.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOT = "src";
const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TEMPLATE_VAR_RE = /\$\{[^}]+\}/g;

// Match `export const FOO_SCHEMA_NAME` followed by an optional type
// annotation, then either a backtick-template literal or a single/double-
// quoted string. The capture groups: 1=name, 2=template body, 3=plain string.
const NAME_RE =
  /export const ([A-Z][A-Z0-9_]*_SCHEMA_NAME)(?::\s*[^=]+)?\s*=\s*(?:`([^`]+)`|"([^"]+)"|'([^']+)')/g;

const walk = async (dir) => {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return out;
    throw err;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
};

/**
 * Pure analyser exported for the script's own test. Returns an array of
 * violation records; an empty array means the input is clean.
 */
export const analyzeSourceText = ({ filePath, text }) => {
  const findings = [];
  for (const m of text.matchAll(NAME_RE)) {
    const [, name, tpl, dq, sq] = m;
    const value = tpl ?? dq ?? sq;
    if (typeof value !== "string") continue;
    const literalOnly = value.replace(TEMPLATE_VAR_RE, "");
    if (literalOnly.length === 0) {
      // Pure-template (e.g. `${A}-${B}`) — runtime check is the right tool.
      continue;
    }
    if (!VALID_NAME_RE.test(literalOnly)) {
      findings.push({ filePath, name, value, literalOnly });
    }
  }
  return findings;
};

const run = async (root) => {
  const files = await walk(root);
  const errors = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    errors.push(...analyzeSourceText({ filePath: file, text }));
  }
  if (errors.length > 0) {
    for (const e of errors) {
      process.stderr.write(
        `[check-schema-names] ${e.filePath}: ${e.name} = "${e.value}" — literal portion "${e.literalOnly}" violates ^[a-zA-Z0-9_-]{1,64}$\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write(
    `[check-schema-names] All *_SCHEMA_NAME exports satisfy Azure json_schema.name grammar (scanned ${files.length} files).\n`,
  );
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = process.argv[2] ?? DEFAULT_ROOT;
  run(root).catch((err) => {
    process.stderr.write(
      `[check-schema-names] failed: ${err && err.message}\n`,
    );
    process.exit(2);
  });
}
