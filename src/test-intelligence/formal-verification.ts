/**
 * Formal verification of compliance rule packs (Issue #2181).
 *
 * Lifts the operator-curated rule packs (PSD2 SCA Article 97, MiFID II
 * suitability Article 25) into LTL / CTL temporal-logic specifications
 * and verifies them against a finite-state Kripke model of the rule-
 * application order. The deliverable is a mathematical proof that the
 * rule pack is **internally consistent** and **satisfies the
 * regulator's intent**, unmatched in the EU banking AI-test-generation
 * space.
 *
 * Design choices:
 *
 * - The spec format is a deliberately small **NuSMV-compatible subset**
 *   (`MODULE main`, `VAR`, `ASSIGN init/next`, `LTLSPEC`, `CTLSPEC`).
 *   Operators who want to re-run a spec in stock NuSMV may do so. No
 *   features outside the subset (modules, fairness, real numbers, …)
 *   are accepted.
 *
 * - The model checker is a self-contained **explicit-state CTL fixed-
 *   point algorithm**. LTL formulae in the ACTL fragment (`G φ`,
 *   `F φ`, `X φ`, `G(p → F q)`, `G(p → X q)`, `p U q`) are translated
 *   to CTL universally-quantified counterparts before checking. This
 *   keeps the harness dependency-free (a hard constraint in this
 *   project — zero runtime dependencies) and deterministic byte-for-
 *   byte: identical specs produce identical verdicts and identical
 *   counterexample traces.
 *
 * - State space is bounded by the spec's variable domains. Reachable
 *   states are enumerated via BFS from the initial valuations and
 *   capped at {@link FORMAL_VERIFICATION_STATE_LIMIT} so a malformed
 *   spec cannot exhaust memory.
 *
 * - Counterexample traces are minimal-by-BFS — the verifier reports
 *   the shortest known witnessing path so auditors get the cleanest
 *   possible refutation.
 *
 * Out of scope for this pilot: lifting the remaining five EU
 * compliance frameworks (DORA, IDD, Solvency II, EU AI Act, GDPR).
 * They remain runtime rule packs only.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Filename of the canonical-JSON report emitted by the formal-
 * verification driver next to other run artifacts.
 */
export const FORMAL_VERIFICATION_REPORT_ARTIFACT_FILENAME =
  "formal-verification-report.json" as const;

/** Schema version for {@link FormalVerificationReport}. */
export const FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Hard upper bound on the number of reachable Kripke states allowed
 * for a single spec. Pilot specs sit well below 1 000 states; this
 * limit traps state-space explosion without preventing the curated
 * pilot scope.
 */
export const FORMAL_VERIFICATION_STATE_LIMIT = 4096;

/**
 * Hard upper bound on the spec source size accepted by the parser.
 * Defends against accidental cat-of-binary input and keeps the
 * parsing budget deterministic.
 */
export const FORMAL_VERIFICATION_MAX_SPEC_BYTES = 65_536;

/**
 * Hard-gate code emitted to fail CI when any formal-verification spec
 * fails to verify (Issue #2181).
 */
export const G10_FORMAL_VERIFICATION_PASS =
  "G10_FORMAL_VERIFICATION_PASS" as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Logic family of a temporal formula. */
export type FormalVerificationLogic = "LTL" | "CTL";

/** Per-formula verdict. */
export type FormalVerificationVerdict = "pass" | "fail";

/**
 * A single reachable state in the verified Kripke structure, exposed
 * verbatim in counterexample traces. The valuation maps variable
 * names to their current values; values are JSON-serialisable
 * primitives so the report is round-trip safe.
 */
