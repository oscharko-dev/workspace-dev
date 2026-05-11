import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as tls from "node:tls";

import {
  REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
  REGION_ATTESTATION_SCHEMA_VERSION,
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type RegionAttestation,
  type RegionAttestationArtifactEntry,
  type RegionAttestationHostingRegion,
  type RegionAttestationReport,
} from "../contracts/index.js";
import { isAirGapModeEnabled } from "./air-gap-guard.js";
import { canonicalJson } from "./content-hash.js";
import type { AgentSourceLabel } from "./per-source-cost.js";

export const REGION_ATTESTATION_SIGNING_KEY_ENV =
  "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY" as const;
export const REGION_ATTESTATION_PINNED_REGION_ENV =
  "WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION" as const;

/**
 * Issue #2187 — env flag operators set when their sovereign-cloud
 * deployment exposes a signed deployment-manifest claim instead of an
 * Azure-IMDS reachable instance. When set, the resolver routes the
 * pinned region through {@link `sovereign-cloud`} attestation source
 * (audit-grade, no `severity: "warning"`) rather than the legacy
 * {@link `operator-pinned`} fallback.
 *
 * The flag is a binary opt-in (`"1"` / `"true"` / `"yes"`). When unset
 * the resolver preserves its legacy behaviour — IMDS → TLS-cert →
 * operator-pinned — so the sovereign-cloud path is strictly additive
 * and cannot regress audit posture for Azure-served runs.
 */
export const REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV =
  "WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE" as const;

const IMDS_ENDPOINT =
  "http://169.254.169.254/metadata/instance?api-version=2021-02-01" as const;
const SUPPORTED_REGION_SET = new Set<string>(
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
);

type AttestationSeverity = RegionAttestation["severity"];
type AttestationMethod = RegionAttestation["attestedBy"];

export interface RegionAttestationObservation {
  readonly observationId: string;
  readonly sourceLabel: AgentSourceLabel;
  readonly deploymentId: string;
  readonly servedFromRegion: RegionAttestationHostingRegion;
  readonly observedAtUtc: string;
  readonly attestedBy: AttestationMethod;
  readonly severity?: AttestationSeverity;
}

export interface ResolveRegionAttestationObservationInput {
  readonly sourceLabel: AgentSourceLabel;
  readonly deploymentId: string;
  readonly endpointReference: string;
  readonly observedAtUtc: string;
  readonly fetchImpl?: typeof fetch;
  readonly pinnedRegion?: RegionAttestationHostingRegion;
}

const supportedRegions = (
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS as readonly string[]
).slice();

const isRegion = (value: unknown): value is RegionAttestationHostingRegion =>
  typeof value === "string" && SUPPORTED_REGION_SET.has(value);

const parseSupportedRegion = (
  value: string | undefined,
): RegionAttestationHostingRegion | undefined => {
  if (value === undefined) return undefined;
  const lowered = value.toLowerCase();
  const matched = supportedRegions.find((candidate) => lowered.includes(candidate));
  return matched as RegionAttestationHostingRegion | undefined;
};

const parseRegionFromCertificateText = (
  value: string | undefined,
): RegionAttestationHostingRegion | undefined => {
  if (value === undefined) return undefined;
  return parseSupportedRegion(value.replaceAll("_", "-"));
};

const readPinnedRegion = (
  explicitPinnedRegion: RegionAttestationHostingRegion | undefined,
): RegionAttestationHostingRegion | undefined => {
  if (explicitPinnedRegion !== undefined) {
    return explicitPinnedRegion;
  }
  const envValue = process.env[REGION_ATTESTATION_PINNED_REGION_ENV]?.trim();
  return isRegion(envValue) ? envValue : undefined;
};

const truthyEnv = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const lowered = value.trim().toLowerCase();
  return lowered === "1" || lowered === "true" || lowered === "yes";
};

/**
 * Issue #2187 — return `true` when the operator has explicitly enabled
 * the sovereign-cloud attestation source. The flag is independent of
 * `WORKSPACE_TEST_SPACE_AIR_GAP_MODE` (a sovereign deployment may run
 * fully air-gapped *or* with a narrow allow-list of egress hosts), but
 * air-gap mode implies sovereign-cloud attestation because IMDS / TLS
 * probes are unreachable under the air-gap fetch guard.
 */
const isSovereignAttestationSourceEnabled = (): boolean =>
  truthyEnv(process.env[REGION_ATTESTATION_SOVEREIGN_SOURCE_ENV]) ||
  isAirGapModeEnabled();

const buildObservationId = (input: {
  sourceLabel: AgentSourceLabel;
  deploymentId: string;
  servedFromRegion: RegionAttestationHostingRegion;
  observedAtUtc: string;
  attestedBy: AttestationMethod;
  severity?: AttestationSeverity;
}): string =>
  createHash("sha256")
    .update(
      canonicalJson({
        sourceLabel: input.sourceLabel,
        deploymentId: input.deploymentId,
        servedFromRegion: input.servedFromRegion,
        observedAtUtc: input.observedAtUtc,
        attestedBy: input.attestedBy,
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
      }),
      "utf8",
    )
    .digest("hex");

