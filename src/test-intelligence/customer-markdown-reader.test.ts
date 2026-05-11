import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCustomerMarkdownAttachmentName,
  readCustomerMarkdownArtifact,
} from "./customer-markdown-reader.js";

async function setup(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "ti-md-reader-"));
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("readCustomerMarkdownArtifact returns the combined Markdown when present", async () => {
  const { root, cleanup } = await setup();
  try {
    // Mirror the runner layout exactly:
    //   <root>/jobs/<jobId>/test-intelligence/customer-markdown/testfaelle.md
    const jobDir = path.join(
      root,
      "jobs",
      "job-123",
      "test-intelligence",
      "customer-markdown",
    );
    await mkdir(jobDir, { recursive: true });
    await writeFile(
      path.join(jobDir, "testfaelle.md"),
      "# Testfälle\nbody\n",
      "utf8",
    );
    const result = await readCustomerMarkdownArtifact({
      artifactRoot: root,
      jobId: "job-123",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.combinedMarkdown.startsWith("# Testfälle"), true);
      assert.equal(
        result.combinedPath,
        path.resolve(
          root,
          "jobs",
          "job-123",
          "test-intelligence",
          "customer-markdown",
          "testfaelle.md",
        ),
      );
    }
  } finally {
    await cleanup();
  }
});

test("readCustomerMarkdownArtifact returns not_found when the file does not exist", async () => {
  const { root, cleanup } = await setup();
  try {
    const result = await readCustomerMarkdownArtifact({
      artifactRoot: root,
      jobId: "missing-job",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "not_found");
    }
  } finally {
    await cleanup();
  }
});

test("readCustomerMarkdownArtifact returns not_found when the path is a directory", async () => {
  const { root, cleanup } = await setup();
  try {
    // Stand up `testfaelle.md` as a directory (not a file) at the runner
    // layout to assert the file-vs-directory branch.
    await mkdir(
      path.join(
        root,
        "jobs",
        "job-2",
        "test-intelligence",
        "customer-markdown",
        "testfaelle.md",
      ),
      { recursive: true },
    );
    const result = await readCustomerMarkdownArtifact({
      artifactRoot: root,
      jobId: "job-2",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "not_found");
    }
  } finally {
    await cleanup();
  }
});

test("readCustomerMarkdownArtifact refuses paths outside the artifact root", async () => {
  const { root, cleanup } = await setup();
  try {
    const result = await readCustomerMarkdownArtifact({
      artifactRoot: root,
      jobId: "../../etc",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "path_outside_root");
    }
  } finally {
    await cleanup();
  }
});

test("buildCustomerMarkdownAttachmentName sanitises the job id", () => {
  assert.equal(
    buildCustomerMarkdownAttachmentName("job_AB.cd-1"),
    "job_AB.cd-1-testfaelle.md",
  );
  assert.equal(
    buildCustomerMarkdownAttachmentName("job/with*bad:chars"),
    "job-with-bad-chars-testfaelle.md",
  );
  assert.equal(
    buildCustomerMarkdownAttachmentName("a".repeat(120)).length,
    64 + "-testfaelle.md".length,
  );
});
