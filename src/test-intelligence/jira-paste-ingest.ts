import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  JIRA_ISSUE_IR_ARTIFACT_DIRECTORY,
  type JiraIssueIr,
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { buildMultiSourceTestIntentEnvelope } from "./multi-source-envelope.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildJiraIssueIr,
  writeJiraIssueIr,
  type BuildJiraIssueIrInput,
  type BuildJiraIssueIrResult,
  type JiraAdfSource,
} from "./jira-issue-ir.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

export const MAX_JIRA_PASTE_INPUT_BYTES: number = 256 * 1024;
export const JIRA_PASTE_PROVENANCE_ARTIFACT_FILENAME: string =
  "paste-provenance.json";

export type JiraPasteDeclaredFormat =
  | "auto"
  | "adf_json"
  | "plain_text"
  | "markdown";

export type JiraPasteDetectedFormat = Exclude<JiraPasteDeclaredFormat, "auto">;

export interface JiraPasteIngestRequest {
  jobId: string;
  format: JiraPasteDeclaredFormat;
  body: string;
}

export interface JiraPasteProvenance {
  pasteSessionId: string;
  authorHandle: string;
  capturedAt: string;
  detectedFormat: JiraPasteDetectedFormat;
  contentHash: string;
  sourceKind: "jira_paste";
  primarySource: true;
}

export interface JiraPasteSourceMixHint {
  candidate: "jira_paste_only";
  primarySource: true;
  issueKey: string;
  sourceId: string;
}

export interface JiraPasteIngestResult {
  sourceId: string;
  jiraIssueIr: JiraIssueIr;
  provenance: JiraPasteProvenance;
  sourceRef: TestIntentSourceRef;
  sourceMixHint: JiraPasteSourceMixHint;
  jiraIssueIrArtifactPath: string;
  pasteProvenanceArtifactPath: string;
}

export type JiraPasteIngestRefusalCode =
  | "paste_payload_too_large"
  | "paste_html_injection_refused"
  | "paste_malformed_utf8_refused"
  | "paste_format_invalid"
  | "paste_body_invalid"
  | "paste_issue_key_missing"
  | "paste_summary_missing"
  | "paste_status_missing"
  | "paste_jira_ir_invalid"
  | "paste_persistence_failed";

export type JiraPasteIngestOutcome =
  | { ok: true; result: JiraPasteIngestResult }
  | {
      ok: false;
      statusCode: 400 | 413 | 422 | 500;
      code: JiraPasteIngestRefusalCode;
      message: string;
      detail?: string;
    };

interface IngestAndPersistInput {
  runDir: string;
  request: JiraPasteIngestRequest;
  authorHandle: string;
  capturedAt?: string;
}

const JOB_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/u;
const AUTHOR_HANDLE_RE = /^[A-Za-z0-9._-]{1,64}$/u;
const JIRA_ISSUE_KEY_FIND_RE = /\b[A-Z][A-Z0-9_]+-[1-9][0-9]*\b/u;
const CUSTOM_FIELD_ID_RE = /^customfield_[0-9]{5,12}$/u;
const ISO_UTC_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/u;
const EXECUTABLE_HTML_RE =
  /<\s*script\b|javascript\s*:|<[^>]+\son[a-z][a-z0-9_-]*\s*=/iu;
const DETERMINISTIC_JIRA_IR_CAPTURED_AT = "1970-01-01T00:00:00.000Z";
const ALLOWED_PASTE_FORMATS: ReadonlySet<string> = new Set([
  "auto",
  "adf_json",
  "plain_text",
  "markdown",
]);

const FIELD_LABELS = new Map<string, keyof ParsedTextFields>([
  ["key", "issueKey"],
  ["issue key", "issueKey"],
  ["issue", "issueKey"],
  ["summary", "summary"],
  ["title", "summary"],
  ["type", "issueType"],
  ["issue type", "issueType"],
  ["status", "status"],
  ["priority", "priority"],
  ["labels", "labels"],
  ["components", "components"],
  ["fix versions", "fixVersions"],
  ["fixversions", "fixVersions"],
  ["description", "description"],
]);

