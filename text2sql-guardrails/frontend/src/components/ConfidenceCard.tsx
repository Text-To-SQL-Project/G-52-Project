import type { ReactNode } from "react";
import type { Confidence, ConfidenceSignal, SignalStatus } from "../types/api";

/** A detector that was turned off (e.g. MULTI_QUERY_ENABLED=false) still
 * comes back in the payload as a neutral 0.5/WARN placeholder, so the
 * response shape stays uniform -- but it never measured anything and is
 * excluded from the fused score, so showing it as "50%" reads as a real
 * middling result when it isn't one. Hidden here rather than dropped from
 * the payload: the API contract is unchanged, and eval tooling relies on
 * the field being present to know the signal was unmeasured.
 *
 * Mirrors app/detection/confidence.py::_is_disabled()'s convention -- the
 * marker is the word "disabled" in the detail string. Note that a signal
 * which was attempted and FAILED (e.g. "Back-translation check could not
 * run: ...") deliberately does NOT match: that one does feed the fused
 * score, so it stays visible. */
function isDisabled(signal: ConfidenceSignal): boolean {
  return !!signal.detail && signal.detail.toLowerCase().includes("disabled");
}

const SIGNAL_COLOR: Record<SignalStatus, string> = {
  pass: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
};

/** Per-signal marker. Shape, not just hue: the bar colours alone would be
 * indistinguishable on a projector that muddies amber into red, and these are
 * the signals a reviewer is asked to trust. Shapes match StatusBanner's
 * vocabulary -- disc reads as pass, square as caution, diamond as fail. */
const SIGNAL_SHAPE: Record<SignalStatus, string> = {
  pass: "rounded-full bg-emerald-400",
  warn: "rounded-[1.5px] bg-amber-400",
  fail: "rotate-45 rounded-[1px] bg-red-400",
};

/** Green is reserved for SUCCESS and PASS (see StatusBanner), so the aggregate
 * label does not use it: "High" would put a success-coloured word on screen for
 * a query whose correctness is exactly what is still in question. The number
 * beside it carries the magnitude. */
const LABEL_COLOR: Record<string, string> = {
  High: "text-white",
  Medium: "text-amber-300",
  Low: "text-red-300",
};

function CardShell({ children }: { children: ReactNode }) {
  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      {children}
    </section>
  );
}

export function ConfidenceCard({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) {
    return (
      <CardShell>
        <header className="border-b border-white/[0.07] px-5 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
            Confidence
          </h3>
        </header>
        <p className="px-5 py-10 text-center text-sm text-white/30">
          Not scored — query was not executed.
        </p>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
          Confidence
        </h3>
        <div className="flex items-center gap-2.5">
          {!confidence.calibrated && (
            <span
              className="rounded border border-white/[0.09] bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-white/40"
              title="Hand-tuned weights, not yet learned + isotonic calibrated."
            >
              uncalibrated
            </span>
          )}
          <span
            className={`text-sm font-semibold ${LABEL_COLOR[confidence.label] ?? "text-white"}`}
          >
            {confidence.label}
          </span>
          <span className="text-lg font-semibold tabular-nums text-white/75">
            {(confidence.score * 100).toFixed(0)}
            <span className="ml-0.5 text-xs font-medium text-white/35">%</span>
          </span>
        </div>
      </header>

      <div className="space-y-3 px-5 py-4">
        {confidence.signals.filter((signal) => !isDisabled(signal)).map((signal, i) => (
          <div
            key={signal.key}
            title={signal.detail ?? undefined}
            className="animate-fade"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-white/65">
                <span
                  aria-hidden
                  className={`block h-[7px] w-[7px] shrink-0 ${SIGNAL_SHAPE[signal.status]}`}
                />
                <span className="truncate">{signal.label}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-white/45">
                {(signal.score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={`animate-bar h-full rounded-full ${SIGNAL_COLOR[signal.status]}`}
                style={{
                  width: `${Math.max(2, signal.score * 100)}%`,
                  animationDelay: `${180 + i * 70}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  );
}
