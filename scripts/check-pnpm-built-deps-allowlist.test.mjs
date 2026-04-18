import { test } from "node:test";
import assert from "node:assert";
import { parseLockfile, runCheck } from "./check-pnpm-built-deps-allowlist.mjs";

// ── parseLockfile ─────────────────────────────────────────────────────────────

test("parseLockfile: empty string returns empty sets", () => {
  const { knownPackages, requiresBuildPackages } = parseLockfile("");
  assert.strictEqual(knownPackages.size, 0);
  assert.strictEqual(requiresBuildPackages.size, 0);
});

test("parseLockfile: simple package entry adds bare name", () => {
  const content = "  esbuild@0.27.3:\n    resolution: {}\n";
  const { knownPackages } = parseLockfile(content);
  assert.ok(knownPackages.has("esbuild"), "esbuild should be known");
  assert.strictEqual(knownPackages.size, 1);
});

test("parseLockfile: strips simple version to get bare package name", () => {
  const content = "  vite@8.0.8:\n    resolution: {}\n";
  const { knownPackages } = parseLockfile(content);
  assert.ok(knownPackages.has("vite"), "vite should be known without version");
});

test("parseLockfile: strips leading slash (pnpm v5/v6 format)", () => {
  const content = "  /esbuild@0.21.5:\n    resolution: {}\n";
  const { knownPackages } = parseLockfile(content);
  assert.ok(knownPackages.has("esbuild"), "leading slash stripped");
});

test("parseLockfile: scoped package is recorded with scope", () => {
  const content = "  @vitejs/plugin-react@4.2.2:\n    resolution: {}\n";
  const { knownPackages } = parseLockfile(content);
  assert.ok(
    knownPackages.has("@vitejs/plugin-react"),
    "scoped package name preserved",
  );
});

test("parseLockfile: package with requiresBuild goes into requiresBuildPackages", () => {
  const content =
    "  native-addon@1.0.0:\n    resolution: {}\n    requiresBuild: true\n";
  const { knownPackages, requiresBuildPackages } = parseLockfile(content);
  assert.ok(knownPackages.has("native-addon"));
  assert.ok(requiresBuildPackages.has("native-addon"));
  assert.strictEqual(requiresBuildPackages.size, 1);
});

test("parseLockfile: requiresBuild on non-build package is ignored", () => {
  const content =
    "  esbuild@0.27.3:\n    resolution: {}\n" +
    "  native-addon@1.0.0:\n    resolution: {}\n    requiresBuild: true\n";
  const { requiresBuildPackages } = parseLockfile(content);
  assert.ok(
    !requiresBuildPackages.has("esbuild"),
    "esbuild has no requiresBuild",
  );
  assert.ok(requiresBuildPackages.has("native-addon"));
});

test("parseLockfile: requiresBuild without preceding package key is ignored", () => {
  const content = "    requiresBuild: true\n";
  const { requiresBuildPackages } = parseLockfile(content);
  assert.strictEqual(requiresBuildPackages.size, 0);
});

test("parseLockfile: multiple packages, only one with requiresBuild", () => {
  const content = [
    "  alpha@1.0.0:",
    "    resolution: {}",
    "  beta@2.0.0:",
    "    resolution: {}",
    "    requiresBuild: true",
    "  gamma@3.0.0:",
    "    resolution: {}",
  ].join("\n");
  const { knownPackages, requiresBuildPackages } = parseLockfile(content);
  assert.strictEqual(knownPackages.size, 3);
  assert.ok(requiresBuildPackages.has("beta"));
  assert.strictEqual(requiresBuildPackages.size, 1);
});

test("parseLockfile: scoped package with requiresBuild", () => {
  const content =
    "  @parcel/watcher@2.5.1:\n    resolution: {}\n    requiresBuild: true\n";
  const { requiresBuildPackages } = parseLockfile(content);
  assert.ok(requiresBuildPackages.has("@parcel/watcher"));
});

test("parseLockfile: lines that are not package keys are not recorded", () => {
  const content = [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "",
    "  esbuild@0.27.3:",
    "    resolution: {}",
  ].join("\n");
  const { knownPackages } = parseLockfile(content);
  // Only the indented package key should match
  assert.ok(knownPackages.has("esbuild"));
  assert.strictEqual(knownPackages.size, 1);
});

// ── runCheck ──────────────────────────────────────────────────────────────────

// Relative paths used as keys; makeFiles expands them to full /fake/... paths
// so exact matching avoids the endsWith ambiguity between "package.json" and
// "template/react-mui-app/package.json".
const ROOT_PKG_PATH = "package.json";
const ROOT_LOCK_PATH = "pnpm-lock.yaml";
const TMPL_PKG_PATH = "template/react-mui-app/package.json";
const TMPL_LOCK_PATH = "template/react-mui-app/pnpm-lock.yaml";
const FAKE_ROOT = "/fake";
const full = (rel) => `${FAKE_ROOT}/${rel}`;

