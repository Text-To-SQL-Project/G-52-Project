import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ResultTable } from "../types/api";

const SERIES = ["var(--mod-academic)", "var(--mod-library)", "var(--mod-exams)"];

export type ChartShape = { label: number; values: number[] };

export default function ResultChart({ results, shape }: { results: ResultTable; shape: ChartShape }) {
  const data = results.rows.map((row) =>
    Object.fromEntries([["label", String(row[shape.label] ?? "—")], ...shape.values.map((j) => [results.columns[j], row[j] === null ? null : Number(row[j])])]),
  );
  const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
  return (
    <div className="h-[22rem] w-full p-5" role="img" aria-label={`Bar chart of ${shape.values.map((j) => results.columns[j]).join(", ")} by ${results.columns[shape.label]}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--ink-rgb) / 0.08)" />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 70 : 30} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            cursor={{ fill: "rgb(var(--ink-rgb) / 0.05)" }}
            contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-hairline)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {shape.values.map((j, i) => (
            <Bar key={j} dataKey={results.columns[j]} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
