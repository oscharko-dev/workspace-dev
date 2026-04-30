/**
 * E2E coverage for Issue #1551:
 * Inspector pipeline selection, server-projected pipeline metadata, retry,
 * re-import, scoped Generate Selected, paste-delta, and single-pipeline hiding.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  getInspectorUiUrl,
  getPrototypeNavigationPastePayload,
  resetBrowserStorage,
  simulateInspectorPaste,
} from "./helpers";

const VIEWPORT = { width: 1920, height: 1080 } as const;
const INSPECTOR_URL = getInspectorUiUrl();
const PROTO_PASTE = getPrototypeNavigationPastePayload();
const PASTE_IDENTITY_KEY = "issue-1551-paste-key";
const JOB_IDS = [
  "issue-1551-job-1",
  "issue-1551-job-2",
  "issue-1551-job-3",
] as const;
const RETRY_JOB_ID = "issue-1551-retry-job";
const SCREEN_ID = "issue-1551-screen";
const CHILD_A_ID = "issue-1551-child-a";
const CHILD_B_ID = "issue-1551-child-b";

const ROCKET_METADATA = {
  pipelineId: "rocket",
  pipelineDisplayName: "Rocket Pipeline",
  templateBundleId: "react-mui-app",
  buildProfile: "rocket",
  deterministic: true,
} as const;

async function installRuntimeRoute(
  page: Page,
  pipelines: Array<{ id: string; displayName: string }>,
): Promise<void> {
  await page.route("**/workspace", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: true,
        url: "http://127.0.0.1:19831",
        host: "127.0.0.1",
        port: 19831,
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
        uptimeMs: 1000,
        outputRoot: "/tmp/workspace-dev-e2e",
        previewEnabled: true,
        defaultPipelineId: pipelines[0]?.id,
        availablePipelines: pipelines,
      }),
    });
  });
}

async function installImportSessionsRoute(page: Page): Promise<void> {
  await page.route("**/workspace/import-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: [
          {
            id: "issue-1551-prior-session",
            fileKey: "issue-1551-file",
            nodeId: "1:2",
            nodeName: "Home",
            importedAt: "2026-04-28T12:00:00.000Z",
            nodeCount: 3,
            fileCount: 1,
            selectedNodes: [],
            scope: "all",
            componentMappings: 1,
            pasteIdentityKey: PASTE_IDENTITY_KEY,
            jobId: "issue-1551-prior-job",
            pipelineId: "rocket",
            pipelineMetadata: ROCKET_METADATA,
            replayable: true,
          },
        ],
      }),
    });
  });
}

async function installSubmitRoute(
  page: Page,
  submitBodies: Array<Record<string, unknown>>,
): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postData();
    submitBodies.push(body ? (JSON.parse(body) as Record<string, unknown>) : {});
    const jobId = JOB_IDS[submitBodies.length - 1] ?? JOB_IDS[JOB_IDS.length - 1];
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId,
        pipelineId: "rocket",
        pipelineMetadata: ROCKET_METADATA,
        pasteDeltaSummary: {
          mode: "auto_resolved_to_delta",
          strategy: "delta",
          totalNodes: 3,
          nodesReused: 2,
          nodesReprocessed: 1,
          structuralChangeRatio: 0.33,
          pasteIdentityKey: PASTE_IDENTITY_KEY,
          priorManifestMissing: false,
        },
      }),
    });
  });
}

async function installRetryRoute(
  page: Page,
  retryBodies: Array<Record<string, unknown>>,
): Promise<void> {
  await page.route(`**/workspace/jobs/${JOB_IDS[0]}/retry-stage`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postData();
    retryBodies.push(body ? (JSON.parse(body) as Record<string, unknown>) : {});
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: RETRY_JOB_ID,
        sourceJobId: JOB_IDS[0],
        status: "queued",
        pipelineId: "rocket",
        pipelineMetadata: ROCKET_METADATA,
      }),
    });
  });
}

async function installJobAndArtifactRoutes(page: Page): Promise<void> {
  for (const jobId of [...JOB_IDS, RETRY_JOB_ID]) {
    await page.route(`**/workspace/jobs/${jobId}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId,
          status: "partial",
          outcome: "partial",
          pipelineId: "rocket",
          pipelineMetadata: ROCKET_METADATA,
          inspector: {
            outcome: "partial",
            pipelineId: "rocket",
            pipelineMetadata: ROCKET_METADATA,
            stages: [
              { stage: "figma.source", status: "completed" },
              { stage: "ir.derive", status: "completed" },
              { stage: "template.prepare", status: "completed" },
              {
                stage: "codegen.generate",
                status: "failed",
                code: "CODEGEN_PARTIAL",
                message: "One generated file needs another pass.",
                retryable: true,
                retryTargets: [{ id: "src/App.tsx", file: "src/App.tsx" }],
              },
            ],
          },
          error: {
            stage: "codegen.generate",
            code: "CODEGEN_PARTIAL",
            message: "One generated file needs another pass.",
            retryable: true,
            retryTargets: [{ id: "src/App.tsx", file: "src/App.tsx" }],
          },
        }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/design-ir`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId,
          screens: [
            {
              id: SCREEN_ID,
              name: "Home",
              generatedFile: "src/App.tsx",
              children: [
                { id: CHILD_A_ID, name: "Header", type: "Frame", children: [] },
                { id: CHILD_B_ID, name: "Content", type: "Frame", children: [] },
              ],
            },
          ],
        }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/component-manifest`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId, screens: [] }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/figma-analysis`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId, diagnostics: [] }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/token-intelligence`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId,
          conflicts: [],
          unmappedVariables: [],
          libraryKeys: [],
          cssCustomProperties: null,
          codeConnectMappings: [],
          designSystemMappings: [],
          heuristicComponentMappings: [],
        }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/files`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [{ path: "src/App.tsx", sizeBytes: 128 }] }),
      });
    });

    await page.route(`**/workspace/jobs/${jobId}/screenshot`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
  }
}

