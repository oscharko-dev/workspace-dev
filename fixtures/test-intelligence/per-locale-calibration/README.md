# Per-locale calibration fixtures

This directory contains one minimal Figma JSON fixture per supported locale.
Initial six locales (DE-DE, DE-AT, DE-CH, EN-IE, FR-FR, IT-IT) were introduced
by Issue #2117. Issue #2188 extended the corpus with five additional
EU-banking locales: PL-PL (Polish), ES-ES (Spanish), NL-NL (Dutch), CS-CZ
(Czech), HU-HU (Hungarian).

Each fixture file (`<LOCALE>.figma.json`) pins a single screen with the
locale code in the `locale` field, a BUTTON node, and two to three
TEXT_INPUT nodes carrying the locale-specific validation keywords:

| Locale  | "Required field" token | Identifier tokens          |
|---------|------------------------|----------------------------|
| `DE-DE` | `Pflichtfeld`          | (German default)           |
| `DE-AT` | `Pflichtfeld`          | `Sozialversicherungsnummer`, `UID-Nummer ATU` |
| `DE-CH` | `Pflichtfeld`          | `AHV-Nummer`               |
| `FR-FR` | `Champ obligatoire`    | `Numéro de TVA FR`         |
| `IT-IT` | `Campo obbligatorio`   | `Codice Fiscale`, `Partita IVA IT` |
| `EN-IE` | `Required field`       | `Eircode`, `PPS Number`    |
| `PL-PL` | `Pole wymagane`        | `PESEL`, `NIP`, `Numer rachunku` |
| `ES-ES` | `Campo obligatorio`    | `DNI`, `NIE`, `CIF`, `Código postal` |
| `NL-NL` | `Verplicht veld`       | `BSN`, `KvK-nummer`, `BTW-nummer` |
| `CS-CZ` | `Povinné pole`         | `Rodné číslo`, `IČO`, `DIČ` |
| `HU-HU` | `Kötelező mező`        | `Adószám`, `Személyi szám`, `Irányítószám` |

These keyword sets are the same ones that `deriveLocaleFromScreen` in
`locale-calibration.ts` uses to identify locales when no explicit locale tag
is present.

The fixtures serve two purposes: they are loaded by `locale-calibration.test.ts`
to assert that the keyword heuristic resolves the correct `SupportedLocale`,
and they document the minimum field vocabulary expected from each locale's
Figma designs in the EU banking / insurance domain.