const extractHost = (endpointReference: string): string | undefined => {
  try {
    return new URL(endpointReference).hostname;
  } catch {
    return undefined;
  }
};

const resolveFromTlsCertificate = async (
  endpointReference: string,
): Promise<RegionAttestationHostingRegion | undefined> => {
  const host = extractHost(endpointReference);
  if (host === undefined) return undefined;
  const fromHost = parseSupportedRegion(host);
  if (fromHost !== undefined) return fromHost;
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 1_500,
      },
      () => {
        const cert = socket.getPeerCertificate(true);
        const subject = cert.subject as { CN?: unknown };
        const subjectCn = parseRegionFromCertificateText(
          typeof subject.CN === "string" ? subject.CN : undefined,
        );
        const subjectAltName =
          typeof cert.subjectaltname === "string"
            ? cert.subjectaltname
            : undefined;
        const san = parseRegionFromCertificateText(
          subjectAltName,
        );
        socket.end();
        resolve(subjectCn ?? san);
      },
    );
    socket.once("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.once("error", () => resolve(undefined));
  });
};

const resolveFromImds = async (
  fetchImpl: typeof fetch | undefined,
): Promise<RegionAttestationHostingRegion | undefined> => {
  const impl = fetchImpl ?? globalThis.fetch;
  if (typeof impl !== "function") return undefined;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    try {
      const response = await impl(IMDS_ENDPOINT, {
        headers: { Metadata: "true" },
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as {
        compute?: { location?: unknown };
      };
      return parseSupportedRegion(
        typeof payload.compute?.location === "string"
          ? payload.compute.location
          : undefined,
      );
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return undefined;
  }
};

export const resolveRegionAttestationObservation = async (
  input: ResolveRegionAttestationObservationInput,
): Promise<RegionAttestationObservation> => {
  // Issue #2187 — sovereign-cloud short-circuit. When the operator has
  // signalled a sovereign-cloud deployment (explicit env flag *or*
  // strict air-gap mode), IMDS / TLS-probe paths are unreachable; the
  // pinned region is the authoritative source and carries the
  // `sovereign-cloud` attestation label so audit can distinguish it
  // from the legacy `operator-pinned` fallback.
  if (isSovereignAttestationSourceEnabled()) {
    const sovereignPinned = readPinnedRegion(input.pinnedRegion);
    if (sovereignPinned === undefined) {
      throw new RangeError(
        `Sovereign-cloud attestation enabled but no pinned region was provided for deployment "${input.deploymentId}". ` +
          `Set ${REGION_ATTESTATION_PINNED_REGION_ENV} to one of the supported sovereign-cloud regions.`,
      );
    }
    const attestedBy = "sovereign-cloud" as const;
    return {
      observationId: buildObservationId({
        sourceLabel: input.sourceLabel,
        deploymentId: input.deploymentId,
        servedFromRegion: sovereignPinned,
        observedAtUtc: input.observedAtUtc,
        attestedBy,
      }),
      sourceLabel: input.sourceLabel,
      deploymentId: input.deploymentId,
      servedFromRegion: sovereignPinned,
      observedAtUtc: input.observedAtUtc,
      attestedBy,
    };
  }
  const fromImds = await resolveFromImds(input.fetchImpl);
  if (fromImds !== undefined) {
    const attestedBy = "azure-instance-metadata" as const;
    return {
      observationId: buildObservationId({
        sourceLabel: input.sourceLabel,
        deploymentId: input.deploymentId,
        servedFromRegion: fromImds,
        observedAtUtc: input.observedAtUtc,
        attestedBy,
      }),
      sourceLabel: input.sourceLabel,
      deploymentId: input.deploymentId,
      servedFromRegion: fromImds,
      observedAtUtc: input.observedAtUtc,
      attestedBy,
    };
  }
  const fromCertificate = await resolveFromTlsCertificate(input.endpointReference);
  if (fromCertificate !== undefined) {
    const attestedBy = "endpoint-cert-cn" as const;
    return {
      observationId: buildObservationId({
        sourceLabel: input.sourceLabel,
        deploymentId: input.deploymentId,
        servedFromRegion: fromCertificate,
        observedAtUtc: input.observedAtUtc,
        attestedBy,
      }),
      sourceLabel: input.sourceLabel,
      deploymentId: input.deploymentId,
      servedFromRegion: fromCertificate,
      observedAtUtc: input.observedAtUtc,
      attestedBy,
    };
  }
  const pinnedRegion = readPinnedRegion(input.pinnedRegion);
  if (pinnedRegion === undefined) {
    throw new RangeError(
      `No supported region attestation evidence was available for deployment "${input.deploymentId}". ` +
        `Set ${REGION_ATTESTATION_PINNED_REGION_ENV} to an allowed region to enable the operator-pinned fallback.`,
    );
  }
  const attestedBy = "operator-pinned" as const;
  const severity = "warning" as const;
  return {
    observationId: buildObservationId({
      sourceLabel: input.sourceLabel,
      deploymentId: input.deploymentId,
      servedFromRegion: pinnedRegion,
      observedAtUtc: input.observedAtUtc,
      attestedBy,
      severity,
    }),
    sourceLabel: input.sourceLabel,
    deploymentId: input.deploymentId,
    servedFromRegion: pinnedRegion,
    observedAtUtc: input.observedAtUtc,
    attestedBy,
    severity,
  };
};

const readSigningKey = (): string => {
  const signingKey = process.env[REGION_ATTESTATION_SIGNING_KEY_ENV]?.trim();
  if (signingKey === undefined || signingKey.length === 0) {
    throw new RangeError(
      `${REGION_ATTESTATION_SIGNING_KEY_ENV} is required to sign region attestations.`,
    );
  }
  return signingKey;
};

const signRegionAttestation = (input: {
  artifactHash: string;
  observation: RegionAttestationObservation;
}): string => {
  const signingKey = readSigningKey();
  const payload = {
    schemaVersion: REGION_ATTESTATION_SCHEMA_VERSION,
    artifactHash: input.artifactHash,
    deploymentId: input.observation.deploymentId,
    servedFromRegion: input.observation.servedFromRegion,
    observedAtUtc: input.observation.observedAtUtc,
    attestedBy: input.observation.attestedBy,
    ...(input.observation.severity !== undefined
      ? { severity: input.observation.severity }
      : {}),
  } satisfies Omit<RegionAttestation, "attestationSignatureHex">;
  return createHmac("sha256", signingKey)
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
};

export const buildArtifactRegionAttestations = (input: {
  artifactHash: string;
  observations: readonly RegionAttestationObservation[];
}): RegionAttestation[] =>
  input.observations.map((observation) => ({
    schemaVersion: REGION_ATTESTATION_SCHEMA_VERSION,
    artifactHash: input.artifactHash,
    deploymentId: observation.deploymentId,
    servedFromRegion: observation.servedFromRegion,
    observedAtUtc: observation.observedAtUtc,
    attestedBy: observation.attestedBy,
    ...(observation.severity !== undefined
      ? { severity: observation.severity }
      : {}),
    attestationSignatureHex: signRegionAttestation({
      artifactHash: input.artifactHash,
      observation,
    }),
  }));

export const summarizeRegionAttestations = (
  attestations: readonly RegionAttestation[],
): {
  distinctRegions: readonly RegionAttestationHostingRegion[];
  attestedCallCount: number;
  warningCount: number;
} => {
  const distinctRegions = Array.from(
    new Set(attestations.map((attestation) => attestation.servedFromRegion)),
  ).sort() as RegionAttestationHostingRegion[];
  return {
    distinctRegions,
    attestedCallCount: attestations.length,
    warningCount: attestations.filter(
      (attestation) => attestation.severity === "warning",
    ).length,
  };
};

export const buildRegionAttestationReport = (input: {
  jobId: string;
  generatedAt: string;
  artifacts: readonly RegionAttestationArtifactEntry[];
}): RegionAttestationReport => {
  const artifacts = [...input.artifacts].sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );
  const distinctRegions = Array.from(
    new Set(
      artifacts.flatMap((artifact) =>
        artifact.regionAttestations.map((attestation) => attestation.servedFromRegion),
      ),
    ),
  ).sort() as RegionAttestationHostingRegion[];
  return {
    schemaVersion: REGION_ATTESTATION_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    artifacts,
    distinctRegions,
  };
};

export const writeRegionAttestationReport = async (input: {
  runDir: string;
  report: RegionAttestationReport;
}): Promise<{ artifactPath: string; bytes: Uint8Array }> => {
  const artifactPath = join(
    input.runDir,
    REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(input.report)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, bytes };
};

export const assertAllowedRegionAttestations = (input: {
  profileId: string;
  allowedRegions: readonly RegionAttestationHostingRegion[];
  attestations: readonly RegionAttestation[];
}): void => {
  const allowed = new Set<string>(input.allowedRegions);
  const violating = input.attestations.find(
    (attestation) => !allowed.has(attestation.servedFromRegion),
  );
  if (violating === undefined) return;
  throw new RangeError(
    `G8_EU_REGION_ATTESTED failed for profile "${input.profileId}": deployment "${violating.deploymentId}" ` +
      `served artifact hash ${violating.artifactHash} from disallowed region "${violating.servedFromRegion}".`,
  );
};
