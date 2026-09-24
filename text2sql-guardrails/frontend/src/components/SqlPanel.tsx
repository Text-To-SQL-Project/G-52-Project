import { useState, useEffect, useRef } from "react";
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

/** Typewriter hook — reveals text character by character */
function useTypewriter(text: string, speed = 12) {
  const [prevText, setPrevText] = useState(text);
  const [charCount, setCharCount] = useState(0);

  if (prevText !== text) {
    setPrevText(text);
    setCharCount(0);
  }

  useEffect(() => {
    if (!text) return;
    const interval = setInterval(() => {
      setCharCount((prev) => {
        if (prev >= text.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  const displayed = text.slice(0, charCount);
  const done = charCount >= text.length;
  return { displayed, done };
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
  const [revealedSql, setRevealedSql] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const hasRevealed = Boolean(sql && revealedSql === sql);

  const { displayed: typewriterSql, done: typewriterDone } = useTypewriter(
    hasRevealed ? "" : (sql ?? ""),
    12
  );

  if (typewriterDone && sql && revealedSql !== sql) {
    setRevealedSql(sql);
  }

  if (!sql) return null;

  const displaySql = hasRevealed ? sql : typewriterSql;

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
    <section ref={panelRef} className="animate-rise overflow-hidden" style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>
      <header
        className="flex items-center justify-between gap-3 px-6 py-3.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.01)" }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>code</span>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Generated SQL
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Copy SQL to clipboard"
            className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-xs transition duration-200 focus-visible:outline-none"
            style={{
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--text-secondary)",
              borderRadius: "2px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-accent)";
              e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <span className="material-symbols-outlined text-[15px]">
              {copied ? "check" : "content_copy"}
            </span>
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>

          {onRerun && !editing && (
            <button
              onClick={startEditing}
              className="flex items-center gap-1 px-3 py-1 font-sans text-xs font-medium transition duration-200 focus-visible:outline-none"
              style={{
                border: "1px solid var(--border-accent)",
                background: "var(--accent-dim)",
                color: "var(--accent)",
                borderRadius: "2px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(34, 211, 238, 0.15)";
                e.currentTarget.style.color = "var(--accent-bright)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--accent-dim)";
                e.currentTarget.style.color = "var(--accent)";
              }}
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
              className="sql-editor-card w-full resize-y p-4 font-mono text-[13px] leading-relaxed focus:outline-none"
              style={{ color: "var(--text-primary)" }}
            />
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={runEdited}
                disabled={rerunning || !draft.trim()}
                className="glow-button flex items-center gap-2 px-4 py-2 font-sans text-xs font-semibold transition"
                style={{ borderRadius: "2px" }}
              >
                {rerunning ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
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
                className="px-4 py-2 font-sans text-xs font-semibold transition focus-visible:outline-none"
                style={{
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  borderRadius: "2px",
                }}
              >
                Cancel
              </button>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Runs via <span className="font-mono" style={{ color: "var(--text-secondary)" }}>sql_override</span> — bypasses
              LLM generation but strictly runs through AST security and read-only guardrails.
            </p>
          </div>
        ) : (
          <div className="sql-editor-card overflow-hidden">
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
              {displaySql}
            </SyntaxHighlighter>
            {!hasRevealed && !typewriterDone && (
              <span className="typewriter-cursor" />
            )}
          </div>
        )}

        {explanation && !editing && (
          <div
            className="mt-4 flex items-start gap-2.5 p-3.5"
            style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "2px",
              background: "rgba(255,255,255,0.01)",
            }}
          >
            <span className="material-symbols-outlined mt-0.5 text-[18px]" style={{ color: "var(--accent)" }}>
              lightbulb
            </span>
            <p className="max-w-prose text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {explanation}
            </p>
          </div>
        )}

        {!editing && (tablesUsed.length > 0 || columnsUsed.length > 0) && (
          <div
            className="mt-4 flex flex-wrap items-center gap-2 pt-4"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>Entities:</span>
            {tablesUsed.map((t) => (
              <span
                key={t}
                title="Database Table"
                className="pill-tag flex items-center gap-1 px-2.5 py-1 font-mono text-[11px]"
              >
                <span className="material-symbols-outlined text-[13px]">table_rows</span>
                {t}
              </span>
            ))}
            {columnsUsed.map((c) => (
              <span
                key={c}
                title="Table Column"
                className="pill-tag flex items-center gap-1 px-2 py-0.5 font-mono text-[11px]"
                style={{ opacity: 0.7 }}
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
