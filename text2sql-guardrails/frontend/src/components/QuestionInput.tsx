import { useState } from "react";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-px font-sans text-[10px] font-medium text-white/55">
      {children}
    </kbd>
  );
}

export function QuestionInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  };

  return (
    /* The command bar carries the brightest surface and the only large type on
       the screen: it is where every demo starts, so it should win the page
       before the response panels below it exist. The focus-within glow is the
       one piece of motion here that is functional rather than decorative --
       it confirms the caret landed in the box from across a room. */
    <div className="animate-rise rounded-2xl border border-white/[0.14] bg-[#131d33]/88 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_20px_48px_-28px_rgba(0,0,0,0.9)] transition duration-300 focus-within:border-blue-400/40 focus-within:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_0_0_1px_rgba(96,165,250,0.18),0_24px_60px_-28px_rgba(37,99,235,0.45)]">
      <label
        htmlFor="question"
        className="block px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45"
      >
        Ask a question about the database
      </label>

      <div className="px-5 pt-2.5">
        <textarea
          id="question"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Which students have an attendance percentage below 75%?"
          rows={2}
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-white placeholder:text-white/25 focus:outline-none"
        />
      </div>

      <div className="mt-1 flex items-center justify-between gap-4 border-t border-white/[0.07] px-5 py-3">
        <p className="text-[11px] text-white/35">
          <Key>Enter</Key> to run
          <span className="mx-1.5 text-white/20">·</span>
          <Key>Shift</Key>
          <span className="mx-0.5 text-white/25">+</span>
          <Key>Enter</Key> for a new line
        </p>
        <button
          onClick={submit}
          disabled={loading || !value.trim()}
          className="relative shrink-0 overflow-hidden rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition duration-200 before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:transition-transform before:duration-700 before:content-[''] hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1120] enabled:hover:-translate-y-px enabled:hover:shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)] enabled:hover:before:translate-x-full enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/25"
        >
          <span className="relative flex items-center gap-2">
            {loading && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            )}
            {loading ? "Running…" : "Run"}
          </span>
        </button>
      </div>
    </div>
  );
}
