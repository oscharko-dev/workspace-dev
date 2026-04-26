import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CUSTOM_CONTEXT_ARTIFACT_FILENAME,
  CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
  CUSTOM_CONTEXT_SCHEMA_VERSION,
  CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
  type BusinessTestIntentIr,
  type CustomContextNoteEntry,
  type CustomContextPolicySignal,
  type CustomContextSource,
  type CustomContextStructuredEntry,
  type JiraIssueIr,
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildMultiSourceTestIntentEnvelope,
  isPrimaryTestIntentSourceKind,
  validateMultiSourceTestIntentEnvelope,
} from "./multi-source-envelope.js";
import {
  buildStructuredEntry,
  normalizeAndRedactCustomContextAttributes,
  validateCustomContextAttributes,
  type CustomContextInputIssue,
  type CustomContextAttribute,
} from "./custom-context-input.js";
import {
  canonicalizeCustomContextMarkdown,
  type CustomContextMarkdownIssue,
} from "./custom-context-markdown.js";
import { deriveCustomContextPolicySignals } from "./custom-context-policy.js";

export type CustomContextPersistRefusalCode =
  | "primary_source_required"
  | "custom_context_markdown_invalid"
  | "custom_context_attributes_invalid"
  | "custom_context_persistence_failed";

export interface PersistCustomContextInput {
  runDir: string;
  authorHandle: string;
  capturedAt?: string;
  markdown?: string;
  attributes?: readonly CustomContextAttribute[];
}

export interface PersistCustomContextResult {
  sourceRefs: TestIntentSourceRef[];
  sourceEnvelope: MultiSourceTestIntentEnvelope;
  customContext: CustomContextSource[];
  policySignals: CustomContextPolicySignal[];
  artifactPaths: string[];
}

export type PersistCustomContextOutcome =
  | { ok: true; result: PersistCustomContextResult }
  | {
      ok: false;
      statusCode: 400 | 409 | 422 | 500;
      code: CustomContextPersistRefusalCode;
      message: string;
      issues?: Array<CustomContextMarkdownIssue | CustomContextInputIssue>;
    };

const SOURCES_DIR = "sources";
const BUSINESS_INTENT_IR_FILENAME = "business-intent-ir.json";
const JIRA_ISSUE_IR_FILENAME = "jira-issue-ir.json";
const JIRA_PASTE_PROVENANCE_FILENAME = "paste-provenance.json";
const ISO_UTC_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/u;

