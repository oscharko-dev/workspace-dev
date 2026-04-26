/**
 * Atlassian Document Format (ADF) parser (Issue #1432, Wave 4.B).
 *
 * Hand-rolled, dependency-free, fail-closed parser that normalises a
 * Jira/Confluence ADF JSON document into a deterministic plain-text +
 * structural-block representation. The parser:
 *
 *   1. Enforces a hard {@link MAX_JIRA_ADF_INPUT_BYTES} cap on the raw
 *      JSON string BEFORE any traversal.
 *   2. Rejects unknown node types and mark types with a structured
 *      diagnostic — never logs, never throws, never persists partials.
 *   3. Strips `mention`, `inlineCard`, `media`, `mediaSingle`,
 *      `mediaGroup` to text-only stubs (`@user`, `[link]`,
 *      `[attachment:filename.ext]`) so raw URIs, account ids, avatar
 *      URLs, and media bytes never cross this boundary.
 *   4. Bounds traversal depth + node count to keep the parser robust
 *      against pathological inputs.
 *   5. Is byte-stable: parse(canonicalise(x)) is reproducible for any
 *      allow-listed input.
 *
 * The parser is pure — no IO, no fetch, no telemetry. It does not
 * perform PII redaction; redaction runs over the parser's plain-text
 * output in the Jira IR builder.
 */

import {
  ALLOWED_JIRA_ADF_MARK_TYPES,
  ALLOWED_JIRA_ADF_NODE_TYPES,
  MAX_JIRA_ADF_INPUT_BYTES,
  type JiraAdfMarkType,
  type JiraAdfNodeType,
  type JiraAdfRejectionCode,
} from "../contracts/index.js";

const NODE_TYPES: ReadonlySet<JiraAdfNodeType> = new Set(
  ALLOWED_JIRA_ADF_NODE_TYPES,
);
const MARK_TYPES: ReadonlySet<JiraAdfMarkType> = new Set(
  ALLOWED_JIRA_ADF_MARK_TYPES,
);

/** Hard depth limit for ADF traversal. */
const MAX_JIRA_ADF_DEPTH = 32;

/** Hard node-count limit for ADF traversal. */
const MAX_JIRA_ADF_NODE_COUNT = 5_000;

/** Filename allow-list pattern for ADF `media.attrs.alt` / filename stubs. */
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Discriminated structural-block kinds emitted by the parser. */
export type JiraAdfBlockKind =
  | "paragraph"
  | "heading"
  | "code_block"
  | "list_item"
  | "blockquote"
  | "panel"
  | "table_row"
  | "rule";

/** Structural block produced from the ADF document. */
export interface JiraAdfBlock {
  kind: JiraAdfBlockKind;
  /** Heading level (1-6) or list-item depth (1-based). Omitted otherwise. */
  level?: number;
  /** Code-block language hint, lower-cased. Omitted otherwise. */
  language?: string;
  /** Plain-text content of the block. */
  text: string;
}

/** Normalized form of an ADF document. */
export interface JiraAdfNormalizedDocument {
  /** Deterministic plain-text serialization. */
  plainText: string;
  /** Structural blocks for downstream acceptance-criterion extraction. */
  blocks: JiraAdfBlock[];
  /** Total ADF nodes traversed (root excluded). */
  nodeCount: number;
  /** Maximum nesting depth observed during traversal. */
  maxDepth: number;
}

/** Structured rejection diagnostic returned on failure. */
export interface JiraAdfRejection {
  code: JiraAdfRejectionCode;
  /** Optional JS-property-path locator into the input tree. */
  path?: string;
  /** Optional human-readable detail (no payload bytes). */
  detail?: string;
}

/** Discriminated parser result. */
export type JiraAdfParseResult =
  | { ok: true; document: JiraAdfNormalizedDocument }
  | { ok: false; rejection: JiraAdfRejection };

/**
 * Parse a raw ADF JSON document string into a normalized plain-text +
 * block representation. The byte cap is enforced before {@link JSON.parse}
 * to keep memory bounded.
 */
