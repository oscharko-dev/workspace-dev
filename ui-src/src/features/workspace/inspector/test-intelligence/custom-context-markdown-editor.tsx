import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type JSX,
} from "react";

import {
  canonicalizeCustomContextMarkdownPreview,
  isSafeCustomContextMarkdownUrl,
  MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES,
  MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES,
  REDACTED_LINK_HREF,
  validateCustomContextMarkdownPolicy,
  type MarkdownValidationState,
} from "./custom-context-markdown-editor-state";

export interface CustomContextMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidationChange?: (state: MarkdownValidationState) => void;
}

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "blockquote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "paragraph"; text: string };

const UNSAFE_MARKDOWN_OMITTED_TEXT = "[unsafe markdown omitted]";
const RAW_HTML_RE =
  /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?>|<!doctype\b|<!--|<\?xml\b/iu;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/u;
const MDX_RE =
  /^\s*(?:import|export)\s+|\{\s*[\w$.]+\s*\}|<[A-Z][A-Za-z0-9]*(?:\s|>|\/>)/mu;
const BARE_URL_RE = /(?:^|[\s(])((?:https?:\/\/)[^\s<>()\]]+)/giu;

export function CustomContextMarkdownEditor({
  value,
  onChange,
  onValidationChange,
}: CustomContextMarkdownEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bytes = useMemo(() => new TextEncoder().encode(value).length, [value]);
  const policyValidation = useMemo(
    () => validateCustomContextMarkdownPolicy(value),
    [value],
  );
  const canonicalPreview = useMemo(
    () =>
      value.trim().length === 0
        ? null
        : canonicalizeCustomContextMarkdownPreview(value),
    [value],
  );
  const canonicalBytes =
    canonicalPreview?.ok === true
      ? new TextEncoder().encode(canonicalPreview.value.bodyMarkdown).length
      : 0;
  const isValid = policyValidation.ok;
  const validationMessage = policyValidation.message;

  useEffect(() => {
    onValidationChange?.({
      bytes,
      withinBudget: isValid,
      message: validationMessage,
    });
  }, [bytes, isValid, onValidationChange, validationMessage]);

  const updateSelection = (transform: (text: string) => string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = transform(value.slice(start, end));
    const nextValue = value.slice(0, start) + next + value.slice(end);
    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + next.length);
    });
  };

  const insertAtLineStart = (prefix: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const selected = value.slice(lineStart, end);
    const lines = selected.split("\n");
    const next = lines
      .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
      .join("\n");
    const nextValue = value.slice(0, lineStart) + next + value.slice(end);
    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + next.length);
    });
  };

  const handleShortcut = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      updateSelection((text) => `**${text || "bold text"}**`);
      return;
    }
    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      updateSelection((text) => `*${text || "italic text"}*`);
      return;
    }
    if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      updateSelection((text) => `[${text || "link text"}](https://example.test)`);
      return;
    }
    if (event.key === "`") {
      event.preventDefault();
      updateSelection((text) => `\`${text || "code"}\``);
      return;
    }
    if (event.shiftKey && event.key === "8") {
      event.preventDefault();
      insertAtLineStart("- ");
      return;
    }
    if (event.shiftKey && event.key === "7") {
      event.preventDefault();
      insertAtLineStart("1. ");
      return;
    }
    if (event.shiftKey && event.key === "9") {
      event.preventDefault();
      insertAtLineStart("> ");
    }
  };

  return (
    <section
      data-testid="ti-multisource-custom-markdown-editor"
      aria-label="Custom context markdown editor"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#0f0f0f] p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
            Custom context markdown
          </h3>
          <p className="m-0 text-[10px] text-white/45">
            Ctrl/Cmd+B, I, K, `, Shift+8, Shift+7, and Shift+9 insert common
            markdown quickly.
          </p>
        </div>
        <div
          className={`rounded border px-2 py-1 text-[10px] ${
            isValid
              ? "border-emerald-500/20 bg-emerald-950/20 text-emerald-200"
              : "border-rose-500/20 bg-rose-950/20 text-rose-200"
          }`}
        >
          raw {bytes.toLocaleString("en-US")} /{" "}
          {MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES.toLocaleString("en-US")} bytes
          {canonicalPreview?.ok === true ? (
            <>
              {" "}
              · canonical {canonicalBytes.toLocaleString("en-US")} /{" "}
              {MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES.toLocaleString("en-US")}
            </>
          ) : null}
        </div>
      </header>

      {validationMessage ? (
        <p
          data-testid="ti-multisource-custom-markdown-error"
          className="m-0 rounded border border-rose-500/20 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-200"
        >
          {validationMessage}
        </p>
      ) : (
        <p className="m-0 text-[11px] text-white/50">
          Drafts autosave locally in this browser so work survives a refresh.
        </p>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="flex flex-col gap-2">
          <div
            role="toolbar"
            aria-label="Markdown formatting"
            className="flex flex-wrap gap-2"
          >
            <ToolbarButton
              label="Bold"
              onClick={() => {
                updateSelection((text) => `**${text || "bold text"}**`);
              }}
            />
            <ToolbarButton
              label="Italic"
              onClick={() => {
                updateSelection((text) => `*${text || "italic text"}*`);
              }}
            />
            <ToolbarButton
              label="Link"
              onClick={() => {
                updateSelection(
                  (text) => `[${text || "link text"}](https://example.test)`,
                );
              }}
            />
            <ToolbarButton
              label="Code"
              onClick={() => {
                updateSelection((text) => `\`${text || "code"}\``);
              }}
            />
            <ToolbarButton
              label="Bullet"
              onClick={() => {
                insertAtLineStart("- ");
              }}
            />
            <ToolbarButton
              label="Quote"
              onClick={() => {
                insertAtLineStart("> ");
              }}
            />
          </div>

          <label className="flex flex-col gap-1 text-[11px] text-white/65">
            Markdown draft
            <textarea
              data-testid="ti-multisource-custom-markdown"
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              onKeyDown={handleShortcut}
              rows={12}
              maxLength={MAX_CUSTOM_CONTEXT_RAW_MARKDOWN_BYTES * 4}
              placeholder="# Context\n\n- Risk notes\n- Environment constraints"
              aria-invalid={!isValid}
              className="min-h-56 w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
            />
          </label>
        </div>

        <PreviewPane markdown={value} />
      </div>
    </section>
  );
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
}

