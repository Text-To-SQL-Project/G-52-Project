import type { Warning, WarningLevel } from "../types/api";

const LEVEL_STYLE: Record<WarningLevel, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function WarningsList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`rounded-lg border px-3 py-2 text-xs ${LEVEL_STYLE[w.level]}`}
        >
          {w.message}
          {w.source && <span className="ml-1.5 opacity-60">— {w.source}</span>}
        </div>
      ))}
    </div>
  );
}
