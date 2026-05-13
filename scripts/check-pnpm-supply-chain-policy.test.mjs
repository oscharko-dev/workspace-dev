import { test } from "node:test";
import assert from "node:assert";
import {
  checkWorkspacePolicy,
  parseSimpleYaml,
  runGuard,
} from "./check-pnpm-supply-chain-policy.mjs";

const rootTarget = {
  label: "root",
  workspaceRel: "pnpm-workspace.yaml",
  minimumReleaseAge: 10080,
  minimumReleaseAgeExclude: ["fast-uri"],
};

const compliantRoot = [
  "packages:",
  "  - .",
  "minimumReleaseAge: 10080",
  "minimumReleaseAgeExclude:",
  "  - fast-uri",
  "strictDepBuilds: true",
  "allowBuilds: {}",
  "dangerouslyAllowAllBuilds: false",
  "blockExoticSubdeps: true",
  "trustPolicy: no-downgrade",
  "trustPolicyIgnoreAfter: 525600",
].join("\n");

test("parseSimpleYaml parses scalars, arrays, and empty maps", () => {
  assert.deepStrictEqual(parseSimpleYaml(compliantRoot), {
    packages: ["."],
    minimumReleaseAge: 10080,
    minimumReleaseAgeExclude: ["fast-uri"],
    strictDepBuilds: true,
    allowBuilds: {},
    dangerouslyAllowAllBuilds: false,
    blockExoticSubdeps: true,
    trustPolicy: "no-downgrade",
    trustPolicyIgnoreAfter: 525600,
  });
});

test("checkWorkspacePolicy passes compliant policy", () => {
  assert.deepStrictEqual(checkWorkspacePolicy(compliantRoot, rootTarget), []);
});

test("checkWorkspacePolicy rejects too-small release age", () => {
  const violations = checkWorkspacePolicy(
    compliantRoot.replace("minimumReleaseAge: 10080", "minimumReleaseAge: 60"),
    rootTarget,
  );
  assert.ok(violations.some((entry) => entry.includes("minimumReleaseAge")));
});

test("checkWorkspacePolicy rejects install-script allow grants", () => {
  const content = compliantRoot.replace(
    "allowBuilds: {}",
    ["allowBuilds:", "  esbuild: true"].join("\n"),
  );
  const violations = checkWorkspacePolicy(content, rootTarget);
  assert.ok(violations.some((entry) => entry.includes("allowBuilds.esbuild")));
});

test("checkWorkspacePolicy rejects missing exotic dependency block", () => {
  const violations = checkWorkspacePolicy(
    compliantRoot.replace(
      "blockExoticSubdeps: true",
      "blockExoticSubdeps: false",
    ),
    rootTarget,
  );
  assert.ok(violations.some((entry) => entry.includes("blockExoticSubdeps")));
});

test("runGuard reports all policy files", async () => {
  const logs = [];
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    targets: [rootTarget],
    readTextFile: async () => compliantRoot,
    stdout: (msg) => logs.push(msg),
    stderr: (msg) => errs.push(msg),
  });

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(errs.length, 0);
  assert.ok(logs[0]?.includes("Passed"));
});
