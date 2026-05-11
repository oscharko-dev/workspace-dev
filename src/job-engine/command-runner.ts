import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type {
  CommandExecutionInput,
  CommandOutputCaptureOptions,
  CommandOutputMetadata,
  CommandResult
} from "./types.js";

const DEFAULT_COMMAND_OUTPUT_MAX_BYTES = 1_048_576;
const PROCESS_TERMINATION_GRACE_MS = 3_000;
const CMD_OUTPUT_DIR_NAME = path.join(".stage-store", "cmd-output");

interface OutputBufferState {
  readonly streamName: "stdout" | "stderr";
  readonly maxBytes: number;
  readonly decoder: StringDecoder;
  readonly redactions: string[];
  readonly maxRedactionLength: number;
  readonly sanitize: (value: string) => string;
  readonly artifactPath?: string;
  pendingRaw: string;
  retained: string;
  observedBytes: number;
  retainedBytes: number;
  truncated: boolean;
  artifactWriteFailed: boolean;
  artifactWriteChain: Promise<void>;
}

const toSafeFileSegment = (value: string): string => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "command";
};

const sliceByUtf8Bytes = ({
  value,
  maxBytes
}: {
  value: string;
  maxBytes: number;
}): string => {
  if (maxBytes <= 0 || value.length === 0) {
    return "";
  }

  let totalBytes = 0;
  let endIndex = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (totalBytes + characterBytes > maxBytes) {
      break;
    }
    totalBytes += characterBytes;
    endIndex += character.length;
  }

  return value.slice(0, endIndex);
};

export const redactValue = ({ value, secret }: { value: string; secret?: string }): string => {
  if (!secret || !secret.trim()) {
    return value;
  }
  return value.split(secret).join("[REDACTED]");
};

const createSanitizer = ({ redactions }: { redactions: string[] }): ((value: string) => string) => {
  return (value: string): string => {
    return redactions.reduce((accumulator, secret) => redactValue({ value: accumulator, secret }), value);
  };
};

const queueArtifactWrite = ({
  state,
  content,
  overwrite = false
}: {
  state: OutputBufferState;
  content: string;
  overwrite?: boolean;
}): void => {
  if (!state.artifactPath || content.length === 0) {
    return;
  }

  state.artifactWriteChain = state.artifactWriteChain.then(async () => {
    if (state.artifactWriteFailed) {
      return;
    }

    try {
      await mkdir(path.dirname(state.artifactPath as string), { recursive: true });
      if (overwrite) {
        await writeFile(state.artifactPath as string, content, "utf8");
        return;
      }
      await appendFile(state.artifactPath as string, content, "utf8");
    } catch {
      state.artifactWriteFailed = true;
    }
  });
};

const appendSanitizedText = ({
  state,
  text
}: {
  state: OutputBufferState;
  text: string;
}): void => {
  if (text.length === 0) {
    return;
  }

  const textBytes = Buffer.byteLength(text);
  state.observedBytes += textBytes;

  if (state.truncated) {
    queueArtifactWrite({ state, content: text });
    return;
  }

  const availableBytes = state.maxBytes - state.retainedBytes;
  if (textBytes <= availableBytes) {
    state.retained += text;
    state.retainedBytes += textBytes;
    return;
  }

  const retainedBefore = state.retained;
  const retainedPrefix = sliceByUtf8Bytes({ value: text, maxBytes: Math.max(0, availableBytes) });
  state.retained += retainedPrefix;
  state.retainedBytes = Buffer.byteLength(state.retained);
  state.truncated = true;

  queueArtifactWrite({
    state,
    content: `${retainedBefore}${text}`,
    overwrite: true
  });
};

const consumeDecodedText = ({
  state,
  text,
  flush = false
}: {
  state: OutputBufferState;
  text: string;
  flush?: boolean;
}): void => {
  let sanitized = "";

  const findMatchedSecret = (): string | undefined => {
    for (const secret of state.redactions) {
      if (state.pendingRaw.endsWith(secret)) {
        return secret;
      }
    }
    return undefined;
  };

  for (const character of text) {
    state.pendingRaw += character;

    const matchedSecret = findMatchedSecret();
    if (matchedSecret) {
      const safePrefix = state.pendingRaw.slice(0, -matchedSecret.length);
      if (safePrefix.length > 0) {
        sanitized += safePrefix;
      }
      sanitized += "[REDACTED]";
      state.pendingRaw = "";
      continue;
    }

    while (!flush && state.pendingRaw.length > state.maxRedactionLength) {
      sanitized += state.pendingRaw[0] ?? "";
      state.pendingRaw = state.pendingRaw.slice(1);
    }
  }

  if (flush && state.pendingRaw.length > 0) {
    sanitized += state.sanitize(state.pendingRaw);
    state.pendingRaw = "";
  }

  appendSanitizedText({ state, text: sanitized });
};

