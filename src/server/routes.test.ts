import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceProjectRoute,
  parseJobRoute,
  parseReproRoute,
  resolveUiAssetPath
} from "./routes.js";

test("resolveUiAssetPath resolves index and nested asset paths", () => {
  assert.equal(resolveUiAssetPath("/workspace/ui"), "index.html");
  assert.equal(resolveUiAssetPath("/workspace/ui/"), "index.html");
  assert.equal(resolveUiAssetPath("/workspace/ui/assets/main-HASH.js"), "assets/main-HASH.js");
  assert.equal(resolveUiAssetPath("/workspace/ui/assets/chunks/vendor-HASH.js"), "assets/chunks/vendor-HASH.js");
  assert.equal(resolveUiAssetPath("/workspace/ui/../index.html"), null);
  assert.equal(resolveUiAssetPath("/other"), null);
});

test("isWorkspaceProjectRoute accepts only workspace key routes", () => {
  assert.equal(isWorkspaceProjectRoute("/workspace/proj-123"), true);
  assert.equal(isWorkspaceProjectRoute("/workspace/"), false);
  assert.equal(isWorkspaceProjectRoute("/outside/proj-123"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/ui"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/submit"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/jobs"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/repros"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/proj-123/nested"), false);
});

test("parseJobRoute parses detail/result routes and rejects invalid forms", () => {
  assert.equal(parseJobRoute("/workspace"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs/"), undefined);
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1"), {
    jobId: "job-1",
    action: "status"
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/result"), {
    jobId: "job-1",
    action: "result"
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/cancel"), {
    jobId: "job-1",
    action: "cancel"
  });
  assert.equal(parseJobRoute("/workspace/jobs/job-1/extra"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//result"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//cancel"), undefined);
});

test("parseReproRoute parses preview paths with safe index fallback", () => {
  assert.equal(parseReproRoute("/workspace"), undefined);
  assert.equal(parseReproRoute("/workspace/repros/"), undefined);
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9"), {
    jobId: "job-9",
    previewPath: "index.html"
  });
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9/"), {
    jobId: "job-9",
    previewPath: "index.html"
  });
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9/assets/app.js"), {
    jobId: "job-9",
    previewPath: "assets/app.js"
  });
  assert.equal(parseReproRoute("/workspace/repros//assets/app.js"), undefined);
});
