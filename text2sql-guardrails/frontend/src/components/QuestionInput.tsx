import { useState } from "react";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
  isAdmin?: boolean;
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] font-medium text-white/60">
      {children}
    </kbd>
  );
}

const DEFAULT_SAMPLE_QUERIES = [
  "Which students have attendance below 75%?",
  "List average GPA by department",
  "Find faculty members teaching more than 2 courses",
  "Show enrollment counts by semester",
];

const ADMIN_SAMPLE_QUERIES = [
  "Which students have attendance below 75%?",
  "List average GPA by department",
  "Create table audit_log (id int, note text)",
  "Delete from attendance where status = 'absent'",
];

export function QuestionInput({ onSubmit, loading, isAdmin = false }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  };

  const handleSelectSample = (query: string) => {
    setValue(query);
  };

  const sampleQueries = isAdmin ? ADMIN_SAMPLE_QUERIES : DEFAULT_SAMPLE_QUERIES;

  return (
    <div className="glass-card animate-rise relative flex flex-col rounded-2xl p-6 transition-all duration-300 focus-within:border-indigo-400/40 focus-within:shadow-[0_0_30px_rgba(99,102,241,0.2)]">
      {/* Decorative top-left highlight */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent" />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white md:text-xl">
          {isAdmin ? "Admin Console — Full DB Access" : "Ask anything about your data..."}
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="pill-tag flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px]">
            <span className="material-symbols-outlined text-[13px]">database</span>
            college_erp
          </span>
          {isAdmin ? (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
              <span className="material-symbols-outlined text-[13px]">admin_panel_settings</span>
              Admin: Full Access (Guardrails Bypassed)
            </span>
          ) : (
            <span className="pill-tag-indigo flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px]">
              <span className="material-symbols-outlined text-[13px]">verified_user</span>
              Guardrails Active
            </span>
          )}
        </div>
      </div>

      <div className="relative my-1 flex-1">
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
          placeholder="e.g. Which students have an attendance percentage below 75% across departments?"
          rows={3}
          className="w-full resize-none bg-transparent font-sans text-[15px] leading-relaxed text-white placeholder:text-white/30 focus:outline-none"
        />
      </div>

      {/* Suggested quick prompt chips */}
      <div className="mt-1 mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-white/40">Try:</span>
        {sampleQueries.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handleSelectSample(q)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-left font-sans text-xs text-white/60 transition duration-150 hover:border-indigo-400/40 hover:bg-white/[0.08] hover:text-white"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] pt-3.5">
        <p className="flex items-center gap-1 text-[11px] text-white/40">
          <Key>Enter</Key> <span>to run</span>
          <span className="mx-1 text-white/20">·</span>
          <Key>Shift</Key> <span className="text-white/30">+</span> <Key>Enter</Key> <span>new line</span>
        </p>

        <button
          onClick={submit}
          disabled={loading || !value.trim()}
          className="glow-button flex items-center gap-2 rounded-xl px-6 py-2.5 font-sans text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span>Checking &amp; Generating…</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              <span>Run Query</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
