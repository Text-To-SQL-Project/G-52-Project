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

const LABEL_COLOR: Record<string, string> = {
  High: "text-emerald-400",
  Medium: "text-amber-400",
  Low: "text-red-400",
};

export function ConfidenceCard({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-1 text-sm font-medium text-white/70">Confidence</h3>
        <p className="py-2 text-sm text-white/30">Not scored — query was not executed.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white/70">Confidence</h3>
        <div className="flex items-center gap-2">
          {!confidence.calibrated && (
            <span
              className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40"
              title="Hand-tuned weights, not yet learned + isotonic calibrated."
            >
              uncalibrated
            </span>
          )}
          <span className={`text-sm font-semibold ${LABEL_COLOR[confidence.label] ?? "text-white"}`}>
            {confidence.label}
          </span>
          <span className="text-xs text-white/40">{(confidence.score * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="space-y-2.5">
        {confidence.signals.filter((signal) => !isDisabled(signal)).map((signal) => (
          <div key={signal.key} title={signal.detail ?? undefined}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/60">{signal.label}</span>
              <span className="font-mono text-white/40">{(signal.score * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${SIGNAL_COLOR[signal.status]} transition-all`}
                style={{ width: `${Math.max(2, signal.score * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
