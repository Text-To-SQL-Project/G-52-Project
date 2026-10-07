import { ChevronDown, Timer } from "lucide-react";

const STAGES: { key: string; label: string; color: string }[] = [
  { key: "generation", label: "SQL generation", color: "var(--brand)" },
  { key: "guardrails", label: "Guardrails", color: "var(--chart-3)" },
  { key: "pre_checks", label: "Pre-execution checks", color: "var(--chart-5)" },
  { key: "execution", label: "Query execution", color: "var(--success)" },
  { key: "post_checks", label: "Result checks", color: "var(--chart-4)" },
  { key: "history", label: "Audit log", color: "var(--ghost)" },
];

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** Server-side wall time for one answer, split by pipeline stage. Native
 * <details> keeps it keyboard- and screen-reader-accessible for free. */
export function LatencyMeter({ timings }: { timings: Record<string, number> }) {
  const total = timings.total ?? 0;
  const stages = STAGES.filter((s) => (timings[s.key] ?? 0) > 0);
  if (!total) return null;

  return (
    <details className="latency group relative">
      <summary
        className="flex list-none items-center gap-2.5 rounded-lg border border-border bg-card/70 px-2.5 py-1.5 transition-colors hover:border-[rgb(var(--ink-rgb)/0.18)] hover:bg-hover [&::-webkit-details-marker]:hidden"
        aria-label={`Answered in ${fmt(total)}. Show timing breakdown.`}
      >
        <Timer aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-xs tabular-nums text-foreground">{fmt(total)}</span>
        <span aria-hidden className="flex h-1.5 w-24 gap-px overflow-hidden rounded-full bg-muted">
          {stages.map((s, i) => (
            <span
              key={s.key}
              className="animate-bar h-full origin-left"
              style={{ width: `${(timings[s.key] / total) * 100}%`, background: s.color, animationDelay: `${i * 60}ms` }}
            />
          ))}
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
      </summary>

      <div className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-xl border border-border bg-popover p-3.5 shadow-[var(--shadow-lift)] duration-200">
        <p className="eyebrow mb-2.5 !text-[10px]">Server time by stage</p>
        <ul className="space-y-2">
          {stages.map((s) => (
            <li key={s.key} className="text-xs">
              <div className="flex items-center gap-2">
                <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="text-soft">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-foreground">{fmt(timings[s.key])}</span>
              </div>
              <span aria-hidden className="mt-1 block h-px w-full bg-muted">
                <span className="animate-bar block h-px origin-left" style={{ width: `${(timings[s.key] / total) * 100}%`, background: s.color }} />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-snug text-muted-foreground">
          Back-translation runs after the answer is shown and isn't counted here.
        </p>
      </div>
    </details>
  );
}
