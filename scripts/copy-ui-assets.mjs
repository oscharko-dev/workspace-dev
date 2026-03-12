#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceDir = path.resolve(packageRoot, "ui-src");
const destinationDir = path.resolve(packageRoot, "dist", "ui");

const main = async () => {
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });
  await cp(sourceDir, destinationDir, { recursive: true, force: true });
  console.log(`[ui-assets] Copied ${sourceDir} -> ${destinationDir}`);
};

main().catch((error) => {
  console.error("[ui-assets] Failed:", error);
  process.exit(1);
});