export const parseJiraAdfDocument = (input: unknown): JiraAdfParseResult => {
  if (typeof input !== "string") {
    return reject("jira_adf_input_not_string");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_JIRA_ADF_INPUT_BYTES) {
    return reject("jira_adf_payload_too_large");
  }

  let root: unknown;
  try {
    root = JSON.parse(input);
  } catch {
    return reject("jira_adf_input_not_json");
  }

  if (!isPlainObject(root)) {
    return reject("jira_adf_root_not_object");
  }
  const rootType = (root as { type?: unknown }).type;
  if (rootType !== "doc") {
    return reject(
      "jira_adf_root_type_invalid",
      "$",
      `root.type=${typeof rootType === "string" ? rootType.slice(0, 32) : "<missing>"}`,
    );
  }

  const ctx: TraversalCtx = {
    plainText: "",
    blocks: [],
    nodeCount: 0,
    maxDepth: 0,
    listDepth: 0,
  };
  const rejection = traverseDoc(root as JsonObject, ctx, "$");
  if (rejection !== null) {
    return { ok: false, rejection };
  }
  // Trim a single trailing newline so the plain-text serialization is
  // free of incidental whitespace differences but inner spacing remains
  // byte-stable across runs.
  const plainText = ctx.plainText.replace(/\n+$/u, "");
  return {
    ok: true,
    document: {
      plainText,
      blocks: ctx.blocks,
      nodeCount: ctx.nodeCount,
      maxDepth: ctx.maxDepth,
    },
  };
};

interface TraversalCtx {
  plainText: string;
  blocks: JiraAdfBlock[];
  nodeCount: number;
  maxDepth: number;
  listDepth: number;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

const traverseDoc = (
  doc: JsonObject,
  ctx: TraversalCtx,
  path: string,
): JiraAdfRejection | null => {
  const content = doc.content;
  if (!Array.isArray(content)) {
    return { code: "jira_adf_node_shape_invalid", path: `${path}.content` };
  }
  for (let i = 0; i < content.length; i++) {
    const child = content[i] as JsonValue;
    const childPath = `${path}.content[${i}]`;
    const rej = traverseBlockNode(child, ctx, childPath, 1);
    if (rej !== null) return rej;
  }
  return null;
};

const traverseBlockNode = (
  node: JsonValue,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  if (depth > MAX_JIRA_ADF_DEPTH) {
    return { code: "jira_adf_max_depth_exceeded", path };
  }
  if (++ctx.nodeCount > MAX_JIRA_ADF_NODE_COUNT) {
    return { code: "jira_adf_max_node_count_exceeded", path };
  }
  if (depth > ctx.maxDepth) ctx.maxDepth = depth;
  if (!isPlainObject(node)) {
    return { code: "jira_adf_node_shape_invalid", path };
  }
  const obj = node as JsonObject;
  const type = obj.type;
  if (typeof type !== "string" || !NODE_TYPES.has(type as JiraAdfNodeType)) {
    return {
      code: "jira_adf_unknown_node_type",
      path,
      detail: typeof type === "string" ? type.slice(0, 64) : "<missing>",
    };
  }

  switch (type as JiraAdfNodeType) {
    case "paragraph":
      return emitTextBlock(obj, ctx, path, depth, "paragraph");
    case "heading":
      return emitHeadingBlock(obj, ctx, path, depth);
    case "blockquote":
      return emitContainerAsBlock(obj, ctx, path, depth, "blockquote");
    case "panel":
      return emitContainerAsBlock(obj, ctx, path, depth, "panel");
    case "bulletList":
    case "orderedList":
      return emitListContainer(obj, ctx, path, depth);
    case "listItem":
      return emitListItem(obj, ctx, path, depth);
    case "codeBlock":
      return emitCodeBlock(obj, ctx, path);
    case "rule":
      ctx.blocks.push({ kind: "rule", text: "" });
      ctx.plainText += "---\n";
      return null;
    case "table":
      return emitContainer(obj, ctx, path, depth);
    case "tableRow":
      return emitTableRow(obj, ctx, path, depth);
    case "tableHeader":
    case "tableCell":
      return emitTableCell(obj, ctx, path, depth);
    case "mediaSingle":
    case "mediaGroup":
      return emitContainer(obj, ctx, path, depth);
    case "media":
      return emitMediaStub(obj, ctx);
    // Inline-only types should not appear at the block level — they are
    // walked from inside `collectInlineText`. Reject if we see them
    // standalone to avoid ambiguous ordering.
    case "text":
    case "hardBreak":
    case "mention":
    case "emoji":
    case "inlineCard":
    case "status":
    case "date":
      return {
        code: "jira_adf_node_shape_invalid",
        path,
        detail: `inline node ${type} at block level`,
      };
    case "doc":
      return {
        code: "jira_adf_node_shape_invalid",
        path,
        detail: "nested doc",
      };
    default: {
      // Exhaustiveness guard. NODE_TYPES check above already excludes
      // unknown values, but the switch covers the union explicitly.
      const exhaustive: never = type as never;
      return {
        code: "jira_adf_unknown_node_type",
        path,
        detail: String(exhaustive),
      };
    }
  }
};

const emitTextBlock = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
  kind: JiraAdfBlockKind,
): JiraAdfRejection | null => {
  const inline = collectInlineText(
    obj.content,
    ctx,
    `${path}.content`,
    depth + 1,
  );
  if ("rejection" in inline) return inline.rejection;
  ctx.blocks.push({ kind, text: inline.text });
  ctx.plainText += inline.text + "\n";
  return null;
};

