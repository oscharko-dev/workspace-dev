import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kpiTypesFilePath = path.resolve(__dirname, "./types-kpi.ts");

const parseSource = async (): Promise<ts.SourceFile> => {
  const source = await readFile(kpiTypesFilePath, "utf8");
  return ts.createSourceFile(
    kpiTypesFilePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
};

const getInterfaceMap = (source: ts.SourceFile): Map<string, ts.InterfaceDeclaration> => {
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      interfaces.set(statement.name.text, statement);
    }
  }
  return interfaces;
};

const getTypeAliasMap = (source: ts.SourceFile): Map<string, ts.TypeAliasDeclaration> => {
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement);
    }
  }
  return aliases;
};

const getProperty = (
  declaration: ts.InterfaceDeclaration,
  name: string,
): ts.PropertySignature => {
  const member = declaration.members.find((item) => {
    if (!ts.isPropertySignature(item) || !item.name) {
      return false;
    }
    return ts.isIdentifier(item.name) && item.name.text === name;
  });

  assert.ok(member, `Expected property '${name}' in interface '${declaration.name.text}'.`);
  assert.ok(
    ts.isPropertySignature(member),
    `Expected '${name}' in interface '${declaration.name.text}' to be a property signature.`,
  );

  return member;
};

const assertOptionalProperty = (
  declaration: ts.InterfaceDeclaration,
  propertyName: string,
): void => {
  const property = getProperty(declaration, propertyName);
  assert.ok(
    property.questionToken,
    `Expected '${declaration.name.text}.${propertyName}' to be optional for backward compatibility.`,
  );
};

test("Issue #840 KPI model extensions remain present and backward-compatible", async () => {
  const source = await parseSource();
  const interfaces = getInterfaceMap(source);

  const projectSnapshot = interfaces.get("ProjectKpiSnapshot");
  assert.ok(projectSnapshot, "Missing ProjectKpiSnapshot interface.");
  assertOptionalProperty(projectSnapshot, "visualQualityScoreAvg");
  assertOptionalProperty(projectSnapshot, "visualQualityScoreP50");
  assertOptionalProperty(projectSnapshot, "visualQualityScoreP95");
  assertOptionalProperty(projectSnapshot, "visualQualityDimensions");

  const dimensionsProperty = getProperty(projectSnapshot, "visualQualityDimensions");
  assert.ok(dimensionsProperty.type, "ProjectKpiSnapshot.visualQualityDimensions must declare a type.");
  assert.equal(
    dimensionsProperty.type.getText(source),
    "KpiVisualQualityDimensionScores",
    "ProjectKpiSnapshot.visualQualityDimensions must use KpiVisualQualityDimensionScores.",
  );

  const portfolioSnapshot = interfaces.get("PortfolioKpiSnapshot");
  assert.ok(portfolioSnapshot, "Missing PortfolioKpiSnapshot interface.");
  assertOptionalProperty(portfolioSnapshot, "visualQualityScoreAvg");

  const trendBucket = interfaces.get("KpiTrendBucket");
  assert.ok(trendBucket, "Missing KpiTrendBucket interface.");
  assertOptionalProperty(trendBucket, "visualQualityScoreAvg");

  const dimensions = interfaces.get("KpiVisualQualityDimensionScores");
  assert.ok(dimensions, "Missing KpiVisualQualityDimensionScores interface.");
  assertOptionalProperty(dimensions, "layout");
  assertOptionalProperty(dimensions, "color");
  assertOptionalProperty(dimensions, "typography");
  assertOptionalProperty(dimensions, "component");
  assertOptionalProperty(dimensions, "spacing");
});

test("Issue #840 alert code remains available in KpiAlertCode union", async () => {
  const source = await parseSource();
  const aliases = getTypeAliasMap(source);
  const alertCode = aliases.get("KpiAlertCode");

  assert.ok(alertCode, "Missing KpiAlertCode type alias.");
  assert.ok(ts.isUnionTypeNode(alertCode.type), "KpiAlertCode must be a string literal union.");

  const literals = alertCode.type.types
    .filter(ts.isLiteralTypeNode)
    .map((node) => node.literal)
    .filter(ts.isStringLiteral)
    .map((node) => node.text);

  assert.ok(
    literals.includes("ALERT_VISUAL_QUALITY_DROP"),
    "KpiAlertCode must include ALERT_VISUAL_QUALITY_DROP.",
  );
});
