import { lazy, Suspense, useRef, useState } from "react";
import { motion } from "motion/react";
import { Award, Ban, BarChart3, Download, FileText, FileType, ImageDown, Info, SearchX, Sheet, Table2 } from "lucide-react";
import { toast } from "sonner";
import type { ResultTable, StudentProfile } from "../types/api";
import type { ChartShape } from "./ResultChart";
import { certificateDoc, chartImage, downloadPng, exportCsv, exportDocx, isResultQuery, printPdf, resultsDoc } from "../export";
import type { ChartImage } from "../export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ResultChart = lazy(() => import("./ResultChart"));

/** A label column plus up to three numeric columns, or null if it won't chart. */
function chartShape(r: ResultTable): ChartShape | null {
  if (r.rows.length < 2 || r.rows.length > 60) return null;
  const numeric = r.columns.map((_, j) => {
    const cells = r.rows.map((row) => row[j]).filter((v) => v !== null && v !== undefined);
    return cells.length > 0 && cells.every((v) => asNumber(v) !== null);
  });
  const label = numeric.findIndex((n) => !n);
  const values = numeric.flatMap((n, j) => (n ? [j] : [])).slice(0, 3);
  return label >= 0 && values.length ? { label, values } : null;
}
import { useTweened } from "../hooks/useTweened";
import { EASE, Panel } from "./kit";

