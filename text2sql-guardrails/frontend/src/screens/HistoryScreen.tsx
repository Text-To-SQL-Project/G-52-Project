import { useEffect, useState } from "react";
import { ApiError, getHistory } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import { StatusBanner } from "../components/StatusBanner";
import { getSessionId } from "../hooks/useSessionId";
import type { HistoryItem } from "../types/api";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function FeedbackChip({ feedback }: { feedback?: boolean | null }) {
  if (feedback === true) {
    return (
      <span
        title="Marked correct"
        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 uppercase"
      >
        correct
      </span>
    );
  }
  if (feedback === false) {
    return (
      <span
        title="Marked incorrect"
        className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300 uppercase line-through"
      >
        incorrect
      </span>
    );
  }
  return (
    <span title="Unrated" className="font-mono text-[10px] text-white/25 uppercase">
      unrated
    </span>
  );
}

export function HistoryScreen() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory(getSessionId())
      .then((resp) => setItems(resp.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load history."));
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 md:px-8">
      {/* Header Bar */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Query Execution History
          </h2>
          <p className="font-sans text-xs text-white/50">
            Log of natural language queries, generated SQL, and guardrail verdicts in this session
          </p>
        </div>
        {items && items.length > 0 && (
          <span className="pill-tag-indigo rounded-full px-3 py-1 font-mono text-xs">
            {items.length} {items.length === 1 ? "query" : "queries"} logged
          </span>
        )}
      </div>

      {error && <ErrorPanel message={error} />}

      {!error && items === null && (
        <>
          <LoadingStatus label="Loading query history" />
          <SkeletonList count={5} lines={2} />
        </>
      )}

      {items && items.length === 0 && (
        <div className="glass-card rounded-2xl py-14 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04]">
            <span className="material-symbols-outlined text-[20px] text-white/40">history</span>
          </div>
          <p className="font-display text-sm font-medium text-white/70">No query history yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-white/40">
            Queries executed in the Workspace tab will automatically be captured here.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={item.query_id}
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              className="glass-card animate-rise overflow-hidden rounded-2xl transition-all duration-200 hover:border-white/[0.18]"
            >
              <div className="flex items-start justify-between gap-4 px-6 pt-4 pb-3">
                <p className="font-sans text-sm font-medium leading-relaxed text-white/90">
                  {item.question}
                </p>
                <div className="shrink-0">
                  <StatusBanner status={item.status} />
                </div>
              </div>

              {item.sql_preview && (
                <div className="px-6 pb-2">
                  <code className="sql-editor-card block truncate rounded-xl p-3 font-mono text-xs text-indigo-200/80">
                    {item.sql_preview}
                  </code>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] bg-white/[0.01] px-6 py-2.5 font-mono text-xs text-white/45">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">schedule</span>
                  <span>{formatTimestamp(item.timestamp)}</span>
                </span>

                {item.row_count != null && (
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">table_rows</span>
                    <span>{item.row_count} rows</span>
                  </span>
                )}

                {item.confidence_score != null && (
                  <span className="flex items-center gap-1 text-cyan-300">
                    <span className="material-symbols-outlined text-[13px]">speed</span>
                    <span>{(item.confidence_score * 100).toFixed(0)}% confidence</span>
                  </span>
                )}

                <span className="ml-auto">
                  <FeedbackChip feedback={item.user_feedback} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