const flushOutputState = ({ state }: { state: OutputBufferState }): void => {
  consumeDecodedText({
    state,
    text: state.decoder.end(),
    flush: true
  });
};

const toOutputMetadata = ({ state }: { state: OutputBufferState }): CommandOutputMetadata => {
  return {
    observedBytes: state.observedBytes,
    retainedBytes: state.retainedBytes,
    truncated: state.truncated,
    ...(state.truncated && !state.artifactWriteFailed && state.artifactPath ? { artifactPath: state.artifactPath } : {})
  };
};

const toEmptyOutputMetadata = (): CommandOutputMetadata => {
  return {
    observedBytes: 0,
    retainedBytes: 0,
    truncated: false
  };
};

const toTruncationNotice = ({
  streamName,
  metadata
}: {
  streamName: "stdout" | "stderr";
  metadata: CommandOutputMetadata;
}): string | undefined => {
  if (!metadata.truncated) {
    return undefined;
  }

  if (metadata.artifactPath) {
    return `${streamName} truncated after retaining ${metadata.retainedBytes} of ${metadata.observedBytes} bytes; full output stored at ${metadata.artifactPath}`;
  }

  return `${streamName} truncated after retaining ${metadata.retainedBytes} of ${metadata.observedBytes} bytes; full output artifact capture was unavailable`;
};

const createOutputBufferState = ({
  streamName,
  redactions,
  maxBytes,
  outputCapture
}: {
  streamName: "stdout" | "stderr";
  redactions: string[];
  maxBytes: number;
  outputCapture?: CommandOutputCaptureOptions;
}): OutputBufferState => {
  const orderedRedactions = [...redactions].sort((left, right) => right.length - left.length);
  const maxRedactionLength = Math.max(0, ...orderedRedactions.map((value) => value.length));
  const artifactPath = outputCapture
    ? path.join(
        outputCapture.jobDir,
        CMD_OUTPUT_DIR_NAME,
        `${toSafeFileSegment(outputCapture.key)}.${streamName}.log`
      )
    : undefined;

  return {
    streamName,
    maxBytes,
    decoder: new StringDecoder("utf8"),
    redactions: orderedRedactions,
    maxRedactionLength,
    sanitize: createSanitizer({ redactions: orderedRedactions }),
    pendingRaw: "",
    retained: "",
    observedBytes: 0,
    retainedBytes: 0,
    truncated: false,
    artifactWriteFailed: false,
    artifactWriteChain: Promise.resolve(),
    ...(artifactPath ? { artifactPath } : {})
  };
};

const terminatePosixProcessTree = ({
  pid,
  signal
}: {
  pid: number;
  signal: NodeJS.Signals;
}): void => {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // ignore best-effort termination failures
    }
  }
};

const runWindowsTaskkill = async ({
  pid,
  force
}: {
  pid: number;
  force: boolean;
}): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const taskkill = spawn("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
      stdio: "ignore",
      windowsHide: true
    });

    taskkill.once("error", () => {
      resolve(false);
    });

    taskkill.once("close", () => {
      resolve(true);
    });
  });
};

const terminateProcessTree = async ({
  pid,
  force
}: {
  pid: number | undefined;
  force: boolean;
}): Promise<void> => {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    const taskkillSucceeded = await runWindowsTaskkill({ pid, force });
    if (!taskkillSucceeded) {
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        // ignore best-effort termination failures
      }
    }
    return;
  }

  terminatePosixProcessTree({
    pid,
    signal: force ? "SIGKILL" : "SIGTERM"
  });
};

