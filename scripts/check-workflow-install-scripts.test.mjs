import { test } from "node:test";
import assert from "node:assert";
import {
  isInstallLineViolation,
  scanWorkflowContent,
  scanPackageScripts,
} from "./check-workflow-install-scripts.mjs";

// ── isInstallLineViolation: core per-line rule ──────────────────────────────
test("isInstallLineViolation: flags `pnpm install --frozen-lockfile`", () => {
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm install --frozen-lockfile"),
    true,
  );
});

test("isInstallLineViolation: passes `pnpm install --frozen-lockfile --ignore-scripts`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm install --frozen-lockfile --ignore-scripts",
    ),
    false,
  );
});

test("isInstallLineViolation: flags `pnpm --dir foo install --frozen-lockfile`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm --dir template/react-mui-app install --frozen-lockfile",
    ),
    true,
  );
});

test("isInstallLineViolation: passes `pnpm --dir foo install --frozen-lockfile --ignore-scripts`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm --dir template/react-mui-app install --frozen-lockfile --ignore-scripts",
    ),
    false,
  );
});

test("isInstallLineViolation: allowlists `pnpm exec playwright install --with-deps`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm exec playwright install --with-deps chromium",
    ),
    false,
  );
});

test("isInstallLineViolation: allowlists `pnpm exec playwright install-deps`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm exec playwright install-deps chromium",
    ),
    false,
  );
});

test("isInstallLineViolation: allowlists bare `pnpm exec playwright install`", () => {
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm exec playwright install"),
    false,
  );
});

test("isInstallLineViolation: flags `npm install --global npm@11`", () => {
  assert.strictEqual(
    isInstallLineViolation("          npm install --global npm@11"),
    true,
  );
});

test("isInstallLineViolation: passes `npm install --global npm@11 --ignore-scripts`", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "          npm install --global npm@11 --ignore-scripts",
    ),
    false,
  );
});

test("isInstallLineViolation: flags bare `npm ci`", () => {
  assert.strictEqual(isInstallLineViolation("        run: npm ci"), true);
});

test("isInstallLineViolation: passes `npm ci --ignore-scripts`", () => {
  assert.strictEqual(
    isInstallLineViolation("        run: npm ci --ignore-scripts"),
    false,
  );
});

test("isInstallLineViolation: flags `npm ci --prefer-offline` without --ignore-scripts", () => {
  assert.strictEqual(
    isInstallLineViolation("        run: npm ci --prefer-offline"),
    true,
  );
});

test("isInstallLineViolation: flags `pnpm install --ignore-scripts=false` (explicit override)", () => {
  // Must not let `--ignore-scripts=false` bypass the rule.
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm install --frozen-lockfile --ignore-scripts=false",
    ),
    true,
  );
});

test("isInstallLineViolation: flags `pnpm install --no-ignore-scripts` (explicit override)", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm install --frozen-lockfile --no-ignore-scripts",
    ),
    true,
  );
});

test("isInstallLineViolation: flags `pnpm --dir=path install` (equals form)", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm --dir=template/react-mui-app install --frozen-lockfile",
    ),
    true,
  );
});

test("isInstallLineViolation: flags `pnpm -C path install` (short alias)", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "        run: pnpm -C template/react-mui-app install --frozen-lockfile",
    ),
    true,
  );
});

test("isInstallLineViolation: ignores yaml comment lines with `#`", () => {
  assert.strictEqual(
    isInstallLineViolation("        # pnpm install --frozen-lockfile"),
    false,
  );
  assert.strictEqual(
    isInstallLineViolation("# npm install --global npm@11"),
    false,
  );
});

test("isInstallLineViolation: ignores empty and whitespace-only lines", () => {
  assert.strictEqual(isInstallLineViolation(""), false);
  assert.strictEqual(isInstallLineViolation("   "), false);
  assert.strictEqual(isInstallLineViolation("\t\t"), false);
});

