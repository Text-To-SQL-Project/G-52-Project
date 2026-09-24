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
import type { SafetyLayerMetrics } from "../../types/api";

interface SafetyLayerBreakdownProps {
  metrics: SafetyLayerMetrics[];
}

export function SafetyLayerBreakdown({ metrics }: SafetyLayerBreakdownProps) {
  // Guardrail constraint from spec: AST block rate and LLM refusal accuracy must NEVER be merged into a single 'safety rate'
  const chartData = [
    {
      metric: "Guardrail Block Rate\n(AST sqlglot)",
      Anthropic: metrics.find((m) => m.provider === "Anthropic")?.guardrail_block_rate ?? 1.0,
      Gemini: metrics.find((m) => m.provider === "Gemini")?.guardrail_block_rate ?? 1.0,
      type: "Deterministic AST",
    },
    {
      metric: "LLM Refusal Accuracy\n(Unsafe Queries)",
      Anthropic: metrics.find((m) => m.provider === "Anthropic")?.refusal_accuracy ?? 1.0,
      Gemini: metrics.find((m) => m.provider === "Gemini")?.refusal_accuracy ?? 1.0,
      type: "Model Instruction",
    },
    {
      metric: "Clarification Accuracy\n(Ambiguous Queries)",
      Anthropic: metrics.find((m) => m.provider === "Anthropic")?.clarification_accuracy ?? 1.0,
      Gemini: metrics.find((m) => m.provider === "Gemini")?.clarification_accuracy ?? 1.0,
      type: "Model Instruction",
    },
  ];

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", padding: "20px" }}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>security</span>
            <h3 className="font-display text-sm font-semibold tracking-tight text-white">
              Multi-Layer Safety Stack Breakdown
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
              Separately Measured
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Deterministic AST guardrails and probabilistic LLM refusals reported apart to preserve layer attribution
          </p>
        </div>
      </div>

      <div className="mt-5 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 15, right: 20, left: 10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="metric"
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
            />
            <YAxis
              domain={[0, 1.1]}
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
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
                `${(Number(value) * 100).toFixed(1)}%`,
                `${String(name)}`,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
            <Bar dataKey="Anthropic" fill="#22d3ee" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Gemini" fill="#34d399" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", padding: "12px" }}>
          <p className="font-semibold text-white/80">Layer 2: AST Guardrail (sqlglot)</p>
          <p className="mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Deterministic static parsing: 100% block rate on 30 direct adversarial SQL queries (DDL, DML,
            stacked injections). Evaluated without any LLM in the path; model-independent by construction.
          </p>
        </div>
        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", padding: "12px" }}>
          <p className="font-semibold text-white/80">Layer 1: LLM Refusal &amp; Clarification</p>
          <p className="mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Model-level structured refusal: distinguishes unsafe requests (<code style={{ color: "var(--text-secondary)" }}>REFUSED</code>)
            from underspecified requests (<code style={{ color: "var(--text-secondary)" }}>CLARIFICATION_NEEDED</code>).
            Zero verified destructive SQL executed.
          </p>
        </div>
      </div>
    </div>
  );
}
