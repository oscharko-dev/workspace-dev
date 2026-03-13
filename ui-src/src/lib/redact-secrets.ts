const VISIBLE_KEY_NAMES = new Set(["figmaFileKey"]);

function shouldRedactKey({ key }: { key: string }): boolean {
  const normalized = key.toLowerCase();
  if (VISIBLE_KEY_NAMES.has(key)) {
    return false;
  }

  return normalized.includes("token") || normalized.includes("access") || normalized.includes("key");
}

export function redactSecrets({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets({ value: entry }));
  }

  if (typeof value !== "object") {
    return value;
  }

  const objectValue = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(objectValue)) {
    if (shouldRedactKey({ key })) {
      redacted[key] = typeof entry === "string" && entry.length > 0 ? "[REDACTED]" : entry;
      continue;
    }

    redacted[key] = redactSecrets({ value: entry });
  }

  return redacted;
}