const emitHeadingBlock = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
  const rawLevel = attrs.level;
  const level =
    typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 6
      ? Math.floor(rawLevel)
      : 1;
  const inline = collectInlineText(
    obj.content,
    ctx,
    `${path}.content`,
    depth + 1,
  );
  if ("rejection" in inline) return inline.rejection;
  ctx.blocks.push({ kind: "heading", level, text: inline.text });
  ctx.plainText += `${"#".repeat(level)} ${inline.text}\n`;
  return null;
};

const emitContainerAsBlock = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
  kind: JiraAdfBlockKind,
): JiraAdfRejection | null => {
  const before = ctx.plainText.length;
  const beforeBlocks = ctx.blocks.length;
  const rej = emitContainer(obj, ctx, path, depth);
  if (rej !== null) return rej;
  // Add a container summary block while preserving inner blocks for
  // downstream consumers that inspect nested structure.
  const innerText = ctx.plainText.slice(before).replace(/\n+$/u, "");
  ctx.blocks.splice(beforeBlocks, 0, {
    kind,
    text: innerText,
  });
  ctx.plainText = ctx.plainText.slice(0, before) + innerText + "\n";
  return null;
};

const emitListContainer = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  ctx.listDepth += 1;
  const rej = emitContainer(obj, ctx, path, depth);
  ctx.listDepth -= 1;
  return rej;
};

const emitListItem = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  if (!Array.isArray(obj.content)) {
    return { code: "jira_adf_node_shape_invalid", path: `${path}.content` };
  }
  const before = ctx.plainText.length;
  const beforeBlocks = ctx.blocks.length;
  for (let i = 0; i < obj.content.length; i++) {
    const child = obj.content[i] as JsonValue;
    const childPath = `${path}.content[${i}]`;
    const rej = traverseBlockNode(child, ctx, childPath, depth + 1);
    if (rej !== null) return rej;
  }
  const innerText = ctx.plainText.slice(before).replace(/\n+$/u, "");
  const indent = "  ".repeat(Math.max(0, ctx.listDepth - 1));
  ctx.blocks.splice(beforeBlocks, ctx.blocks.length - beforeBlocks, {
    kind: "list_item",
    level: ctx.listDepth,
    text: innerText,
  });
  ctx.plainText = ctx.plainText.slice(0, before) + `${indent}- ${innerText}\n`;
  return null;
};

