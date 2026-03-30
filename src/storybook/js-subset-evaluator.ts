import { findBalancedSegment, normalizeWhitespace } from "./text.js";

export type JsStaticValue =
  | { kind: "unknown"; reason: string }
  | { kind: "null" }
  | { kind: "undefined" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "array"; values: JsStaticValue[] }
  | { kind: "object"; properties: Map<string, JsStaticValue> }
  | { kind: "function"; params: string[]; body: string; env: JsEvaluationEnvironment };

export interface JsEvaluationDiagnostic {
  code: string;
  message: string;
}

export interface JsEvaluationEnvironment {
  initializers: ReadonlyMap<string, string>;
}

export interface JsEvaluationState {
  diagnostics: JsEvaluationDiagnostic[];
  locals: ReadonlyMap<string, JsStaticValue>;
  maxDepth: number;
  currentDepth: number;
  evaluating: Set<string>;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const UNKNOWN_VALUE = (reason: string): JsStaticValue => ({ kind: "unknown", reason });
const MAX_STRING_LITERAL_LENGTH = 1024;

const isIdentifierChar = (character: string | undefined): boolean => {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
};

const isEscaped = (source: string, index: number): boolean => {
  let slashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && source[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }
  return slashCount % 2 === 1;
};

const skipStringLiteral = (source: string, startIndex: number): number => {
  const quote = source[startIndex];
  if (quote === "`") {
    let cursor = startIndex + 1;
    while (cursor < source.length) {
      const current = source[cursor];
      if (current === "`" && !isEscaped(source, cursor)) {
        return cursor + 1;
      }
      if (current === "$" && source[cursor + 1] === "{") {
        const segment = findBalancedSegment({
          source,
          startIndex: cursor + 1,
          openChar: "{",
          closeChar: "}"
        });
        if (!segment) {
          return source.length;
        }
        cursor = segment.endIndex + 1;
        continue;
      }
      cursor += 1;
    }
    return source.length;
  }

  let cursor = startIndex + 1;
  while (cursor < source.length) {
    const current = source[cursor];
    if (current === quote && !isEscaped(source, cursor)) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
};

const skipLineComment = (source: string, startIndex: number): number => {
  let cursor = startIndex + 2;
  while (cursor < source.length && source[cursor] !== "\n") {
    cursor += 1;
  }
  return cursor;
};

const skipBlockComment = (source: string, startIndex: number): number => {
  const endIndex = source.indexOf("*/", startIndex + 2);
  return endIndex === -1 ? source.length : endIndex + 2;
};

const skipNonCodeToken = (source: string, cursor: number): number => {
  const current = source[cursor];
  if (current === "\"" || current === "'" || current === "`") {
    return skipStringLiteral(source, cursor);
  }
  if (current === "/" && source[cursor + 1] === "/") {
    return skipLineComment(source, cursor);
  }
  if (current === "/" && source[cursor + 1] === "*") {
    return skipBlockComment(source, cursor);
  }
  return cursor;
};

const trimOuterParentheses = (source: string): string => {
  let value = source.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    const segment = findBalancedSegment({
      source: value,
      startIndex: 0,
      openChar: "(",
      closeChar: ")"
    });
    if (!segment || segment.endIndex !== value.length - 1) {
      break;
    }
    value = value.slice(1, -1).trim();
  }
  return value;
};

const splitTopLevel = ({
  source,
  delimiter
}: {
  source: string;
  delimiter: "," | ";" | "=" | ":" | "=>";
}): { left: string; right: string } | undefined => {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped - 1;
      continue;
    }

    const current = source[cursor];
    if (current === "{") {
      braceDepth += 1;
      continue;
    }
    if (current === "}") {
      braceDepth -= 1;
      continue;
    }
    if (current === "[") {
      bracketDepth += 1;
      continue;
    }
    if (current === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (current === "(") {
      parenDepth += 1;
      continue;
    }
    if (current === ")") {
      parenDepth -= 1;
      continue;
    }

    if (braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) {
      continue;
    }

    if (delimiter === "=>" && current === "=" && source[cursor + 1] === ">") {
      return {
        left: source.slice(0, cursor),
        right: source.slice(cursor + 2)
      };
    }

    if (delimiter !== "=>" && current === delimiter) {
      return {
        left: source.slice(0, cursor),
        right: source.slice(cursor + 1)
      };
    }
  }

