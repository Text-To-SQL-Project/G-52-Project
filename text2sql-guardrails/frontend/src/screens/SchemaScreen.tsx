import { useEffect, useMemo, useState } from "react";
import { ApiError, getSchema } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import type { SchemaResponse, TableInfo } from "../types/api";

function TableCard({ table }: { table: TableInfo }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-card overflow-hidden rounded-2xl transition-all duration-200 hover:border-white/[0.18]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
            <span className="material-symbols-outlined text-[17px] text-cyan-300">table_rows</span>
          </div>
          <div className="flex flex-col">
            <span className="truncate font-mono text-sm font-semibold text-white">
              {table.name}
            </span>
            <span className="font-mono text-[11px] text-white/40">
              {table.columns.length} columns
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span
            className={`material-symbols-outlined text-[20px] text-white/40 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {open && (
        <div className="animate-fade overflow-x-auto border-t border-white/[0.08] bg-black/20">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-white/[0.02]">
                {["Column", "Type", "Key", "Sample values"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-white/[0.08] px-6 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/45"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <tr
                  key={col.name}
                  className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.04]"
                >
                  <td className="whitespace-nowrap px-6 py-2.5 font-mono text-white/90">
                    {col.name}
                    {!col.nullable && (
                      <span className="ml-1.5 text-rose-400/80" title="NOT NULL">
                        *
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5 font-mono text-indigo-300/80">
                    {col.data_type}
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5">
                    {col.is_primary_key && (
                      <span className="mr-1.5 rounded border border-purple-400/30 bg-purple-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-purple-200">
                        PK
                      </span>
                    )}
                    {col.is_foreign_key && (
                      <span
                        className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-200"
                        title={col.references ?? undefined}
                      >
                        FK → {col.references}
                      </span>
                    )}
                    {!col.is_primary_key && !col.is_foreign_key && (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                  <td className="max-w-md truncate px-6 py-2.5 font-mono text-white/50">
                    {col.sample_values.length > 0 ? col.sample_values.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SchemaScreen() {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    getSchema()
      .then(setSchema)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load schema."));
  }, []);

  const filteredTables = useMemo(() => {
    if (!schema) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return schema.tables;
    return schema.tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [schema, filter]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 md:px-8">
      {/* Header Bar */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Schema Explorer
          </h2>
          <p className="font-sans text-xs text-white/50">
            Browse tables, columns, constraints, and relationships in the active database
          </p>
        </div>
        {schema && (
          <div className="flex items-center gap-2">
            <span className="pill-tag rounded-full px-3 py-1 font-mono text-xs">
              <span className="material-symbols-outlined mr-1 text-[14px]">database</span>
              {schema.database}
            </span>
            <span className="pill-tag-indigo rounded-full px-3 py-1 font-mono text-xs">
              {schema.total_tables} tables · {schema.total_columns} columns
            </span>
          </div>
        )}
      </div>

      {error && <ErrorPanel message={error} />}

      {!error && schema === null && (
        <>
          <LoadingStatus label="Loading database schema" />
          <SkeletonList count={6} lines={1} />
        </>
      )}

      {schema && (
        <>
          {/* Search Bar */}
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[18px] text-white/40">
              search
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search tables or column names (e.g. students, gpa, department_id)…"
              className="w-full rounded-xl border border-white/10 bg-[#060c18]/80 py-3 pr-4 pl-11 font-sans text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/20"
            />
          </div>

          <div className="space-y-3">
            {filteredTables.map((table, i) => (
              <div
                key={table.name}
                style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                className="animate-rise"
              >
                <TableCard table={table} />
              </div>
            ))}
            {filteredTables.length === 0 && (
              <div className="glass-card rounded-2xl py-12 text-center text-sm text-white/40">
                No tables or columns match "{filter}".
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
