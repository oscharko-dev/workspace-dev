const SHARED_SECRET_PATTERNS = [
  /(\b(?:repoToken|figmaAccessToken|token)\s*=\s*)([^\s]+)/gi,
  /(\bauthorization\s*:\s*bearer\s+)([^\s]+)/gi,
  /(\bx-access-token\s*:\s*)([^\s]+)/gi,
  /(\b(?:Bearer|Token|Secret|Api[-_ ]?Key|Password)\b\s*[:=]\s*)([A-Za-z0-9._-]{8,})\b/gi,
  /("(?:repoToken|figmaAccessToken|token|secret|api[-_ ]?key|password|authorization|x-figma-token)"\s*:\s*")([^"]+)/gi,
] as const;

export const redactHighRiskSecrets = (
  message: string,
  replacement: string,
): string => {
  return SHARED_SECRET_PATTERNS.reduce((redacted, pattern) => {
    return redacted.replace(pattern, `$1${replacement}`);
  }, message);
};
