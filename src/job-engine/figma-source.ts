import { createPipelineError, getErrorMessage } from "./errors.js";
import type { FigmaFileResponse } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseFigmaStatus = (status: number): { code: string; retryable: boolean } => {
  if (status === 401 || status === 403) {
    return { code: "E_FIGMA_AUTH", retryable: false };
  }
  if (status === 404) {
    return { code: "E_FIGMA_NOT_FOUND", retryable: false };
  }
  if (status === 429) {
    return { code: "E_FIGMA_RATE_LIMIT", retryable: true };
  }
  if (status >= 500) {
    return { code: "E_FIGMA_UPSTREAM", retryable: true };
  }
  return { code: "E_FIGMA_HTTP", retryable: false };
};

const waitFor = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const fetchWithTimeout = async ({
  fetchImpl,
  url,
  headers,
  timeoutMs
}: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<Response> => {
  return await fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("timeout");
};

const toRetryDelay = ({ attempt }: { attempt: number }): number => {
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

export const fetchFigmaFile = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
}): Promise<FigmaFileResponse> => {
  const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?geometry=paths`;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout({
        fetchImpl,
        url,
        timeoutMs,
        headers: {
          "X-Figma-Token": accessToken,
          Accept: "application/json"
        }
      });

      if (response.status === 403) {
        const bodyText = (await response.clone().text()).toLowerCase();
        if (bodyText.includes("invalid token")) {
          onLog("Figma PAT rejected, retrying request with Bearer authorization header.");
          response = await fetchWithTimeout({
            fetchImpl,
            url,
            timeoutMs,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          });
        }
      }
    } catch (error) {
      const shouldRetry = attempt < maxRetries;
      if (shouldRetry) {
        const delayMs = toRetryDelay({ attempt });
        onLog(
          `Figma request failed (${isTimeoutError(error) ? "timeout" : "network"}), retrying in ${delayMs}ms (${attempt}/${maxRetries}).`
        );
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: isTimeoutError(error) ? "E_FIGMA_TIMEOUT" : "E_FIGMA_NETWORK",
        stage: "figma.source",
        message: `Figma REST request failed: ${getErrorMessage(error)}`,
        cause: error
      });
    }

    if (!response.ok) {
      const failureBody = (await response.text()).slice(0, 500);
      const status = parseFigmaStatus(response.status);
      if (status.retryable && attempt < maxRetries) {
        const delayMs = toRetryDelay({ attempt });
        onLog(`Figma API responded ${response.status}, retrying in ${delayMs}ms (${attempt}/${maxRetries}).`);
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: status.code,
        stage: "figma.source",
        message: `Figma API error (${response.status}): ${failureBody || "no response body"}`
      });
    }

    try {
      const parsed = await response.json();
      if (!isRecord(parsed)) {
        throw new Error("Response is not an object.");
      }
      return parsed as FigmaFileResponse;
    } catch (error) {
      throw createPipelineError({
        code: "E_FIGMA_PARSE",
        stage: "figma.source",
        message: `Could not parse Figma API response: ${getErrorMessage(error)}`,
        cause: error
      });
    }
  }

  throw createPipelineError({
    code: "E_FIGMA_RETRY_EXHAUSTED",
    stage: "figma.source",
    message: "Figma REST retries exhausted."
  });
};
