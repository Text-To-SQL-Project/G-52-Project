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

  // Colors for each principal
  const principalColors: Record<string, string> = {
    admin: "#6366f1",     // Indigo
    faculty1: "#0ea5e9",  // Sky Blue
    student1: "#10b981",  // Emerald
    student2: "#f59e0b",  // Amber
  };

  // Prepare grouped data for recharts
  // Each entry is a table with counts per selected principal
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
    <div className="rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-wide text-white">
              Row Level Security (RLS) Scoping Impact
            </h3>
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400 border border-blue-500/20">
              Interactive Demo
            </span>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Row visibility enforced in PostgreSQL via (pid, backend_start) session binding
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#070d19]/80 p-1">
            <button
              type="button"
              onClick={() => setSelectedPrincipal("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedPrincipal === "all"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              All Principals
            </button>
            {principals.map((p) => (
              <button
                key={p.principal}
                type="button"
                onClick={() => setSelectedPrincipal(p.principal)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  selectedPrincipal === p.principal
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {p.principal}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/60 hover:text-white">
            <input
              type="checkbox"
              checked={useLogScale}
              onChange={(e) => setUseLogScale(e.target.checked)}
              className="rounded border-white/20 bg-[#020617] text-blue-500 focus:ring-0"
            />
            <span>Log Scale</span>
          </label>
        </div>
      </div>

      <div className="mt-5 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis
              dataKey="table"
              stroke="#ffffff60"
              tick={{ fill: "#ffffff80", fontSize: 11 }}
            />
            <YAxis
              scale={useLogScale ? "log" : "auto"}
              domain={useLogScale ? [1, 200000] : [0, 160000]}
              stroke="#ffffff60"
              tick={{ fill: "#ffffff80", fontSize: 11 }}
              tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0d1526",
                borderColor: "#ffffff20",
                borderRadius: "0.5rem",
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
                fill={principalColors[p.principal] || "#8884d8"}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Identity Assertion Caveat Banner */}
      <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200/90">
        <div className="flex items-center gap-1.5 font-semibold text-amber-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Methodological Identity Precaution
        </div>
        <p className="mt-1 text-[11.5px] text-amber-100/75">
          {caveat}
        </p>
      </div>
    </div>
  );
}
