/**
 * Thin client for the human-review HTTP routes (Issue #2179).
 *
 * The routes are framework-agnostic on the server (see
 * `src/test-intelligence/human-review-http-routes.ts`); this module
 * just shapes the GET / POST calls and surfaces typed errors.
 */

import { fetchJson } from "../../lib/http";
import type {
  HumanReviewQueueItem,
  HumanReviewVerdict,
} from "./types";

const QUEUE_PATH = "/api/human-review/queue";
const ITEM_PATH = "/api/human-review/items";
const DECISION_PATH = "/api/human-review/decisions";

export interface FetchQueueParams {
  readonly tenant: string;
  readonly profile?: string;
  readonly slaDueBy?: string;
}

const buildQueueUrl = ({ tenant, profile, slaDueBy }: FetchQueueParams): string => {
  const params = new URLSearchParams({ tenant });
  if (profile !== undefined) params.set("profile", profile);
  if (slaDueBy !== undefined) params.set("slaDueBy", slaDueBy);
  return `${QUEUE_PATH}?${params.toString()}`;
};

export class HumanReviewApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HumanReviewApiError";
    this.status = status;
    this.code = code;
  }
}

const decodeError = (status: number, payload: Record<string, unknown>): HumanReviewApiError => {
  const errBlob = payload["error"];
  if (
    typeof errBlob === "object" &&
    errBlob !== null &&
    typeof (errBlob as { code?: unknown }).code === "string" &&
    typeof (errBlob as { message?: unknown }).message === "string"
  ) {
    const { code, message } = errBlob as { code: string; message: string };
    return new HumanReviewApiError(status, code, message);
  }
  return new HumanReviewApiError(status, "E_UNEXPECTED", `unexpected response (status ${status})`);
};

export const fetchQueue = async (
  params: FetchQueueParams,
): Promise<readonly HumanReviewQueueItem[]> => {
  const response = await fetchJson<{ items: readonly HumanReviewQueueItem[] }>({
    url: buildQueueUrl(params),
  });
  if (!response.ok) {
    throw decodeError(response.status, response.payload as Record<string, unknown>);
  }
  const items = (response.payload as { items?: readonly HumanReviewQueueItem[] }).items;
  return Array.isArray(items) ? (items as readonly HumanReviewQueueItem[]) : [];
};

export const fetchItem = async (
  tenant: string,
  itemId: string,
): Promise<HumanReviewQueueItem> => {
  const url = `${ITEM_PATH}/${encodeURIComponent(itemId)}?tenant=${encodeURIComponent(tenant)}`;
  const response = await fetchJson<HumanReviewQueueItem>({ url });
  if (!response.ok) {
    throw decodeError(response.status, response.payload as Record<string, unknown>);
  }
  return response.payload as HumanReviewQueueItem;
};

export const submitDecision = async (
  tenant: string,
  verdict: HumanReviewVerdict,
): Promise<{ readonly itemId: string }> => {
  const response = await fetchJson<{ recorded: { itemId: string } }>({
    url: DECISION_PATH,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant, verdict }),
    },
  });
  if (!response.ok) {
    throw decodeError(response.status, response.payload as Record<string, unknown>);
  }
  const recorded = (response.payload as { recorded?: { itemId?: string } }).recorded as
    | { itemId?: string }
    | null
    | undefined;
  if (
    typeof recorded !== "object" ||
    recorded === null ||
    typeof recorded.itemId !== "string"
  ) {
    throw new HumanReviewApiError(
      response.status,
      "E_UNEXPECTED",
      "server response missing recorded.itemId",
    );
  }
  return { itemId: recorded.itemId };
};
