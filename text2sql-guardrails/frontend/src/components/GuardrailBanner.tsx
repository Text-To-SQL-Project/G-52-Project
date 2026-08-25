import type { GuardrailReport } from "../types/api";

export function GuardrailBanner({ guardrail }: { guardrail: GuardrailReport }) {
  if (guardrail.passed) return null;

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <h3 className="mb-1.5 text-sm font-medium text-red-400">Blocked by guardrails</h3>
      <ul className="list-inside list-disc space-y-0.5 text-sm text-red-300/90">
        {guardrail.blocked_reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
      {guardrail.checks_run.length > 0 && (
        <p className="mt-2 text-xs text-red-300/50">
          Checks run: {guardrail.checks_run.join(", ")}
        </p>
      )}
    </div>
  );
}