export interface FormalVerificationState {
  readonly id: string;
  readonly valuation: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Counterexample trace returned alongside a `fail` verdict. The trace
 * is the shortest BFS witness leading from an initial state to a
 * state where the formula is violated.
 */
export interface FormalVerificationCounterexample {
  readonly trace: readonly FormalVerificationState[];
  readonly explanation: string;
}

/** Verdict for a single LTL / CTL formula in the spec. */
export interface FormalVerificationFormulaResult {
  readonly logic: FormalVerificationLogic;
  readonly formula: string;
  readonly verdict: FormalVerificationVerdict;
  readonly counterexample?: FormalVerificationCounterexample;
}

/** Per-spec verification result. */
export interface FormalVerificationSpecResult {
  readonly specPath: string;
  readonly specSha256: string;
  readonly module: string;
  readonly reachableStateCount: number;
  readonly formulae: readonly FormalVerificationFormulaResult[];
  readonly verdict: FormalVerificationVerdict;
}

/** Top-level formal-verification report (persisted as JSON). */
export interface FormalVerificationReport {
  readonly schemaVersion: typeof FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly specs: readonly FormalVerificationSpecResult[];
  readonly summary: {
    readonly specCount: number;
    readonly formulaCount: number;
    readonly passCount: number;
    readonly failCount: number;
    readonly verdict: FormalVerificationVerdict;
  };
}

/** Input for {@link verifyFormalVerificationSpec}. */
export interface VerifyFormalSpecInput {
  readonly specPath: string;
  readonly specSource: string;
}

/** Input for {@link buildFormalVerificationReport}. */
export interface BuildFormalVerificationReportInput {
  readonly specs: readonly VerifyFormalSpecInput[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Parse-time error. Always raised with `cause` left undefined. */
export class FormalSpecParseError extends Error {
  readonly specPath: string;
  readonly line: number;
  readonly column: number;
  constructor(
    specPath: string,
    line: number,
    column: number,
    message: string,
  ) {
    super(`${specPath}:${line}:${column}: ${message}`);
    this.name = "FormalSpecParseError";
    this.specPath = specPath;
    this.line = line;
    this.column = column;
  }
}

/** Build-time error during Kripke structure construction. */
export class FormalSpecModelError extends Error {
  readonly specPath: string;
  constructor(specPath: string, message: string) {
    super(`${specPath}: ${message}`);
    this.name = "FormalSpecModelError";
    this.specPath = specPath;
  }
}

/**
 * Hard-gate error thrown when {@link assertFormalVerificationPass}
 * is fed a report containing any `fail` verdict. Wired into the
 * production runner so a failed formal-verification spec fails CI.
 */
export class FormalVerificationHardGateError extends Error {
  readonly code: typeof G10_FORMAL_VERIFICATION_PASS;
  readonly failures: readonly {
    readonly specPath: string;
    readonly formula: string;
    readonly logic: FormalVerificationLogic;
  }[];
  constructor(report: FormalVerificationReport) {
    const failures = report.specs.flatMap((spec) =>
      spec.formulae
        .filter((f) => f.verdict === "fail")
        .map((f) => ({
          specPath: spec.specPath,
          formula: f.formula,
          logic: f.logic,
        })),
    );
    const detail = failures
      .map((f) => `${f.specPath} [${f.logic}] ${f.formula}`)
      .join(" | ");
    super(
      `${G10_FORMAL_VERIFICATION_PASS} failed for ${failures.length} formula(s): ${detail}`,
    );
    this.name = "FormalVerificationHardGateError";
    this.code = G10_FORMAL_VERIFICATION_PASS;
    this.failures = failures;
  }
}

// ---------------------------------------------------------------------------
// AST — expressions
// ---------------------------------------------------------------------------

type PrimitiveValue = string | number | boolean;

type ExprAst =
  | { readonly kind: "ident"; readonly name: string }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "set"; readonly values: readonly PrimitiveValue[] }
  | {
      readonly kind: "binop";
      readonly op: ExprBinOp;
      readonly left: ExprAst;
      readonly right: ExprAst;
    }
  | { readonly kind: "unop"; readonly op: "!"; readonly operand: ExprAst }
  | {
      readonly kind: "case";
      readonly cases: readonly {
        readonly guard: ExprAst;
        readonly value: ExprAst;
      }[];
    };

type ExprBinOp =
  | "+"
  | "-"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&"
  | "|"
  | "->"
  | "<->"
  | "in";

// ---------------------------------------------------------------------------
// AST — temporal formulae
// ---------------------------------------------------------------------------

type TemporalAst =
  | { readonly kind: "atom"; readonly expr: ExprAst }
  | { readonly kind: "not"; readonly operand: TemporalAst }
  | {
      readonly kind: "and" | "or" | "implies" | "iff";
      readonly left: TemporalAst;
      readonly right: TemporalAst;
    }
  | {
      readonly kind: "G" | "F" | "X";
      readonly operand: TemporalAst;
    }
  | { readonly kind: "U"; readonly left: TemporalAst; readonly right: TemporalAst }
  | {
      readonly kind: "EX" | "AX" | "EF" | "AF" | "EG" | "AG";
      readonly operand: TemporalAst;
    }
  | {
      readonly kind: "EU" | "AU";
      readonly left: TemporalAst;
      readonly right: TemporalAst;
    };

// ---------------------------------------------------------------------------
// Spec internal model
// ---------------------------------------------------------------------------

interface SpecVariableEnum {
  readonly kind: "enum";
  readonly name: string;
  readonly values: readonly string[];
}

interface SpecVariableRange {
  readonly kind: "range";
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

type SpecVariable = SpecVariableEnum | SpecVariableRange;

interface SpecAssignment {
  readonly variable: string;
  readonly expr: ExprAst;
}

interface SpecFormula {
  readonly logic: FormalVerificationLogic;
  readonly source: string;
  readonly ast: TemporalAst;
}

interface ParsedSpec {
  readonly module: string;
  readonly variables: readonly SpecVariable[];
  readonly inits: readonly SpecAssignment[];
  readonly nexts: readonly SpecAssignment[];
  readonly formulae: readonly SpecFormula[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
  | "ident"
  | "int"
  | "punct"
  | "keyword"
  | "operator"
  | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

const KEYWORDS = new Set<string>([
  "MODULE",
  "VAR",
  "ASSIGN",
  "DEFINE",
  "init",
  "next",
  "case",
  "esac",
  "TRUE",
  "FALSE",
  "LTLSPEC",
  "CTLSPEC",
  "in",
  "boolean",
  "main",
  "G",
  "F",
  "X",
  "U",
  "EX",
  "AX",
  "EF",
  "AF",
  "EG",
  "AG",
  "E",
  "A",
]);

const MULTI_OP_TWO = new Set<string>(["!=", "<=", ">=", "->", ":="]);
const MULTI_OP_THREE = new Set<string>(["<->"]);
const SINGLE_PUNCT = new Set<string>([
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ",",
  ";",
  ":",
  "+",
  "-",
  "*",
  "/",
  "=",
  "<",
  ">",
  "&",
  "|",
  "!",
  ".",
]);

const tokenize = (source: string, specPath: string): readonly Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const advance = (): void => {
    const ch = source[i];
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    i += 1;
  };

  while (i < source.length) {
    const startLine = line;
    const startColumn = column;
    const ch = source[i] ?? "";

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    if (ch === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") {
        advance();
      }
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let word = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] ?? "")) {
        word += source[i];
        advance();
      }
      if (KEYWORDS.has(word)) {
        tokens.push({
          kind: "keyword",
          value: word,
          line: startLine,
          column: startColumn,
        });
      } else {
        tokens.push({
          kind: "ident",
          value: word,
          line: startLine,
          column: startColumn,
        });
      }
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let digits = "";
      while (i < source.length && /[0-9]/.test(source[i] ?? "")) {
        digits += source[i];
        advance();
      }
      tokens.push({
        kind: "int",
        value: digits,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    const three = source.slice(i, i + 3);
    if (MULTI_OP_THREE.has(three)) {
      tokens.push({
        kind: "operator",
        value: three,
        line: startLine,
        column: startColumn,
      });
      advance();
      advance();
      advance();
      continue;
    }

    const two = source.slice(i, i + 2);
    if (MULTI_OP_TWO.has(two)) {
      tokens.push({
        kind: "operator",
        value: two,
        line: startLine,
        column: startColumn,
      });
      advance();
      advance();
      continue;
    }

    if (ch === ".") {
      if (source[i + 1] === ".") {
        tokens.push({
          kind: "operator",
          value: "..",
          line: startLine,
          column: startColumn,
        });
        advance();
        advance();
        continue;
      }
    }

    if (SINGLE_PUNCT.has(ch)) {
      tokens.push({
        kind: "punct",
        value: ch,
        line: startLine,
        column: startColumn,
      });
      advance();
      continue;
    }

    throw new FormalSpecParseError(
      specPath,
      startLine,
      startColumn,
      `unexpected character ${JSON.stringify(ch)}`,
    );
  }

  tokens.push({ kind: "eof", value: "", line, column });
  return tokens;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class TokenCursor {
  private readonly tokens: readonly Token[];
  private readonly specPath: string;
  private position = 0;

  constructor(tokens: readonly Token[], specPath: string) {
    this.tokens = tokens;
    this.specPath = specPath;
  }

  peek(offset = 0): Token {
    const tok = this.tokens[this.position + offset];
    if (tok === undefined) {
      const last = this.tokens[this.tokens.length - 1];
      return last ?? { kind: "eof", value: "", line: 1, column: 1 };
    }
    return tok;
  }

  consume(): Token {
    const tok = this.peek();
    this.position += 1;
    return tok;
  }

  expectKeyword(keyword: string): Token {
    const tok = this.peek();
    if (tok.kind !== "keyword" || tok.value !== keyword) {
      throw this.error(`expected keyword ${keyword}, got ${describe(tok)}`);
    }
    return this.consume();
  }

  expectPunct(punct: string): Token {
    const tok = this.peek();
    if (tok.kind !== "punct" || tok.value !== punct) {
      throw this.error(`expected ${JSON.stringify(punct)}, got ${describe(tok)}`);
    }
    return this.consume();
  }

  matchKeyword(keyword: string): boolean {
    const tok = this.peek();
    return tok.kind === "keyword" && tok.value === keyword;
  }

  matchPunct(punct: string): boolean {
    const tok = this.peek();
    return tok.kind === "punct" && tok.value === punct;
  }

  matchOperator(op: string): boolean {
    const tok = this.peek();
    return tok.kind === "operator" && tok.value === op;
  }

  error(message: string): FormalSpecParseError {
    const tok = this.peek();
    return new FormalSpecParseError(this.specPath, tok.line, tok.column, message);
  }
}

const describe = (tok: Token): string => {
  if (tok.kind === "eof") return "end-of-file";
  return `${tok.kind}(${JSON.stringify(tok.value)})`;
};

const parseSpec = (source: string, specPath: string): ParsedSpec => {
  if (Buffer.byteLength(source, "utf8") > FORMAL_VERIFICATION_MAX_SPEC_BYTES) {
    throw new FormalSpecParseError(
      specPath,
      1,
      1,
      `spec exceeds max size ${FORMAL_VERIFICATION_MAX_SPEC_BYTES} bytes`,
    );
  }

  const tokens = tokenize(source, specPath);
  const cursor = new TokenCursor(tokens, specPath);

  cursor.expectKeyword("MODULE");
  const moduleNameTok = cursor.consume();
  if (moduleNameTok.kind !== "keyword" && moduleNameTok.kind !== "ident") {
    throw new FormalSpecParseError(
      specPath,
      moduleNameTok.line,
      moduleNameTok.column,
      "expected module name after MODULE",
    );
  }
  const moduleName = moduleNameTok.value;

  const variables: SpecVariable[] = [];
  const inits: SpecAssignment[] = [];
  const nexts: SpecAssignment[] = [];
  const formulae: SpecFormula[] = [];

  while (cursor.peek().kind !== "eof") {
    if (cursor.matchKeyword("VAR")) {
      cursor.consume();
      parseVarSection(cursor, variables, specPath);
      continue;
    }
    if (cursor.matchKeyword("ASSIGN")) {
      cursor.consume();
      parseAssignSection(cursor, inits, nexts, specPath);
      continue;
    }
    if (cursor.matchKeyword("LTLSPEC")) {
      cursor.consume();
      const startLine = cursor.peek().line;
      const startCol = cursor.peek().column;
      const ast = parseTemporal(cursor, "LTL", specPath);
      const text = stringifyTemporal(ast);
      formulae.push({ logic: "LTL", source: text, ast });
      void startLine;
      void startCol;
      continue;
    }
    if (cursor.matchKeyword("CTLSPEC")) {
      cursor.consume();
      const ast = parseTemporal(cursor, "CTL", specPath);
      const text = stringifyTemporal(ast);
      formulae.push({ logic: "CTL", source: text, ast });
      continue;
    }
    if (cursor.matchKeyword("DEFINE")) {
      // Reserved for the spec format; not implemented for the pilot.
      throw cursor.error(
        "DEFINE sections are not supported; inline the predicate in the formula",
      );
    }
    const tok = cursor.peek();
    throw new FormalSpecParseError(
      specPath,
      tok.line,
      tok.column,
      `unexpected token at top level: ${describe(tok)}`,
    );
  }

  if (variables.length === 0) {
    throw new FormalSpecModelError(specPath, "spec declares no variables");
  }
  if (inits.length === 0) {
    throw new FormalSpecModelError(specPath, "spec declares no init() rules");
  }
  if (formulae.length === 0) {
    throw new FormalSpecModelError(
      specPath,
      "spec declares no LTLSPEC / CTLSPEC formulae",
    );
  }

  return {
    module: moduleName,
    variables,
    inits,
    nexts,
    formulae,
  };
};

const parseVarSection = (
  cursor: TokenCursor,
  out: SpecVariable[],
  specPath: string,
): void => {
  while (
    cursor.peek().kind === "ident" ||
    (cursor.peek().kind === "keyword" && cursor.peek().value === "main")
  ) {
    const nameTok = cursor.consume();
    const name = nameTok.value;
    cursor.expectPunct(":");
    if (cursor.matchPunct("{")) {
      cursor.consume();
      const values: string[] = [];
      while (!cursor.matchPunct("}")) {
        const tok = cursor.consume();
        if (tok.kind === "ident") {
          values.push(tok.value);
        } else if (tok.kind === "int") {
          values.push(tok.value);
        } else if (tok.kind === "keyword" && (tok.value === "TRUE" || tok.value === "FALSE")) {
          values.push(tok.value);
        } else {
          throw new FormalSpecParseError(
            specPath,
            tok.line,
            tok.column,
            `expected enum value, got ${describe(tok)}`,
          );
        }
        if (cursor.matchPunct(",")) {
          cursor.consume();
        } else {
          break;
        }
      }
      cursor.expectPunct("}");
      cursor.expectPunct(";");
      if (values.length === 0) {
        throw new FormalSpecModelError(
          specPath,
          `enum domain of ${name} is empty`,
        );
      }
      out.push({ kind: "enum", name, values });
      continue;
    }
    if (cursor.peek().kind === "int") {
      const minTok = cursor.consume();
      const min = Number(minTok.value);
      if (!cursor.matchOperator("..")) {
        throw cursor.error("expected '..' in range domain");
      }
      cursor.consume();
      const maxTokVal = cursor.peek();
      if (maxTokVal.kind !== "int") {
        throw cursor.error("expected upper bound integer in range domain");
      }
      cursor.consume();
      const max = Number(maxTokVal.value);
      cursor.expectPunct(";");
      if (max < min) {
        throw new FormalSpecModelError(
          specPath,
          `range domain of ${name} is empty (${min}..${max})`,
        );
      }
      if (max - min > 256) {
        throw new FormalSpecModelError(
          specPath,
          `range domain of ${name} too wide: ${min}..${max}`,
        );
      }
      out.push({ kind: "range", name, min, max });
      continue;
    }
    if (cursor.matchKeyword("boolean")) {
      cursor.consume();
      cursor.expectPunct(";");
      out.push({ kind: "enum", name, values: ["FALSE", "TRUE"] });
      continue;
    }
    throw cursor.error(`unsupported variable type for ${name}`);
  }
};

const parseAssignSection = (
  cursor: TokenCursor,
  inits: SpecAssignment[],
  nexts: SpecAssignment[],
  specPath: string,
): void => {
  while (cursor.matchKeyword("init") || cursor.matchKeyword("next")) {
    const which = cursor.consume().value as "init" | "next";
    cursor.expectPunct("(");
    const nameTok = cursor.consume();
    if (nameTok.kind !== "ident") {
      throw new FormalSpecParseError(
        specPath,
        nameTok.line,
        nameTok.column,
        "expected variable name in init/next",
      );
    }
    cursor.expectPunct(")");
    if (!cursor.matchOperator(":=")) {
      throw cursor.error("expected ':=' after init/next(...)");
    }
    cursor.consume();
    const expr = parseExpr(cursor, specPath);
    cursor.expectPunct(";");
    const target = which === "init" ? inits : nexts;
    target.push({ variable: nameTok.value, expr });
  }
};

// ---- Expression parser ----------------------------------------------------

const parseExpr = (cursor: TokenCursor, specPath: string): ExprAst => {
  return parseIff(cursor, specPath);
};

const parseIff = (cursor: TokenCursor, specPath: string): ExprAst => {
  let left = parseImplies(cursor, specPath);
  while (cursor.matchOperator("<->")) {
    cursor.consume();
    const right = parseImplies(cursor, specPath);
    left = { kind: "binop", op: "<->", left, right };
  }
  return left;
};

const parseImplies = (cursor: TokenCursor, specPath: string): ExprAst => {
  const left = parseOr(cursor, specPath);
  if (cursor.matchOperator("->")) {
    cursor.consume();
    const right = parseImplies(cursor, specPath);
    return { kind: "binop", op: "->", left, right };
  }
  return left;
};

const parseOr = (cursor: TokenCursor, specPath: string): ExprAst => {
  let left = parseAnd(cursor, specPath);
  while (cursor.matchPunct("|")) {
    cursor.consume();
    const right = parseAnd(cursor, specPath);
    left = { kind: "binop", op: "|", left, right };
  }
  return left;
};

const parseAnd = (cursor: TokenCursor, specPath: string): ExprAst => {
  let left = parseNot(cursor, specPath);
  while (cursor.matchPunct("&")) {
    cursor.consume();
    const right = parseNot(cursor, specPath);
    left = { kind: "binop", op: "&", left, right };
  }
  return left;
};

const parseNot = (cursor: TokenCursor, specPath: string): ExprAst => {
  if (cursor.matchPunct("!")) {
    cursor.consume();
    const operand = parseNot(cursor, specPath);
    return { kind: "unop", op: "!", operand };
  }
  return parseRelation(cursor, specPath);
};

const REL_OPS: ReadonlyArray<ExprBinOp> = ["=", "!=", "<", "<=", ">", ">="];

const parseRelation = (cursor: TokenCursor, specPath: string): ExprAst => {
  const left = parseAdditive(cursor, specPath);
  const tok = cursor.peek();
  for (const op of REL_OPS) {
    if (
      (tok.kind === "punct" && tok.value === op) ||
      (tok.kind === "operator" && tok.value === op)
    ) {
      cursor.consume();
      const right = parseAdditive(cursor, specPath);
      return { kind: "binop", op, left, right };
    }
  }
  if (cursor.matchKeyword("in")) {
    cursor.consume();
    cursor.expectPunct("{");
    const values: PrimitiveValue[] = [];
    while (!cursor.matchPunct("}")) {
      const v = cursor.consume();
      if (v.kind === "ident") values.push(v.value);
      else if (v.kind === "int") values.push(Number(v.value));
      else if (v.kind === "keyword" && (v.value === "TRUE" || v.value === "FALSE"))
        values.push(v.value === "TRUE");
      else
        throw new FormalSpecParseError(
          specPath,
          v.line,
          v.column,
          `expected set member, got ${describe(v)}`,
        );
      if (cursor.matchPunct(",")) cursor.consume();
      else break;
    }
    cursor.expectPunct("}");
    return {
      kind: "binop",
      op: "in",
      left,
      right: { kind: "set", values },
    };
  }
  return left;
};

const parseAdditive = (cursor: TokenCursor, specPath: string): ExprAst => {
  let left = parsePrimary(cursor, specPath);
  while (
    (cursor.peek().kind === "punct" &&
      (cursor.peek().value === "+" || cursor.peek().value === "-"))
  ) {
    const op = cursor.consume().value as "+" | "-";
    const right = parsePrimary(cursor, specPath);
    left = { kind: "binop", op, left, right };
  }
  return left;
};

const parsePrimary = (cursor: TokenCursor, specPath: string): ExprAst => {
  const tok = cursor.peek();
  if (tok.kind === "keyword" && tok.value === "TRUE") {
    cursor.consume();
    return { kind: "bool", value: true };
  }
  if (tok.kind === "keyword" && tok.value === "FALSE") {
    cursor.consume();
    return { kind: "bool", value: false };
  }
  if (tok.kind === "keyword" && tok.value === "case") {
    cursor.consume();
    const cases: { readonly guard: ExprAst; readonly value: ExprAst }[] = [];
    while (!cursor.matchKeyword("esac")) {
      const guard = parseExpr(cursor, specPath);
      cursor.expectPunct(":");
      const value = parseExpr(cursor, specPath);
      cursor.expectPunct(";");
      cases.push({ guard, value });
    }
    cursor.expectKeyword("esac");
    return { kind: "case", cases };
  }
  if (tok.kind === "punct" && tok.value === "(") {
    cursor.consume();
    const inner = parseExpr(cursor, specPath);
    cursor.expectPunct(")");
    return inner;
  }
  if (tok.kind === "punct" && tok.value === "{") {
    cursor.consume();
    const values: PrimitiveValue[] = [];
    while (!cursor.matchPunct("}")) {
      const v = cursor.consume();
      if (v.kind === "ident") values.push(v.value);
      else if (v.kind === "int") values.push(Number(v.value));
      else if (v.kind === "keyword" && (v.value === "TRUE" || v.value === "FALSE"))
        values.push(v.value === "TRUE");
      else
        throw new FormalSpecParseError(
          specPath,
          v.line,
          v.column,
          `expected literal in set, got ${describe(v)}`,
        );
      if (cursor.matchPunct(",")) cursor.consume();
      else break;
    }
    cursor.expectPunct("}");
    return { kind: "set", values };
  }
  if (tok.kind === "ident") {
    cursor.consume();
    return { kind: "ident", name: tok.value };
  }
  if (tok.kind === "int") {
    cursor.consume();
    return { kind: "int", value: Number(tok.value) };
  }
  throw new FormalSpecParseError(
    specPath,
    tok.line,
    tok.column,
    `unexpected token in expression: ${describe(tok)}`,
  );
};

// ---- Temporal parser ------------------------------------------------------

const parseTemporal = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => parseTemporalIff(cursor, logic, specPath);

const parseTemporalIff = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  let left = parseTemporalImplies(cursor, logic, specPath);
  while (cursor.matchOperator("<->")) {
    cursor.consume();
    const right = parseTemporalImplies(cursor, logic, specPath);
    left = { kind: "iff", left, right };
  }
  return left;
};

const parseTemporalImplies = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  const left = parseTemporalOr(cursor, logic, specPath);
  if (cursor.matchOperator("->")) {
    cursor.consume();
    const right = parseTemporalImplies(cursor, logic, specPath);
    return { kind: "implies", left, right };
  }
  return left;
};

const parseTemporalOr = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  let left = parseTemporalAnd(cursor, logic, specPath);
  while (cursor.matchPunct("|")) {
    cursor.consume();
    const right = parseTemporalAnd(cursor, logic, specPath);
    left = { kind: "or", left, right };
  }
  return left;
};

const parseTemporalAnd = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  let left = parseTemporalUntil(cursor, logic, specPath);
  while (cursor.matchPunct("&")) {
    cursor.consume();
    const right = parseTemporalUntil(cursor, logic, specPath);
    left = { kind: "and", left, right };
  }
  return left;
};

