import { motion } from "motion/react";
import { Info, TriangleAlert, OctagonAlert } from "lucide-react";
import type { Warning, WarningLevel } from "../types/api";
import { EASE } from "./kit";

const LEVEL: Record<WarningLevel, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "border-border bg-muted/60 text-soft" },
  warning: { icon: TriangleAlert, cls: "border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_7%,transparent)] text-warning" },
  danger: { icon: OctagonAlert, cls: "border-[rgb(var(--danger-rgb)/0.35)] bg-[rgb(var(--danger-rgb)/0.06)] text-danger-text" },
};

export function WarningsList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.map((w, i) => {
        const { icon: Icon, cls } = LEVEL[w.level];
        return (
          <motion.div
            key={i}
            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${cls}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: i * 0.06 }}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              {w.message}
              {w.source && <span className="ml-1.5 font-mono text-[11px] opacity-70">— {w.source}</span>}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
