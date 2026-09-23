import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  sql?: string | null;
  explanation?: string | null;
  tablesUsed: string[];
  columnsUsed: string[];
  onRerun?: (editedSql: string) => void;
  rerunning?: boolean;
}

export function SqlPanel({
  sql,
  explanation,
  tablesUsed,
  columnsUsed,
  onRerun,
  rerunning,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sql ?? "");
  const [copied, setCopied] = useState(false);

  if (!sql) return null;

  const startEditing = () => {
    setDraft(sql);
    setEditing(true);
  };

  const runEdited = () => {
    if (onRerun && draft.trim()) {
      onRerun(draft.trim());
      setEditing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editing ? draft : sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  };

  return (
    <section className="glass-card animate-rise overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.02] px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-indigo-300">code</span>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-white/70">
            Generated SQL
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Copy SQL to clipboard"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none"
          >
            <span className="material-symbols-outlined text-[15px]">
              {copied ? "check" : "content_copy"}
            </span>
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>

          {onRerun && !editing && (
            <button
              onClick={startEditing}
              className="flex items-center gap-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 font-sans text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
              <span>Edit &amp; Re-run</span>
            </button>
          )}
        </div>
      </header>

      <div className="p-6">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              spellCheck={false}
              className="sql-editor-card w-full resize-y rounded-xl p-4 font-mono text-[13px] leading-relaxed text-[#dde2f8] focus:border-indigo-400/50 focus:outline-none focus:ring-1 focus:ring-indigo-400/30"
            />
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={runEdited}
                disabled={rerunning || !draft.trim()}
                className="glow-button flex items-center gap-2 rounded-lg px-4 py-2 font-sans text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {rerunning ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    <span>Running…</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                    <span>Run this SQL</span>
                  </>
                )}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={rerunning}
                className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 font-sans text-xs font-semibold text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-white/40">
              Runs via <span className="font-mono text-white/60">sql_override</span> — bypasses
              LLM generation but strictly runs through AST security and read-only guardrails.
            </p>
          </div>
        ) : (
          <div className="sql-editor-card overflow-hidden rounded-xl">
            <SyntaxHighlighter
              language="sql"
              style={oneDark}
              customStyle={{
                margin: 0,
                background: "transparent",
                fontSize: "0.85rem",
                lineHeight: 1.75,
                padding: "1.125rem 1.25rem",
              }}
              codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
              wrapLongLines
            >
              {sql}
            </SyntaxHighlighter>
          </div>
        )}

        {explanation && !editing && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <span className="material-symbols-outlined mt-0.5 text-[18px] text-indigo-300">
              lightbulb
            </span>
            <p className="max-w-prose text-sm leading-relaxed text-white/75">{explanation}</p>
          </div>
        )}

        {!editing && (tablesUsed.length > 0 || columnsUsed.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-4">
            <span className="font-mono text-[11px] text-white/40">Entities:</span>
            {tablesUsed.map((t) => (
              <span
                key={t}
                title="Database Table"
                className="pill-tag flex items-center gap-1 rounded-md px-2.5 py-1 font-mono text-[11px]"
              >
                <span className="material-symbols-outlined text-[13px]">table_rows</span>
                {t}
              </span>
            ))}
            {columnsUsed.map((c) => (
              <span
                key={c}
                title="Table Column"
                className="pill-tag-indigo flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px]"
              >
                <span className="material-symbols-outlined text-[12px]">view_column</span>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
