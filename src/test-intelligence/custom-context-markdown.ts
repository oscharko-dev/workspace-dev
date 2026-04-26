import type { IntentRedaction, PiiIndicator } from "../contracts/index.js";
import { detectPii } from "./pii-detection.js";
import { sha256Hex } from "./content-hash.js";

export const MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES: number = 32 * 1024;
export const MAX_CUSTOM_CONTEXT_CANONICAL_MARKDOWN_BYTES: number = 16 * 1024;
export const MAX_CUSTOM_CONTEXT_PLAIN_BYTES: number = 16 * 1024;

export type CustomContextMarkdownRefusalCode =
  | "markdown_input_not_string"
  | "markdown_input_empty"
  | "markdown_raw_too_large"
  | "markdown_canonical_too_large"
  | "markdown_plain_too_large"
  | "markdown_malformed_utf8"
  | "markdown_frontmatter_refused"
  | "markdown_html_refused"
  | "markdown_image_refused"
  | "markdown_mdx_refused"
  | "markdown_mermaid_refused"
  | "markdown_unsafe_url_refused";

export interface CustomContextMarkdownIssue {
  code: CustomContextMarkdownRefusalCode;
  path?: string;
  detail?: string;
}

export interface CanonicalCustomContextMarkdown {
  bodyMarkdown: string;
  bodyPlain: string;
  markdownContentHash: string;
  plainContentHash: string;
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}

export type CanonicalizeCustomContextMarkdownResult =
  | { ok: true; value: CanonicalCustomContextMarkdown }
  | { ok: false; issues: CustomContextMarkdownIssue[] };

const RAW_HTML_RE =
  /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?>|<!doctype\b|<!--|<\?xml\b/iu;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/u;
const MDX_RE =
  /^\s*(?:import|export)\s+|\{\s*[\w$.]+\s*\}|<[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/mu;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^<>\s]+)>/giu;
