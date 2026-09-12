import { useEffect, useMemo, useState } from "react";
import { ApiError, getSchema } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import type { SchemaResponse, TableInfo } from "../types/api";

function TableCard({ table }: { table: TableInfo }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 transition-colors duration-200 hover:border-white/[0.16]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors duration-200 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50"
      >
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate font-mono text-sm text-white">{table.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-white/35">
            {table.columns.length} columns
          </span>
        </div>
        {/* One glyph rotated rather than swapping + for −, so the control reads
            as the same object changing state. */}
        <span
          aria-hidden
          className={`shrink-0 text-lg leading-none text-white/35 transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>

      {open && (
        <div className="animate-fade overflow-x-auto border-t border-white/[0.07]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {["Column", "Type", "Keys", "Sample values"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-white/40"
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
                  className="border-b border-white/[0.04] transition-colors duration-150 last:border-0 hover:bg-white/[0.04]"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-white/85">
                    {col.name}
                    {!col.nullable && (
                      <span className="ml-1 text-white/30" title="NOT NULL">
                        *
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-white/45">
                    {col.data_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {/* Violet, not amber: amber is REFUSED in the status
                        palette, and a primary key is not a warning. */}
                    {col.is_primary_key && (
                      <span className="mr-1 rounded border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 font-mono text-violet-200">
                        PK
                      </span>
                    )}
                    {col.is_foreign_key && (
                      <span
                        className="rounded border border-blue-400/25 bg-blue-400/10 px-1.5 py-0.5 font-mono text-blue-200"
                        title={col.references ?? undefined}
                      >
                        FK → {col.references}
                      </span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-white/40">
                    {col.sample_values.join(", ")}
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
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
          Schema Explorer
        </h2>
        {schema && (
          <span className="text-xs text-white/35">
            <span className="font-mono">{schema.database}</span>
            <span className="mx-1.5 text-white/15">·</span>
            <span className="tabular-nums">{schema.total_tables}</span> tables
            <span className="mx-1.5 text-white/15">·</span>
            <span className="tabular-nums">{schema.total_columns}</span> columns
          </span>
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
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by table or column name…"
            className="w-full rounded-xl border border-white/10 bg-[#020617]/60 px-4 py-2.5 text-sm text-white transition duration-200 placeholder:text-white/25 focus:border-blue-400/50 focus:bg-[#020617]/80 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
          />
          <div className="space-y-2.5">
            {filteredTables.map((table, i) => (
              <div key={table.name} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className="animate-rise">
                <TableCard table={table} />
              </div>
            ))}
            {filteredTables.length === 0 && (
              <p className="animate-fade rounded-2xl border border-white/[0.07] bg-[#0f1728]/70 py-12 text-center text-sm text-white/35">
                No tables match "{filter}".
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
