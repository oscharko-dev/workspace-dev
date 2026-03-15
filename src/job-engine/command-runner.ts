import { spawn } from "node:child_process";
import type { CommandResult } from "./types.js";

export const redactValue = ({ value, secret }: { value: string; secret?: string }): string => {
  if (!secret || !secret.trim()) {
    return value;
  }
  return value.split(secret).join("[REDACTED]");
};

export const runCommand = async ({
  cwd,
  command,
  args,
  env,
  redactions,
  timeoutMs
}: {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactions?: string[];
  timeoutMs?: number;
}): Promise<CommandResult> => {
  const safeRedactions = (redactions ?? []).filter((entry) => entry.trim().length > 0);
  const resolvedTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? Math.max(1_000, Math.trunc(timeoutMs)) : 15 * 60_000;
  const startedAt = Date.now();

  return await new Promise<CommandResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timeoutTriggered = false;

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
        NO_COLOR: process.env.NO_COLOR ?? "1",
        TERM: process.env.TERM ?? "dumb",
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      child.kill("SIGKILL");
    }, resolvedTimeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const sanitizedStdout = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stdout);
      const sanitizedStderr = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stderr);
      const combined = [sanitizedStdout, sanitizedStderr].filter((part) => part.trim().length > 0).join("\n").trim();
      const durationMs = Date.now() - startedAt;
      const timeoutMessage = timeoutTriggered
        ? `Command timed out after ${resolvedTimeoutMs}ms: ${command} ${args.join(" ")}`
        : undefined;
      const mergedCombined = timeoutMessage ? [combined, timeoutMessage].filter((entry) => entry.length > 0).join("\n") : combined;

      resolve({
        success: code === 0 && !timeoutTriggered,
        code,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        combined: mergedCombined,
        timedOut: timeoutTriggered,
        durationMs
      });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;
      resolve({
        success: false,
        code: null,
        stdout: "",
        stderr: error.message,
        combined: error.message,
        timedOut: false,
        durationMs
      });
    });
  });
};
