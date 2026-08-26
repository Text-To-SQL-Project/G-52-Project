import type { ResultTable } from "../types/api";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

interface Props {
  results: ResultTable | null | undefined;
  executed: boolean;
}

export function ResultsTable({ results, executed }: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/70">Results</h3>
        {executed && results && (
          <span className="text-xs text-white/40">
            {results.row_count} row{results.row_count === 1 ? "" : "s"}
            {results.truncated && " (truncated)"}
          </span>
        )}
      </div>

      {!executed || !results ? (
        <p className="py-6 text-center text-sm text-white/30">Query not executed.</p>
      ) : results.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/30">No rows returned.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.04]">
                {results.columns.map((col) => (
                  <th key={col} className="whitespace-nowrap px-3 py-2 font-medium text-white/60">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  {row.map((cell, j) => (
                    <td key={j} className="whitespace-nowrap px-3 py-2 font-mono text-xs text-white/80">
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
        <p className="mt-2 text-xs text-amber-400/80">
          More rows were available than the row cap allows. Refine the question or raise max_rows.
        </p>
      )}
    </div>
  );
}
