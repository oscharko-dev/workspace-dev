import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRegisteredSignedBundleIdsFromContractChangelog,
  evaluateHookMatcherExpression,
  HOOK_EVENTS,
  HOOK_MATCHER_SCHEMA_VERSION,
  resolveHookHttpCommand,
  runHookMatchersForEvent,
  validateHookMatchers,
  type HookMatcher,
} from "./harness-hooks.js";

const baseHook = (overrides: Partial<HookMatcher> = {}): HookMatcher => ({
  schemaVersion: HOOK_MATCHER_SCHEMA_VERSION,
  event: "PreRoleCall",
  if: 'event == "PreRoleCall"',
  command: {
    kind: "command",
    cmd: "echo",
    args: ["ok"],
    timeoutMs: 1_000,
  },
  ...overrides,
});

test("hook lifecycle vocabulary is closed and alphabetically stable", () => {
  assert.deepEqual([...HOOK_EVENTS], [
    "OnEvidenceSeal",
    "OnExportComplete",
    "OnFourEyesPending",
    "OnNeedsReview",
    "OnStop",
    "OnSubagentStop",
    "PostGapFinder",
    "PostJudgePanel",
    "PostRepair",
    "PostRoleCall",
    "PostVisualSidecar",
    "PreGapFinder",
    "PreJudgePanel",
    "PreRepair",
    "PreRoleCall",
    "PreVisualSidecar",
  ]);
});

test("evaluateHookMatcherExpression supports equality, negation, and grouping", () => {
  const facts = {
    event: "PreRoleCall" as const,
    policyProfile: "banking",
    role: { kind: "generator" },
    attempt: 1,
    blocked: false,
  };
  assert.equal(
    evaluateHookMatcherExpression(
      'event == "PreRoleCall" && policyProfile == "banking"',
      facts,
    ),
    true,
  );
  assert.equal(
    evaluateHookMatcherExpression(
      '!(event != "PreRoleCall") && role.kind == "generator"',
      facts,
    ),
    true,
  );
  assert.equal(
    evaluateHookMatcherExpression(
      '(attempt == 2) || blocked == true',
      facts,
    ),
    false,
  );
});

test("AT-035 equivalent: banking hooks without signedBundleId are refused", () => {
  const result = validateHookMatchers([baseHook()], {
    policyProfile: "banking",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.refusals, [
    {
      index: 0,
      code: "hook_bundle_unsigned",
      message: 'hook[0] banking profile requires signedBundleId',
    },
  ]);
});

test("registered signed bundle ids can be extracted from CONTRACT_CHANGELOG markdown", () => {
  const registered = extractRegisteredSignedBundleIdsFromContractChangelog(`
- signedBundleId: \`banking-hooks.v1\`
- something else
- signedBundleId = \`ops-hooks.v2\`
`);
  assert.equal(registered.has("banking-hooks.v1"), true);
  assert.equal(registered.has("ops-hooks.v2"), true);
});

test("banking hooks with registered signedBundleId validate cleanly", () => {
  const hook = baseHook({ signedBundleId: "banking-hooks.v1" });
  const result = validateHookMatchers([hook], {
    policyProfile: "banking",
    registeredSignedBundleIds: new Set(["banking-hooks.v1"]),
  });
  assert.equal(result.ok, true, JSON.stringify(result.refusals, null, 2));
  assert.deepEqual(result.refusals, []);
});

test("lint:no-telemetry equivalent blocks telemetry-shaped hook URLs", () => {
  const hook = baseHook({
    command: {
      kind: "http",
      url: "https://metrics.example.com/track",
      method: "POST",
      headers: {},
      bodyTemplate: "{}",
    },
  });
  const result = validateHookMatchers([hook], {
    allowedHttpHosts: ["metrics.example.com"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusals[0]?.code, "hook_telemetry_url_blocked");
});

test("http hook domains must be allowlisted and headers only interpolate allowlisted env vars", () => {
  const hook = baseHook({
    command: {
      kind: "http",
      url: "https://hooks.example.com/execute",
      method: "POST",
      headers: {
        Authorization: "Bearer ${HOOK_TOKEN}",
      },
      bodyTemplate: "{}",
      allowedEnvVars: ["HOOK_TOKEN"],
    },
  });
  const result = validateHookMatchers([hook], {
    allowedHttpHosts: ["hooks.example.com"],
  });
  assert.equal(result.ok, true, JSON.stringify(result.refusals, null, 2));
  assert.deepEqual(
    resolveHookHttpCommand(hook.command, { HOOK_TOKEN: "secret-token" }).headers,
    {
      Authorization: "Bearer secret-token",
    },
  );
  assert.throws(
    () =>
      resolveHookHttpCommand(
        {
          ...hook.command,
          headers: { Authorization: "Bearer ${MISSING}" },
        },
        { HOOK_TOKEN: "secret-token" },
      ),
    /not allowlisted/,
  );
});

test("hooks execute deterministically and concurrent hooks respect maxConcurrentHooks", async () => {
  const activity: string[] = [];
  let active = 0;
  let maxActive = 0;
  const hooks = [
    baseHook({
      command: { kind: "command", cmd: "a", args: [], timeoutMs: 1_000 },
      async: true,
    }),
    baseHook({
      command: { kind: "command", cmd: "b", args: [], timeoutMs: 1_000 },
      async: true,
    }),
    baseHook({
      command: { kind: "command", cmd: "c", args: [], timeoutMs: 1_000 },
      async: true,
    }),
  ];

  const results = await runHookMatchersForEvent({
    hooks,
    event: "PreRoleCall",
    facts: { event: "PreRoleCall" },
    policy: { maxConcurrentHooks: 2 },
    executors: {
      command: async (command) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        activity.push(`start:${command.cmd}`);
        await new Promise((resolve) =>
          setTimeout(resolve, command.cmd === "a" ? 25 : 5),
        );
        activity.push(`done:${command.cmd}`);
        active -= 1;
        return command.cmd;
      },
    },
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(
    results.map((entry) => entry.result),
    ["a", "b", "c"],
  );
  assert.equal(activity[0], "start:a");
  assert.equal(activity[1], "start:b");
  assert.ok(activity.includes("start:c"));
});

test("once hooks are skipped on subsequent matching invocations", async () => {
  const state = { onceDigests: new Set<string>() };
  let runs = 0;
  const hooks = [baseHook({ once: true })];

  const first = await runHookMatchersForEvent({
    hooks,
    event: "PreRoleCall",
    facts: { event: "PreRoleCall" },
    state,
    executors: {
      command: async () => {
        runs += 1;
        return "first";
      },
    },
  });
  const second = await runHookMatchersForEvent({
    hooks,
    event: "PreRoleCall",
    facts: { event: "PreRoleCall" },
    state,
    executors: {
      command: async () => {
        runs += 1;
        return "second";
      },
    },
  });

  assert.equal(runs, 1);
  assert.equal(first[0]?.status, "executed");
  assert.equal(second[0]?.status, "skipped_once");
});
