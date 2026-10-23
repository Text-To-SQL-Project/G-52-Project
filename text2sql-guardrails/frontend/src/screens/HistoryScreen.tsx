import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Clock3, Gauge, History as HistoryIcon, Loader2, Rows3, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { ApiError, getHistory, getHistoryDetail } from "../api/client";
import { HistoryDetail } from "../components/HistoryDetail";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import { StatusBanner } from "../components/StatusBanner";
import { EASE, PageHeader } from "../components/kit";
import { getSessionId } from "../hooks/useSessionId";
import { useTweened } from "../hooks/useTweened";
import type { HistoryItem, QueryResponse, QueryStatus, StudentProfile } from "../types/api";
import { cn } from "@/lib/utils";

type Filter = "all" | "success" | "blocked" | "other";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "success", label: "Answered" },
  { key: "blocked", label: "Blocked" },
  { key: "other", label: "Other" },
];
const matches = (f: Filter, s: QueryStatus) =>
  f === "all" || (f === "success" ? s === "success" : f === "blocked" ? s === "blocked" : s !== "success" && s !== "blocked");

const NODE: Record<QueryStatus, string> = {
  success: "var(--success)",
  blocked: "var(--destructive)",
  refused: "var(--warning)",
  clarification: "var(--brand)",
  error: "var(--muted-foreground)",
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function Feedback({ feedback }: { feedback?: boolean | null }) {
  if (feedback === true)
    return <span title="Marked correct" className="inline-flex items-center gap-1 text-success"><ThumbsUp className="size-3" /> correct</span>;
  if (feedback === false)
    return <span title="Marked incorrect" className="inline-flex items-center gap-1 text-danger-text"><ThumbsDown className="size-3" /> incorrect</span>;
  return <span title="Unrated">unrated</span>;
}

function Count({ n }: { n: number }) {
  return <>{Math.round(useTweened(n, 900, 0))}</>;
}

export function HistoryScreen({ student, onBack }: { student?: StudentProfile | null; onBack?: () => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [detail, setDetail] = useState<QueryResponse | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // The open result is a browser-history entry above the list, so Back
  // (button, browser or gesture) returns to History; a reload reopens it.
  const openDetail = (id: string, push = true) => {
    setOpening(id);
    getHistoryDetail(id)
      .then((r) => {
        if (push) window.history.pushState({ ...window.history.state, detail: id, fromList: true }, "");
        setDetail(r);
        window.scrollTo({ top: 0 });
      })
      .catch((e) => toast.error("Couldn't open this result", { description: e instanceof ApiError ? e.message : undefined }))
      .finally(() => setOpening(null));
  };
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const closeDetail = () => {
    const state = window.history.state;
    if (state?.fromList) window.history.back(); // popstate below clears `detail`
    else { window.history.replaceState({ ...state, detail: undefined }, ""); setDetail(null); }
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => { if (!e.state?.detail) setDetail(null); };
    window.addEventListener("popstate", onPop);
    const reopen = window.history.state?.detail;
    if (reopen) openDetail(reopen, false);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on mount

  useEffect(() => {
    getHistory(getSessionId())
      .then((resp) => setItems(resp.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load history."));
  }, []);

  const groups = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const out: { day: string; items: HistoryItem[] }[] = [];
    for (const it of items) {
      if (!matches(filter, it.status)) continue;
      if (needle && !it.question.toLowerCase().includes(needle) && !(it.sql_preview ?? "").toLowerCase().includes(needle)) continue;
      const day = dayLabel(it.timestamp);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(it);
      else out.push({ day, items: [it] });
    }
    return out;
  }, [items, filter, q]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, success: 0, blocked: 0, other: 0 };
    for (const it of items ?? []) for (const f of FILTERS) if (matches(f.key, it.status)) c[f.key]++;
    return c;
  }, [items]);

  if (detail) {
    return (
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-8 lg:px-10 lg:pt-12">
        <HistoryDetail resp={detail} student={student} onBack={closeDetail} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-8 sm:px-8 lg:pt-12">
      <PageHeader
        onBack={onBack}
        index="§ 02"
        eyebrow="History"
        title={<>Query execution history<span className="mark-brand">.</span></>}
        lede="Every question you asked, the SQL it became, and what the guardrails decided. Open an answered query to re-check its full results."
        actions={
          items && items.length > 0 ? (
            <div className="text-right">
              <p className="font-display text-4xl leading-none tabular-nums text-foreground"><Count n={items.length} /></p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{items.length === 1 ? "query" : "queries"} logged</p>
            </div>
          ) : undefined
        }
      />

      {error && <ErrorPanel message={error} />}

      {!error && items === null && (
        <>
          <LoadingStatus label="Loading query history" />
          <SkeletonList count={5} lines={2} />
        </>
      )}

      {items && items.length === 0 && (
        <motion.div
          className="panel flex flex-col items-center px-6 py-16 text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <motion.span
            aria-hidden
            className="mb-4 grid size-12 place-items-center rounded-xl border border-dashed border-border text-muted-foreground"
            animate={{ rotate: [0, -8, 8, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.5 }}
          >
            <HistoryIcon className="size-5" />
          </motion.span>
          <p className="text-sm font-medium text-soft">No query history yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Queries executed in the Workspace tab will automatically be captured here.
          </p>
        </motion.div>
      )}

      {items && items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="radiogroup" aria-label="Filter by outcome" className="relative flex rounded-xl border border-border bg-card/70 p-1 backdrop-blur-sm">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="radio"
                  aria-checked={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn("press relative flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium", filter === f.key ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {filter === f.key && (
                    <motion.span layoutId="history-filter" className="absolute inset-0 rounded-lg border border-border bg-background shadow-sm" transition={{ type: "spring", stiffness: 450, damping: 36 }} />
                  )}
                  <span className="relative">{f.label}</span>
                  <span className="relative font-mono text-[10px] tabular-nums text-muted-foreground">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-64">
              <span className="sr-only">Search history</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search questions or SQL…"
                className="h-9 w-full rounded-xl border border-border bg-card/70 pr-3 pl-8 text-sm outline-none transition-[border-color,box-shadow] focus:border-[rgb(var(--brand-rgb)/0.5)] focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1)]"
              />
            </label>
          </div>

          <div className="space-y-8">
            <AnimatePresence mode="popLayout" initial={false}>
              {groups.map((g) => (
                <motion.section
                  key={g.day}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  <h3 className="eyebrow sticky top-[60px] z-10 -mx-2 mb-3 flex items-center gap-3 rounded-lg bg-[rgb(var(--void-rgb)/0.85)] px-2 py-1.5 backdrop-blur-md">
                    {g.day}
                    <span aria-hidden className="h-px flex-1 bg-border" />
                    <span className="tabular-nums">{g.items.length}</span>
                  </h3>
                  <ol className="relative space-y-2.5 pl-6">
                    <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-gradient-to-b from-border via-border to-transparent" />
                    <AnimatePresence initial={true}>
                      {g.items.map((item, i) => (
                        <motion.li
                          key={item.query_id}
                          layout
                          className="relative"
                          initial={{ opacity: 0, x: -10, filter: "blur(4px)" }}
                          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.5, ease: EASE, delay: Math.min(i, 12) * 0.035 }}
                        >
                          <span
                            aria-hidden
                            className="absolute top-5 -left-[22px] size-[9px] rounded-full ring-4 ring-background"
                            style={{ background: NODE[item.status] }}
                          />
                          <article className="panel spotlight lift p-4 sm:p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <p className="min-w-0 flex-1 text-[15px] leading-relaxed font-medium text-foreground">{item.question}</p>
                              <StatusBanner status={item.status} size="sm" />
                            </div>
                            {item.sql_preview && (
                              <code className="code-surface mt-3 block truncate px-3 py-2 font-mono text-xs text-soft">{item.sql_preview}</code>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><Clock3 aria-hidden className="size-3" />{timeOf(item.timestamp)}</span>
                              {item.row_count != null && (
                                <span className="inline-flex items-center gap-1"><Rows3 aria-hidden className="size-3" />{item.row_count} rows</span>
                              )}
                              {item.confidence_score != null && (
                                <span className="inline-flex items-center gap-1.5 text-brand">
                                  <Gauge aria-hidden className="size-3" />
                                  {(item.confidence_score * 100).toFixed(0)}% confidence
                                  <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                                    <span className="block h-full rounded-full bg-brand" style={{ width: `${item.confidence_score * 100}%` }} />
                                  </span>
                                </span>
                              )}
                              <span className="ml-auto"><Feedback feedback={item.user_feedback} /></span>
                            </div>
                            {item.has_detail && (
                              <button
                                type="button"
                                onClick={() => openDetail(item.query_id)}
                                disabled={opening !== null}
                                className="press mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-soft transition-colors hover:border-[rgb(var(--brand-rgb)/0.4)] hover:text-foreground disabled:opacity-60"
                              >
                                {opening === item.query_id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                                View full result
                                <ChevronRight className="size-3.5" />
                              </button>
                            )}
                          </article>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ol>
                </motion.section>
              ))}
            </AnimatePresence>
            {groups.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches this filter.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
