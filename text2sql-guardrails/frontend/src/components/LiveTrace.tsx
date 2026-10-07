import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Copy, Loader2, Terminal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EASE } from "./kit";

/** Pipeline order, as run_query times it (app/api/routes.py `lap`). */
export const STAGES = [
  { key: "generation", label: "Generating SQL", done: "Generated SQL" },
  { key: "guardrails", label: "Checking AST guardrails", done: "Guardrails passed" },
  { key: "pre_checks", label: "Aligning with the schema", done: "Schema aligned" },
  { key: "execution", label: "Executing read-only query", done: "Query executed" },
  { key: "post_checks", label: "Scoring confidence", done: "Confidence scored" },
  { key: "history", label: "Writing audit log", done: "Audit logged" },
] as const;

export type StageDone = { stage: string; ms: number };
export type LogLine = { level: string; src: string; msg: string; at: number; data?: Record<string, unknown> };

const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

function useElapsed(running: boolean) {
  const [start] = useState(() => performance.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(t);
  }, [running]);
  return now - start;
}

/** Live "thinking" line + the real stage checklist, driven by stream events. */
export function ThinkingPanel({ done, isAdmin }: { done: StageDone[]; isAdmin: boolean }) {
  const [g, setG] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setG((i) => (i + 1) % GLYPHS.length), 110);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = useElapsed(true);
  const doneKeys = new Set(done.map((d) => d.stage));
  const current = STAGES.find((s) => !doneKeys.has(s.key)) ?? STAGES[STAGES.length - 1];

  return (
    <motion.div
      className="flow-border overflow-hidden rounded-xl"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4 sm:px-6">
        <span aria-hidden className="w-4 text-center font-mono text-lg leading-none text-brand">{GLYPHS[g]}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={current.key}
            className="shimmer-text text-[15px] font-medium"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            {isAdmin && current.key === "execution" ? "Executing administrative operation (privileged mode)" : current.label}…
          </motion.span>
        </AnimatePresence>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">({fmt(elapsed)})</span>
      </div>

      <ol className="grid gap-x-6 gap-y-1.5 px-5 pt-3 pb-4 font-mono text-[12px] sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {STAGES.map((s, i) => {
          const d = done.find((x) => x.stage === s.key);
          const active = s.key === current.key && !d;
          return (
            <motion.li
              key={s.key}
              className={cn("flex items-center gap-2", d ? "text-soft" : active ? "text-foreground" : "text-muted-foreground")}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: d || active ? 1 : 0.55, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {d ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                    <Check className="size-3.5 text-success" strokeWidth={3} />
                  </motion.span>
                ) : active ? (
                  <Loader2 className="size-3.5 animate-spin text-brand" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span className="truncate">{d ? s.done : s.label}</span>
              {d && <span className="ml-auto tabular-nums text-muted-foreground">{fmt(d.ms)}</span>}
            </motion.li>
          );
        })}
      </ol>
      <div className="relative h-px overflow-hidden bg-border">
        <div className="animate-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent" />
      </div>
    </motion.div>
  );
}

const LEVEL_CLS: Record<string, string> = {
  ERROR: "text-[#ff8a95]",
  CRITICAL: "text-[#ff8a95]",
  WARNING: "text-[#f5b83d]",
  INFO: "text-[#2fd3a6]",
  DEBUG: "text-[#9aa0a8]",
};

/** Developer-only log console. The server decides who gets log events
 * (DEV_TRACE_KEY); this only renders what arrived. */
export function DevConsole({ lines, live }: { lines: LogLine[]; live: boolean }) {
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

  const copy = async () => {
    const text = lines.map((l) => `+${l.at}ms ${l.level} ${l.src}: ${l.msg}${l.data ? " " + JSON.stringify(l.data) : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Trace copied");
    } catch {
      toast.error("Couldn't copy the trace");
    }
  };

  return (
    <motion.section
      className="overflow-hidden rounded-xl border border-border bg-[#0b0d10] text-[#d6d8dc] shadow-[var(--shadow-lift)]"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      aria-label="Developer trace"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-[#9aa0a8] uppercase hover:text-white" aria-expanded={open}>
          <Terminal className="size-3.5 text-[#ff7a45]" />
          Developer trace
          <span className="rounded bg-white/10 px-1.5 py-px normal-case tracking-normal text-[#c7cbd1]">{lines.length} lines</span>
          {live && <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[#2fd3a6]"><span className="size-1.5 animate-pulse rounded-full bg-[#2fd3a6]" /> live</span>}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
        <button type="button" onClick={copy} className="press inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] text-[#9aa0a8] hover:bg-white/10 hover:text-white">
          <Copy className="size-3" /> copy
        </button>
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <div ref={body} data-lenis-prevent className="max-h-80 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
              {lines.length === 0 && <p className="text-[#9aa0a8]">waiting for the first event…</p>}
              {lines.map((l, i) => (
                <motion.div key={i} className="grid grid-cols-[4.5rem_3.6rem_1fr] gap-2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
                  <span className="text-right tabular-nums text-[#9aa0a8]">+{l.at}ms</span>
                  <span className={LEVEL_CLS[l.level] ?? "text-[#c7cbd1]"}>{l.level}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-[#ff9a6b]">{l.src}</span> {l.msg}
                    {l.data &&
                      Object.entries(l.data).map(([k, v]) => (
                        <span key={k} className="block pl-3 whitespace-pre-wrap text-[#9aa0a8]">
                          {k}: <span className="text-[#c7cbd1]">{typeof v === "string" ? v : JSON.stringify(v)}</span>
                        </span>
                      ))}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
