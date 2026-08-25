import type { Clarification } from "../types/api";

interface Props {
  clarification: Clarification;
  onSelect: (option: string) => void;
}

export function ClarificationPanel({ clarification, onSelect }: Props) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <h3 className="mb-1.5 text-sm font-medium text-amber-400">Clarification needed</h3>
      <p className="mb-3 text-sm text-amber-200/80">{clarification.reason}</p>
      <div className="flex flex-wrap gap-2">
        {clarification.options.map((option, i) => (
          <button
            key={i}
            onClick={() => onSelect(option)}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200 transition hover:bg-amber-500/20"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
