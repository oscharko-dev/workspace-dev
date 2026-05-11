import assert from "node:assert/strict";
import test from "node:test";
import {
  isForbiddenUiAssetPath,
  isWorkspaceProjectRoute,
  parseImportSessionRoute,
  parseJobFilesRoute,
  parseJobPreviewRoute,
  parseJobRoute,
  parseReproRoute,
  resolveUiAssetPath,
  shouldFallbackToUiEntrypoint,
  validateSourceFilePath,
} from "./routes.js";

test("resolveUiAssetPath resolves index and nested asset paths", () => {
  assert.equal(resolveUiAssetPath("/workspace/ui"), "index.html");
  assert.equal(resolveUiAssetPath("/workspace/ui/"), "index.html");
  assert.equal(
    resolveUiAssetPath("/workspace/ui/assets/main-HASH.js"),
    "assets/main-HASH.js",
  );
  assert.equal(
    resolveUiAssetPath("/workspace/ui/assets/chunks/vendor-HASH.js"),
    "assets/chunks/vendor-HASH.js",
  );
  assert.equal(resolveUiAssetPath("/workspace/ui/../index.html"), null);
  assert.equal(
    resolveUiAssetPath("/workspace/ui/%2e%2e%2f%2e%2e%2fetc%2fpasswd"),
    null,
  );
  assert.equal(resolveUiAssetPath("/workspace/ui/assets%00app.js"), null);
  assert.equal(
    resolveUiAssetPath("/workspace/ui/..%5C..%5Cwindows%5Cwin.ini"),
    null,
  );
  assert.equal(resolveUiAssetPath("/other"), null);
});

test("UI route helpers reject traversal before SPA fallback", () => {
  assert.equal(
    isForbiddenUiAssetPath("/workspace/ui/%2e%2e%2f%2e%2e%2fetc%2fpasswd"),
    true,
  );
  assert.equal(
    isForbiddenUiAssetPath("/workspace/ui/..%5C..%5Cwindows%5Cwin.ini"),
    true,
  );
  assert.equal(isForbiddenUiAssetPath("/workspace/ui/assets%00app.js"), true);
  assert.equal(
    shouldFallbackToUiEntrypoint(
      "/workspace/ui/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    ),
    false,
  );
  assert.equal(shouldFallbackToUiEntrypoint("/workspace/ui/visual-quality"), true);
});

test("isWorkspaceProjectRoute accepts only workspace key routes", () => {
  assert.equal(isWorkspaceProjectRoute("/workspace/proj-123"), true);
  assert.equal(isWorkspaceProjectRoute("/workspace/"), false);
  assert.equal(isWorkspaceProjectRoute("/outside/proj-123"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/ui"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/submit"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/inspector-policy"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/jobs"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/repros"), false);
  assert.equal(isWorkspaceProjectRoute("/workspace/proj-123/nested"), false);
});

test("parseJobRoute parses detail/result routes and rejects invalid forms", () => {
  assert.equal(parseJobRoute("/workspace"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs/"), undefined);
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1"), {
    jobId: "job-1",
    action: "status",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/result"), {
    jobId: "job-1",
    action: "result",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/cancel"), {
    jobId: "job-1",
    action: "cancel",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/design-ir"), {
    jobId: "job-1",
    action: "design-ir",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/figma-analysis"), {
    jobId: "job-1",
    action: "figma-analysis",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/component-manifest"), {
    jobId: "job-1",
    action: "component-manifest",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/screenshot"), {
    jobId: "job-1",
    action: "screenshot",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/regenerate"), {
    jobId: "job-1",
    action: "regenerate",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/retry-stage"), {
    jobId: "job-1",
    action: "retry-stage",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/sync"), {
    jobId: "job-1",
    action: "sync",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/create-pr"), {
    jobId: "job-1",
    action: "create-pr",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/stale-check"), {
    jobId: "job-1",
    action: "stale-check",
  });
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/token-intelligence"), {
    jobId: "job-1",
    action: "token-intelligence",
  });
  assert.equal(parseJobRoute("/workspace/jobs//token-intelligence"), undefined);
  assert.deepEqual(parseJobRoute("/workspace/jobs/job-1/token-decisions"), {
    jobId: "job-1",
    action: "token-decisions",
  });
  assert.equal(parseJobRoute("/workspace/jobs//token-decisions"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs/job-1/extra"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//result"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//cancel"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//design-ir"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//figma-analysis"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//component-manifest"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//screenshot"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//regenerate"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//retry-stage"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//sync"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//create-pr"), undefined);
  assert.equal(parseJobRoute("/workspace/jobs//stale-check"), undefined);
});

test("parseImportSessionRoute parses list, detail, and reimport routes", () => {
  assert.deepEqual(parseImportSessionRoute("/workspace/import-sessions"), {
    sessionId: "",
    action: "detail",
  });
  assert.deepEqual(
    parseImportSessionRoute("/workspace/import-sessions/session-1"),
    {
      sessionId: "session-1",
      action: "detail",
    },
  );
  assert.deepEqual(
    parseImportSessionRoute("/workspace/import-sessions/session-1/reimport"),
    {
      sessionId: "session-1",
      action: "reimport",
    },
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/session-1/extra"),
    undefined,
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/"),
    undefined,
  );
});

test("parseImportSessionRoute parses events routes and rejects malformed ones", () => {
  assert.deepEqual(
    parseImportSessionRoute("/workspace/import-sessions/session-1/events"),
    {
      sessionId: "session-1",
      action: "events",
    },
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions//events"),
    undefined,
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/session-1/events/foo"),
    undefined,
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/session-1/events/"),
    undefined,
  );
});

test("parseImportSessionRoute parses approve routes and rejects malformed ones", () => {
  assert.deepEqual(
    parseImportSessionRoute("/workspace/import-sessions/session-1/approve"),
    {
      sessionId: "session-1",
      action: "approve",
    },
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions//approve"),
    undefined,
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/session-1/approve/foo"),
    undefined,
  );
  assert.equal(
    parseImportSessionRoute("/workspace/import-sessions/session-1/approve/"),
    undefined,
  );
});

test("parseReproRoute parses preview paths with safe index fallback", () => {
  assert.equal(parseReproRoute("/workspace"), undefined);
  assert.equal(parseReproRoute("/workspace/repros/"), undefined);
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9"), {
    jobId: "job-9",
    previewPath: "index.html",
  });
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9/"), {
    jobId: "job-9",
    previewPath: "index.html",
  });
  assert.deepEqual(parseReproRoute("/workspace/repros/job-9/assets/app.js"), {
    jobId: "job-9",
    previewPath: "assets/app.js",
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
    filePath: undefined,
  });
  assert.deepEqual(parseJobFilesRoute("/workspace/jobs/job-1/files/"), {
    jobId: "job-1",
    filePath: undefined,
  });

  // Single file
  assert.deepEqual(
    parseJobFilesRoute("/workspace/jobs/job-1/files/src/App.tsx"),
    {
      jobId: "job-1",
      filePath: "src/App.tsx",
    },
  );
  assert.deepEqual(
    parseJobFilesRoute("/workspace/jobs/job-1/files/src/screens/Home.tsx"),
    {
      jobId: "job-1",
      filePath: "src/screens/Home.tsx",
    },
  );

  // Empty jobId
  assert.equal(parseJobFilesRoute("/workspace/jobs//files"), undefined);
  assert.equal(
    parseJobFilesRoute("/workspace/jobs//files/src/App.tsx"),
    undefined,
  );
});