const makeFiles = (overrides = {}) => {
  const defaults = {
    [full(ROOT_PKG_PATH)]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: [] },
    }),
    [full(ROOT_LOCK_PATH)]: "",
    [full(TMPL_PKG_PATH)]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: [] },
    }),
    [full(TMPL_LOCK_PATH)]: "",
  };
  const normalizedOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    normalizedOverrides[full(k)] = v;
  }
  return { ...defaults, ...normalizedOverrides };
};

const runWith = async (files, extraOpts = {}) => {
  const logs = [];
  const errs = [];
  const readTextFile = async (filePath) => {
    if (Object.prototype.hasOwnProperty.call(files, filePath)) {
      const val = files[filePath];
      if (val instanceof Error) throw val;
      return val;
    }
    throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
  };
  const code = await runCheck({
    packageRoot: FAKE_ROOT,
    readTextFile,
    stdout: (msg) => logs.push(msg),
    stderr: (msg) => errs.push(msg),
    ...extraOpts,
  });
  return { code, logs, errs };
};

test("runCheck: passes when both targets have empty allowlist and no requiresBuild", async () => {
  const { code } = await runWith(makeFiles());
  assert.strictEqual(code, 0);
});

test("runCheck: reports violation when root package.json has no pnpm block", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({}),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(
    errs.some((e) => e.includes("missing pnpm.onlyBuiltDependencies")),
    `Expected missing-field message, got: ${errs.join("\n")}`,
  );
});

test("runCheck: reports violation when template package.json has no pnpm block", async () => {
  const files = makeFiles({
    [TMPL_PKG_PATH]: JSON.stringify({}),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(
    errs.some(
      (e) =>
        e.includes("template") &&
        e.includes("missing pnpm.onlyBuiltDependencies"),
    ),
  );
});

test("runCheck: reports violation when onlyBuiltDependencies is not an array (string)", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: "esbuild" },
    }),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(errs.some((e) => e.includes("missing pnpm.onlyBuiltDependencies")));
});

test("runCheck: reports violation when onlyBuiltDependencies is null", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: null },
    }),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
});

test("runCheck: reports violation for stale allowlist entry not in lockfile", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: ["nonexistent-pkg"] },
    }),
    [ROOT_LOCK_PATH]: "  esbuild@0.27.3:\n    resolution: {}\n",
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(
    errs.some(
      (e) => e.includes("nonexistent-pkg") && e.includes("does not appear"),
    ),
  );
});

test("runCheck: passes when allowlist entry exists in lockfile", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: ["esbuild"] },
    }),
    [ROOT_LOCK_PATH]: "  esbuild@0.27.3:\n    resolution: {}\n",
  });
  const { code } = await runWith(files);
  assert.strictEqual(code, 0);
});

test("runCheck: reports violation when requiresBuild package missing from allowlist", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({ pnpm: { onlyBuiltDependencies: [] } }),
    [ROOT_LOCK_PATH]:
      "  native-addon@1.0.0:\n    resolution: {}\n    requiresBuild: true\n",
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(
    errs.some(
      (e) => e.includes("native-addon") && e.includes("requiresBuild: true"),
    ),
  );
});

test("runCheck: passes when requiresBuild package is in allowlist", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: ["native-addon"] },
    }),
    [ROOT_LOCK_PATH]:
      "  native-addon@1.0.0:\n    resolution: {}\n    requiresBuild: true\n",
  });
  const { code } = await runWith(files);
  assert.strictEqual(code, 0);
});

test("runCheck: reports violation on package.json read error", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: new Error("permission denied"),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(errs.some((e) => e.includes("Could not read")));
});

test("runCheck: reports violation on lockfile read error", async () => {
  const files = makeFiles({
    [ROOT_LOCK_PATH]: new Error("disk error"),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  assert.ok(errs.some((e) => e.includes("Could not read")));
});

test("runCheck: accumulates violations from both targets", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({}),
    [TMPL_PKG_PATH]: JSON.stringify({}),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  const msgs = errs.join("\n");
  assert.ok(msgs.includes("[root]"), "should report root violation");
  assert.ok(msgs.includes("[template]"), "should report template violation");
});

test("runCheck: still passes other target when first target has read error", async () => {
  const files = makeFiles({
    [ROOT_PKG_PATH]: new Error("ENOENT"),
  });
  const { code, errs } = await runWith(files);
  assert.strictEqual(code, 1);
  const msgs = errs.join("\n");
  assert.ok(msgs.includes("[root]"), "root violation reported");
  // template should still be checked and pass (no error message for template)
  assert.ok(
    !msgs.includes("[template]") || !msgs.includes("Could not read"),
    "template passes independently",
  );
});

test("runCheck: plural vs singular entry label in success message", async () => {
  const filesOne = makeFiles({
    [ROOT_PKG_PATH]: JSON.stringify({
      pnpm: { onlyBuiltDependencies: ["esbuild"] },
    }),
    [ROOT_LOCK_PATH]: "  esbuild@0.27.3:\n    resolution: {}\n",
  });
  const { logs: logsOne } = await runWith(filesOne);
  assert.ok(logsOne.some((l) => l.includes("1 entry,")));

  const filesZero = makeFiles();
  const { logs: logsZero } = await runWith(filesZero);
  assert.ok(logsZero.some((l) => l.includes("0 entries,")));
});
