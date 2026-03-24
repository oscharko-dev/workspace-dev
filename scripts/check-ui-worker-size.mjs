#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const assetsDir = path.resolve(packageRoot, "dist/ui/assets");
const DEFAULT_WORKER_SIZE_LIMIT_BYTES = 650_000;

const formatKiB = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

const resolveWorkerSizeLimit = () => {
  const rawLimit = process.env.WORKSPACE_DEV_UI_WORKER_SIZE_LIMIT_BYTES?.trim();
  if (!rawLimit) {
    return DEFAULT_WORKER_SIZE_LIMIT_BYTES;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    throw new Error(
      `Invalid WORKSPACE_DEV_UI_WORKER_SIZE_LIMIT_BYTES value '${rawLimit}'. Expected a positive integer byte size.`
    );
  }

  return parsedLimit;
};

const findWorkerBundlePath = async () => {
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const workerFiles = entries
    .filter((entry) => entry.isFile() && /^shiki-highlight\.worker-.*\.js$/u.test(entry.name))
    .map((entry) => path.join(assetsDir, entry.name))
    .sort();

  if (workerFiles.length === 0) {
    throw new Error(`Could not find a built Shiki worker bundle in ${assetsDir}. Run 'pnpm run build' first.`);
  }

  return workerFiles[workerFiles.length - 1];
};

const main = async () => {
  const workerBundlePath = await findWorkerBundlePath();
  const workerStat = await stat(workerBundlePath);
  const sizeLimitBytes = resolveWorkerSizeLimit();

  if (workerStat.size > sizeLimitBytes) {
    console.error("[ui-worker-size] UI worker bundle budget exceeded.");
    console.error(`[ui-worker-size] Bundle: ${path.relative(packageRoot, workerBundlePath)}`);
    console.error(`[ui-worker-size] Size: ${formatKiB(workerStat.size)} (${workerStat.size} bytes)`);
    console.error(`[ui-worker-size] Limit: ${formatKiB(sizeLimitBytes)} (${sizeLimitBytes} bytes)`);
    process.exit(1);
  }

  console.log("[ui-worker-size] UI worker bundle budget passed.");
  console.log(`[ui-worker-size] Bundle: ${path.relative(packageRoot, workerBundlePath)}`);
  console.log(`[ui-worker-size] Size: ${formatKiB(workerStat.size)} (${workerStat.size} bytes)`);
  console.log(`[ui-worker-size] Limit: ${formatKiB(sizeLimitBytes)} (${sizeLimitBytes} bytes)`);
};

main().catch((error) => {
  console.error("[ui-worker-size] Failed:", error);
  process.exit(1);
});
