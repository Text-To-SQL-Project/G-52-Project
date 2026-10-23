import type { ComponentProps, ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared easing for everything that moves: fast out, long settle. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Brand mark: crop brackets around a vermilion "guarded cell". */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      className={cn(
        "group/logo relative inline-grid shrink-0 place-items-center rounded-[9px] border border-border bg-card shadow-[var(--shadow-lift)]",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="size-[78%]">
        <path
          d="M8.5 14V8.5H14M23.5 18v5.5H18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover/logo:[transform:scale(1.08)] [transform-origin:16px_16px]"
        />
        <rect
          x="12.5" y="12.5" width="7" height="7" rx="1.6"
          className="fill-brand transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover/logo:[transform:rotate(90deg)] [transform-origin:16px_16px]"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[17px] font-semibold tracking-[-0.03em] text-foreground", className)}>
      SQL<span className="text-brand">.</span>AI <span className="font-normal text-muted-foreground">Guardrails</span>
    </span>
  );
}

/** Fades + rises + unblurs into view once, when scrolled to. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const M = motion[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE } },
};

/** A list whose children cascade in on mount. Children should be <StaggerItem>. */
export function Stagger({ children, className, ...rest }: ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={staggerParent} initial="hidden" animate="show" className={className} {...rest}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className, ...rest }: ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={staggerChild} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

/** Small square icon well used in panel headers and lists. */
export function IconChip({ icon: Icon, tone = "brand", className }: { icon: LucideIcon; tone?: "brand" | "muted" | "success" | "danger"; className?: string }) {
  const tones = {
    brand: "text-brand border-[rgb(var(--brand-rgb)/0.25)] bg-[rgb(var(--brand-rgb)/0.08)]",
    muted: "text-soft border-border bg-muted",
    success: "text-success border-[rgb(var(--success-rgb)/0.25)] bg-[rgb(var(--success-rgb)/0.08)]",
    danger: "text-danger-text border-[rgb(var(--danger-rgb)/0.3)] bg-[rgb(var(--danger-rgb)/0.08)]",
  };
  return (
    <span aria-hidden className={cn("inline-grid size-7 shrink-0 place-items-center rounded-md border", tones[tone], className)}>
      <Icon className="size-3.5" strokeWidth={2} />
    </span>
  );
}

/** Header for every signed-in screen: section index, display title, lede, actions. */
export function PageHeader({
  index,
  eyebrow,
  title,
  lede,
  actions,
  onBack,
}: {
  onBack?: () => void;
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="relative pb-6">
      {onBack && (
        <button type="button" onClick={onBack} className="press mb-4 inline-flex min-h-8 items-center gap-1.5 text-sm text-soft hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to workspace
        </button>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <motion.p
            className="eyebrow flex items-center gap-2"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <span className="text-brand">{index}</span>
            <span aria-hidden className="h-px w-6 bg-border" />
            {eyebrow}
          </motion.p>
          <motion.h1
            className="font-display mt-3 text-[clamp(1.9rem,4vw,2.9rem)] leading-[0.98] text-foreground text-balance"
            initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.05 }}
          >
            {title}
          </motion.h1>
          {lede && (
            <motion.p
              className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
            >
              {lede}
            </motion.p>
          )}
        </div>
        {actions && (
          <motion.div
            className="flex flex-wrap items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.16 }}
          >
            {actions}
          </motion.div>
        )}
      </div>
      <motion.div
        aria-hidden
        className="ticks absolute inset-x-0 bottom-0 origin-left opacity-70"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
      />
    </header>
  );
}

/** The standard surface: card with a titled header row and spotlight hover. */
export function Panel({
  icon,
  title,
  meta,
  children,
  className,
  bodyClassName,
  id,
  tone,
  ...rest
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  tone?: "brand" | "muted" | "success" | "danger";
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("panel spotlight overflow-hidden", className)} {...rest}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <IconChip icon={icon} tone={tone} />}
            <h2 id={id} className="truncate text-[13px] font-semibold tracking-tight text-foreground">
              {title}
            </h2>
          </div>
          {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      )}
      <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Callout used by error / forbidden / guardrail / clarification states. */
export function Callout({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon;
  tone: "danger" | "muted" | "brand" | "warning";
  title: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    danger: { bar: "bg-destructive", icon: "text-danger-text bg-[rgb(var(--danger-rgb)/0.1)] border-[rgb(var(--danger-rgb)/0.3)]", title: "text-danger-text", wash: "rgb(var(--danger-rgb) / 0.05)" },
    muted: { bar: "bg-muted-foreground", icon: "text-soft bg-muted border-border", title: "text-foreground", wash: "rgb(var(--ink-rgb) / 0.02)" },
    brand: { bar: "bg-brand", icon: "text-brand bg-[rgb(var(--brand-rgb)/0.1)] border-[rgb(var(--brand-rgb)/0.3)]", title: "text-foreground", wash: "rgb(var(--brand-rgb) / 0.04)" },
    warning: { bar: "bg-warning", icon: "text-warning bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border-[color-mix(in_srgb,var(--warning)_30%,transparent)]", title: "text-foreground", wash: "color-mix(in srgb, var(--warning) 5%, transparent)" },
  }[tone];
  return (
    <motion.div
      className="panel relative overflow-hidden"
      style={{ backgroundImage: `linear-gradient(90deg, ${tones.wash}, transparent 60%)` }}
      initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <motion.span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px] origin-top", tones.bar)}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
      />
      <div className="flex items-start gap-3.5 px-5 py-4 sm:px-6">
        <span aria-hidden className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border", tones.icon)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn("text-sm font-semibold", tones.title)}>{title}</h2>
          {children && <div className="mt-1 text-sm leading-relaxed text-soft">{children}</div>}
        </div>
      </div>
    </motion.div>
  );
}