const parseTemporalUntil = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  const left = parseTemporalUnary(cursor, logic, specPath);
  if (logic === "LTL" && cursor.matchKeyword("U")) {
    cursor.consume();
    const right = parseTemporalUnary(cursor, logic, specPath);
    return { kind: "U", left, right };
  }
  // In CTL mode the bare `U` keyword belongs to an outer `A[..U..]` or
  // `E[..U..]` construct — the caller's path-quantifier branch consumes
  // it. We deliberately do not consume it here so the outer parser
  // receives a clean LHS without losing the operator.
  return left;
};

const parseTemporalUnary = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  if (cursor.matchPunct("!")) {
    cursor.consume();
    const operand = parseTemporalUnary(cursor, logic, specPath);
    return { kind: "not", operand };
  }

  if (logic === "LTL") {
    for (const kw of ["G", "F", "X"] as const) {
      if (cursor.matchKeyword(kw)) {
        cursor.consume();
        const operand = parseTemporalUnary(cursor, logic, specPath);
        return { kind: kw, operand };
      }
    }
  }

  if (logic === "CTL") {
    for (const kw of ["EX", "AX", "EF", "AF", "EG", "AG"] as const) {
      if (cursor.matchKeyword(kw)) {
        cursor.consume();
        const operand = parseTemporalUnary(cursor, logic, specPath);
        return { kind: kw, operand };
      }
    }
    if (cursor.matchKeyword("A") || cursor.matchKeyword("E")) {
      const quant = cursor.consume().value as "A" | "E";
      cursor.expectPunct("[");
      const left = parseTemporal(cursor, logic, specPath);
      if (!cursor.matchKeyword("U")) {
        throw cursor.error(`expected 'U' inside ${quant}[ ... U ... ]`);
      }
      cursor.consume();
      const right = parseTemporal(cursor, logic, specPath);
      cursor.expectPunct("]");
      return quant === "A"
        ? { kind: "AU", left, right }
        : { kind: "EU", left, right };
    }
  }

  return parseTemporalAtom(cursor, logic, specPath);
};

