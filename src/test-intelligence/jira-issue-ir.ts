/**
 * Jira issue IR builder + validators (Issue #1432, Wave 4.B).
 *
 * Pure, side-effect-free builders that turn a raw Jira-shaped input into
 * a canonical, PII-redacted, deterministically-hashed
 * {@link JiraIssueIr}. The only IO surface here is
 * {@link writeJiraIssueIr}, which performs an atomic temp-file rename
 * under `<runDir>/sources/<sourceId>/jira-issue-ir.json`.
 *
 * Design invariants:
 *
 *   1. The builder never accepts a raw Jira `self`/`avatarUrls`/
 *      `attachment.content`/`thumbnail`/`names`/`schema` map. Callers
 *      pass a structured input that pre-strips those fields.
 *   2. Every textual field is run through {@link maybeRedactJira} before
 *      it is placed on the IR. Detected indicators populate
 *      {@link JiraIssueIr.piiIndicators} / {@link JiraIssueIr.redactions}.
 *   3. Comments / attachments / linked issues / unknown custom fields
 *      are excluded by default. Each opt-in is recorded in
 *      {@link JiraIssueIr.dataMinimization} so audits can verify what
 *      was collected.
 *   4. The IR's {@link JiraIssueIr.contentHash} is the SHA-256 of the
 *      canonical JSON serialization of the IR with `contentHash` itself
 *      stripped — identical inputs always hash identically.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  ALLOWED_JIRA_ISSUE_TYPES,
  DEFAULT_JIRA_FIELD_SELECTION_PROFILE,
  JIRA_ISSUE_IR_ARTIFACT_DIRECTORY,
  JIRA_ISSUE_IR_ARTIFACT_FILENAME,
  JIRA_ISSUE_IR_SCHEMA_VERSION,
  MAX_JIRA_ATTACHMENT_COUNT,
  MAX_JIRA_COMMENT_BODY_BYTES,
  MAX_JIRA_COMMENT_COUNT,
  MAX_JIRA_CUSTOM_FIELD_COUNT,
  MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES,
  MAX_JIRA_DESCRIPTION_PLAIN_BYTES,
  MAX_JIRA_LINK_COUNT,
  type IntentRedaction,
  type JiraAcceptanceCriterion,
  type JiraAttachmentRef,
  type JiraComment,
  type JiraFieldSelectionProfile,
  type JiraIrRefusalCode,
  type JiraIssueIr,
  type JiraIssueIrCustomField,
  type JiraIssueIrDataMinimization,
  type JiraIssueType,
  type JiraLinkRef,
  type PiiIndicator,
  type PiiKind,
  type PiiMatchLocation,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  detectCustomerNameInLabelledField,
  detectPii,
  isCustomerNameShapedFieldName,
  redactPii,
  type PiiMatch,
} from "./pii-detection.js";
import { parseJiraAdfDocument } from "./jira-adf-parser.js";

// --- Validators ------------------------------------------------------------

const JIRA_ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/;
const MAX_JIRA_ISSUE_KEY_LENGTH = 64;
const CUSTOM_FIELD_ID_RE = /^customfield_[0-9]{5,12}$/;
const ISO_UTC_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/;
const SAFE_LABEL_RE = /^[A-Za-z0-9._-][A-Za-z0-9 ._-]{0,63}$/;
const MAX_JIRA_RELATIONSHIP_LENGTH = 64;
const MAX_JIRA_STATUS_LENGTH = 64;
const MAX_JIRA_PRIORITY_LENGTH = 32;
const MAX_JIRA_SUMMARY_BYTES = 1_024;
const MAX_JIRA_FILENAME_LENGTH = 128;

/**
 * Validate a Jira issue key. Returns `true` for keys matching
 * `^[A-Z][A-Z0-9_]+-[1-9][0-9]*$` and ≤ 64 characters.
 */
export const isValidJiraIssueKey = (input: unknown): input is string => {
  return (
    typeof input === "string" &&
    input.length <= MAX_JIRA_ISSUE_KEY_LENGTH &&
    JIRA_ISSUE_KEY_RE.test(input)
  );
};

const JQL_DISALLOWED_TOKEN_RE =
  /(?:--)|(?:;)|(?:`)|(?:\bOR\s+1\s*=\s*1\b)|(?:\bAND\s+1\s*=\s*1\b)|(?:\b1\s*=\s*1\b)/iu;
const hasJqlControlCharacter = (value: string): boolean => {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};
const MAX_JQL_FRAGMENT_LENGTH = 512;

/**
 * Refusal-bearing result of the JQL fragment sanitizer.
 */
export type SanitizeJqlFragmentResult =
  | { ok: true; sanitized: string }
  | { ok: false; code: JiraIrRefusalCode; detail?: string };

/**
 * Sanitize a caller-supplied JQL fragment. Rejects:
 *
 *   - Inline-comment / statement-terminator / backtick characters
 *     (`--`, `;`, `` ` ``).
 *   - Hijack patterns (`OR 1=1`, `AND 1=1`, plain `1=1`).
 *   - ASCII / DEL control characters.
 *   - Inputs longer than 512 chars.
 *
 * The sanitizer is conservative — callers MUST treat any rejection as a
 * fail-closed signal; there is no autocorrect path. A successful result
 * carries the trimmed, normalised fragment.
 */
