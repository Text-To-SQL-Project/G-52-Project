import type { Warning, WarningLevel } from "../types/api";

const LEVEL_STYLE: Record<WarningLevel, { borderColor: string; bg: string; text: string }> = {
  info: { borderColor: "rgba(56, 189, 248, 0.5)", bg: "rgba(56, 189, 248, 0.03)", text: "rgba(56, 189, 248, 0.8)" },
  warning: { borderColor: "rgba(251, 191, 36, 0.6)", bg: "rgba(251, 191, 36, 0.04)", text: "rgba(251, 191, 36, 0.85)" },
  danger: { borderColor: "rgba(248, 113, 113, 0.7)", bg: "rgba(248, 113, 113, 0.05)", text: "rgba(248, 113, 113, 0.85)" },
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