  return undefined;
};

const splitTopLevelSegments = ({
  source,
  delimiter
}: {
  source: string;
  delimiter: "," | ";";
}): string[] => {
  const segments: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let chunkStart = 0;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped - 1;
      continue;
    }

    const current = source[cursor];
    if (current === "{") {
      braceDepth += 1;
      continue;
    }
    if (current === "}") {
      braceDepth -= 1;
      continue;
    }
    if (current === "[") {
      bracketDepth += 1;
      continue;
    }
    if (current === "]") {
      bracketDepth -= 1;
      continue;
    }
    if (current === "(") {
      parenDepth += 1;
      continue;
    }
    if (current === ")") {
      parenDepth -= 1;
      continue;
    }

    if (current === delimiter && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      segments.push(source.slice(chunkStart, cursor).trim());
      chunkStart = cursor + 1;
    }
  }

  const trailing = source.slice(chunkStart).trim();
  if (trailing.length > 0) {
    segments.push(trailing);
  }

  return segments;
};

const findStatementEnd = (source: string, startIndex: number): number => {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let cursor = startIndex;

  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const current = source[cursor];
    if (current === "{") {
      braceDepth += 1;
    } else if (current === "}") {
      braceDepth -= 1;
    } else if (current === "[") {
      bracketDepth += 1;
    } else if (current === "]") {
      bracketDepth -= 1;
    } else if (current === "(") {
      parenDepth += 1;
    } else if (current === ")") {
      parenDepth -= 1;
    } else if (current === ";" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return cursor;
    }
    cursor += 1;
  }

  return source.length;
};

const decodeStringLiteral = (literal: string): string => {
  try {
    if (literal.startsWith("`")) {
      return literal.slice(1, -1);
    }
    return JSON.parse(literal) as string;
  } catch {
    return literal.slice(1, -1);
  }
};

const toBoundedStringValue = (value: string): JsStaticValue => {
  if (value.length > MAX_STRING_LITERAL_LENGTH) {
    return UNKNOWN_VALUE("string_too_large");
  }
  return { kind: "string", value };
};

const parseParams = (source: string): string[] => {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (IDENTIFIER_PATTERN.test(trimmed)) {
    return [trimmed];
  }
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return [];
  }
  return splitTopLevelSegments({
    source: trimmed.slice(1, -1),
    delimiter: ","
  })
    .map((segment) => segment.trim())
    .filter((segment) => IDENTIFIER_PATTERN.test(segment));
};

