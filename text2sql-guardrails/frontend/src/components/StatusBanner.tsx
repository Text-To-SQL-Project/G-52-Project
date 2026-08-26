import type { QueryStatus } from "../types/api";

const STATUS_STYLE: Record<QueryStatus, { label: string; classes: string }> = {
  success: { label: "Success", classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  refused: { label: "Refused — destructive operation", classes: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  clarification: { label: "Needs clarification", classes: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  blocked: { label: "Blocked by guardrail", classes: "bg-red-500/15 text-red-400 border-red-500/30" },
  error: { label: "Error", classes: "bg-red-500/15 text-red-400 border-red-500/30" },
};

interface Props {
  status: QueryStatus;
  reason?: string | null;
}

export function StatusBanner({ status, reason }: Props) {
  const style = STATUS_STYLE[status];
  return (
    <div>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${style.classes}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {style.label}
      </span>
      {reason && <p className="mt-1.5 text-sm text-white/50">{reason}</p>}
    </div>
  );
}
