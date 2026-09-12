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

/** Feedback was a green thumbs-up and a red thumbs-down emoji. Both had to go:
 * green is reserved for SUCCESS and PASS, red for a guardrail decision, and the
 * style guidance rules out emoji standing in for icons at all (they render as
 * a different glyph, or as colour, on every platform). A word in a neutral chip
 * says the same thing and collides with nothing. */
function FeedbackChip({ feedback }: { feedback?: boolean | null }) {
  if (feedback === true) {
    return (
      <span
        title="Marked correct"
        className="rounded border border-white/15 bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/70"
      >
        correct
      </span>
    );
  }
  if (feedback === false) {
    return (
      <span
        title="Marked incorrect"
        className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/40 line-through decoration-white/40"
      >
        incorrect
      </span>
    );
  }
  return (
    <span title="Unrated" className="text-[10px] uppercase tracking-[0.06em] text-white/20">
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
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
          Query history
        </h2>
        {items && items.length > 0 && (
          <span className="text-xs tabular-nums text-white/35">
            {items.length} quer{items.length === 1 ? "y" : "ies"}
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
        <p className="animate-fade rounded-2xl border border-white/[0.07] bg-[#0f1728]/70 py-12 text-center text-sm text-white/35">
          No queries yet — run something in the Workspace tab.
        </p>
      )}

      {items && items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((item, i) => (
            /* Row highlighting on hover is the Data-Dense Dashboard pattern:
               in a long list it ties the question, its SQL and its metadata
               together as one record under the pointer. */
            <div
              key={item.query_id}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              className="animate-rise overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 transition-colors duration-200 hover:border-white/[0.16] hover:bg-[#16203a]/92"
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4">
                <p className="min-w-0 text-sm leading-relaxed text-white/90">{item.question}</p>
                <div className="shrink-0">
                  <StatusBanner status={item.status} />
                </div>
              </div>

              <div className="px-5">
                <code className="block truncate rounded-lg border border-white/[0.06] bg-[#020617]/60 px-3 py-2 font-mono text-xs text-white/50">
                  {item.sql_preview}
                </code>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] px-5 py-2.5 text-xs text-white/40">
                <span className="tabular-nums">{formatTimestamp(item.timestamp)}</span>
                {item.row_count != null && (
                  <span className="tabular-nums">{item.row_count} rows</span>
                )}
                {item.confidence_score != null && (
                  <span className="tabular-nums">
                    confidence {(item.confidence_score * 100).toFixed(0)}%
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
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
