import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine, resolveRuntimeSettings } from "../job-engine.js";
import { isSecuritySensitiveImport } from "./import-governance.js";
import { ensureTemplateValidationSeedNodeModules } from "./test-validation-seed.js";

const createLocalFigmaPayload = () => ({
  name: "Governance Test Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Checkout",
            absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
            children: [
              {
                id: "password-1",
                type: "TEXT",
                name: "Password",
                characters: "Password",
                absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
                style: { fontSize: 24, fontWeight: 400, lineHeightPx: 32 },
                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  // Issue #1675 (audit-2026-05): pre-bump baseline restored — see #1665.
  timeoutMs = 300_000,
}: {
  getStatus: (
    jobId: string,
  ) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (
      status &&
      (status.status === "completed" ||
        status.status === "failed" ||
        status.status === "canceled" ||
        status.status === "partial")
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for job status");
};

test.before(async () => {
  await ensureTemplateValidationSeedNodeModules();
});

test("isSecuritySensitiveImport matches plain tokens case-insensitively across manifest and generated paths", () => {
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["auth", "billing"],
      componentManifest: {
        version: 1,
        generatedAt: "2026-04-16T00:00:00.000Z",
        screens: [
          {
            screenId: "screen-1",
            screenName: "Settings",
            file: "src/screens/Settings.tsx",
            components: [
              {
                id: "component-1",
                name: "Auth token input",
                file: "src/components/AuthTokenInput.tsx",
                sourceNodeId: "node-1",
                irNodeName: "AuthTokenInput",
                irNodeType: "input",
                exportName: "AuthTokenInput",
                propsSignature: "type Props = {};",
              },
            ],
          },
        ],
      },
      generatedPaths: ["src/routes/BILLING/Overview.tsx"],
    }),
    true,
  );
});

test("isSecuritySensitiveImport matches literal metacharacter tokens as plain text", () => {
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["(auth)"],
      generatedPaths: ["src/routes/auth/Users.tsx"],
    }),
    false,
  );
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["C++"],
      generatedPaths: ["src/lib/c++/Parser.ts"],
    }),
    true,
  );
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["(auth)"],
      generatedPaths: ["src/routes/(AUTH)/Users.tsx"],
    }),
    true,
  );
});

test("isSecuritySensitiveImport matches unicode-folded governance tokens", () => {
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["admin"],
      generatedPaths: ["src/routes/İADMİN/Overview.tsx"],
    }),
    true,
  );
  assert.equal(
    isSecuritySensitiveImport({
      patterns: ["strasse"],
      componentManifest: {
        screens: [
          {
            screenId: "screen-1",
            screenName: "Operations",
            file: "src/screens/Operations.tsx",
            components: [
              {
                irNodeId: "node-1",
                irNodeName: "Straße Console",
                irNodeType: "input",
                file: "src/components/OperationsPanel.tsx",
                startLine: 1,
                endLine: 3,
              },
            ],
          },
        ],
      },
      generatedPaths: ["src/routes/STRAßE/Overview.tsx"],
    }),
    true,
  );
});

test("createJobEngine persists authoritative governance state and rejects invalid governed transitions", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-import-governance-"),
  );
  const figmaPath = path.join(tempRoot, "figma.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
    }),
  });

  const accepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const status = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: accepted.jobId,
  });
  assert.equal(status.status, "completed");

  const sessions = await engine.listImportSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.jobId, accepted.jobId);
  assert.equal(sessions[0]?.status, "imported");
  assert.equal(sessions[0]?.reviewRequired, true);
  assert.equal((sessions[0]?.nodeCount ?? 0) > 0, true);
  assert.equal((sessions[0]?.componentMappings ?? 0) >= 0, true);

  const sessionId = sessions[0]!.id;
  const initialAuditTrail = await engine.listImportSessionEvents({ sessionId });
  assert.equal(
    initialAuditTrail.some((event) => event.kind === "imported"),
    true,
  );

  await assert.rejects(
    () =>
      engine.appendImportSessionEvent({
        event: {
          id: "",
          sessionId,
          kind: "approved",
          at: "",
        },
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_IMPORT_SESSION_INVALID_TRANSITION",
  );
  await assert.rejects(
    () =>
      engine.appendImportSessionEvent({
        event: {
          id: "",
          sessionId,
          kind: "applied",
          at: "",
        },
      }),
    (error: Error & { code?: string }) =>
      error.code === "E_IMPORT_SESSION_INVALID_TRANSITION",
  );
  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "note",
      at: "",
      metadata: {
        reviewRequired: false,
      },
    },
  });

  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "review_started",
      at: "",
      metadata: {
        qualityScore: 81,
      },
    },
  });

  const callerSuppliedTimestamp = "1999-01-01T00:00:00.000Z";
  const approvedEvent = await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "approved",
      at: callerSuppliedTimestamp,
      actor: "reviewer-1",
    },
  });
  assert.notEqual(approvedEvent.at, callerSuppliedTimestamp);
  assert.equal(approvedEvent.actor, "reviewer-1");

  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "apply_blocked",
      at: "",
      note: "Need explicit override note.",
    },
  });

  const updated = (await engine.listImportSessions()).find(
    (entry) => entry.id === sessionId,
  );
  assert.equal(updated?.status, "approved");
  assert.equal(updated?.qualityScore, 81);
  assert.equal(updated?.reviewRequired, true);
  assert.equal(updated?.userId, "reviewer-1");

  await engine.appendImportSessionEvent({
    event: {
      id: "",
      sessionId,
      kind: "applied",
      at: "",
      note: "Approved override.",
    },
  });

  const applied = (await engine.listImportSessions()).find(
    (entry) => entry.id === sessionId,
  );
  assert.equal(applied?.status, "applied");
});

