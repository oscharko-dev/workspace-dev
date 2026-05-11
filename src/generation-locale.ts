export const DEFAULT_GENERATION_LOCALE = "de-DE" as const;

const normalizeLocaleInput = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const canonical = Intl.getCanonicalLocales(trimmed)[0];
    if (!canonical) {
      return undefined;
    }
    const supported = Intl.NumberFormat.supportedLocalesOf([canonical], {
      localeMatcher: "lookup"
    });
    return supported.length > 0 ? canonical : undefined;
  } catch {
    return undefined;
  }
};

export const normalizeGenerationLocale = (value: string | undefined): string | undefined => {
  return normalizeLocaleInput(value);
};

export const resolveGenerationLocale = ({
  requestedLocale,
  fallbackLocale = DEFAULT_GENERATION_LOCALE
}: {
  requestedLocale: string | undefined;
  fallbackLocale?: string | undefined;
}): {
  locale: string;
  usedFallback: boolean;
} => {
  const normalizedFallback = normalizeGenerationLocale(fallbackLocale) ?? DEFAULT_GENERATION_LOCALE;
  const normalizedRequested = normalizeGenerationLocale(requestedLocale);
  if (normalizedRequested) {
    return {
      locale: normalizedRequested,
      usedFallback: false
    };
  }

  return {
    locale: normalizedFallback,
    usedFallback: typeof requestedLocale === "string" && requestedLocale.trim().length > 0
  };
};
