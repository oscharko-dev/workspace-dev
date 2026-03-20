// ---------------------------------------------------------------------------
// generator-sx.ts — sx prop computation and shared constant extraction
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------

export const SHARED_SX_MIN_OCCURRENCES = 3;
export const SHARED_SX_IDENTIFIER_PREFIX = "sharedSxStyle";
export const SX_ATTRIBUTE_PREFIX = "sx={{";

interface SxAttributeOccurrence {
  startIndex: number;
  endIndexExclusive: number;
  body: string;
  dedupeSignature: string;
  definitionBody: string;
}

interface ParsedSxProperty {
  key: string;
  value: ParsedSxValue;
}

interface ParsedSxObject {
  properties: ParsedSxProperty[];
}

interface ParsedSxExpressionValue {
  kind: "expression";
  raw: string;
}

interface ParsedSxObjectValue {
  kind: "object";
  object: ParsedSxObject;
}

type ParsedSxValue = ParsedSxExpressionValue | ParsedSxObjectValue;

interface CanonicalSxExpressionValue {
  kind: "expression";
  normalizedExpression: string;
}

interface CanonicalSxObjectValue {
  kind: "object";
  properties: Array<{
    key: string;
    value: CanonicalSxValue;
  }>;
}

type CanonicalSxValue = CanonicalSxExpressionValue | CanonicalSxObjectValue;

interface SxBodyNormalizationResult {
  dedupeSignature: string;
  definitionBody: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const skipWhitespace = (source: string, startIndex: number): number => {
  let index = startIndex;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  return index;
};

const parseQuotedStringLiteral = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): {
  value: string;
  nextIndex: number;
} | undefined => {
  const quote = source[startIndex];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let value = "";
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) {
      continue;
    }
    if (char === "\\") {
      const escapedChar = source[index + 1];
      if (escapedChar === undefined) {
        return undefined;
      }
      switch (escapedChar) {
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "b":
          value += "\b";
          break;
        case "f":
          value += "\f";
          break;
        case "v":
          value += "\v";
          break;
        case "\\":
        case "'":
        case '"':
          value += escapedChar;
          break;
        default:
          value += escapedChar;
          break;
      }
      index += 1;
      continue;
    }
    if (char === quote) {
      return {
        value,
        nextIndex: index + 1
      };
    }
    value += char;
  }

  return undefined;
};

const parsePropertyKey = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): {
  key: string;
  nextIndex: number;
} | undefined => {
  const index = skipWhitespace(source, startIndex);
  const char = source[index];
  if (char === undefined) {
    return undefined;
  }

  if (char === '"' || char === "'") {
    const parsedString = parseQuotedStringLiteral({
      source,
      startIndex: index
    });
    if (!parsedString) {
      return undefined;
    }
    return {
      key: parsedString.value,
      nextIndex: parsedString.nextIndex
    };
  }

  if (char === "[" || source.startsWith("...", index)) {
    return undefined;
  }

  if (/[A-Za-z_$]/.test(char) || /[0-9]/.test(char)) {
    let cursor = index + 1;
    while (cursor < source.length) {
      const current = source[cursor];
      if (!current || !/[A-Za-z0-9_$]/.test(current)) {
        break;
      }
      cursor += 1;
    }
    return {
      key: source.slice(index, cursor),
      nextIndex: cursor
    };
  }

  return undefined;
};

const findExpressionEndIndex = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): number | undefined => {
  let depthParenthesis = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let activeQuote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) {
      continue;
    }

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      activeQuote = char;
      continue;
    }

    if (char === "(") {
      depthParenthesis += 1;
      continue;
    }

    if (char === ")") {
      if (depthParenthesis === 0) {
        return undefined;
      }
      depthParenthesis -= 1;
      continue;
    }

    if (char === "[") {
      depthBracket += 1;
      continue;
    }

    if (char === "]") {
      if (depthBracket === 0) {
        return undefined;
      }
      depthBracket -= 1;
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      continue;
    }

    if (char === "}") {
      if (depthBrace === 0 && depthParenthesis === 0 && depthBracket === 0) {
        return index;
      }
      if (depthBrace === 0) {
        return undefined;
      }
      depthBrace -= 1;
      continue;
    }

    if (char === "," && depthParenthesis === 0 && depthBracket === 0 && depthBrace === 0) {
      return index;
    }
  }

  if (depthParenthesis !== 0 || depthBracket !== 0 || depthBrace !== 0 || activeQuote) {
    return undefined;
  }

  return source.length;
};