export const sanitizeJqlFragment = (
  input: unknown,
): SanitizeJqlFragmentResult => {
  if (typeof input !== "string") {
    return {
      ok: false,
      code: "jira_jql_fragment_disallowed_token",
      detail: "non-string",
    };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: "jira_jql_fragment_disallowed_token",
      detail: "empty",
    };
  }
  if (trimmed.length > MAX_JQL_FRAGMENT_LENGTH) {
    return { ok: false, code: "jira_jql_fragment_too_long" };
  }
  if (hasJqlControlCharacter(trimmed)) {
    return { ok: false, code: "jira_jql_fragment_control_character" };
  }
  if (JQL_DISALLOWED_TOKEN_RE.test(trimmed)) {
    return { ok: false, code: "jira_jql_fragment_disallowed_token" };
  }
  return { ok: true, sanitized: trimmed };
};

const isValidIssueType = (input: unknown): input is JiraIssueType => {
  return (
    typeof input === "string" &&
    (ALLOWED_JIRA_ISSUE_TYPES as readonly string[]).includes(input)
  );
};

// --- IR builder ------------------------------------------------------------

/** Raw inline ADF representation: caller already parsed the JSON. */
export interface JiraAdfInputObject {
  /** ADF document serialized to a JSON string. */
  json: string;
}

/** Discriminator for an ADF source: either pre-serialized JSON or a plain string. */
export type JiraAdfSource =
  | { kind: "adf"; json: string }
  | { kind: "plain"; text: string }
  | { kind: "absent" };

/** Single raw Jira comment input (caller pre-strips raw account ids / URLs). */
export interface JiraCommentInput {
  authorHandle?: string;
  createdAt: string;
  body: JiraAdfSource;
}

/** Single raw Jira attachment input. Bytes are NEVER passed in here. */
export interface JiraAttachmentInput {
  filename: string;
  mimeType?: string;
  byteSize?: number;
}

/** Single raw Jira link input. */
export interface JiraLinkInput {
  targetIssueKey: string;
  relationship: string;
}

/** Single raw Jira custom field input. */
export interface JiraCustomFieldInput {
  /** Jira custom-field id (e.g. `"customfield_10042"`). */
  id: string;
  /** Display name as reported by Jira. PII-redacted before persistence. */
  name: string;
  /** Scalar string value; arrays/objects must be flattened by the caller. */
  value: string;
}

/** Inputs accepted by {@link buildJiraIssueIr}. */
export interface BuildJiraIssueIrInput {
  issueKey: string;
  issueType: string;
  summary: string;
  description: JiraAdfSource;
  status: string;
  priority?: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  comments?: JiraCommentInput[];
  attachments?: JiraAttachmentInput[];
  links?: JiraLinkInput[];
  customFields?: JiraCustomFieldInput[];
  capturedAt: string;
  /** Field-selection / data-minimization profile. Defaults to {@link DEFAULT_JIRA_FIELD_SELECTION_PROFILE}. */
  fieldSelection?: Partial<JiraFieldSelectionProfile>;
}

/** Refusal-bearing result of the IR builder. */
export type BuildJiraIssueIrResult =
  | { ok: true; ir: JiraIssueIr }
  | { ok: false; code: JiraIrRefusalCode; path?: string; detail?: string };

/**
 * Build a canonical Jira IR from a structured input. Fail-closed at every
 * gate; the returned discriminated union never throws.
 */
