export interface HighlightResult {
  html: string;
  theme: HighlightTheme;
}

export type HighlightLanguage = "tsx" | "typescript" | "json";
export type HighlightTheme = "github-dark" | "github-light";

export const DARK_THEME: HighlightTheme = "github-dark";
export const LIGHT_THEME: HighlightTheme = "github-light";

const MAX_FILE_SIZE = 500_000;

export function detectLanguage(filePath: string): HighlightLanguage | null {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".jsx")) return "tsx";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "typescript";
  return null;
}

export function exceedsMaxSize(code: string): boolean {
  return code.length > MAX_FILE_SIZE;
}

export function getPreferredTheme(): HighlightTheme {
  if (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return DARK_THEME;
  }
  return LIGHT_THEME;
}
