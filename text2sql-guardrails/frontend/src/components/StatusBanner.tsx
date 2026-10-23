import { motion } from "motion/react";
import { Ban, CircleCheck, CircleHelp, ShieldX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { QueryStatus } from "../types/api";
import { cn } from "@/lib/utils";
import { EASE } from "./kit";

const STATUS: Record<QueryStatus, { label: string; icon: LucideIcon; cls: string; dot: string }> = {
  success: {
    label: "Success",
    icon: CircleCheck,
    cls: "border-[rgb(var(--success-rgb)/0.35)] bg-[rgb(var(--success-rgb)/0.08)] text-success",
    dot: "var(--success)",
  },
  refused: {
    label: "Refused — destructive operation",
    icon: Ban,
    cls: "border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] text-warning",
    dot: "var(--warning)",
  },
  clarification: {
    label: "Needs clarification",
    icon: CircleHelp,
    cls: "border-[rgb(var(--brand-rgb)/0.35)] bg-[rgb(var(--brand-rgb)/0.08)] text-brand",
    dot: "var(--brand)",
  },
  blocked: {
    label: "Blocked by guardrail",
    icon: ShieldX,
    cls: "border-[rgb(var(--danger-rgb)/0.4)] bg-[rgb(var(--danger-rgb)/0.08)] text-danger-text",
    dot: "var(--destructive)",
  },
  error: {
    label: "Error",
    icon: TriangleAlert,
    cls: "border-border bg-muted text-soft",
    dot: "var(--muted-foreground)",
  },
};

interface Props {
  status: QueryStatus;
  reason?: string | null;
  size?: "sm" | "md";
}

export function StatusBanner({ status, reason, size = "md" }: Props) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <div className="min-w-0">
      <motion.span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-medium tracking-[-0.01em]",
          size === "md" ? "px-3 py-1 text-[13px]" : "px-2.5 py-0.5 text-xs",
          s.cls,
        )}
        initial={{ opacity: 0, scale: 0.9, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <motion.span
          aria-hidden
          initial={{ rotate: -90, scale: 0.4 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.08 }}
          className="inline-flex"
        >
          <Icon className={size === "md" ? "size-3.5" : "size-3"} strokeWidth={2.2} />
        </motion.span>
        {s.label}
      </motion.span>
      {reason && (
        <motion.p
          className="mt-2 max-w-prose text-sm leading-relaxed text-soft"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.12 }}
        >
          {reason}
        </motion.p>
      )}
    </div>
  );
}