export const runCommand = async ({
  cwd,
  command,
  args,
  env,
  redactions,
  timeoutMs,
  abortSignal,
  outputCapture
}: CommandExecutionInput): Promise<CommandResult> => {
  const safeRedactions = (redactions ?? []).filter((entry) => entry.trim().length > 0);
  const resolvedTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? Math.max(1_000, Math.trunc(timeoutMs)) : 15 * 60_000;
  const resolvedStdoutMaxBytes = outputCapture?.stdoutMaxBytes ?? DEFAULT_COMMAND_OUTPUT_MAX_BYTES;
  const resolvedStderrMaxBytes = outputCapture?.stderrMaxBytes ?? DEFAULT_COMMAND_OUTPUT_MAX_BYTES;
  const startedAt = Date.now();

  if (abortSignal?.aborted) {
    return {
      success: false,
      code: null,
      stdout: "",
      stderr: "Command canceled before start.",
      combined: "Command canceled before start.",
      canceled: true,
      timedOut: false,
      durationMs: 0,
      stdoutMetadata: toEmptyOutputMetadata(),
      stderrMetadata: toEmptyOutputMetadata()
    };
  }

  return await new Promise<CommandResult>((resolve) => {
    const stdoutState = createOutputBufferState({
      streamName: "stdout",
      redactions: safeRedactions,
      maxBytes: resolvedStdoutMaxBytes,
      ...(outputCapture ? { outputCapture } : {})
    });
    const stderrState = createOutputBufferState({
      streamName: "stderr",
      redactions: safeRedactions,
      maxBytes: resolvedStderrMaxBytes,
      ...(outputCapture ? { outputCapture } : {})
    });
    let settled = false;
    let timeoutTriggered = false;
    let canceledTriggered = false;
    let terminationRequested = false;
    let forceKillHandle: NodeJS.Timeout | undefined;

    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
        NO_COLOR: process.env.NO_COLOR ?? "1",
        TERM: process.env.TERM ?? "dumb",
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const requestTermination = (): void => {
      if (settled || terminationRequested) {
        return;
      }

      terminationRequested = true;
      void terminateProcessTree({
        pid: child.pid,
        force: false
      });
      forceKillHandle = setTimeout(() => {
        void terminateProcessTree({
          pid: child.pid,
          force: true
        });
      }, PROCESS_TERMINATION_GRACE_MS);
    };

    const finalize = async ({
      code,
      errorMessage
    }: {
      code: number | null;
      errorMessage?: string;
    }): Promise<void> => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      abortSignal?.removeEventListener("abort", onAbort);

      flushOutputState({ state: stdoutState });
      flushOutputState({ state: stderrState });
      await Promise.all([stdoutState.artifactWriteChain, stderrState.artifactWriteChain]);

      const stdout = stdoutState.retained;
      const stderr = errorMessage ?? stderrState.retained;
      const stdoutMetadata = toOutputMetadata({ state: stdoutState });
      const stderrMetadata =
        errorMessage === undefined
          ? toOutputMetadata({ state: stderrState })
          : {
              ...toEmptyOutputMetadata(),
              observedBytes: Buffer.byteLength(errorMessage),
              retainedBytes: Buffer.byteLength(errorMessage)
            };
      const durationMs = Date.now() - startedAt;
      const timeoutMessage = timeoutTriggered
        ? `Command timed out after ${resolvedTimeoutMs}ms: ${command} ${args.join(" ")}`
        : undefined;
      const canceledMessage = canceledTriggered ? `Command canceled: ${command} ${args.join(" ")}` : undefined;
      const combined = [stdout, stderr].filter((part) => part.trim().length > 0).join("\n").trim();
      const mergedCombined = [
        combined,
        toTruncationNotice({ streamName: "stdout", metadata: stdoutMetadata }),
        toTruncationNotice({ streamName: "stderr", metadata: stderrMetadata }),
        timeoutMessage,
        canceledMessage
      ]
        .filter((entry) => entry && entry.length > 0)
        .join("\n");

      resolve({
        success: code === 0 && !timeoutTriggered && !canceledTriggered && errorMessage === undefined,
        code,
        stdout,
        stderr,
        combined: mergedCombined,
        timedOut: timeoutTriggered,
        canceled: canceledTriggered,
        durationMs,
        stdoutMetadata,
        stderrMetadata
      });
    };

    const timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      requestTermination();
    }, resolvedTimeoutMs);

    const onAbort = (): void => {
      if (settled) {
        return;
      }
      canceledTriggered = true;
      requestTermination();
    };

    abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      consumeDecodedText({
        state: stdoutState,
        text: stdoutState.decoder.write(buffer)
      });
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      consumeDecodedText({
        state: stderrState,
        text: stderrState.decoder.write(buffer)
      });
    });

    child.on("close", (code) => {
      void finalize({ code });
    });

    child.on("error", (error) => {
      void finalize({
        code: null,
        errorMessage: error.message
      });
    });
  });
};
