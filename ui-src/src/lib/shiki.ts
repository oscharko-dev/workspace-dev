/**
 * Lazy singleton Shiki highlighter with caching.
 *
 * Only the small set of languages/themes used in the inspector is bundled
 * into the worker. Highlighted HTML is cached per (code, lang, theme) tuple
 * and invalidated when the code changes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/384
 */
import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  DARK_THEME,
  LIGHT_THEME,
  detectLanguage,
  exceedsMaxSize,
  getPreferredTheme,
  type HighlightResult,
  type HighlightTheme
} from "./shiki-shared";

export { detectLanguage, exceedsMaxSize, getPreferredTheme };
export type { HighlightLanguage, HighlightResult, HighlightTheme } from "./shiki-shared";

const SUPPORTED_LANGS = ["tsx", "typescript", "json"] as const;
const SUPPORTED_THEMES = [DARK_THEME, LIGHT_THEME] as const;

// ---------------------------------------------------------------------------
// Singleton highlighter
// ---------------------------------------------------------------------------

const createSelectiveHighlighter = createBundledHighlighter({
  langs: {
    tsx: () => import("shiki/langs/tsx.mjs"),
    typescript: () => import("shiki/langs/typescript.mjs"),
    json: () => import("shiki/langs/json.mjs")
  },
  themes: {
    "github-dark": () => import("shiki/themes/github-dark.mjs"),
    "github-light": () => import("shiki/themes/github-light.mjs")
  },
  engine: () => createJavaScriptRegexEngine()
});

type ShikiHighlighter = Awaited<ReturnType<typeof createSelectiveHighlighter>>;

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createSelectiveHighlighter({
      themes: [...SUPPORTED_THEMES],
      langs: [...SUPPORTED_LANGS]
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

/**
 * Highlight code with Shiki. Returns cached result when possible.
 *
 * Runs the Shiki highlighter with the JavaScript regex engine and returns
 * the highlighted HTML string. For files > 500 KB, returns null so the
 * caller can fall back to plain text.
 */
export async function highlightCode(
  code: string,
  filePath: string,
  theme?: HighlightTheme
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