const lookupIdentifierValue = ({
  identifier,
  env,
  state
}: {
  identifier: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  const localValue = state.locals.get(identifier);
  if (localValue) {
    return localValue;
  }

  if (identifier === "undefined") {
    return { kind: "undefined" };
  }

  const initializer = env.initializers.get(identifier);
  if (!initializer) {
    return UNKNOWN_VALUE(`unresolved_identifier:${identifier}`);
  }

  if (state.evaluating.has(identifier)) {
    state.diagnostics.push({
      code: "JS_EVAL_CYCLE",
      message: `Static evaluation detected a cycle while resolving '${identifier}'.`
    });
    return UNKNOWN_VALUE(`cycle:${identifier}`);
  }

  state.evaluating.add(identifier);
  const value = evaluateJsExpression({
    source: initializer,
    env,
    state: {
      ...state,
      currentDepth: state.currentDepth + 1
    }
  });
  state.evaluating.delete(identifier);
  return value;
};

const toPrimitiveString = (value: JsStaticValue): string | undefined => {
  switch (value.kind) {
    case "string":
      return value.value;
    case "number":
      return String(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    default:
      return undefined;
  }
};

const resolveTemplateLiteral = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  let cursor = 1;
  let output = "";
  let chunkStart = 1;

  while (cursor < source.length - 1) {
    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      output += decodeStringLiteral(`\`${source.slice(chunkStart, cursor)}\``);
      const segment = findBalancedSegment({
        source,
        startIndex: cursor + 1,
        openChar: "{",
        closeChar: "}"
      });
      if (!segment) {
        return UNKNOWN_VALUE("template_unbalanced");
      }
      const expressionValue = evaluateJsExpression({
        source: segment.value.slice(1, -1),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
      const expressionString = toPrimitiveString(expressionValue);
      if (expressionString === undefined) {
        return UNKNOWN_VALUE("template_expression_unresolved");
      }
      output += expressionString;
      cursor = segment.endIndex + 1;
      chunkStart = cursor;
      continue;
    }
    cursor += 1;
  }

  output += decodeStringLiteral(`\`${source.slice(chunkStart, source.length - 1)}\``);
  return toBoundedStringValue(output);
};

const parseStringLikeValue = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  if (source.startsWith("`")) {
    return resolveTemplateLiteral({ source, env, state });
  }
  return toBoundedStringValue(decodeStringLiteral(source));
};

const parseObjectValue = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  if (!source.startsWith("{") || !source.endsWith("}")) {
    return UNKNOWN_VALUE("object_expected");
  }

  const properties = new Map<string, JsStaticValue>();
  const body = source.slice(1, -1);
  for (const segment of splitTopLevelSegments({ source: body, delimiter: "," })) {
    if (segment.length === 0) {
      continue;
    }
    if (segment.startsWith("...")) {
      const spreadValue = evaluateJsExpression({
        source: segment.slice(3),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
      if (spreadValue.kind === "object") {
        for (const [key, value] of spreadValue.properties.entries()) {
          properties.set(key, value);
        }
      } else {
        state.diagnostics.push({
          code: "JS_EVAL_OBJECT_SPREAD_UNRESOLVED",
          message: `Unable to statically evaluate object spread '${normalizeWhitespace(segment)}'.`
        });
      }
      continue;
    }

    const keyValuePair = splitTopLevel({
      source: segment,
      delimiter: ":"
    });
    if (!keyValuePair) {
      const shorthandName = segment.trim();
      if (!IDENTIFIER_PATTERN.test(shorthandName)) {
        state.diagnostics.push({
          code: "JS_EVAL_OBJECT_PROPERTY_UNSUPPORTED",
          message: `Unsupported object property '${normalizeWhitespace(segment)}'.`
        });
        continue;
      }
      properties.set(
        shorthandName,
        lookupIdentifierValue({
          identifier: shorthandName,
          env,
          state
        })
      );
      continue;
    }

    const rawKey = keyValuePair.left.trim();
    const rawValue = keyValuePair.right.trim();
    let resolvedKey: string | undefined;

    if (rawKey.startsWith("[") && rawKey.endsWith("]")) {
      const keyValue = evaluateJsExpression({
        source: rawKey.slice(1, -1),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
      resolvedKey = toPrimitiveString(keyValue);
    } else if (
      (rawKey.startsWith("\"") && rawKey.endsWith("\"")) ||
      (rawKey.startsWith("'") && rawKey.endsWith("'")) ||
      (rawKey.startsWith("`") && rawKey.endsWith("`"))
    ) {
      const keyLiteral = parseStringLikeValue({ source: rawKey, env, state });
      resolvedKey = toPrimitiveString(keyLiteral);
    } else if (IDENTIFIER_PATTERN.test(rawKey)) {
      resolvedKey = rawKey;
    }

    if (!resolvedKey) {
      state.diagnostics.push({
        code: "JS_EVAL_OBJECT_KEY_UNRESOLVED",
        message: `Unable to statically evaluate object key '${normalizeWhitespace(rawKey)}'.`
      });
      continue;
    }

    properties.set(
      resolvedKey,
      evaluateJsExpression({
        source: rawValue,
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      })
    );
  }

  return {
    kind: "object",
    properties
  };
};

const parseArrayValue = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  if (!source.startsWith("[") || !source.endsWith("]")) {
    return UNKNOWN_VALUE("array_expected");
  }

  const values: JsStaticValue[] = [];
  for (const segment of splitTopLevelSegments({
    source: source.slice(1, -1),
    delimiter: ","
  })) {
    if (segment.length === 0) {
      continue;
    }
    if (segment.startsWith("...")) {
      const spreadValue = evaluateJsExpression({
        source: segment.slice(3),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
      if (spreadValue.kind === "array") {
        values.push(...spreadValue.values);
      } else {
        state.diagnostics.push({
          code: "JS_EVAL_ARRAY_SPREAD_UNRESOLVED",
          message: `Unable to statically evaluate array spread '${normalizeWhitespace(segment)}'.`
        });
      }
      continue;
    }
    values.push(
      evaluateJsExpression({
        source: segment,
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      })
    );
  }
  return {
    kind: "array",
    values
  };
};

const parseNumberValue = (source: string): JsStaticValue | undefined => {
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(source)) {
    return undefined;
  }
  const parsed = Number(source);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return {
    kind: "number",
    value: parsed
  };
};

const resolvePropertyAccess = ({
  target,
  property
}: {
  target: JsStaticValue;
  property: string;
}): JsStaticValue => {
  if (target.kind === "object") {
    return target.properties.get(property) ?? UNKNOWN_VALUE(`missing_property:${property}`);
  }
  if (target.kind === "array" && /^\d+$/u.test(property)) {
    return target.values[Number(property)] ?? UNKNOWN_VALUE(`missing_index:${property}`);
  }
  return UNKNOWN_VALUE(`invalid_property_access:${property}`);
};

const parsePostfixExpression = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state: JsEvaluationState;
}): JsStaticValue => {
  let cursor = 0;

  const skipWhitespace = (): void => {
    while (cursor < source.length && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  };

  const parsePrimaryExpression = (): JsStaticValue => {
    skipWhitespace();
    const current = source[cursor];
    if (!current) {
      return UNKNOWN_VALUE("unexpected_end_of_expression");
    }
    if (current === "{") {
      const segment = findBalancedSegment({
        source,
        startIndex: cursor,
        openChar: "{",
        closeChar: "}"
      });
      if (!segment) {
        return UNKNOWN_VALUE("object_unbalanced");
      }
      cursor = segment.endIndex + 1;
      return parseObjectValue({ source: segment.value, env, state });
    }
    if (current === "[") {
      const segment = findBalancedSegment({
        source,
        startIndex: cursor,
        openChar: "[",
        closeChar: "]"
      });
      if (!segment) {
        return UNKNOWN_VALUE("array_unbalanced");
      }
      cursor = segment.endIndex + 1;
      return parseArrayValue({ source: segment.value, env, state });
    }
    if (current === "(") {
      const segment = findBalancedSegment({
        source,
        startIndex: cursor,
        openChar: "(",
        closeChar: ")"
      });
      if (!segment) {
        return UNKNOWN_VALUE("paren_unbalanced");
      }
      cursor = segment.endIndex + 1;
      return evaluateJsExpression({
        source: segment.value.slice(1, -1),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
    }
    if (current === "\"" || current === "'" || current === "`") {
      const endIndex = skipStringLiteral(source, cursor) - 1;
      const literal = source.slice(cursor, endIndex + 1);
      cursor = endIndex + 1;
      return parseStringLikeValue({ source: literal, env, state });
    }
    const remaining = source.slice(cursor);
    const numberMatch = remaining.match(/^-?(?:\d+(?:\.\d+)?|\.\d+)/u);
    if (numberMatch?.[0]) {
      cursor += numberMatch[0].length;
      return {
        kind: "number",
        value: Number(numberMatch[0])
      };
    }
    const identifierMatch = remaining.match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
    if (!identifierMatch?.[0]) {
      return UNKNOWN_VALUE(`unsupported_primary:${normalizeWhitespace(remaining.slice(0, 32))}`);
    }
    cursor += identifierMatch[0].length;
    const identifier = identifierMatch[0];
    if (identifier === "true" || identifier === "false") {
      return {
        kind: "boolean",
        value: identifier === "true"
      };
    }
    if (identifier === "null") {
      return {
        kind: "null"
      };
    }
    return lookupIdentifierValue({
      identifier,
      env,
      state
    });
  };

  let value = parsePrimaryExpression();

  while (cursor < source.length) {
    skipWhitespace();
    if (source.startsWith("?.", cursor)) {
      cursor += 2;
      if (value.kind === "null" || value.kind === "undefined") {
        return { kind: "undefined" };
      }
      if (source[cursor] === "[") {
        const segment = findBalancedSegment({
          source,
          startIndex: cursor,
          openChar: "[",
          closeChar: "]"
        });
        if (!segment) {
          return UNKNOWN_VALUE("optional_member_unbalanced");
        }
        cursor = segment.endIndex + 1;
        const keyValue = evaluateJsExpression({
          source: segment.value.slice(1, -1),
          env,
          state: {
            ...state,
            currentDepth: state.currentDepth + 1
          }
        });
        const property = toPrimitiveString(keyValue);
        if (property === undefined) {
          return UNKNOWN_VALUE("optional_member_key_unresolved");
        }
        value = resolvePropertyAccess({
          target: value,
          property
        });
        continue;
      }
      const identifierMatch = source.slice(cursor).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
      if (!identifierMatch?.[0]) {
        return UNKNOWN_VALUE("optional_member_identifier_unresolved");
      }
      cursor += identifierMatch[0].length;
      value = resolvePropertyAccess({
        target: value,
        property: identifierMatch[0]
      });
      continue;
    }
    if (source[cursor] === ".") {
      cursor += 1;
      const identifierMatch = source.slice(cursor).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
      if (!identifierMatch?.[0]) {
        return UNKNOWN_VALUE("member_identifier_unresolved");
      }
      cursor += identifierMatch[0].length;
      value = resolvePropertyAccess({
        target: value,
        property: identifierMatch[0]
      });
      continue;
    }
    if (source[cursor] === "[") {
      const segment = findBalancedSegment({
        source,
        startIndex: cursor,
        openChar: "[",
        closeChar: "]"
      });
      if (!segment) {
        return UNKNOWN_VALUE("member_bracket_unbalanced");
      }
      cursor = segment.endIndex + 1;
      const keyValue = evaluateJsExpression({
        source: segment.value.slice(1, -1),
        env,
        state: {
          ...state,
          currentDepth: state.currentDepth + 1
        }
      });
      const property = toPrimitiveString(keyValue);
      if (property === undefined) {
        return UNKNOWN_VALUE("member_key_unresolved");
      }
      value = resolvePropertyAccess({
        target: value,
        property
      });
      continue;
    }
    if (source[cursor] === "(") {
      const segment = findBalancedSegment({
        source,
        startIndex: cursor,
        openChar: "(",
        closeChar: ")"
      });
      if (!segment) {
        return UNKNOWN_VALUE("call_arguments_unbalanced");
      }
      cursor = segment.endIndex + 1;
      const argumentValues = splitTopLevelSegments({
        source: segment.value.slice(1, -1),
        delimiter: ","
      }).map((argument) =>
        evaluateJsExpression({
          source: argument,
          env,
          state: {
            ...state,
            currentDepth: state.currentDepth + 1
          }
        })
      );

      if (value.kind === "function") {
        const localValues = new Map<string, JsStaticValue>();
        for (let index = 0; index < value.params.length; index += 1) {
          localValues.set(value.params[index] ?? "", argumentValues[index] ?? { kind: "undefined" });
        }
        value = evaluateJsExpression({
          source: value.body,
          env: value.env,
          state: {
            ...state,
            locals: localValues,
            currentDepth: state.currentDepth + 1
          }
        });
        continue;
      }

      if (value.kind === "unknown" && argumentValues[0]?.kind === "function") {
        value = argumentValues[0];
        continue;
      }

      return UNKNOWN_VALUE("call_target_unresolved");
    }
    break;
  }

  skipWhitespace();
  if (cursor < source.length) {
    return UNKNOWN_VALUE(`unsupported_trailing_expression:${normalizeWhitespace(source.slice(cursor))}`);
  }
  return value;
};

export const evaluateJsExpression = ({
  source,
  env,
  state
}: {
  source: string;
  env: JsEvaluationEnvironment;
  state?: Partial<JsEvaluationState>;
}): JsStaticValue => {
  const expression = trimOuterParentheses(source);
  const evaluationState: JsEvaluationState = {
    diagnostics: state?.diagnostics ?? [],
    locals: state?.locals ?? new Map<string, JsStaticValue>(),
    maxDepth: state?.maxDepth ?? 24,
    currentDepth: state?.currentDepth ?? 0,
    evaluating: state?.evaluating ?? new Set<string>()
  };

  if (evaluationState.currentDepth > evaluationState.maxDepth) {
    evaluationState.diagnostics.push({
      code: "JS_EVAL_DEPTH_LIMIT",
      message: "Static evaluation exceeded the configured depth budget."
    });
    return UNKNOWN_VALUE("depth_limit");
  }

  const arrowParts = splitTopLevel({
    source: expression,
    delimiter: "=>"
  });
  if (arrowParts) {
    const params = parseParams(arrowParts.left);
    return {
      kind: "function",
      params,
      body: trimOuterParentheses(arrowParts.right.trim()),
      env
    };
  }

  if (expression.length === 0) {
    return UNKNOWN_VALUE("empty_expression");
  }

  if ((expression.startsWith("\"") && expression.endsWith("\"")) || (expression.startsWith("'") && expression.endsWith("'"))) {
    return parseStringLikeValue({ source: expression, env, state: evaluationState });
  }
  if (expression.startsWith("`") && expression.endsWith("`")) {
    return parseStringLikeValue({ source: expression, env, state: evaluationState });
  }
  if (expression.startsWith("{") && expression.endsWith("}")) {
    return parseObjectValue({ source: expression, env, state: evaluationState });
  }
  if (expression.startsWith("[") && expression.endsWith("]")) {
    return parseArrayValue({ source: expression, env, state: evaluationState });
  }

  const numericValue = parseNumberValue(expression);
  if (numericValue) {
    return numericValue;
  }

  return parsePostfixExpression({
    source: expression,
    env,
    state: evaluationState
  });
};

export const collectVariableInitializers = (source: string): Map<string, string> => {
  const initializers = new Map<string, string>();
  let cursor = 0;

  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    let keywordLength = 0;
    if (source.startsWith("const", cursor)) {
      keywordLength = 5;
    } else if (source.startsWith("let", cursor)) {
      keywordLength = 3;
    } else if (source.startsWith("var", cursor)) {
      keywordLength = 3;
    }

    if (
      keywordLength > 0 &&
      !isIdentifierChar(source[cursor - 1]) &&
      !isIdentifierChar(source[cursor + keywordLength])
    ) {
      const declarationStart = cursor + keywordLength;
      const declarationEnd = findStatementEnd(source, declarationStart);
      const declarationBody = source.slice(declarationStart, declarationEnd);
      for (const declarator of splitTopLevelSegments({
        source: declarationBody,
        delimiter: ","
      })) {
        const assignment = splitTopLevel({
          source: declarator,
          delimiter: "="
        });
        if (!assignment) {
          continue;
        }
        const identifier = assignment.left.trim();
        if (!IDENTIFIER_PATTERN.test(identifier)) {
          continue;
        }
        const initializer = assignment.right.trim();
        if (initializer.length === 0) {
          continue;
        }
        initializers.set(identifier, initializer);
      }
      cursor = declarationEnd + 1;
      continue;
    }

    cursor += 1;
  }

  return initializers;
};

export const createJsEvaluationEnvironment = (bundleText: string): JsEvaluationEnvironment => {
  return {
    initializers: collectVariableInitializers(bundleText)
  };
};

export const createEvaluationState = (): JsEvaluationState => {
  return {
    diagnostics: [],
    locals: new Map<string, JsStaticValue>(),
    maxDepth: 24,
    currentDepth: 0,
    evaluating: new Set<string>()
  };
};

export const isJsStaticObjectValue = (value: JsStaticValue): value is Extract<JsStaticValue, { kind: "object" }> => {
  return value.kind === "object";
};

export const isJsStaticArrayValue = (value: JsStaticValue): value is Extract<JsStaticValue, { kind: "array" }> => {
  return value.kind === "array";
};

export const isJsStaticStringValue = (value: JsStaticValue): value is Extract<JsStaticValue, { kind: "string" }> => {
  return value.kind === "string";
};

export const isJsStaticNumberValue = (value: JsStaticValue): value is Extract<JsStaticValue, { kind: "number" }> => {
  return value.kind === "number";
};

export const isJsStaticBooleanValue = (value: JsStaticValue): value is Extract<JsStaticValue, { kind: "boolean" }> => {
  return value.kind === "boolean";
};