const parseSxValue = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): {
  value: ParsedSxValue;
  nextIndex: number;
} | undefined => {
  const index = skipWhitespace(source, startIndex);
  const char = source[index];
  if (char === undefined) {
    return undefined;
  }

  if (char === "{") {
    const parsedNestedObject = parseSxObjectLiteral({
      source,
      startIndex: index + 1,
      expectClosingBrace: true
    });
    if (!parsedNestedObject) {
      return undefined;
    }
    return {
      value: {
        kind: "object",
        object: parsedNestedObject.object
      },
      nextIndex: parsedNestedObject.nextIndex
    };
  }

  const expressionEndIndex = findExpressionEndIndex({
    source,
    startIndex: index
  });
  if (expressionEndIndex === undefined) {
    return undefined;
  }

  const rawExpression = source.slice(index, expressionEndIndex).trim();
  if (rawExpression.length === 0) {
    return undefined;
  }

  return {
    value: {
      kind: "expression",
      raw: rawExpression
    },
    nextIndex: expressionEndIndex
  };
};

const parseSxObjectLiteral = ({
  source,
  startIndex,
  expectClosingBrace
}: {
  source: string;
  startIndex: number;
  expectClosingBrace: boolean;
}): {
  object: ParsedSxObject;
  nextIndex: number;
} | undefined => {
  const properties: ParsedSxProperty[] = [];
  let index = skipWhitespace(source, startIndex);

  for (;;) {
    index = skipWhitespace(source, index);

    if (expectClosingBrace && source[index] === "}") {
      return {
        object: { properties },
        nextIndex: index + 1
      };
    }

    if (!expectClosingBrace && index >= source.length) {
      return {
        object: { properties },
        nextIndex: index
      };
    }

    if (index >= source.length) {
      return undefined;
    }

    const parsedKey = parsePropertyKey({
      source,
      startIndex: index
    });
    if (!parsedKey) {
      return undefined;
    }

    index = skipWhitespace(source, parsedKey.nextIndex);
    if (source[index] !== ":") {
      return undefined;
    }
    index += 1;

    const parsedValue = parseSxValue({
      source,
      startIndex: index
    });
    if (!parsedValue) {
      return undefined;
    }

    properties.push({
      key: parsedKey.key,
      value: parsedValue.value
    });
    index = skipWhitespace(source, parsedValue.nextIndex);

    if (index >= source.length) {
      if (expectClosingBrace) {
        return undefined;
      }
      return {
        object: { properties },
        nextIndex: index
      };
    }

    const delimiter = source[index];
    if (delimiter === ",") {
      index += 1;
      index = skipWhitespace(source, index);
      if (!expectClosingBrace && index >= source.length) {
        return {
          object: { properties },
          nextIndex: index
        };
      }
      if (expectClosingBrace && source[index] === "}") {
        return {
          object: { properties },
          nextIndex: index + 1
        };
      }
      continue;
    }

    if (expectClosingBrace && delimiter === "}") {
      return {
        object: { properties },
        nextIndex: index + 1
      };
    }

    if (!expectClosingBrace) {
      return undefined;
    }
  }
};

const parseSxObjectBody = (body: string): ParsedSxObject | undefined => {
  const parsed = parseSxObjectLiteral({
    source: body,
    startIndex: 0,
    expectClosingBrace: false
  });
  if (!parsed) {
    return undefined;
  }

  const terminalIndex = skipWhitespace(body, parsed.nextIndex);
  if (terminalIndex !== body.length) {
    return undefined;
  }

  return parsed.object;
};

export const countTopLevelSxProperties = (body: string): number | undefined => {
  const parsedBody = parseSxObjectBody(body.trim());
  if (!parsedBody) {
    return undefined;
  }
  return parsedBody.properties.length;
};

