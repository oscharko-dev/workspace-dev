/**
 * Lazy singleton Shiki highlighter with caching.
 *
 * Grammars are loaded on demand — only `tsx` is loaded when the first `.tsx`
 * file is opened. Highlighted HTML is cached per (code, lang, theme) tuple
 * and invalidated when the code changes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/384
 */
import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme } from "shiki";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HighlightResult {
  /** HTML string with inline-styled tokens (one <span class="line"> per line) */
  html: string;
  /** Theme that was used */
  theme: BundledTheme;
}

type SupportedLang = "tsx" | "typescript" | "json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DARK_THEME: BundledTheme = "github-dark";
const LIGHT_THEME: BundledTheme = "github-light";
const SUPPORTED_LANGS: SupportedLang[] = ["tsx", "typescript", "json"];
const MAX_FILE_SIZE = 500_000; // 500 KB

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [DARK_THEME, LIGHT_THEME],
      langs: SUPPORTED_LANGS
    });
  }
  return highlighterPromise;
}

// ---------------------------------------------------------------------------
// Cache: key = `${filePath}:${theme}`, value = { code hash, html }
// ---------------------------------------------------------------------------

const cache = new Map<string, { hash: number; html: string }>();

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect language from file path. Returns null for unsupported extensions. */
export function detectLanguage(filePath: string): BundledLanguage | null {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".jsx")) return "tsx";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "typescript";
  return null;
}

/** Returns true if the file exceeds the max size for syntax highlighting. */
export function exceedsMaxSize(code: string): boolean {
  return code.length > MAX_FILE_SIZE;
}

/** Get the preferred theme based on system color scheme. */
export function getPreferredTheme(): BundledTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return DARK_THEME;
  }
  return LIGHT_THEME;
}

/**
 * Highlight code with Shiki. Returns cached result when possible.
 *
 * Runs the Shiki highlighter (which internally uses WASM) and returns
 * the highlighted HTML string. For files > 500 KB, returns null so the
 * caller can fall back to plain text.
 */
export async function highlightCode(
  code: string,
  filePath: string,
  theme?: BundledTheme
): Promise<HighlightResult | null> {
  if (exceedsMaxSize(code)) {
    return null;
  }

  const lang = detectLanguage(filePath);
  if (!lang) {
    return null;
  }

  const resolvedTheme = theme ?? getPreferredTheme();
  const cacheKey = `${filePath}:${resolvedTheme}`;
  const hash = simpleHash(code);

  const cached = cache.get(cacheKey);
  if (cached && cached.hash === hash) {
    return { html: cached.html, theme: resolvedTheme };
  }

  const highlighter = await getHighlighter();

  const html = highlighter.codeToHtml(code, {
    lang,
    theme: resolvedTheme
  });

  cache.set(cacheKey, { hash, html });

  return { html, theme: resolvedTheme };
}

/** Clear the highlight cache (useful for testing). */
export function clearHighlightCache(): void {
  cache.clear();
}
