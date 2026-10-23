import { motion } from "motion/react";
import { ShieldX } from "lucide-react";
import type { GuardrailReport } from "../types/api";
import { Callout, EASE } from "./kit";

export function GuardrailBanner({ guardrail }: { guardrail: GuardrailReport }) {
  if (guardrail.passed) return null;

  return (
    <Callout icon={ShieldX} tone="danger" title="Blocked by guardrails">
      <ul className="mt-2 space-y-1.5">
        {guardrail.blocked_reasons.map((reason, i) => (
          <motion.li
            key={i}
            className="flex gap-2.5"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.15 + i * 0.06 }}
          >
            <span aria-hidden className="mt-[9px] block size-1 shrink-0 rounded-full bg-destructive" />
            <span className="min-w-0 text-danger-text">{reason}</span>
          </motion.li>
        ))}
      </ul>
      {guardrail.checks_run.length > 0 && (
        <p className="mt-3 border-t border-[rgb(var(--danger-rgb)/0.15)] pt-2.5 text-[11px] text-muted-foreground">
          <span className="eyebrow mr-2 !text-[10px]">Checks run</span>
          <span className="font-mono">{guardrail.checks_run.join(", ")}</span>
        </p>
      )}
    </Callout>
  );
}
