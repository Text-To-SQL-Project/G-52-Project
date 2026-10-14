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

/** What each check measures, in plain words (keys from app/detection/). */
const SIGNAL_INFO: Record<string, string> = {
  schema_alignment: "Every table and column the SQL uses exists, and they match what your question talks about.",
  back_translation_match: "The SQL is translated back into English and compared with your question, to catch answering a different question.",
  result_sanity: "The rows look plausible: no unexpected empty result, all-empty columns or impossible values.",
  sql_validity: "The query parses cleanly and passed the read-only safety guardrail.",
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
  const tone = value >= 80 ? "var(--success)" : value >= 55 ? "var(--warning)" : "var(--destructive)";
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
              <Badge variant="brand" title="Plain weighted average of the checks; see 'How this score is calculated'.">uncalibrated</Badge>
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
              : confidence.capped
                ? "One check failed, so the score is capped at 40%. Review the generated SQL before relying on this result."
                : confidence.score >= 0.8
                  ? "The checks agree: the SQL uses the right tables, means what you asked, and returned plausible rows."
                  : confidence.score >= 0.55
                    ? "Mostly consistent, but at least one check is unsure. Glance at the SQL and the flagged check below."
                    : "Several checks disagree. Review the generated SQL or rephrase the question."}
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

        <details className="group/how rounded-lg border border-border px-4 py-3 text-xs">
          <summary className="cursor-pointer list-none font-medium text-soft marker:hidden hover:text-foreground">
            How this score is calculated <span aria-hidden className="ml-1 inline-block transition-transform group-open/how:rotate-90">›</span>
          </summary>
          <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground">
            <p>
              Four independent checks each score the answer from 0 to 100%. The overall score is their
              weighted average: each check's score × its weight, added up.
            </p>
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider">
                  <th className="py-1 font-medium">Check</th>
                  <th className="py-1 pl-3 text-right font-medium">Score</th>
                  <th className="py-1 pl-3 text-right font-medium">Weight</th>
                  <th className="py-1 pl-3 text-right font-medium">Adds</th>
                </tr>
              </thead>
              <tbody>
                {signals.filter((s) => s.weight != null).map((s) => (
                  <tr key={s.key} className="border-t border-border align-top" title={SIGNAL_INFO[s.key]}>
                    <td className="py-1.5 pr-2 font-sans text-soft">
                      {s.label}
                      <span className="block text-[11px] text-muted-foreground">{SIGNAL_INFO[s.key]}</span>
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{Math.round(s.score * 100)}%</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{Math.round(s.weight! * 100)}%</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-foreground">{(s.score * s.weight! * 100).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {confidence.capped && <p>A check failed outright, so the score is capped at 40% no matter how well the others did.</p>}
            <p>
              {confidence.calibrated
                ? "That average is then mapped through a calibration curve fitted on evaluated questions, so the number reads as the measured chance the answer is right."
                : "No calibration curve is applied: the one on file was fitted for a different model or setting, and reusing it would misstate this answer's accuracy. The number is the plain weighted average."}
            </p>
            <p>High is 80% and above, Medium 55–79%, Low below 55%. Hover a check for its detail.</p>
          </div>
        </details>
      </div>
    </Panel>
  );
}
