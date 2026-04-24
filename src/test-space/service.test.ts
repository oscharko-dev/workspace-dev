import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspaceTestSpaceService,
  type WorkspaceTestSpaceRun,
} from "./service.js";
import { createDisabledWorkspaceTestSpaceQcConnector } from "./qc.js";
import { renderWorkspaceTestSpaceMarkdown } from "./markdown.js";
import { MAX_SUBMIT_BODY_BYTES } from "../server/constants.js";

function createSyntheticRun(): WorkspaceTestSpaceRun {
  return {
    runId: "run-123",
    status: "completed",
    modelDeployment: "gpt-oss-120b",
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
    request: {
      figmaSourceMode: "local_json",
      testSuiteName: "Checkout flow",
      figmaJsonPayloadPresent: false,
      figmaJsonPathPresent: false,
      businessContext: {
        summary: "Checkout flow for retail customers",
        productName: "Retail App",
        goals: ["Complete payment"],
      },
    },
    figmaSummary: {
      sourceMode: "local_json",
      sourceKind: "payload",
      sourceLocator: {
        figmaJsonPathPresent: false,
        hasFigmaAccessToken: false,
      },
      nodeCount: 3,
      frameCount: 1,
      textNodeCount: 2,
      componentCount: 1,
      screenCount: 2,
      maxDepth: 4,
      topLevelNames: ["Checkout", "Confirmation"],
      sampleNodeNames: ["Checkout", "Pay"],
      sampleText: ["Pay now"],
    },
    testCases: [
      {
        id: "TC-001",
        title: "Happy path",
        priority: "P0",
        type: "happy_path",
        steps: [
          {
            order: 1,
            action: "Open checkout",
            expectedResult: "Checkout opens",
          },
        ],
        expectedResult: "Payment succeeds",
        coverageTags: ["smoke"],
      },
    ],
    coverageFindings: [
      {
        id: "CF-001",
        severity: "low",
        message: "Review one edge state.",
        recommendation: "Add a negative case.",
        relatedCaseIds: ["TC-001"],
      },
    ],
    markdownArtifact: {
      path: "/tmp/test-space/runs/run-123/test-cases.md",
      title: "Test Space Run run-123",
      contentType: "text/markdown; charset=utf-8",
      bytes: 0,
      lineCount: 0,
    },
    qcMappingDraft: {
      connector: "opentext-alm-qc",
      writeEnabled: false,
      projectName: "Retail App",
      testPlanName: "Checkout flow Plan",
      testSetName: "Checkout flow Run run-123",
      caseMappings: [
        {
          caseId: "TC-001",
          title: "Happy path",
          priority: "P0",
          stepCount: 1,
          coverageTags: ["smoke"],
        },
      ],
    },
    artifacts: {
      root: "/tmp/test-space/runs/run-123",
      inputJson: "/tmp/test-space/runs/run-123/input.json",
      figmaSummaryJson: "/tmp/test-space/runs/run-123/figma-summary.json",
      llmRequestRedactedJson:
        "/tmp/test-space/runs/run-123/llm-request.redacted.json",
      llmResponseRawJson: "/tmp/test-space/runs/run-123/llm-response.raw.json",
      testCasesJson: "/tmp/test-space/runs/run-123/test-cases.generated.json",
      testCasesMarkdown: "/tmp/test-space/runs/run-123/test-cases.md",
      auditLogJsonl: "/tmp/test-space/runs/run-123/audit-log.jsonl",
    },
  };
}

