#!/usr/bin/env node
/**
 * Issue #651 catch logging guard.
 *
 * Scans the four runtime files called out by the issue and flags catch blocks
 * that are bare or that only return `null` / `undefined` without any obvious
 * logging call in the catch body.
 *
 * Intentional limitations:
 * - This is a heuristic guard, not a full lint rule or control-flow analyzer.
 * - It recognizes the repo's common logging shapes (`onLog`, `log*Diagnostic`,
 *   `context.log`, `ctx.log`, `logger.log`, and `console.*`).
 * - It intentionally targets the four Issue #651 runtime files instead of all
 *   of `src/job-engine`, because other best-effort catches in the folder are
 *   unrelated and intentionally silent.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const issueFiles = [
  path.resolve(packageRoot, "src/job-engine/figma-source.ts"),
  path.resolve(packageRoot, "src/job-engine/generation-diff.ts"),
  path.resolve(packageRoot, "src/job-engine/ir-cache.ts"),
  path.resolve(packageRoot, "src/job-engine/validation.ts")
];

const obviousLoggerPattern = /^(?:onLog|log[A-Z].*|(?:ctx|context|logger)\.(?:log|info|warn|error|debug)|console\.(?:log|info|warn|error|debug))$/;

const unwrapExpression = (expression) => {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
};

const isNullishReturnExpression = (expression) => {
  if (!expression) {
    return true;
  }

  const unwrapped = unwrapExpression(expression);
  return (
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(unwrapped) && unwrapped.text === "undefined") ||
    unwrapped.kind === ts.SyntaxKind.VoidExpression
  );
};

const hasObviousLoggingCall = (node) => {
  let found = false;

  const visit = (current) => {
    if (found) {
      return;
    }
    if (current !== node && ts.isFunctionLike(current)) {
      return;
    }

    if (ts.isCallExpression(current)) {
      const { expression } = current;
      if (ts.isIdentifier(expression) && obviousLoggerPattern.test(expression.text)) {
        found = true;
        return;
      }

      if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        obviousLoggerPattern.test(`${expression.expression.text}.${expression.name.text}`)
      ) {
        found = true;
        return;
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
};

const hasThrowStatement = (node) => {
  let found = false;

  const visit = (current) => {
    if (found) {
      return;
    }
    if (current !== node && ts.isFunctionLike(current)) {
      return;
    }
    if (ts.isThrowStatement(current)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
};

const hasNullishReturn = (node) => {
  let found = false;

  const visit = (current) => {
    if (found) {
      return;
    }
    if (current !== node && ts.isFunctionLike(current)) {
      return;
    }
    if (ts.isReturnStatement(current) && isNullishReturnExpression(current.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
};

const scanSourceText = ({ filePath, sourceText }) => {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const violations = [];

  const visit = (node) => {
    if (ts.isCatchClause(node)) {
      const block = node.block;
      const shouldFlag =
        block.statements.length === 0 ||
        (!hasObviousLoggingCall(block) && !hasThrowStatement(block) && hasNullishReturn(block));

      if (shouldFlag) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: filePath,
          line: position.line + 1,
          content: node.getText(sourceFile).replace(/\s+/g, " ").trim(),
          reason: block.statements.length === 0 ? "bare catch block" : "catch block returns nullish value without logging"
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const scanJobEngineCatchLoggingViolations = async () => {
  const files = [];
  const violations = [];

  for (const filePath of issueFiles) {
    let sourceText;
    try {
      sourceText = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    files.push(filePath);
    violations.push(...scanSourceText({ filePath: path.relative(packageRoot, filePath), sourceText }));
  }

  return { files, violations };
};

const main = async () => {
  const { files, violations } = await scanJobEngineCatchLoggingViolations();

  if (violations.length === 0) {
    console.log("✅ Job-engine catch logging guard passed: no bare or nullish catch blocks without logging found.");
    console.log(`   Checked: ${files.length} issue files under src/job-engine`);
    process.exit(0);
  }

  console.error(`❌ Job-engine catch logging guard failed: ${violations.length} violation(s) found.\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.reason}`);
    console.error(`    ${violation.content}\n`);
  }
  process.exit(1);
};

const invokedAsScript = typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error) => {
    console.error("Job-engine catch logging guard failed:", error);
    process.exit(1);
  });
}

export {
  hasNullishReturn,
  hasObviousLoggingCall,
  hasThrowStatement,
  isNullishReturnExpression,
  scanJobEngineCatchLoggingViolations,
  scanSourceText
};
