// Mirrors server-side validateJiraWriteMarkdownPath — catches path traversal
// and null bytes client-side so the user sees validation feedback immediately,
// before the run request reaches the server.
export const validateOutputPathFormat = (
  value: string,
): { ok: true } | { ok: false; message: string } => {
  const trimmed = value.trim();
  if (trimmed.includes("\0")) {
    return { ok: false, message: "Path must not contain null bytes." };
  }
  if (trimmed.includes("..")) {
    return {
      ok: false,
      message: 'Path must not contain ".." (path traversal).',
    };
  }
  return { ok: true };
};
