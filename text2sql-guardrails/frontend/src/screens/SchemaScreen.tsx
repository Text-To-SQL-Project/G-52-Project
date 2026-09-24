import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ApiError, getSchema } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonList } from "../components/Skeleton";
import type { SchemaResponse, TableInfo } from "../types/api";

function TableRow({ table }: { table: TableInfo }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { height: 0, opacity: 0 },
        { height: "auto", opacity: 1, duration: 0.4, ease: "expo.out" }
      );
    }
  }, [open]);

  return (
    <div
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
      className="transition-colors duration-150"
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.01)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-4 px-1 text-left transition-colors focus-visible:outline-none"
        style={{ background: "transparent", border: "none" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="material-symbols-outlined text-[17px]" style={{ color: "var(--accent)" }}>
            table_rows
          </span>
          <div className="flex flex-col">
            <span className="truncate font-mono text-sm font-semibold text-white">
              {table.name}
            </span>
            <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
              {table.columns.length} columns
            </span>
          </div>
        </div>
        <span
          className="material-symbols-outlined text-[20px] transition-transform duration-200"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div ref={contentRef} className="overflow-x-auto pb-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {["Column", "Type", "Key", "Sample values"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      color: "var(--text-muted)",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
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
                  className="transition-colors last:border-0"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-white/90">
                    {col.name}
                    {!col.nullable && (
                      <span className="ml-1.5" style={{ color: "var(--danger)", opacity: 0.7 }} title="NOT NULL">*</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono" style={{ color: "var(--accent)", opacity: 0.7 }}>
                    {col.data_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {col.is_primary_key && (
                      <span
                        className="mr-1.5 font-mono text-[10px] font-semibold"
                        style={{
                          padding: "2px 8px",
                          border: "1px solid var(--border-accent)",
                          background: "var(--accent-dim)",
                          color: "var(--accent)",
                          borderRadius: "2px",
                        }}
                      >
                        PK
                      </span>
                    )}
                    {col.is_foreign_key && (
                      <span
                        className="font-mono text-[10px] font-semibold"
                        title={col.references ?? undefined}
                        style={{
                          padding: "2px 8px",
                          border: "1px solid var(--border-accent)",
                          background: "var(--accent-dim)",
                          color: "var(--accent-bright)",
                          borderRadius: "2px",
                        }}
                      >
                        FK → {col.references}
                      </span>
                    )}
                    {!col.is_primary_key && !col.is_foreign_key && (
                      <span style={{ color: "var(--text-ghost)" }}>—</span>
                    )}
                  </td>
                  <td className="max-w-md truncate px-4 py-2.5 font-mono" style={{ color: "var(--text-secondary)" }}>
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSchema()
      .then(setSchema)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load schema."));
  }, []);

  useEffect(() => {
    if (schema && listRef.current) {
      gsap.fromTo(
        listRef.current.children,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: "expo.out" }
      );
    }
  }, [schema, filter]);

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
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-10 sm:px-8 lg:px-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div>
          <h2
            className="font-display font-bold tracking-tight text-white"
            style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", letterSpacing: "-0.03em" }}
          >
            Schema Explorer
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Browse tables, columns, constraints, and relationships
          </p>
        </div>
        {schema && (
          <div className="flex items-center gap-3">
            <span className="pill-tag flex items-center gap-1 px-2.5 py-0.5 font-mono text-xs">
              <span className="material-symbols-outlined mr-0.5 text-[14px]">database</span>
              {schema.database}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
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
          {/* Search — line-draw style */}
          <div className="relative">
            <span
              className="material-symbols-outlined pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-[18px]"
              style={{ color: "var(--text-muted)" }}
            >
              search
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search tables or column names…"
              className="signal-input"
              style={{ paddingLeft: "28px" }}
            />
          </div>

          <div ref={listRef}>
            {filteredTables.map((table) => (
              <TableRow key={table.name} table={table} />
            ))}
            {filteredTables.length === 0 && (
              <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No tables or columns match "{filter}".
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
