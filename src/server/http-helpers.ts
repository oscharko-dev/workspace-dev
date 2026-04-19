import type { IncomingMessage, ServerResponse } from "node:http";
import { StringDecoder } from "node:string_decoder";
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  resolveStrictTransportSecurity,
  MAX_REQUEST_BODY_BYTES,
} from "./constants.js";

function appendRequestIdToErrorPayload({
  response,
  payload,
}: {
  response: ServerResponse;
  payload: unknown;
}): unknown {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return payload;
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (typeof payloadRecord.error !== "string" || "requestId" in payloadRecord) {
    return payload;
  }

  const requestId = response.getHeader("x-request-id");
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return payload;
  }

  return {
    ...payloadRecord,
    requestId,
  };
}

function applySecurityHeaders({
  response,
  allowFrameEmbedding,
  cacheControl,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  allowFrameEmbedding?: boolean;
  cacheControl?: string;
  contentSecurityPolicy?: string;
}): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cache-control", cacheControl ?? "no-store");
  const strictTransportSecurity = resolveStrictTransportSecurity();
  if (strictTransportSecurity !== undefined) {
    response.setHeader(
      "strict-transport-security",
      strictTransportSecurity,
    );
  } else {
    response.removeHeader("strict-transport-security");
  }
  if (!allowFrameEmbedding) {
    response.setHeader("x-frame-options", "SAMEORIGIN");
    response.setHeader(
      "content-security-policy",
      contentSecurityPolicy ?? DEFAULT_CONTENT_SECURITY_POLICY,
    );
    return;
  }

  response.removeHeader("x-frame-options");
  response.removeHeader("content-security-policy");
}

export function sendJson({
  response,
  statusCode,
  payload,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  payload: unknown;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    `${JSON.stringify(appendRequestIdToErrorPayload({ response, payload }))}\n`,
  );
}

export function sendText({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl,
  allowFrameEmbedding,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: string;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding }),
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", contentType);
  response.end(payload);
}

export function sendBuffer({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl,
  allowFrameEmbedding,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: Buffer;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding }),
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", contentType);
  response.end(payload);
}

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "OVERSIZE"; error: string; maxBytes: number }
  | { ok: false; reason: "INVALID_JSON"; error: string };

type JsonContainerFrame =
  | {
      kind: "object";
      value: Record<string, unknown>;
      state:
        | "expectingKeyOrEnd"
        | "expectingKey"
        | "expectingColon"
        | "expectingValue"
        | "expectingCommaOrEnd";
      currentKey?: string;
    }
  | {
      kind: "array";
      value: unknown[];
      state: "expectingValueOrEnd" | "expectingValue" | "expectingCommaOrEnd";
    };

const JSON_NUMBER_PATTERN =
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isJsonWhitespace(character: string): boolean {
  return (
    character === " " ||
    character === "\n" ||
    character === "\r" ||
    character === "\t"
  );
}

