import assert from "node:assert/strict";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };

test("package manifest exposes repository metadata for npm consumers", () => {
  assert.equal(packageJson.repository.type, "git");
  assert.equal(packageJson.repository.url, "git+https://github.com/oscharko-dev/workspace-dev.git");
  assert.equal(packageJson.homepage, "https://github.com/oscharko-dev/workspace-dev#readme");
  assert.equal(packageJson.bugs.url, "https://github.com/oscharko-dev/workspace-dev/issues");
});
