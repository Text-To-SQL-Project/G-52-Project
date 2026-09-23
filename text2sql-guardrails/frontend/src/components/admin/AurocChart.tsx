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
      fill: "#3b82f6",
    },
    {
      name: "Held-out Raw",
      AUROC: comparison.held_out_raw,
      citable: true,
      fill: "#6366f1",
    },
    {
      name: "Held-out Calibrated",
      AUROC: comparison.held_out_calibrated,
      citable: true,
      fill: "#10b981",
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
    <div className="rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 p-5 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-wide text-white">
              Confidence AUROC &amp; Ablation Analysis
            </h3>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
              Live Verified
            </span>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Discriminative ability of confidence fusion across label definitions and splits
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#070d19]/80 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("summary")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "summary"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            AUROC Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ablation")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "ablation"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Ablation Grid (8-Cell)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("persignal")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "persignal"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            Per-Signal
          </button>
        </div>
      </div>

      {activeTab === "summary" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/50">
              Comparing in-sample vs held-out discriminative power.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60 hover:text-white">
              <input
                type="checkbox"
                checked={showHistoricalDebug}
                onChange={(e) => setShowHistoricalDebug(e.target.checked)}
                className="rounded border-white/20 bg-[#020617] text-blue-500 focus:ring-0"
              />
              <span>Show Superseded 0.649 Value (Debug)</span>
            </label>
          </div>

          {showHistoricalDebug && (
            <div className="animate-fade rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <div className="flex items-center gap-2 font-semibold">
                <span className="inline-block h-2 w-2 rounded-full bg-red-400"></span>
                DO NOT CITE: 0.649 was retired on 2026-09-15
              </div>
              <p className="mt-1 text-white/70">{comparison.superseded_note}</p>
            </div>
          )}

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryData} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 11 }}
                />
                <YAxis
                  domain={[0.4, 0.8]}
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0d1526",
                    borderColor: "#ffffff20",
                    borderRadius: "0.5rem",
                    color: "#fff",
                    fontSize: "0.75rem",
                  }}
                  formatter={(value: unknown) => [
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    "AUROC",
                  ]}
                />
                <Bar dataKey="AUROC" radius={[4, 4, 0, 0]}>
                  {summaryData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.fill}
                      stroke={entry.citable ? "#ffffff30" : "#ff0000"}
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
              <span className="text-xs text-white/50">Provider:</span>
              <button
                type="button"
                onClick={() => setSelectedProvider("Anthropic")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  selectedProvider === "Anthropic"
                    ? "bg-white/20 text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Anthropic (repeats=3)
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("Gemini")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  selectedProvider === "Gemini"
                    ? "bg-white/20 text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Gemini (repeats=1)
              </button>
            </div>
            <span className="text-[11px] text-white/40 italic">
              *Providers never merged into a single average
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ablationData} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 11 }}
                />
                <YAxis
                  domain={[0.4, 0.9]}
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 11 }}
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
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
                <Bar dataKey="5-Signal (with MQ)" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="4-Signal (dropped MQ)" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] text-white/40">
            <strong>Key finding:</strong> In 6 of 8 cells across providers, dropping{" "}
            <code className="text-white/70">multi_query_agreement</code> hurts AUROC. The original
            justification (+0.065) appeared only in Anthropic Permissive In-sample and reverses sign
            on Gemini (−0.034).
          </p>
        </div>
      )}

      {activeTab === "persignal" && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">Provider:</span>
              <button
                type="button"
                onClick={() => setSelectedProvider("Anthropic")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  selectedProvider === "Anthropic"
                    ? "bg-white/20 text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Anthropic
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("Gemini")}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  selectedProvider === "Gemini"
                    ? "bg-white/20 text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                Gemini
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalData} margin={{ top: 15, right: 20, left: 0, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 10 }}
                  interval={0}
                />
                <YAxis
                  domain={[0.45, 0.85]}
                  stroke="#ffffff60"
                  tick={{ fill: "#ffffff80", fontSize: 11 }}
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
                    typeof value === "number" ? value.toFixed(3) : String(value),
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: "8px" }} />
                <Bar dataKey="Permissive" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Strict" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] text-white/40">
            <strong>Signal Inversion:</strong>{" "}
            <code className="text-red-400 font-semibold">multi_query_agreement</code> rises from
            weakest to strongest predictor (0.532 → 0.734 on Anthropic, 0.568 → 0.783 on Gemini)
            under strict labels.
          </p>
        </div>
      )}
    </div>
  );
}
