// ---------------------------------------------------------------------------
// Test Intelligence Inspector — data hook (Issue #1367)
//
// Wraps the bundle/state fetches and review-action submission. The hook
// keeps the parent page free of data-management noise so the page focuses
// purely on layout. Uses React Query so the standard retry/refetch policy
// from main.tsx (single retry, no refetch-on-focus) applies.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchReviewState,
  fetchTestIntelligenceBundle,
  postReviewAction,
  type FetchOutcome,
  type ReviewStateFetchOk,
} from "./api";
import type {
  ReviewActionInput,
  ReviewEvent,
  ReviewGateSnapshot,
  TestIntelligenceBundle,
} from "./types";

export interface UseTestIntelligenceJobInput {
  jobId: string;
  /** Bearer token used for review-action writes. Empty when not configured. */
  bearerToken: string;
  /** Reviewer handle attached to every recorded event. */
  reviewerHandle: string;
}

export interface TestIntelligenceJobState {
  bundle: TestIntelligenceBundle | undefined;
  bundleStatus: "loading" | "ready" | "error";
  bundleError: string | null;
  reviewState: ReviewStateFetchOk | undefined;
  reviewStateStatus: "loading" | "ready" | "error";
  reviewStateError: string | null;
  pendingAction: ReviewActionInput["action"] | null;
  actionError: string | null;
  refresh: () => Promise<void>;
  submitAction: (input: Omit<ReviewActionInput, "jobId">) => Promise<void>;
}

const queryKeyForBundle = (jobId: string): readonly unknown[] => [
  "test-intelligence",
  "bundle",
  jobId,
];

const queryKeyForReviewState = (jobId: string): readonly unknown[] => [
  "test-intelligence",
  "review-state",
  jobId,
];

const outcomeToError = (outcome: FetchOutcome<unknown>): string =>
  outcome.ok ? "" : `${outcome.error}: ${outcome.message}`.replace(/^:\s+/, "");

export function useTestIntelligenceJob({
  jobId,
  bearerToken,
  reviewerHandle,
}: UseTestIntelligenceJobInput): TestIntelligenceJobState {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const bundleQuery = useQuery<FetchOutcome<TestIntelligenceBundle>>({
    queryKey: queryKeyForBundle(jobId),
    queryFn: () => fetchTestIntelligenceBundle(jobId),
  });

  const reviewQuery = useQuery<FetchOutcome<ReviewStateFetchOk>>({
    queryKey: queryKeyForReviewState(jobId),
    queryFn: () => fetchReviewState(jobId),
  });

  const reviewMutation = useMutation({
    mutationFn: async (
      input: Omit<ReviewActionInput, "jobId">,
    ): Promise<{ snapshot: ReviewGateSnapshot; event: ReviewEvent }> => {
      const result = await postReviewAction({
        ...input,
        jobId,
        bearerToken,
        ...(reviewerHandle.length > 0 && input.actor === undefined
          ? { actor: reviewerHandle }
          : {}),
      });
      if (!result.ok) {
        throw new Error(`${result.error}: ${result.message}`);
      }
      return { snapshot: result.value.snapshot, event: result.value.event };
    },
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: ({ snapshot, event }) => {
      queryClient.setQueryData<FetchOutcome<ReviewStateFetchOk>>(
        queryKeyForReviewState(jobId),
        (previous) => {
          if (!previous) {
            return {
              ok: true,
              value: { snapshot, events: [event] },
            };
          }
          if (!previous.ok) {
            return {
              ok: true,
              value: { snapshot, events: [event] },
            };
          }
          return {
            ok: true,
            value: {
              snapshot,
              events: previous.value.events.concat(event),
            },
          };
        },
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeyForBundle(jobId),
      });
    },
    onError: (error: unknown) => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeyForBundle(jobId) }),
      queryClient.invalidateQueries({
        queryKey: queryKeyForReviewState(jobId),
      }),
    ]);
  }, [jobId, queryClient]);

  const submitAction = useCallback(
    async (input: Omit<ReviewActionInput, "jobId">): Promise<void> => {
      await reviewMutation.mutateAsync(input);
    },
    [reviewMutation],
  );

  const bundleResult = bundleQuery.data;
  const reviewResult = reviewQuery.data;

  const state = useMemo<TestIntelligenceJobState>(() => {
    return {
      bundle: bundleResult && bundleResult.ok ? bundleResult.value : undefined,
      bundleStatus: bundleQuery.isPending
        ? "loading"
        : bundleResult && !bundleResult.ok
          ? "error"
          : bundleResult
            ? "ready"
            : "loading",
      bundleError:
        bundleResult && !bundleResult.ok ? outcomeToError(bundleResult) : null,
      reviewState:
        reviewResult && reviewResult.ok ? reviewResult.value : undefined,
      reviewStateStatus: reviewQuery.isPending
        ? "loading"
        : reviewResult && !reviewResult.ok
          ? "error"
          : reviewResult
            ? "ready"
            : "loading",
      reviewStateError:
        reviewResult && !reviewResult.ok ? outcomeToError(reviewResult) : null,
      pendingAction: reviewMutation.isPending
        ? reviewMutation.variables.action
        : null,
      actionError,
      refresh,
      submitAction,
    };
  }, [
    actionError,
    bundleQuery.isPending,
    bundleResult,
    refresh,
    reviewMutation.isPending,
    reviewMutation.variables,
    reviewQuery.isPending,
    reviewResult,
    submitAction,
  ]);

  return state;
}