interface ParsedTextFields {
  issueKey?: string;
  issueType?: string;
  summary?: string;
  status?: string;
  priority?: string;
  labels?: string;
  components?: string;
  fixVersions?: string;
  description?: string;
}

export const sanitizeJiraPasteAuthorHandle = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return AUTHOR_HANDLE_RE.test(trimmed) ? trimmed : undefined;
};

export const detectJiraPasteFormat = (body: string): JiraPasteDetectedFormat => {
  const trimmed = body.trimStart();
  if (looksLikeAdfJson(trimmed)) return "adf_json";
  if (looksLikeMarkdown(body)) return "markdown";
  return "plain_text";
};

export const ingestJiraPaste = (input: {
  request: JiraPasteIngestRequest;
  authorHandle: string;
  capturedAt?: string;
}): JiraPasteIngestOutcome => {
  const request = input.request;
  const basicValidation = validateBasicRequest(request, input.authorHandle);
  if (basicValidation !== null) return basicValidation;

  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (!ISO_UTC_RE.test(capturedAt)) {
    return refusal(400, "paste_body_invalid", "capturedAt must be ISO UTC.");
  }

  const detectedFormat =
    request.format === "auto" ? detectJiraPasteFormat(request.body) : request.format;
  const contentHash = sha256RawUtf8(request.body);
  const normalizedBody = redactHighRiskSecrets(
    request.body,
    "[redacted-secret]",
  );
  const buildInputResult = buildJiraInputFromPaste({
    body: normalizedBody,
    detectedFormat,
  });
  if (!buildInputResult.ok) return buildInputResult;

  const built = buildJiraIssueIr(buildInputResult.input);
  if (!built.ok) return mapJiraIrRefusal(built);

  const pasteSessionId = randomUUID();
  const sourceId = `jira-paste-${pasteSessionId.slice(0, 8)}-${contentHash.slice(0, 12)}`;
  const provenance: JiraPasteProvenance = {
    pasteSessionId,
    authorHandle: input.authorHandle,
    capturedAt,
    detectedFormat,
    contentHash,
    sourceKind: "jira_paste",
    primarySource: true,
  };
  const sourceRef: TestIntentSourceRef = {
    sourceId,
    kind: "jira_paste",
    contentHash: built.ir.contentHash,
    capturedAt,
    authorHandle: input.authorHandle,
    canonicalIssueKey: built.ir.issueKey,
  };

  return {
    ok: true,
    result: {
      sourceId,
      jiraIssueIr: built.ir,
      provenance,
      sourceRef,
      sourceMixHint: {
        candidate: "jira_paste_only",
        primarySource: true,
        issueKey: built.ir.issueKey,
        sourceId,
      },
      jiraIssueIrArtifactPath: "",
      pasteProvenanceArtifactPath: "",
    },
  };
};

export const ingestAndPersistJiraPaste = async (
  input: IngestAndPersistInput,
): Promise<JiraPasteIngestOutcome> => {
  const outcome = ingestJiraPaste({
    request: input.request,
    authorHandle: input.authorHandle,
    ...(input.capturedAt !== undefined ? { capturedAt: input.capturedAt } : {}),
  });
  if (!outcome.ok) return outcome;

  try {
    const writeResult = await writeJiraIssueIr({
      runDir: input.runDir,
      sourceId: outcome.result.sourceId,
      ir: outcome.result.jiraIssueIr,
    });
    const provenancePath = await writePasteProvenance({
      runDir: input.runDir,
      sourceId: outcome.result.sourceId,
      provenance: outcome.result.provenance,
    });
    return {
      ok: true,
      result: {
        ...outcome.result,
        jiraIssueIrArtifactPath: writeResult.artifactPath,
        pasteProvenanceArtifactPath: provenancePath,
      },
    };
  } catch {
    return refusal(
      500,
      "paste_persistence_failed",
      "Jira paste artifacts could not be persisted.",
    );
  }
};

export const buildJiraPasteOnlyEnvelope = (
  sourceRef: TestIntentSourceRef,
): MultiSourceTestIntentEnvelope =>
  buildMultiSourceTestIntentEnvelope({
    sources: [sourceRef],
    conflictResolutionPolicy: "reviewer_decides",
  });

