export interface PasteErrorMessage {
  title: string;
  description: string;
  action: string;
  retryable: boolean;
}

export type PasteErrorCode =
  | "CLIPBOARD_NOT_FIGMA"
  | "MCP_UNAVAILABLE"
  | "MCP_RATE_LIMITED"
  | "FILE_NOT_FOUND"
  | "NODE_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "TRANSFORM_PARTIAL"
  | "CODEGEN_PARTIAL"
  | "PAYLOAD_TOO_LARGE"
  | "SCHEMA_MISMATCH"
  | "STAGE_FAILED"
  | "JOB_FAILED"
  | "POLL_FAILED"
  | "SUBMIT_FAILED"
  | "CANCEL_FAILED"
  | "MISSING_PREVIEW_URL";

export const PASTE_ERROR_CATALOG: Record<PasteErrorCode, PasteErrorMessage> = {
  CLIPBOARD_NOT_FIGMA: {
    title: "Not a Figma export",
    description: "The pasted content doesn't appear to be from Figma.",
    action: "Copy a component or frame in Figma and try again.",
    retryable: false,
  },
  MCP_UNAVAILABLE: {
    title: "Figma MCP unavailable",
    description: "Can't connect to the Figma MCP server.",
    action:
      "Make sure the Figma desktop app is running, or configure a remote MCP server in Settings.",
    retryable: true,
  },
  MCP_RATE_LIMITED: {
    title: "Figma MCP rate limit reached",
    description: "Too many requests to the Figma MCP server.",
    action:
      "Wait a few minutes and retry, or configure a Figma API token for direct REST API access.",
    retryable: true,
  },
  FILE_NOT_FOUND: {
    title: "Figma file not found",
    description:
      "The copied Figma file couldn't be found. It may have been deleted or you may not have access.",
    action: "Try opening the file in Figma first, then copy again.",
    retryable: false,
  },
  NODE_NOT_FOUND: {
    title: "Component not found",
    description:
      "The copied component was not found in the Figma file. It may have been deleted since you copied it.",
    action: "Open the file in Figma and copy the component again.",
    retryable: false,
  },
  AUTH_REQUIRED: {
    title: "Figma authentication required",
    description: "Figma authentication is needed to access this resource.",
    action:
      "Sign in to Figma or add your Personal Access Token in Settings \u2192 Integrations.",
    retryable: false,
  },
  TRANSFORM_PARTIAL: {
    title: "Partial import",
    description:
      "Some elements couldn't be converted. Unsupported node types were skipped.",
    action:
      "The supported elements are shown below. Review the skipped nodes in the details panel.",
    retryable: false,
  },
  CODEGEN_PARTIAL: {
    title: "Some files failed to generate",
    description: "Code generation failed for one or more files.",
    action:
      "Successfully generated files are available. Retry the failed files individually.",
    retryable: true,
  },
  PAYLOAD_TOO_LARGE: {
    title: "Design too large",
    description: "The pasted design exceeds the maximum allowed size.",
    action: "Try copying a smaller section or a single component.",
    retryable: false,
  },
  SCHEMA_MISMATCH: {
    title: "Invalid Figma export",
    description:
      "The pasted content is not valid JSON or doesn't match the expected Figma format.",
    action:
      "Export JSON from Figma using File \u2192 Export, or copy using the Figma plugin.",
    retryable: false,
  },
  STAGE_FAILED: {
    title: "Pipeline stage failed",
    description: "An error occurred during processing.",
    action: "Check the error details and retry.",
    retryable: true,
  },
  JOB_FAILED: {
    title: "Import failed",
    description: "The import job did not complete successfully.",
    action: "Check the error details and try again.",
    retryable: false,
  },
  POLL_FAILED: {
    title: "Connection error",
    description: "Lost connection while waiting for results.",
    action: "Check your network connection and retry.",
    retryable: true,
  },
  SUBMIT_FAILED: {
    title: "Could not start import",
    description: "The import request could not be submitted.",
    action: "Check your network connection and retry.",
    retryable: true,
  },
  CANCEL_FAILED: {
    title: "Cancellation failed",
    description: "The cancellation request could not be sent.",
    action: "The import may still be running. Refresh the page if needed.",
    retryable: true,
  },
  MISSING_PREVIEW_URL: {
    title: "Preview unavailable",
    description: "The import completed but the preview URL is missing.",
    action: "Retry to regenerate the preview.",
    retryable: true,
  },
};

/**
 * Returns the user-facing error message for a given error code.
 * Falls back to STAGE_FAILED for unknown codes.
 */
export function getPasteErrorMessage(code: string): PasteErrorMessage {
  const entry = PASTE_ERROR_CATALOG[code as PasteErrorCode];
  return entry ?? PASTE_ERROR_CATALOG.STAGE_FAILED;
}

/**
 * Formats a template string by replacing {key} placeholders.
 * Used for TRANSFORM_PARTIAL (N, total, types) and CODEGEN_PARTIAL (N, total).
 */
export function formatErrorDescription(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}