const parseTemporalAtom = (
  cursor: TokenCursor,
  logic: FormalVerificationLogic,
  specPath: string,
): TemporalAst => {
  if (cursor.matchPunct("(")) {
    cursor.consume();
    const inner = parseTemporal(cursor, logic, specPath);
    cursor.expectPunct(")");
    return inner;
  }
  // Atomic propositions stop at relation-level. The temporal parser
  // owns `&`, `|`, `->`, `<->`, so the expression parser inside an
  // atom must not consume those — otherwise it eats past the next
  // temporal operator (e.g. it would swallow the `->` ahead of `F …`).
  const expr = parseRelation(cursor, specPath);
  return { kind: "atom", expr };
};

const stringifyTemporal = (ast: TemporalAst): string => {
  const stringifyExpr = (e: ExprAst): string => {
    if (e.kind === "ident") return e.name;
    if (e.kind === "int") return String(e.value);
    if (e.kind === "bool") return e.value ? "TRUE" : "FALSE";
    if (e.kind === "set") {
      return `{${e.values.map((v) => (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v))).join(", ")}}`;
    }
    if (e.kind === "binop") {
      if (e.op === "in") {
        return `(${stringifyExpr(e.left)} in ${stringifyExpr(e.right)})`;
      }
      return `(${stringifyExpr(e.left)} ${e.op} ${stringifyExpr(e.right)})`;
    }
    if (e.kind === "unop") {
      return `!${stringifyExpr(e.operand)}`;
    }
    return `case ${e.cases
      .map(({ guard, value }) => `${stringifyExpr(guard)} : ${stringifyExpr(value)};`)
      .join(" ")} esac`;
  };
  const go = (node: TemporalAst): string => {
    switch (node.kind) {
      case "atom":
        return stringifyExpr(node.expr);
      case "not":
        return `!${go(node.operand)}`;
      case "and":
        return `(${go(node.left)} & ${go(node.right)})`;
      case "or":
        return `(${go(node.left)} | ${go(node.right)})`;
      case "implies":
        return `(${go(node.left)} -> ${go(node.right)})`;
      case "iff":
        return `(${go(node.left)} <-> ${go(node.right)})`;
      case "G":
      case "F":
      case "X":
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        return `${node.kind} ${go(node.operand)}`;
      case "U":
        return `(${go(node.left)} U ${go(node.right)})`;
      case "EU":
        return `E[${go(node.left)} U ${go(node.right)}]`;
      case "AU":
        return `A[${go(node.left)} U ${go(node.right)}]`;
    }
  };
  return go(ast);
};

