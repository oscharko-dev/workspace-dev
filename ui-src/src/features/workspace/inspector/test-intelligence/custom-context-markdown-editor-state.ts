import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { safeReadStorage, safeWriteStorage } from "./safe-storage";

export const MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES = 32 * 1024;
export const MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES = 16 * 1024;
export const MAX_CUSTOM_CONTEXT_PLAIN_BYTES = 16 * 1024;
export const REDACTED_LINK_HREF = "about:blank#redacted-link";

const CUSTOM_CONTEXT_DRAFT_STORAGE_PREFIX =
  "workspace-dev:ti-multisource-custom-markdown:v1:";
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

export interface MarkdownValidationState {
  bytes: number;
  withinBudget: boolean;
  message: string | null;
}

export interface MarkdownPolicyValidationState {
  ok: boolean;
  message: string | null;
}

export interface CanonicalMarkdownPreview {
  bodyMarkdown: string;
  bodyPlain: string;
  redactionCount: number;
}

export type CanonicalMarkdownPreviewResult =
  | { ok: true; value: CanonicalMarkdownPreview }
  | { ok: false; message: string };

export function validateCustomContextMarkdownPolicy(
  value: string,
): MarkdownPolicyValidationState {
  if (value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim().length === 0) {
    return { ok: true, message: null };
  }
  const canonical = canonicalizeCustomContextMarkdownPreview(value);
  return canonical.ok
    ? { ok: true, message: null }
    : { ok: false, message: canonical.message };
}

export function canonicalizeCustomContextMarkdownPreview(
  value: string,
): CanonicalMarkdownPreviewResult {
  const rawBytes = utf8Bytes(value);
  if (rawBytes > MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES) {
    return {
      ok: false,
      message: `Custom context markdown exceeds the ${MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES.toLocaleString(
        "en-US",
      )}-byte raw payload budget.`,
    };
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, "  ");
  if (normalized.trim().length === 0) {
    return { ok: false, message: "Custom context markdown is empty." };
  }
  const refusal = findMarkdownRefusal(normalized);
  if (refusal !== null) return { ok: false, message: refusal };

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
  let redactionCount = 0;
  const redactedLines = canonicalBareUrls.split("\n").map((line) => {
    const pii = detectMarkdownPii(line);
    if (pii === null) return line.replace(/[ \t]+$/u, "");
    redactionCount += 1;
    return `${extractMarkdownPrefix(line)}${pii}`.replace(/[ \t]+$/u, "");
  });
  const canonicalMarkdown = trimBlankEdges(collapseBlankRuns(redactedLines)).join(
    "\n",
  );
  const bodyMarkdown = canonicalMarkdown.endsWith("\n")
    ? canonicalMarkdown
    : `${canonicalMarkdown}\n`;
  const bodyPlain = markdownToPlain(bodyMarkdown);
  if (utf8Bytes(bodyMarkdown) > MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES) {
    return {
      ok: false,
      message: `Custom context markdown exceeds the ${MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES.toLocaleString(
        "en-US",
      )}-byte canonical payload budget.`,
    };
  }
  if (utf8Bytes(bodyPlain) > MAX_CUSTOM_CONTEXT_PLAIN_BYTES) {
    return {
      ok: false,
      message: `Custom context plain text exceeds the ${MAX_CUSTOM_CONTEXT_PLAIN_BYTES.toLocaleString(
        "en-US",
      )}-byte plain text budget.`,
    };
  }
  return { ok: true, value: { bodyMarkdown, bodyPlain, redactionCount } };
}

function findMarkdownRefusal(normalized: string): string | null {
  if (normalized.includes("\uFFFD")) {
    return "Markdown contains malformed UTF-8 replacement characters.";
  }
  if (/^---\n[\s\S]*?\n---(?:\n|$)/u.test(normalized)) {
    return "Markdown frontmatter is not accepted.";
  }
  if (RAW_HTML_RE.test(normalized)) {
    return "Raw HTML is not accepted in custom context.";
  }
  if (IMAGE_RE.test(normalized)) {
    return "Images are not accepted in custom context.";
  }
  if (MDX_RE.test(normalized)) {
    return "MDX and JSX are not accepted in custom context.";
  }
  let inFence = false;
  for (const line of normalized.split("\n")) {
    const fence = FENCE_RE.exec(line.trim());
    if (fence !== null) {
      const lang = (fence[1] ?? "").toLowerCase();
      if (!inFence && (lang === "mermaid" || lang === "diagram")) {
        return "Mermaid and diagram code fences are not accepted.";
      }
      inFence = !inFence;
    }
  }
  if (!markdownUrlsAreSafe(normalized)) {
    return "Markdown links and URLs must not target local or private hosts.";
  }
  return null;
}

