#!/usr/bin/env node

const DEFAULT_API_BASE_URL = "https://api.securityscorecards.dev/projects/";
const DEFAULT_MIN_SCORE = 5.5;
const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 15_000;

const toNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export const parsePositiveInteger = (value, fallback) => {
  const normalized = toNonEmptyString(value);
  if (normalized === null) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseMinScore = (value, fallback = DEFAULT_MIN_SCORE) => {
  const normalized = toNonEmptyString(value);
  if (normalized === null) {
    return fallback;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
    throw new Error(
      `SCORECARD_MIN_SCORE must be a number between 0 and 10. Received: ${normalized}`,
    );
  }

  return parsed;
};

export const buildApiUrl = ({
  apiUrl,
  repositoryUri,
  env = process.env,
} = {}) => {
  const explicitApiUrl = toNonEmptyString(apiUrl ?? env.SCORECARD_API_URL);
  if (explicitApiUrl !== null) {
    return explicitApiUrl;
  }

  const explicitRepositoryUri = toNonEmptyString(
    repositoryUri ?? env.SCORECARD_REPOSITORY_URI,
  );
  if (explicitRepositoryUri !== null) {
    return new URL(explicitRepositoryUri, DEFAULT_API_BASE_URL).toString();
  }

  const githubRepository = toNonEmptyString(env.GITHUB_REPOSITORY);
  if (githubRepository === null) {
    throw new Error(
      "Set SCORECARD_API_URL, SCORECARD_REPOSITORY_URI, or GITHUB_REPOSITORY before running the scorecard threshold check.",
    );
  }

  return new URL(
    `github.com/${githubRepository}`,
    DEFAULT_API_BASE_URL,
  ).toString();
};

export const summarizeResponse = (payload) => ({
  score: payload?.score,
  repoName: payload?.repo?.name,
  commit: payload?.repo?.commit,
  date: payload?.date,
});

export const evaluateScorecardResult = ({
  payload,
  minScore,
  expectedCommit,
  expectedRepositoryUri,
}) => {
  const { score, repoName, commit, date } = summarizeResponse(payload);

  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error(
      "Scorecard API response did not include a finite numeric score.",
    );
  }

  if (
    toNonEmptyString(expectedRepositoryUri) !== null &&
    repoName !== expectedRepositoryUri
  ) {
    return {
      ok: false,
      retryable: true,
      summary: `published repository ${repoName ?? "<missing>"} did not match expected ${expectedRepositoryUri}`,
    };
  }

  if (toNonEmptyString(expectedCommit) !== null && commit !== expectedCommit) {
    return {
      ok: false,
      retryable: true,
      summary: `published commit ${commit ?? "<missing>"} does not match expected ${expectedCommit}`,
    };
  }

  if (score < minScore) {
    return {
      ok: false,
      retryable: false,
      summary: `score ${score.toFixed(1)} is below the minimum ${minScore.toFixed(1)} for ${repoName ?? "the repository"} at commit ${commit ?? "<missing>"} (${date ?? "unknown date"})`,
    };
  }

  return {
    ok: true,
    retryable: false,
    summary: `score ${score.toFixed(1)} meets the minimum ${minScore.toFixed(1)} for ${repoName ?? "the repository"} at commit ${commit ?? "<missing>"} (${date ?? "unknown date"})`,
  };
};

export const fetchScorecardResult = async ({ apiUrl, fetchImpl = fetch }) => {
  const response = await fetchImpl(apiUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "workspace-dev-scorecard-threshold-check",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Scorecard API request failed with HTTP ${response.status}.`,
    );
  }

  return response.json();
};

export const waitFor = (ms, timer = setTimeout) =>
  new Promise((resolve) => {
    timer(resolve, ms);
  });

const isCliEntry = () => {
  const entryPath = toNonEmptyString(process.argv[1]);
  return (
    entryPath !== null &&
    import.meta.url === new URL(`file://${entryPath}`).href
  );
};

export const runCheck = async ({
  env = process.env,
  fetchImpl = fetch,
  stdout = console.log,
  stderr = console.error,
  wait = waitFor,
} = {}) => {
  const apiUrl = buildApiUrl({ env });
  const expectedCommit = toNonEmptyString(env.SCORECARD_EXPECTED_COMMIT);
  const expectedRepositoryUri = toNonEmptyString(
    env.SCORECARD_REPOSITORY_URI ??
      (env.GITHUB_REPOSITORY ? `github.com/${env.GITHUB_REPOSITORY}` : ""),
  );
  const minScore = parseMinScore(env.SCORECARD_MIN_SCORE);
  const attempts = parsePositiveInteger(
    env.SCORECARD_POLL_ATTEMPTS,
    DEFAULT_POLL_ATTEMPTS,
  );
  const intervalMs = parsePositiveInteger(
    env.SCORECARD_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let payload;
    try {
      payload = await fetchScorecardResult({ apiUrl, fetchImpl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts) {
        stderr(`[scorecard-threshold] ${message}`);
        return 1;
      }
      stderr(
        `[scorecard-threshold] Attempt ${attempt}/${attempts} failed: ${message}. Retrying in ${intervalMs}ms.`,
      );
      await wait(intervalMs);
      continue;
    }

    const evaluation = evaluateScorecardResult({
      payload,
      minScore,
      expectedCommit,
      expectedRepositoryUri,
    });

    if (evaluation.ok) {
      stdout(`[scorecard-threshold] Passed: ${evaluation.summary}.`);
      return 0;
    }

    if (!evaluation.retryable || attempt === attempts) {
      stderr(`[scorecard-threshold] Failed: ${evaluation.summary}.`);
      return 1;
    }

    stderr(
      `[scorecard-threshold] Attempt ${attempt}/${attempts} not ready: ${evaluation.summary}. Retrying in ${intervalMs}ms.`,
    );
    await wait(intervalMs);
  }

  stderr(
    "[scorecard-threshold] Failed before a definitive Scorecard result was published.",
  );
  return 1;
};

if (isCliEntry()) {
  const exitCode = await runCheck();
  process.exit(exitCode);
}
