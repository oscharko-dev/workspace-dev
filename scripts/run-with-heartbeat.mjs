#!/usr/bin/env node
import { spawn } from "node:child_process";

const signalExitCodes = new Map([
  ["SIGHUP", 129],
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);

const formatDuration = (durationMs) => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
};

const parseArgs = (argv) => {
  let label = "command";
  let intervalSeconds = 60;
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--") {
      return {
        label,
        intervalSeconds,
        command: argv[index + 1],
        args: argv.slice(index + 2),
      };
    }
    if (arg === "--label") {
      label = argv[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (arg === "--interval-seconds") {
      intervalSeconds = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }

  return { label, intervalSeconds, command: undefined, args: [] };
};

const quoteArg = (arg) => {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
    return arg;
  }
  return JSON.stringify(arg);
};

const main = async () => {
  const { label, intervalSeconds, command, args } = parseArgs(
    process.argv.slice(2),
  );

  if (!label.trim()) {
    throw new Error("--label must not be empty.");
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error("--interval-seconds must be a positive number.");
  }
  if (!command) {
    throw new Error(
      "Missing command. Use: run-with-heartbeat -- <command> [args...]",
    );
  }

  const startedAt = Date.now();
  const printableCommand = [command, ...args].map(quoteArg).join(" ");
  console.error(`[heartbeat] Starting ${label}: ${printableCommand}`);

  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  const heartbeat = setInterval(() => {
    console.error(
      `[heartbeat] ${label} still running after ${formatDuration(Date.now() - startedAt)}`,
    );
  }, intervalSeconds * 1000);

  const cleanup = () => {
    clearInterval(heartbeat);
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    process.off("SIGHUP", forwardSignal);
  };

  const forwardSignal = (signal) => {
    console.error(`[heartbeat] Received ${signal}; forwarding to ${label}.`);
    child.kill(signal);
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);
  process.on("SIGHUP", forwardSignal);

  child.once("error", (error) => {
    cleanup();
    console.error(`[heartbeat] Failed to start ${label}: ${error.message}`);
    process.exit(1);
  });

  child.once("close", (code, signal) => {
    cleanup();
    const duration = formatDuration(Date.now() - startedAt);
    if (signal) {
      console.error(
        `[heartbeat] ${label} stopped by ${signal} after ${duration}`,
      );
      process.exit(signalExitCodes.get(signal) ?? 1);
    }
    console.error(
      `[heartbeat] ${label} finished after ${duration} with exit code ${code ?? 1}`,
    );
    process.exit(code ?? 1);
  });
};

main().catch((error) => {
  console.error(
    `[heartbeat] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