async function openInspector(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(INSPECTOR_URL);
  await resetBrowserStorage(page);
  await page.reload();
  await page.waitForSelector('[data-testid="inspector-bootstrap"]', {
    timeout: 15_000,
  });
}

async function pasteAndConfirm(page: Page): Promise<void> {
  const submitResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/workspace/submit"),
  );
  await simulateInspectorPaste(page, PROTO_PASTE);
  await expect(page.getByTestId("smart-banner")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("smart-banner").getByRole("button", { name: "Import starten" }).click();
  await submitResponse;
  await expect(page.getByTestId("inspector-panel")).toBeVisible({ timeout: 15_000 });
}

async function waitForTreeCheckboxes(page: Page): Promise<void> {
  await expect(page.getByTestId(`tree-checkbox-${SCREEN_ID}`)).toBeVisible({
    timeout: 20_000,
  });
  const screenRow = page.getByTestId(`tree-screen-${SCREEN_ID}`);
  const expandButton = screenRow.getByRole("button", { name: "Expand" });
  if ((await expandButton.count()) > 0) {
    await expandButton.click();
  }
  await expect(page.getByTestId(`tree-checkbox-${CHILD_A_ID}`)).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("inspector pipeline selection (issue #1551)", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.afterEach(async ({ page }) => {
    if (page.url() !== "about:blank") {
      await resetBrowserStorage(page).catch(() => {});
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("shows the selector for multi-pipeline runtimes and preserves the selected pipeline through paste, status, and retry", async ({
    page,
  }) => {
    const submitBodies: Array<Record<string, unknown>> = [];
    const retryBodies: Array<Record<string, unknown>> = [];

    await installRuntimeRoute(page, [
      { id: "default", displayName: "Default Pipeline" },
      { id: "rocket", displayName: "Rocket Pipeline" },
    ]);
    await installImportSessionsRoute(page);
    await installSubmitRoute(page, submitBodies);
    await installRetryRoute(page, retryBodies);
    await installJobAndArtifactRoutes(page);

    await openInspector(page);

    const selector = page.getByLabel("Pipeline");
    await expect(selector).toBeVisible();
    await expect(selector).toHaveValue("default");
    await selector.selectOption("rocket");

    await pasteAndConfirm(page);

    expect(submitBodies[0]).toMatchObject({
      figmaSourceMode: "figma_paste",
      pipelineId: "rocket",
    });
    await expect(page.getByTestId("pipeline-status-bar-pipeline")).toHaveText(
      "Rocket Pipeline",
    );
    await expect(page.getByTestId("pipeline-status-bar-paste-delta")).toContainText(
      "Delta Update",
    );
    await expect(page.getByTestId("reimport-banner")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("pipeline-status-bar-retry").click();
    await expect
      .poll(() => retryBodies.length, { timeout: 10_000, intervals: [200] })
      .toBe(1);
    expect(retryBodies[0]).toMatchObject({
      retryStage: "codegen.generate",
      retryTargets: ["src/App.tsx"],
    });
  });

  test("uses the selected pipeline for re-import and Generate Selected submit bodies", async ({
    page,
  }) => {
    const submitBodies: Array<Record<string, unknown>> = [];

    await installRuntimeRoute(page, [
      { id: "default", displayName: "Default Pipeline" },
      { id: "rocket", displayName: "Rocket Pipeline" },
    ]);
    await installImportSessionsRoute(page);
    await installSubmitRoute(page, submitBodies);
    await installJobAndArtifactRoutes(page);

    await openInspector(page);
    await page.getByLabel("Pipeline").selectOption("rocket");
    await pasteAndConfirm(page);

    await expect(page.getByTestId("reimport-banner")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("reimport-regenerate-changed").click();

    await expect
      .poll(() => submitBodies.length, { timeout: 10_000, intervals: [200] })
      .toBe(2);
    expect(submitBodies[1]).toMatchObject({
      pipelineId: "rocket",
      importMode: "delta",
    });

    await expect(page.getByTestId("inspector-panel")).toBeVisible({
      timeout: 15_000,
    });
    await waitForTreeCheckboxes(page);
    await page.getByTestId("tree-deselect-all").click();
    await page.getByTestId(`tree-checkbox-${CHILD_A_ID}`).click();
    await expect(page.getByTestId("inspector-generate-selected")).toBeEnabled({
      timeout: 5_000,
    });
    await page.getByTestId("inspector-generate-selected").click();

    await expect
      .poll(() => submitBodies.length, { timeout: 10_000, intervals: [200] })
      .toBe(3);
    expect(submitBodies[2]).toMatchObject({
      pipelineId: "rocket",
      selectedNodeIds: [CHILD_A_ID],
    });
  });

  test("hides the selector for single-pipeline runtimes", async ({ page }) => {
    await installRuntimeRoute(page, [
      { id: "default", displayName: "Default Pipeline" },
    ]);
    await installImportSessionsRoute(page);

    await openInspector(page);

    await expect(page.getByLabel("Pipeline")).toHaveCount(0);
  });
});