test("isInstallLineViolation: ignores lines without install tokens", () => {
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm run typecheck"),
    false,
  );
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm audit --audit-level high"),
    false,
  );
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm run template:install"),
    false,
  );
});

test("isInstallLineViolation: flags install token even with irregular whitespace", () => {
  // Defense-in-depth: tabs/multiple spaces must not let violations through.
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm\tinstall --frozen-lockfile"),
    true,
  );
  assert.strictEqual(
    isInstallLineViolation("        run: pnpm  install --frozen-lockfile"),
    true,
  );
});

test("isInstallLineViolation: does NOT match `pnpm install` on a continuation line because guard is per-line (multi-line flag on next line)", () => {
  // The decision is single-line-only. A `pnpm install` whose --ignore-scripts
  // lives on the next line must be flagged. Exercising the guard at the
  // per-line level here: the first line alone is a violation.
  const firstLine = "        run: pnpm install --frozen-lockfile \\";
  assert.strictEqual(isInstallLineViolation(firstLine), true);
});

test("isInstallLineViolation: recognizes playwright install with leading `pnpm exec` even when surrounded by other shell tokens", () => {
  assert.strictEqual(
    isInstallLineViolation(
      "          pnpm exec playwright install --with-deps $browsers",
    ),
    false,
  );
});

// ── scanWorkflowContent: file-level scan returns line-numbered findings ─────
test("scanWorkflowContent: returns empty array for clean content", () => {
  const content = [
    "name: clean",
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: pnpm install --frozen-lockfile --ignore-scripts",
    "      - run: pnpm exec playwright install --with-deps chromium",
  ].join("\n");

  assert.deepStrictEqual(scanWorkflowContent(content), []);
});

test("scanWorkflowContent: reports 1-indexed line for each violation", () => {
  const content = [
    "name: sample",
    "        run: pnpm install --frozen-lockfile",
    "        run: pnpm install --frozen-lockfile --ignore-scripts",
    "          npm install --global npm@11",
  ].join("\n");

  const result = scanWorkflowContent(content);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].line, 2);
  assert.strictEqual(result[1].line, 4);
});

test("scanWorkflowContent: preserves trimmed content for reporting", () => {
  const content = "        run: pnpm install --frozen-lockfile";
  const result = scanWorkflowContent(content);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].content, "run: pnpm install --frozen-lockfile");
});

// ── scanPackageScripts: scans package.json scripts block for violations ─────
test("scanPackageScripts: flags script values with unsafe `pnpm --dir ... install`", () => {
  const pkg = {
    scripts: {
      "template:install":
        "pnpm --dir template/react-mui-app install --frozen-lockfile",
    },
  };
  const findings = scanPackageScripts(pkg);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].scriptName, "template:install");
});

test("scanPackageScripts: passes safe script values with --ignore-scripts", () => {
  const pkg = {
    scripts: {
      "template:install":
        "pnpm --dir template/react-mui-app install --frozen-lockfile --ignore-scripts",
    },
  };
  assert.deepStrictEqual(scanPackageScripts(pkg), []);
});

test("scanPackageScripts: ignores scripts without install tokens", () => {
  const pkg = {
    scripts: {
      typecheck: "tsc --noEmit",
      "template:test": "pnpm --dir template/react-mui-app run test",
    },
  };
  assert.deepStrictEqual(scanPackageScripts(pkg), []);
});

test("scanPackageScripts: flags bare `pnpm install` in script values", () => {
  const pkg = {
    scripts: {
      bootstrap: "pnpm install --frozen-lockfile && pnpm run build",
    },
  };
  const findings = scanPackageScripts(pkg);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].scriptName, "bootstrap");
});

test("scanPackageScripts: tolerates a missing scripts block", () => {
  assert.deepStrictEqual(scanPackageScripts({}), []);
  assert.deepStrictEqual(scanPackageScripts({ scripts: null }), []);
});
