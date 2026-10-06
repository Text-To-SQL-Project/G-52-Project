const STAGES: { key: string; label: string; color: string }[] = [
  { key: "generation", label: "SQL generation", color: "var(--accent)" },
  { key: "guardrails", label: "Guardrails", color: "var(--text-secondary)" },
  { key: "pre_checks", label: "Pre-execution checks", color: "var(--text-secondary)" },
  { key: "execution", label: "Query execution", color: "var(--success)" },
  { key: "post_checks", label: "Result checks", color: "var(--text-secondary)" },
  { key: "history", label: "Audit log", color: "var(--text-muted)" },
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
        className="flex cursor-pointer list-none items-center gap-2.5 rounded-[2px] px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]"
        aria-label={`Answered in ${fmt(total)}. Show timing breakdown.`}
      >
        <span className="font-mono text-xs tabular-nums" style={{ color: "var(--text-primary)" }}>
          {fmt(total)}
        </span>
        <span aria-hidden className="flex h-1 w-24 overflow-hidden rounded-[1px]" style={{ background: "var(--border-subtle)" }}>
          {stages.map((s) => (
            <span
              key={s.key}
              className="animate-bar h-full"
              style={{ width: `${(timings[s.key] / total) * 100}%`, background: s.color }}
            />
          ))}
        </span>
        <span
          aria-hidden
          className="material-symbols-outlined text-[16px] transition-transform duration-200 group-open:rotate-180"
          style={{ color: "var(--text-muted)" }}
        >
          expand_more
        </span>
      </summary>

      <div
        className="animate-fade absolute right-0 z-20 mt-2 w-64 p-3"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-hairline)",
          borderRadius: "8px",
          boxShadow: "0 12px 32px rgb(var(--shadow-rgb) / 0.35)",
        }}
      >
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Server time by stage
        </p>
        <ul className="space-y-1.5">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: s.color }} />
              <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
              <span className="ml-auto font-mono tabular-nums" style={{ color: "var(--text-primary)" }}>
                {fmt(timings[s.key])}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 pt-2 text-[11px] leading-snug" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}>
          Back-translation runs after the answer is shown and isn't counted here.
        </p>
      </div>
    </details>
  );
}
