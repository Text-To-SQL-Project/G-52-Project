import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { Eye, Gauge, Lock, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

const AiOrb = lazy(() => import("./AiOrb").then((m) => ({ default: m.AiOrb })));

const ORBIT = [
  { t: "AST guard", icon: ScanSearch, pos: "left-[-6%] top-[18%]", d: 0 },
  { t: "Read-only", icon: Lock, pos: "right-[-8%] top-[30%]", d: 0.8 },
  { t: "RLS scoped", icon: Eye, pos: "left-[2%] bottom-[16%]", d: 1.6 },
  { t: "Scored", icon: Gauge, pos: "right-[0%] bottom-[8%]", d: 2.4 },
];

type Status = "ready" | "loading" | "success" | "blocked" | "error";

/** The orb with its rings, orbiting dot and floating guard chips (landing hero + workspace engine). */
export function OrbStage({ status = "ready", className }: { status?: Status; className?: string }) {
  const alarm = status === "blocked" || status === "error";
  return (
    <div className={cn("orb-frame relative mx-auto aspect-square w-full", className)} data-status={status}>
      <div aria-hidden className="absolute inset-[6%] rounded-full border border-dashed border-border" />
      <motion.div
        aria-hidden
        className="absolute inset-[-2%] rounded-full border border-border"
        animate={{ rotate: 360 }}
        transition={{ duration: status === "loading" ? 6 : 60, repeat: Infinity, ease: "linear" }}
      >
        <span className={cn("absolute top-1/2 -left-1 size-2 rounded-full", alarm ? "bg-destructive shadow-[0_0_12px_var(--destructive)]" : "bg-brand shadow-[0_0_12px_var(--brand)]")} />
      </motion.div>
      <Suspense fallback={null}>
        <AiOrb status={status} className="h-full w-full" />
      </Suspense>
      {ORBIT.map(({ t, icon: Icon, pos, d }) => (
        <motion.span
          key={t}
          aria-hidden
          className={cn("absolute hidden items-center gap-1.5 rounded-full border border-border bg-card/85 px-2.5 py-1 font-mono text-[11px] text-soft shadow-[var(--shadow-lift)] backdrop-blur-md sm:inline-flex", pos)}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1, y: [0, -7, 0] }}
          transition={{ opacity: { delay: 1 + d * 0.2 }, scale: { delay: 1 + d * 0.2, type: "spring" }, y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: d } }}
        >
          <Icon className={cn("size-3", alarm ? "text-destructive" : "text-brand")} /> {t}
        </motion.span>
      ))}
    </div>
  );
}