export const persistCustomContext = async (
  input: PersistCustomContextInput,
): Promise<PersistCustomContextOutcome> => {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (!ISO_UTC_RE.test(capturedAt)) {
    return {
      ok: false,
      statusCode: 400,
      code: "custom_context_markdown_invalid",
      message: "capturedAt must be ISO UTC.",
    };
  }

  const primarySources = await discoverPrimarySources(input.runDir);
  if (primarySources.length === 0) {
    return {
      ok: false,
      statusCode: 409,
      code: "primary_source_required",
      message:
        "Custom context is supporting evidence and requires an existing Figma or Jira primary source.",
    };
  }

  const pendingSources: Array<{
    ref: TestIntentSourceRef;
    source: CustomContextSource;
    artifactPath: string;
  }> = [];

  if (input.markdown !== undefined) {
    const canonical = canonicalizeCustomContextMarkdown(input.markdown);
    if (!canonical.ok) {
      return {
        ok: false,
        statusCode: 422,
        code: "custom_context_markdown_invalid",
        message: "Custom Markdown context failed validation.",
        issues: canonical.issues,
      };
    }
    const existing = await readCustomContextSource({
      runDir: input.runDir,
      sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
      sourceKind: "custom_text",
    });
    const entryId = sha256Hex({
      kind: "custom_context_note_entry",
      authorHandle: input.authorHandle,
      capturedAt,
      markdownContentHash: canonical.value.markdownContentHash,
      plainContentHash: canonical.value.plainContentHash,
    });
    const entry: CustomContextNoteEntry = {
      entryId,
      authorHandle: input.authorHandle,
      capturedAt,
      inputFormat: "markdown",
      ...canonical.value,
    };
    const source = buildCustomContextSource({
      sourceKind: "custom_text",
      noteEntries: upsertByEntryId(existing.noteEntries, entry),
      structuredEntries: existing.structuredEntries,
    });
    pendingSources.push({
      ref: {
        sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
        kind: "custom_text",
        contentHash: source.aggregateContentHash,
        capturedAt,
        authorHandle: input.authorHandle,
        inputFormat: "markdown",
        noteEntryId: entry.entryId,
        redactedMarkdownHash: entry.markdownContentHash,
        plainTextDerivativeHash: entry.plainContentHash,
      },
      source,
      artifactPath: customContextArtifactPath({
        runDir: input.runDir,
        sourceId: CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
      }),
    });
  }

  if (input.attributes !== undefined) {
    const validatedAttributes = validateCustomContextAttributes(
      input.attributes,
    );
    if (!validatedAttributes.ok) {
      return {
        ok: false,
        statusCode: 422,
        code: "custom_context_attributes_invalid",
        message: "Custom structured context failed validation.",
        issues: validatedAttributes.issues,
      };
    }
    const existing = await readCustomContextSource({
      runDir: input.runDir,
      sourceId: CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
      sourceKind: "custom_structured",
    });
    const attributes = normalizeAndRedactCustomContextAttributes(
      validatedAttributes.attributes,
    ).map((attr) => ({ key: attr.key, value: attr.value }));
    const contentHash = sha256Hex({
      kind: "custom_context_structured",
      attributes,
    });
    const entryId = sha256Hex({
      kind: "custom_context_structured_entry",
      authorHandle: input.authorHandle,
      capturedAt,
      contentHash,
    });
    const entry = buildStructuredEntry({
      entryId,
      authorHandle: input.authorHandle,
      capturedAt,
      attributes,
    });
    const source = buildCustomContextSource({
      sourceKind: "custom_structured",
      noteEntries: existing.noteEntries,
      structuredEntries: upsertByEntryId(existing.structuredEntries, entry),
    });
    pendingSources.push({
      ref: {
        sourceId: CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
        kind: "custom_structured",
        contentHash: source.aggregateContentHash,
        capturedAt,
        authorHandle: input.authorHandle,
        inputFormat: "structured_json",
      },
      source,
      artifactPath: customContextArtifactPath({
        runDir: input.runDir,
        sourceId: CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
      }),
    });
  }

  const sourceRefs = pendingSources.map((source) => source.ref);
  const sourceEnvelope = buildMultiSourceTestIntentEnvelope({
    sources: [...primarySources, ...sourceRefs],
    conflictResolutionPolicy: "reviewer_decides",
  });
  const validation = validateMultiSourceTestIntentEnvelope(sourceEnvelope);
  if (!validation.ok) {
    return {
      ok: false,
      statusCode: 409,
      code: "primary_source_required",
      message:
        "Custom context source mix failed validation before persistence.",
    };
  }

  try {
    for (const pending of pendingSources) {
      await writeCustomContextSource(pending.artifactPath, pending.source);
    }
  } catch {
    return {
      ok: false,
      statusCode: 500,
      code: "custom_context_persistence_failed",
      message: "Custom context artifacts could not be persisted.",
    };
  }

  const policySignals = pendingSources.flatMap((pending) =>
    pending.source.sourceKind === "custom_structured"
      ? deriveCustomContextPolicySignals({
          sourceId: pending.ref.sourceId,
          structuredEntries: pending.source.structuredEntries,
        })
      : [],
  );

  return {
    ok: true,
    result: {
      sourceRefs,
      sourceEnvelope,
      customContext: pendingSources.map((source) => source.source),
      policySignals,
      artifactPaths: pendingSources.map((source) => source.artifactPath),
    },
  };
};

const buildCustomContextSource = (input: {
  sourceKind: CustomContextSource["sourceKind"];
  noteEntries: readonly CustomContextNoteEntry[];
  structuredEntries: readonly CustomContextStructuredEntry[];
}): CustomContextSource => {
  const noteEntries = [...input.noteEntries].sort((a, b) =>
    a.entryId.localeCompare(b.entryId),
  );
  const structuredEntries = [...input.structuredEntries].sort((a, b) =>
    a.entryId.localeCompare(b.entryId),
  );
  const contentHashes = new Set<string>();
  for (const entry of noteEntries) contentHashes.add(entry.markdownContentHash);
  for (const entry of structuredEntries) contentHashes.add(entry.contentHash);
  return {
    version: CUSTOM_CONTEXT_SCHEMA_VERSION,
    sourceKind: input.sourceKind,
    noteEntries,
    structuredEntries,
    aggregateContentHash: sha256Hex({
      kind: input.sourceKind,
      contentHashes: [...contentHashes].sort(),
    }),
  };
};

const upsertByEntryId = <T extends { entryId: string }>(
  entries: readonly T[],
  entry: T,
): T[] => {
  const existing = entries.filter(
    (candidate) => candidate.entryId !== entry.entryId,
  );
  return [...existing, entry];
};

const customContextArtifactPath = (input: {
  runDir: string;
  sourceId: string;
}): string =>
  path.join(
    input.runDir,
    SOURCES_DIR,
    input.sourceId,
    CUSTOM_CONTEXT_ARTIFACT_FILENAME,
  );

