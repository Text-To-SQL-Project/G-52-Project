import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ResultTable } from "../types/api";

const SERIES = ["var(--mod-academic)", "var(--mod-library)", "var(--mod-exams)"];
const FONT = 11;
const LINE = 13;
const MAX_LINES = 3;

export type ChartShape = { label: number; values: number[] };

/** Word-wraps a label to `chars` per line, at most MAX_LINES lines ("…" after). */
function wrap(label: string, chars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    for (let w = word; w; ) {
      const room = chars - (line ? line.length + 1 : 0);
      if (w.length <= room) { line = line ? `${line} ${w}` : w; w = ""; }
      else if (line) { lines.push(line); line = ""; }
      else { lines.push(w.slice(0, chars)); w = w.slice(chars); } // a single word longer than a line
    }
  }
  if (line) lines.push(line);
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `${lines[MAX_LINES - 1].slice(0, chars - 1)}…`] : lines;
}

export default function ResultChart({ results, shape }: { results: ResultTable; shape: ChartShape }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const data = results.rows.map((row) =>
    Object.fromEntries([["label", String(row[shape.label] ?? "—")], ...shape.values.map((j) => [results.columns[j], row[j] === null ? null : Number(row[j])])]),
  );

  // Each label gets its bar's slot width; ~0.6em per character at 11px.
  const band = width ? (width - 56) / data.length : 120;
  const chars = Math.floor((band - 8) / (FONT * 0.6));
  // Too narrow to wrap labels under the bars (phones, many rows): turn the
  // chart sideways so every name gets a full row to the left of its bar.
  const sideways = chars < 6;
  const nameChars = 16; // label column width (~120px) in sideways mode
  const wrapped = new Map(data.map((d) => [d.label as string, wrap(d.label as string, sideways ? nameChars : chars)]));
  const lines = Math.max(1, ...[...wrapped.values()].map((l) => l.length));
  const fill = "var(--muted-foreground)";
  const ink = "rgb(var(--ink-rgb) / 0.08)";

  const label = (anchor: "middle" | "end") => ({ x: tx, y: ty, payload }: { x?: number | string; y?: number | string; payload: { value: unknown } }) => {
    const x = Number(tx), y = Number(ty);
    const full = String(payload.value);
    const ls = wrapped.get(full) ?? [full];
    // Under a bar: lines flow down from the axis. Beside a bar: block centred on it.
    const first = anchor === "middle" ? 4 + LINE - 2 : 4 - ((ls.length - 1) * LINE) / 2;
    return (
      <text x={x} y={y} fill={fill} fontSize={FONT} textAnchor={anchor}>
        <title>{full}</title>
        {ls.map((l, i) => <tspan key={i} x={anchor === "end" ? x - 6 : x} dy={i ? LINE : first}>{l}</tspan>)}
      </text>
    );
  };

  return (
    <div
      ref={box}
      className="w-full p-5"
      style={{ height: sideways ? Math.max(260, data.length * Math.max(34, lines * LINE + 10) + 70) : 384 }}
      role="img"
      aria-label={`Bar chart of ${shape.values.map((j) => results.columns[j]).join(", ")} by ${results.columns[shape.label]}`}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout={sideways ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={sideways} horizontal={!sideways} stroke={ink} />
          {sideways ? (
            <>
              <XAxis type="number" tick={{ fill, fontSize: FONT }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={nameChars * FONT * 0.6 + 14} interval={0} tickLine={false} axisLine={false} tick={label("end")} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} height={lines * LINE + 22} tick={label("middle")} />
              <YAxis tick={{ fill, fontSize: FONT }} tickLine={false} axisLine={false} width={48} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "rgb(var(--ink-rgb) / 0.05)" }}
            contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-hairline)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
          {shape.values.map((j, i) => (
            <Bar key={j} dataKey={results.columns[j]} fill={SERIES[i]} radius={sideways ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={sideways ? 22 : 48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
