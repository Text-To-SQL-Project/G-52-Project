import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, CornerDownLeft, Database, Globe, GraduationCap, Loader2, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import type { UserRole } from "../types/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EASE } from "./kit";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
  isAdmin?: boolean;
  role?: UserRole;
}

// Guests see reference tables only (no personal rows), so these stick to them.
export const GUEST_SAMPLE_QUERIES = [
  "How many programs does each department offer?",
  "Which library book categories have the most titles?",
  "List the highest-paying placement drives",
  "How many credits are subjects in semester 3?",
];

export const STUDENT_SAMPLE_QUERIES = [
  "What are my marks in each subject?",
  "Show my attendance percentage",
  "What is my fee payment history?",
  "Which departments have the most students?",
];

export const FACULTY_SAMPLE_QUERIES = [
  "What is the average marks obtained per subject?",
  "Which students have attendance below 75%?",
  "List average GPA by department",
  "Which departments have the most students?",
];

export const ADMIN_SAMPLE_QUERIES = [
  "Which departments have the most students?",
  "List average GPA by department",
  "What is the average marks obtained per subject?",
  "Which companies have made the most accepted placement offers?",
];

const SCOPE = {
  admin: { title: "All records, read-only", badge: "Admin · all records, read-only", icon: ShieldCheck },
  guest: { title: "Public college data", badge: "Reference data only", icon: Globe },
  faculty: { title: "Your department's data", badge: "Faculty scope", icon: GraduationCap },
  student: { title: "Your own records", badge: "Student scope", icon: UserRound },
} as const;

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-border bg-muted px-1 font-mono text-[10px] font-medium text-soft shadow-[0_1px_0_rgb(var(--ink-rgb)/0.08)]">
      {children}
    </kbd>
  );
}

