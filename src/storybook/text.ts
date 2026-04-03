export interface BalancedSegment {
  value: string;
  endIndex: number;
}

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

export const normalizePosixPath = (input: string): string => {
  return input.replace(/\\/gu, "/").replace(/^\.\//u, "");
};

export const normalizeStorybookComponentPath = (input: string): string => {
  return normalizePosixPath(input).trim();
};

export const normalizeStorybookDocsRoutePath = (input: string): string => {
  const [pathWithoutQuery] = input.split(/[?#]/u, 1);
  const normalizedPath = normalizePosixPath(pathWithoutQuery ?? input).trim();
  if (normalizedPath.startsWith("/docs/")) {
    return normalizedPath;
  }
  if (normalizedPath.startsWith("docs/")) {
    return `/${normalizedPath}`;
  }
  return normalizedPath;
};

export const normalizeWhitespace = (input: string): string => {
  return input.replace(/\s+/gu, " ").trim();
};

export const findBalancedSegment = ({
  source,
  startIndex,
  openChar,
  closeChar
}: {
  source: string;
  startIndex: number;
  openChar: string;
  closeChar: string;
}): BalancedSegment | undefined => {
  if (source[startIndex] !== openChar) {
    return undefined;
  }

  let depth = 0;
  let cursor = startIndex;
  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const current = source[cursor];
    if (current === openChar) {
      depth += 1;
    } else if (current === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          value: source.slice(startIndex, cursor + 1),
          endIndex: cursor
        };
      }
    }
    cursor += 1;
  }

  return undefined;
};

const skipWhitespace = (source: string, startIndex: number): number => {
  let cursor = startIndex;
  while (cursor < source.length && /\s/u.test(source.charAt(cursor))) {
    cursor += 1;
  }
  return cursor;
};

export const findObjectLiteralValuesByFieldName = ({
  source,
  fieldName
}: {
  source: string;
  fieldName: string;
}): string[] => {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (
      source.startsWith(fieldName, cursor) &&
      !isIdentifierChar(source[cursor - 1]) &&
      !isIdentifierChar(source[cursor + fieldName.length])
    ) {
      let nextCursor = skipWhitespace(source, cursor + fieldName.length);
      if (source[nextCursor] !== ":") {
        cursor += 1;
        continue;
      }
      nextCursor = skipWhitespace(source, nextCursor + 1);
      if (source[nextCursor] !== "{") {
        cursor += 1;
        continue;
      }

      const segment = findBalancedSegment({
        source,
        startIndex: nextCursor,
        openChar: "{",
        closeChar: "}"
      });
      if (segment) {
        values.push(segment.value);
        cursor = nextCursor + 1;
        continue;
      }
    }

    cursor += 1;
  }

  return values;
};

export const findArrayLiteralValuesByFieldName = ({
  source,
  fieldName
}: {
  source: string;
  fieldName: string;
}): string[] => {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (
      source.startsWith(fieldName, cursor) &&
      !isIdentifierChar(source[cursor - 1]) &&
      !isIdentifierChar(source[cursor + fieldName.length])
    ) {
      let nextCursor = skipWhitespace(source, cursor + fieldName.length);
      if (source[nextCursor] !== ":") {
        cursor += 1;
        continue;
      }
      nextCursor = skipWhitespace(source, nextCursor + 1);
      if (source[nextCursor] !== "[") {
        cursor += 1;
        continue;
      }

      const segment = findBalancedSegment({
        source,
        startIndex: nextCursor,
        openChar: "[",
        closeChar: "]"
      });
      if (segment) {
        values.push(segment.value);
        cursor = nextCursor + 1;
        continue;
      }
    }

    cursor += 1;
  }

  return values;
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

const readStringLiteral = (source: string, startIndex: number): BalancedSegment | undefined => {
  const quote = source[startIndex];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return undefined;
  }

  const endIndex = skipStringLiteral(source, startIndex) - 1;
  if (endIndex < startIndex) {
    return undefined;
  }

  return {
    value: decodeStringLiteral(source.slice(startIndex, endIndex + 1)),
    endIndex
  };
};

export const findStringLiteralValuesByFieldName = ({
  source,
  fieldName
}: {
  source: string;
  fieldName: string;
}): string[] => {
  const values: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const skipped = skipNonCodeToken(source, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    if (
      source.startsWith(fieldName, cursor) &&
      !isIdentifierChar(source[cursor - 1]) &&
      !isIdentifierChar(source[cursor + fieldName.length])
    ) {
      let nextCursor = skipWhitespace(source, cursor + fieldName.length);
      if (source[nextCursor] !== ":") {
        cursor += 1;
        continue;
      }
      nextCursor = skipWhitespace(source, nextCursor + 1);
      const literal = readStringLiteral(source, nextCursor);
      if (literal) {
        values.push(literal.value);
        cursor = literal.endIndex + 1;
        continue;
      }
    }

    cursor += 1;
  }

  return values;
};