test("parseJobPreviewRoute parses root and nested preview assets", () => {
  assert.equal(parseJobPreviewRoute("/workspace"), undefined);
  assert.equal(parseJobPreviewRoute("/workspace/jobs/job-1"), undefined);
  assert.equal(parseJobPreviewRoute("/workspace/jobs/job-1/files"), undefined);

  assert.deepEqual(parseJobPreviewRoute("/workspace/jobs/job-1/preview"), {
    jobId: "job-1",
    previewPath: "index.html",
  });
  assert.deepEqual(parseJobPreviewRoute("/workspace/jobs/job-1/preview/"), {
    jobId: "job-1",
    previewPath: "index.html",
  });
  assert.deepEqual(
    parseJobPreviewRoute("/workspace/jobs/job-1/preview/assets/app.js"),
    {
      jobId: "job-1",
      previewPath: "assets/app.js",
    },
  );

  assert.equal(parseJobPreviewRoute("/workspace/jobs//preview"), undefined);
});

test("validateSourceFilePath allows valid source paths", () => {
  assert.deepEqual(validateSourceFilePath("src/App.tsx"), {
    valid: true,
    normalizedPath: "src/App.tsx",
  });
  assert.deepEqual(validateSourceFilePath("src/screens/Home.tsx"), {
    valid: true,
    normalizedPath: "src/screens/Home.tsx",
  });
  assert.deepEqual(validateSourceFilePath("src/theme/theme.ts"), {
    valid: true,
    normalizedPath: "src/theme/theme.ts",
  });
  assert.deepEqual(validateSourceFilePath("src/theme/tokens.json"), {
    valid: true,
    normalizedPath: "src/theme/tokens.json",
  });
  assert.deepEqual(validateSourceFilePath("public/index.html"), {
    valid: true,
    normalizedPath: "public/index.html",
  });
  assert.deepEqual(validateSourceFilePath("src/styles/main.css"), {
    valid: true,
    normalizedPath: "src/styles/main.css",
  });
  assert.deepEqual(validateSourceFilePath("public/logo.svg"), {
    valid: true,
    normalizedPath: "public/logo.svg",
  });
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

test("validateSourceFilePath rejects backslash-based traversal", () => {
  assert.equal(validateSourceFilePath("..\\..\\etc\\passwd").valid, false);
  assert.equal(validateSourceFilePath("src\\..\\..\\etc\\passwd").valid, false);
});

test("validateSourceFilePath rejects blocked directories via backslash", () => {
  assert.equal(
    validateSourceFilePath("node_modules\\react\\index.ts").valid,
    false,
  );
  assert.equal(validateSourceFilePath("dist\\bundle.ts").valid, false);
  assert.equal(
    validateSourceFilePath("src\\node_modules\\evil.ts").valid,
    false,
  );
});

test("validateSourceFilePath rejects Windows absolute paths", () => {
  assert.equal(
    validateSourceFilePath("C:\\Windows\\System32\\cmd.ts").valid,
    false,
  );
  assert.equal(validateSourceFilePath("c:/Users/evil.ts").valid, false);
});

test("validateSourceFilePath rejects UNC paths", () => {
  assert.equal(
    validateSourceFilePath("\\\\server\\share\\file.ts").valid,
    false,
  );
  assert.equal(validateSourceFilePath("//server/share/file.ts").valid, false);
});

test("validateSourceFilePath normalizes valid backslash paths to POSIX equivalents", () => {
  assert.deepEqual(validateSourceFilePath("src\\App.tsx"), {
    valid: true,
    normalizedPath: "src/App.tsx",
  });
  assert.deepEqual(validateSourceFilePath("src\\screens\\Home.tsx"), {
    valid: true,
    normalizedPath: "src/screens/Home.tsx",
  });
});
