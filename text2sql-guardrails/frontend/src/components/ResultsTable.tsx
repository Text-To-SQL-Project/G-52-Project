import type { ResultTable } from "../types/api";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Which columns hold numbers, so they can be right-aligned with tabular
 * figures -- digits then line up by place value and a column of counts becomes
 * scannable instead of ragged. Derived from the rows already in the payload;
 * no extra field is requested from the API for this. A column of all-NULLs has
 * nothing to align, so it stays left. */
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

  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
          Results
        </h3>
        {executed && results && (
          <span className="flex items-center gap-2 text-xs text-white/40">
            <span className="tabular-nums">
              <span className="font-semibold text-white/70">{results.row_count}</span> row
              {results.row_count === 1 ? "" : "s"}
            </span>
            {results.truncated && (
              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-300">
                truncated
              </span>
            )}
          </span>
        )}
      </header>

      {!executed || !results ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-white/65">Query not executed</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-white/40">
            No SQL was run for this question.
          </p>
        </div>
      ) : results.rows.length === 0 ? (
        /* A successful query that matched nothing.
         *
         * THIS WORDING MUST NOT DEPEND ON WHY THE SET IS EMPTY, and the
         * component is deliberately given no way to find out. A result can
         * be empty because no such record exists, or because a row policy
         * filtered every candidate away, and the two must be indistinguishable
         * here. Saying anything like "some rows may be hidden" would confirm
         * to the asker that rows they cannot see DO exist, which is exactly
         * the inference Row Level Security is there to prevent -- a leak
         * delivered by a helpful empty state.
         *
         * It is stated positively ("ran successfully") because the previous
         * faint "No rows returned." was easy to read as a panel that had
         * failed to render, which is its own kind of wrong answer. */
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-white/65">No matching records</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-white/40">
            The query ran successfully and matched no rows.
          </p>
        </div>
      ) : (
        <div className="max-h-[30rem] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {results.columns.map((col, j) => (
                  <th
                    key={col}
                    className={`border-b border-white/10 bg-[#141c30] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] whitespace-nowrap text-white/50 ${
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
                  className="border-b border-white/[0.05] transition-colors last:border-0 hover:bg-white/[0.04]"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-2 font-mono text-[12.5px] whitespace-nowrap ${
                        numeric[j] ? "text-right tabular-nums" : ""
                      } ${cell === null || cell === undefined ? "text-white/25" : "text-white/85"}`}
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
        <p className="border-t border-white/[0.06] px-5 py-3 text-xs leading-relaxed text-amber-300/75">
          More rows were available than the row cap allows. Refine the question or raise{" "}
          <span className="font-mono">max_rows</span>.
        </p>
      )}
    </section>
  );
}