const validateBasicRequest = (
  request: JiraPasteIngestRequest,
  authorHandle: string,
): JiraPasteIngestOutcome | null => {
  if (!JOB_ID_RE.test(request.jobId) || request.jobId === "." || request.jobId === "..") {
    return refusal(400, "paste_body_invalid", "jobId is invalid.");
  }
  if (!AUTHOR_HANDLE_RE.test(authorHandle)) {
    return refusal(400, "paste_body_invalid", "authorHandle is invalid.");
  }
  if (!ALLOWED_PASTE_FORMATS.has(request.format)) {
    return refusal(400, "paste_format_invalid", "Unsupported Jira paste format.");
  }
  if (typeof request.body !== "string" || request.body.length === 0) {
    return refusal(400, "paste_body_invalid", "Jira paste body must be a non-empty string.");
  }
  if (Buffer.byteLength(request.body, "utf8") > MAX_JIRA_PASTE_INPUT_BYTES) {
    return refusal(
      413,
      "paste_payload_too_large",
      `Jira paste body exceeds ${MAX_JIRA_PASTE_INPUT_BYTES} bytes.`,
    );
  }
  if (request.body.includes("\uFFFD")) {
    return refusal(
      400,
      "paste_malformed_utf8_refused",
      "Jira paste body contains malformed UTF-8 replacement characters.",
    );
  }
  if (EXECUTABLE_HTML_RE.test(request.body)) {
    return refusal(
      400,
      "paste_html_injection_refused",
      "Jira paste body contains executable HTML or JavaScript.",
    );
  }
  return null;
};

const buildJiraInputFromPaste = (input: {
  body: string;
  detectedFormat: JiraPasteDetectedFormat;
}):
  | { ok: true; input: BuildJiraIssueIrInput }
  | Exclude<JiraPasteIngestOutcome, { ok: true }> => {
  if (input.detectedFormat === "adf_json") {
    const parsed = parseJson(input.body);
    if (!parsed.ok) {
      return refusal(400, "paste_body_invalid", "ADF JSON paste must be valid JSON.");
    }
    const jiraIssue = buildFromJiraJson(parsed.value);
    if (jiraIssue.ok) return jiraIssue;
    if (isAdfDocument(parsed.value)) {
      return buildFromText(stripMarkdownToPlain(adfDocToTextFallback(input.body)), {
        description: { kind: "adf", json: input.body },
      });
    }
    return jiraIssue;
  }

  const plain =
    input.detectedFormat === "markdown"
      ? stripMarkdownToPlain(input.body)
      : normalizePlainText(input.body);
  return buildFromText(plain, { description: { kind: "plain", text: plain } });
};

const buildFromJiraJson = (
  value: unknown,
):
  | { ok: true; input: BuildJiraIssueIrInput }
  | Exclude<JiraPasteIngestOutcome, { ok: true }> => {
  const issue = selectJiraIssueObject(value);
  if (issue === undefined) {
    const direct = buildFromDirectJson(value);
    if (direct.ok) return direct;
    return refusal(
      422,
      "paste_issue_key_missing",
      "Jira JSON paste must contain a Jira issue key.",
    );
  }

  const fields = isRecord(issue.fields) ? issue.fields : {};
  const descriptionField = fields["description"];
  let description: JiraAdfSource = { kind: "absent" };
  if (typeof descriptionField === "string") {
    description = { kind: "plain", text: descriptionField };
  } else if (descriptionField !== null && isRecord(descriptionField)) {
    description = { kind: "adf", json: JSON.stringify(descriptionField) };
  }
  const priority = readNamedField(fields["priority"]);

  return {
    ok: true,
    input: {
      issueKey: typeof issue.key === "string" ? issue.key : "",
      issueType: readNamedField(fields["issuetype"])?.toLowerCase() ?? "other",
      summary: typeof fields["summary"] === "string" ? fields["summary"] : "",
      description,
      status: readNamedField(fields["status"]) ?? "",
      ...(priority !== undefined ? { priority } : {}),
      labels: readStringArray(fields["labels"]),
      components: readNamedArray(fields["components"]),
      fixVersions: readNamedArray(fields["fixVersions"]),
      customFields: Object.entries(fields)
        .filter(
          ([key, child]) =>
            CUSTOM_FIELD_ID_RE.test(key) &&
            child !== null &&
            child !== undefined,
        )
        .map(([key, child]) => ({
          id: key,
          name: key,
          value: typeof child === "string" ? child : JSON.stringify(child),
        })),
      capturedAt: DETERMINISTIC_JIRA_IR_CAPTURED_AT,
    },
  };
};

