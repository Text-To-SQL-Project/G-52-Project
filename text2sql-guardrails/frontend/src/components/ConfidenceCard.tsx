import type { ReactNode } from "react";
import type { Confidence, ConfidenceSignal, SignalStatus } from "../types/api";

function isDisabled(signal: ConfidenceSignal): boolean {
  return !!signal.detail && signal.detail.toLowerCase().includes("disabled");
}

const SIGNAL_COLOR: Record<SignalStatus, string> = {
  pass: "bg-emerald-400",
  warn: "bg-amber-400",
  fail: "bg-red-400",
};

const SIGNAL_SHAPE: Record<SignalStatus, string> = {
  pass: "rounded-full bg-emerald-400",
  warn: "rounded-[2px] bg-amber-400",
  fail: "rotate-45 rounded-[1px] bg-red-400",
};

const LABEL_COLOR: Record<string, string> = {
  High: "text-emerald-300",
  Medium: "text-amber-300",
  Low: "text-red-300",
};

function CardShell({ children }: { children: ReactNode }) {
  return (
    <section className="glass-card animate-rise overflow-hidden rounded-2xl">
      {children}
    </section>
  );
}

export function ConfidenceCard({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) {
    return (
      <CardShell>
        <header className="border-b border-white/[0.08] bg-white/[0.02] px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-indigo-300">speed</span>
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-white/60">
              Confidence Score
            </h3>
          </div>
        </header>
        <p className="px-6 py-10 text-center text-sm text-white/35">
          Not scored — query was not executed.
        </p>
      </CardShell>
    );
  }

  const scorePct = Math.round(confidence.score * 100);
  // SVG circular circumference for r=15.9155 is 100
  const strokeDasharray = `${scorePct}, 100`;

  return (
    <CardShell>
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.02] px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-indigo-300">speed</span>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-white/70">
            Confidence Assessment
          </h3>
        </div>
        <div className="flex items-center gap-2.5">
          {!confidence.calibrated && (
            <span
              className="pill-tag-indigo rounded-full px-2.5 py-0.5 font-mono text-[10px]"
              title="Hand-tuned weights, not yet learned + isotonic calibrated."
            >
              uncalibrated
            </span>
          )}
          <span className={`text-xs font-semibold ${LABEL_COLOR[confidence.label] ?? "text-white"}`}>
            {confidence.label} Confidence
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-12 md:items-center">
        {/* Stitch Circular SVG Meter */}
        <div className="flex items-center gap-5 md:col-span-5 md:border-r md:border-white/[0.08] md:pr-6">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
              <path
                className="text-white/10"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeDasharray="100, 100"
                strokeWidth="3.2"
              />
              <path
                className="text-[#22d3ee] transition-all duration-700"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeDasharray={strokeDasharray}
                strokeLinecap="round"
                strokeWidth="3.2"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="font-display text-2xl font-bold tracking-tight text-white">
                {scorePct}
                <span className="text-xs font-normal text-white/50">%</span>
              </span>
            </div>
          </div>

          <div className="text-xs leading-relaxed text-white/60">
            {confidence.score >= 0.85 ? (
              <p>High confidence in schema alignment, AST safety, and semantic intent.</p>
            ) : confidence.score >= 0.65 ? (
              <p>Moderate confidence. Check schema mapping and join conditions.</p>
            ) : (
              <p>Low confidence. Review generated SQL or clarify query phrasing.</p>
            )}
          </div>
        </div>

        {/* Breakdown bars for individual detector signals */}
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
                  <span className="flex min-w-0 items-center gap-2 text-white/75">
                    <span
                      aria-hidden
                      className={`block h-[7px] w-[7px] shrink-0 ${SIGNAL_SHAPE[signal.status]}`}
                    />
                    <span className="truncate font-sans">{signal.label}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-white/50">
                    {(signal.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`animate-bar h-full rounded-full ${SIGNAL_COLOR[signal.status]}`}
                    style={{
                      width: `${Math.max(2, signal.score * 100)}%`,
                      animationDelay: `${150 + i * 50}ms`,
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
