import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/check-doc-template-stack.mjs");

const createTemplatePackageJson = ({
  reactRange,
  muiRange,
  viteRange
}: {
  reactRange: string;
  muiRange: string;
  viteRange: string;
}): string => {
  return `${JSON.stringify(
    {
      name: "figma-generated-app",
      private: true,
      dependencies: {
        react: reactRange,
        "@mui/material": muiRange
      },
      devDependencies: {
        vite: viteRange
      }
    },
    null,
    2
  )}\n`;
};

const runCheck = async ({
  pipelineContent,
  templatePackageJson
}: {
  pipelineContent: string;
  templatePackageJson: string;
}): Promise<{ code: number; stdout: string; stderr: string }> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-doc-stack-"));
  const pipelineDocPath = path.join(tempRoot, "PIPELINE.md");
  const templatePackageJsonPath = path.join(tempRoot, "template-package.json");

  await writeFile(pipelineDocPath, pipelineContent, "utf8");
  await writeFile(templatePackageJsonPath, templatePackageJson, "utf8");

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        WORKSPACE_DEV_PIPELINE_DOC_PATH: pipelineDocPath,
        WORKSPACE_DEV_TEMPLATE_PACKAGE_JSON_PATH: templatePackageJsonPath
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`check-doc-template-stack exited via signal '${signal}'.`));
        return;
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

test("docs-template-stack check passes when PIPELINE majors match template package majors", async () => {
  const result = await runCheck({
    pipelineContent:
      'flowchart TB\nsubgraph S3["Stage 3: template.prepare"]\nCopy["Copy template/react-mui-app\\nReact 19 + MUI v7 + Vite 8"]\n',
    templatePackageJson: createTemplatePackageJson({
      reactRange: "^19.2.0",
      muiRange: "^7.0.0",
      viteRange: "^8.0.0"
    })
  });

  assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
  assert.match(result.stdout, /Version consistency check passed/);
});

test("docs-template-stack check fails when PIPELINE majors drift from template package", async () => {
  const result = await runCheck({
    pipelineContent:
      'flowchart TB\nsubgraph S3["Stage 3: template.prepare"]\nCopy["Copy template/react-mui-app\\nReact 18 + MUI v7 + Vite 5"]\n',
    templatePackageJson: createTemplatePackageJson({
      reactRange: "^19.2.0",
      muiRange: "^7.0.0",
      viteRange: "^8.0.0"
    })
  });

  assert.equal(result.code, 1, `Expected failure for drift, got stdout:\n${result.stdout}`);
  assert.match(result.stderr, /Mismatched majors: React, Vite/);
  assert.match(result.stderr, /Expected: React 19 \+ MUI v7 \+ Vite 8/);
  assert.match(result.stderr, /Found: React 18 \+ MUI v7 \+ Vite 5/);
});

test("docs-template-stack check fails when PIPELINE marker is missing or unparsable", async () => {
  const result = await runCheck({
    pipelineContent: "flowchart TB\nsubgraph S3\nCopy[\"template only\"]\n",
    templatePackageJson: createTemplatePackageJson({
      reactRange: "^19.2.0",
      muiRange: "^7.0.0",
      viteRange: "^8.0.0"
    })
  });

  assert.equal(result.code, 1, `Expected parser failure, got stdout:\n${result.stdout}`);
  assert.match(result.stderr, /Could not find stack marker in PIPELINE\.md/);
});