export function isMarkdownDraftPersistable(value: string): boolean {
  return validateCustomContextMarkdownPolicy(value).ok;
}

export function useMarkdownDraft(jobId: string): [
  string,
  Dispatch<SetStateAction<string>>,
] {
  const storageKey = useMemo(
    () => `${CUSTOM_CONTEXT_DRAFT_STORAGE_PREFIX}${jobId}`,
    [jobId],
  );
  const [value, setValue] = useState(() => {
    const stored = safeReadStorage(storageKey);
    return isMarkdownDraftPersistable(stored) ? stored : "";
  });

  useEffect(() => {
    safeWriteStorage(
      storageKey,
      isMarkdownDraftPersistable(value) ? value : "",
    );
  }, [storageKey, value]);

  return [value, setValue];
}

function markdownUrlsAreSafe(value: string): boolean {
  for (const match of value.matchAll(LINK_RE)) {
    if (!isSafeCustomContextMarkdownUrl(match[2] ?? "")) return false;
  }
  for (const match of value.matchAll(AUTOLINK_RE)) {
    if (!isSafeCustomContextMarkdownUrl(match[1] ?? "")) return false;
  }
  for (const match of value.matchAll(BARE_URL_RE)) {
    if (
      !isSafeCustomContextMarkdownUrl(
        trimTrailingBareUrlPunctuation(match[1] ?? ""),
      )
    ) {
      return false;
    }
  }
  return true;
}

const EMAIL_RE =
  /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/u;
const IBAN_CANDIDATE_RE = /\b([A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30})\b/gu;
const BIC_CANDIDATE_RE =
  /\b[A-Z]{4}(?:DE|AT|CH|FR|GB|US|NL|ES|IT|BE|LU|DK|SE|NO|FI|IE|PT|PL|CZ|SK|HU|RO|BG|GR|CY|MT|EE|LV|LT|SI|HR)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gu;
const PAN_CANDIDATE_RE = /(?:\d[\s-]?){12,18}\d/gu;
const PHONE_WITH_COUNTRY_CODE_RE =
  /(?<![\dA-Za-z])\+\d{1,3}[\s-]\d{2,4}[\s-]\d{3,8}(?:[\s-]\d{3,4})?(?!\d)/u;
const PHONE_LOCAL_GROUPED_RE =
  /(?<![\dA-Za-z])\(\d{2,4}\)[\s-]?\d{3,4}[\s-]\d{3,8}(?!\d)/u;
