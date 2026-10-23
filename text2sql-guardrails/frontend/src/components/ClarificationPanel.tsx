import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, CircleHelp, CornerDownLeft } from "lucide-react";
import type { Clarification } from "../types/api";
import { Button } from "@/components/ui/button";
import { EASE } from "./kit";

interface Props {
  clarification: Clarification;
  /** The question being clarified; a custom answer is appended to it. */
  question: string;
  onSelect: (question: string) => void;
}

const MAX_QUESTION = 2000; // QueryRequest.question max_length

export function ClarificationPanel({ clarification, question, onSelect }: Props) {
  const [custom, setCustom] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const options = clarification.options;
  const submitCustom = () => {
    const answer = custom.trim();
    if (answer) onSelect(`${question}\nClarification: ${answer}`.slice(0, MAX_QUESTION));
  };

  // Number keys pick an option, like a chat multiple-choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The workspace stays mounted (hidden) behind other screens: only act while visible.
      if (e.ctrlKey || e.metaKey || e.altKey || !root.current?.offsetParent) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < options.length) onSelect(options[i].question);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onSelect]);

  return (
    <motion.div
      ref={root}
      className="panel crop crop-brand overflow-hidden"
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <div className="flex items-start gap-3.5 border-b border-border bg-[linear-gradient(90deg,rgb(var(--brand-rgb)/0.06),transparent_60%)] px-5 py-4 sm:px-6">
        <motion.span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-[rgb(var(--brand-rgb)/0.3)] bg-[rgb(var(--brand-rgb)/0.1)] text-brand"
          initial={{ rotate: -30, scale: 0.6 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 15, delay: 0.1 }}
        >
          <CircleHelp className="size-4" />
        </motion.span>
        <div className="min-w-0">
          <p className="eyebrow eyebrow-brand !text-[10px]">A quick question first</p>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug text-foreground">{clarification.reason}</h3>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {options.length > 0 && (
          <motion.div
            className="grid gap-2.5 sm:grid-cols-2"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } }}
          >
            {options.map((option, i) => (
              <motion.button
                key={i}
                type="button"
                onClick={() => onSelect(option.question)}
                variants={{ hidden: { opacity: 0, y: 12, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE } } }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="spotlight group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors duration-200 hover:border-[rgb(var(--brand-rgb)/0.45)]"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-muted font-mono text-[11px] text-soft transition-colors group-hover:border-[rgb(var(--brand-rgb)/0.5)] group-hover:bg-brand group-hover:text-brand-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {option.label}
                    <ArrowRight aria-hidden className="nudge size-3.5 text-brand opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{option.description}</span>
                  )}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitCustom();
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={options.length ? "Something else? Type your own answer…" : "Add the missing detail…"}
            aria-label="Your own answer"
            maxLength={500}
            className="h-10 min-w-0 flex-1 rounded-xl border border-dashed border-border bg-transparent px-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus:border-solid focus:border-[rgb(var(--brand-rgb)/0.5)] focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1)]"
          />
          <Button type="submit" disabled={!custom.trim()} variant="brand" className="h-10 rounded-xl">
            Ask <CornerDownLeft />
          </Button>
        </form>
        {options.length > 0 && (
          <p className="mt-2.5 hidden text-[11px] text-muted-foreground sm:block">
            Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">1</kbd>–
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">{options.length}</kbd> to choose.
          </p>
        )}
      </div>
    </motion.div>
  );
}