export function QuestionInput({ onSubmit, loading, isAdmin = false, role }: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [hint, setHint] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scopeKey = isAdmin ? "admin" : role === "guest" ? "guest" : role === "faculty" ? "faculty" : role === "student" ? "student" : "admin";
  const scope = SCOPE[scopeKey];
  const ScopeIcon = scope.icon;
  const samples =
    role === "guest" ? GUEST_SAMPLE_QUERIES
      : role === "student" ? STUDENT_SAMPLE_QUERIES
        : role === "faculty" ? FACULTY_SAMPLE_QUERIES
          : ADMIN_SAMPLE_QUERIES;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  };

  const pickSample = (q: string) => {
    setValue(q);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(q.length, q.length);
    });
  };

  // Keyboard: "/" jumps to the question box (unless typing elsewhere), Esc leaves it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !t.closest("input, textarea, select, [contenteditable]")) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && t === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The placeholder cycles through this role's example questions.
  useEffect(() => {
    if (value || focused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setHint((h) => (h + 1) % samples.length), 3400);
    return () => window.clearInterval(t);
  }, [value, focused, samples.length]);

  const canRun = !!value.trim() && !loading;

  return (
    <div className="relative flex flex-col">
      {/* Greeting */}
      <div className="mb-6">
        <motion.p
          className="eyebrow flex flex-wrap items-center gap-2"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <span className="text-brand">§ 01</span>
          <span aria-hidden className="h-px w-6 bg-border" />
          Workspace
          <span aria-hidden className="text-ghost">/</span>
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-soft">
            <ScopeIcon aria-hidden className="size-3.5 text-brand" />
            {scope.badge}
          </span>
        </motion.p>
        <motion.h1
          className="font-display mt-3 text-[clamp(2rem,4.6vw,3.4rem)] leading-[0.95] text-foreground text-balance"
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.05 }}
        >
          Ask in plain English. <span className="text-muted-foreground">Get guarded SQL</span>
          <span className="mark-brand">.</span>
        </motion.h1>
        <motion.p
          className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
        >
          Scoped to <span className="font-medium text-soft">{scope.title.toLowerCase()}</span>. Every query is parsed,
          checked and scored before a single row comes back.
        </motion.p>
      </div>

      {role === "guest" && (
        <motion.p
          className="mb-4 max-w-2xl rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs leading-relaxed text-soft"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
        >
          You're signed in as a guest. You can explore departments, programmes, subjects, the library catalogue and
          placements. Personal records (marks, attendance, fees) stay private: ask an administrator to link your
          account to your student or faculty record to see your own.
        </motion.p>
      )}

      {/* Composer */}
      <motion.div
        className={cn(
          "panel crop group/composer relative transition-[border-color,box-shadow] duration-500",
          focused && "border-[rgb(var(--brand-rgb)/0.45)] shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1),var(--shadow-lift)]",
        )}
        style={{ "--crop-color": focused ? "rgb(var(--brand-rgb) / 0.9)" : undefined } as React.CSSProperties}
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
      >
        <div className="relative px-5 pt-4 sm:px-6">
          <label htmlFor="question" className="sr-only">Ask a question about the college database</label>
          <textarea
            ref={inputRef}
            id="question"
            maxLength={2000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={2}
            className="block max-h-64 min-h-[4.5rem] w-full resize-none bg-transparent text-[clamp(1rem,2vw,1.15rem)] leading-relaxed text-foreground outline-none [field-sizing:content] focus-visible:outline-none"
          />
          {/* Animated placeholder: one example at a time, rolling upward. */}
          {!value && (
            <div aria-hidden className="pointer-events-none absolute inset-x-5 top-4 overflow-hidden sm:inset-x-6">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={hint}
                  className="truncate text-[clamp(1rem,2vw,1.15rem)] leading-relaxed text-muted-foreground"
                  initial={{ y: "100%", opacity: 0, filter: "blur(4px)" }}
                  animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                  exit={{ y: "-100%", opacity: 0, filter: "blur(4px)" }}
                  transition={{ duration: 0.5, ease: EASE }}
                >
                  {samples[hint % samples.length]}
                </motion.p>
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-soft">
              <Database aria-hidden className="size-3" /> college_erp
            </span>
            <span className="hidden items-center gap-1 sm:inline-flex"><Key><CornerDownLeft className="size-3" /></Key> run</span>
            <span className="hidden items-center gap-1 sm:inline-flex"><Key>⇧</Key><Key><CornerDownLeft className="size-3" /></Key> new line</span>
            <span className="hidden items-center gap-1 md:inline-flex"><Key>/</Key> focus</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("font-mono text-[10px] tabular-nums transition-opacity", value.length ? "opacity-100 text-muted-foreground" : "opacity-0")}>
              {value.length}/2000
            </span>
            <Button
              onClick={submit}
              disabled={!canRun}
              variant="brand"
              data-magnetic="0.18"
              className="group h-9 rounded-lg px-4"
            >
              <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                  <motion.span key="l" className="inline-flex items-center gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                    <Loader2 className="animate-spin" /> Checking &amp; Generating…
                  </motion.span>
                ) : (
                  <motion.span key="r" className="inline-flex items-center gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                    Run Query
                    <span className="grid size-5 place-items-center rounded-md bg-[rgb(0_0_0/0.15)] transition-transform duration-300 group-hover:-translate-y-0.5">
                      <ArrowUp className="size-3.5" strokeWidth={2.5} />
                    </span>
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Sample questions */}
      <motion.div
        className="mt-4 flex flex-wrap items-center gap-2"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.35 } } }}
      >
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles aria-hidden className="size-3 text-brand" /> Try
        </span>
        {samples.map((q) => (
          <motion.button
            key={q}
            type="button"
            onClick={() => pickSample(q)}
            variants={{ hidden: { opacity: 0, y: 8, scale: 0.97 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } } }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="rounded-full border border-border bg-card/70 px-3 py-1 text-left text-xs text-soft backdrop-blur-sm transition-colors duration-200 hover:border-[rgb(var(--brand-rgb)/0.4)] hover:bg-[rgb(var(--brand-rgb)/0.06)] hover:text-foreground"
          >
            {q}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
