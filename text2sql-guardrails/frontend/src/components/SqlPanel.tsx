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

export function SqlPanel({ sql, explanation, tablesUsed, columnsUsed, onRerun, rerunning }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sql ?? "");

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

  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
          Generated SQL
        </h3>
        {onRerun && !editing && (
          <button
            onClick={startEditing}
            className="rounded-md px-2 py-1 text-xs font-semibold text-blue-300 transition hover:bg-blue-400/10 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            Edit &amp; re-run
          </button>
        )}
      </header>

      <div className="p-5">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              spellCheck={false}
              className="w-full resize-y rounded-xl border border-white/10 bg-[#020617]/70 p-4 font-mono text-[13px] leading-relaxed text-white focus:border-blue-400/50 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={runEdited}
                disabled={rerunning || !draft.trim()}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/25"
              >
                {rerunning ? "Running…" : "Run this SQL"}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={rerunning}
                className="rounded-lg border border-white/12 px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-white/35">
              Runs via <span className="font-mono text-white/50">sql_override</span> — still passes
              through guardrails, but skips generation.
            </p>
          </div>
        ) : (
          /* oneDark's own background is a warm grey that fights the navy
             surface, so it is overridden to a near-black slate here and the
             font is forced onto the app's mono stack. */
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#020617]/70">
            <SyntaxHighlighter
              language="sql"
              style={oneDark}
              customStyle={{
                margin: 0,
                background: "transparent",
                fontSize: "0.8125rem",
                lineHeight: 1.7,
                padding: "1rem 1.125rem",
              }}
              codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
              wrapLongLines
            >
              {sql}
            </SyntaxHighlighter>
          </div>
        )}

        {explanation && !editing && (
          <p className="mt-4 max-w-prose text-sm leading-relaxed text-white/65">{explanation}</p>
        )}

        {!editing && (tablesUsed.length > 0 || columnsUsed.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-4">
            {tablesUsed.map((t) => (
              <span
                key={t}
                title="Table"
                className="rounded-md border border-blue-400/25 bg-blue-400/10 px-2 py-1 font-mono text-[11px] text-blue-200"
              >
                {t}
              </span>
            ))}
            {columnsUsed.map((c) => (
              <span
                key={c}
                title="Column"
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-white/50"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
