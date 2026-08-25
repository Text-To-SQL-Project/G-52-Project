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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/70">Generated SQL</h3>
        {onRerun && !editing && (
          <button
            onClick={startEditing}
            className="text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            Edit &amp; re-run
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-white focus:border-blue-500/50 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={runEdited}
              disabled={rerunning || !draft.trim()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              {rerunning ? "Running…" : "Run this SQL"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={rerunning}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
          <p className="mt-1.5 text-xs text-white/30">
            Runs via sql_override — still passes through guardrails, but skips generation.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/10">
          <SyntaxHighlighter
            language="sql"
            style={oneDark}
            customStyle={{ margin: 0, fontSize: "0.8125rem", padding: "0.875rem" }}
            wrapLongLines
          >
            {sql}
          </SyntaxHighlighter>
        </div>
      )}

      {explanation && !editing && <p className="mt-3 text-sm text-white/60">{explanation}</p>}

      {!editing && (tablesUsed.length > 0 || columnsUsed.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tablesUsed.map((t) => (
            <span
              key={t}
              className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-mono text-blue-300"
            >
              {t}
            </span>
          ))}
          {columnsUsed.map((c) => (
            <span
              key={c}
              className="rounded-md bg-white/5 px-2 py-0.5 text-xs font-mono text-white/50"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
