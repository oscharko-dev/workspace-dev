#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const main = () => {
  const probe = spawnSync(
    process.execPath,
    ["--enable-fips", "--input-type=module", "-e", "import { getFips } from 'node:crypto'; console.log(getFips());"],
    {
      cwd: packageRoot,
      encoding: "utf8"
    }
  );

  const stdout = (probe.stdout ?? "").trim();
  const stderr = `${probe.stderr ?? ""}`.trim();

  if (probe.status === 0 && stdout === "1") {
    const runtimeCheck = spawnSync(
      process.execPath,
      [
        "--enable-fips",
        "--input-type=module",
        "-e",
        "import './dist/index.js'; import { getFips } from 'node:crypto'; if (getFips() !== 1) throw new Error('FIPS not enabled');"
      ],
      {
        cwd: packageRoot,
        encoding: "utf8"
      }
    );

    if (runtimeCheck.status !== 0) {
      throw new Error(
        `FIPS runtime smoke failed:\n${runtimeCheck.stdout ?? ""}\n${runtimeCheck.stderr ?? ""}`
      );
    }

    console.log("[fips] FIPS mode enabled and runtime import succeeded.");
    return;
  }

  const unsupportedPatterns = [
    /fips mode not supported/i,
    /openssl error when trying to enable fips/i,
    /could not load the shared library/i,
    /unknown option/i,
    /digital envelope routines/i,
    /provider routines/i
  ];
  const combinedOutput = `${stdout}\n${stderr}`;
  const isUnsupported = unsupportedPatterns.some((pattern) => pattern.test(combinedOutput));

  if (isUnsupported) {
    console.log("[fips] Skipping smoke check: host OpenSSL FIPS module is not available.");
    return;
  }

  throw new Error(`FIPS probe failed:\n${combinedOutput}`);
};

try {
  main();
} catch (error) {
  console.error("[fips] Smoke check failed:", error);
  process.exit(1);
}