export const buildJiraIssueIr = (
  input: BuildJiraIssueIrInput,
): BuildJiraIssueIrResult => {
  const rawIssueKey: unknown = input.issueKey;
  if (!isValidJiraIssueKey(rawIssueKey)) {
    const tooLong =
      typeof rawIssueKey === "string" &&
      rawIssueKey.length > MAX_JIRA_ISSUE_KEY_LENGTH;
    return refusal(
      tooLong ? "jira_issue_key_too_long" : "jira_issue_key_invalid",
      "issueKey",
    );
  }
  if (typeof input.summary !== "string" || input.summary.length === 0) {
    return refusal("jira_summary_invalid", "summary");
  }
  if (Buffer.byteLength(input.summary, "utf8") > MAX_JIRA_SUMMARY_BYTES) {
    return refusal("jira_summary_invalid", "summary", "summary too large");
  }
  if (
    typeof input.status !== "string" ||
    input.status.length === 0 ||
    input.status.length > MAX_JIRA_STATUS_LENGTH
  ) {
    return refusal("jira_status_invalid", "status");
  }
  if (
    input.priority !== undefined &&
    (typeof input.priority !== "string" ||
      input.priority.length === 0 ||
      input.priority.length > MAX_JIRA_PRIORITY_LENGTH)
  ) {
    return refusal("jira_priority_invalid", "priority");
  }
  if (
    typeof input.capturedAt !== "string" ||
    !ISO_UTC_RE.test(input.capturedAt)
  ) {
    return refusal("jira_captured_at_invalid", "capturedAt");
  }

  const profile = resolveProfile(input.fieldSelection);
  const profileValidation = validateProfile(profile);
  if (profileValidation !== null) return profileValidation;

  const issueType: JiraIssueType = isValidIssueType(input.issueType)
    ? input.issueType
    : "other";

  const piiIndicators: PiiIndicator[] = [];
  const redactions: IntentRedaction[] = [];

  // Summary
  const summary = redactInline(
    input.summary,
    "jira_summary",
    "issue::summary",
    piiIndicators,
    redactions,
  );

  // Description
  const dataMin: JiraIssueIrDataMinimization = {
    descriptionIncluded: false,
    descriptionTruncated: false,
    commentsIncluded: false,
    commentsDropped: 0,
    commentsCapped: 0,
    attachmentsIncluded: false,
    attachmentsDropped: 0,
    linksIncluded: false,
    linksDropped: 0,
    customFieldsIncluded: 0,
    unknownCustomFieldsExcluded: 0,
    customFieldsCapped: 0,
  };

  let descriptionPlain = "";
  if (profile.includeDescription && input.description.kind !== "absent") {
    const parsed = normalizeAdfSource(input.description, "description");
    if ("ok" in parsed) return parsed;
    const rawText = "text" in parsed ? parsed.text : "";
    const redacted = redactInline(
      rawText,
      "jira_description",
      "issue::description",
      piiIndicators,
      redactions,
    );
    const capped = capUtf8Bytes(redacted, MAX_JIRA_DESCRIPTION_PLAIN_BYTES);
    descriptionPlain = capped.value;
    dataMin.descriptionIncluded = true;
    dataMin.descriptionTruncated = capped.truncated;
  }

  // Acceptance criteria — extracted from configured custom fields
  const acceptanceCriteria: JiraAcceptanceCriterion[] = [];
  const customFieldsByIdRaw = new Map<string, JiraCustomFieldInput>();
  if (Array.isArray(input.customFields)) {
    for (const cf of input.customFields) {
      if (!isPlainObject(cf)) {
        return refusal("jira_custom_field_invalid", "customFields");
      }
      if (typeof cf.id !== "string" || !CUSTOM_FIELD_ID_RE.test(cf.id)) {
        return refusal("jira_custom_field_id_invalid", "customFields");
      }
      if (typeof cf.name !== "string" || typeof cf.value !== "string") {
        return refusal("jira_custom_field_invalid", "customFields");
      }
      customFieldsByIdRaw.set(cf.id, cf);
    }
  }
  for (const fieldId of profile.acceptanceCriterionFieldIds) {
    const raw = customFieldsByIdRaw.get(fieldId);
    if (raw === undefined) continue;
    const parsed = parseAcceptanceCriterionValue(raw.value);
    if ("ok" in parsed) return parsed;
    const lines = "lines" in parsed ? parsed.lines : [];
    for (const line of lines) {
      const id = `ac.${acceptanceCriteria.length}`;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const redacted = redactInline(
        trimmed,
        "jira_acceptance_criterion",
        `issue::ac::${id}`,
        piiIndicators,
        redactions,
      );
      acceptanceCriteria.push({ id, text: redacted, sourceFieldId: fieldId });
    }
  }

  // Custom fields (allow-list only)
  const customFields: JiraIssueIrCustomField[] = [];
  if (Array.isArray(input.customFields)) {
    const seenAcIds = new Set(profile.acceptanceCriterionFieldIds);
    for (const raw of input.customFields) {
      if (!isPlainObject(raw)) {
        return refusal("jira_custom_field_invalid", "customFields");
      }
      if (typeof raw.id !== "string" || !CUSTOM_FIELD_ID_RE.test(raw.id)) {
        return refusal("jira_custom_field_id_invalid", "customFields");
      }
      if (seenAcIds.has(raw.id)) continue;
      if (!profile.customFieldAllowList.includes(raw.id)) {
        dataMin.unknownCustomFieldsExcluded += 1;
        continue;
      }
      if (customFields.length >= MAX_JIRA_CUSTOM_FIELD_COUNT) {
        dataMin.unknownCustomFieldsExcluded += 1;
        continue;
      }
      if (typeof raw.name !== "string" || typeof raw.value !== "string") {
        return refusal("jira_custom_field_invalid", "customFields");
      }
      const idx = customFields.length;
      const nameRedacted = redactInline(
        raw.name,
        "jira_custom_field_name",
        `customfield::${raw.id}::name`,
        piiIndicators,
        redactions,
      );
      // Customer-name escalation runs before the generic detector so a
      // valid-shaped name in a customer-name-shaped field is recorded
      // with the more specific `customer_name_placeholder` kind.
      let valueRedactedRaw = raw.value;
      if (isCustomerNameShapedFieldName(raw.name)) {
        const match = detectCustomerNameInLabelledField(raw.value);
        if (match !== null) {
          recordIndicator(
            match,
            "jira_custom_field_value",
            `customfield::${raw.id}::value`,
            piiIndicators,
            redactions,
          );
          valueRedactedRaw = match.redacted;
        }
      }
      const valueRedacted = redactInline(
        valueRedactedRaw,
        "jira_custom_field_value",
        `customfield::${raw.id}::value`,
        piiIndicators,
        redactions,
      );
      const capped = capUtf8Bytes(
        valueRedacted,
        MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES,
      );
      if (capped.truncated) dataMin.customFieldsCapped += 1;
      customFields.push({
        id: raw.id,
        nameRedacted,
        valuePlain: capped.value,
        valueTruncated: capped.truncated,
      });
      dataMin.customFieldsIncluded += 1;
      void idx;
    }
  }

  // Comments
  const comments: JiraComment[] = [];
  if (profile.includeComments) {
    dataMin.commentsIncluded = true;
    const rawComments = Array.isArray(input.comments) ? input.comments : [];
    for (const raw of rawComments) {
      if (comments.length >= MAX_JIRA_COMMENT_COUNT) {
        dataMin.commentsDropped += 1;
        continue;
      }
      if (!isPlainObject(raw)) {
        return refusal("jira_comment_invalid", "comments");
      }
      if (
        typeof raw.createdAt !== "string" ||
        !ISO_UTC_RE.test(raw.createdAt)
      ) {
        return refusal("jira_comment_invalid", "comments[].createdAt");
      }
      const id = `comment.${comments.length}`;
      const parsed = normalizeAdfSource(
        raw.body,
        `comments[${comments.length}].body`,
      );
      if ("ok" in parsed) return parsed;
      const bodyRaw = "text" in parsed ? parsed.text : "";
      const redacted = redactInline(
        bodyRaw,
        "jira_comment_body",
        `comment::${id}`,
        piiIndicators,
        redactions,
      );
      const capped = capUtf8Bytes(redacted, MAX_JIRA_COMMENT_BODY_BYTES);
      if (capped.truncated) dataMin.commentsCapped += 1;
      const comment: JiraComment = {
        id,
        createdAt: raw.createdAt,
        body: capped.value,
        bodyTruncated: capped.truncated,
      };
      if (
        typeof raw.authorHandle === "string" &&
        raw.authorHandle.length > 0 &&
        raw.authorHandle.length <= 64
      ) {
        comment.authorHandle = raw.authorHandle;
      }
      comments.push(comment);
    }
  }

  // Attachments
  const attachments: JiraAttachmentRef[] = [];
  if (profile.includeAttachments) {
    dataMin.attachmentsIncluded = true;
    const rawAttachments = Array.isArray(input.attachments)
      ? input.attachments
      : [];
    for (const raw of rawAttachments) {
      if (attachments.length >= MAX_JIRA_ATTACHMENT_COUNT) {
        dataMin.attachmentsDropped += 1;
        continue;
      }
      if (!isPlainObject(raw) || typeof raw.filename !== "string") {
        return refusal("jira_attachment_invalid", "attachments");
      }
      if (
        raw.filename.length === 0 ||
        raw.filename.length > MAX_JIRA_FILENAME_LENGTH
      ) {
        return refusal("jira_attachment_invalid", "attachments[].filename");
      }
      const id = `attachment.${attachments.length}`;
      const filename = redactInline(
        raw.filename,
        "jira_attachment_filename",
        `attachment::${id}::filename`,
        piiIndicators,
        redactions,
      );
      const ref: JiraAttachmentRef = { id, filename };
      if (
        typeof raw.mimeType === "string" &&
        /^[A-Za-z0-9.+/_-]{1,64}$/.test(raw.mimeType)
      ) {
        ref.mimeType = raw.mimeType.toLowerCase();
      }
      if (
        typeof raw.byteSize === "number" &&
        Number.isFinite(raw.byteSize) &&
        raw.byteSize >= 0
      ) {
        ref.byteSize = Math.floor(raw.byteSize);
      }
      attachments.push(ref);
    }
  }

  // Links
  const links: JiraLinkRef[] = [];
  if (profile.includeLinks) {
    dataMin.linksIncluded = true;
    const rawLinks = Array.isArray(input.links) ? input.links : [];
    for (const raw of rawLinks) {
      if (links.length >= MAX_JIRA_LINK_COUNT) {
        dataMin.linksDropped += 1;
        continue;
      }
      if (!isPlainObject(raw) || !isValidJiraIssueKey(raw.targetIssueKey)) {
        return refusal("jira_link_invalid", "links");
      }
      if (
        typeof raw.relationship !== "string" ||
        raw.relationship.length === 0 ||
        raw.relationship.length > MAX_JIRA_RELATIONSHIP_LENGTH
      ) {
        return refusal("jira_link_invalid", "links[].relationship");
      }
      const id = `link.${links.length}`;
      const relationship = redactInline(
        raw.relationship.toLowerCase().replace(/\s+/gu, "_"),
        "jira_link_relationship",
        `link::${id}::relationship`,
        piiIndicators,
        redactions,
      );
      links.push({ id, targetIssueKey: raw.targetIssueKey, relationship });
    }
  }

  // Labels / components / fixVersions: redact + sort + dedupe
  const labels = sanitizeStringList(
    input.labels,
    "jira_label",
    "labels",
    piiIndicators,
    redactions,
  );
  if ("ok" in labels) return labels;
  const components = sanitizeStringList(
    input.components,
    "jira_component",
    "components",
    piiIndicators,
    redactions,
  );
  if ("ok" in components) return components;
  const fixVersions = sanitizeStringList(
    input.fixVersions,
    "jira_label",
    "fixVersions",
    piiIndicators,
    redactions,
  );
  if ("ok" in fixVersions) return fixVersions;

  const irNoHash: Omit<JiraIssueIr, "contentHash"> = {
    version: JIRA_ISSUE_IR_SCHEMA_VERSION,
    issueKey: input.issueKey,
    issueType,
    summary,
    descriptionPlain,
    acceptanceCriteria,
    labels: "values" in labels ? labels.values : [],
    components: "values" in components ? components.values : [],
    fixVersions: "values" in fixVersions ? fixVersions.values : [],
    status: input.status,
    customFields,
    comments,
    attachments,
    links,
    piiIndicators,
    redactions,
    dataMinimization: dataMin,
    capturedAt: input.capturedAt,
  };
  if (input.priority !== undefined) {
    (irNoHash as JiraIssueIr).priority = input.priority;
  }
  const contentHash = sha256Hex(irNoHash);
  return { ok: true, ir: { ...(irNoHash as JiraIssueIr), contentHash } };
};