const buildFromDirectJson = (
  value: unknown,
):
  | { ok: true; input: BuildJiraIssueIrInput }
  | Exclude<JiraPasteIngestOutcome, { ok: true }> => {
  if (!isRecord(value)) {
    return refusal(422, "paste_issue_key_missing", "Jira paste must contain an issue key.");
  }
  const issueKey = stringValue(value["issueKey"]) ?? stringValue(value["key"]);
  if (issueKey === undefined) {
    return refusal(422, "paste_issue_key_missing", "Jira paste must contain an issue key.");
  }
  const summary = stringValue(value["summary"]) ?? stringValue(value["title"]);
  if (summary === undefined) {
    return refusal(422, "paste_summary_missing", "Jira paste must contain a summary.");
  }
  const status = stringValue(value["status"]) ?? "Open";
  const priority = stringValue(value["priority"]);
  const descriptionValue = value["description"];
  const description =
    typeof descriptionValue === "string"
      ? { kind: "plain" as const, text: descriptionValue }
      : isAdfDocument(descriptionValue)
        ? { kind: "adf" as const, json: JSON.stringify(descriptionValue) }
        : { kind: "absent" as const };

  return {
    ok: true,
    input: {
      issueKey,
      issueType: (
        stringValue(value["issueType"]) ??
        stringValue(value["type"]) ??
        "other"
      ).toLowerCase(),
      summary,
      description,
      status,
      ...(priority !== undefined ? { priority } : {}),
      labels: readStringArray(value["labels"]),
      components: readStringArray(value["components"]),
      fixVersions: readStringArray(value["fixVersions"]),
      capturedAt: DETERMINISTIC_JIRA_IR_CAPTURED_AT,
    },
  };
};

const buildFromText = (
  text: string,
  override: { description: JiraAdfSource },
):
  | { ok: true; input: BuildJiraIssueIrInput }
  | Exclude<JiraPasteIngestOutcome, { ok: true }> => {
  const fields = parseTextFields(text);
  const issueKey = fields.issueKey ?? text.match(JIRA_ISSUE_KEY_FIND_RE)?.[0];
  if (issueKey === undefined) {
    return refusal(422, "paste_issue_key_missing", "Jira paste must contain an issue key.");
  }
  const summary = fields.summary ?? firstSummaryLine(text, issueKey);
  if (summary === undefined) {
    return refusal(422, "paste_summary_missing", "Jira paste must contain a summary.");
  }
  const descriptionText = fields.description ?? text;
  return {
    ok: true,
    input: {
      issueKey,
      issueType: (fields.issueType ?? "other").toLowerCase(),
      summary,
      description:
        override.description.kind === "adf"
          ? override.description
          : { kind: "plain", text: descriptionText },
      status: fields.status ?? "Open",
      ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
      labels: splitList(fields.labels),
      components: splitList(fields.components),
      fixVersions: splitList(fields.fixVersions),
      capturedAt: DETERMINISTIC_JIRA_IR_CAPTURED_AT,
    },
  };
};

const parseTextFields = (text: string): ParsedTextFields => {
  const lines = text.split(/\r?\n/u);
  const fields: ParsedTextFields = {};
  let descriptionLines: string[] | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (descriptionLines !== undefined) descriptionLines.push("");
      continue;
    }
    const match = /^([A-Za-z][A-Za-z ]{1,32})\s*:\s*(.*)$/u.exec(line);
    const key = match?.[1]?.trim().toLowerCase();
    const target = key !== undefined ? FIELD_LABELS.get(key) : undefined;
    if (target !== undefined && match !== null) {
      const value = match[2]?.trim() ?? "";
      if (target === "description") {
        descriptionLines = value.length > 0 ? [value] : [];
      } else if (value.length > 0) {
        fields[target] = value;
        descriptionLines = undefined;
      }
      continue;
    }
    if (descriptionLines !== undefined) {
      descriptionLines.push(rawLine);
    }
  }

  if (descriptionLines !== undefined) {
    const description = descriptionLines.join("\n").trim();
    if (description.length > 0) fields.description = description;
  }
  return fields;
};

