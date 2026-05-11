/**
 * Evidence-verify route bridge (Issue #1380).
 *
 * Path conventions:
 *
 *   GET  /workspace/jobs/<jobId>/evidence/verify  → run the on-disk
 *                                                    evidence verifier
 *
 * The route is bearer-protected at the request-handler layer because
 * it is a governance / audit endpoint. The parser itself is path-only
 * — method dispatch and authorization happen at the request-handler
 * layer, mirroring the inspector test-intelligence parser pattern.
 */

import { isSafeJobId } from "./inspector-bundle.js";

const ROOT = "/workspace/jobs";

export interface EvidenceVerifyRoute {
  kind: "verify_evidence";
  jobId: string;
}

export interface EvidenceVerifyParseError {
  kind: "parse_error";
  reason:
    | "prefix_mismatch"
    | "segment_count_invalid"
    | "empty_segment"
    | "unsafe_job_id"
    | "unknown_subroute";
}

export type EvidenceVerifyParseResult =
  | { ok: true; route: EvidenceVerifyRoute }
  | { ok: false; error: EvidenceVerifyParseError };

/**
 * Parse a `GET /workspace/jobs/<jobId>/evidence/verify` request path.
 *
 * Returns a discriminated union; never throws. Mirrors the discipline
 * of `parseInspectorTestIntelligenceRoute` so 4xx mapping at the
 * request-handler layer stays uniform across governance routes.
 */
export const parseEvidenceVerifyRoute = (
  pathname: string,
): EvidenceVerifyParseResult => {
  if (!pathname.startsWith(`${ROOT}/`) && pathname !== ROOT) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "prefix_mismatch" },
    };
  }
  const remainder = pathname.slice(ROOT.length);
  const rawSegments = remainder.split("/");
  if (rawSegments[0] !== "") {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "prefix_mismatch" },
    };
  }
  const segments = rawSegments.slice(1);
  if (segments.at(-1) === "") {
    segments.pop();
  }
  // Expect exactly: [jobId, "evidence", "verify"]
  if (segments.length !== 3) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "segment_count_invalid" },
    };
  }
  if (segments.some((segment) => segment.length === 0)) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "empty_segment" },
    };
  }
  const jobId = segments[0];
  const evidence = segments[1];
  const verify = segments[2];
  if (
    jobId === undefined ||
    jobId.length === 0 ||
    evidence === undefined ||
    evidence.length === 0 ||
    verify === undefined ||
    verify.length === 0
  ) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "empty_segment" },
    };
  }
  if (evidence !== "evidence" || verify !== "verify") {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "unknown_subroute" },
    };
  }
  if (!isSafeJobId(jobId)) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "unsafe_job_id" },
    };
  }
  return { ok: true, route: { kind: "verify_evidence", jobId } };
};
