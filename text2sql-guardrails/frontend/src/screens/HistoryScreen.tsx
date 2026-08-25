import { useEffect, useState } from "react";
import { ApiError, getHistory } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
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

function FeedbackIcon({ feedback }: { feedback?: boolean | null }) {
  if (feedback === true) return <span className="text-emerald-400" title="Marked correct">👍</span>;
  if (feedback === false) return <span className="text-red-400" title="Marked incorrect">👎</span>;
  return <span className="text-white/20" title="Unrated">—</span>;
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
    <div className="mx-auto max-w-4xl space-y-3 px-6 py-6">
      <h2 className="text-sm font-medium text-white/70">Query history</h2>

      {error && <ErrorPanel message={error} />}

      {!error && items === null && (
        <p className="py-8 text-center text-sm text-white/30">Loading…</p>
      )}

      {items && items.length === 0 && (
        <p className="py-8 text-center text-sm text-white/30">
          No queries yet — run something in the Workspace tab.
        </p>
      )}

      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.query_id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <p className="text-sm text-white/90">{item.question}</p>
                <StatusBanner status={item.status} />
              </div>
              <code className="block truncate rounded-md bg-black/30 px-2 py-1 text-xs text-white/50">
                {item.sql_preview}
              </code>
              <div className="mt-2 flex items-center gap-4 text-xs text-white/40">
                <span>{formatTimestamp(item.timestamp)}</span>
                {item.row_count != null && <span>{item.row_count} rows</span>}
                {item.confidence_score != null && (
                  <span>confidence {(item.confidence_score * 100).toFixed(0)}%</span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <FeedbackIcon feedback={item.user_feedback} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
