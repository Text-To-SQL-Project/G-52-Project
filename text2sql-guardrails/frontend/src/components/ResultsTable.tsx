import type { ResultTable } from "../types/api";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
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
    <section className="animate-rise overflow-hidden" style={{ border: "1px solid var(--border-subtle)", borderRadius: "8px" }}>
      <header
        className="flex items-center justify-between gap-3 px-6 py-3.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgb(var(--ink-rgb) / 0.01)" }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>table_chart</span>
          <h3 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">
            Query Results
          </h3>
        </div>

        {executed && results && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: "var(--accent)" }}>
              <span className="font-semibold text-[var(--text-primary)]">{results.row_count.toLocaleString()}</span>{" "}
              {results.row_count === 1 ? "row" : "rows"}
            </span>

            {results.truncated && (
              <span
                className="font-mono text-[10px] font-semibold uppercase"
                style={{
                  padding: "2px 8px",
                  border: "1px solid rgb(var(--accent-bright-rgb) / 0.3)",
                  background: "rgb(var(--accent-bright-rgb) / 0.06)",
                  color: "var(--warning)",
                  borderRadius: "8px",
                }}
              >
                capped
              </span>
            )}

            {results.rows.length > 0 && (
              <button
                onClick={handleExportCsv}
                title="Export results as CSV"
                className="flex items-center gap-1 px-2.5 py-1 font-mono text-xs transition duration-200 focus-visible:outline-none"
                style={{
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  borderRadius: "8px",
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
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>Export CSV</span>
              </button>
            )}
          </div>
        )}
      </header>

      {!executed || !results ? (
        <div className="px-6 py-12 text-center">
          <span className="material-symbols-outlined mb-3 text-[20px]" style={{ color: "var(--text-ghost)" }}>block</span>
          <p className="font-display text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Query not executed</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            No SQL was executed against the database.
          </p>
        </div>
      ) : results.rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <span className="material-symbols-outlined mb-3 text-[20px]" style={{ color: "var(--text-ghost)" }}>search_off</span>
          <p className="font-display text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No matching records</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            The query executed successfully and matched 0 rows.
          </p>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10" style={{ background: "rgb(var(--void-rgb) / 0.95)", backdropFilter: "blur(8px)" }}>
              <tr>
                {results.columns.map((col, j) => (
                  <th
                    key={col}
                    className={`px-5 py-3 font-mono text-[11px] font-semibold tracking-wider whitespace-nowrap uppercase ${
                      numeric[j] ? "text-right" : ""
                    }`}
                    style={{
                      color: "var(--text-muted)",
                      borderBottom: "1px solid var(--border-hairline)",
                    }}
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
                  className="row-in transition-colors duration-150"
                  style={{
                    animationDelay: `${Math.min(i, 30) * 22}ms`,
                    borderBottom: "1px solid rgb(var(--ink-rgb) / 0.03)",
                    background: i % 2 === 1 ? "rgb(var(--ink-rgb) / 0.01)" : "transparent",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgb(var(--accent-rgb) / 0.025)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 1 ? "rgb(var(--ink-rgb) / 0.01)" : "transparent"; }}
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-5 py-2.5 font-mono text-[13px] whitespace-nowrap ${
                        numeric[j] ? "text-right tabular-nums" : ""
                      }`}
                      style={{
                        color:
                          cell === null || cell === undefined
                            ? "var(--text-muted)"
                            : numeric[j]
                            ? "var(--accent)"
                            : "var(--text-primary)",
                        fontStyle: cell === null || cell === undefined ? "italic" : "normal",
                      }}
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
        <div
          className="flex items-center gap-2 px-6 py-2.5 text-xs"
          style={{
            borderTop: "1px solid rgb(var(--accent-bright-rgb) / 0.15)",
            background: "rgb(var(--accent-bright-rgb) / 0.03)",
            color: "var(--warning)",
          }}
        >
          <span className="material-symbols-outlined text-[16px]">info</span>
          <span>
            Output capped at {results.row_count} rows. Refine your query for more specific results.
          </span>
        </div>
      )}
    </section>
  );
}
