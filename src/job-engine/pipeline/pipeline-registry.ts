import type {
  WorkspacePipelineDescriptor,
  WorkspacePipelineId,
} from "../../contracts/index.js";
import type { PipelineDefinition } from "./pipeline-definition.js";
import { toPipelineDescriptor } from "./pipeline-definition.js";

export class PipelineRegistry {
  private readonly definitions: Map<WorkspacePipelineId, PipelineDefinition>;
  private readonly knownPipelineIds: Set<WorkspacePipelineId>;

  constructor({
    definitions,
    knownPipelineIds = definitions.map((definition) => definition.id),
  }: {
    definitions: readonly PipelineDefinition[];
    knownPipelineIds?: readonly WorkspacePipelineId[];
  }) {
    this.definitions = new Map();
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) {
        throw new Error(`Duplicate pipeline definition '${definition.id}'.`);
      }
      this.definitions.set(definition.id, definition);
    }
    this.knownPipelineIds = new Set([
      ...knownPipelineIds,
      ...definitions.map((definition) => definition.id),
    ]);
  }

  list(): PipelineDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  listDescriptors(): WorkspacePipelineDescriptor[] {
    return this.list().map(toPipelineDescriptor);
  }

  get(id: WorkspacePipelineId): PipelineDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: WorkspacePipelineId): boolean {
    return this.definitions.has(id);
  }

  isKnown(id: WorkspacePipelineId): boolean {
    return this.knownPipelineIds.has(id);
  }
}
