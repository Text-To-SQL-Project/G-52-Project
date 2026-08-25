import { useEffect, useMemo, useState } from "react";
import { ApiError, getSchema } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import type { SchemaResponse, TableInfo } from "../types/api";

function TableCard({ table }: { table: TableInfo }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{table.name}</span>
          <span className="text-xs text-white/30">{table.columns.length} columns</span>
        </div>
        <span className="text-white/40">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-white/10">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-white/40">
                <th className="px-3 py-2 font-medium">Column</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Keys</th>
                <th className="px-3 py-2 font-medium">Sample values</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <tr key={col.name} className="border-b border-white/5 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-white/80">
                    {col.name}
                    {!col.nullable && <span className="ml-1 text-white/30">*</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-white/50">{col.data_type}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {col.is_primary_key && (
                      <span className="mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">PK</span>
                    )}
                    {col.is_foreign_key && (
                      <span
                        className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-300"
                        title={col.references ?? undefined}
                      >
                        FK → {col.references}
                      </span>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-white/40">
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
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white/70">
          Schema Explorer
          {schema && (
            <span className="ml-2 text-xs text-white/30">
              {schema.database} — {schema.total_tables} tables, {schema.total_columns} columns
            </span>
          )}
        </h2>
      </div>

      {error && <ErrorPanel message={error} />}

      {!error && schema === null && (
        <p className="py-8 text-center text-sm text-white/30">Loading…</p>
      )}

      {schema && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by table or column name…"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
          />
          <div className="space-y-2">
            {filteredTables.map((table) => (
              <TableCard key={table.name} table={table} />
            ))}
            {filteredTables.length === 0 && (
              <p className="py-8 text-center text-sm text-white/30">No tables match "{filter}".</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