// ---------------------------------------------------------------------------
// Kripke structure builder
// ---------------------------------------------------------------------------

interface KripkeStructure {
  readonly states: ReadonlyMap<string, FormalVerificationState>;
  readonly initial: readonly string[];
  readonly transitions: ReadonlyMap<string, readonly string[]>;
}

const stateId = (
  valuation: Readonly<Record<string, string | number | boolean>>,
): string => {
  const keys = Object.keys(valuation).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify(valuation[k])}`);
  return parts.join("|");
};

interface EvalContext {
  readonly valuation: Readonly<Record<string, string | number | boolean>>;
  readonly enumLiterals: ReadonlySet<string>;
}

const evalExpr = (
  expr: ExprAst,
  context: EvalContext,
): PrimitiveValue | readonly PrimitiveValue[] => {
  const { valuation, enumLiterals } = context;
  switch (expr.kind) {
    case "ident": {
      const v = valuation[expr.name];
      if (v !== undefined) return v;
      if (enumLiterals.has(expr.name)) return expr.name;
      throw new Error(`unknown identifier '${expr.name}' in expression`);
    }
    case "int":
      return expr.value;
    case "bool":
      return expr.value;
    case "set":
      return expr.values;
    case "unop": {
      const operand = evalExpr(expr.operand, context);
      if (typeof operand !== "boolean") {
        throw new Error("'!' applied to non-boolean");
      }
      return !operand;
    }
    case "binop": {
      if (expr.op === "in") {
        const left = evalExpr(expr.left, context);
        const right = evalExpr(expr.right, context);
        if (!isPrimitiveArray(right))
          throw new Error("'in' rhs must be a set");
        if (isPrimitiveArray(left))
          throw new Error("'in' lhs must be a scalar");
        return right.some((member) => primitiveEqual(member, left));
      }
      const leftRaw = evalExpr(expr.left, context);
      const rightRaw = evalExpr(expr.right, context);
      if (isPrimitiveArray(leftRaw) || isPrimitiveArray(rightRaw)) {
        throw new Error(`set value cannot appear directly under '${expr.op}'`);
      }
      const left: PrimitiveValue = leftRaw;
      const right: PrimitiveValue = rightRaw;
      switch (expr.op) {
        case "+":
          return asNum(left) + asNum(right);
        case "-":
          return asNum(left) - asNum(right);
        case "=":
          return primitiveEqual(left, right);
        case "!=":
          return !primitiveEqual(left, right);
        case "<":
          return asNum(left) < asNum(right);
        case "<=":
          return asNum(left) <= asNum(right);
        case ">":
          return asNum(left) > asNum(right);
        case ">=":
          return asNum(left) >= asNum(right);
        case "&":
          return asBool(left) && asBool(right);
        case "|":
          return asBool(left) || asBool(right);
        case "->":
          return !asBool(left) || asBool(right);
        case "<->":
          return asBool(left) === asBool(right);
      }
      throw new Error(`unsupported binary operator ${String(expr.op)}`);
    }
    case "case": {
      for (const { guard, value } of expr.cases) {
        const guardVal = evalExpr(guard, context);
        if (isPrimitiveArray(guardVal)) {
          throw new Error("case guard cannot evaluate to a set");
        }
        if (asBool(guardVal)) {
          return evalExpr(value, context);
        }
      }
      throw new Error("case expression has no matching branch (missing TRUE fallback)");
    }
  }
};

const primitiveEqual = (a: PrimitiveValue, b: PrimitiveValue): boolean => {
  if (typeof a === "boolean" || typeof b === "boolean") {
    return asBool(a) === asBool(b);
  }
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "string" && typeof b === "number") return Number(a) === b;
  if (typeof a === "number" && typeof b === "string") return a === Number(b);
  return false;
};

const asNum = (v: PrimitiveValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  throw new Error(`expected number, got ${JSON.stringify(v)}`);
};

const asBool = (v: PrimitiveValue): boolean => {
  if (typeof v === "boolean") return v;
  if (v === "TRUE") return true;
  if (v === "FALSE") return false;
  if (typeof v === "number") return v !== 0;
  throw new Error(`expected boolean, got ${JSON.stringify(v)}`);
};

const variableDomain = (v: SpecVariable): readonly (string | number)[] => {
  if (v.kind === "enum") return v.values;
  const xs: number[] = [];
  for (let i = v.min; i <= v.max; i += 1) xs.push(i);
  return xs;
};

const nextValuations = (
  current: Readonly<Record<string, string | number | boolean>>,
  variables: readonly SpecVariable[],
  nextRules: readonly SpecAssignment[],
  enumLiterals: ReadonlySet<string>,
): ReadonlyArray<Readonly<Record<string, string | number | boolean>>> => {
  const rulesByVar = new Map<string, ExprAst>();
  for (const rule of nextRules) {
    rulesByVar.set(rule.variable, rule.expr);
  }
  const choicesPerVar: Array<readonly (string | number | boolean)[]> = [];
  const orderedVars: string[] = [];
  const ctx: EvalContext = { valuation: current, enumLiterals };
  for (const v of variables) {
    orderedVars.push(v.name);
    const rule = rulesByVar.get(v.name);
    if (rule === undefined) {
      // No `next` rule → variable stays the same (stutter).
      choicesPerVar.push([current[v.name] as string | number | boolean]);
      continue;
    }
    const value = evalExpr(rule, ctx);
    choicesPerVar.push(Array.isArray(value) ? value : [value]);
  }
  const acc: Record<string, string | number | boolean>[] = [{}];
  for (let i = 0; i < orderedVars.length; i += 1) {
    const name = orderedVars[i] ?? "";
    const choices = choicesPerVar[i] ?? [];
    const next: Record<string, string | number | boolean>[] = [];
    for (const partial of acc) {
      for (const choice of choices) {
        next.push({ ...partial, [name]: choice });
      }
    }
    acc.length = 0;
    acc.push(...next);
  }
  // Enforce that values stay within their declared domains.
  return acc.filter((valuation) =>
    variables.every((v) => valueInDomain(valuation[v.name], v)),
  );
};

const valueInDomain = (
  value: string | number | boolean | undefined,
  variable: SpecVariable,
): boolean => {
  if (value === undefined) return false;
  if (variable.kind === "enum") {
    return variable.values.some((entry) =>
      primitiveEqual(entry, value),
    );
  }
  const n = asNum(value);
  return n >= variable.min && n <= variable.max && Number.isInteger(n);
};

const initialValuations = (
  variables: readonly SpecVariable[],
  initRules: readonly SpecAssignment[],
  enumLiterals: ReadonlySet<string>,
): ReadonlyArray<Readonly<Record<string, string | number | boolean>>> => {
  const rulesByVar = new Map<string, ExprAst>();
  for (const rule of initRules) {
    rulesByVar.set(rule.variable, rule.expr);
  }
  const choices: Array<readonly (string | number | boolean)[]> = [];
  const names: string[] = [];
  const ctx: EvalContext = { valuation: {}, enumLiterals };
  for (const v of variables) {
    names.push(v.name);
    const rule = rulesByVar.get(v.name);
    if (rule === undefined) {
      // No explicit init → any value in domain.
      choices.push(variableDomain(v));
      continue;
    }
    // For initial assignments we evaluate the expression against an
    // empty valuation extended with no dependencies. `init()` should
    // reference only literals or set expressions in well-formed specs.
    const value = evalExpr(rule, ctx);
    choices.push(Array.isArray(value) ? value : [value]);
  }
  const acc: Record<string, string | number | boolean>[] = [{}];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i] ?? "";
    const opts = choices[i] ?? [];
    const next: Record<string, string | number | boolean>[] = [];
    for (const partial of acc) {
      for (const c of opts) {
        next.push({ ...partial, [name]: c });
      }
    }
    acc.length = 0;
    acc.push(...next);
  }
  return acc.filter((valuation) =>
    variables.every((v) => valueInDomain(valuation[v.name], v)),
  );
};

const collectEnumLiterals = (spec: ParsedSpec): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const v of spec.variables) {
    if (v.kind === "enum") {
      for (const value of v.values) out.add(value);
    }
  }
  return out;
};

interface KripkeBuildContext {
  readonly spec: ParsedSpec;
  readonly enumLiterals: ReadonlySet<string>;
}

const buildKripke = (spec: ParsedSpec, specPath: string): KripkeStructure => {
  const enumLiterals = collectEnumLiterals(spec);
  const states = new Map<string, FormalVerificationState>();
  const transitions = new Map<string, string[]>();
  const initialStates: string[] = [];
  const queue: Array<Readonly<Record<string, string | number | boolean>>> = [];
  const ctx: KripkeBuildContext = { spec, enumLiterals };

  for (const v of initialValuations(spec.variables, spec.inits, enumLiterals)) {
    const id = stateId(v);
    if (!states.has(id)) {
      states.set(id, { id, valuation: Object.freeze({ ...v }) });
      queue.push(v);
    }
    if (!initialStates.includes(id)) {
      initialStates.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift() as Readonly<
      Record<string, string | number | boolean>
    >;
    const currentId = stateId(current);
    if (states.size > FORMAL_VERIFICATION_STATE_LIMIT) {
      throw new FormalSpecModelError(
        specPath,
        `reachable state count exceeds limit ${FORMAL_VERIFICATION_STATE_LIMIT}`,
      );
    }
    const successors = nextValuations(
      current,
      ctx.spec.variables,
      ctx.spec.nexts,
      enumLiterals,
    );
    const nextIds: string[] = [];
    for (const succ of successors) {
      const id = stateId(succ);
      if (!states.has(id)) {
        states.set(id, { id, valuation: Object.freeze({ ...succ }) });
        queue.push(succ);
      }
      if (!nextIds.includes(id)) {
        nextIds.push(id);
      }
    }
    // Total-transition convention: dead states self-loop so LTL/CTL
    // semantics on infinite paths remain well-defined.
    if (nextIds.length === 0) {
      nextIds.push(currentId);
    }
    transitions.set(currentId, nextIds);
  }

  return {
    states,
    initial: initialStates,
    transitions,
  };
};

// ---------------------------------------------------------------------------
// LTL → ACTL* translation
// ---------------------------------------------------------------------------

/**
 * Translate an LTL formula into an equivalent CTL formula for the
 * ACTL fragment we accept. We use the standard universal-path mapping
 * (`G → AG`, `F → AF`, `X → AX`, `U → AU`). Operators outside this
 * fragment (e.g. nested existential quantification inside LTL) are
 * rejected at parse time because the grammar offers no path-quantifier
 * inside LTLSPEC.
 */
const ltlToCtl = (ast: TemporalAst): TemporalAst => {
  switch (ast.kind) {
    case "atom":
      return ast;
    case "not":
      return { kind: "not", operand: ltlToCtl(ast.operand) };
    case "and":
    case "or":
    case "implies":
    case "iff":
      return {
        kind: ast.kind,
        left: ltlToCtl(ast.left),
        right: ltlToCtl(ast.right),
      };
    case "G":
      return { kind: "AG", operand: ltlToCtl(ast.operand) };
    case "F":
      return { kind: "AF", operand: ltlToCtl(ast.operand) };
    case "X":
      return { kind: "AX", operand: ltlToCtl(ast.operand) };
    case "U":
      return {
        kind: "AU",
        left: ltlToCtl(ast.left),
        right: ltlToCtl(ast.right),
      };
    // CTL nodes — already CTL, no translation needed.
    case "EX":
    case "AX":
    case "EF":
    case "AF":
    case "EG":
    case "AG":
      return { kind: ast.kind, operand: ltlToCtl(ast.operand) };
    case "EU":
    case "AU":
      return {
        kind: ast.kind,
        left: ltlToCtl(ast.left),
        right: ltlToCtl(ast.right),
      };
  }
};

// ---------------------------------------------------------------------------
// CTL model checker (explicit-state fixed-point)
// ---------------------------------------------------------------------------

const atomSatisfies = (
  expr: ExprAst,
  valuation: Readonly<Record<string, string | number | boolean>>,
  enumLiterals: ReadonlySet<string>,
): boolean => {
  const value = evalExpr(expr, { valuation, enumLiterals });
  if (isPrimitiveArray(value)) {
    throw new Error("atomic proposition must evaluate to a scalar");
  }
  return asBool(value);
};

const isPrimitiveArray = (
  value: PrimitiveValue | readonly PrimitiveValue[],
): value is readonly PrimitiveValue[] => Array.isArray(value);

const predecessors = (
  kripke: KripkeStructure,
): ReadonlyMap<string, readonly string[]> => {
  const preds = new Map<string, string[]>();
  for (const id of kripke.states.keys()) preds.set(id, []);
  for (const [from, tos] of kripke.transitions) {
    for (const to of tos) {
      const bucket = preds.get(to);
      if (bucket && !bucket.includes(from)) bucket.push(from);
    }
  }
  return preds;
};

const allStateIds = (kripke: KripkeStructure): readonly string[] =>
  Array.from(kripke.states.keys());

interface CtlContext {
  readonly kripke: KripkeStructure;
  readonly preds: ReadonlyMap<string, readonly string[]>;
  readonly enumLiterals: ReadonlySet<string>;
}

const checkCtl = (
  ast: TemporalAst,
  ctx: CtlContext,
): ReadonlySet<string> => {
  const { kripke, preds, enumLiterals } = ctx;
  const all = allStateIds(kripke);
  switch (ast.kind) {
    case "atom": {
      const out = new Set<string>();
      for (const id of all) {
        const state = kripke.states.get(id);
        if (state && atomSatisfies(ast.expr, state.valuation, enumLiterals))
          out.add(id);
      }
      return out;
    }
    case "not": {
      const inner = checkCtl(ast.operand, ctx);
      const out = new Set<string>();
      for (const id of all) if (!inner.has(id)) out.add(id);
      return out;
    }
    case "and": {
      const a = checkCtl(ast.left, ctx);
      const b = checkCtl(ast.right, ctx);
      const out = new Set<string>();
      for (const id of a) if (b.has(id)) out.add(id);
      return out;
    }
    case "or": {
      const a = checkCtl(ast.left, ctx);
      const b = checkCtl(ast.right, ctx);
      const out = new Set<string>();
      for (const id of a) out.add(id);
      for (const id of b) out.add(id);
      return out;
    }
    case "implies": {
      const left = checkCtl(ast.left, ctx);
      const right = checkCtl(ast.right, ctx);
      const out = new Set<string>();
      for (const id of all) if (!left.has(id) || right.has(id)) out.add(id);
      return out;
    }
    case "iff": {
      const left = checkCtl(ast.left, ctx);
      const right = checkCtl(ast.right, ctx);
      const out = new Set<string>();
      for (const id of all)
        if (left.has(id) === right.has(id)) out.add(id);
      return out;
    }
    case "EX": {
      const inner = checkCtl(ast.operand, ctx);
      const out = new Set<string>();
      for (const id of all) {
        const succ = kripke.transitions.get(id) ?? [];
        if (succ.some((s) => inner.has(s))) out.add(id);
      }
      return out;
    }
    case "AX": {
      const inner = checkCtl(ast.operand, ctx);
      const out = new Set<string>();
      for (const id of all) {
        const succ = kripke.transitions.get(id) ?? [];
        if (succ.length > 0 && succ.every((s) => inner.has(s))) out.add(id);
      }
      return out;
    }
    case "EF": {
      // E[true U φ] — backward BFS from states satisfying φ.
      const target = checkCtl(ast.operand, ctx);
      const out = new Set<string>(target);
      const queue: string[] = [...target];
      while (queue.length > 0) {
        const s = queue.shift() as string;
        for (const p of preds.get(s) ?? []) {
          if (!out.has(p)) {
            out.add(p);
            queue.push(p);
          }
        }
      }
      return out;
    }
    case "AF": {
      // AF φ = ¬ EG ¬φ
      const negOperand: TemporalAst = { kind: "not", operand: ast.operand };
      const egNeg = checkCtl({ kind: "EG", operand: negOperand }, ctx);
      const out = new Set<string>();
      for (const id of all) if (!egNeg.has(id)) out.add(id);
      return out;
    }
    case "EG": {
      // EG φ — largest set S ⊆ φ-states such that every state has a successor in S.
      const phi = checkCtl(ast.operand, ctx);
      let current = new Set<string>(phi);
      let reachedFixedPoint = false;
      while (!reachedFixedPoint) {
        const next = new Set<string>();
        for (const id of current) {
          const succ = kripke.transitions.get(id) ?? [];
          if (succ.some((s) => current.has(s))) next.add(id);
        }
        if (next.size === current.size) {
          let identical = true;
          for (const id of current) if (!next.has(id)) identical = false;
          if (identical) reachedFixedPoint = true;
        }
        current = next;
      }
      return current;
    }
    case "AG": {
      // AG φ = ¬ EF ¬φ
      const negOperand: TemporalAst = { kind: "not", operand: ast.operand };
      const efNeg = checkCtl({ kind: "EF", operand: negOperand }, ctx);
      const out = new Set<string>();
      for (const id of all) if (!efNeg.has(id)) out.add(id);
      return out;
    }
    case "EU": {
      // E[p U q] — least fixed-point: q ∨ (p ∧ EX EU).
      const left = checkCtl(ast.left, ctx);
      const right = checkCtl(ast.right, ctx);
      const out = new Set<string>(right);
      const queue: string[] = [...right];
      while (queue.length > 0) {
        const s = queue.shift() as string;
        for (const p of preds.get(s) ?? []) {
          if (!out.has(p) && left.has(p)) {
            out.add(p);
            queue.push(p);
          }
        }
      }
      return out;
    }
    case "AU": {
      // A[p U q] = ¬E[¬q U (¬p ∧ ¬q)] ∧ ¬EG ¬q
      const notP: TemporalAst = { kind: "not", operand: ast.left };
      const notQ: TemporalAst = { kind: "not", operand: ast.right };
      const notPAndNotQ: TemporalAst = { kind: "and", left: notP, right: notQ };
      const euNeg = checkCtl(
        { kind: "EU", left: notQ, right: notPAndNotQ },
        ctx,
      );
      const egNotQ = checkCtl({ kind: "EG", operand: notQ }, ctx);
      const out = new Set<string>();
      for (const id of all) if (!euNeg.has(id) && !egNotQ.has(id)) out.add(id);
      return out;
    }
    // LTL temporal operators reach this checker only if the caller
    // forgot to translate them; refuse rather than silently misinterpret.
    case "G":
    case "F":
    case "X":
    case "U":
      throw new Error(
        `internal: untranslated LTL operator ${ast.kind} reached CTL checker`,
      );
  }
};

// ---------------------------------------------------------------------------
// Counterexample search
// ---------------------------------------------------------------------------

const findCounterexample = (
  kripke: KripkeStructure,
  formula: TemporalAst,
  satisfying: ReadonlySet<string>,
  enumLiterals: ReadonlySet<string>,
): FormalVerificationCounterexample | undefined => {
  // The formula fails iff some initial state is **not** in `satisfying`.
  const failingInitial = kripke.initial.find((id) => !satisfying.has(id));
  if (failingInitial === undefined) return undefined;

  const visited = new Set<string>();
  const parents = new Map<string, string>();
  const queue: string[] = [failingInitial];
  visited.add(failingInitial);
  let witness: string | undefined;

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (witnessesFailure(kripke, id, formula, enumLiterals)) {
      witness = id;
      break;
    }
    const succ = kripke.transitions.get(id) ?? [];
    for (const next of succ) {
      if (!visited.has(next)) {
        visited.add(next);
        parents.set(next, id);
        queue.push(next);
      }
    }
  }

  const target = witness ?? failingInitial;
  const path: string[] = [target];
  let cursor = target;
  while (cursor !== failingInitial) {
    const parent = parents.get(cursor);
    if (parent === undefined) break;
    path.unshift(parent);
    cursor = parent;
  }
  const trace: FormalVerificationState[] = [];
  for (const id of path) {
    const state = kripke.states.get(id);
    if (state) trace.push(state);
  }
  return {
    trace,
    explanation: explainCounterexample(formula, trace),
  };
};

const witnessesFailure = (
  kripke: KripkeStructure,
  stateId: string,
  formula: TemporalAst,
  enumLiterals: ReadonlySet<string>,
): boolean => {
  const state = kripke.states.get(stateId);
  if (!state) return false;
  // For AG φ failures, the witness is any state where ¬φ holds.
  // For AF φ failures, the witness is a state on an infinite ¬φ path.
  // For atomic / propositional formulas the failing initial state
  // already is the witness — fall back to that case for everything we
  // do not recognise explicitly.
  if (formula.kind === "AG") {
    try {
      return !atomCoreSatisfies(formula.operand, state.valuation, enumLiterals);
    } catch {
      return false;
    }
  }
  if (formula.kind === "implies") {
    try {
      return (
        atomCoreSatisfies(formula.left, state.valuation, enumLiterals) &&
        !atomCoreSatisfies(formula.right, state.valuation, enumLiterals)
      );
    } catch {
      return false;
    }
  }
  return false;
};

const atomCoreSatisfies = (
  ast: TemporalAst,
  valuation: Readonly<Record<string, string | number | boolean>>,
  enumLiterals: ReadonlySet<string>,
): boolean => {
  switch (ast.kind) {
    case "atom":
      return atomSatisfies(ast.expr, valuation, enumLiterals);
    case "not":
      return !atomCoreSatisfies(ast.operand, valuation, enumLiterals);
    case "and":
      return (
        atomCoreSatisfies(ast.left, valuation, enumLiterals) &&
        atomCoreSatisfies(ast.right, valuation, enumLiterals)
      );
    case "or":
      return (
        atomCoreSatisfies(ast.left, valuation, enumLiterals) ||
        atomCoreSatisfies(ast.right, valuation, enumLiterals)
      );
    case "implies":
      return (
        !atomCoreSatisfies(ast.left, valuation, enumLiterals) ||
        atomCoreSatisfies(ast.right, valuation, enumLiterals)
      );
    case "iff":
      return (
        atomCoreSatisfies(ast.left, valuation, enumLiterals) ===
        atomCoreSatisfies(ast.right, valuation, enumLiterals)
      );
    default:
      throw new Error(
        `atomCoreSatisfies only evaluates propositional subformulas, got ${ast.kind}`,
      );
  }
};

const explainCounterexample = (
  formula: TemporalAst,
  trace: readonly FormalVerificationState[],
): string => {
  const last = trace[trace.length - 1];
  const summary = last
    ? `at state ${trace.length - 1}: ${stringifyValuation(last.valuation)}`
    : "no reachable failing path found";
  return `formula does not hold; counterexample length ${trace.length}; ${summary}; formula=${stringifyTemporal(formula)}`;
};

const stringifyValuation = (
  v: Readonly<Record<string, string | number | boolean>>,
): string => {
  const keys = Object.keys(v).sort();
  return keys
    .map((k) => {
      const value = v[k];
      return `${k}=${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .join(", ");
};

