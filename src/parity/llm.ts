import type { DesignIR, GeneratedFile, ScreenIR } from "./types.js";

export type LlmErrorCode = "E_LLM_RESPONSES_INCOMPLETE" | "E_LLM_PROVIDER_HTTP" | "E_LLM_TRANSPORT";

interface LlmClientErrorInit {
  code: LlmErrorCode;
  message: string;
  endpoint?: string;
  status?: number;
  cause?: unknown;
}

export class LlmClientError extends Error {
  public readonly code: LlmErrorCode;
  public readonly endpoint?: string;
  public readonly status?: number;

  constructor({ code, message, endpoint, status, cause }: LlmClientErrorInit) {
    super(message, { cause });
    this.name = "LlmClientError";
    this.code = code;
    if (endpoint !== undefined) {
      this.endpoint = endpoint;
    }
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export const isLlmClientError = (value: unknown): value is LlmClientError => {
  return value instanceof LlmClientError;
};

/**
 * Runtime stub for workspace-dev deterministic mode.
 * Any attempt to execute LLM enhancement paths is rejected explicitly.
 */
export class LlmClient {
  generateTheme(ir: DesignIR): Promise<GeneratedFile> {
    void ir;
    return Promise.reject(
      new LlmClientError({
        code: "E_LLM_TRANSPORT",
        message: "LLM is not available in workspace-dev deterministic mode."
      })
    );
  }

  generateScreen(
    screen: ScreenIR,
    tokens: DesignIR["tokens"],
    expectedPath?: string,
    hints?: {
      inputCount?: number;
      selectCount?: number;
      accordionCount?: number;
      repairReason?: string;
      requiredLabelSet?: string[];
    }
  ): Promise<GeneratedFile> {
    void screen;
    void tokens;
    void expectedPath;
    void hints;
    return Promise.reject(
      new LlmClientError({
        code: "E_LLM_TRANSPORT",
        message: "LLM is not available in workspace-dev deterministic mode."
      })
    );
  }

  generateScreenFromBaseline(input: {
    screen: ScreenIR;
    tokens: DesignIR["tokens"];
    expectedPath?: string;
    baselineSource: string;
    requiredLiteralTexts?: string[];
    forbiddenPlaceholderPolicy?: string;
    hints?: Record<string, unknown>;
  }): Promise<GeneratedFile> {
    void input;
    return Promise.reject(
      new LlmClientError({
        code: "E_LLM_TRANSPORT",
        message: "LLM is not available in workspace-dev deterministic mode."
      })
    );
  }
}
