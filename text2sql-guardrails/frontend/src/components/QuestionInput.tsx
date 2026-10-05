import { useState, useRef, useEffect } from "react";
import { gsap } from "gsap";
import type { UserRole } from "../types/api";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
  isAdmin?: boolean;
  role?: UserRole;
}

function Key({ children }: { children: string }) {
  return (
    <kbd
      className="font-mono text-[10px] font-medium"
      style={{
        padding: "2px 6px",
        border: "1px solid var(--border-hairline)",
        background: "rgb(var(--ink-rgb) / 0.03)",
        color: "var(--text-secondary)",
        borderRadius: "2px",
      }}
    >
      {children}
    </kbd>
  );
}

const STUDENT_SAMPLE_QUERIES = [
  "What are my marks in each subject?",
  "Show my attendance percentage",
  "What is my fee payment history?",
  "Which departments have the most students?",
];

const FACULTY_SAMPLE_QUERIES = [
  "What is the average marks obtained per subject?",
  "Which students have attendance below 75%?",
  "List average GPA by department",
  "Which departments have the most students?",
];

const ADMIN_SAMPLE_QUERIES = [
  "Which departments have the most students?",
  "List average GPA by department",
  "What is the average marks obtained per subject?",
  "Which companies have made the most accepted placement offers?",
];

export function QuestionInput({ onSubmit, loading, isAdmin = false, role }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const underlineRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  };

  const handleSelectSample = (query: string) => {
    setValue(query);
  };

  // Magnetic button effect
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;

    const onMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, {
        x: x * 0.2,
        y: y * 0.2,
        duration: 0.3,
        ease: "power2.out",
      });
    };

    const onLeave = () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" });
    };

    btn.addEventListener("mousemove", onMove);
    btn.addEventListener("mouseleave", onLeave);
    return () => {
      btn.removeEventListener("mousemove", onMove);
      btn.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // Animated underline on focus
  const handleFocus = () => {
    gsap.to(underlineRef.current, {
      scaleX: 1,
      duration: 0.4,
      ease: "expo.out",
    });
  };

  const handleBlur = () => {
    if (!value) {
      gsap.to(underlineRef.current, {
        scaleX: 0,
        duration: 0.3,
        ease: "power2.in",
      });
    }
  };

  const sampleQueries =
    role === "student"
      ? STUDENT_SAMPLE_QUERIES
      : role === "faculty"
      ? FACULTY_SAMPLE_QUERIES
      : ADMIN_SAMPLE_QUERIES;

  const placeholderText =
    role === "student"
      ? "e.g. What are my marks in each subject?"
      : role === "faculty"
      ? "e.g. What is the average marks obtained per subject?"
      : "e.g. Which departments have the most students?";

  return (
    <div className="animate-rise relative flex flex-col">
      {/* Header line */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2
          className="font-display font-bold tracking-tight text-[var(--text-primary)]"
          style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", letterSpacing: "-0.03em" }}
        >
          {isAdmin ? (
            <>
              Admin Console
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}> — Full DB Access</span>
            </>
          ) : role === "faculty" ? (
            <>
              Faculty Portal
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}> — Department Scope</span>
            </>
          ) : (
            <>
              Student Workspace
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}> — Scoped to Your Data</span>
            </>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <span className="pill-tag flex items-center gap-1 px-2.5 py-0.5 font-mono text-[11px]">
            <span className="material-symbols-outlined text-[13px]">database</span>
            college_erp
          </span>
          {isAdmin ? (
            <span
              className="flex items-center gap-1 px-2.5 py-0.5 font-mono text-[11px]"
              style={{
                border: "1px solid rgb(var(--accent-bright-rgb) / 0.3)",
                background: "rgb(var(--accent-bright-rgb) / 0.06)",
                color: "var(--accent-bright)",
                borderRadius: "2px",
                boxShadow: "0 0 12px rgb(var(--accent-bright-rgb) / 0.1)",
              }}
            >
              <span className="material-symbols-outlined text-[13px]">admin_panel_settings</span>
              Admin: Full Access
            </span>
          ) : role === "faculty" ? (
            <span className="pill-tag flex items-center gap-1 px-2.5 py-0.5 font-mono text-[11px]">
              <span className="material-symbols-outlined text-[13px]">school</span>
              Faculty Scope
            </span>
          ) : (
            <span className="pill-tag flex items-center gap-1 px-2.5 py-0.5 font-mono text-[11px]">
              <span className="material-symbols-outlined text-[13px]">verified_user</span>
              Student Scope
            </span>
          )}
        </div>
      </div>

      {/* Hero input — no card, just the textarea with a line-draw underline */}
      <div className="relative">
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
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholderText}
          rows={2}
          className="w-full resize-none bg-transparent font-sans leading-relaxed text-[var(--text-primary)] focus:outline-none"
          style={{
            fontSize: "clamp(0.95rem, 2vw, 1.15rem)",
            padding: "0.75rem 0",
            borderBottom: "1px solid var(--border-hairline)",
            color: "var(--text-primary)",
          }}
        />
        {/* Animated focus underline */}
        <div
          ref={underlineRef}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "2px",
            background: "var(--accent)",
            transformOrigin: "left center",
            transform: "scaleX(0)",
            boxShadow: "0 0 10px var(--accent-glow)",
          }}
        />
        {/* Placeholder color override */}
        <style>{`
          #question::placeholder { color: var(--text-muted); }
        `}</style>
      </div>

      {/* Sample query chips */}
      <div className="mt-4 mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          Try:
        </span>
        {sampleQueries.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handleSelectSample(q)}
            className="text-left font-sans text-xs transition duration-200 focus-visible:outline-none"
            style={{
              padding: "4px 10px",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--text-secondary)",
              borderRadius: "2px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-accent)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--accent-dim)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Footer: keyboard hints + submit */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 pt-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <p className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <Key>Enter</Key> <span>to run</span>
          <span className="mx-1" style={{ color: "var(--text-ghost)" }}>·</span>
          <Key>Shift</Key> <span style={{ color: "var(--text-ghost)" }}>+</span> <Key>Enter</Key>{" "}
          <span>new line</span>
        </p>

        <button
          ref={buttonRef}
          onClick={submit}
          disabled={loading || !value.trim()}
          className="glow-button flex items-center gap-2 px-7 py-2.5 font-sans text-sm font-semibold transition-all"
          style={{ borderRadius: "2px" }}
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              <span>Checking & Generating…</span>
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
