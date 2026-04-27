import { useState, type JSX } from "react";

import { postCustomContextSource, postJiraPasteSource } from "./api";
import { CustomContextMarkdownEditor } from "./custom-context-markdown-editor";

export interface MultiSourceIngestionPanelProps {
  jobId: string;
  bearerToken: string;
  onIngested: () => Promise<void>;
}

export function MultiSourceIngestionPanel({
  jobId,
  bearerToken,
  onIngested,
}: MultiSourceIngestionPanelProps): JSX.Element {
  const [jiraPaste, setJiraPaste] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  return (
    <section
      data-testid="ti-multisource-ingestion"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">Multi-source ingestion</h2>
        <span className="text-[10px] uppercase tracking-wide text-white/45">
          bearer-gated
        </span>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-white/65">Jira paste</label>
          <textarea
            data-testid="ti-multisource-jira-paste"
            value={jiraPaste}
            onChange={(event) => {
              setJiraPaste(event.target.value);
            }}
            rows={8}
            className="w-full rounded border border-white/10 bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/50"
          />
          <button
            type="button"
            disabled={bearerToken.length === 0 || jiraPaste.trim().length === 0}
            onClick={() => {
              setStatus(null);
              void postJiraPasteSource({
                jobId,
                bearerToken,
                format: "auto",
                body: jiraPaste,
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.message);
                  return;
                }
                setJiraPaste("");
                setStatus("Jira paste attached.");
                await onIngested();
              });
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87]"
          >
            Attach Jira paste
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <CustomContextMarkdownEditor value={markdown} onChange={setMarkdown} />
          <button
            type="button"
            disabled={bearerToken.length === 0 || markdown.trim().length === 0}
            onClick={() => {
              setStatus(null);
              void postCustomContextSource({
                jobId,
                bearerToken,
                markdown,
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.message);
                  return;
                }
                setMarkdown("");
                setStatus("Custom context attached.");
                await onIngested();
              });
            }}
            className="cursor-pointer rounded border border-[#4eba87]/40 bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-[#4eba87]"
          >
            Attach custom context
          </button>
        </div>
      </div>
      <div className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2 text-[11px] text-white/65">
        Jira REST fetch is intentionally unavailable unless the workspace runtime exposes a configured Jira gateway. Jira paste remains the supported air-gapped path.
      </div>
      {status ? (
        <p
          data-testid="ti-multisource-ingestion-status"
          className="m-0 text-[11px] text-white/70"
        >
          {status}
        </p>
      ) : null}
    </section>
  );
}