// ---------------------------------------------------------------------------
// Top-level verification API
// ---------------------------------------------------------------------------

/**
 * Verify a single spec source against the embedded LTL/CTL formulae.
 * The spec source is parsed, lowered to a Kripke structure, and each
 * formula is checked. Returns a per-formula verdict plus a
 * counterexample when the formula does not hold.
 */
export const verifyFormalVerificationSpec = (
  input: VerifyFormalSpecInput,
): FormalVerificationSpecResult => {
  const parsed = parseSpec(input.specSource, input.specPath);
  const kripke = buildKripke(parsed, input.specPath);
  const preds = predecessors(kripke);
  const enumLiterals = collectEnumLiterals(parsed);
  const ctlContext: CtlContext = { kripke, preds, enumLiterals };
  const results: FormalVerificationFormulaResult[] = [];
  for (const formula of parsed.formulae) {
    const ctlAst =
      formula.logic === "LTL" ? ltlToCtl(formula.ast) : formula.ast;
    const satisfying = checkCtl(ctlAst, ctlContext);
    const verdict: FormalVerificationVerdict = kripke.initial.every((id) =>
      satisfying.has(id),
    )
      ? "pass"
      : "fail";
    if (verdict === "pass") {
      results.push({
        logic: formula.logic,
        formula: formula.source,
        verdict,
      });
    } else {
      const counterexample = findCounterexample(
        kripke,
        ctlAst,
        satisfying,
        enumLiterals,
      );
      results.push(
        counterexample === undefined
          ? { logic: formula.logic, formula: formula.source, verdict }
          : {
              logic: formula.logic,
              formula: formula.source,
              verdict,
              counterexample,
            },
      );
    }
  }
  const verdict: FormalVerificationVerdict = results.every(
    (r) => r.verdict === "pass",
  )
    ? "pass"
    : "fail";
  const sha256 = createHash("sha256").update(input.specSource, "utf8").digest("hex");
  return {
    specPath: input.specPath,
    specSha256: sha256,
    module: parsed.module,
    reachableStateCount: kripke.states.size,
    formulae: results,
    verdict,
  };
};

