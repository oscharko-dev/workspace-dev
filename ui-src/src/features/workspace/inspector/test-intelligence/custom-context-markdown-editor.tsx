import { useMemo, type JSX } from "react";

export interface CustomContextMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function CustomContextMarkdownEditor({
  value,
  onChange,
}: CustomContextMarkdownEditorProps): JSX.Element {
  const bytes = useMemo(() => new TextEncoder().encode(value).length, [value]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
        <span>Markdown context</span>
        <span>{bytes} bytes</span>
      </div>
      <textarea
        data-testid="ti-multisource-custom-markdown"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        rows={8}
        placeholder="# Context\n\n- Risk notes\n- Environment constraints"
        className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
      />
      <div className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-white/45">Preview</div>
        <pre className="m-0 mt-2 whitespace-pre-wrap text-[11px] text-white/75">
          {value.length > 0 ? value : "Nothing to preview yet."}
        </pre>
      </div>
    </div>
  );
}
