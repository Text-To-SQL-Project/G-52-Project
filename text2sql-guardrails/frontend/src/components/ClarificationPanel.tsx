import type { Clarification } from "../types/api";

interface Props {
  clarification: Clarification;
  onSelect: (option: string) => void;
}

export function ClarificationPanel({ clarification, onSelect }: Props) {
  return (
    <div
      className="animate-rise overflow-hidden"
      style={{
        borderLeft: "2px solid var(--info)",
        padding: "16px 20px",
        background: "rgba(56, 189, 248, 0.03)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full"
          style={{ border: "1px solid rgba(56, 189, 248, 0.6)", color: "var(--info)" }}
        >
          <span className="block text-[10px] font-bold leading-none">?</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--info)" }}>Clarification needed</h3>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "rgba(56, 189, 248, 0.75)" }}>
            {clarification.reason}
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {clarification.options.map((option, i) => (
              <button
                key={i}
                onClick={() => onSelect(option)}
                style={{
                  animationDelay: `${140 + i * 70}ms`,
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  background: "rgba(56, 189, 248, 0.04)",
                  color: "rgba(56, 189, 248, 0.9)",
                  borderRadius: "2px",
                  padding: "8px 14px",
                }}
                className="animate-rise text-left text-sm transition duration-200 focus-visible:outline-none"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.5)";
                  e.currentTarget.style.background = "rgba(56, 189, 248, 0.08)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.25)";
                  e.currentTarget.style.background = "rgba(56, 189, 248, 0.04)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