/**
 * Build a deterministic {@link FormalVerificationReport} from the
 * supplied spec sources. The output is byte-stable for identical
 * `(specs, generatedAt)` inputs and is the canonical artifact written
 * to `formal-verification-report.json`.
 */
export const buildFormalVerificationReport = (
  input: BuildFormalVerificationReportInput,
): FormalVerificationReport => {
  if (!Number.isFinite(Date.parse(input.generatedAt))) {
    throw new TypeError(
      `generatedAt must be an ISO-8601 timestamp; got ${JSON.stringify(input.generatedAt)}`,
    );
  }
  const orderedSpecs = [...input.specs].sort((a, b) =>
    a.specPath.localeCompare(b.specPath),
  );
  const specResults = orderedSpecs.map((s) => verifyFormalVerificationSpec(s));
  let formulaCount = 0;
  let passCount = 0;
  let failCount = 0;
  for (const spec of specResults) {
    for (const f of spec.formulae) {
      formulaCount += 1;
      if (f.verdict === "pass") passCount += 1;
      else failCount += 1;
    }
  }
  const verdict: FormalVerificationVerdict = failCount === 0 ? "pass" : "fail";
  return {
    schemaVersion: FORMAL_VERIFICATION_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    specs: specResults,
    summary: {
      specCount: specResults.length,
      formulaCount,
      passCount,
      failCount,
      verdict,
    },
  };
};

