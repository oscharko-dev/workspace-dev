import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobEngine } from "../src/job-engine.js";
import { STAGE_ARTIFACT_KEYS } from "../src/job-engine/pipeline/artifact-keys.js";
import { StageArtifactStore } from "../src/job-engine/pipeline/artifact-store.js";
import {
  assertCustomerBoardBundlesEqual,
  assertCustomerBoardPublicArtifactSanitized,
  buildCustomerBoardGoldenBundleFromFigmaInput,
  createCustomerBoardHybridLiveRuntimeSettings,
  collectCustomerBoardFixtureOutputsFromPaths,
  getCustomerBoardBrandId,
  getCustomerBoardFixtureRoot,
  getCustomerBoardRequestedStorybookStaticDir,
  loadCustomerBoardGoldenManifest,
  readCommittedCustomerBoardGoldenBundle
} from "./customer-board-golden.helpers.js";

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
  throw new Error(`Timed out waiting for customer-board live job '${jobId}'.`);
};

const resolveLiveEnvironment = async (): Promise<
  | {
      figmaFileKey: string;
      figmaAccessToken: string;
      storybookBuildDir: string;
    }
  | undefined
> => {
  const figmaFileKey = process.env.FIGMA_FILE_KEY?.trim();
  const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  if (!figmaFileKey || !figmaAccessToken) {
    return undefined;
  }

  const storybookBuildDir = path.resolve(process.cwd(), getCustomerBoardRequestedStorybookStaticDir());
  try {
    await access(path.join(storybookBuildDir, "index.json"));
  } catch {
    return undefined;
  }

  return {
    figmaFileKey,
    figmaAccessToken,
    storybookBuildDir
  };
};

test("customer-board golden live parity reproduces the committed fixture bundle and passes a real submission smoke", async (t) => {
  const liveEnvironment = await resolveLiveEnvironment();
  if (!liveEnvironment) {
    t.skip("Customer-board live parity requires FIGMA_FILE_KEY, FIGMA_ACCESS_TOKEN, and storybook-static/storybook-static/index.json.");
    return;
  }

  const manifest = await loadCustomerBoardGoldenManifest();
  const committedBundle = await readCommittedCustomerBoardGoldenBundle();

  const sidecarTargets = [
    {
      relativePath: manifest.derived.storybookTokens,
      targetPath: path.join(liveEnvironment.storybookBuildDir, "tokens.json")
    },
    {
      relativePath: manifest.derived.storybookThemes,
      targetPath: path.join(liveEnvironment.storybookBuildDir, "themes.json")
    },
    {
      relativePath: manifest.derived.storybookComponents,
      targetPath: path.join(liveEnvironment.storybookBuildDir, "components.json")
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

  t.after(async () => {
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
  });

  await Promise.all(
    sidecarTargets.map(async (entry) => {
      const fixtureFile = committedBundle.files.get(entry.relativePath);
      assert.ok(fixtureFile, `Committed sidecar '${entry.relativePath}' must exist.`);
      await writeFile(entry.targetPath, fixtureFile.content, "utf8");
    })
  );

  const runtime = createCustomerBoardHybridLiveRuntimeSettings();
  assert.ok(
    runtime.figmaMcpEnrichmentLoader,
    "Customer-board live parity must configure figmaMcpEnrichmentLoader for hybrid low-fidelity recovery."
  );

  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-live-"));
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
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  const accepted = engine.submitJob({
    enableGitPr: false,
    figmaSourceMode: "hybrid",
    figmaFileKey: liveEnvironment.figmaFileKey,
    figmaAccessToken: liveEnvironment.figmaAccessToken,
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
      `Customer-board live submission failed with status '${status.status}': ${JSON.stringify(status.error ?? status, null, 2)}`
    );
  }

  const figmaJsonFile = status.artifacts.figmaJsonFile;
  assert.ok(figmaJsonFile, "Completed customer-board live submission must emit a cleaned figma.json artifact.");
  const actualBundle = await buildCustomerBoardGoldenBundleFromFigmaInput({
    storybookBuildDir: liveEnvironment.storybookBuildDir,
    figmaInput: JSON.parse(await readFile(String(figmaJsonFile), "utf8")) as Record<string, unknown>,
    figmaLibrarySeed: {
      fileKey: liveEnvironment.figmaFileKey,
      accessToken: liveEnvironment.figmaAccessToken
    }
  });
  await assertCustomerBoardBundlesEqual({
    actual: actualBundle,
    expected: committedBundle
  });

  const jobDir = String(status.artifacts.jobDir);
  const artifactStore = new StageArtifactStore({
    jobDir
  });
  const generatedProjectDir = await artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
  const outputs = await collectCustomerBoardFixtureOutputsFromPaths({
    manifest,
    generatedProjectDir,
    jobDir
  });

  for (const artifact of manifest.expected.generated) {
    assert.equal(
      outputs.get(artifact.expected),
      committedBundle.files.get(artifact.expected)?.content,
      `Live submission output mismatch for '${artifact.expected}'.`
    );
  }

  const validationSummary = JSON.parse(outputs.get(manifest.expected.validationSummary) ?? "null") as {
    storybook?: {
      status?: string;
      artifacts?: {
        catalog?: { status?: string };
        evidence?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        components?: { status?: string };
      };
    };
    mapping?: {
      figmaLibraryResolution?: { status?: string };
      componentMatchReport?: { status?: string };
    };
    style?: {
      storybook?: {
        evidence?: { status?: string };
        tokens?: { status?: string };
        themes?: { status?: string };
        componentMatchReport?: { status?: string };
      };
    };
    import?: {
      status?: string;
    };
  };

  assert.equal(validationSummary.storybook?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.catalog?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.evidence?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.tokens?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.themes?.status, "ok");
  assert.equal(validationSummary.storybook?.artifacts?.components?.status, "ok");
  assert.equal(validationSummary.mapping?.figmaLibraryResolution?.status, "ok");
  assert.equal(validationSummary.mapping?.componentMatchReport?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.evidence?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.tokens?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.themes?.status, "ok");
  assert.equal(validationSummary.style?.storybook?.componentMatchReport?.status, "ok");
  assert.notEqual(validationSummary.import?.status, "not_available");

  const sanitizedArtifactPaths = [
    STAGE_ARTIFACT_KEYS.storybookCatalog,
    STAGE_ARTIFACT_KEYS.storybookTokens,
    STAGE_ARTIFACT_KEYS.storybookThemes,
    STAGE_ARTIFACT_KEYS.storybookComponents,
    STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    STAGE_ARTIFACT_KEYS.componentMatchReport
  ] as const;
  for (const artifactKey of sanitizedArtifactPaths) {
    const artifactPath = await artifactStore.requirePath(artifactKey);
    assert.ok(
      !artifactPath.includes("storybook.evidence") && !artifactPath.includes("storybook-static"),
      `Persisted artifact '${artifactKey}' must not point at internal Storybook paths.`
    );
    assertCustomerBoardPublicArtifactSanitized({
      label: artifactKey,
      value: JSON.parse(await readFile(artifactPath, "utf8")) as unknown
    });
  }
});
