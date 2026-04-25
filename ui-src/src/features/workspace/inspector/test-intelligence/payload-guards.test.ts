import { describe, expect, it } from "vitest";
import {
  isReviewActionEnvelope,
  isReviewEvent,
  isReviewGateSnapshot,
  isReviewStateEnvelope,
  isTestIntelligenceBundle,
  isTestIntelligenceJobSummaryArray,
} from "./payload-guards";
import {
  ASSEMBLED_AT,
  buildBundle,
  buildReviewSnapshotEntry,
} from "./test-fixtures";

const sampleEvent = {
  id: "evt-1",
  jobId: "job-1",
  testCaseId: "tc-1",
  kind: "approved",
  at: ASSEMBLED_AT,
  sequence: 2,
  fromState: "needs_review",
  toState: "approved",
  actor: "alice",
  metadata: { policyDecision: "approved" },
};

describe("isReviewGateSnapshot", () => {
  it("accepts a fully-typed snapshot", () => {
    expect(
      isReviewGateSnapshot({
        jobId: "job-1",
        generatedAt: ASSEMBLED_AT,
        approvedCount: 0,
        needsReviewCount: 1,
        rejectedCount: 0,
        perTestCase: [buildReviewSnapshotEntry()],
      }),
    ).toBe(true);
  });

  it("rejects payloads missing required fields", () => {
    expect(isReviewGateSnapshot(null)).toBe(false);
    expect(isReviewGateSnapshot({})).toBe(false);
    expect(
      isReviewGateSnapshot({
        jobId: "job-1",
        generatedAt: ASSEMBLED_AT,
        approvedCount: 0,
        needsReviewCount: 1,
        rejectedCount: 0,
        // perTestCase missing
      }),
    ).toBe(false);
  });

  it("rejects unknown review states inside the perTestCase array", () => {
    expect(
      isReviewGateSnapshot({
        jobId: "job-1",
        generatedAt: ASSEMBLED_AT,
        approvedCount: 0,
        needsReviewCount: 0,
        rejectedCount: 0,
        perTestCase: [
          {
            ...buildReviewSnapshotEntry(),
            state: "halfway_there",
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("isReviewEvent", () => {
  it("accepts a valid event", () => {
    expect(isReviewEvent(sampleEvent)).toBe(true);
  });

  it("rejects events with non-integer sequence", () => {
    expect(isReviewEvent({ ...sampleEvent, sequence: 1.5 })).toBe(false);
  });

  it("rejects events with unknown toState", () => {
    expect(isReviewEvent({ ...sampleEvent, toState: "haunted" })).toBe(false);
  });

  it("rejects events with non-flat metadata", () => {
    expect(
      isReviewEvent({ ...sampleEvent, metadata: { nested: { deep: 1 } } }),
    ).toBe(false);
  });

  it("treats omitted optional fields as valid", () => {
    const { actor, metadata, ...rest } = sampleEvent;
    expect(actor).toBeDefined();
    expect(metadata).toBeDefined();
    expect(isReviewEvent(rest)).toBe(true);
  });
});

describe("isTestIntelligenceBundle", () => {
  it("accepts the full bundle fixture", () => {
    expect(isTestIntelligenceBundle(buildBundle())).toBe(true);
  });

  it("accepts a bundle with parseErrors and no artifacts", () => {
    expect(
      isTestIntelligenceBundle({
        jobId: "job-1",
        assembledAt: ASSEMBLED_AT,
        parseErrors: [],
      }),
    ).toBe(true);
  });

  it("rejects a bundle whose generatedTestCases.testCases is malformed", () => {
    const bundle = buildBundle();
    expect(
      isTestIntelligenceBundle({
        ...bundle,
        generatedTestCases: {
          jobId: "job-1",
          testCases: [{ id: 42 }],
        },
      }),
    ).toBe(false);
  });

  it("rejects a bundle whose reviewSnapshot is the wrong shape", () => {
    const bundle = buildBundle();
    expect(
      isTestIntelligenceBundle({
        ...bundle,
        reviewSnapshot: { not: "a snapshot" },
      }),
    ).toBe(false);
  });

  it("rejects a bundle whose reviewEvents contains a malformed event", () => {
    const bundle = buildBundle();
    expect(
      isTestIntelligenceBundle({
        ...bundle,
        reviewEvents: [{ id: "evt-1" }],
      }),
    ).toBe(false);
  });

  it("rejects a bundle missing the parseErrors array", () => {
    const bundle = buildBundle();
    const { parseErrors: _drop, ...rest } = bundle;
    expect(_drop).toBeDefined();
    expect(isTestIntelligenceBundle(rest)).toBe(false);
  });
});

describe("isTestIntelligenceJobSummaryArray", () => {
  it("accepts an empty array", () => {
    expect(isTestIntelligenceJobSummaryArray([])).toBe(true);
  });

  it("accepts well-formed summaries", () => {
    expect(
      isTestIntelligenceJobSummaryArray([
        {
          jobId: "job-1",
          hasArtifacts: { generatedTestCases: true, exportReport: false },
        },
      ]),
    ).toBe(true);
  });

  it("rejects entries with non-boolean artifact flags", () => {
    expect(
      isTestIntelligenceJobSummaryArray([
        {
          jobId: "job-1",
          hasArtifacts: { generatedTestCases: "yes" },
        },
      ]),
    ).toBe(false);
  });
});

describe("isReviewStateEnvelope", () => {
  it("accepts the snapshot+events envelope", () => {
    expect(
      isReviewStateEnvelope({
        snapshot: {
          jobId: "job-1",
          generatedAt: ASSEMBLED_AT,
          approvedCount: 0,
          needsReviewCount: 1,
          rejectedCount: 0,
          perTestCase: [buildReviewSnapshotEntry()],
        },
        events: [sampleEvent],
      }),
    ).toBe(true);
  });

  it("rejects an envelope whose events array is malformed", () => {
    expect(
      isReviewStateEnvelope({
        snapshot: {
          jobId: "job-1",
          generatedAt: ASSEMBLED_AT,
          approvedCount: 0,
          needsReviewCount: 0,
          rejectedCount: 0,
          perTestCase: [],
        },
        events: [{ wrong: "shape" }],
      }),
    ).toBe(false);
  });
});

describe("isReviewActionEnvelope", () => {
  it("accepts {ok:true, snapshot, event}", () => {
    expect(
      isReviewActionEnvelope({
        ok: true,
        snapshot: {
          jobId: "job-1",
          generatedAt: ASSEMBLED_AT,
          approvedCount: 1,
          needsReviewCount: 0,
          rejectedCount: 0,
          perTestCase: [{ ...buildReviewSnapshotEntry(), state: "approved" }],
        },
        event: sampleEvent,
      }),
    ).toBe(true);
  });

  it("rejects envelopes where ok is not literal true", () => {
    expect(
      isReviewActionEnvelope({
        ok: false,
        snapshot: {
          jobId: "job-1",
          generatedAt: ASSEMBLED_AT,
          approvedCount: 0,
          needsReviewCount: 0,
          rejectedCount: 0,
          perTestCase: [],
        },
        event: sampleEvent,
      }),
    ).toBe(false);
  });
});