const firstSummaryLine = (text: string, issueKey: string): string | undefined => {
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line === issueKey) continue;
    const withoutKey = line.replace(issueKey, "").trim();
    if (withoutKey.length > 0) return withoutKey.slice(0, 1024);
  }
  return undefined;
};

const writePasteProvenance = async (input: {
  runDir: string;
  sourceId: string;
  provenance: JiraPasteProvenance;
}): Promise<string> => {
  const dir = path.join(
    input.runDir,
    JIRA_ISSUE_IR_ARTIFACT_DIRECTORY,
    input.sourceId,
  );
  await mkdir(dir, { recursive: true });
  const artifactPath = path.join(dir, JIRA_PASTE_PROVENANCE_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.provenance), "utf8");
  await rename(tempPath, artifactPath);
  return artifactPath;
};

const looksLikeAdfJson = (body: string): boolean => {
  if (!body.startsWith("{")) return false;
  const parsed = parseJson(body);
  return parsed.ok && isAdfDocument(parsed.value);
};

const looksLikeMarkdown = (body: string): boolean =>
  /^#{1,6}\s+/mu.test(body) ||
  /```/u.test(body) ||
  /^\s*[-*+]\s+/mu.test(body) ||
  /\[[^\]]+\]\([^)]+\)/u.test(body);

const stripMarkdownToPlain = (body: string): string => {
  let out = normalizePlainText(body);
  out = out.replace(/```[A-Za-z0-9_-]*\n?/gu, "");
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1");
  out = out.replace(/^#{1,6}\s+/gmu, "");
  out = out.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gmu, "");
  out = out.replace(/[*_~`]+/gu, "");
  out = out.replace(/<[^>]+>/gu, "");
  return out.trim();
};

const normalizePlainText = (body: string): string =>
  body.replace(/\r\n?/gu, "\n").trim();

const adfDocToTextFallback = (body: string): string => {
  const parsed = parseJson(body);
  if (!parsed.ok || !isRecord(parsed.value)) return body;
  const parts: string[] = [];
  collectText(parsed.value, parts);
  return parts.join("\n");
};

const collectText = (value: unknown, parts: string[]): void => {
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, parts);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value["text"] === "string") parts.push(value["text"]);
  for (const child of Object.values(value)) collectText(child, parts);
};

const selectJiraIssueObject = (
  value: unknown,
): { key?: unknown; fields?: unknown } | undefined => {
  if (!isRecord(value)) return undefined;
  if ("key" in value && "fields" in value) return value;
  const issues = value["issues"];
  if (Array.isArray(issues) && issues.length === 1 && isRecord(issues[0])) {
    return issues[0];
  }
  return undefined;
};

const isAdfDocument = (value: unknown): boolean =>
  isRecord(value) && value["type"] === "doc" && "version" in value;

const parseJson = (
  body: string,
): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
};

const readNamedField = (value: unknown): string | undefined => {
  if (isRecord(value) && typeof value["name"] === "string") return value["name"];
  if (typeof value === "string") return value;
  return undefined;
};

const readNamedArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => readNamedField(entry))
        .filter((entry): entry is string => entry !== undefined)
    : [];

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : [];

const splitList = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .split(/[,\n]/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256RawUtf8 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const mapJiraIrRefusal = (
  built: Extract<BuildJiraIssueIrResult, { ok: false }>,
): Exclude<JiraPasteIngestOutcome, { ok: true }> =>
  refusal(
    422,
    "paste_jira_ir_invalid",
    "Jira paste could not be normalized to a valid Jira issue IR.",
    `${built.code}${built.path !== undefined ? ` at ${built.path}` : ""}`,
  );

const refusal = (
  statusCode: 400 | 413 | 422 | 500,
  code: JiraPasteIngestRefusalCode,
  message: string,
  detail?: string,
): Exclude<JiraPasteIngestOutcome, { ok: true }> => ({
  ok: false,
  statusCode,
  code,
  message,
  ...(detail !== undefined ? { detail } : {}),
});
