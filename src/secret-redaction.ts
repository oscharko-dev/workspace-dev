/**
 * Label-anchored secret patterns. Each captures `(label)(value)` so the
 * label is preserved in the output while the value is replaced with the
 * caller-supplied placeholder.
 */
const SHARED_SECRET_PATTERNS = [
  /(\b(?:access_token|oauth_token|refresh_token|client_secret)\s*=\s*)([^\s]+)/gi,
  /(\b(?:repoToken|figmaAccessToken|token)\s*=\s*)([^\s]+)/gi,
  /(\bauthorization\s*:\s*(?:bearer|basic|oauth)\s+)([^\s]+)/gi,
  /(\bx-access-token\s*:\s*)([^\s]+)/gi,
  /(\b(?:Bearer|Token|Secret|Api[-_ ]?Key|Password)\b\s*[:=]\s*)([A-Za-z0-9._-]{8,})\b/gi,
  /(\b(?:Bearer|Token|OAuth)\s+)([A-Za-z0-9._-]{8,})\b/gi,
  /("(?:repoToken|figmaAccessToken|token|secret|api[-_ ]?key|password|authorization|x-figma-token)"\s*:\s*")((?:[^"\\]|\\.)+)/gi,
] as const;

/**
 * Issue #1667 (audit-2026-05): bare-token shape patterns. These match
 * on the credential's intrinsic shape, not on a label. Applied AFTER the
 * label-anchored patterns so the existing pretty-print form ("Bearer
 * <jwt>") still preserves the surrounding label, but a bare credential
 * smuggled into a free-text error message (Azure AI Foundry 401 bodies,
 * fetch stack traces, sanitized JSON whose label was stripped upstream)
 * still gets redacted.
 *
 * Coverage:
 *   - JWT (3 base64url segments, header floor 16 chars, body/sig floor 16
 *     chars). Header byte 0..2 is `eyJ` because every base64url-encoded
 *     `{"` JSON object header begins that way.
 *   - GitHub PAT, OAuth user-to-server, server-to-server, refresh, app
 *     installation tokens (`gh[psoru]_...`).
 *   - Figma personal access token (`figd_...`).
 *   - Slack bot/user tokens (`xox[bp]-...`).
 *   - Atlassian / Jira PAT (`ATATT3...`).
 *   - AWS access key id (`AKIA...` / `ASIA...` 16-32 alnum total).
 *   - Azure storage SAS-style token shape (`sig=...`) — covered by the
 *     label-anchored set, so not duplicated here.
 *
 * Each pattern uses `\b` boundaries so a substring inside a longer alnum
 * sequence is not falsely matched.
 */
const BARE_TOKEN_PATTERNS = [
  // JWT — three base64url segments separated by dots. Floor of 16 chars
  // per segment to avoid matching short ID-like strings; real JWTs are
  // far longer.
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  // GitHub Personal Access Token / installation / OAuth / refresh tokens.
  /\bgh[psoru]_[A-Za-z0-9]{36,}\b/g,
  // Figma personal access token. Cannot use trailing `\b` because the
  // token alphabet includes `-` and `_`, both non-word for the `_`
  // (actually `_` is a word char but `-` is not) — when the token ends
  // on `-` the `\b` would not match. Negative lookahead instead.
  /\bfigd_[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g,
  // Slack bot/user/app-level tokens. Trailing `-` would break `\b`; use
  // a negative lookahead.
  /\bxox[bpoasr]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9-])/g,
  // Atlassian / Jira PAT. Cannot use `\b` on the right because the
  // token alphabet includes `=` (base64 padding), which is itself a
  // non-word character — `\b` between two non-word chars never fires.
  // Use a negative lookahead on the token-alphabet instead.
  /\bATATT3[A-Za-z0-9_=-]{40,}(?![A-Za-z0-9_=-])/g,
  // AWS access-key id (`AKIA...` for IAM users, `ASIA...` for STS).
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
];

export const redactHighRiskSecrets = (
  message: string,
  replacement: string,
): string => {
  // 1. Label-anchored patterns run first — they preserve the leading
  //    label fragment via `$1${replacement}` so the diagnostic remains
  //    readable.
  const labeled = SHARED_SECRET_PATTERNS.reduce((redacted, pattern) => {
    return redacted.replace(pattern, `$1${replacement}`);
  }, message);
  // 2. Bare-token patterns run second so any unlabelled credential
  //    that survived step 1 (e.g. a JWT smuggled into an Azure error
  //    body, a bare `figd_...` quoted in a stack trace) is replaced
  //    in full by the placeholder.
  return BARE_TOKEN_PATTERNS.reduce((redacted, pattern) => {
    return redacted.replace(pattern, replacement);
  }, labeled);
};
