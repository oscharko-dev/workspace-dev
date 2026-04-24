import {
  WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV,
  WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV,
  WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV,
} from "./constants.js";
import type { WorkspaceTestSpaceLlmClient } from "./service.js";

const LEGACY_WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV =
  "WORKSPACE_TEST_SPACE_LLM_ENDPOINT_URL";
const LEGACY_WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV =
  "WORKSPACE_TEST_SPACE_LLM_API_KEY";
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_LLM_RESPONSE_MAX_BYTES = 1_048_576;

function readTrimmedEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function normalizeWorkspaceTestSpaceModelEndpoint(endpointUrl: string): string {
  const url = new URL(endpointUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    url.pathname = pathname;
    return url.toString();
  }
  if (pathname.endsWith("/openai/v1")) {
    url.pathname = `${pathname}/chat/completions`;
    return url.toString();
  }

  url.pathname = `${pathname}/openai/v1/chat/completions`;
  return url.toString();
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractMessageContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    if (typeof part !== "object" || part === null) {
      continue;
    }
    const candidate = part as {
      text?: unknown;
      content?: unknown;
      type?: unknown;
    };
    if (typeof candidate.text === "string") {
      textParts.push(candidate.text);
      continue;
    }
    if (candidate.type === "text" && typeof candidate.content === "string") {
      textParts.push(candidate.content);
    }
  }

  const joined = textParts.join("");
  return joined.length > 0 ? joined : undefined;
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  timeoutError: Error,
): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(timeoutError);
      return;
    }
    const onAbort = (): void => {
      reject(timeoutError);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    while (true) {
      const result = await Promise.race([
        reader.read(),
        abortPromise,
      ]) as ReadableStreamReadResult<Uint8Array>;
      if (signal.aborted) {
        throw timeoutError;
      }
      const { done, value } = result;
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        throw new Error(
          `Test Space LLM endpoint returned more than ${maxBytes} bytes.`,
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    if (signal.aborted) {
      throw timeoutError;
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

function parseWorkspaceTestSpaceLlmResponse(responseBody: unknown): unknown {
  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "testCases" in responseBody &&
    "coverageFindings" in responseBody
  ) {
    return responseBody;
  }

  if (typeof responseBody !== "object" || responseBody === null) {
    return responseBody;
  }

  const choices = (responseBody as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return responseBody;
  }

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    return responseBody;
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return responseBody;
  }

  const content = extractMessageContentText(
    (message as { content?: unknown }).content,
  );
  if (content === undefined) {
    return responseBody;
  }

  return tryParseJson(content) ?? responseBody;
}

export function createWorkspaceTestSpaceLlmClientFromEnv({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_LLM_RESPONSE_MAX_BYTES,
}: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
} = {}): WorkspaceTestSpaceLlmClient | undefined {
  const endpointUrl = readTrimmedEnvValue(env, [
    WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV,
    LEGACY_WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV,
  ]);
  if (endpointUrl === undefined) {
    return undefined;
  }

  const chatCompletionsUrl = normalizeWorkspaceTestSpaceModelEndpoint(
    endpointUrl,
  );

  const configuredModelDeployment = readTrimmedEnvValue(env, [
    WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV,
  ]);
  const bearerToken = readTrimmedEnvValue(env, [
    WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV,
    LEGACY_WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV,
  ]);

  return {
    async generateStructuredOutput({
      modelDeployment,
      prompt,
      request,
      figmaSummary,
    }) {
      const controller = new AbortController();
      const requestTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
      const requestTimeoutError = new Error(
        `Test Space LLM request timed out after ${requestTimeoutMs}ms.`,
      );
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const fetchPromise = fetchImpl(chatCompletionsUrl, {
        // Use the Foundry/OpenAI chat-completions shape for compatibility.
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(bearerToken !== undefined
            ? { authorization: `Bearer ${bearerToken}` }
            : {}),
        },
        body: JSON.stringify({
          model: configuredModelDeployment ?? modelDeployment,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "Return strict JSON that validates against TestSpaceLlmOutputSchema with keys testCases and coverageFindings only.",
            },
            {
              role: "user",
              content: [
                prompt,
                "",
                "Request summary JSON:",
                JSON.stringify(request, null, 2),
                "",
                "Figma summary JSON:",
                JSON.stringify(figmaSummary, null, 2),
              ].join("\n"),
            },
          ],
        }),
      });

      const timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(requestTimeoutError);
        }, requestTimeoutMs);
      });
      void timeoutPromise.catch(() => {});

      try {
        const response = await Promise.race([fetchPromise, timeoutPromise]).catch(
          (error: unknown) => {
            if (controller.signal.aborted) {
              throw requestTimeoutError;
            }
            throw error;
          },
        );

        if (!response.ok) {
          throw new Error(
            `Test Space LLM endpoint responded with ${response.status}.`,
          );
        }

        const responseText = await readBoundedResponseText(
          response,
          maxResponseBytes,
          controller.signal,
          requestTimeoutError,
        );
        if (controller.signal.aborted) {
          throw requestTimeoutError;
        }
        const parsedResponse = tryParseJson(responseText);
        if (controller.signal.aborted) {
          throw requestTimeoutError;
        }
        if (parsedResponse === undefined) {
          throw new Error("Test Space LLM endpoint returned invalid JSON.");
        }

        return parseWorkspaceTestSpaceLlmResponse(parsedResponse);
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    },
  };
}
