/**
 * Shown when the API returns 403.
 *
 * Distinct from ErrorPanel on purpose. A 403 is not a malfunction: the
 * caller authenticated successfully and is simply not permitted here,
 * which happens legitimately when a role changes mid-session -- the server
 * re-reads role on every request, so an admin demoted a second ago gets
 * this on their next click.
 *
 * It exists because hiding the Admin tab is presentation, not access
 * control. The tab being hidden must never be the only thing standing
 * between a non-admin and the admin data, so the screen behind it has to
 * render something honest when the API refuses. A blank panel or a red
 * "something went wrong" would both be wrong: nothing went wrong.
 *
 * Neutral slate, matching the ERROR state's treatment rather than red --
 * red in this app means a guardrail made a decision about a query.
 */
export function ForbiddenPanel({ what }: { what: string }) {
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-slate-300/20 bg-slate-300/[0.06]">
      <div className="flex items-start gap-3 px-5 py-4">
        <span
          aria-hidden
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-slate-200/80 text-slate-100"
        >
          <span className="block text-[10px] font-bold leading-none">!</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">
            Administrator access required
          </h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-200/70">
            Your account is not permitted to view {what}. If your role changed
            recently, sign out and back in to refresh this view.
          </p>
        </div>
      </div>
    </div>
  );
}