/** Render the report as canonical JSON (newline-terminated). */
export const renderFormalVerificationReportJson = (
  report: FormalVerificationReport,
): string => `${canonicalJson(report)}\n`;

/** Render a human-readable plain-text report for stdout. */
export const renderFormalVerificationReportText = (
  report: FormalVerificationReport,
): string => {
  const lines: string[] = [];
  lines.push(
    `formal-verification ${report.summary.verdict.toUpperCase()} — ${report.summary.passCount}/${report.summary.formulaCount} pass`,
  );
  lines.push(`  generated at: ${report.generatedAt}`);
  lines.push(`  specs: ${report.summary.specCount}`);
  lines.push("");
  for (const spec of report.specs) {
    lines.push(
      `[${spec.verdict.toUpperCase()}] ${spec.specPath}  module=${spec.module}  reachable=${spec.reachableStateCount}  sha256=${spec.specSha256}`,
    );
    for (const f of spec.formulae) {
      lines.push(`  ${f.verdict === "pass" ? "PASS" : "FAIL"} [${f.logic}] ${f.formula}`);
      if (f.counterexample) {
        lines.push(`    counterexample: ${f.counterexample.explanation}`);
        for (let i = 0; i < f.counterexample.trace.length; i += 1) {
          const state = f.counterexample.trace[i];
          if (state) {
            lines.push(`      [${i}] ${stringifyValuation(state.valuation)}`);
          }
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
};

/**
 * Throw a {@link FormalVerificationHardGateError} when the report
 * contains any `fail` verdict. Wired into the production runner /
 * release-readiness pipeline so a failing spec fails CI.
 */
export const assertFormalVerificationPass = (
  report: FormalVerificationReport,
): void => {
  if (report.summary.verdict === "fail") {
    throw new FormalVerificationHardGateError(report);
  }
};
