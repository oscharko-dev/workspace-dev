/**
 * HTTP route handlers for the human-review queue (Issue #2179).
 *
 * Framework-agnostic: each handler takes a structured request and
 * returns a structured response. The host server (`server/server.ts`,
 * the inspector surface, or any operator's air-gap deployment) wires
 * these into its router of choice. This keeps the queue's HTTP surface
 * usable in:
 *
 *   - the existing in-process inspector (Express/Node http),
 *   - sovereign-cloud air-gapped deployments where operators bring
 *     their own HTTP stack, and
 *   - tests that exercise the surface without spinning a real server.
 *
 * Endpoints (kebab-case, singular nouns where each request maps to one
 * resource type):
 *
 *   GET  /api/human-review/queue?tenant=…[&profile=…][&slaDueBy=…]
 *   GET  /api/human-review/items/:id?tenant=…
 *   POST /api/human-review/decisions   (body = HumanReviewVerdict)
 *
 * Authorization is the host's responsibility — these handlers do not
 * authenticate the caller. The signature on the persisted verdict is
 * the cryptographic proof of reviewer identity; the HTTP layer should
 * still gate by tenant + role at the router boundary.
 */

import {
  fetchPendingReviews,
  getHumanReviewQueueItem,
  HumanReviewQueueError,
  recordHumanReviewVerdict,
} from "./human-review-queue.js";
import type {
  HumanReviewFilter,
  HumanReviewQueueItem,
  HumanReviewVerdict,
} from "../contracts/index.js";

/** Structured response shape every handler returns. */
export interface HumanReviewHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const json = (status: number, value: unknown): HumanReviewHttpResponse =>
  Object.freeze({
    status,
    headers: Object.freeze({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
    body: JSON.stringify(value),
  });

const errorBody = (
  code: string,
  message: string,
): { readonly error: { readonly code: string; readonly message: string } } => ({
  error: { code, message },
});

/** GET /api/human-review/queue request shape. */
export interface ListQueueRequest {
  readonly tenant: string;
  readonly profile?: string;
  readonly slaDueBy?: string;
}

export const handleListQueue = async (
  rootDir: string,
  request: ListQueueRequest,
): Promise<HumanReviewHttpResponse> => {
  if (
    typeof request.tenant !== "string" ||
    request.tenant.length === 0
  ) {
    return json(400, errorBody("E_TENANT_REQUIRED", '"tenant" query param is required'));
  }
  try {
    const filter: HumanReviewFilter = {
      tenantId: request.tenant,
      ...(request.profile !== undefined ? { profileId: request.profile } : {}),
      ...(request.slaDueBy !== undefined ? { slaDueBy: request.slaDueBy } : {}),
    };
    const items: readonly HumanReviewQueueItem[] = await fetchPendingReviews(
      rootDir,
      filter,
    );
    return json(200, { items });
  } catch (err) {
    return mapError(err);
  }
};

/** GET /api/human-review/items/:id request shape. */
export interface GetItemRequest {
  readonly tenant: string;
  readonly itemId: string;
}

export const handleGetItem = async (
  rootDir: string,
  request: GetItemRequest,
): Promise<HumanReviewHttpResponse> => {
  if (
    typeof request.tenant !== "string" ||
    request.tenant.length === 0
  ) {
    return json(400, errorBody("E_TENANT_REQUIRED", '"tenant" query param is required'));
  }
  if (
    typeof request.itemId !== "string" ||
    request.itemId.length === 0
  ) {
    return json(400, errorBody("E_ITEM_ID_REQUIRED", "item id is required in the path"));
  }
  try {
    const item = await getHumanReviewQueueItem(
      rootDir,
      request.tenant,
      request.itemId,
    );
    if (item === undefined) {
      return json(
        404,
        errorBody(
          "E_QUEUE_ITEM_NOT_FOUND",
          `queue item "${request.itemId}" not found for tenant "${request.tenant}"`,
        ),
      );
    }
    return json(200, item);
  } catch (err) {
    return mapError(err);
  }
};

/**
 * `POST /api/human-review/decisions` request body shape.
 *
 * `tenant` is required. The host server should also enforce that the
 * authenticated principal is authorised to write under this tenant
 * before delegating; the queue store's signature check proves reviewer
 * identity but is not a substitute for transport-level authorisation.
 */
export interface PostDecisionRequest {
  readonly tenant: string;
  readonly verdict: HumanReviewVerdict;
}

export const handlePostDecision = async (
  rootDir: string,
  request: PostDecisionRequest,
): Promise<HumanReviewHttpResponse> => {
  if (
    typeof request.tenant !== "string" ||
    request.tenant.length === 0
  ) {
    return json(
      400,
      errorBody(
        "E_TENANT_REQUIRED",
        '"tenant" body field is required for POST /api/human-review/decisions',
      ),
    );
  }
  const candidate = request.verdict as unknown;
  if (typeof candidate !== "object" || candidate === null) {
    return json(
      400,
      errorBody(
        "E_VERDICT_REQUIRED",
        "request body must contain a HumanReviewVerdict object",
      ),
    );
  }
  try {
    const item = await recordHumanReviewVerdict(
      rootDir,
      request.verdict,
      request.tenant,
    );
    return json(201, {
      recorded: {
        itemId: item.itemId,
        tenantId: item.tenantId,
        verdict: request.verdict.verdict,
        decidedAt: request.verdict.decidedAt,
        reviewerPrincipalHash: request.verdict.reviewerPrincipalHash,
      },
    });
  } catch (err) {
    return mapError(err);
  }
};

const mapError = (err: unknown): HumanReviewHttpResponse => {
  if (err instanceof HumanReviewQueueError) {
    const code = err.code;
    if (code === "E_QUEUE_ITEM_NOT_FOUND") {
      return json(404, errorBody(code, err.message));
    }
    if (
      code === "E_QUEUE_ITEM_ALREADY_EXISTS" ||
      code === "E_VERDICT_ALREADY_RECORDED"
    ) {
      return json(409, errorBody(code, err.message));
    }
    if (
      code === "E_INVALID_SCHEMA" ||
      code === "E_INVALID_FIELD" ||
      code === "E_INVALID_SEGMENT" ||
      code === "E_INVALID_TIMESTAMP" ||
      code === "E_INVALID_RATIONALE" ||
      code === "E_INVALID_VERDICT" ||
      code === "E_INVALID_KEY" ||
      code === "E_INVALID_SIGNATURE" ||
      code === "E_INVALID_SLA"
    ) {
      return json(400, errorBody(code, err.message));
    }
    if (
      code === "E_SIGNATURE_INVALID" ||
      code === "E_KEY_FINGERPRINT_MISMATCH"
    ) {
      return json(403, errorBody(code, err.message));
    }
    return json(500, errorBody(code, err.message));
  }
  return json(
    500,
    errorBody("E_INTERNAL", "internal error processing human-review request"),
  );
};
