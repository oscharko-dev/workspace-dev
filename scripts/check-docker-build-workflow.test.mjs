import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert";

test("docker-build workflow passes FIGMAPIPE_PERF_STRICT=false into the smoke container", async () => {
  const workflow = await readFile(".github/workflows/docker-build.yml", "utf8");

  assert.match(workflow, /-e FIGMAPIPE_PERF_STRICT=false\b/);
});
