export type StorybookAssetKind = "icon" | "illustration";

export interface IconVariantPropertyLike {
  property: string;
  values: string[];
}

const COMPARABLE_DIACRITIC_PATTERN = /[\u0300-\u036f]/gu;
const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/gu;
const CAMEL_CASE_ACRONYM_PATTERN = /([A-Z])([A-Z][a-z])/gu;
const GENERIC_NAMESPACE_TOKEN_SET = new Set([
  "asset",
  "assets",
  "component",
  "components",
  "icon",
  "icons",
  "ic",
  "illustration",
  "illustrations"
]);
const STYLE_SUFFIX_TOKEN_SET = new Set([
  "default",
  "filled",
  "outline",
  "outlined",
  "regular",
  "round",
  "rounded",
  "sharp",
  "solid",
  "two",
  "tone",
  "twotone",
  "variant"
]);
const PREFERRED_VARIANT_PROPERTY_SET = new Set([
  "asset",
  "assetname",
  "glyph",
  "icon",
  "iconkey",
  "iconname",
  "illustration",
  "name",
  "symbol",
  "variant"
]);
const SEMANTIC_TEXT_ALIASES = new Map<string, string>([
  ["e mail", "mail"],
  ["email", "mail"]
]);
const SEMANTIC_TOKEN_ALIASES = new Map<string, string>([["email", "mail"]]);

const normalizeComparableText = (value: string | undefined): string => {
  return (value ?? "")
    .normalize("NFKD")
    .replace(COMPARABLE_DIACRITIC_PATTERN, "")
    .replace(CAMEL_CASE_BOUNDARY_PATTERN, "$1 $2")
    .replace(CAMEL_CASE_ACRONYM_PATTERN, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .replace(/[^a-zA-Z0-9./:\s]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
};

const normalizeVariantPropertyName = (value: string): string => {
  return normalizeComparableText(value).replace(/[./:\s]+/gu, "");
};

const toNormalizedTokens = ({
  value,
  stripStyleSuffixes
}: {
  value: string;
  stripStyleSuffixes: boolean;
}): string[] => {
  const comparable = SEMANTIC_TEXT_ALIASES.get(normalizeComparableText(value)) ?? normalizeComparableText(value);
  const tokens = comparable
    .split(/[\s./:]+/gu)
    .map((token) => SEMANTIC_TOKEN_ALIASES.get(token) ?? token)
    .filter((token) => token.length > 0);

  while (tokens[0] && GENERIC_NAMESPACE_TOKEN_SET.has(tokens[0])) {
    tokens.shift();
  }
  if (stripStyleSuffixes) {
    while (tokens.at(-1) && STYLE_SUFFIX_TOKEN_SET.has(tokens.at(-1)!)) {
      tokens.pop();
    }
  }
  return tokens;
};

const toNamespaceSegments = (value: string): string[] => {
  const rawSegments = value
    .split(/[/:>]+/gu)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (rawSegments.length <= 1) {
    return [];
  }
  return rawSegments
    .slice(0, -1)
    .map((segment) => toNormalizedTokens({ value: segment, stripStyleSuffixes: false }).join("_"))
    .filter((segment) => segment.length > 0);
};

export const normalizeIconKey = ({ value }: { value: string | undefined }): string | undefined => {
  const rawValue = value?.trim();
  if (!rawValue) {
    return undefined;
  }

  const namespaceSegments = toNamespaceSegments(rawValue);
  const rawSegments = rawValue
    .split(/[/:>]+/gu)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const baseSource = rawSegments.at(-1) ?? rawValue;
  const baseTokens = toNormalizedTokens({
    value: baseSource,
    stripStyleSuffixes: true
  });
  const baseKey = baseTokens.join("_");
  if (!baseKey) {
    return undefined;
  }
  return namespaceSegments.length > 0 ? `${namespaceSegments.join(".")}.${baseKey}` : baseKey;
};

export const collectNormalizedIconKeys = ({
  candidates,
  variantProperties = []
}: {
  candidates: Array<string | undefined>;
  variantProperties?: readonly IconVariantPropertyLike[];
}): string[] => {
  const prioritizedCandidates = [
    ...variantProperties
      .filter((property) => PREFERRED_VARIANT_PROPERTY_SET.has(normalizeVariantPropertyName(property.property)))
      .flatMap((property) => [...property.values].sort((left, right) => left.localeCompare(right))),
    ...candidates
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const candidate of prioritizedCandidates) {
    const normalizedKey = normalizeIconKey({ value: candidate });
    if (!normalizedKey || seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    keys.push(normalizedKey);
  }
  return keys;
};

const hasComparableToken = ({
  values,
  tokens
}: {
  values: string[];
  tokens: string[];
}): boolean => {
  const normalizedValues = values.map((value) => normalizeComparableText(value));
  return normalizedValues.some((value) => tokens.some((token) => value.includes(token)));
};

const collectPreferredStringCandidates = ({
  value,
  keyPath,
  target
}: {
  value: unknown;
  keyPath: string[];
  target: string[];
}): void => {
  if (typeof value === "string") {
    const normalizedKeyPath = keyPath.map((key) => normalizeVariantPropertyName(key));
    if (normalizedKeyPath.some((key) => PREFERRED_VARIANT_PROPERTY_SET.has(key))) {
      target.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPreferredStringCandidates({
        value: entry,
        keyPath,
        target
      });
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, entryValue] of Object.entries(value)) {
    collectPreferredStringCandidates({
      value: entryValue,
      keyPath: [...keyPath, key],
      target
    });
  }
};

export const collectStorybookAssetMetadata = ({
  title,
  name,
  tags = [],
  componentPath,
  args,
  argTypes
}: {
  title: string;
  name: string;
  tags?: string[];
  componentPath?: string;
  args?: unknown;
  argTypes?: unknown;
}): {
  assetKind?: StorybookAssetKind;
  assetKeys: string[];
} => {
  const detectionSignals = [title, name, componentPath ?? "", ...tags];
  const preferredCandidates: string[] = [];
  collectPreferredStringCandidates({
    value: args,
    keyPath: [],
    target: preferredCandidates
  });
  collectPreferredStringCandidates({
    value: argTypes,
    keyPath: [],
    target: preferredCandidates
  });
  const assetKind = hasComparableToken({
    values: detectionSignals,
    tokens: ["illustration", "illustrations"]
  })
    ? "illustration"
    : hasComparableToken({
          values: [...detectionSignals, ...preferredCandidates],
          tokens: ["icon", "icons", "ic_", "icon/"]
        })
      ? "icon"
      : undefined;

  return {
    ...(assetKind ? { assetKind } : {}),
    assetKeys:
      assetKind === "icon"
        ? collectNormalizedIconKeys({
            candidates: [name, title, componentPath, ...preferredCandidates]
          })
        : []
  };
};