const BARE_URL_RE = /(?:^|[\s(])((?:https?:\/\/)[^\s<>()\]]+)/giu;
const FENCE_RE = /^```([A-Za-z0-9_-]+)?\s*$/u;

const INTERNAL_HOST_RE =
  /(?:^|\.)((?:localhost)|(?:local)|(?:internal)|(?:corp)|(?:intranet)|(?:lan))$/iu;
const SAFE_URL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const REDACTED_LINK_HREF = "about:blank#redacted-link";

export const canonicalizeCustomContextMarkdown = (
  input: unknown,
): CanonicalizeCustomContextMarkdownResult => {
  const issues: CustomContextMarkdownIssue[] = [];
  if (typeof input !== "string") {
    return { ok: false, issues: [{ code: "markdown_input_not_string" }] };
  }
  const rawBytes = Buffer.byteLength(input, "utf8");
  if (rawBytes > MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES) {
    return {
      ok: false,
      issues: [{ code: "markdown_raw_too_large", detail: String(rawBytes) }],
    };
  }
  if (input.includes("\uFFFD")) {
    issues.push({ code: "markdown_malformed_utf8" });
  }
  const normalized = input
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, "  ");
  if (normalized.trim().length === 0) {
    issues.push({ code: "markdown_input_empty" });
  }
  if (/^---\n[\s\S]*?\n---(?:\n|$)/u.test(normalized)) {
    issues.push({ code: "markdown_frontmatter_refused" });
  }
  if (RAW_HTML_RE.test(normalized)) {
    issues.push({ code: "markdown_html_refused" });
  }
  if (IMAGE_RE.test(normalized)) {
    issues.push({ code: "markdown_image_refused" });
  }
  if (MDX_RE.test(normalized)) {
    issues.push({ code: "markdown_mdx_refused" });
  }

  const lines = normalized.split("\n");
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE_RE.exec(line.trim());
    if (fence !== null) {
      const lang = (fence[1] ?? "").toLowerCase();
      if (!inFence && (lang === "mermaid" || lang === "diagram")) {
        issues.push({
          code: "markdown_mermaid_refused",
          path: `lines[${index}]`,
        });
      }
      inFence = !inFence;
    }
  }

  for (const match of normalized.matchAll(LINK_RE)) {
    const href = match[2];
    if (href === undefined || !isSafeMarkdownUrl(href)) {
      issues.push({
        code: "markdown_unsafe_url_refused",
        detail: href ?? "missing",
      });
    }
  }
  for (const match of normalized.matchAll(AUTOLINK_RE)) {
    const href = match[1];
    if (href === undefined || !isSafeMarkdownUrl(href)) {
      issues.push({
        code: "markdown_unsafe_url_refused",
        detail: href ?? "missing",
      });
    }
  }
  for (const match of normalized.matchAll(BARE_URL_RE)) {
    const href = trimTrailingBareUrlPunctuation(match[1] ?? "");
    if (href.length === 0 || !isSafeMarkdownUrl(href)) {
      issues.push({
        code: "markdown_unsafe_url_refused",
        detail: href.length === 0 ? "missing" : href,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const canonicalLinked = normalized.replace(
    LINK_RE,
    (_whole, label: string) => `[${label}](${REDACTED_LINK_HREF})`,
  );
  const canonicalAutolinked = canonicalLinked.replace(
    AUTOLINK_RE,
    (_whole, href: string) =>
      href.toLowerCase().startsWith("mailto:")
        ? "<mailto:redacted@example.invalid>"
        : `<${REDACTED_LINK_HREF}>`,
  );
  const canonicalBareUrls = canonicalAutolinked.replace(
    BARE_URL_RE,
    (whole: string, href: string) => whole.replace(href, REDACTED_LINK_HREF),
  );

  const piiIndicators: PiiIndicator[] = [];
  const redactions: IntentRedaction[] = [];
  const redactedLines = canonicalBareUrls.split("\n").map((line, index) =>
    redactMarkdownLine({
      line: line.replace(/[ \t]+$/u, ""),
      index,
      piiIndicators,
      redactions,
    }),
  );
  const canonicalMarkdown = trimBlankEdges(
    collapseBlankRuns(redactedLines),
  ).join("\n");
  const bodyMarkdown = canonicalMarkdown.endsWith("\n")
    ? canonicalMarkdown
    : `${canonicalMarkdown}\n`;
  const bodyPlain = markdownToPlain(bodyMarkdown);

  const markdownBytes = Buffer.byteLength(bodyMarkdown, "utf8");
  if (markdownBytes > MAX_CUSTOM_CONTEXT_CANONICAL_MARKDOWN_BYTES) {
    return {
      ok: false,
      issues: [
        { code: "markdown_canonical_too_large", detail: String(markdownBytes) },
      ],
    };
  }
  const plainBytes = Buffer.byteLength(bodyPlain, "utf8");
  if (plainBytes > MAX_CUSTOM_CONTEXT_PLAIN_BYTES) {
    return {
      ok: false,
      issues: [
        { code: "markdown_plain_too_large", detail: String(plainBytes) },
      ],
    };
  }

  return {
    ok: true,
    value: {
      bodyMarkdown,
      bodyPlain,
      markdownContentHash: sha256Hex({
        kind: "custom_context_markdown",
        bodyMarkdown,
      }),
      plainContentHash: sha256Hex({
        kind: "custom_context_plain",
        bodyPlain,
      }),
      piiIndicators,
      redactions,
    },
  };
};

const redactMarkdownLine = ({
  line,
  index,
  piiIndicators,
  redactions,
}: {
  line: string;
  index: number;
  piiIndicators: PiiIndicator[];
  redactions: IntentRedaction[];
}): string => {
  const match = detectPii(line);
  if (match === null) return line;
  const prefix = extractMarkdownPrefix(line);
  const replacement = `${prefix}${match.redacted}`;
  const indicatorId = `custom-context::markdown::line-${index}::pii::${match.kind}`;
  piiIndicators.push({
    id: indicatorId,
    kind: match.kind,
    confidence: match.confidence,
    matchLocation: "custom_context_markdown",
    redacted: match.redacted,
    traceRef: {},
  });
  redactions.push({
    id: `${indicatorId}::redaction`,
    indicatorId,
    kind: match.kind,
    reason: `Detected ${match.kind} in custom_context_markdown`,
    replacement: match.redacted,
  });
  return replacement;
};

const extractMarkdownPrefix = (line: string): string => {
  const heading = /^(\s{0,3}#{1,6}\s+)/u.exec(line);
  if (heading?.[1] !== undefined) return heading[1];
  const quote = /^(\s{0,3}>\s?)/u.exec(line);
  if (quote?.[1] !== undefined) return quote[1];
  const task = /^(\s{0,3}[-*+]\s+\[[ xX]\]\s+)/u.exec(line);
  if (task?.[1] !== undefined) return task[1];
  const bullet = /^(\s{0,3}[-*+]\s+)/u.exec(line);
  if (bullet?.[1] !== undefined) return bullet[1];
  const ordered = /^(\s{0,3}\d+[.)]\s+)/u.exec(line);
  if (ordered?.[1] !== undefined) return ordered[1];
  const table = /^(\s*\|\s*)/u.exec(line);
  if (table?.[1] !== undefined) return table[1];
  return "";
};

const markdownToPlain = (markdown: string): string => {
  const plain = markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^```[A-Za-z0-9_-]*\s*$/u, "")
        .replace(/^\s{0,3}#{1,6}\s+/u, "")
        .replace(/^\s{0,3}>\s?/u, "")
        .replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/u, "")
        .replace(/^\s{0,3}[-*+]\s+/u, "")
        .replace(/^\s{0,3}\d+[.)]\s+/u, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .replace(/[*_~`]/gu, "")
        .replace(/\|/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n");
  return plain.endsWith("\n") ? plain : `${plain}\n`;
};

const collapseBlankRuns = (lines: readonly string[]): string[] => {
  const out: string[] = [];
  let blank = false;
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (!blank) out.push("");
      blank = true;
    } else {
      out.push(line);
      blank = false;
    }
  }
  return out;
};

const trimBlankEdges = (lines: readonly string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim().length === 0) start += 1;
  while (end > start && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
  return lines.slice(start, end);
};

const isSafeMarkdownUrl = (href: string): boolean => {
  const trimmed = href.trim();
  if (trimmed.length === 0) return false;
  if (/^(?:javascript|data|file|vbscript):/iu.test(trimmed)) return false;
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if (!SAFE_URL_PROTOCOLS.has(url.protocol)) return false;
    if (url.protocol === "mailto:") return true;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      isPrivateOrLocalIpHost(host) ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".corp") ||
      host.endsWith(".intranet") ||
      host.endsWith(".lan") ||
      INTERNAL_HOST_RE.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

const isPrivateOrLocalIpHost = (host: string): boolean => {
  const normalized = host.replace(/^\[|\]$/gu, "");
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== null) {
    return isPrivateOrLocalIpv4(ipv4);
  }
  if (normalized.includes(":")) {
    const lowered = normalized.toLowerCase();
    const mappedIpv4 = extractIpv4MappedAddress(lowered);
    if (mappedIpv4 !== null && isPrivateOrLocalIpv4(mappedIpv4)) {
      return true;
    }
    return (
      lowered.startsWith("fc") ||
      lowered.startsWith("fd") ||
      lowered.startsWith("fe80")
    );
  }
  return false;
};

const trimTrailingBareUrlPunctuation = (href: string): string => {
  let end = href.length;
  while (end > 0 && /[.,;:!?]/u.test(href[end - 1] ?? "")) end -= 1;
  return href.slice(0, end);
};

const isPrivateOrLocalIpv4 = (
  ipv4: readonly [number, number, number, number],
): boolean => {
  const [a, b] = ipv4;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const extractIpv4MappedAddress = (
  host: string,
): [number, number, number, number] | null => {
  const dotted = /(?:::ffff:|^0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(
    host,
  );
  if (dotted?.[1] !== undefined) {
    return parseIpv4(dotted[1]);
  }
  const hex =
    /(?:::ffff:|^0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(host);
  if (hex?.[1] === undefined || hex[2] === undefined) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
};

const parseIpv4 = (host: string): [number, number, number, number] | null => {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return Number.NaN;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : Number.NaN;
  });
  return octets.every((n) => Number.isInteger(n))
    ? (octets as [number, number, number, number])
    : null;
};
