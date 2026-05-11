import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobStageName } from "../contracts/index.js";
import {
  createPipelineError,
  type PipelineDiagnosticLimits,
} from "./errors.js";

const scanFileSizes = async (
  rootDir: string,
): Promise<Map<string, number>> => {
  const fileSizes = new Map<string, number>();

  const walk = async (directoryPath: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const metadata = await lstat(absolutePath);
      fileSizes.set(absolutePath, metadata.size);
    }
  };

  await walk(rootDir);
  return fileSizes;
};

export interface JobDiskSnapshot {
  currentBytes: number;
  cumulativeBytesWritten: number;
  deltaBytesWritten: number;
}

export class JobDiskTracker {
  private readonly roots: readonly string[];
  private readonly limitBytes: number;
  private readonly limits: PipelineDiagnosticLimits | undefined;
  private fileSizes = new Map<string, number>();
  private currentBytes = 0;
  private cumulativeBytesWritten = 0;

  constructor({
    roots,
    limitBytes,
    limits,
  }: {
    roots: readonly string[];
    limitBytes: number;
    limits?: PipelineDiagnosticLimits;
  }) {
    this.roots = roots;
    this.limitBytes = limitBytes;
    this.limits = limits;
  }

  private async scan(): Promise<Map<string, number>> {
    const combined = new Map<string, number>();
    for (const root of this.roots) {
      const fileSizes = await scanFileSizes(root);
      for (const [filePath, size] of fileSizes) {
        combined.set(filePath, size);
      }
    }
    return combined;
  }

  async sync(): Promise<JobDiskSnapshot> {
    this.fileSizes = await this.scan();
    this.currentBytes = [...this.fileSizes.values()].reduce(
      (sum, size) => sum + size,
      0,
    );
    return this.getSnapshot();
  }

  async syncAndEnsureWithinLimit({
    stage,
  }: {
    stage: WorkspaceJobStageName;
  }): Promise<JobDiskSnapshot> {
    const nextFileSizes = await this.scan();
    const nextCurrentBytes = [...nextFileSizes.values()].reduce(
      (sum, size) => sum + size,
      0,
    );

    let deltaBytesWritten = 0;
    for (const [filePath, size] of nextFileSizes) {
      const previousSize = this.fileSizes.get(filePath) ?? 0;
      if (size > previousSize) {
        deltaBytesWritten += size - previousSize;
      }
    }

    this.fileSizes = nextFileSizes;
    this.currentBytes = nextCurrentBytes;
    this.cumulativeBytesWritten += deltaBytesWritten;

    if (this.currentBytes > this.limitBytes) {
      throw createPipelineError({
        code: "DISK_QUOTA_EXCEEDED",
        stage,
        message:
          `Job disk usage exceeded the configured limit after '${stage}' ` +
          `(current=${this.currentBytes}, limit=${this.limitBytes}).`,
        ...(this.limits ? { limits: this.limits } : {}),
        diagnostics: [
          {
            code: "DISK_QUOTA_EXCEEDED",
            message: "Job disk usage exceeded the configured per-job limit.",
            suggestion:
              "Reduce generated artifacts for this job or increase maxJobDiskBytes before retrying.",
            stage,
            severity: "error",
            details: {
              currentBytes: this.currentBytes,
              maxBytes: this.limitBytes,
              cumulativeBytesWritten: this.cumulativeBytesWritten,
              deltaBytesWritten,
            },
          },
        ],
      });
    }

    return this.getSnapshot({ deltaBytesWritten });
  }

  getSnapshot({
    deltaBytesWritten = 0,
  }: {
    deltaBytesWritten?: number;
  } = {}): JobDiskSnapshot {
    return {
      currentBytes: this.currentBytes,
      cumulativeBytesWritten: this.cumulativeBytesWritten,
      deltaBytesWritten,
    };
  }
}
