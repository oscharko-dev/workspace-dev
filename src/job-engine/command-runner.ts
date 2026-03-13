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
  redactions
}: {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactions?: string[];
}): Promise<CommandResult> => {
  const safeRedactions = (redactions ?? []).filter((entry) => entry.trim().length > 0);

  return await new Promise<CommandResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

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

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const sanitizedStdout = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stdout);
      const sanitizedStderr = safeRedactions.reduce((acc, secret) => redactValue({ value: acc, secret }), stderr);
      const combined = [sanitizedStdout, sanitizedStderr].filter((part) => part.trim().length > 0).join("\n").trim();

      resolve({
        success: code === 0,
        code,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        combined
      });
    });

    child.on("error", (error) => {
      resolve({
        success: false,
        code: null,
        stdout: "",
        stderr: error.message,
        combined: error.message
      });
    });
  });
};
