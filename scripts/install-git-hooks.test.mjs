import { test } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { runInstall } from "./install-git-hooks.mjs";

const makeExecFileRecorder = ({ failOn } = {}) => {
  const calls = [];
  const execFile = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (failOn && failOn.cmd === cmd && failOn.match(args)) {
      throw new Error(failOn.message ?? "simulated failure");
    }
    return "";
  };
  return { execFile, calls };
};

// ── CI short-circuit ────────────────────────────────────────────────────────

test("runInstall: skips in CI and does not invoke git", () => {
  const out = [];
  const { execFile, calls } = makeExecFileRecorder();
  const code = runInstall({
    cwd: "/repo",
    env: { CI: "true" },
    execFile,
    stdout: (m) => out.push(m),
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(calls.length, 0);
  assert.ok(out.some((m) => m.includes("Skipping hook installation in CI")));
});

test("runInstall: does not skip when CI is not exactly 'true'", () => {
  for (const ciValue of ["", "false", "1", undefined]) {
    const { execFile, calls } = makeExecFileRecorder();
    runInstall({
      cwd: "/repo",
      env: ciValue === undefined ? {} : { CI: ciValue },
      execFile,
      stdout: () => {},
    });
    assert.ok(
      calls.length >= 2,
      `expected git calls for CI=${JSON.stringify(ciValue)}`,
    );
  }
});

// ── git sanity check ────────────────────────────────────────────────────────

test("runInstall: invokes git rev-parse --git-dir first", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  assert.ok(calls.length >= 1);
  assert.strictEqual(calls[0].cmd, "git");
  assert.deepStrictEqual(calls[0].args, ["rev-parse", "--git-dir"]);
});

test("runInstall: surfaces error if rev-parse fails (not a git repo)", () => {
  const { execFile } = makeExecFileRecorder({
    failOn: {
      cmd: "git",
      match: (args) => args[0] === "rev-parse",
      message: "fatal: not a git repository",
    },
  });
  assert.throws(
    () =>
      runInstall({ cwd: "/not-a-repo", env: {}, execFile, stdout: () => {} }),
    /not a git repository/,
  );
});

// ── hooksPath computation ───────────────────────────────────────────────────

test("runInstall: writes absolute hooksPath derived from cwd", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  const configCall = calls.find(
    (c) => c.cmd === "git" && c.args[0] === "config",
  );
  assert.ok(configCall, "expected a git config invocation");
  const hooksPathArg = configCall.args[configCall.args.length - 1];
  assert.strictEqual(hooksPathArg, path.join("/repo", ".githooks"));
  assert.ok(
    path.isAbsolute(hooksPathArg),
    "hooksPath must be absolute to avoid gitdir-relative resolution",
  );
});

test("runInstall: derives hooksPath from the provided cwd (worktree case)", () => {
  const worktreeCwd = "/repo/.claude/worktrees/feature-x";
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: worktreeCwd, env: {}, execFile, stdout: () => {} });
  const configCall = calls.find(
    (c) => c.cmd === "git" && c.args[0] === "config",
  );
  const hooksPathArg = configCall.args[configCall.args.length - 1];
  assert.strictEqual(hooksPathArg, path.join(worktreeCwd, ".githooks"));
});

// ── --worktree flag ─────────────────────────────────────────────────────────

test("runInstall: passes --worktree to scope config to the active working tree", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  const configCall = calls.find(
    (c) => c.cmd === "git" && c.args[0] === "config",
  );
  assert.ok(configCall, "expected a git config invocation");
  assert.ok(
    configCall.args.includes("--worktree"),
    `expected --worktree flag in args; got ${JSON.stringify(configCall.args)}`,
  );
  assert.ok(configCall.args.includes("core.hooksPath"));
});

test("runInstall: git config args are exactly [config, --worktree, core.hooksPath, <path>]", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  const configCall = calls.find(
    (c) => c.cmd === "git" && c.args[0] === "config",
  );
  assert.deepStrictEqual(configCall.args, [
    "config",
    "--worktree",
    "core.hooksPath",
    path.join("/repo", ".githooks"),
  ]);
});

// ── ordering & cwd propagation ──────────────────────────────────────────────

test("runInstall: rev-parse runs before config write", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  const revParseIdx = calls.findIndex((c) => c.args[0] === "rev-parse");
  const configIdx = calls.findIndex((c) => c.args[0] === "config");
  assert.ok(revParseIdx >= 0 && configIdx > revParseIdx);
});

test("runInstall: all git calls use the provided cwd", () => {
  const { execFile, calls } = makeExecFileRecorder();
  runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} });
  for (const c of calls) {
    assert.strictEqual(c.opts.cwd, "/repo");
  }
});

// ── stdout & return contract ────────────────────────────────────────────────

test("runInstall: returns 0 and reports configured path on success", () => {
  const out = [];
  const { execFile } = makeExecFileRecorder();
  const code = runInstall({
    cwd: "/repo",
    env: {},
    execFile,
    stdout: (m) => out.push(m),
  });
  assert.strictEqual(code, 0);
  const expected = path.join("/repo", ".githooks");
  assert.ok(
    out.some((m) => m.includes(expected)),
    `expected stdout to mention ${expected}; got ${JSON.stringify(out)}`,
  );
});

test("runInstall: surfaces error if git config write fails", () => {
  const { execFile } = makeExecFileRecorder({
    failOn: {
      cmd: "git",
      match: (args) => args[0] === "config",
      message: "fatal: extensions.worktreeConfig not enabled",
    },
  });
  assert.throws(
    () => runInstall({ cwd: "/repo", env: {}, execFile, stdout: () => {} }),
    /worktreeConfig/,
  );
});
