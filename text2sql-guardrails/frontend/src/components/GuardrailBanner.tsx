import type { GuardrailReport } from "../types/api";

export function GuardrailBanner({ guardrail }: { guardrail: GuardrailReport }) {
  if (guardrail.passed) return null;

  return (
    <div
      className="animate-rise overflow-hidden"
      style={{
        borderLeft: "2px solid var(--danger)",
        padding: "16px 20px",
        background: "rgb(var(--danger-soft-rgb) / 0.04)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center"
          style={{ background: "var(--danger)", borderRadius: "2px", color: "var(--on-danger)" }}
        >
          <span className="block h-[1.5px] w-[9px] rounded-full bg-current" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" style={{ color: "var(--danger)" }}>Blocked by guardrails</h3>
          <ul className="mt-2 space-y-1.5">
            {guardrail.blocked_reasons.map((reason, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed" style={{ color: "rgb(var(--danger-soft-rgb) / 0.8)" }}>
                <span
                  aria-hidden
                  className="mt-[7px] block h-1 w-1 shrink-0 rounded-full"
                  style={{ background: "rgb(var(--danger-soft-rgb) / 0.5)" }}
                />
                <span className="min-w-0">{reason}</span>
              </li>
            ))}
          </ul>
          {guardrail.checks_run.length > 0 && (
            <p
              className="mt-3 pt-2.5 text-[11px] leading-relaxed"
              style={{
                borderTop: "1px solid rgb(var(--danger-soft-rgb) / 0.1)",
                color: "rgb(var(--danger-soft-rgb) / 0.45)",
              }}
            >
              <span className="font-semibold uppercase tracking-[0.08em]">Checks run</span>{" "}
              <span className="font-mono">{guardrail.checks_run.join(", ")}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
