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
  normalizedBody: string;
}

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
    const normalizedBody = body.trim();
    if (normalizedBody.length > 0) {
      occurrences.push({
        startIndex,
        endIndexExclusive,
        body,
        normalizedBody
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
      normalizedBody: string;
    }
  >();
  for (const occurrence of occurrences) {
    const existing = patternStats.get(occurrence.normalizedBody);
    if (!existing) {
      patternStats.set(occurrence.normalizedBody, {
        count: 1,
        firstStartIndex: occurrence.startIndex,
        normalizedBody: occurrence.normalizedBody
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
  const constantNameByBody = new Map<string, string>();
  const constantDefinitions: Array<{ name: string; normalizedBody: string }> = [];
  for (const pattern of selectedPatterns) {
    const { name, nextPreferredNumber } = allocateSharedSxConstantName({
      preferredNumber,
      reservedNames,
      knownIdentifiers
    });
    preferredNumber = nextPreferredNumber;
    constantNameByBody.set(pattern.normalizedBody, name);
    constantDefinitions.push({
      name,
      normalizedBody: pattern.normalizedBody
    });
  }

  let rewrittenContent = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    rewrittenContent += source.slice(cursor, occurrence.startIndex);
    const constantName = constantNameByBody.get(occurrence.normalizedBody);
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
    .map((definition) => `const ${definition.name} = { ${definition.normalizedBody} };`)
    .join("\n");
  const beforeExport = rewrittenContent.slice(0, exportIndex).trimEnd();
  const fromExport = rewrittenContent.slice(exportIndex);

  return `${beforeExport}\n\n${constantsBlock}\n\n${fromExport}`;
};
