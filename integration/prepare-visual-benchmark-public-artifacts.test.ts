import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("prepare-visual-benchmark-public-artifacts omits PR comment payloads from the public bundle", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visual-benchmark-public-"));
  const artifactsDir = path.join(tmpDir, "artifacts", "visual-benchmark");
  await mkdir(artifactsDir, { recursive: true });

  await writeFile(
    path.join(artifactsDir, "last-run.json"),
    `${JSON.stringify({
      version: 2,
      ranAt: "2026-04-18T00:00:00.000Z",
      scores: [{ fixtureId: "fixture-a", score: 91 }],
      warnings: ["contains figd_secret_value"],
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactsDir, "check-output.json"),
    `${JSON.stringify({
      title: "Visual benchmark",
      summary: "see https://api.figma.com/v1/files/abc123",
      text: "ok",
      annotations: [],
    })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(artifactsDir, "pr-comment.json"),
    `${JSON.stringify({
      marker: "<!-- workspace-dev-visual-benchmark -->",
      body: "<!-- workspace-dev-visual-benchmark -->\nmalicious markdown",
    })}\n`,
    "utf8",
  );

  await execFileAsync(
    "node",
    [
      path.join(
        process.cwd(),
        "scripts",
        "prepare-visual-benchmark-public-artifacts.mjs",
      ),
    ],
    { cwd: tmpDir },
  );

  const publicDir = path.join(artifactsDir, "public-summary");
  const publicLastRun = JSON.parse(
    await readFile(path.join(publicDir, "last-run.public.json"), "utf8"),
  ) as { warnings?: string[] };
  const publicCheckOutput = JSON.parse(
    await readFile(path.join(publicDir, "check-output.public.json"), "utf8"),
  ) as { summary?: string };

  assert.deepEqual(publicLastRun.warnings, ["contains [redacted-token]"]);
  assert.equal(
    publicCheckOutput.summary,
    "see https://api.figma.com/v1/files/[redacted]",
  );
  await assert.rejects(stat(path.join(publicDir, "pr-comment.json")));
});
