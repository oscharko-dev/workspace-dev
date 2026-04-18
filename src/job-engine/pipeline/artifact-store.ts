import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobStageName } from "../../contracts/index.js";
import type { StageArtifactKey } from "./artifact-keys.js";
import { SchemaValidationError } from "./pipeline-schemas.js";

export interface StageArtifactReference {
  key: StageArtifactKey;
  stage: WorkspaceJobStageName;
  kind: "path" | "value";
  updatedAt: string;
  path?: string;
  value?: unknown;
}

const safeKeyToFileName = (key: string): string => {
  const normalized = key.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.length > 0 ? normalized : "artifact";
};

const isStageArtifactReference = (
  value: unknown,
): value is StageArtifactReference => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.updatedAt === "string"
  );
};

const atomicWriteFile = async (
  filePath: string,
  data: string,
): Promise<void> => {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, data, "utf8");
  await rename(tmpPath, filePath);
};

const isFileNotFoundError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
};

export class StageArtifactStore {
  private readonly rootDir: string;
  private readonly refsDir: string;
  private readonly indexFile: string;
  private readonly references = new Map<string, StageArtifactReference>();
  private loadPromise: Promise<void> | null = null;
  private corruptionDiagnostic: string | null = null;

  constructor({ jobDir }: { jobDir: string }) {
    this.rootDir = path.join(jobDir, ".stage-store");
    this.refsDir = path.join(this.rootDir, "refs");
    this.indexFile = path.join(this.rootDir, "index.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadPromise === null) {
      this.loadPromise = this.doLoad();
    }
    await this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    await mkdir(this.refsDir, { recursive: true });
    try {
      const raw = await readFile(this.indexFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.corruptionDiagnostic =
          "StageArtifactStore: index is not an array. Starting with empty store.";
      } else {
        for (let i = 0; i < parsed.length; i++) {
          const entry = parsed[i];
          if (!isStageArtifactReference(entry)) {
            this.corruptionDiagnostic = `StageArtifactStore: skipped invalid ref entry at index ${i}.`;
            continue;
          }
          this.references.set(entry.key, entry);
        }
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        const msg = error instanceof Error ? error.message : String(error);
        this.corruptionDiagnostic = `StageArtifactStore: index load failed (${msg}). Starting with empty store.`;
      }
    }

    await this.reconcileRefsDir();
  }

  private async reconcileRefsDir(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.refsDir);
    } catch {
      return;
    }

    let reconciled = 0;
    for (const name of entries) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const refPath = path.join(this.refsDir, name);
      let raw: string;
      try {
        raw = await readFile(refPath, "utf8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isStageArtifactReference(parsed)) {
        continue;
      }
      if (!this.references.has(parsed.key)) {
        this.references.set(parsed.key, parsed);
        reconciled++;
      }
    }

    if (reconciled > 0) {
      this.corruptionDiagnostic = `StageArtifactStore: reconciled ${reconciled} ref file(s) missing from index.`;
    }
  }

  private async persistReference(
    reference: StageArtifactReference,
  ): Promise<void> {
    await this.ensureLoaded();
    this.references.set(reference.key, reference);
    const refFile = path.join(
      this.refsDir,
      `${safeKeyToFileName(reference.key)}.json`,
    );
    await atomicWriteFile(refFile, `${JSON.stringify(reference, null, 2)}\n`);
    await atomicWriteFile(
      this.indexFile,
      `${JSON.stringify([...this.references.values()], null, 2)}\n`,
    );
  }

  async setPath({
    key,
    stage,
    absolutePath,
  }: {
    key: StageArtifactKey;
    stage: WorkspaceJobStageName;
    absolutePath: string;
  }): Promise<void> {
    if (!path.isAbsolute(absolutePath)) {
      throw new Error(
        `Stage artifact '${key}' must use an absolute path. Received '${absolutePath}'.`,
      );
    }
    await this.persistReference({
      key,
      stage,
      kind: "path",
      path: absolutePath,
      updatedAt: new Date().toISOString(),
    });
  }

  async setValue({
    key,
    stage,
    value,
  }: {
    key: StageArtifactKey;
    stage: WorkspaceJobStageName;
    value: unknown;
  }): Promise<void> {
    await this.persistReference({
      key,
      stage,
      kind: "value",
      value,
      updatedAt: new Date().toISOString(),
    });
  }

  async getReference(
    key: StageArtifactKey,
  ): Promise<StageArtifactReference | undefined> {
    await this.ensureLoaded();
    return this.references.get(key);
  }

  async getPath(key: StageArtifactKey): Promise<string | undefined> {
    const reference = await this.getReference(key);
    return reference?.kind === "path" ? reference.path : undefined;
  }

  async requirePath(key: StageArtifactKey): Promise<string> {
    const resolved = await this.getPath(key);
    if (!resolved) {
      throw new Error(`Required stage artifact path '${key}' is missing.`);
    }
    return resolved;
  }

  async getValue<T>(
    key: StageArtifactKey,
    validator?: (value: unknown) => value is T,
  ): Promise<T | undefined> {
    const reference = await this.getReference(key);
    if (reference?.kind !== "value") {
      return undefined;
    }
    if (validator && !validator(reference.value)) {
      throw new SchemaValidationError({
        schema: key,
        message: `Artifact value '${key}' failed schema validation: stored value does not match expected type.`,
      });
    }
    return reference.value as T;
  }

  async requireValue<T>(
    key: StageArtifactKey,
    validator?: (value: unknown) => value is T,
  ): Promise<T> {
    const resolved = await this.getValue<T>(key, validator);
    if (resolved === undefined) {
      throw new Error(`Required stage artifact value '${key}' is missing.`);
    }
    return resolved;
  }

  async list(): Promise<StageArtifactReference[]> {
    await this.ensureLoaded();
    return [...this.references.values()];
  }

  getStoreRoot(): string {
    return this.rootDir;
  }

  getCorruptionDiagnostic(): string | null {
    return this.corruptionDiagnostic;
  }
}
