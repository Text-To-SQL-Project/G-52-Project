export function ErrorPanel({ message }: { message?: string | null }) {
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
          className="mt-px inline-flex h-[17px] w-[17px] shrink-0 rotate-45 items-center justify-center"
          style={{ border: "1px solid var(--text-secondary)", borderRadius: "8px", color: "var(--text-secondary)" }}
        >
          <span className="block -rotate-45 text-[10px] font-bold leading-none">!</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Something went wrong</h3>
          <p className="mt-1 break-words text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {message ?? "No error detail was returned."}
          </p>
        </div>
      </div>
    </div>
  );
}