export const collectStringLiteralsWithinRange = ({
  source,
  startIndex,
  endIndex
}: {
  source: string;
  startIndex: number;
  endIndex: number;
}): string[] => {
  const values: string[] = [];
  let cursor = startIndex;
  while (cursor <= endIndex && cursor < source.length) {
    if (source[cursor] === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(source, cursor);
      continue;
    }

    const literal = readStringLiteral(source, cursor);
    if (literal) {
      values.push(literal.value);
      cursor = literal.endIndex + 1;
      continue;
    }

    cursor += 1;
  }
  return values;
};

export const extractTopLevelArrayStringLiterals = (arrayLiteral: string): string[] => {
  if (!arrayLiteral.startsWith("[") || !arrayLiteral.endsWith("]")) {
    return [];
  }

  const values: string[] = [];
  let cursor = 1;
  let chunkStart = 1;
  let bracketDepth = 1;
  let braceDepth = 0;
  let parenDepth = 0;

  while (cursor < arrayLiteral.length - 1) {
    const skipped = skipNonCodeToken(arrayLiteral, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const current = arrayLiteral[cursor];
    if (current === "[") {
      bracketDepth += 1;
    } else if (current === "]") {
      bracketDepth -= 1;
    } else if (current === "{") {
      braceDepth += 1;
    } else if (current === "}") {
      braceDepth -= 1;
    } else if (current === "(") {
      parenDepth += 1;
    } else if (current === ")") {
      parenDepth -= 1;
    } else if (current === "," && bracketDepth === 1 && braceDepth === 0 && parenDepth === 0) {
      const item = arrayLiteral.slice(chunkStart, cursor).trim();
      const literal = readStringLiteral(item, 0);
      if (literal && literal.endIndex === item.length - 1) {
        values.push(literal.value);
      }
      chunkStart = cursor + 1;
    }
    cursor += 1;
  }

  const trailing = arrayLiteral.slice(chunkStart, arrayLiteral.length - 1).trim();
  if (trailing.length > 0) {
    const literal = readStringLiteral(trailing, 0);
    if (literal && literal.endIndex === trailing.length - 1) {
      values.push(literal.value);
    }
  }

  return values;
};

export const extractTopLevelObjectKeys = (objectLiteral: string): string[] => {
  if (!objectLiteral.startsWith("{") || !objectLiteral.endsWith("}")) {
    return [];
  }

  const properties: string[] = [];
  let cursor = 1;
  let chunkStart = 1;
  let braceDepth = 1;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < objectLiteral.length - 1) {
    const skipped = skipNonCodeToken(objectLiteral, cursor);
    if (skipped !== cursor) {
      cursor = skipped;
      continue;
    }

    const current = objectLiteral[cursor];
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
    } else if (current === "," && braceDepth === 1 && bracketDepth === 0 && parenDepth === 0) {
      properties.push(objectLiteral.slice(chunkStart, cursor).trim());
      chunkStart = cursor + 1;
    }
    cursor += 1;
  }

  const trailing = objectLiteral.slice(chunkStart, objectLiteral.length - 1).trim();
  if (trailing.length > 0) {
    properties.push(trailing);
  }

  const keys = new Set<string>();
  for (const property of properties) {
    if (property.length === 0 || property.startsWith("...") || property.startsWith("[")) {
      continue;
    }

    const identifierMatch = property.match(/^([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/u);
    const identifierKey = identifierMatch?.[1];
    if (identifierKey) {
      keys.add(identifierKey);
      continue;
    }

    const stringMatch = property.match(/^(["'])(.+?)\1\s*:/u);
    const stringKey = stringMatch?.[2];
    if (stringKey) {
      keys.add(stringKey);
    }
  }

  return [...keys].sort((left, right) => left.localeCompare(right));
};

export const stripStringsAndComments = (source: string): string => {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const current = source[cursor];
    if (current === "/" && source[cursor + 1] === "/") {
      const endIndex = skipLineComment(source, cursor);
      output += " ".repeat(endIndex - cursor);
      cursor = endIndex;
      continue;
    }
    if (current === "/" && source[cursor + 1] === "*") {
      const endIndex = skipBlockComment(source, cursor);
      output += " ".repeat(endIndex - cursor);
      cursor = endIndex;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      const endIndex = skipStringLiteral(source, cursor);
      output += " ".repeat(endIndex - cursor);
      cursor = endIndex;
      continue;
    }

    output += current ?? "";
    cursor += 1;
  }

  return output;
};

export const uniqueSorted = (values: Iterable<string>): string[] => {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
};
