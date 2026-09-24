import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { RlsPrincipalRowCounts } from "../../types/api";

interface RlsRowCountChartProps {
  principals: RlsPrincipalRowCounts[];
  caveat: string;
}

export function RlsRowCountChart({ principals, caveat }: RlsRowCountChartProps) {
  const [selectedPrincipal, setSelectedPrincipal] = useState<string>("all");
  const [useLogScale, setUseLogScale] = useState(true);

  const tables = ["students", "marks", "attendance", "fee_payments"];

  // Functional colors for each principal (distinct, zero blue and zero purple)
  const principalColors: Record<string, string> = {
    admin: "#f59e0b",     // Solar Amber
    faculty1: "#fbbf24",  // Radiant Gold
    student1: "#22c55e",  // Emerald
    student2: "#e2e8f0",  // Neutral Silver
  };

  // Prepare grouped data for recharts
  const activePrincipals =
    selectedPrincipal === "all"
      ? principals
      : principals.filter((p) => p.principal === selectedPrincipal);

  const chartData = tables.map((tbl) => {
    const row: Record<string, string | number> = { table: tbl };
    for (const p of activePrincipals) {
      const val = p[tbl as keyof RlsPrincipalRowCounts] as number;
      row[p.principal] = useLogScale ? Math.max(1, val) : val;
    }
    return row;
  });

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", padding: "20px" }}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>policy</span>
            <h3 className="font-display text-sm font-semibold tracking-tight text-white">
              Row Level Security (RLS) Scoping Impact
            </h3>
            <span
              className="font-mono text-[10px] font-semibold"
              style={{
                padding: "2px 8px",
                border: "1px solid var(--border-accent)",
                background: "var(--accent-dim)",
                color: "var(--accent)",
                borderRadius: "2px",
              }}
            >
              Interactive Demo
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Row visibility enforced in PostgreSQL via (pid, backend_start) session binding
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1"
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-void)",
              borderRadius: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedPrincipal("all")}
              className="font-mono text-xs transition-colors duration-150"
              style={{
                padding: "4px 8px",
                borderRadius: "2px",
                border: selectedPrincipal === "all" ? "1px solid var(--border-accent)" : "1px solid transparent",
                background: selectedPrincipal === "all" ? "var(--accent-dim)" : "transparent",
                color: selectedPrincipal === "all" ? "var(--accent)" : "var(--text-muted)",
                fontWeight: selectedPrincipal === "all" ? 600 : 400,
              }}
            >
              All Principals
            </button>
            {principals.map((p) => (
              <button
                key={p.principal}
                type="button"
                onClick={() => setSelectedPrincipal(p.principal)}
                className="font-mono text-xs transition-colors duration-150"
                style={{
                  padding: "4px 8px",
                  borderRadius: "2px",
                  border: selectedPrincipal === p.principal ? "1px solid var(--border-accent)" : "1px solid transparent",
                  background: selectedPrincipal === p.principal ? "var(--accent-dim)" : "transparent",
                  color: selectedPrincipal === p.principal ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: selectedPrincipal === p.principal ? 600 : 400,
                }}
              >
                {p.principal}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={useLogScale}
              onChange={(e) => setUseLogScale(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            <span>Log Scale</span>
          </label>
        </div>
      </div>

      <div className="mt-5 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="table"
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
            />
            <YAxis
              scale={useLogScale ? "log" : "auto"}
              domain={useLogScale ? [1, 200000] : [0, 160000]}
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
              tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
                borderRadius: "2px",
                color: "#fff",
                fontSize: "0.75rem",
              }}
              formatter={(value: unknown, name: unknown) => [
                typeof value === "number" ? value.toLocaleString() : String(value),
                `${String(name)} visible rows`,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
            {activePrincipals.map((p) => (
              <Bar
                key={p.principal}
                dataKey={p.principal}
                name={`${p.principal} (${p.role})`}
                fill={principalColors[p.principal] || "#f59e0b"}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Identity Assertion Caveat Banner */}
      <div
        className="mt-4 text-xs leading-relaxed"
        style={{
          border: "1px solid rgba(245, 158, 11, 0.3)",
          background: "rgba(245, 158, 11, 0.08)",
          borderRadius: "2px",
          padding: "12px",
          color: "#fde68a",
        }}
      >
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: "#fbbf24" }}>
          <span className="material-symbols-outlined text-[16px]">warning</span>
          Methodological Identity Precaution
        </div>
        <p className="mt-1 text-[11.5px]" style={{ color: "rgba(253, 230, 138, 0.8)" }}>
          {caveat}
        </p>
      </div>
    </div>
  );
}
