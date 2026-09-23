import type { ReactNode } from "react";
import type { Confidence, ConfidenceSignal, SignalStatus } from "../types/api";

function isDisabled(signal: ConfidenceSignal): boolean {
  return !!signal.detail && signal.detail.toLowerCase().includes("disabled");
}

const SIGNAL_COLOR: Record<SignalStatus, string> = {
  pass: "var(--success)",
  warn: "var(--warning)",
  fail: "var(--danger)",
};

const SIGNAL_SHAPE: Record<SignalStatus, { borderRadius: string; background: string }> = {
  pass: { borderRadius: "50%", background: "var(--success)" },
  warn: { borderRadius: "2px", background: "var(--warning)" },
  fail: { borderRadius: "1px", background: "var(--danger)" },
};

const LABEL_COLOR: Record<string, string> = {
  High: "var(--success)",
  Medium: "var(--warning)",
  Low: "var(--danger)",
};

function CardShell({ children }: { children: ReactNode }) {
  return (
    <section className="animate-rise overflow-hidden" style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>
      {children}
    </section>
  );
}

export function ConfidenceCard({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) {
    return (
      <CardShell>
        <header
          className="px-6 py-3.5"
          style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.01)" }}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>speed</span>
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Confidence Score
            </h3>
          </div>
        </header>
        <p className="px-6 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Not scored — query was not executed.
        </p>
      </CardShell>
    );
  }

  const scorePct = Math.round(confidence.score * 100);
  const strokeDasharray = `${scorePct}, 100`;

  return (
    <CardShell>
      <header
        className="flex items-center justify-between gap-3 px-6 py-3.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.01)" }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--accent)" }}>speed</span>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Confidence Assessment
          </h3>
        </div>
        <div className="flex items-center gap-2.5">
          {!confidence.calibrated && (
            <span
              className="font-mono text-[10px]"
              title="Hand-tuned weights, not yet learned + isotonic calibrated."
              style={{
                padding: "2px 8px",
                border: "1px solid var(--border-accent)",
                background: "var(--accent-dim)",
                color: "var(--accent)",
                borderRadius: "2px",
              }}
            >
              uncalibrated
            </span>
          )}
          <span className="text-xs font-semibold" style={{ color: LABEL_COLOR[confidence.label] ?? "var(--text-primary)" }}>
            {confidence.label} Confidence
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-12 md:items-center">
        {/* Circular SVG Meter with glow */}
        <div
          className="flex items-center gap-5 md:col-span-5 md:pr-6"
          style={{ borderRight: "1px solid var(--border-subtle)" }}
        >
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            {/* Glow ring behind */}
            <div
              className="absolute inset-[-6px] rounded-full"
              style={{
                background: `radial-gradient(circle, rgba(34, 211, 238, 0.08) 60%, transparent 100%)`,
              }}
            />
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="var(--border-subtle)"
                strokeDasharray="100, 100"
                strokeWidth="3.2"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="var(--accent)"
                strokeDasharray={strokeDasharray}
                strokeLinecap="round"
                strokeWidth="3.2"
                style={{
                  transition: "stroke-dasharray 0.7s var(--ease-expo)",
                  filter: "drop-shadow(0 0 4px var(--accent-glow))",
                }}
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="font-display text-2xl font-bold tracking-tight text-white">
                {scorePct}
                <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>%</span>
              </span>
            </div>
          </div>

          <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {confidence.score >= 0.85 ? (
              <p>High confidence in schema alignment, AST safety, and semantic intent.</p>
            ) : confidence.score >= 0.65 ? (
              <p>Moderate confidence. Check schema mapping and join conditions.</p>
            ) : (
              <p>Low confidence. Review generated SQL or clarify query phrasing.</p>
            )}
          </div>
        </div>

        {/* Signal bars */}
        <div className="space-y-3 md:col-span-7">
          {confidence.signals
            .filter((signal) => !isDisabled(signal))
            .map((signal, i) => (
              <div
                key={signal.key}
                title={signal.detail ?? undefined}
                className="animate-fade"
                style={{ animationDelay: `${100 + i * 50}ms` }}
              >
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                    <span
                      aria-hidden
                      className="block h-[7px] w-[7px] shrink-0"
                      style={{
                        ...SIGNAL_SHAPE[signal.status],
                        transform: signal.status === "fail" ? "rotate(45deg)" : "none",
                      }}
                    />
                    <span className="truncate font-sans">{signal.label}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {(signal.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden" style={{ background: "var(--border-subtle)", borderRadius: "1px" }}>
                  <div
                    className="animate-bar h-full"
                    style={{
                      width: `${Math.max(2, signal.score * 100)}%`,
                      background: SIGNAL_COLOR[signal.status],
                      borderRadius: "1px",
                      animationDelay: `${150 + i * 50}ms`,
                      boxShadow: `0 0 6px ${SIGNAL_COLOR[signal.status]}40`,
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    </CardShell>
  );
}
