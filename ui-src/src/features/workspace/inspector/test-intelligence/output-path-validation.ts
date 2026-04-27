// Mirrors server-side validateJiraWriteMarkdownPath for immediate feedback.
export const validateOutputPathFormat = (
  value: string,
): { ok: true } | { ok: false; message: string } => {
  const trimmed = value.trim();
  if (trimmed.includes("\0")) {
    return { ok: false, message: "Path must not contain null bytes." };
  }
  if (!trimmed.startsWith("/")) {
    return { ok: false, message: "Path must be absolute." };
  }
  if (trimmed.split(/[\\/]+/u).includes("..")) {
    return {
      ok: false,
      message: 'Path must not contain ".." path segments.',
    };
  }
  return { ok: true };
};
