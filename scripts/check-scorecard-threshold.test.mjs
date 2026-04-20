import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApiUrl,
  evaluateScorecardResult,
  parseMinScore,
  runCheck,
} from "./check-scorecard-threshold.mjs";

test("buildApiUrl derives the project endpoint from GITHUB_REPOSITORY", () => {
  assert.equal(
    buildApiUrl({
      env: {
        GITHUB_REPOSITORY: "oscharko-dev/workspace-dev",
      },
    }),
    "https://api.securityscorecards.dev/projects/github.com/oscharko-dev/workspace-dev",
  );
});

test("parseMinScore rejects values outside the allowed range", () => {
  assert.throws(() => parseMinScore("10.1"), /between 0 and 10/);
  assert.throws(() => parseMinScore("-0.1"), /between 0 and 10/);
});

test("evaluateScorecardResult requests a retry when the published commit lags behind", () => {
  const result = evaluateScorecardResult({
    payload: {
      score: 6.2,
      repo: {
        name: "github.com/oscharko-dev/workspace-dev",
        commit: "older-commit",
      },
      date: "2026-04-20T20:15:35Z",
    },
    minScore: 5.5,
    expectedCommit: "new-commit",
    expectedRepositoryUri: "github.com/oscharko-dev/workspace-dev",
  });

  assert.deepEqual(result, {
    ok: false,
    retryable: true,
    summary: "published commit older-commit does not match expected new-commit",
  });
});

test("evaluateScorecardResult fails when the score is below the threshold", () => {
  const result = evaluateScorecardResult({
    payload: {
      score: 5.4,
      repo: {
        name: "github.com/oscharko-dev/workspace-dev",
        commit: "new-commit",
      },
      date: "2026-04-20T20:15:35Z",
    },
    minScore: 5.5,
    expectedCommit: "new-commit",
    expectedRepositoryUri: "github.com/oscharko-dev/workspace-dev",
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.match(result.summary, /score 5.4 is below the minimum 5.5/);
});

test("runCheck retries until the current commit is published and then passes", async () => {
  const seen = [];
  const fetchImpl = async () => {
    seen.push("fetch");
    if (seen.length === 1) {
      return {
        ok: true,
        json: async () => ({
          score: 5.7,
          repo: {
            name: "github.com/oscharko-dev/workspace-dev",
            commit: "stale-commit",
          },
          date: "2026-04-20T20:15:35Z",
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        score: 5.7,
        repo: {
          name: "github.com/oscharko-dev/workspace-dev",
          commit: "fresh-commit",
        },
        date: "2026-04-20T20:16:35Z",
      }),
    };
  };

  const stdout = [];
  const stderr = [];
  let waitedMs = 0;

  const exitCode = await runCheck({
    env: {
      GITHUB_REPOSITORY: "oscharko-dev/workspace-dev",
      SCORECARD_EXPECTED_COMMIT: "fresh-commit",
      SCORECARD_MIN_SCORE: "5.5",
      SCORECARD_POLL_ATTEMPTS: "2",
      SCORECARD_POLL_INTERVAL_MS: "1",
    },
    fetchImpl,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    wait: async (ms) => {
      waitedMs += ms;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(waitedMs, 1);
  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 1);
  assert.match(stdout[0], /Passed: score 5.7 meets the minimum 5.5/);
});
