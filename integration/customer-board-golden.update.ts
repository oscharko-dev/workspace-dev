import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJobEngine } from "../src/job-engine.js";
import {
  buildCustomerBoardGoldenBundleFromFigmaInput,
  createCustomerBoardHybridLiveRuntimeSettings,
  getCustomerBoardBrandId,
  getCustomerBoardFixtureRoot,
  getCustomerBoardRequestedStorybookStaticDir,
  loadCustomerBoardGoldenManifest,
  writeCustomerBoardGoldenBundle
} from "./customer-board-golden.helpers.js";

const shouldApprove = (): boolean => {
  const raw = process.env.FIGMAPIPE_CUSTOMER_BOARD_APPROVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

const waitForTerminalStatus = async ({
  getStatus,
  jobId,
  timeoutMs = 900_000
}: {
  getStatus: (jobId: string) => ReturnType<ReturnType<typeof createJobEngine>["getJob"]>;
  jobId: string;
  timeoutMs?: number;
}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getStatus(jobId);
    if (status && (status.status === "completed" || status.status === "failed" || status.status === "canceled")) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for customer-board fixture refresh job '${jobId}'.`);
};

const run = async (): Promise<void> => {
  if (!shouldApprove()) {
    throw new Error(
      "Refusing to update customer-board fixtures without FIGMAPIPE_CUSTOMER_BOARD_APPROVE=true."
    );
  }

  const figmaFileKey = process.env.FIGMA_FILE_KEY?.trim();
  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  assert.ok(figmaFileKey, "FIGMA_FILE_KEY is required to refresh the customer-board fixture bundle.");
  assert.ok(figmaAccessToken, "FIGMA_ACCESS_TOKEN is required to refresh the customer-board fixture bundle.");

  const storybookBuildDir = path.resolve(process.cwd(), getCustomerBoardRequestedStorybookStaticDir());
  await access(path.join(storybookBuildDir, "index.json"));
  const manifest = await loadCustomerBoardGoldenManifest();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-update-"));
  const sidecarTargets = [
    {
      targetPath: path.join(storybookBuildDir, "storybook.evidence.json")
    },
    {
      targetPath: path.join(storybookBuildDir, "storybook.catalog.json")
    },
    {
      targetPath: path.join(storybookBuildDir, "tokens.json")
    },
    {
      targetPath: path.join(storybookBuildDir, "themes.json")
    },
    {
      targetPath: path.join(storybookBuildDir, "components.json")
    }
  ] as const;
  const originalSidecars = await Promise.all(
    sidecarTargets.map(async (entry) => {
      try {
        return await readFile(entry.targetPath, "utf8");
      } catch {
        return undefined;
      }
    })
  );

  try {
    await Promise.all(sidecarTargets.map(async (entry) => rm(entry.targetPath, { force: true })));

    const runtime = createCustomerBoardHybridLiveRuntimeSettings();
    assert.ok(
      runtime.figmaMcpEnrichmentLoader,
      "Customer-board fixture refresh requires figmaMcpEnrichmentLoader for hybrid low-fidelity recovery."
    );

    const engine = createJobEngine({
      resolveBaseUrl: () => "http://127.0.0.1:1983",
      paths: {
        outputRoot,
        jobsRoot: path.join(outputRoot, "jobs"),
        reprosRoot: path.join(outputRoot, "repros"),
        workspaceRoot: process.cwd()
      },
      runtime
    });
    const accepted = engine.submitJob({
      enableGitPr: false,
      figmaSourceMode: "hybrid",
      figmaFileKey,
      figmaAccessToken,
      brandTheme: "derived",
      customerBrandId: getCustomerBoardBrandId(),
      customerProfilePath: path.join(getCustomerBoardFixtureRoot(), manifest.inputs.customerProfile),
      storybookStaticDir: getCustomerBoardRequestedStorybookStaticDir(),
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form"
    });
    const status = await waitForTerminalStatus({
      getStatus: engine.getJob,
      jobId: accepted.jobId
    });
    if (status.status !== "completed") {
      assert.fail(
        `Customer-board fixture refresh failed with status '${status.status}': ${JSON.stringify(status.error ?? status, null, 2)}`
      );
    }

    const figmaJsonFile = status.artifacts.figmaJsonFile;
    assert.ok(figmaJsonFile, "Completed customer-board fixture refresh must emit a cleaned figma.json artifact.");
    const bundle = await buildCustomerBoardGoldenBundleFromFigmaInput({
      storybookBuildDir,
      storybookJobDir: String(status.artifacts.jobDir),
      figmaInput: JSON.parse(await readFile(String(figmaJsonFile), "utf8")) as Record<string, unknown>,
      figmaLibrarySeed: {
        fileKey: figmaFileKey,
        accessToken: figmaAccessToken
      }
    });

    const fixtureRoot = getCustomerBoardFixtureRoot();
    await rm(fixtureRoot, { recursive: true, force: true });
    await writeCustomerBoardGoldenBundle({
      bundle,
      fixtureRoot
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          fixtureRoot,
          storybookBuildDir,
          fileCount: bundle.files.size
        },
        null,
        2
      )}\n`
    );
  } finally {
    await Promise.all(
      sidecarTargets.map(async (entry, index) => {
        const originalContent = originalSidecars[index];
        if (typeof originalContent === "string") {
          await writeFile(entry.targetPath, originalContent, "utf8");
          return;
        }
        await rm(entry.targetPath, { force: true });
      })
    );
    await rm(outputRoot, { recursive: true, force: true });
  }
};

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
