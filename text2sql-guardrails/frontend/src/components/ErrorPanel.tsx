/** Neutral slate, not red -- see StatusBanner's table for why. Red in this app
 * means a guardrail made a decision; an error means the system fell over,
 * which is a different kind of event and gets a different colour. The heading
 * and the diamond mark carry the severity. */
export function ErrorPanel({ message }: { message?: string | null }) {
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-slate-300/20 bg-slate-300/[0.06]">
      <div className="flex items-start gap-3 px-5 py-4">
        <span
          aria-hidden
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 rotate-45 items-center justify-center rounded-[2px] border border-slate-200/80 text-slate-100"
        >
          <span className="block -rotate-45 text-[10px] font-bold leading-none">!</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">Something went wrong</h3>
          <p className="mt-1 break-words text-sm leading-relaxed text-slate-200/70">
            {message ?? "No error detail was returned."}
          </p>
        </div>
      </div>
    </div>
  );
}