const normalizeExpressionForSignature = (expression: string): string => {
  let normalized = "";
  let pendingWhitespace = false;
  let activeQuote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (const char of expression.trim()) {
    if (activeQuote) {
      normalized += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      if (pendingWhitespace && normalized.length > 0) {
        const previousChar = normalized[normalized.length - 1] ?? "";
        if (/[A-Za-z0-9_$)}\]]/.test(previousChar)) {
          normalized += " ";
        }
      }
      pendingWhitespace = false;
      activeQuote = char;
      normalized += char;
      continue;
    }

    if (/\s/.test(char)) {
      pendingWhitespace = true;
      continue;
    }

    if (pendingWhitespace && normalized.length > 0) {
      const previousChar = normalized[normalized.length - 1] ?? "";
      if (/[A-Za-z0-9_$)}\]]/.test(previousChar) && /[A-Za-z0-9_$({\[]/.test(char)) {
        normalized += " ";
      }
    }

    pendingWhitespace = false;
    normalized += char;
  }

  return normalized;
};

const toCanonicalSxValue = (value: ParsedSxValue): CanonicalSxValue => {
  if (value.kind === "expression") {
    return {
      kind: "expression",
      normalizedExpression: normalizeExpressionForSignature(value.raw)
    };
  }

  const canonicalValueByKey = new Map<string, CanonicalSxValue>();
  for (const property of value.object.properties) {
    canonicalValueByKey.set(property.key, toCanonicalSxValue(property.value));
  }

  const canonicalProperties = Array.from(canonicalValueByKey.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, canonicalValue]) => ({
      key,
      value: canonicalValue
    }));

  return {
    kind: "object",
    properties: canonicalProperties
  };
};

const serializeCanonicalSxValue = (value: CanonicalSxValue): string => {
  if (value.kind === "expression") {
    return `expr(${value.normalizedExpression})`;
  }

  return `obj({${value.properties
    .map((property) => `${JSON.stringify(property.key)}:${serializeCanonicalSxValue(property.value)}`)
    .join(",")}})`;
};

const toPropertyKeyLiteral = (key: string): string => {
  if (IDENTIFIER_PATTERN.test(key)) {
    return key;
  }
  return JSON.stringify(key);
};

const serializeParsedSxValue = (value: ParsedSxValue): string => {
  if (value.kind === "expression") {
    return value.raw.trim();
  }

  return `{ ${serializeParsedSxObject(value.object)} }`;
};

const serializeParsedSxObject = (object: ParsedSxObject): string => {
  return object.properties.map((property) => `${toPropertyKeyLiteral(property.key)}: ${serializeParsedSxValue(property.value)}`).join(", ");
};

const normalizeSxBodyForExtraction = (body: string): SxBodyNormalizationResult => {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return {
      dedupeSignature: "raw:",
      definitionBody: ""
    };
  }

  const parsedBody = parseSxObjectBody(trimmedBody);
  if (!parsedBody) {
    // Keep legacy behavior when AST parsing fails.
    return {
      dedupeSignature: `raw:${trimmedBody}`,
      definitionBody: trimmedBody
    };
  }

  const canonicalRoot = toCanonicalSxValue({
    kind: "object",
    object: parsedBody
  });

  return {
    dedupeSignature: `ast:${serializeCanonicalSxValue(canonicalRoot)}`,
    definitionBody: serializeParsedSxObject(parsedBody)
  };
};

export const findSxBodyEndIndex = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): number | undefined => {
  let depth = 1;
  let activeQuote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) {
      continue;
    }

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      activeQuote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
};

const collectSxAttributeOccurrences = (source: string): SxAttributeOccurrence[] => {
  const occurrences: SxAttributeOccurrence[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const startIndex = source.indexOf(SX_ATTRIBUTE_PREFIX, searchFrom);
    if (startIndex < 0) {
      break;
    }

    const bodyStartIndex = startIndex + SX_ATTRIBUTE_PREFIX.length;
    const bodyEndIndex = findSxBodyEndIndex({
      source,
      startIndex: bodyStartIndex
    });
    if (bodyEndIndex === undefined) {
      searchFrom = bodyStartIndex;
      continue;
    }

    let expressionEndIndex = bodyEndIndex + 1;
    while (expressionEndIndex < source.length && /\s/.test(source[expressionEndIndex] ?? "")) {
      expressionEndIndex += 1;
    }
    if (source[expressionEndIndex] !== "}") {
      searchFrom = bodyStartIndex;
      continue;
    }

    const endIndexExclusive = expressionEndIndex + 1;
    const body = source.slice(bodyStartIndex, bodyEndIndex);
    const normalization = normalizeSxBodyForExtraction(body);

    if (normalization.definitionBody.length > 0) {
      occurrences.push({
        startIndex,
        endIndexExclusive,
        body,
        dedupeSignature: normalization.dedupeSignature,
        definitionBody: normalization.definitionBody
      });
    }

    searchFrom = endIndexExclusive;
  }

  return occurrences;
};