function ToolbarButton({ label, onClick }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded border border-white/10 bg-[#171717] px-2 py-1 text-[10px] font-medium text-white/70 transition hover:border-[#4eba87]/40 hover:text-[#4eba87]"
    >
      {label}
    </button>
  );
}

interface PreviewPaneProps {
  markdown: string;
}

function PreviewPane({ markdown }: PreviewPaneProps): JSX.Element {
  const validation = useMemo(
    () => validateCustomContextMarkdownPolicy(markdown),
    [markdown],
  );
  const canonicalPreview = useMemo(
    () =>
      markdown.trim().length === 0
        ? null
        : canonicalizeCustomContextMarkdownPreview(markdown),
    [markdown],
  );
  const blocks = useMemo(
    () =>
      canonicalPreview?.ok === true
        ? parseMarkdownBlocks(canonicalPreview.value.bodyMarkdown)
        : [],
    [canonicalPreview],
  );

  return (
    <aside
      aria-label="Markdown preview"
      className="flex flex-col gap-2 rounded border border-white/10 bg-[#171717] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/65">
          Preview
        </h4>
        <span className="text-[10px] text-white/45">sanitized</span>
      </div>
      {!validation.ok || canonicalPreview?.ok === false ? (
        <p
          data-testid="ti-multisource-custom-markdown-preview-refusal"
          className="m-0 rounded border border-rose-500/20 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-200"
        >
          {validation.message ??
            (canonicalPreview?.ok === false
              ? canonicalPreview.message
              : UNSAFE_MARKDOWN_OMITTED_TEXT)}
        </p>
      ) : blocks.length === 0 ? (
        <p className="m-0 text-[11px] text-white/45">
          Nothing to preview yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {blocks.map((block, index) => (
            <MarkdownBlockView key={`${block.kind}-${String(index)}`} block={block} />
          ))}
        </div>
      )}
    </aside>
  );
}

interface MarkdownBlockViewProps {
  block: MarkdownBlock;
}

