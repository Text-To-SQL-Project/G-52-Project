import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Database, KeyRound, LayoutList, Link2, Search, Table2, Waypoints } from "lucide-react";

// React Flow + dagre (~60 KB gzip): only downloaded when the graph is opened.
const SchemaGraph = lazy(() => import("../components/SchemaGraph").then((m) => ({ default: m.SchemaGraph })));
import { ApiError, getSchema } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import { EASE, PageHeader } from "../components/kit";
import type { SchemaResponse, TableInfo } from "../types/api";
import { cn } from "@/lib/utils";

function TableRow({ table, index }: { table: TableInfo; index: number }) {
  const [open, setOpen] = useState(false);
  const keys = table.columns.filter((c) => c.is_primary_key || c.is_foreign_key).length;

  return (
    <motion.div
      layout
      className={cn("panel spotlight overflow-hidden transition-colors", open && "border-[rgb(var(--brand-rgb)/0.3)]")}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: Math.min(index, 14) * 0.025 }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left outline-none sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border transition-colors duration-300", open ? "border-[rgb(var(--brand-rgb)/0.4)] bg-brand text-brand-foreground" : "border-border bg-muted text-brand")}>
            <Table2 aria-hidden className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-sm font-semibold text-foreground">{table.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {table.columns.length} columns{keys ? ` · ${keys} keys` : ""}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 text-muted-foreground transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:text-foreground", open && "rotate-180 text-brand")}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="cols"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {["Column", "Type", "Key", "Sample values"].map((h) => (
                      <th key={h} className="border-b border-border px-4 py-2.5 font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.columns.map((col, i) => (
                    <motion.tr
                      key={col.name}
                      className="border-b border-[rgb(var(--ink-rgb)/0.04)] transition-colors last:border-0 hover:bg-hover"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, ease: EASE, delay: 0.05 + i * 0.02 }}
                    >
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap text-foreground">
                        {col.name}
                        {!col.nullable && <span className="ml-1.5 text-danger-text" title="NOT NULL">*</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap text-brand">{col.data_type}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex flex-wrap gap-1.5">
                          {col.is_primary_key && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[rgb(var(--brand-rgb)/0.3)] bg-[rgb(var(--brand-rgb)/0.08)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand">
                              <KeyRound aria-hidden className="size-3" /> PK
                            </span>
                          )}
                          {col.is_foreign_key && (
                            <span title={col.references ?? undefined} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-soft">
                              <Link2 aria-hidden className="size-3" /> FK → {col.references}
                            </span>
                          )}
                          {!col.is_primary_key && !col.is_foreign_key && <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                      <td className="max-w-md truncate px-4 py-2.5 font-mono text-soft">
                        {col.sample_values.length > 0 ? col.sample_values.join(", ") : "—"}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function SchemaScreen({ onBack }: { onBack?: () => void }) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"graph" | "list">("graph");

  useEffect(() => {
    getSchema()
      .then(setSchema)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load schema."));
  }, []);

  const filteredTables = useMemo(() => {
    if (!schema) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return schema.tables;
    return schema.tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)));
  }, [schema, filter]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pt-8 sm:px-8 lg:px-10 lg:pt-12">
      <PageHeader
        onBack={onBack}
        index="§ 03"
        eyebrow="Schema Explorer"
        title={<>The college, as tables<span className="mark-brand">.</span></>}
        lede="Browse tables, columns, constraints and relationships. Hover a table in the graph to trace its joins."
        actions={
          schema ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/70 px-2.5 py-1 font-mono text-xs text-soft">
                <Database aria-hidden className="size-3.5 text-brand" /> {schema.database}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {schema.total_tables} tables · {schema.total_columns} columns
              </span>
            </>
          ) : undefined
        }
      />

      {error && <ErrorPanel message={error} />}

      {!error && schema === null && (
        <>
          <LoadingStatus label="Loading database schema" />
          <SkeletonList count={6} lines={1} />
        </>
      )}

      {schema && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Schema view" className="flex rounded-xl border border-border bg-card/70 p-1 backdrop-blur-sm">
              {(["graph", "list"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn("press relative flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium capitalize", view === v ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {view === v && (
                    <motion.span layoutId="schema-view" className="absolute inset-0 rounded-lg border border-border bg-background shadow-sm" transition={{ type: "spring", stiffness: 450, damping: 36 }} />
                  )}
                  {v === "graph" ? <Waypoints aria-hidden className="relative size-3.5" /> : <LayoutList aria-hidden className="relative size-3.5" />}
                  <span className="relative">{v}</span>
                </button>
              ))}
            </div>
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Find a table or column</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={view === "graph" ? "Find a table or column: the graph flies to it…" : "Search tables or column names…"}
                className="h-10 w-full rounded-xl border border-border bg-card/70 pr-3 pl-9 text-sm outline-none transition-[border-color,box-shadow] focus:border-[rgb(var(--brand-rgb)/0.5)] focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1)]"
              />
            </label>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {view === "graph" ? (
              <motion.div key="graph" initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.99 }} transition={{ duration: 0.4, ease: EASE }}>
                <Suspense fallback={<SkeletonList count={4} lines={1} />}>
                  <SchemaGraph tables={schema.tables} query={filter} />
                </Suspense>
              </motion.div>
            ) : (
              <motion.div key="list" className="space-y-2.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <AnimatePresence mode="popLayout">
                  {filteredTables.map((table, i) => (
                    <TableRow key={table.name} table={table} index={i} />
                  ))}
                </AnimatePresence>
                {filteredTables.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">No tables or columns match "{filter}".</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
