import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobStageName } from "../../contracts/index.js";
import type { StageArtifactKey } from "./artifact-keys.js";

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

export class StageArtifactStore {
  private readonly rootDir: string;
  private readonly refsDir: string;
  private readonly indexFile: string;
  private readonly references = new Map<string, StageArtifactReference>();
  private loaded = false;

  constructor({ jobDir }: { jobDir: string }) {
    this.rootDir = path.join(jobDir, ".stage-store");
    this.refsDir = path.join(this.rootDir, "refs");
    this.indexFile = path.join(this.rootDir, "index.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    await mkdir(this.refsDir, { recursive: true });
    try {
      const raw = await readFile(this.indexFile, "utf8");
      const parsed = JSON.parse(raw) as StageArtifactReference[] | undefined;
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const entry of parsed) {
        if (typeof entry?.key !== "string") {
          continue;
        }
        this.references.set(entry.key, entry);
      }
    } catch {
      // First run or corrupted index: keep an empty in-memory map.
    }
  }

  private async persistReference(reference: StageArtifactReference): Promise<void> {
    await this.ensureLoaded();
    this.references.set(reference.key, reference);
    const refFile = path.join(this.refsDir, `${safeKeyToFileName(reference.key)}.json`);
    await writeFile(refFile, `${JSON.stringify(reference, null, 2)}\n`, "utf8");
    await writeFile(this.indexFile, `${JSON.stringify([...this.references.values()], null, 2)}\n`, "utf8");
  }

  async setPath({
    key,
    stage,
    absolutePath
  }: {
    key: StageArtifactKey;
    stage: WorkspaceJobStageName;
    absolutePath: string;
  }): Promise<void> {
    if (!path.isAbsolute(absolutePath)) {
      throw new Error(`Stage artifact '${key}' must use an absolute path. Received '${absolutePath}'.`);
    }
    await this.persistReference({
      key,
      stage,
      kind: "path",
      path: absolutePath,
      updatedAt: new Date().toISOString()
    });
  }

  async setValue({
    key,
    stage,
    value
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
      updatedAt: new Date().toISOString()
    });
  }

  async getReference(key: StageArtifactKey): Promise<StageArtifactReference | undefined> {
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

  async getValue<T>(key: StageArtifactKey): Promise<T | undefined> {
    const reference = await this.getReference(key);
    return reference?.kind === "value" ? (reference.value as T) : undefined;
  }

  async requireValue<T>(key: StageArtifactKey): Promise<T> {
    const resolved = await this.getValue<T>(key);
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
}
