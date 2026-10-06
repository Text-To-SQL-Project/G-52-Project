import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
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
        className="font-mono text-[10px] font-semibold uppercase"
        style={{
          padding: "2px 8px",
          border: "1px solid rgb(var(--success-soft-rgb) / 0.3)",
          background: "rgb(var(--success-soft-rgb) / 0.06)",
          color: "var(--success)",
          borderRadius: "8px",
        }}
      >
        correct
      </span>
    );
  }
  if (feedback === false) {
    return (
      <span
        title="Marked incorrect"
        className="font-mono text-[10px] font-semibold uppercase line-through"
        style={{
          padding: "2px 8px",
          border: "1px solid rgb(var(--danger-soft-rgb) / 0.3)",
          background: "rgb(var(--danger-soft-rgb) / 0.06)",
          color: "var(--danger)",
          borderRadius: "8px",
        }}
      >
        incorrect
      </span>
    );
  }
  return (
    <span title="Unrated" className="font-mono text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
      unrated
    </span>
  );
}

export function HistoryScreen() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHistory(getSessionId())
      .then((resp) => setItems(resp.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load history."));
  }, []);

  // Staggered entrance
  useEffect(() => {
    if (items && items.length > 0 && listRef.current) {
      gsap.fromTo(
        listRef.current.children,
        { opacity: 0, y: 15 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: "expo.out" }
      );
    }
  }, [items]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-10 sm:px-8 lg:px-10">
      {/* Header — open layout with oversized count */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div>
          <h2
            className="font-display font-bold tracking-tight text-[var(--text-primary)]"
            style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", letterSpacing: "-0.03em" }}
          >
            Query Execution History
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Log of natural language queries, generated SQL, and guardrail verdicts
          </p>
        </div>
        {items && items.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span
              className="font-display font-bold tabular-nums"
              style={{ fontSize: "2rem", color: "var(--accent)", letterSpacing: "-0.03em" }}
            >
              {items.length}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
              {items.length === 1 ? "query" : "queries"} logged
            </span>
          </div>
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
        <div className="py-14 text-center">
          <span className="material-symbols-outlined mb-3 text-[24px]" style={{ color: "var(--text-ghost)" }}>
            history
          </span>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            No query history yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Queries executed in the Workspace tab will automatically be captured here.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <div ref={listRef} className="space-y-0">
          {items.map((item) => (
            <div
              key={item.query_id}
              className="transition-colors duration-150"
              style={{
                borderBottom: "1px solid var(--border-subtle)",
                padding: "16px 0",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgb(var(--ink-rgb) / 0.01)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div className="flex items-start justify-between gap-4">
                <p className="font-sans text-sm font-medium leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {item.question}
                </p>
                <div className="shrink-0">
                  <StatusBanner status={item.status} />
                </div>
              </div>

              {item.sql_preview && (
                <div className="mt-2">
                  <code
                    className="sql-editor-card block truncate p-2.5 font-mono text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {item.sql_preview}
                  </code>
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
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
                  <span className="flex items-center gap-1" style={{ color: "var(--accent)" }}>
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
