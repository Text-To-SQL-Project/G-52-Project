import type { Clarification } from "../types/api";

interface Props {
  clarification: Clarification;
  onSelect: (option: string) => void;
}

export function ClarificationPanel({ clarification, onSelect }: Props) {
  return (
    /* Sky, matching CLARIFICATION_NEEDED's chip in StatusBanner. This panel
       used to be amber, which is REFUSED's colour -- the two states appeared
       on screen in the same hue despite meaning opposite things (one is a
       question to the user, the other is a hard stop). */
    <div className="animate-rise overflow-hidden rounded-2xl border border-sky-400/30 bg-sky-400/[0.08]">
      <div className="flex items-start gap-3 px-5 py-4">
        <span
          aria-hidden
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-sky-300/80 text-sky-200"
        >
          <span className="block text-[10px] font-bold leading-none">?</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-sky-200">Clarification needed</h3>
          <p className="mt-1 text-sm leading-relaxed text-sky-100/75">{clarification.reason}</p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            {clarification.options.map((option, i) => (
              <button
                key={i}
                onClick={() => onSelect(option)}
                style={{ animationDelay: `${140 + i * 70}ms` }}
                className="animate-rise rounded-lg border border-sky-300/30 bg-sky-300/[0.07] px-3.5 py-2 text-left text-sm text-sky-100 transition duration-200 hover:-translate-y-px hover:border-sky-300/50 hover:bg-sky-300/15 hover:shadow-[0_6px_18px_-8px_rgba(56,189,248,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:translate-y-0"
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
