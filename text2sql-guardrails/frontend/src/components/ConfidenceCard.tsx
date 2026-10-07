import { motion } from "motion/react";
import { Gauge } from "lucide-react";
import { useTweened } from "../hooks/useTweened";
import type { Confidence, ConfidenceSignal, SignalStatus } from "../types/api";
import { Badge } from "@/components/ui/badge";
import { EASE, Panel } from "./kit";

function isDisabled(signal: ConfidenceSignal): boolean {
  return !!signal.detail && signal.detail.toLowerCase().includes("disabled");
}

const SIGNAL_COLOR: Record<SignalStatus, string> = {
  pass: "var(--success)",
  warn: "var(--warning)",
  fail: "var(--destructive)",
  pending: "var(--muted-foreground)",
};

const LABEL_VARIANT: Record<string, "success" | "warning" | "danger"> = {
  High: "success",
  Medium: "warning",
  Low: "danger",
};

/** Status is never colour alone: pass is a disc, warn a square, fail a diamond, pending a ring. */
function SignalMark({ status }: { status: SignalStatus }) {
  const shape = {
    pass: "rounded-full",
    warn: "rounded-[2px]",
    fail: "rotate-45 rounded-[1px]",
    pending: "rounded-full bg-transparent ring-1 ring-inset ring-muted-foreground",
  }[status];
  return (
    <span
      aria-hidden
      className={`block size-[7px] shrink-0 transition-all duration-300 ${shape}`}
      style={status === "pending" ? undefined : { background: SIGNAL_COLOR[status] }}
    />
  );
}

/** 270° dial: 40 ticks light up to the score, an arc traces it. */
function Dial({ value, shown }: { value: number; shown: number }) {
  const TICKS = 40;
  const lit = Math.round((value / 100) * TICKS);
  const tone = value >= 85 ? "var(--success)" : value >= 65 ? "var(--warning)" : "var(--destructive)";
  const r = 42;
  const arc = 2 * Math.PI * r * 0.75;
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full rotate-[135deg]" aria-hidden>
        {Array.from({ length: TICKS }, (_, i) => {
          const a = (i / (TICKS - 1)) * 270 * (Math.PI / 180);
          const on = i < lit;
          return (
            <motion.line
              key={i}
              x1={60 + Math.cos(a) * 53}
              y1={60 + Math.sin(a) * 53}
              x2={60 + Math.cos(a) * (i % 5 === 0 ? 47 : 49.5)}
              y2={60 + Math.sin(a) * (i % 5 === 0 ? 47 : 49.5)}
              strokeWidth={i % 5 === 0 ? 1.6 : 1}
              strokeLinecap="round"
              initial={{ stroke: "rgb(var(--ink-rgb) / 0.12)" }}
              animate={{ stroke: on ? tone : "rgb(var(--ink-rgb) / 0.12)" }}
              transition={{ duration: 0.25, delay: on ? 0.15 + i * 0.018 : 0 }}
            />
          );
        })}
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--ink-rgb) / 0.07)" strokeWidth="5" strokeDasharray={`${arc} 999`} strokeLinecap="round" />
        <motion.circle
          cx="60" cy="60" r={r}
          fill="none"
          stroke={tone}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${arc} 999`}
          initial={{ strokeDashoffset: arc }}
          animate={{ strokeDashoffset: arc * (1 - value / 100) }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
          style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${tone} 45%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl leading-none tabular-nums text-foreground">
          {shown}
          <span className="ml-0.5 align-top font-sans text-sm font-normal text-muted-foreground">%</span>
        </span>
        <span className="eyebrow mt-1.5 !text-[9px]">confidence</span>
      </div>
    </div>
  );
}

export function ConfidenceCard({ confidence }: { confidence: Confidence | null | undefined }) {
  const target = confidence ? Math.round(confidence.score * 100) : 0;
  const shown = Math.round(useTweened(target, 1100, 0));

  if (!confidence) {
    return (
      <Panel icon={Gauge} title="Confidence Score" tone="muted">
        <p className="py-6 text-center text-sm text-muted-foreground">Not scored — query was not executed.</p>
      </Panel>
    );
  }

  const pending = confidence.signals.filter((s) => s.status === "pending");
  const signals = confidence.signals.filter((s) => !isDisabled(s));

  return (
    <Panel
      icon={Gauge}
      title="Confidence Assessment"
      meta={
        <>
          {pending.length > 0 ? (
            <span
              role="status"
              className="relative overflow-hidden rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-soft"
              title="Back-translation runs after your results are shown, so it doesn't add to response time."
            >
              verifying {pending.length} check{pending.length > 1 ? "s" : ""}
              <span aria-hidden className="animate-sweep absolute bottom-0 left-0 h-px w-1/3 bg-brand" />
            </span>
          ) : (
            !confidence.calibrated && (
              <Badge variant="brand" title="Hand-tuned weights, not yet learned + isotonic calibrated.">uncalibrated</Badge>
            )
          )}
          <Badge variant={LABEL_VARIANT[confidence.label] ?? "muted"} className="font-sans text-xs">
            {confidence.label} Confidence
          </Badge>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-dashed border-border pb-6">
          <Dial value={target} shown={shown} />
          <p className="min-w-[12rem] flex-1 text-sm leading-relaxed text-soft">
            {pending.length > 0
              ? "Provisional score. Results are final; the remaining check refines this number when it finishes."
              : confidence.score >= 0.85
                ? "High confidence in schema alignment, AST safety, and semantic intent."
                : confidence.score >= 0.65
                  ? "Moderate confidence. Check schema mapping and join conditions."
                  : "Low confidence. Review generated SQL or clarify query phrasing."}
          </p>
        </div>

        <div className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
          {signals.map((signal, i) => (
            <motion.div
              key={signal.key}
              title={signal.detail ?? undefined}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.1 + i * 0.06 }}
              className="group"
            >
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-soft transition-colors group-hover:text-foreground">
                  <SignalMark status={signal.status} />
                  <span className="truncate">{signal.label}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {signal.status === "pending" ? "measuring" : `${(signal.score * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                {signal.status === "pending" ? (
                  <div aria-hidden className="animate-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-muted-foreground to-transparent" />
                ) : (
                  <motion.div
                    className="h-full origin-left rounded-full"
                    style={{ width: `${Math.max(2, signal.score * 100)}%`, background: SIGNAL_COLOR[signal.status] }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.9, ease: EASE, delay: 0.2 + i * 0.07 }}
                  />
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
