#!/usr/bin/env node

import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const declarationPairs = [
  ["dist/index.d.ts", "dist/index.d.cts"],
  ["dist/contracts/index.d.ts", "dist/contracts/index.d.cts"]
];

const main = async () => {
  for (const [sourceRelativePath, targetRelativePath] of declarationPairs) {
    const sourcePath = path.resolve(packageRoot, sourceRelativePath);
    const targetPath = path.resolve(packageRoot, targetRelativePath);

    await access(sourcePath);
    await cp(sourcePath, targetPath);
  }
};

main().catch((error) => {
  console.error("[create-cjs-types] Failed to create .d.cts declarations:", error);
  process.exit(1);
});