function normalizeRequestChunk(
  chunk: string | Buffer | Uint8Array | undefined | null,
): Buffer {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk === undefined || chunk === null) {
    return Buffer.from("", "utf8");
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

class StreamingJsonParser {
  private readonly stack: JsonContainerFrame[] = [];
  private mode: "normal" | "string" | "number" | "literal" = "normal";
  private rootComplete = false;
  private rootValue: unknown;
  private hasMeaningfulInput = false;
  private stringIsObjectKey = false;
  private readonly stringSegments: string[] = [];
  private stringEscapePending = false;
  private unicodeEscapePending = false;
  private unicodeEscapeDigits = "";
  private numberBuffer = "";
  private literalTarget = "";
  private literalIndex = 0;

  write(input: string): void {
    let index = 0;
    while (index < input.length) {
      if (this.mode === "string") {
        index = this.consumeString(input, index);
        continue;
      }
      if (this.mode === "number") {
        index = this.consumeNumber(input, index);
        continue;
      }
      if (this.mode === "literal") {
        index = this.consumeLiteral(input, index);
        continue;
      }
      index = this.consumeNormal(input, index);
    }
  }

  finish(): unknown {
    if (this.mode === "string") {
      throw new Error("Unexpected end of JSON input.");
    }
    if (this.mode === "number") {
      this.finalizeNumber();
    } else if (this.mode === "literal") {
      if (this.literalIndex !== this.literalTarget.length) {
        throw new Error("Unexpected end of JSON input.");
      }
      this.finalizeLiteral();
    }
    if (this.stack.length > 0) {
      throw new Error("Unexpected end of JSON input.");
    }
    if (!this.rootComplete) {
      if (!this.hasMeaningfulInput) {
        return undefined;
      }
      throw new Error("Unexpected end of JSON input.");
    }
    return this.rootValue;
  }

  private consumeNormal(input: string, index: number): number {
    const character = input.charAt(index);
    if (isJsonWhitespace(character)) {
      return index + 1;
    }

    this.hasMeaningfulInput = true;
    const frame = this.stack[this.stack.length - 1];

    if (frame?.kind === "object") {
      switch (frame.state) {
        case "expectingKeyOrEnd":
          if (character === "}") {
            this.stack.pop();
            this.pushValue(frame.value);
            return index + 1;
          }
          if (character === "\"") {
            this.startString(true);
            return index + 1;
          }
          throw new Error("Invalid JSON payload.");
        case "expectingKey":
          if (character === "\"") {
            this.startString(true);
            return index + 1;
          }
          throw new Error("Invalid JSON payload.");
        case "expectingColon":
          if (character === ":") {
            frame.state = "expectingValue";
            return index + 1;
          }
          throw new Error("Invalid JSON payload.");
        case "expectingValue":
          return this.consumeValueStart(character, index);
        case "expectingCommaOrEnd":
          if (character === ",") {
            frame.state = "expectingKey";
            return index + 1;
          }
          if (character === "}") {
            this.stack.pop();
            this.pushValue(frame.value);
            return index + 1;
          }
          throw new Error("Invalid JSON payload.");
      }
    }

    if (frame?.kind === "array") {
      switch (frame.state) {
        case "expectingValueOrEnd":
          if (character === "]") {
            this.stack.pop();
            this.pushValue(frame.value);
            return index + 1;
          }
          return this.consumeValueStart(character, index);
        case "expectingValue":
          return this.consumeValueStart(character, index);
        case "expectingCommaOrEnd":
          if (character === ",") {
            frame.state = "expectingValue";
            return index + 1;
          }
          if (character === "]") {
            this.stack.pop();
            this.pushValue(frame.value);
            return index + 1;
          }
          throw new Error("Invalid JSON payload.");
      }
    }

    if (this.rootComplete) {
      throw new Error("Invalid JSON payload.");
    }

    return this.consumeValueStart(character, index);
  }

  private consumeValueStart(character: string, index: number): number {
    if (character === "{") {
      this.stack.push({
        kind: "object",
        value: {},
        state: "expectingKeyOrEnd",
      });
      return index + 1;
    }
    if (character === "[") {
      this.stack.push({
        kind: "array",
        value: [],
        state: "expectingValueOrEnd",
      });
      return index + 1;
    }
    if (character === "\"") {
      this.startString(false);
      return index + 1;
    }
    if (character === "t") {
      this.startLiteral("true");
      return index + 1;
    }
    if (character === "f") {
      this.startLiteral("false");
      return index + 1;
    }
    if (character === "n") {
      this.startLiteral("null");
      return index + 1;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      this.mode = "number";
      this.numberBuffer = character;
      return index + 1;
    }
    throw new Error("Invalid JSON payload.");
  }

  private startString(isObjectKey: boolean): void {
    this.mode = "string";
    this.stringIsObjectKey = isObjectKey;
    this.stringSegments.length = 0;
    this.stringEscapePending = false;
    this.unicodeEscapePending = false;
    this.unicodeEscapeDigits = "";
  }

  private consumeString(input: string, index: number): number {
    let cursor = index;
    while (cursor < input.length) {
      if (this.unicodeEscapePending) {
        const character = input.charAt(cursor);
        if (!/[0-9a-fA-F]/.test(character)) {
          throw new Error("Invalid JSON payload.");
        }
        this.unicodeEscapeDigits += character;
        cursor += 1;
        if (this.unicodeEscapeDigits.length === 4) {
          this.stringSegments.push(
            String.fromCharCode(
              Number.parseInt(this.unicodeEscapeDigits, 16),
            ),
          );
          this.unicodeEscapePending = false;
          this.unicodeEscapeDigits = "";
        }
        continue;
      }

      if (this.stringEscapePending) {
        const character = input.charAt(cursor);
        cursor += 1;
        switch (character) {
          case "\"":
          case "\\":
          case "/":
            this.stringSegments.push(character);
            break;
          case "b":
            this.stringSegments.push("\b");
            break;
          case "f":
            this.stringSegments.push("\f");
            break;
          case "n":
            this.stringSegments.push("\n");
            break;
          case "r":
            this.stringSegments.push("\r");
            break;
          case "t":
            this.stringSegments.push("\t");
            break;
          case "u":
            this.unicodeEscapePending = true;
            this.unicodeEscapeDigits = "";
            break;
          default:
            throw new Error("Invalid JSON payload.");
        }
        this.stringEscapePending = false;
        continue;
      }

      const segmentStart = cursor;
      while (cursor < input.length) {
        const codePoint = input.charCodeAt(cursor);
        if (codePoint === 0x22 || codePoint === 0x5c || codePoint < 0x20) {
          break;
        }
        cursor += 1;
      }

      if (cursor > segmentStart) {
        this.stringSegments.push(input.slice(segmentStart, cursor));
      }
      if (cursor >= input.length) {
        return cursor;
      }

      const character = input.charAt(cursor);
      if (character === "\"") {
        const value = this.stringSegments.join("");
        this.mode = "normal";
        this.stringSegments.length = 0;
        this.stringEscapePending = false;
        this.unicodeEscapePending = false;
        this.unicodeEscapeDigits = "";
        if (this.stringIsObjectKey) {
          const frame = this.stack[this.stack.length - 1];
          if (frame?.kind !== "object") {
            throw new Error("Invalid JSON payload.");
          }
          frame.currentKey = value;
          frame.state = "expectingColon";
        } else {
          this.pushValue(value);
        }
        return cursor + 1;
      }
      if (character === "\\") {
        this.stringEscapePending = true;
        cursor += 1;
        continue;
      }
      throw new Error("Invalid JSON payload.");
    }

    return cursor;
  }

  private consumeNumber(input: string, index: number): number {
    let cursor = index;
    while (cursor < input.length) {
      const character = input.charAt(cursor);
      if (
        (character >= "0" && character <= "9") ||
        character === "-" ||
        character === "+" ||
        character === "." ||
        character === "e" ||
        character === "E"
      ) {
        this.numberBuffer += character;
        cursor += 1;
        continue;
      }
      this.finalizeNumber();
      return cursor;
    }
    return cursor;
  }

  private finalizeNumber(): void {
    const value = this.numberBuffer;
    if (!JSON_NUMBER_PATTERN.test(value)) {
      throw new Error("Invalid JSON payload.");
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid JSON payload.");
    }
    this.mode = "normal";
    this.numberBuffer = "";
    this.pushValue(parsed);
  }

  private startLiteral(target: "true" | "false" | "null"): void {
    this.mode = "literal";
    this.literalTarget = target;
    this.literalIndex = 1;
  }

  private consumeLiteral(input: string, index: number): number {
    let cursor = index;
    while (
      cursor < input.length &&
      this.literalIndex < this.literalTarget.length
    ) {
      if (
        input.charAt(cursor) !== this.literalTarget.charAt(this.literalIndex)
      ) {
        throw new Error("Invalid JSON payload.");
      }
      this.literalIndex += 1;
      cursor += 1;
    }
    if (this.literalIndex === this.literalTarget.length) {
      this.finalizeLiteral();
    }
    return cursor;
  }

  private finalizeLiteral(): void {
    const literalValue =
      this.literalTarget === "true"
        ? true
        : this.literalTarget === "false"
          ? false
          : null;
    this.mode = "normal";
    this.literalTarget = "";
    this.literalIndex = 0;
    this.pushValue(literalValue);
  }

  private pushValue(value: unknown): void {
    const frame = this.stack[this.stack.length - 1];
    if (frame === undefined) {
      if (this.rootComplete) {
        throw new Error("Invalid JSON payload.");
      }
      this.rootValue = value;
      this.rootComplete = true;
      return;
    }

    if (frame.kind === "object") {
      if (
        frame.state !== "expectingValue" ||
        frame.currentKey === undefined
      ) {
        throw new Error("Invalid JSON payload.");
      }
      Object.defineProperty(frame.value, frame.currentKey, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      delete frame.currentKey;
      frame.state = "expectingCommaOrEnd";
      return;
    }

    if (
      frame.state !== "expectingValueOrEnd" &&
      frame.state !== "expectingValue"
    ) {
      throw new Error("Invalid JSON payload.");
    }
    frame.value.push(value);
    frame.state = "expectingCommaOrEnd";
  }
}

export async function readJsonBody(
  request: IncomingMessage,
  options?: { maxBytes?: number },
): Promise<ReadJsonBodyResult> {
  const maxBytes = options?.maxBytes ?? MAX_REQUEST_BODY_BYTES;
  let body = "";
  let bodyBytes = 0;

  for await (const chunk of request) {
    const normalizedChunkBuffer = normalizeRequestChunk(chunk as string | Buffer | Uint8Array | undefined | null);
    bodyBytes += normalizedChunkBuffer.byteLength;
    if (bodyBytes > maxBytes) {
      return {
        ok: false,
        reason: "OVERSIZE",
        error: `Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB size limit.`,
        maxBytes,
      };
    }
    const normalizedChunk = normalizedChunkBuffer.toString("utf8");
    body += normalizedChunk;
  }

  if (body.trim().length === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return {
      ok: false,
      reason: "INVALID_JSON",
      error: "Invalid JSON payload.",
    };
  }
}

export async function readStreamingJsonBody(
  request: IncomingMessage,
  options?: { maxBytes?: number },
): Promise<ReadJsonBodyResult> {
  const maxBytes = options?.maxBytes ?? MAX_REQUEST_BODY_BYTES;
  const parser = new StreamingJsonParser();
  const decoder = new StringDecoder("utf8");
  let bodyBytes = 0;

  try {
    for await (const chunk of request) {
    const normalizedChunkBuffer = normalizeRequestChunk(chunk as string | Buffer | Uint8Array | undefined | null);
      bodyBytes += normalizedChunkBuffer.byteLength;
      if (bodyBytes > maxBytes) {
        return {
          ok: false,
          reason: "OVERSIZE",
          error: `Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB size limit.`,
          maxBytes,
        };
      }
      parser.write(decoder.write(normalizedChunkBuffer));
    }

    parser.write(decoder.end());
    return { ok: true, value: parser.finish() };
  } catch {
    return {
      ok: false,
      reason: "INVALID_JSON",
      error: "Invalid JSON payload.",
    };
  }
}
