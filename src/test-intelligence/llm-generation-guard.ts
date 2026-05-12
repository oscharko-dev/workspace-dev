import {
  type LlmGenerationRequest,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { sanitizeErrorMessage } from "../error-sanitization.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

const DEFAULT_LOCAL_WALL_CLOCK_MS = 300_000;
const MAX_MESSAGE_LENGTH = 240;

export const generateWithLocalWallClockGuard = async (input: {
  readonly client: LlmGatewayClient;
  readonly request: LlmGenerationRequest;
  readonly operationLabel: string;
  readonly defaultWallClockMs?: number;
}): Promise<LlmGenerationResult> => {
  const watchdogMs = Math.max(
    1,
    input.request.maxWallClockMs ??
      input.defaultWallClockMs ??
      DEFAULT_LOCAL_WALL_CLOCK_MS,
  );
  const timeoutController = new AbortController();
  const upstreamSignal = input.request.abortSignal;
  const combinedSignal =
    upstreamSignal === undefined
      ? timeoutController.signal
      : AbortSignal.any([upstreamSignal, timeoutController.signal]);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onUpstreamAbort: (() => void) | undefined;
  const guardPromise = new Promise<LlmGenerationResult>((resolve) => {
    const clearWatchdog = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    };
    timeout = setTimeout(() => {
      timeoutController.abort(`${input.operationLabel}-watchdog-timeout`);
      resolve({
        outcome: "error",
        errorClass: "timeout",
        message: sanitizeShortMessage(
          `${input.operationLabel} timed out after ${watchdogMs}ms`,
        ),
        retryable: false,
        attempt: 0,
      });
    }, watchdogMs);
    onUpstreamAbort = () => {
      clearWatchdog();
      resolve({
        outcome: "error",
        errorClass: "canceled",
        message: sanitizeShortMessage(`${input.operationLabel} canceled by caller`),
        retryable: false,
        attempt: 0,
      });
    };
    if (upstreamSignal?.aborted) {
      onUpstreamAbort();
      return;
    }
    upstreamSignal?.addEventListener("abort", onUpstreamAbort, { once: true });
  });

  try {
    return await Promise.race([
      input.client.generate({
        ...input.request,
        abortSignal: combinedSignal,
      }),
      guardPromise,
    ]);
  } catch (error) {
    return {
      outcome: "error",
      errorClass: "transport",
      message: sanitizeShortMessage(
        sanitizeErrorMessage({
          error,
          fallback: `${input.operationLabel} gateway request failed`,
        }),
      ),
      retryable: false,
      attempt: 0,
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (onUpstreamAbort !== undefined) {
      upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
    }
  }
};

const sanitizeShortMessage = (value: string): string =>
  value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}...`;
