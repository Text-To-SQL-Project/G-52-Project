export function ForbiddenPanel({ what }: { what: string }) {
  return (
    <div
      className="animate-rise overflow-hidden"
      style={{
        borderLeft: "2px solid var(--text-secondary)",
        padding: "16px 20px",
        background: "rgb(var(--ink-rgb) / 0.03)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full"
          style={{ border: "1px solid var(--text-secondary)", color: "var(--text-secondary)" }}
        >
          <span className="block text-[10px] font-bold leading-none">!</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Administrator access required
          </h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Your account is not permitted to view {what}. If your role changed
            recently, sign out and back in to refresh this view.
          </p>
        </div>
      </div>
    </div>
  );
}
