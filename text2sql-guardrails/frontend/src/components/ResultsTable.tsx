import type { ResultTable } from "../types/api";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // Format numbers nicely with commas if integer or 2 decimals
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  return String(value);
}

function numericColumns(results: ResultTable): boolean[] {
  return results.columns.map((_, j) => {
    let sawNumber = false;
    for (const row of results.rows) {
      const cell = row[j];
      if (cell === null || cell === undefined) continue;
      if (typeof cell !== "number") return false;
      sawNumber = true;
    }
    return sawNumber;
  });
}

interface Props {
  results: ResultTable | null | undefined;
  executed: boolean;
}

export function ResultsTable({ results, executed }: Props) {
  const numeric = results ? numericColumns(results) : [];

  const handleExportCsv = () => {
    if (!results || results.rows.length === 0) return;
    const header = results.columns.join(",");
    const rows = results.rows.map((row) =>
      row
        .map((val) => {
          if (val === null || val === undefined) return "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    );
    const csvContent = [header, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `query_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="glass-card animate-rise overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.02] px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-indigo-300">table_chart</span>
          <h3 className="font-display text-sm font-semibold tracking-tight text-white">
            Query Results
          </h3>
        </div>

        {executed && results && (
          <div className="flex items-center gap-3">
            <span className="pill-tag-indigo flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px]">
              <span className="font-semibold text-white">{results.row_count.toLocaleString()}</span>{" "}
              {results.row_count === 1 ? "row" : "rows"}
            </span>

            {results.truncated && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 uppercase">
                capped
              </span>
            )}

            {results.rows.length > 0 && (
              <button
                onClick={handleExportCsv}
                title="Export results as CSV"
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>Export CSV</span>
              </button>
            )}
          </div>
        )}
      </header>

      {!executed || !results ? (
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04]">
            <span className="material-symbols-outlined text-[20px] text-white/40">block</span>
          </div>
          <p className="font-display text-sm font-medium text-white/70">Query not executed</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-white/40">
            No SQL was executed against the database.
          </p>
        </div>
      ) : results.rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.04]">
            <span className="material-symbols-outlined text-[20px] text-white/40">search_off</span>
          </div>
          <p className="font-display text-sm font-medium text-white/70">No matching records</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-white/40">
            The query executed successfully and matched 0 rows.
          </p>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#0d1322]/95 backdrop-blur-md">
              <tr>
                {results.columns.map((col, j) => (
                  <th
                    key={col}
                    className={`border-b border-white/10 px-5 py-3 font-mono text-[11px] font-semibold tracking-wider whitespace-nowrap text-white/55 uppercase ${
                      numeric[j] ? "text-right" : ""
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-white/[0.04] transition-colors duration-150 hover:bg-white/[0.05] ${
                    i % 2 === 1 ? "bg-white/[0.015]" : ""
                  }`}
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-5 py-2.5 font-mono text-[13px] whitespace-nowrap ${
                        numeric[j] ? "text-right tabular-nums" : ""
                      } ${
                        cell === null || cell === undefined
                          ? "text-white/20 italic"
                          : numeric[j]
                          ? "text-[#5de6ff]"
                          : "text-white/85"
                      }`}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {executed && results?.truncated && (
        <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-950/20 px-6 py-2.5 text-xs text-amber-300">
          <span className="material-symbols-outlined text-[16px]">info</span>
          <span>
            Output capped at {results.row_count} rows. Refine your query for more specific results.
          </span>
        </div>
      )}
    </section>
  );
}
