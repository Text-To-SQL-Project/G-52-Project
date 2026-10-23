import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Code2, Columns3, Copy, Lightbulb, Loader2, Pencil, Play, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EASE, Panel } from "./kit";

// SQL palette from the app's own tokens, so one style serves both themes.
const SQL_STYLE: Record<string, CSSProperties> = {
  'code[class*="language-"]': { color: "var(--foreground)" },
  'pre[class*="language-"]': { color: "var(--foreground)" },
  keyword: { color: "var(--brand)", fontWeight: 600 },
  function: { color: "var(--chart-5)", fontWeight: 500 },
  string: { color: "var(--success)" },
  number: { color: "var(--chart-3)" },
  boolean: { color: "var(--chart-3)" },
  operator: { color: "var(--soft)" },
  punctuation: { color: "var(--muted-foreground)" },
  comment: { color: "var(--muted-foreground)", fontStyle: "italic" },
};

// Light build + SQL only: the full Prism bundle ships every language (~500 KB).
SyntaxHighlighter.registerLanguage("sql", sql);

interface Props {
  sql?: string | null;
  explanation?: string | null;
  tablesUsed: string[];
  columnsUsed: string[];
  onRerun?: (editedSql: string) => void;
  rerunning?: boolean;
}

/** Types the query out in ~0.3 s whatever its length (24 frames of 12 ms);
 * whole text at once under reduced motion. */
function useTypewriter(text: string, speed = 12) {
  const [prevText, setPrevText] = useState(text);
  const [charCount, setCharCount] = useState(0);

  if (prevText !== text) {
    setPrevText(text);
    setCharCount(0);
  }

  useEffect(() => {
    if (!text) return;
    const step = Math.max(1, Math.ceil(text.length / 24));
    const interval = setInterval(() => {
      setCharCount((prev) => {
        if (prev >= text.length) {
          clearInterval(interval);
          return prev;
        }
        return Math.min(text.length, prev + step);
      });
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return { displayed: text, done: true };
  return { displayed: text.slice(0, charCount), done: charCount >= text.length };
}

export function SqlPanel({ sql, explanation, tablesUsed, columnsUsed, onRerun, rerunning }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sql ?? "");
  const [copied, setCopied] = useState(false);
  const [revealedSql, setRevealedSql] = useState<string | null>(null);

  const hasRevealed = Boolean(sql && revealedSql === sql);
  const { displayed: typewriterSql, done: typewriterDone } = useTypewriter(hasRevealed ? "" : (sql ?? ""));

  if (typewriterDone && sql && revealedSql !== sql) {
    setRevealedSql(sql);
  }

  if (!sql) return null;

  const displaySql = hasRevealed ? sql : typewriterSql;
  const lines = sql.split("\n").length;

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
      toast.success("SQL copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  return (
    <Panel
      icon={Code2}
      title="Generated SQL"
      bodyClassName="p-0"
      meta={
        <>
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
            {lines} {lines === 1 ? "line" : "lines"} · postgres
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="xs" onClick={handleCopy} aria-label="Copy SQL to clipboard" className="font-mono">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? "c" : "n"}
                    className="inline-flex"
                    initial={{ scale: 0.4, opacity: 0, rotate: -40 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                  >
                    {copied ? <Check className="text-success" /> : <Copy />}
                  </motion.span>
                </AnimatePresence>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy the exact query</TooltipContent>
          </Tooltip>
          {onRerun && !editing && (
            <Button variant="outline" size="xs" onClick={startEditing} className="group border-[rgb(var(--brand-rgb)/0.35)] text-brand hover:bg-[rgb(var(--brand-rgb)/0.08)] hover:text-brand">
              <Pencil className="transition-transform duration-300 group-hover:-rotate-12" /> Edit &amp; Re-run
            </Button>
          )}
        </>
      }
    >
      <div className="p-4 sm:p-5">
        <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                spellCheck={false}
                aria-label="Edit SQL"
                className="code-surface block w-full resize-y p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] focus:border-[rgb(var(--brand-rgb)/0.5)] focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1)]"
              />
              <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                <Button size="sm" variant="brand" onClick={runEdited} disabled={rerunning || !draft.trim()} data-magnetic="0.15">
                  {rerunning ? <><Loader2 className="animate-spin" /> Running…</> : <><Play /> Run this SQL</>}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={rerunning}>
                  <X /> Cancel
                </Button>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Runs via <span className="font-mono text-soft">sql_override</span> — skips LLM generation but still goes
                through the AST guardrail and the read-only, row-scoped role.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="view"
              className="code-surface relative overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <SyntaxHighlighter
                language="sql"
                style={SQL_STYLE}
                showLineNumbers
                lineNumberStyle={{ color: "var(--muted-foreground)", minWidth: "2.2em", paddingRight: "1em", userSelect: "none" }}
                customStyle={{ margin: 0, background: "transparent", fontSize: "0.84rem", lineHeight: 1.8, padding: "1rem 1.1rem", overflowX: "auto" }}
                tabIndex={0}
                aria-label="Generated SQL"
                // Plain CSS wrapping: the highlighter's wrapLongLines splits tokens
                // onto separate lines when combined with line numbers.
                codeTagProps={{ style: { fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" } }}
              >
                {displaySql}
              </SyntaxHighlighter>
              {!hasRevealed && !typewriterDone && <span className="typewriter-cursor absolute right-4 bottom-3" />}
            </motion.div>
          )}
        </AnimatePresence>

        {explanation && !editing && (
          <motion.div
            className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
          >
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-[rgb(var(--brand-rgb)/0.1)] text-brand">
              <Lightbulb className="size-3.5" />
            </span>
            <p className="max-w-prose text-sm leading-relaxed text-soft">{explanation}</p>
          </motion.div>
        )}

        {!editing && (tablesUsed.length > 0 || columnsUsed.length > 0) && (
          <motion.div
            className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-4"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: 0.3 } } }}
          >
            <span className="eyebrow mr-1 !text-[10px]">Entities</span>
            {tablesUsed.map((t) => (
              <motion.span
                key={t}
                title="Database table"
                variants={{ hidden: { opacity: 0, scale: 0.85 }, show: { opacity: 1, scale: 1 } }}
                className="inline-flex items-center gap-1 rounded-md border border-[rgb(var(--brand-rgb)/0.3)] bg-[rgb(var(--brand-rgb)/0.07)] px-2 py-0.5 font-mono text-[11px] text-brand"
              >
                <Table2 aria-hidden className="size-3" /> {t}
              </motion.span>
            ))}
            {columnsUsed.map((c) => (
              <motion.span
                key={c}
                title="Table column"
                variants={{ hidden: { opacity: 0, scale: 0.85 }, show: { opacity: 1, scale: 1 } }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-soft"
              >
                <Columns3 aria-hidden className="size-3" /> {c}
              </motion.span>
            ))}
          </motion.div>
        )}
      </div>
    </Panel>
  );
}