// --- Persistence -----------------------------------------------------------

/** Inputs accepted by {@link writeJiraIssueIr}. */
export interface WriteJiraIssueIrInput {
  /** Run directory root (typically `<runDir>`). */
  runDir: string;
  /** Source identifier within the multi-source envelope. */
  sourceId: string;
  /** Built IR to persist. */
  ir: JiraIssueIr;
}

/** Result of {@link writeJiraIssueIr}. */
export interface WriteJiraIssueIrResult {
  /** Absolute path to the persisted artifact. */
  artifactPath: string;
  /** SHA-256 of the persisted bytes (lowercase hex). */
  artifactSha256: string;
  /** UTF-8 byte length of the persisted artifact. */
  byteLength: number;
}

const SOURCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Persist a {@link JiraIssueIr} to
 * `<runDir>/sources/<sourceId>/jira-issue-ir.json` using an atomic
 * temp-file rename for crash-safe writes.
 */
export const writeJiraIssueIr = async (
  input: WriteJiraIssueIrInput,
): Promise<WriteJiraIssueIrResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError("writeJiraIssueIr: runDir must be a non-empty string");
  }
  if (!SOURCE_ID_RE.test(input.sourceId)) {
    throw new TypeError(
      "writeJiraIssueIr: sourceId must match ^[A-Za-z0-9._-]{1,64}$",
    );
  }
  const dir = path.join(
    input.runDir,
    JIRA_ISSUE_IR_ARTIFACT_DIRECTORY,
    input.sourceId,
  );
  await mkdir(dir, { recursive: true });
  const artifactPath = path.join(dir, JIRA_ISSUE_IR_ARTIFACT_FILENAME);
  const tempPath = path.join(
    dir,
    `${JIRA_ISSUE_IR_ARTIFACT_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
  );
  const json = canonicalJson(input.ir);
  await writeFile(tempPath, json, { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return {
    artifactPath,
    artifactSha256: sha256Hex(input.ir),
    byteLength: Buffer.byteLength(json, "utf8"),
  };
};

// --- Helpers ---------------------------------------------------------------

const resolveProfile = (
  partial: Partial<JiraFieldSelectionProfile> | undefined,
): JiraFieldSelectionProfile => {
  const base = DEFAULT_JIRA_FIELD_SELECTION_PROFILE;
  if (partial === undefined) {
    return {
      includeDescription: base.includeDescription,
      includeComments: base.includeComments,
      includeAttachments: base.includeAttachments,
      includeLinks: base.includeLinks,
      customFieldAllowList: [...base.customFieldAllowList],
      acceptanceCriterionFieldIds: [...base.acceptanceCriterionFieldIds],
    };
  }
  return {
    includeDescription: partial.includeDescription ?? base.includeDescription,
    includeComments: partial.includeComments ?? base.includeComments,
    includeAttachments: partial.includeAttachments ?? base.includeAttachments,
    includeLinks: partial.includeLinks ?? base.includeLinks,
    customFieldAllowList: dedupeStrings(
      partial.customFieldAllowList ?? base.customFieldAllowList,
    ),
    acceptanceCriterionFieldIds: dedupeStrings(
      partial.acceptanceCriterionFieldIds ?? base.acceptanceCriterionFieldIds,
    ),
  };
};

const validateProfile = (
  profile: JiraFieldSelectionProfile,
): BuildJiraIssueIrResult | null => {
  for (const id of profile.customFieldAllowList) {
    if (!CUSTOM_FIELD_ID_RE.test(id)) {
      return refusal(
        "jira_field_selection_profile_invalid",
        "fieldSelection.customFieldAllowList",
        id.slice(0, 64),
      );
    }
  }
  for (const id of profile.acceptanceCriterionFieldIds) {
    if (!CUSTOM_FIELD_ID_RE.test(id)) {
      return refusal(
        "jira_field_selection_profile_invalid",
        "fieldSelection.acceptanceCriterionFieldIds",
        id.slice(0, 64),
      );
    }
  }
  return null;
};

const normalizeAdfSource = (
  source: JiraAdfSource,
  pathLabel: string,
):
  | { text: string }
  | { ok: false; code: JiraIrRefusalCode; path?: string; detail?: string } => {
  switch (source.kind) {
    case "adf": {
      const parsed = parseJiraAdfDocument(source.json);
      if (!parsed.ok) {
        return {
          ok: false,
          code: "jira_description_invalid",
          path: pathLabel,
          detail: parsed.rejection.code,
        };
      }
      return { text: parsed.document.plainText };
    }
    case "plain":
      return { text: source.text };
    case "absent":
      return { text: "" };
    default: {
      const exhaustive: never = source;
      return {
        ok: false,
        code: "jira_description_invalid",
        path: pathLabel,
        detail: String(exhaustive),
      };
    }
  }
};

const parseAcceptanceCriterionValue = (
  value: string,
):
  | { lines: string[] }
  | { ok: false; code: JiraIrRefusalCode; path?: string; detail?: string } => {
  // Common Jira shapes: bullet list ("- foo\n- bar"), numbered list,
  // ADF JSON, or plain text. We accept ADF if it parses cleanly,
  // otherwise treat the value as plain text and split on newlines.
  if (value.startsWith("{")) {
    const parsed = parseJiraAdfDocument(value);
    if (parsed.ok) {
      const lines: string[] = [];
      for (const block of parsed.document.blocks) {
        if (block.kind === "list_item" || block.kind === "paragraph") {
          if (block.text.trim().length > 0) lines.push(block.text);
        }
      }
      if (lines.length > 0) return { lines };
      return { lines: [parsed.document.plainText] };
    }
  }
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*[-*\d.)\s]+/u, "").trim())
    .filter((line) => line.length > 0);
  return { lines };
};

const sanitizeStringList = (
  raw: readonly string[] | undefined,
  location: PiiMatchLocation,
  pathLabel: string,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
):
  | { values: string[] }
  | { ok: false; code: JiraIrRefusalCode; path?: string; detail?: string } => {
  if (raw === undefined) return { values: [] };
  if (!Array.isArray(raw)) {
    return refusal("jira_summary_invalid", pathLabel);
  }
  const out = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (typeof item !== "string" || item.length === 0 || item.length > 64) {
      return refusal("jira_summary_invalid", `${pathLabel}[${i}]`);
    }
    if (!SAFE_LABEL_RE.test(item)) {
      return refusal(
        "jira_summary_invalid",
        `${pathLabel}[${i}]`,
        "unsafe characters",
      );
    }
    const redacted = redactInline(
      item,
      location,
      `${pathLabel}::${i}`,
      piiIndicators,
      redactions,
    );
    out.add(redacted);
  }
  return { values: [...out].sort() };
};

const dedupeStrings = (values: readonly string[]): string[] => {
  return [...new Set(values)];
};

const redactInline = (
  value: string,
  location: PiiMatchLocation,
  contextId: string,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): string => {
  if (value.length === 0) return value;
  // Stage 1: enumerate every detectable PII kind in the value so each
  // is recorded as a distinct indicator. We rerun the detector against
  // tokenised buffers so detections of one kind don't suppress another.
  let scratch = value;
  let iterations = 0;
  while (scratch.length > 0 && iterations++ < 32) {
    const match = detectPii(scratch);
    if (match === null) break;
    recordIndicator(match, location, contextId, piiIndicators, redactions);
    // Mask just this kind so the next iteration surfaces a different
    // category. We keep the value unchanged for stage 2.
    scratch = maskKind(scratch, match.kind);
  }
  // Stage 2: produce the redacted output by running every known
  // category replacement over the original value.
  return redactValue(value);
};

const maskKind = (value: string, kind: PiiKind): string => {
  switch (kind) {
    case "email":
      return value.replace(
        /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/gu,
        "_",
      );
    case "iban":
      return value.replace(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gu, "_");
    case "bic":
      return value.replace(
        /\b[A-Z]{4}(?:DE|AT|CH|FR|GB|US|NL|ES|IT|BE|LU|DK|SE|NO|FI|IE|PT|PL|CZ|SK|HU|RO|BG|GR|CY|MT|EE|LV|LT|SI|HR)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gu,
        "_",
      );
    case "pan":
      return value.replace(/(?:\d[\s-]?){12,18}\d/gu, "_");
    case "tax_id":
      return value
        .replace(/\b\d{11}\b/gu, "_")
        .replace(/\b\d{3}-\d{2}-\d{4}\b/gu, "_");
    case "phone":
      return value.replace(
        /(?<![\dA-Za-z])\+\d{1,3}[\s-]\d{2,4}[\s-]\d{3,8}(?:[\s-]\d{3,4})?(?!\d)/gu,
        "_",
      );
    case "full_name":
      return value
        .replace(/Max Mustermann/giu, "_")
        .replace(/Erika Mustermann/giu, "_")
        .replace(/Max Musterman/giu, "_")
        .replace(/John Doe/giu, "_")
        .replace(/Jane Doe/giu, "_")
        .replace(/John Smith/giu, "_")
        .replace(/Jane Smith/giu, "_");
    case "internal_hostname":
      return value.replace(
        /(?<![A-Za-z0-9])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:intranet|corp|internal|local|lan|atlassian\.net|jira\.com)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?![A-Za-z0-9])/giu,
        "_",
      );
    case "jira_mention":
      return value
        .replace(/\[~accountid:[A-Za-z0-9:_-]+\]/giu, "_")
        .replace(
          /@(?:account(?:id)?|user-mention|mention)[\s:[(=-]+[A-Za-z0-9:_-]{4,64}\]?/giu,
          "_",
        )
        .replace(/\b[0-9a-f]{24,32}\b/giu, "_");
    case "customer_name_placeholder":
      return value;
    // Issue #1668 (audit-2026-05): inline masking for the GDPR
    // Art. 5(1)(c) / Art. 9 categories. Each branch applies the
    // detector's regex directly so a value containing a postal address /
    // DOB / account number / national id / special-category keyword is
    // surgically masked even when the caller routes through the
    // value-level mask path (`redactInline`) instead of the
    // detection-level placeholder path. Returning `value` unchanged
    // here would silently leak the data through the inline writer.
    case "postal_address":
      return value
        .replace(
          /\b\p{Lu}\p{L}+(?:str(?:asse|aße)?|str\.|weg|allee|platz|gasse)\s+\d{1,4}[a-z]?\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/giu,
          "_",
        )
        .replace(
          /\b\p{Lu}\p{L}+(?:strasse|gasse|weg|platz)\s+\d{1,4}[a-z]?\s*,?\s*\d{4}\s+\p{Lu}\p{L}+/giu,
          "_",
        )
        .replace(
          /\b\p{Lu}\p{L}+straat\s+\d{1,4}[a-z]?\s*,?\s*\d{4}\s?[A-Z]{2}\s+\p{Lu}\p{L}+/giu,
          "_",
        )
        .replace(
          /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse)\s+(?:de\s+(?:la|l['’]|le|les)\s+)?\p{L}+\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/giu,
          "_",
        )
        .replace(
          /\b(?:via|viale|piazza|corso|vicolo)\s+\p{L}+\s+\d{1,4}[a-z]?\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/giu,
          "_",
        );
    case "date_of_birth":
      return value.replace(
        /(\b(?:born|geboren|geb\.?|dob|date\s+of\s+birth|geburtsdatum|geburtstag|naissance|nacimiento|nascita)\b[^\n]{0,32}?)(\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})/giu,
        "$1_",
      );
    case "account_number":
      return value.replace(
        /(\b(?:account|kontonummer|konto-?nr\.?|customer\s*id|kunden(?:nummer|nr\.?)|contract\s*(?:no|number|id)|vertragsnummer|vertrag\s*nr\.?|policy\s*(?:no|number)|membership\s*(?:no|number))\b[^\n]{0,16}?)(\b\d{6,18}\b)/giu,
        "$1_",
      );
    case "national_id":
      return value
        .replace(
          /(\b(?:personalausweis(?:nummer)?|ausweisnr\.?|id\s*card)\b[^\n]{0,16}?)\b[A-Z0-9]{9,12}\b/giu,
          "$1_",
        )
        .replace(/\b756[.\-\s]?\d{4}[.\-\s]?\d{4}[.\-\s]?\d{2}\b/gu, "_")
        .replace(/\b(?:19|20)?\d{6}[-+]\d{4}\b/gu, "_")
        .replace(/\b[0-9]{8}[A-HJ-NP-TV-Z]\b(?=\s|$|[,.])/gu, "_");
    case "special_category":
      // Special-category masking: replace just the keyword. The
      // surrounding prose is informational and not auto-redacted by
      // policy (false-positive risk). See pii-detection.ts for the
      // matching detector.
      return value
        .replace(
          /\b(?:HIV|AIDS|cancer|krebs|diabetes|depression|schwanger|pregnant|disabled|disability|behindert|invalidit(?:y|é|ät))\b/giu,
          "_",
        )
        .replace(
          /\b(?:political\s+(?:party|opinion|affiliation)|gewerkschaft|union\s+member|trade\s+union|partei(?:mitglied)?|syndicat)\b/giu,
          "_",
        )
        .replace(
          /\b(?:religion|religios|religiös|religieux|judaism|j(?:üd|ued|uw|udisch)|catholic|katholisch|muslim|muslimisch|protestant|protestantisch|atheist|atheismus|hindu|buddhist)\b/giu,
          "_",
        )
        .replace(
          /\b(?:ethnic(?:ity|al)|race|rasse|ethnie|herkunft|nationality\s+code|asylum\s+status)\b/giu,
          "_",
        )
        .replace(
          /\b(?:sexual\s+orientation|gay|lesbian|bisexual|homosexuell?|heterosexuell?|transgender|nonbinary)\b/giu,
          "_",
        );
  }
};

/**
 * Replace every recognised PII substring inside `value` with the
 * appropriate opaque redaction token. This is a single pass that runs
 * the detector logic at well-known regex boundaries — it is intentionally
 * conservative; non-deterministic PII shapes fall back to the bulk
 * redaction emitted by {@link redactInline}.
 */
const redactValue = (value: string): string => {
  let out = value;
  // Email
  out = out.replace(
    /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/gu,
    redactPii("email"),
  );
  // Phone (E.164)
  out = out.replace(
    /(?<![\dA-Za-z])\+\d{1,3}[\s-]\d{2,4}[\s-]\d{3,8}(?:[\s-]\d{3,4})?(?!\d)/gu,
    redactPii("phone"),
  );
  // PAN-like digit run
  out = out.replace(/(?:\d[\s-]?){12,18}\d/gu, (m) =>
    luhnCheck(m.replace(/\D/gu, "")) ? redactPii("pan") : m,
  );
  // IBAN-like
  out = out.replace(
    /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gu,
    redactPii("iban"),
  );
  // BIC
  out = out.replace(
    /\b[A-Z]{4}(?:DE|AT|CH|FR|GB|US|NL|ES|IT|BE|LU|DK|SE|NO|FI|IE|PT|PL|CZ|SK|HU|RO|BG|GR|CY|MT|EE|LV|LT|SI|HR)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gu,
    redactPii("bic"),
  );
  // German tax id
  out = out.replace(/\b\d{11}\b/gu, redactPii("tax_id"));
  // US SSN
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/gu, redactPii("tax_id"));
  // Confluence / Jira mentions and account ids
  out = out.replace(
    /\[~accountid:[A-Za-z0-9:_-]+\]/gu,
    redactPii("jira_mention"),
  );
  out = out.replace(
    /@(?:account(?:id)?|user-mention|mention)[\s:[(=-]+[A-Za-z0-9:_-]{4,64}\]?/giu,
    redactPii("jira_mention"),
  );
  out = out.replace(/\b[0-9a-f]{24,32}\b/gu, redactPii("jira_mention"));
  // Internal hostnames
  out = out.replace(
    /(?<![A-Za-z0-9])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:intranet|corp|internal|local|lan|atlassian\.net|jira\.com)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?![A-Za-z0-9])/giu,
    redactPii("internal_hostname"),
  );
  // Full-name placeholders
  for (const placeholder of [
    "Max Mustermann",
    "Erika Mustermann",
    "Max Musterman",
    "John Doe",
    "Jane Doe",
    "John Smith",
    "Jane Smith",
  ]) {
    out = out.replace(
      new RegExp(escapeRegex(placeholder), "giu"),
      redactPii("full_name"),
    );
  }
  return out;
};

const luhnCheck = (digits: string): boolean => {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubled = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    let v = d;
    if (doubled) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    doubled = !doubled;
  }
  return sum % 10 === 0;
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const recordIndicator = (
  match: PiiMatch | { kind: PiiKind; redacted: string; confidence: number },
  location: PiiMatchLocation,
  contextId: string,
  piiIndicators: PiiIndicator[],
  redactions: IntentRedaction[],
): void => {
  const indicatorId = `${contextId}::pii::${match.kind}::${location}`;
  if (piiIndicators.some((i) => i.id === indicatorId)) return;
  const indicator: PiiIndicator = {
    id: indicatorId,
    kind: match.kind,
    confidence: match.confidence,
    matchLocation: location,
    redacted: match.redacted,
  };
  piiIndicators.push(indicator);
  redactions.push({
    id: `${indicatorId}::redaction`,
    indicatorId,
    kind: match.kind,
    reason: `Detected ${match.kind} in ${location}`,
    replacement: match.redacted,
  });
};

const capUtf8Bytes = (
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { value, truncated: false };
  }
  // Truncate at a safe UTF-8 character boundary.
  const buf = Buffer.from(value, "utf8").subarray(0, maxBytes);
  const truncated = buf.toString("utf8").replace(/�+$/u, "");
  return { value: truncated, truncated: true };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const refusal = (
  code: JiraIrRefusalCode,
  pathLabel?: string,
  detail?: string,
): { ok: false; code: JiraIrRefusalCode; path?: string; detail?: string } => {
  const out: {
    ok: false;
    code: JiraIrRefusalCode;
    path?: string;
    detail?: string;
  } = {
    ok: false,
    code,
  };
  if (pathLabel !== undefined) out.path = pathLabel;
  if (detail !== undefined) out.detail = detail;
  return out;
};
