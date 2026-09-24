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
  Cell,
} from "recharts";
import type { AurocComparison, AblationCell, PerSignalAurocItem } from "../../types/api";

interface AurocChartProps {
  comparison: AurocComparison;
  ablationCells: AblationCell[];
  perSignalAuroc: Record<string, PerSignalAurocItem[]>;
}

export function AurocChart({ comparison, ablationCells, perSignalAuroc }: AurocChartProps) {
  const [showHistoricalDebug, setShowHistoricalDebug] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "ablation" | "persignal">("summary");
  const [selectedProvider, setSelectedProvider] = useState<"Anthropic" | "Gemini">("Anthropic");

  // Summary bar data
  const summaryData = [
    {
      name: "In-sample Raw",
      AUROC: comparison.in_sample_raw,
      citable: true,
      fill: "#f59e0b",
    },
    {
      name: "Held-out Raw",
      AUROC: comparison.held_out_raw,
      citable: true,
      fill: "#fbbf24",
    },
    {
      name: "Held-out Calibrated",
      AUROC: comparison.held_out_calibrated,
      citable: true,
      fill: "#22c55e",
    },
    ...(showHistoricalDebug
      ? [
          {
            name: "Frozen / Stale (Historical)",
            AUROC: comparison.superseded_frozen_value,
            citable: false,
            fill: "#ef4444",
          },
        ]
      : []),
  ];

  // Ablation data filtered by provider
  const ablationData = ablationCells
    .filter((c) => c.provider === selectedProvider)
    .map((c) => ({
      name: `${c.regime} (${c.split})`,
      "5-Signal (with MQ)": c.five_signal,
      "4-Signal (dropped MQ)": c.four_signal,
      delta: c.delta,
      dropping_hurts: c.dropping_hurts,
      is_justification: c.is_justification_cell,
    }));

  // Per-signal data
  const signalData = (perSignalAuroc[selectedProvider] || []).map((s) => ({
    name: s.signal.replace(/_/g, " "),
    Permissive: s.permissive,
    Strict: s.strict,
    delta: s.delta,
    is_focal: s.is_focal,
  }));

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", padding: "20px" }}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>analytics</span>
            <h3 className="font-display text-sm font-semibold tracking-tight text-white">
              Confidence AUROC &amp; Ablation Analysis
            </h3>
            <span
              className="font-mono text-[10px] font-semibold"
              style={{
                padding: "2px 8px",
                border: "1px solid rgba(52, 211, 153, 0.3)",
                background: "rgba(52, 211, 153, 0.1)",
                color: "#34d399",
                borderRadius: "2px",
              }}
            >
              Live Verified
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Discriminative ability of confidence fusion across label definitions and splits
          </p>
        </div>

        {/* Tab Selector */}
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
            onClick={() => setActiveTab("summary")}
            className="font-mono text-xs transition-colors duration-150"
            style={{
              padding: "4px 10px",
              borderRadius: "2px",
              border: activeTab === "summary" ? "1px solid var(--border-accent)" : "1px solid transparent",
              background: activeTab === "summary" ? "var(--accent-dim)" : "transparent",
              color: activeTab === "summary" ? "var(--accent)" : "var(--text-muted)",
              fontWeight: activeTab === "summary" ? 600 : 400,
            }}
          >
            AUROC Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ablation")}
            className="font-mono text-xs transition-colors duration-150"
            style={{
              padding: "4px 10px",
              borderRadius: "2px",
              border: activeTab === "ablation" ? "1px solid var(--border-accent)" : "1px solid transparent",
              background: activeTab === "ablation" ? "var(--accent-dim)" : "transparent",
              color: activeTab === "ablation" ? "var(--accent)" : "var(--text-muted)",
              fontWeight: activeTab === "ablation" ? 600 : 400,
            }}
          >
            Ablation Grid (8-Cell)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("persignal")}
            className="font-mono text-xs transition-colors duration-150"
            style={{
              padding: "4px 10px",
              borderRadius: "2px",
              border: activeTab === "persignal" ? "1px solid var(--border-accent)" : "1px solid transparent",
              background: activeTab === "persignal" ? "var(--accent-dim)" : "transparent",
              color: activeTab === "persignal" ? "var(--accent)" : "var(--text-muted)",
              fontWeight: activeTab === "persignal" ? 600 : 400,
            }}
          >
            Per-Signal
          </button>
        </div>
      </div>

      {activeTab === "summary" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Comparing in-sample vs held-out discriminative power.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={showHistoricalDebug}
                onChange={(e) => setShowHistoricalDebug(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              <span>Show Superseded 0.649 Value (Debug)</span>
            </label>
          </div>

          {showHistoricalDebug && (
            <div
              className="animate-fade text-xs"
              style={{
                border: "1px solid rgba(239, 68, 68, 0.3)",
                background: "rgba(239, 68, 68, 0.08)",
                borderRadius: "2px",
                padding: "12px",
                color: "#fca5a5",
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <span className="inline-block h-2 w-2 rounded-full bg-red-400"></span>
                DO NOT CITE: 0.649 was retired on 2026-09-15
              </div>
              <p className="mt-1" style={{ color: "var(--text-secondary)" }}>{comparison.superseded_note}</p>
            </div>
          )}

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryData} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                />
                <YAxis
                  domain={[0.4, 0.8]}
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                    borderRadius: "2px",
                    color: "#fff",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: unknown) => [
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    "AUROC",
                  ]}
                />
                <Bar dataKey="AUROC" radius={[2, 2, 0, 0]}>
                  {summaryData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.fill}
                      stroke={entry.citable ? "rgba(255,255,255,0.2)" : "#ef4444"}
                      strokeWidth={entry.citable ? 1 : 2}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "ablation" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Provider:</span>
              <button
                type="button"
                onClick={() => setSelectedProvider("Anthropic")}
                className="font-mono text-xs transition-colors"
                style={{
                  padding: "2px 8px",
                  borderRadius: "2px",
                  border: selectedProvider === "Anthropic" ? "1px solid var(--border-accent)" : "1px solid var(--border-subtle)",
                  background: selectedProvider === "Anthropic" ? "var(--accent-dim)" : "transparent",
                  color: selectedProvider === "Anthropic" ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                Anthropic (repeats=3)
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("Gemini")}
                className="font-mono text-xs transition-colors"
                style={{
                  padding: "2px 8px",
                  borderRadius: "2px",
                  border: selectedProvider === "Gemini" ? "1px solid var(--border-accent)" : "1px solid var(--border-subtle)",
                  background: selectedProvider === "Gemini" ? "var(--accent-dim)" : "transparent",
                  color: selectedProvider === "Gemini" ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                Gemini (repeats=1)
              </button>
            </div>
            <span className="font-mono text-[11px] italic" style={{ color: "var(--text-ghost)" }}>
              *Providers never merged into a single average
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ablationData} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                />
                <YAxis
                  domain={[0.4, 0.9]}
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
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
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
                <Bar dataKey="5-Signal (with MQ)" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="4-Signal (dropped MQ)" fill="#71717a" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text-primary)" }}>Key finding:</strong> In 6 of 8 cells across providers, dropping{" "}
            <code style={{ color: "var(--accent)" }}>multi_query_agreement</code> hurts AUROC. The original
            justification (+0.065) appeared only in Anthropic Permissive In-sample and reverses sign
            on Gemini (−0.034).
          </p>
        </div>
      )}

      {activeTab === "persignal" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Provider:</span>
              <button
                type="button"
                onClick={() => setSelectedProvider("Anthropic")}
                className="font-mono text-xs transition-colors"
                style={{
                  padding: "2px 8px",
                  borderRadius: "2px",
                  border: selectedProvider === "Anthropic" ? "1px solid var(--border-accent)" : "1px solid var(--border-subtle)",
                  background: selectedProvider === "Anthropic" ? "var(--accent-dim)" : "transparent",
                  color: selectedProvider === "Anthropic" ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                Anthropic
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("Gemini")}
                className="font-mono text-xs transition-colors"
                style={{
                  padding: "2px 8px",
                  borderRadius: "2px",
                  border: selectedProvider === "Gemini" ? "1px solid var(--border-accent)" : "1px solid var(--border-subtle)",
                  background: selectedProvider === "Gemini" ? "var(--accent-dim)" : "transparent",
                  color: selectedProvider === "Gemini" ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                Gemini
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalData} margin={{ top: 15, right: 20, left: 0, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                  interval={0}
                />
                <YAxis
                  domain={[0.45, 0.85]}
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
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
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
                <Bar dataKey="Permissive" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Strict" fill="#ea580c" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text-primary)" }}>Signal Inversion:</strong>{" "}
            <code style={{ color: "#f87171", fontWeight: 600 }}>multi_query_agreement</code> rises from
            weakest to strongest predictor (0.532 → 0.734 on Anthropic, 0.568 → 0.783 on Gemini)
            under strict labels.
          </p>
        </div>
      )}
    </div>
  );
}