/** Postgres NUMERIC arrives as text ("34.24"); treat it as a number. */
const asNumber = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && asNumber(value) !== null) return formatCell(asNumber(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  return String(value);
}

/** Per column: the largest absolute value if every non-null cell is a number, else null. */
function numericMax(results: ResultTable): (number | null)[] {
  return results.columns.map((_, j) => {
    let max = 0;
    let sawNumber = false;
    for (const row of results.rows) {
      const cell = row[j];
      if (cell === null || cell === undefined) continue;
      const n = asNumber(cell);
      if (n === null) return null;
      sawNumber = true;
      max = Math.max(max, Math.abs(n));
    }
    return sawNumber ? max : null;
  });
}

function Empty({ icon: Icon, title, body }: { icon: typeof Ban; title: string; body: string }) {
  return (
    <motion.div
      className="flex flex-col items-center px-6 py-14 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <motion.span
        aria-hidden
        className="mb-4 grid size-11 place-items-center rounded-xl border border-dashed border-border text-muted-foreground"
        initial={{ rotate: -12, scale: 0.8 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
      >
        <Icon className="size-5" />
      </motion.span>
      <p className="text-sm font-medium text-soft">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
    </motion.div>
  );
}

interface Props {
  results: ResultTable | null | undefined;
  executed: boolean;
  question?: string;
  queryId?: string;
  /** Set for a signed-in student: enables the result statement export. */
  student?: StudentProfile | null;
}

export function ResultsTable({ results, executed, question, queryId, student }: Props) {
  const max = results ? numericMax(results) : [];
  const rowCount = Math.round(useTweened(results?.row_count ?? 0, 700, 0));
  const shape = results ? chartShape(results) : null;
  const [view, setView] = useState<"table" | "chart">("table");
  const showChart = view === "chart" && shape !== null;
  const canCertify = !!student && !!results && isResultQuery(results.columns);
  const chartRef = useRef<HTMLDivElement>(null);

  /** Renders the on-screen chart to an image, then hands it to `use`. */
  const withChart = async (what: string, use: (img: ChartImage) => void) => {
    const svg = chartRef.current?.querySelector<SVGSVGElement>(".recharts-wrapper > svg.recharts-surface");
    if (!svg) return void toast.error("Chart isn't ready yet", { description: "Try again in a moment." });
    try {
      use(await chartImage(svg));
      if (what) exported(what);
    } catch {
      toast.error("Couldn't export the chart");
    }
  };

  const exported = (what: string) =>
    toast.success(`${what} ready`, { description: `${results!.rows.length.toLocaleString()} rows · ${results!.columns.length} columns` });

  return (
    <Panel
      icon={Table2}
      title="Query Results"
      bodyClassName="p-0"
      meta={
        executed && results ? (
          <>
            <span className="font-mono text-[11px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{rowCount.toLocaleString()}</span>{" "}
              {results.row_count === 1 ? "row" : "rows"}
            </span>
            {results.truncated && <Badge variant="warning">capped</Badge>}
            {shape && (
              <div role="group" aria-label="Result view" className="flex rounded-md border border-border p-0.5">
                {(["table", "chart"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`flex min-h-8 items-center gap-1 rounded px-2.5 py-1 font-mono text-[11px] capitalize transition-colors ${view === v ? "bg-[rgb(var(--brand-rgb)/0.12)] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {v === "table" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />} {v}
                  </button>
                ))}
              </div>
            )}
            {results.rows.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="xs" className="group font-mono">
                    <Download className="transition-transform duration-300 group-hover:translate-y-0.5" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Export results</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => { exportCsv(results); exported("CSV"); }}>
                    <Sheet /> CSV <span className="ml-auto text-[10px] text-muted-foreground">spreadsheet</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => printPdf(resultsDoc(results, question))}>
                    <FileText /> PDF <span className="ml-auto text-[10px] text-muted-foreground">print → save</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { exportDocx(resultsDoc(results, question)); exported("Word document"); }}>
                    <FileType /> Word (.docx)
                  </DropdownMenuItem>
                  {shape && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Export chart</DropdownMenuLabel>
                      {showChart ? (
                        <>
                          <DropdownMenuItem onSelect={() => withChart("Chart image", downloadPng)}>
                            <ImageDown /> PNG image
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => withChart("", (image) => printPdf({ ...resultsDoc(results, question), image }))}>
                            <FileText /> Chart + table as PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => withChart("Word document", (image) => exportDocx({ ...resultsDoc(results, question), image }))}>
                            <FileType /> Chart + table as Word
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem onSelect={() => setView("chart")}>
                          <BarChart3 /> Open the chart to export it
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {canCertify && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Result statement</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => printPdf(certificateDoc(results, student!, queryId ?? "—", question))}>
                        <Award /> Statement as PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => { exportDocx(certificateDoc(results, student!, queryId ?? "—", question)); exported("Result statement"); }}>
                        <Award /> Statement as Word
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        ) : undefined
      }
    >
      {!executed || !results ? (
        <Empty icon={Ban} title="Query not executed" body="No SQL was executed against the database." />
      ) : results.rows.length === 0 ? (
        <Empty icon={SearchX} title="No matching records" body="The query executed successfully and matched 0 rows." />
      ) : showChart ? (
        <div ref={chartRef}>
          <Suspense fallback={<div className="h-[22rem]" />}>
            <ResultChart results={results} shape={shape} />
          </Suspense>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto" data-lenis-prevent tabIndex={0} aria-label="Query results table">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-rgb)/0.92)] backdrop-blur-md">
              <tr>
                <th className="w-10 border-b border-border px-3 py-2.5 text-right font-mono text-[10px] font-medium text-muted-foreground">#</th>
                {results.columns.map((col, j) => (
                  <th
                    key={col}
                    className={`border-b border-border px-4 py-2.5 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase ${max[j] !== null ? "text-right" : ""}`}
                  >
                    {col.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row, i) => (
                <tr
                  key={i}
                  className="row-in group/row border-b border-[rgb(var(--ink-rgb)/0.045)] transition-colors duration-150 hover:bg-[rgb(var(--brand-rgb)/0.045)]"
                  style={{ animationDelay: `${Math.min(i, 30) * 22}ms` }}
                >
                  <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground transition-colors group-hover/row:text-brand">
                    {i + 1}
                  </td>
                  {row.map((cell, j) => {
                    const m = max[j];
                    const isNull = cell === null || cell === undefined;
                    const n = asNumber(cell);
                    const pct = m && n !== null ? (Math.abs(n) / m) * 100 : 0;
                    return (
                      <td
                        key={j}
                        className={`px-4 py-2.5 font-mono text-[13px] whitespace-nowrap ${m !== null ? "text-right tabular-nums" : ""} ${isNull ? "italic text-muted-foreground" : m !== null ? "text-foreground" : "text-foreground"}`}
                        style={
                          m !== null && !isNull
                            ? { backgroundImage: "linear-gradient(rgb(var(--brand-rgb) / 0.55), rgb(var(--brand-rgb) / 0.55))", backgroundSize: `${pct * 0.8}% 2px`, backgroundPosition: "right 1rem bottom 6px", backgroundRepeat: "no-repeat" }
                            : undefined
                        }
                      >
                        {formatCell(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {executed && results?.truncated && (
        <div className="flex items-center gap-2 border-t border-[color-mix(in_srgb,var(--warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--warning)_6%,transparent)] px-5 py-2.5 text-xs text-warning">
          <Info aria-hidden className="size-4" />
          <span>Output capped at {results.row_count} rows. Refine your query for more specific results.</span>
        </div>
      )}
    </Panel>
  );
}
