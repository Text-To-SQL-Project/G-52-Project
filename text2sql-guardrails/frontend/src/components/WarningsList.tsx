import type { Warning, WarningLevel } from "../types/api";

/** Warnings sit directly under the status chip and must not compete with it:
 * each level gets a left rule rather than a full bordered box, so a stack of
 * three warnings still reads as subordinate to the one state above them.
 * Sky/amber/red match the status palette, and level is also encoded in the
 * rule's opacity so the three are separable without colour. */
const LEVEL_STYLE: Record<WarningLevel, { wrap: string; rule: string; text: string }> = {
  info: { wrap: "bg-sky-400/[0.06]", rule: "bg-sky-400/50", text: "text-sky-100/80" },
  warning: { wrap: "bg-amber-400/[0.07]", rule: "bg-amber-400/70", text: "text-amber-100/85" },
  danger: { wrap: "bg-red-500/[0.09]", rule: "bg-red-400/90", text: "text-red-100/85" },
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
            style={{ animationDelay: `${i * 60}ms` }}
            className={`animate-rise flex items-stretch gap-3 overflow-hidden rounded-lg ${style.wrap}`}
          >
            <span aria-hidden className={`w-[3px] shrink-0 rounded-full ${style.rule}`} />
            <p className={`py-2 pr-3 text-[13px] leading-relaxed ${style.text}`}>
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
