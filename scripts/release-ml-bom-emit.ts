#!/usr/bin/env tsx

/**
 * Emit the canonical CycloneDX 1.7 ML-BOM for the current release
 * (Issue #1803, gate `release_ml_bom_emit`).
 *
 * The script is the release-pipeline producer for
 * `<runDir>/evidence/ml-bom/cyclonedx-1.7-ml-bom.json`. It builds the
 * ML-BOM document from a fixed model-binding spec and the EU-banking
 * default policy profile, validates it via {@link validateMlBomDocument},
 * and atomically writes the artifact via {@link writeMlBomArtifact}.
 *
 * `release-readiness-report` references the emitted artifact. The script
 * exits non-zero on any validation failure so the readiness orchestrator
 * attributes the breakage to this gate with a clear log link.
 *
 * Usage:
 *   tsx scripts/release-ml-bom-emit.ts \
 *     [--run-dir <path>] \
 *     [--generated-at <iso8601>] \
 *     [--signing-mode sigstore|unsigned] \
 *     [--release-id <label>]
 *
 * Defaults:
 *   --run-dir       artifacts/release-readiness
 *   --generated-at  current UTC time, ISO-8601 with milliseconds
 *   --signing-mode  sigstore
 *   --release-id    release-readiness-<unix-ts>
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ML_BOM_ARTIFACT_DIRECTORY,
  ML_BOM_ARTIFACT_FILENAME,
  buildMlBomDocument,
  summarizeMlBomArtifact,
  writeMlBomArtifact,
} from "../src/test-intelligence/ml-bom.js";
import { cloneEuBankingDefaultProfile } from "../src/test-intelligence/policy-profile.js";
import type { Wave1ValidationAttestationSigningMode } from "../src/contracts/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_RUN_DIR = path.resolve(repoRoot, "artifacts/release-readiness");

interface CliOptions {
  readonly runDir: string;
  readonly generatedAt: string;
  readonly signingMode: Wave1ValidationAttestationSigningMode;
  readonly releaseId: string;
}

const ALLOWED_SIGNING_MODES: readonly Wave1ValidationAttestationSigningMode[] = [
  "sigstore",
  "unsigned",
];

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const resolveWithinRepo = (flag: string, value: string): string => {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `${flag}: path must resolve inside the repo root (${repoRoot}); got ${resolved}`,
    );
  }
  return resolved;
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let runDir = DEFAULT_RUN_DIR;
  let generatedAt = new Date().toISOString();
  let signingMode: Wave1ValidationAttestationSigningMode = "sigstore";
  let releaseId = `release-readiness-${Math.floor(Date.now() / 1000)}`;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--run-dir") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--run-dir requires a path argument");
      }
      runDir = resolveWithinRepo("--run-dir", value);
      index += 1;
      continue;
    }
    if (flag === "--generated-at") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--generated-at requires an ISO-8601 argument");
      }
      generatedAt = value;
      index += 1;
      continue;
    }
    if (flag === "--signing-mode") {
      if (
        typeof value !== "string" ||
        !(ALLOWED_SIGNING_MODES as readonly string[]).includes(value)
      ) {
        throw new Error(
          `--signing-mode must be one of ${ALLOWED_SIGNING_MODES.join(", ")}`,
        );
      }
      signingMode = value as Wave1ValidationAttestationSigningMode;
      index += 1;
      continue;
    }
    if (flag === "--release-id") {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        !RELEASE_ID_PATTERN.test(value)
      ) {
        throw new Error(
          `--release-id must match RELEASE_ID_PATTERN; got ${String(value)}`,
        );
      }
      releaseId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(flag)}`);
  }
  return { runDir, generatedAt, signingMode, releaseId };
};

interface PackageJsonLike {
  readonly name?: unknown;
  readonly version?: unknown;
}

const readPackageJson = async (): Promise<PackageJsonLike> => {
  const raw = await readFile(path.resolve(repoRoot, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("package.json did not parse to an object");
  }
  return parsed as PackageJsonLike;
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  const pkg = await readPackageJson();
  const releaseVersion =
    typeof pkg.version === "string" ? pkg.version : "0.0.0";

  // Stable, redacted operator endpoints — the ML-BOM redactor enforces
  // `[redacted]` placeholders, but we pass already-redacted values so the
  // emit step never depends on a runtime config that holds secrets.
  const document = buildMlBomDocument({
    generatedAt: options.generatedAt,
    signingMode: options.signingMode,
    policyProfile: cloneEuBankingDefaultProfile(),
    modelBindings: [
      {
        role: "test_generation",
        deployment: `workspace-dev-test-generation-${releaseVersion}`,
        modelRevision: `workspace-dev-test-generation-${releaseVersion}-rev`,
        gatewayRelease: `workspace-dev-gateway-${releaseVersion}`,
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_chat",
      },
      {
        role: "visual_primary",
        deployment: `workspace-dev-visual-primary-${releaseVersion}`,
        modelRevision: `workspace-dev-visual-primary-${releaseVersion}-rev`,
        gatewayRelease: `workspace-dev-gateway-${releaseVersion}`,
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_responses",
      },
      {
        role: "visual_fallback",
        deployment: `workspace-dev-visual-fallback-${releaseVersion}`,
        modelRevision: `workspace-dev-visual-fallback-${releaseVersion}-rev`,
        gatewayRelease: `workspace-dev-gateway-${releaseVersion}`,
        operatorEndpointReference: "https://gateway.example.test/[redacted]",
        compatibilityMode: "openai_responses",
      },
    ],
  });

  const written = await writeMlBomArtifact({
    document,
    runDir: options.runDir,
  });

  const summary = summarizeMlBomArtifact({
    bytes: written.bytes,
    document,
  });

  const relativePath = path.relative(repoRoot, written.artifactPath);
  const sha = createHash("sha256").update(written.bytes).digest("hex");

  console.log(`[release-ml-bom-emit] release-id=${options.releaseId}`);
  console.log(`[release-ml-bom-emit] generated-at=${options.generatedAt}`);
  console.log(`[release-ml-bom-emit] signing-mode=${options.signingMode}`);
  console.log(
    `[release-ml-bom-emit] artifact=${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
  );
  console.log(`[release-ml-bom-emit] path=${relativePath}`);
  console.log(`[release-ml-bom-emit] sha256=${sha}`);
  console.log(
    `[release-ml-bom-emit] components: models=${summary.componentCounts.models} data=${summary.componentCounts.data} citations=${summary.citations}`,
  );
  return 0;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[release-ml-bom-emit] Failed: ${message}`);
      process.exit(1);
    });
}
