import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const moduleDir =
  typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));

test("branded ids compile-fail when RoleStepId is passed where JobId is expected", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "workspace-dev-branded-ids-"));
  try {
    const brandedIdsSource = await readFile(
      join(moduleDir, "branded-ids.ts"),
      "utf8",
    );
    await writeFile(join(tempRoot, "branded-ids.ts"), brandedIdsSource, "utf8");
    await writeFile(
      join(tempRoot, "fixture.ts"),
      [
        'import { type JobId, toRoleStepId } from "./branded-ids";',
        "",
        "const acceptJobId = (jobId: JobId): JobId => jobId;",
        'const roleStepId = toRoleStepId("wd-test-generation-0123456789abcdef");',
        "if (roleStepId !== null) {",
        "  acceptJobId(roleStepId);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(tempRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "node20",
            moduleResolution: "node16",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["fixture.ts", "branded-ids.ts"],
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(
      () =>
        execFileAsync("pnpm", [
          "exec",
          "tsc",
          "--project",
          join(tempRoot, "tsconfig.json"),
        ]),
      (error: unknown): boolean => {
        if (!(error instanceof Error)) {
          return false;
        }
        const output = String(
          (error as Error & { stdout?: string }).stdout ?? "",
        ).concat(
          String((error as Error & { stderr?: string }).stderr ?? ""),
        );
        return /not assignable|argument of type|TS2345|TS2322/i.test(output);
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