const readCustomContextSource = async (input: {
  runDir: string;
  sourceId: string;
  sourceKind: CustomContextSource["sourceKind"];
}): Promise<CustomContextSource> => {
  const artifactPath = customContextArtifactPath(input);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CustomContextSource>;
    if (
      parsed.version === CUSTOM_CONTEXT_SCHEMA_VERSION &&
      parsed.sourceKind === input.sourceKind &&
      Array.isArray(parsed.noteEntries) &&
      Array.isArray(parsed.structuredEntries) &&
      typeof parsed.aggregateContentHash === "string"
    ) {
      return {
        version: CUSTOM_CONTEXT_SCHEMA_VERSION,
        sourceKind: input.sourceKind,
        noteEntries: parsed.noteEntries,
        structuredEntries: parsed.structuredEntries,
        aggregateContentHash: parsed.aggregateContentHash,
      };
    }
  } catch {
    // Missing or corrupt previous custom context is treated as absent. The
    // next write replaces it with a validated canonical artifact.
  }
  return {
    version: CUSTOM_CONTEXT_SCHEMA_VERSION,
    sourceKind: input.sourceKind,
    noteEntries: [],
    structuredEntries: [],
    aggregateContentHash: sha256Hex({
      kind: input.sourceKind,
      contentHashes: [],
    }),
  };
};

const writeCustomContextSource = async (
  artifactPath: string,
  source: CustomContextSource,
): Promise<void> => {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(source), "utf8");
  await rename(tempPath, artifactPath);
};

const discoverPrimarySources = async (
  runDir: string,
): Promise<TestIntentSourceRef[]> => {
  const refs: TestIntentSourceRef[] = [];
  const intentRef = await readIntentPrimarySource(runDir);
  if (intentRef !== null) refs.push(intentRef);
  refs.push(...(await readJiraPrimarySources(runDir)));
  const deduped = new Map<string, TestIntentSourceRef>();
  for (const ref of refs) {
    if (isPrimaryTestIntentSourceKind(ref.kind)) deduped.set(ref.sourceId, ref);
  }
  return [...deduped.values()].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId),
  );
};

const readIntentPrimarySource = async (
  runDir: string,
): Promise<TestIntentSourceRef | null> => {
  try {
    const raw = await readFile(
      path.join(runDir, BUSINESS_INTENT_IR_FILENAME),
      "utf8",
    );
    const intent = JSON.parse(raw) as BusinessTestIntentIr;
    const envelopePrimary = intent.sourceEnvelope?.sources.find((source) =>
      isPrimaryTestIntentSourceKind(source.kind),
    );
    if (envelopePrimary !== undefined) return envelopePrimary;
    if (
      intent.source.kind === "figma_local_json" ||
      intent.source.kind === "figma_plugin" ||
      intent.source.kind === "figma_rest"
    ) {
      return {
        sourceId: "business-intent-primary",
        kind: intent.source.kind,
        contentHash: intent.source.contentHash,
        capturedAt: "1970-01-01T00:00:00.000Z",
      };
    }
  } catch {
    return null;
  }
  return null;
};

const readJiraPrimarySources = async (
  runDir: string,
): Promise<TestIntentSourceRef[]> => {
  const sourcesRoot = path.join(runDir, SOURCES_DIR);
  let entries: string[];
  try {
    entries = await readdir(sourcesRoot);
  } catch {
    return [];
  }
  const refs: TestIntentSourceRef[] = [];
  for (const sourceId of entries) {
    try {
      const raw = await readFile(
        path.join(sourcesRoot, sourceId, JIRA_ISSUE_IR_FILENAME),
        "utf8",
      );
      const ir = JSON.parse(raw) as JiraIssueIr;
      const provenance = await readJiraProvenance(runDir, sourceId);
      const ref: TestIntentSourceRef = {
        sourceId,
        kind: "jira_paste",
        contentHash: ir.contentHash,
        capturedAt: provenance.capturedAt,
        canonicalIssueKey: ir.issueKey,
      };
      if (provenance.authorHandle !== undefined) {
        ref.authorHandle = provenance.authorHandle;
      }
      refs.push(ref);
    } catch {
      // Ignore non-Jira source directories.
    }
  }
  return refs;
};

const readJiraProvenance = async (
  runDir: string,
  sourceId: string,
): Promise<{ capturedAt: string; authorHandle: string | undefined }> => {
  try {
    const raw = await readFile(
      path.join(runDir, SOURCES_DIR, sourceId, JIRA_PASTE_PROVENANCE_FILENAME),
      "utf8",
    );
    const parsed = JSON.parse(raw) as {
      capturedAt?: unknown;
      authorHandle?: unknown;
    };
    return {
      capturedAt:
        typeof parsed.capturedAt === "string"
          ? parsed.capturedAt
          : "1970-01-01T00:00:00.000Z",
      authorHandle:
        typeof parsed.authorHandle === "string"
          ? parsed.authorHandle
          : undefined,
    };
  } catch {
    return { capturedAt: "1970-01-01T00:00:00.000Z", authorHandle: undefined };
  }
};
