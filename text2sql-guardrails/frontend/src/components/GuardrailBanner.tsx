import type { GuardrailReport } from "../types/api";

export function GuardrailBanner({ guardrail }: { guardrail: GuardrailReport }) {
  if (guardrail.passed) return null;

  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-red-400/30 bg-red-500/[0.09]">
      <div className="flex items-start gap-3 px-5 py-4">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[3px] bg-red-400 text-[#1a0407]"
        >
          <span className="block h-[1.5px] w-[9px] rounded-full bg-current" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-red-300">Blocked by guardrails</h3>
          <ul className="mt-2 space-y-1.5">
            {guardrail.blocked_reasons.map((reason, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-red-200/85">
                <span
                  aria-hidden
                  className="mt-[7px] block h-1 w-1 shrink-0 rounded-full bg-red-300/60"
                />
                <span className="min-w-0">{reason}</span>
              </li>
            ))}
          </ul>
          {guardrail.checks_run.length > 0 && (
            <p className="mt-3 border-t border-red-400/15 pt-2.5 text-[11px] leading-relaxed text-red-200/50">
              <span className="font-semibold uppercase tracking-[0.08em]">Checks run</span>{" "}
              <span className="font-mono">{guardrail.checks_run.join(", ")}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