test("renderWorkspaceTestSpaceMarkdown emits TOC, tables, and details blocks", () => {
  const markdown = renderWorkspaceTestSpaceMarkdown(createSyntheticRun());
  assert.match(markdown, /^# Test Space Run run-123/m);
  assert.match(markdown, /\[Overview\]\(#overview\)/);
  assert.match(markdown, /\| Case ID \| Title \| Priority \| Type \| Steps \| Coverage tags \|/);
  assert.match(markdown, /<details>/);
  assert.match(markdown, /business test cases, coverage, and audit context/);
  assert.doesNotMatch(markdown, /QC Mapping Draft/);
});

test("renderWorkspaceTestSpaceMarkdown escapes HTML and markdown-sensitive content", () => {
  const run = createSyntheticRun();
  run.runId = "run-<1>|#";
  run.request.businessContext.summary =
    "Plan </summary> | <script>alert(1)</script> & #";
  run.request.businessContext.productName = "Widget <b>Pro</b>";
  run.testCases[0]!.title = "Title </summary> | <i>bad</i>";
  run.testCases[0]!.expectedResult = "Shows <done> & continues";
  run.testCases[0]!.steps[0]!.action = "Click > next | step";
  run.testCases[0]!.steps[0]!.expectedResult = "Complete <flow>";
  run.testCases[0]!.preconditions = ["Need <prep> & guardrails"];
  run.coverageFindings[0]!.message = "Avoid </summary> and | separators";
  run.coverageFindings[0]!.recommendation = "Escape <tags> & keep safe";
  run.qcMappingDraft.projectName = "Project <Alpha>";

  const markdown = renderWorkspaceTestSpaceMarkdown(run);
  assert.match(markdown, /&lt;\/summary&gt;/);
  assert.match(markdown, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markdown, /\\\|/);
  assert.doesNotMatch(markdown, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(markdown, /<done>/);
});

test("createWorkspaceTestSpaceService writes artifacts under the absolute output root and reloads runs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-workspace-"));
  try {
    const localJsonPath = path.join(workspaceRoot, "figma.json");
    await mkdir(path.dirname(localJsonPath), { recursive: true });
    await writeFile(
      localJsonPath,
      JSON.stringify(
        {
          document: {
            type: "DOCUMENT",
            name: "Checkout",
            children: [
              {
                type: "FRAME",
                name: "Checkout",
                children: [
                  {
                    type: "TEXT",
                    name: "Primary CTA",
                    characters: "Pay now",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: createDisabledWorkspaceTestSpaceQcConnector(),
      now: () => "2026-04-24T10:00:00.000Z",
    });
    const run = await service.createRun({
      figmaSourceMode: "local_json",
      figmaJsonPath: "figma.json",
      testSuiteName: "Checkout flow",
      businessContext: {
        summary: "Checkout flow for retail customers",
        productName: "Retail App",
        goals: ["Complete payment"],
      },
    });

    assert.equal(path.relative(tempRoot, run.artifacts.root).startsWith(".."), false);
    assert.equal(run.qcMappingDraft.writeEnabled, false);
    assert.equal(run.markdownArtifact.bytes > 0, true);
    assert.equal(run.markdownArtifact.lineCount > 0, true);

    const markdown = await service.getRunMarkdown(run.runId);
    assert.ok(markdown);
    assert.match(markdown, /Checkout flow for retail customers/);
    assert.match(markdown, /Test Cases/);

    const reloaded = await service.getRun(run.runId);
    assert.ok(reloaded);
    assert.equal(reloaded?.runId, run.runId);
    assert.equal(reloaded?.testCases[0]?.id, "TC-001");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("createWorkspaceTestSpaceService redacts raw payload text from request artifacts and logs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-redact-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-redact-src-"));
  try {
    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: createDisabledWorkspaceTestSpaceQcConnector(),
      now: () => "2026-04-24T10:00:00.000Z",
    });

    const payload = {
      type: "DOCUMENT",
      name: "Checkout",
      children: [
        {
          type: "FRAME",
          name: "Secret <script>alert(1)</script> token",
          children: [
            {
              type: "TEXT",
              name: "token label",
              characters: "secret-token <script>alert(1)</script>",
            },
          ],
        },
      ],
    };

    const run = await service.createRun({
      figmaSourceMode: "local_json",
      figmaJsonPayload: JSON.stringify(payload),
      testSuiteName: "Checkout flow",
      businessContext: {
        summary: "Checkout flow for retail customers",
        productName: "Retail App",
        goals: ["Complete payment"],
      },
    });

    assert.equal(run.request.figmaJsonPayloadPresent, true);
    assert.equal(run.request.figmaJsonPathPresent, false);
    assert.equal(typeof run.request.figmaJsonPayloadSha256, "string");
    assert.equal(run.request.figmaJsonPayloadSha256?.length, 64);

    const inputJson = await readFile(path.join(run.artifacts.root, "input.json"), "utf8");
    const llmRequestJson = await readFile(
      path.join(run.artifacts.root, "llm-request.redacted.json"),
      "utf8",
    );
    const markdown = await readFile(path.join(run.artifacts.root, "test-cases.md"), "utf8");
    const auditLog = await readFile(path.join(run.artifacts.root, "audit-log.jsonl"), "utf8");

    for (const content of [inputJson, llmRequestJson, markdown, auditLog]) {
      assert.doesNotMatch(content, /secret-token/i);
      assert.doesNotMatch(content, /<script>alert\(1\)<\/script>/i);
    }

    const storedInput = JSON.parse(inputJson) as Record<string, unknown>;
    const storedRequest = storedInput.request as Record<string, unknown>;
    assert.equal(storedRequest.figmaJsonPayloadPresent, true);
    assert.equal(storedRequest.figmaJsonPathPresent, false);
    assert.equal(typeof storedRequest.figmaJsonPayloadSha256, "string");
    assert.equal(storedRequest.figmaJsonPayload, undefined);

    const storedLlmRequest = JSON.parse(llmRequestJson) as Record<string, unknown>;
    const llmRequest = storedLlmRequest.request as Record<string, unknown>;
    assert.equal(llmRequest.figmaJsonPayloadPresent, true);
    assert.equal(llmRequest.figmaJsonPathPresent, false);
    assert.equal(typeof llmRequest.figmaJsonPayloadSha256, "string");

    const reloaded = await service.getRun(run.runId);
    assert.ok(reloaded);
    assert.equal(reloaded?.request.figmaJsonPayloadPresent, true);
    assert.equal(reloaded?.request.figmaJsonPathPresent, false);
    assert.equal(reloaded?.request.figmaJsonPayloadSha256, run.request.figmaJsonPayloadSha256);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("createWorkspaceTestSpaceService reports missing local JSON without leaking the absolute path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-root-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-src-"));
  try {
    const missingPath = path.join(workspaceRoot, "missing", "figma.json");
    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: createDisabledWorkspaceTestSpaceQcConnector(),
      now: () => "2026-04-24T10:00:00.000Z",
    });

    await assert.rejects(
      () =>
        service.createRun({
          figmaSourceMode: "local_json",
          figmaJsonPath: missingPath,
          businessContext: {
            summary: "Checkout flow for retail customers",
          },
        }),
      (error: unknown) => {
        if (typeof error !== "object" || error === null) {
          return false;
        }
        const candidate = error as {
          statusCode?: number;
          payload?: { error?: string; message?: string };
        };
        return (
          candidate.statusCode === 422 &&
          candidate.payload?.error === "INVALID_FIGMA_JSON" &&
          candidate.payload?.message === "Could not read local Figma JSON." &&
          candidate.payload.message?.includes(missingPath) === false
        );
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("createWorkspaceTestSpaceService rejects source paths outside the workspace root and keeps the QC connector write-disabled", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-root-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-src-"));
  try {
    const outsidePath = path.join(path.dirname(workspaceRoot), "outside.json");
    await writeFile(
      outsidePath,
      JSON.stringify({ document: { type: "DOCUMENT" } }, null, 2),
      "utf8",
    );

    const connector = createDisabledWorkspaceTestSpaceQcConnector();
    assert.equal("writeDraft" in connector, false);

    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: connector,
      now: () => "2026-04-24T10:00:00.000Z",
    });

    await assert.rejects(
      () =>
        service.createRun({
          figmaSourceMode: "local_json",
          figmaJsonPath: outsidePath,
          businessContext: {
            summary: "Checkout flow for retail customers",
          },
        }),
      (error: unknown) => {
        if (typeof error !== "object" || error === null) {
          return false;
        }
        const candidate = error as { statusCode?: number; payload?: { error?: string } };
        return candidate.statusCode === 403 && candidate.payload?.error === "FORBIDDEN_PATH";
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("createWorkspaceTestSpaceService rejects workspace symlinks that point outside the workspace root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-root-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-symlink-src-"));
  try {
    const outsidePath = path.join(path.dirname(workspaceRoot), "outside-figma.json");
    const linkedPath = path.join(workspaceRoot, "nested", "figma-link.json");
    await mkdir(path.dirname(linkedPath), { recursive: true });
    await writeFile(outsidePath, JSON.stringify({ document: { type: "DOCUMENT" } }, null, 2), "utf8");
    await symlink(outsidePath, linkedPath);

    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: createDisabledWorkspaceTestSpaceQcConnector(),
      now: () => "2026-04-24T10:00:00.000Z",
    });

    await assert.rejects(
      () =>
        service.createRun({
          figmaSourceMode: "local_json",
          figmaJsonPath: path.relative(workspaceRoot, linkedPath),
          businessContext: {
            summary: "Checkout flow for retail customers",
          },
        }),
      (error: unknown) => {
        if (typeof error !== "object" || error === null) {
          return false;
        }
        const candidate = error as {
          statusCode?: number;
          payload?: { error?: string; message?: string };
        };
        return (
          candidate.statusCode === 403 &&
          candidate.payload?.error === "FORBIDDEN_PATH" &&
          candidate.payload?.message ===
            "Test Space source files must stay within the workspace root."
        );
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("createWorkspaceTestSpaceService rejects oversized local JSON before parsing it", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-root-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-test-space-oversize-src-"));
  try {
    const oversizedPath = path.join(workspaceRoot, "oversized-figma.json");
    await mkdir(path.dirname(oversizedPath), { recursive: true });
    await writeFile(
      oversizedPath,
      Buffer.alloc(MAX_SUBMIT_BODY_BYTES + 1, "{"),
    );

    const service = createWorkspaceTestSpaceService({
      absoluteOutputRoot: tempRoot,
      workspaceRoot,
      qcConnector: createDisabledWorkspaceTestSpaceQcConnector(),
      now: () => "2026-04-24T10:00:00.000Z",
    });

    await assert.rejects(
      () =>
        service.createRun({
          figmaSourceMode: "local_json",
          figmaJsonPath: path.relative(workspaceRoot, oversizedPath),
          businessContext: {
            summary: "Checkout flow for retail customers",
          },
        }),
      (error: unknown) => {
        if (typeof error !== "object" || error === null) {
          return false;
        }
        const candidate = error as {
          statusCode?: number;
          payload?: { error?: string; message?: string };
        };
        return (
          candidate.statusCode === 422 &&
          candidate.payload?.error === "INVALID_FIGMA_JSON" &&
          candidate.payload?.message ===
            "Local Figma JSON exceeds the maximum allowed size."
        );
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
