#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const resolveTypeScript = () => {
  try {
    return require("typescript");
  } catch {
    return require(path.resolve(packageRoot, "..", "workspace-dev", "node_modules", "typescript"));
  }
};
const ts = resolveTypeScript();

const TARGET_FILES = [
  "src/job-engine/figma-source.ts",
  "src/job-engine/generation-diff.ts",
  "src/job-engine/ir-cache.ts",
  "src/job-engine/validation.ts",
];

const LOG_CALL_PATTERNS = [
  /^onLog$/,
  /^emitIrCacheDebugLog$/,
  /^context\.log$/,
  /^ctx\.log$/,
  /^logger\.(debug|info|warn|error|log)$/,
  /^runtime\.logger\.log$/,
  /^console\.(debug|info|warn|error|log)$/,
];

const getCallExpressionName = (node) => {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.getText();
  }
  return undefined;
};

const hasObviousLoggingCall = (node) => {
  let found = false;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(current)) {
      const callName = getCallExpressionName(current);
      if (callName && LOG_CALL_PATTERNS.some((pattern) => pattern.test(callName))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
};

const hasSilentReturn = (node) => {
  let found = false;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isReturnStatement(current)) {
      if (
        current.expression === undefined ||
        current.expression.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(current.expression) && current.expression.text === "undefined")
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

const getTopLevelTerminalKind = (block) => {
  const lastStatement = block.statements.at(-1);
  return lastStatement?.kind;
};

export const analyzeSourceText = ({ filePath, text }) => {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const findings = [];

  const visit = (node) => {
    if (ts.isCatchClause(node) && ts.isBlock(node.block)) {
      const hasLogging = hasObviousLoggingCall(node.block);
      if (!hasLogging) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const reason =
          node.block.statements.length === 0
            ? "empty catch block without logging"
            : hasSilentReturn(node.block)
              ? "catch block returns nullish value without logging"
              : getTopLevelTerminalKind(node.block) !== ts.SyntaxKind.ThrowStatement
                ? "catch block swallows errors without logging"
                : undefined;
        if (reason) {
          findings.push({
            filePath,
            line: start,
            reason,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
};

const main = async () => {
  const findings = [];

  for (const relativeFilePath of TARGET_FILES) {
    const absolutePath = path.join(packageRoot, relativeFilePath);
    const text = await readFile(absolutePath, "utf8");
    findings.push(...analyzeSourceText({ filePath: relativeFilePath, text }));
  }

  if (findings.length > 0) {
    console.error(`[job-engine-catch-logging] Found ${findings.length} silent catch block(s) without logging.`);
    for (const finding of findings) {
      console.error(`[job-engine-catch-logging] ${finding.filePath}:${finding.line} ${finding.reason}`);
    }
    process.exit(1);
  }

  console.log("[job-engine-catch-logging] No silent catch blocks without logging found in issue-owned files.");
};

const executedAsEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executedAsEntrypoint) {
  main().catch((error) => {
    console.error("[job-engine-catch-logging] Failed:", error);
    process.exit(1);
  });
}