function MarkdownBlockView({ block }: MarkdownBlockViewProps): JSX.Element {
  switch (block.kind) {
    case "heading":
      return (
        <div
          className={`font-semibold text-white ${
            block.level <= 2 ? "text-sm" : "text-[12px]"
          }`}
        >
          {renderInline(block.text)}
        </div>
      );
    case "blockquote":
      return (
        <blockquote className="m-0 border-l-2 border-[#4eba87]/40 pl-3 text-[11px] text-white/75">
          {renderInline(block.text)}
        </blockquote>
      );
    case "list":
      return (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11px] text-white/75">
          {block.items.map((item, index) => (
            <li key={`${item}-${String(index)}`} className="flex gap-2">
              <span className="shrink-0 font-mono text-white/45">
                {block.ordered ? `${String(index + 1)}.` : "-"}
              </span>
              <span className="min-w-0">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="m-0 overflow-x-auto rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/80">
          {block.text}
        </pre>
      );
    case "paragraph":
      return <p className="m-0 text-[11px] leading-relaxed text-white/75">{renderInline(block.text)}</p>;
  }
}

const INLINE_TOKEN_PATTERN =
  /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function renderInline(text: string): JSX.Element[] {
  const nodes: JSX.Element[] = [];
  let key = 0;
  for (const segment of text.split(INLINE_TOKEN_PATTERN)) {
    if (!segment) continue;
    const token = segment;
    if (token.startsWith("![") && token.includes("](")) {
      nodes.push(
        <span key={`${String(key++)}-image`} className="text-white/45">
          {UNSAFE_MARKDOWN_OMITTED_TEXT}
        </span>,
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      const [label, href] = parseBracketToken(token);
      const safeHref = sanitizeHref(href);
      nodes.push(
        safeHref ? (
          <a
            key={`${String(key++)}-link`}
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className="text-sky-200 underline decoration-sky-400/40 underline-offset-2"
          >
            {label}
          </a>
        ) : (
          <span key={`${String(key++)}-unsafe-link`} className="text-rose-200">
            {label}
          </span>
        ),
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${String(key++)}-code`}
          className="rounded border border-white/10 bg-black/25 px-1 py-[1px] font-mono text-[10px] text-white/85"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${String(key++)}-bold`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`${String(key++)}-italic`} className="italic text-white/90">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(
        <span key={`${String(key++)}-text`}>{redactBareUrls(token)}</span>,
      );
    }
  }
  return nodes;
}

function parseBracketToken(token: string): [string, string] {
  const start = token.indexOf("[") + 1;
  const middle = token.indexOf("](");
  const end = token.lastIndexOf(")");
  if (start < 1 || middle < 0 || end < 0 || end <= middle + 1) {
    return [token, ""];
  }
  const label = token.slice(start, middle);
  const href = token.slice(middle + 2, end);
  return [label, href];
}

function sanitizeHref(value: string): string {
  const trimmed = value.trim();
  if (trimmed === REDACTED_LINK_HREF) return REDACTED_LINK_HREF;
  return isSafeCustomContextMarkdownUrl(trimmed) ? REDACTED_LINK_HREF : "";
}

function redactBareUrls(value: string): string {
  return value.replace(BARE_URL_RE, (whole: string, href: string) =>
    whole.replace(href, REDACTED_LINK_HREF),
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let buffer: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let inCodeFence = false;

  const flushParagraph = () => {
    if (buffer.length === 0) return;
    blocks.push({ kind: "paragraph", text: buffer.join(" ") });
    buffer = [];
  };

  const flushList = () => {
    if (!list || list.items.length === 0) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("```")) {
      if (inCodeFence) {
        const codeText = buffer.join("\n");
        blocks.push(
          containsUnsupportedMarkdown(codeText)
            ? { kind: "paragraph", text: UNSAFE_MARKDOWN_OMITTED_TEXT }
            : { kind: "code", text: codeText },
        );
        buffer = [];
        inCodeFence = false;
      } else {
        flushParagraph();
        flushList();
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      buffer.push(line);
      continue;
    }

    if (containsUnsupportedMarkdown(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "paragraph", text: UNSAFE_MARKDOWN_OMITTED_TEXT });
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: headingMatch[1]!.length,
        text: headingMatch[2] ?? "",
      });
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "blockquote", text: quoteMatch[1] ?? "" });
      continue;
    }

    const bulletMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const ordered = orderedMatch !== null;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bulletMatch?.[1] ?? orderedMatch?.[1] ?? "").trim());
      continue;
    }

    flushList();
    buffer.push(trimmed);
  }

  if (inCodeFence) {
    const codeText = buffer.join("\n");
    blocks.push(
      containsUnsupportedMarkdown(codeText)
        ? { kind: "paragraph", text: UNSAFE_MARKDOWN_OMITTED_TEXT }
        : { kind: "code", text: codeText },
    );
  } else {
    flushParagraph();
  }
  flushList();
  return blocks;
}

function containsUnsupportedMarkdown(text: string): boolean {
  return RAW_HTML_RE.test(text) || IMAGE_RE.test(text) || MDX_RE.test(text);
}
