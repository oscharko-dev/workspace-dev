import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceProjectRoute,
  parseJobFilesRoute,
  parseJobRoute,
  parseReproRoute,
  resolveUiAssetPath,
  validateSourceFilePath
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
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/design-ir"), {
    jobId: "job-1",
    action: "design-ir"
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/component-manifest"), {
    jobId: "job-1",
    action: "component-manifest"
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/sync"), {
    jobId: "job-1",
    action: "sync"
  });
  assert.equal(parseJobRoute("/workspace/jobs/job-1/extra"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//result"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//cancel"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//design-ir"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//component-manifest"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//sync"), undefined);
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

test("parseJobFilesRoute parses directory listing and file content routes", () => {
  // Non-matching
  assert.equal(parseJobFilesRoute("/workspace"), undefined);
  assert.equal(parseJobFilesRoute("/workspace/jobs/"), undefined);
  assert.equal(parseJobFilesRoute("/workspace/jobs/job-1"), undefined);
  assert.equal(parseJobFilesRoute("/workspace/jobs/job-1/result"), undefined);

  // Directory listing
  assert.deepEqual(parseJobFilesRoute("/workspace/jobs/job-1/files"), {
    jobId: "job-1",
    filePath: undefined
  });
  assert.deepEqual(parseJobFilesRoute("/workspace/jobs/job-1/files/"), {
    jobId: "job-1",
    filePath: undefined
  });

  // Single file
  assert.deepEqual(parseJobFilesRoute("/workspace/jobs/job-1/files/src/App.tsx"), {
    jobId: "job-1",
    filePath: "src/App.tsx"
  });
  assert.deepEqual(parseJobFilesRoute("/workspace/jobs/job-1/files/src/screens/Home.tsx"), {
    jobId: "job-1",
    filePath: "src/screens/Home.tsx"
  });

  // Empty jobId
  assert.equal(parseJobFilesRoute("/workspace/jobs//files"), undefined);
  assert.equal(parseJobFilesRoute("/workspace/jobs//files/src/App.tsx"), undefined);
});

test("validateSourceFilePath allows valid source paths", () => {
  assert.deepEqual(validateSourceFilePath("src/App.tsx"), { valid: true });
  assert.deepEqual(validateSourceFilePath("src/screens/Home.tsx"), { valid: true });
  assert.deepEqual(validateSourceFilePath("src/theme/theme.ts"), { valid: true });
  assert.deepEqual(validateSourceFilePath("src/theme/tokens.json"), { valid: true });
  assert.deepEqual(validateSourceFilePath("public/index.html"), { valid: true });
  assert.deepEqual(validateSourceFilePath("src/styles/main.css"), { valid: true });
  assert.deepEqual(validateSourceFilePath("public/logo.svg"), { valid: true });
});

test("validateSourceFilePath rejects path traversal attempts", () => {
  const result1 = validateSourceFilePath("../../../etc/passwd");
  assert.equal(result1.valid, false);

  const result2 = validateSourceFilePath("src/../../../etc/passwd");
  assert.equal(result2.valid, false);

  const result3 = validateSourceFilePath("src/screens/../../secret.ts");
  assert.equal(result3.valid, false);
});

test("validateSourceFilePath rejects absolute paths", () => {
  const result = validateSourceFilePath("/etc/passwd");
  assert.equal(result.valid, false);
});

test("validateSourceFilePath rejects blocked directories", () => {
  const result1 = validateSourceFilePath("node_modules/react/index.ts");
  assert.equal(result1.valid, false);

  const result2 = validateSourceFilePath("dist/bundle.js");
  assert.equal(result2.valid, false);

  const result3 = validateSourceFilePath(".env");
  assert.equal(result3.valid, false);

  // Nested node_modules
  const result4 = validateSourceFilePath("src/node_modules/evil.ts");
  assert.equal(result4.valid, false);
});

test("validateSourceFilePath rejects disallowed extensions", () => {
  const result1 = validateSourceFilePath("src/script.js");
  assert.equal(result1.valid, false);

  const result2 = validateSourceFilePath("src/data.xml");
  assert.equal(result2.valid, false);

  const result3 = validateSourceFilePath("README");
  assert.equal(result3.valid, false);
});

test("validateSourceFilePath rejects empty and null-byte paths", () => {
  const result1 = validateSourceFilePath("");
  assert.equal(result1.valid, false);

  const result2 = validateSourceFilePath("src/App\0.tsx");
  assert.equal(result2.valid, false);
});
