import type { Warning, WarningLevel } from "../types/api";

const LEVEL_STYLE: Record<WarningLevel, { borderColor: string; bg: string; text: string }> = {
  info: { borderColor: "rgb(var(--ink-rgb) / 0.25)", bg: "rgb(var(--ink-rgb) / 0.025)", text: "var(--text-secondary)" },
  warning: { borderColor: "rgb(var(--accent-bright-rgb) / 0.6)", bg: "rgb(var(--accent-bright-rgb) / 0.04)", text: "rgb(var(--accent-bright-rgb) / 0.85)" },
  danger: { borderColor: "rgb(var(--danger-soft-rgb) / 0.7)", bg: "rgb(var(--danger-soft-rgb) / 0.05)", text: "rgb(var(--danger-soft-rgb) / 0.85)" },
};

export function WarningsList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {warnings.map((w, i) => {
        const style = LEVEL_STYLE[w.level];
        return (
          <div
            key={i}
            style={{
              animationDelay: `${i * 60}ms`,
              borderLeft: `2px solid ${style.borderColor}`,
              background: style.bg,
              padding: "8px 12px",
            }}
            className="animate-rise"
          >
            <p className="text-[13px] leading-relaxed" style={{ color: style.text }}>
              {w.message}
              {w.source && (
                <span className="ml-1.5 font-mono text-[11px] opacity-55">— {w.source}</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