const emitCodeBlock = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
): JiraAdfRejection | null => {
  const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
  const rawLanguage = attrs.language;
  const language =
    typeof rawLanguage === "string" &&
    /^[A-Za-z0-9+#._-]{1,32}$/.test(rawLanguage)
      ? rawLanguage.toLowerCase()
      : undefined;
  const content = obj.content;
  if (content !== undefined && !Array.isArray(content)) {
    return { code: "jira_adf_node_shape_invalid", path: `${path}.content` };
  }
  const text = collectCodeText(content, ctx, path);
  if (typeof text !== "string") return text;
  const block: JiraAdfBlock = { kind: "code_block", text };
  if (language !== undefined) block.language = language;
  ctx.blocks.push(block);
  ctx.plainText += "```";
  if (language !== undefined) ctx.plainText += language;
  ctx.plainText += `\n${text}\n\`\`\`\n`;
  return null;
};

const collectCodeText = (
  content: JsonValue[] | undefined,
  ctx: TraversalCtx,
  path: string,
): string | JiraAdfRejection => {
  if (content === undefined) return "";
  let out = "";
  for (let i = 0; i < content.length; i++) {
    if (++ctx.nodeCount > MAX_JIRA_ADF_NODE_COUNT) {
      return {
        code: "jira_adf_max_node_count_exceeded",
        path: `${path}.content[${i}]`,
      };
    }
    const child = content[i] as JsonValue;
    if (!isPlainObject(child)) {
      return {
        code: "jira_adf_node_shape_invalid",
        path: `${path}.content[${i}]`,
      };
    }
    const obj = child as JsonObject;
    if (obj.type !== "text") {
      return {
        code: "jira_adf_unknown_node_type",
        path: `${path}.content[${i}]`,
        detail:
          typeof obj.type === "string" ? obj.type.slice(0, 64) : "<missing>",
      };
    }
    if (typeof obj.text !== "string") {
      return {
        code: "jira_adf_text_node_invalid",
        path: `${path}.content[${i}].text`,
      };
    }
    out += obj.text;
  }
  return out;
};

const emitContainer = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  const content = obj.content;
  if (content === undefined) return null;
  if (!Array.isArray(content)) {
    return { code: "jira_adf_node_shape_invalid", path: `${path}.content` };
  }
  for (let i = 0; i < content.length; i++) {
    const child = content[i] as JsonValue;
    const childPath = `${path}.content[${i}]`;
    const rej = traverseBlockNode(child, ctx, childPath, depth + 1);
    if (rej !== null) return rej;
  }
  return null;
};

const emitTableRow = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  const before = ctx.plainText.length;
  const beforeBlocks = ctx.blocks.length;
  const rej = emitContainer(obj, ctx, path, depth);
  if (rej !== null) return rej;
  const innerText = ctx.plainText
    .slice(before)
    .replace(/\n+$/u, "")
    .replace(/\n/gu, " | ");
  ctx.blocks.splice(beforeBlocks, ctx.blocks.length - beforeBlocks, {
    kind: "table_row",
    text: innerText,
  });
  ctx.plainText = ctx.plainText.slice(0, before) + innerText + "\n";
  return null;
};

const emitTableCell = (
  obj: JsonObject,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): JiraAdfRejection | null => {
  return emitContainer(obj, ctx, path, depth);
};

const emitMediaStub = (
  obj: JsonObject,
  ctx: TraversalCtx,
): JiraAdfRejection | null => {
  const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
  const altRaw = attrs.alt;
  const alt =
    typeof altRaw === "string" && SAFE_FILENAME_RE.test(altRaw)
      ? altRaw
      : "redacted";
  const stub = `[attachment:${alt}]`;
  ctx.plainText += `${stub}\n`;
  return null;
};

interface InlineTextResult {
  text: string;
}
interface InlineTextRejection {
  rejection: JiraAdfRejection;
}

