/**
 * Air-gapped acceptance test for the unsigned attestation path
 * (Issue #1377 AC: "Air-gapped mode test: unsigned attestation path
 * works without network access").
 *
 * The unsigned path MUST:
 *   1. produce a valid DSSE envelope without invoking any network code,
 *   2. statically reference no `fetch` / `WebSocket` / `XMLHttpRequest`
 *      / `node:http` / `node:https` / `node:net` imports in the
 *      attestation module,
 *   3. survive a fail-fast sandbox where any global network primitive
 *      throws on first use.
 *
 * The static-grep guard is load-bearing: a future contributor adding a
 * Sigstore keyless flow MUST keep the network code segregated from the
 * default-path module so the air-gap guarantee is preserved.
 */

import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUnsignedWave1PocAttestationEnvelope,
  buildWave1PocAttestationStatement,
  persistWave1PocAttestation,
  verifyWave1PocAttestationFromDisk,
} from "./evidence-attestation.js";
import {
  buildWave1PocEvidenceManifest,
  computeWave1PocEvidenceManifestDigest,
  writeWave1PocEvidenceManifest,
} from "./evidence-manifest.js";

const ZERO = "0".repeat(64);
const __dirname = dirname(fileURLToPath(import.meta.url));

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

test("evidence-attestation [airgap]: unsigned mode does not import network primitives", async () => {
  const modulePath = resolve(__dirname, "evidence-attestation.ts");
  const source = await readFile(modulePath, "utf8");
  // Banned imports: any node:net / node:http(s) / node:tls / node:dgram /
  // dns module, plus literal `fetch` / `XMLHttpRequest` / `WebSocket`
  // identifiers.
  const banned = [
    /from\s+["']node:net["']/,
    /from\s+["']node:http(?:s)?["']/,
    /from\s+["']node:tls["']/,
    /from\s+["']node:dgram["']/,
    /from\s+["']node:dns(?:\/promises)?["']/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /navigator\.sendBeacon/,
  ];
  const findings = banned
    .map((re) => ({ re, matched: re.test(source) }))
    .filter((f) => f.matched);
  assert.deepEqual(
    findings,
    [],
    `evidence-attestation.ts must not import network primitives. Found: ${findings
      .map((f) => f.re.source)
      .join(", ")}`,
  );
});

test("evidence-attestation [airgap]: unsigned signing+persist+verify works with disabled fetch", async (t) => {
  // Save and forcibly disable global network primitives so any
  // accidental call throws immediately.
  const savedFetch = (globalThis as { fetch?: unknown }).fetch;
  const savedXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  const savedWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  const savedSendBeacon = (
    globalThis as { navigator?: { sendBeacon?: unknown } }
  ).navigator?.sendBeacon;

  const trap = (name: string) =>
    function trapped(): never {
      throw new Error(`AIRGAP_VIOLATION: ${name} called during unsigned path`);
    };
  Object.defineProperty(globalThis, "fetch", {
    value: trap("fetch"),
    configurable: true,
  });
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    value: trap("XMLHttpRequest"),
    configurable: true,
  });
  Object.defineProperty(globalThis, "WebSocket", {
    value: trap("WebSocket"),
    configurable: true,
  });
  if (typeof (globalThis as { navigator?: unknown }).navigator === "object") {
    Object.defineProperty(
      (globalThis as { navigator: { sendBeacon?: unknown } }).navigator,
      "sendBeacon",
      { value: trap("sendBeacon"), configurable: true },
    );
  }
  t.after(() => {
    if (savedFetch !== undefined) {
      Object.defineProperty(globalThis, "fetch", {
        value: savedFetch,
        configurable: true,
      });
    }
    if (savedXhr !== undefined) {
      Object.defineProperty(globalThis, "XMLHttpRequest", {
        value: savedXhr,
        configurable: true,
      });
    }
    if (savedWs !== undefined) {
      Object.defineProperty(globalThis, "WebSocket", {
        value: savedWs,
        configurable: true,
      });
    }
    if (savedSendBeacon !== undefined) {
      Object.defineProperty(
        (globalThis as { navigator: { sendBeacon?: unknown } }).navigator,
        "sendBeacon",
        { value: savedSendBeacon, configurable: true },
      );
    }
  });

  const runDir = await mkdtemp(join(tmpdir(), "wave1-poc-airgap-"));
  t.after(() => rm(runDir, { recursive: true, force: true }));
  const intent = utf8('{"intent":"airgap-fixture"}\n');
  await (
    await import("node:fs/promises")
  ).writeFile(join(runDir, "business-intent-ir.json"), intent);
  const manifest = buildWave1PocEvidenceManifest({
    fixtureId: "poc-onboarding",
    jobId: "job-1377-airgap",
    generatedAt: "2026-04-26T00:00:00.000Z",
    modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    exportProfileId: "opentext-alm-default",
    exportProfileVersion: "1.0.0",
    promptHash: ZERO,
    schemaHash: ZERO,
    inputHash: ZERO,
    cacheKeyDigest: ZERO,
    artifacts: [
      {
        filename: "business-intent-ir.json",
        bytes: intent,
        category: "intent",
      },
    ],
  });
  await writeWave1PocEvidenceManifest({ manifest, destinationDir: runDir });
  const manifestSha256 = computeWave1PocEvidenceManifestDigest(manifest);

  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  const persisted = await persistWave1PocAttestation({
    envelope,
    runDir,
  });
  assert.equal(persisted.bundleFilename, undefined);

  const result = await verifyWave1PocAttestationFromDisk(
    runDir,
    manifest,
    manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