test("createJobEngine does not reuse file-key-only sessions for figma_paste imports without nodeId", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-import-governance-paste-session-"),
  );
  const figmaPath = path.join(tempRoot, "figma.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
    }),
  });

  const firstAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaFileKey: "FILE-PASTE",
    figmaSourceMode: "local_json",
    requestSourceMode: "figma_paste",
  });
  const firstStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: firstAccepted.jobId,
  });
  assert.equal(firstStatus.status, "completed");

  const secondAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaFileKey: "FILE-PASTE",
    figmaSourceMode: "local_json",
    requestSourceMode: "figma_paste",
  });
  const secondStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: secondAccepted.jobId,
  });
  assert.equal(secondStatus.status, "completed");

  const sessions = await engine.listImportSessions();
  assert.equal(sessions.length, 2);
  assert.equal(
    sessions.every(
      (session) =>
        session.fileKey === "FILE-PASTE" &&
        session.nodeId === "" &&
        session.sourceMode === "figma_paste",
    ),
    true,
  );
  assert.notEqual(sessions[0]?.id, sessions[1]?.id);
});

test("createJobEngine reuses whole-file sessions for stable non-paste imports without nodeId", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-import-governance-whole-file-session-"),
  );
  const figmaPath = path.join(tempRoot, "figma.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
    }),
  });

  const firstAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaFileKey: "FILE-STABLE",
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const firstStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: firstAccepted.jobId,
  });
  assert.equal(firstStatus.status, "completed");

  const secondAccepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaFileKey: "FILE-STABLE",
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const secondStatus = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: secondAccepted.jobId,
  });
  assert.equal(secondStatus.status, "completed");

  const sessions = await engine.listImportSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.fileKey, "FILE-STABLE");
  assert.equal(sessions[0]?.nodeId, "");
  assert.equal(sessions[0]?.sourceMode, "local_json");
  assert.equal(sessions[0]?.jobId, secondAccepted.jobId);
});

test("approveImportSession records review_started before approved and stays idempotent", async () => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-import-governance-approve-"),
  );
  const figmaPath = path.join(tempRoot, "figma.json");
  await writeFile(figmaPath, JSON.stringify(createLocalFigmaPayload()), "utf8");

  const engine = createJobEngine({
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    paths: {
      outputRoot: tempRoot,
      jobsRoot: path.join(tempRoot, "jobs"),
      reprosRoot: path.join(tempRoot, "repros"),
    },
    runtime: resolveRuntimeSettings({
      enablePreview: false,
      installPreferOffline: true,
      enableUiValidation: false,
      enableUnitTestValidation: false,
    }),
  });

  const accepted = engine.submitJob({
    figmaJsonPath: figmaPath,
    figmaSourceMode: "local_json",
    requestSourceMode: "local_json",
  });
  const status = await waitForTerminalStatus({
    getStatus: (jobId) => engine.getJob(jobId),
    jobId: accepted.jobId,
  });
  assert.equal(status.status, "completed");

  const sessionId = (await engine.listImportSessions())[0]?.id;
  assert.ok(sessionId);

  const approvedEvent = await engine.approveImportSession({ sessionId });
  assert.equal(approvedEvent.kind, "approved");

  const auditTrail = await engine.listImportSessionEvents({ sessionId });
  assert.equal(
    auditTrail.filter((event) => event.kind === "review_started").length,
    1,
  );
  assert.equal(
    auditTrail.filter((event) => event.kind === "approved").length,
    1,
  );
  assert.equal(
    auditTrail.findIndex((event) => event.kind === "review_started") <
      auditTrail.findIndex((event) => event.kind === "approved"),
    true,
  );

  const repeatedApproval = await engine.approveImportSession({ sessionId });
  assert.equal(repeatedApproval.id, approvedEvent.id);

  const repeatedAuditTrail = await engine.listImportSessionEvents({
    sessionId,
  });
  assert.equal(
    repeatedAuditTrail.filter((event) => event.kind === "review_started")
      .length,
    1,
  );
  assert.equal(
    repeatedAuditTrail.filter((event) => event.kind === "approved").length,
    1,
  );

  const approvedSession = (await engine.listImportSessions()).find(
    (entry) => entry.id === sessionId,
  );
  assert.equal(approvedSession?.status, "approved");
});