const collectInlineText = (
  contentValue: JsonValue | undefined,
  ctx: TraversalCtx,
  path: string,
  depth: number,
): InlineTextResult | InlineTextRejection => {
  if (contentValue === undefined) return { text: "" };
  if (!Array.isArray(contentValue)) {
    return {
      rejection: { code: "jira_adf_node_shape_invalid", path },
    };
  }
  if (depth > MAX_JIRA_ADF_DEPTH) {
    return {
      rejection: { code: "jira_adf_max_depth_exceeded", path },
    };
  }
  if (depth > ctx.maxDepth) ctx.maxDepth = depth;
  let text = "";
  for (let i = 0; i < contentValue.length; i++) {
    if (++ctx.nodeCount > MAX_JIRA_ADF_NODE_COUNT) {
      return {
        rejection: {
          code: "jira_adf_max_node_count_exceeded",
          path: `${path}[${i}]`,
        },
      };
    }
    const item = contentValue[i] as JsonValue;
    const itemPath = `${path}[${i}]`;
    if (!isPlainObject(item)) {
      return {
        rejection: { code: "jira_adf_node_shape_invalid", path: itemPath },
      };
    }
    const obj = item as JsonObject;
    const type = obj.type;
    if (typeof type !== "string" || !NODE_TYPES.has(type as JiraAdfNodeType)) {
      return {
        rejection: {
          code: "jira_adf_unknown_node_type",
          path: itemPath,
          detail: typeof type === "string" ? type.slice(0, 64) : "<missing>",
        },
      };
    }
    switch (type as JiraAdfNodeType) {
      case "text": {
        const t = obj.text;
        if (typeof t !== "string") {
          return {
            rejection: {
              code: "jira_adf_text_node_invalid",
              path: `${itemPath}.text`,
            },
          };
        }
        const marksRej = validateMarks(obj.marks, `${itemPath}.marks`);
        if (marksRej !== null) return { rejection: marksRej };
        text += t;
        break;
      }
      case "hardBreak":
        text += "\n";
        break;
      case "mention":
        text += "@user";
        break;
      case "emoji": {
        const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
        const shortName = attrs.shortName;
        const safe =
          typeof shortName === "string" &&
          /^:[A-Za-z0-9._+-]{1,32}:$/.test(shortName)
            ? shortName
            : ":emoji:";
        text += safe;
        break;
      }
      case "inlineCard":
        text += "[link]";
        break;
      case "status": {
        const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
        const status = attrs.text;
        const safe =
          typeof status === "string" && /^[A-Za-z0-9 _-]{1,40}$/.test(status)
            ? status
            : "status";
        text += `[${safe}]`;
        break;
      }
      case "date": {
        const attrs = isPlainObject(obj.attrs) ? (obj.attrs as JsonObject) : {};
        const ts = attrs.timestamp;
        const safe =
          typeof ts === "string" && /^[0-9]{4,15}$/.test(ts) ? ts : "date";
        text += `[date:${safe}]`;
        break;
      }
      default:
        return {
          rejection: {
            code: "jira_adf_node_shape_invalid",
            path: itemPath,
            detail: `block node ${type} inside inline content`,
          },
        };
    }
  }
  return { text };
};

const validateMarks = (
  marks: unknown,
  path: string,
): JiraAdfRejection | null => {
  if (marks === undefined) return null;
  if (!Array.isArray(marks)) {
    return { code: "jira_adf_node_shape_invalid", path };
  }
  for (let i = 0; i < marks.length; i++) {
    const mark: unknown = marks[i];
    if (!isPlainObject(mark)) {
      return { code: "jira_adf_node_shape_invalid", path: `${path}[${i}]` };
    }
    const type = (mark as { type?: unknown }).type;
    if (typeof type !== "string" || !MARK_TYPES.has(type as JiraAdfMarkType)) {
      return {
        code: "jira_adf_unknown_mark_type",
        path: `${path}[${i}]`,
        detail: typeof type === "string" ? type.slice(0, 64) : "<missing>",
      };
    }
  }
  return null;
};

const isPlainObject = (value: unknown): boolean => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const reject = (
  code: JiraAdfRejectionCode,
  path?: string,
  detail?: string,
): JiraAdfParseResult => {
  const rejection: JiraAdfRejection = { code };
  if (path !== undefined) rejection.path = path;
  if (detail !== undefined) rejection.detail = detail;
  return { ok: false, rejection };
};