const collectIdentifiersFromSource = (source: string): Set<string> => {
  const identifiers = new Set<string>();
  for (const match of source.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    const identifier = match[0];
    if (identifier) {
      identifiers.add(identifier);
    }
  }
  return identifiers;
};

const allocateSharedSxConstantName = ({
  preferredNumber,
  reservedNames,
  knownIdentifiers
}: {
  preferredNumber: number;
  reservedNames: Set<string>;
  knownIdentifiers: Set<string>;
}): {
  name: string;
  nextPreferredNumber: number;
} => {
  let suffix = preferredNumber;
  for (;;) {
    const candidate = `${SHARED_SX_IDENTIFIER_PREFIX}${suffix}`;
    if (!reservedNames.has(candidate) && !knownIdentifiers.has(candidate)) {
      reservedNames.add(candidate);
      return {
        name: candidate,
        nextPreferredNumber: suffix + 1
      };
    }
    suffix += 1;
  }
};

export const extractSharedSxConstantsFromScreenContent = (source: string): string => {
  const occurrences = collectSxAttributeOccurrences(source);
  if (occurrences.length < SHARED_SX_MIN_OCCURRENCES) {
    return source;
  }

  const patternStats = new Map<
    string,
    {
      count: number;
      firstStartIndex: number;
      dedupeSignature: string;
      definitionBody: string;
    }
  >();
  for (const occurrence of occurrences) {
    const existing = patternStats.get(occurrence.dedupeSignature);
    if (!existing) {
      patternStats.set(occurrence.dedupeSignature, {
        count: 1,
        firstStartIndex: occurrence.startIndex,
        dedupeSignature: occurrence.dedupeSignature,
        definitionBody: occurrence.definitionBody
      });
      continue;
    }
    existing.count += 1;
  }

  const selectedPatterns = Array.from(patternStats.values())
    .filter((pattern) => pattern.count >= SHARED_SX_MIN_OCCURRENCES)
    .sort((left, right) => left.firstStartIndex - right.firstStartIndex);

  if (selectedPatterns.length === 0) {
    return source;
  }

  const knownIdentifiers = collectIdentifiersFromSource(source);
  const reservedNames = new Set<string>();
  let preferredNumber = 1;
  const constantNameBySignature = new Map<string, string>();
  const constantDefinitions: Array<{ name: string; definitionBody: string }> = [];
  for (const pattern of selectedPatterns) {
    const { name, nextPreferredNumber } = allocateSharedSxConstantName({
      preferredNumber,
      reservedNames,
      knownIdentifiers
    });
    preferredNumber = nextPreferredNumber;
    constantNameBySignature.set(pattern.dedupeSignature, name);
    constantDefinitions.push({
      name,
      definitionBody: pattern.definitionBody
    });
  }

  let rewrittenContent = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    rewrittenContent += source.slice(cursor, occurrence.startIndex);
    const constantName = constantNameBySignature.get(occurrence.dedupeSignature);
    if (constantName) {
      rewrittenContent += `sx={${constantName}}`;
    } else {
      rewrittenContent += source.slice(occurrence.startIndex, occurrence.endIndexExclusive);
    }
    cursor = occurrence.endIndexExclusive;
  }
  rewrittenContent += source.slice(cursor);

  const exportIndex = rewrittenContent.indexOf("export default function ");
  if (exportIndex < 0) {
    return rewrittenContent;
  }

  const constantsBlock = constantDefinitions
    .map((definition) => `const ${definition.name} = { ${definition.definitionBody} };`)
    .join("\n");
  const beforeExport = rewrittenContent.slice(0, exportIndex).trimEnd();
  const fromExport = rewrittenContent.slice(exportIndex);

  return `${beforeExport}\n\n${constantsBlock}\n\n${fromExport}`;
};