const GERMAN_TAX_ID_RE = /\b\d{11}\b/gu;
const US_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/u;
const INTERNAL_HOSTNAME_RE =
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:intranet|corp|internal|local|lan|atlassian\.net|jira\.com)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?![A-Za-z0-9])/iu;
const JIRA_MENTION_RE =
  /(?:\[~accountid:[A-Za-z0-9:_-]+\])|(?:@(?:account(?:id)?|user-mention|mention)[\s:[(=-]+[A-Za-z0-9:_-]{4,64}\]?)|(?:[0-9a-f]{24,32}(?=\s|$|[^A-Za-z0-9]))/iu;
const FULL_NAME_PLACEHOLDERS = [
  "max mustermann",
  "erika mustermann",
  "max musterman",
  "john doe",
  "jane doe",
  "jane smith",
  "john smith",
];

function detectMarkdownPii(input: string): string | null {
  const normalized = input.normalize("NFKC");
  for (const match of normalized.matchAll(IBAN_CANDIDATE_RE)) {
    const candidate = match[1]?.replace(/[\s-]/gu, "").toUpperCase();
    if (
      candidate !== undefined &&
      candidate.length >= 15 &&
      candidate.length <= 34 &&
      validateIbanMod97(candidate)
    ) {
      return "[REDACTED:IBAN]";
    }
  }
  const upper = normalized.toUpperCase();
  for (const match of upper.matchAll(BIC_CANDIDATE_RE)) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;
    const rawCandidate = normalized.slice(start, end);
    const before = normalized.slice(0, start).trim();
    const after = normalized.slice(end).trim();
    const standalone = before.length === 0 && after.length === 0;
    const labelled = /(?:bic|swift)\s*[:#-]?\s*$/iu.test(before);
    const uppercaseToken = rawCandidate === rawCandidate.toUpperCase();
    if ((standalone && (uppercaseToken || candidate.length === 11)) || labelled) {
      return "[REDACTED:BIC]";
    }
  }
  for (const match of normalized.matchAll(PAN_CANDIDATE_RE)) {
    const digits = match[0].replace(/\D/gu, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      return "[REDACTED:PAN]";
    }
  }
  if (EMAIL_RE.test(normalized)) return "[REDACTED:EMAIL]";
  if (US_SSN_RE.test(normalized)) return "[REDACTED:TAX_ID]";
  for (const match of normalized.matchAll(GERMAN_TAX_ID_RE)) {
    if (validateGermanTaxId(match[0])) return "[REDACTED:TAX_ID]";
  }
  const phone =
    PHONE_WITH_COUNTRY_CODE_RE.exec(normalized) ??
    PHONE_LOCAL_GROUPED_RE.exec(normalized);
  if (phone !== null) {
    const digits = phone[0].replace(/\D/gu, "");
    if (digits.length >= 7 && digits.length <= 15) return "[REDACTED:PHONE]";
  }
  if (JIRA_MENTION_RE.test(normalized)) return "[REDACTED:JIRA_MENTION]";
  if (INTERNAL_HOSTNAME_RE.test(normalized)) {
    return "[REDACTED:INTERNAL_HOSTNAME]";
  }
  const lowered = normalized.toLowerCase();
  if (FULL_NAME_PLACEHOLDERS.some((name) => lowered.includes(name))) {
    return "[REDACTED:FULL_NAME]";
  }
  return null;
}

function extractMarkdownPrefix(line: string): string {
  return (
    /^(\s{0,3}#{1,6}\s+)/u.exec(line)?.[1] ??
    /^(\s{0,3}>\s?)/u.exec(line)?.[1] ??
    /^(\s{0,3}[-*+]\s+\[[ xX]\]\s+)/u.exec(line)?.[1] ??
    /^(\s{0,3}[-*+]\s+)/u.exec(line)?.[1] ??
    /^(\s{0,3}\d+[.)]\s+)/u.exec(line)?.[1] ??
    /^(\s*\|\s*)/u.exec(line)?.[1] ??
    ""
  );
}

function markdownToPlain(markdown: string): string {
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
}

function collapseBlankRuns(lines: readonly string[]): string[] {
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
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim().length === 0) start += 1;
  while (end > start && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validateIbanMod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    let num: number;
    if (code >= 48 && code <= 57) {
      num = code - 48;
    } else if (code >= 65 && code <= 90) {
      num = code - 55;
    } else {
      return false;
    }
    remainder = (remainder * (num < 10 ? 10 : 100) + num) % 97;
  }
  return remainder === 1;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let doubled = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const d = digits.charCodeAt(index) - 48;
    if (d < 0 || d > 9) return false;
    let value = d;
    if (doubled) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubled = !doubled;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function validateGermanTaxId(digits: string): boolean {
  if (digits.length !== 11) return false;
  let product = 10;
  for (let index = 0; index < 10; index += 1) {
    const d = digits.charCodeAt(index) - 48;
    if (d < 0 || d > 9) return false;
    let mod = (d + product) % 10;
    if (mod === 0) mod = 10;
    product = (mod * 2) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return check === digits.charCodeAt(10) - 48;
}

export function isSafeCustomContextMarkdownUrl(value: string): boolean {
  const trimmed = value.trim();
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
}

function trimTrailingBareUrlPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && /[.,;:!?]/u.test(value[end - 1] ?? "")) end -= 1;
  return value.slice(0, end);
}

function isPrivateOrLocalIpHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/gu, "");
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== null) return isPrivateOrLocalIpv4(ipv4);
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
}

function isPrivateOrLocalIpv4(
  ipv4: readonly [number, number, number, number],
): boolean {
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
}

function extractIpv4MappedAddress(
  host: string,
): [number, number, number, number] | null {
  const dotted =
    /(?:::ffff:|^0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(host);
  if (dotted?.[1] !== undefined) return parseIpv4(dotted[1]);
  const hex =
    /(?:::ffff:|^0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(
      host,
    );
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
}

function parseIpv4(host: string): [number, number, number, number] | null {
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
}
