import type { QueryStatus } from "../types/api";

type Silhouette = "disc" | "ring" | "square" | "block" | "diamond";

interface StatusToken {
  label: string;
  chip: string;
  badge: string;
  silhouette: Silhouette;
}

const STATUS_STYLE: Record<QueryStatus, StatusToken> = {
  success: {
    label: "Success",
    chip: "border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.06); color: var(--success);",
    badge: "background: var(--success); color: #04150e;",
    silhouette: "disc",
  },
  refused: {
    label: "Refused — destructive operation",
    chip: "border-color: rgba(251, 191, 36, 0.35); background: rgba(251, 191, 36, 0.06); color: var(--warning);",
    badge: "border: 1px solid rgba(251, 191, 36, 0.6); color: var(--warning);",
    silhouette: "square",
  },
  clarification: {
    label: "Needs clarification",
    chip: "border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.06); color: var(--accent);",
    badge: "border: 1px solid rgba(245, 158, 11, 0.6); color: var(--accent);",
    silhouette: "ring",
  },
  blocked: {
    label: "Blocked by guardrail",
    chip: "border-color: rgba(248, 113, 113, 0.4); background: rgba(248, 113, 113, 0.08); color: var(--danger);",
    badge: "background: var(--danger); color: #1a0407;",
    silhouette: "block",
  },
  error: {
    label: "Error",
    chip: "border-color: rgba(203, 213, 225, 0.25); background: rgba(203, 213, 225, 0.06); color: var(--text-secondary);",
    badge: "border: 1px solid rgba(203, 213, 225, 0.5); color: var(--text-secondary);",
    silhouette: "diamond",
  },
};

function Mark({ silhouette }: { silhouette: Silhouette }) {
  switch (silhouette) {
    case "disc":
      return (
        <span className="mt-[-1.5px] block h-[5px] w-[8px] rotate-[-45deg] border-b-[1.5px] border-l-[1.5px] border-current" />
      );
    case "ring":
      return (
        <span className="block text-[9px] font-bold leading-none">?</span>
      );
    case "square":
      return (
        <span className="relative block h-[8px] w-[8px]">
          <span className="absolute top-1/2 left-0 block h-[1.5px] w-full -translate-y-1/2 rotate-45 bg-current" />
          <span className="absolute top-1/2 left-0 block h-[1.5px] w-full -translate-y-1/2 -rotate-45 bg-current" />
        </span>
      );
    case "block":
      return <span className="block h-[1.5px] w-[8px] rounded-full bg-current" />;
    case "diamond":
      return (
        <span className="block -rotate-45 text-[9px] font-bold leading-none">!</span>
      );
  }
}

function StatusBadge({ status }: { status: QueryStatus }) {
  const { badge, silhouette } = STATUS_STYLE[status];
  const shape =
    silhouette === "disc" || silhouette === "ring"
      ? "border-radius: 50%"
      : silhouette === "diamond"
        ? "transform: rotate(45deg); border-radius: 2px"
        : "border-radius: 2px";

  return (
    <span
      aria-hidden
      className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center"
      style={Object.fromEntries([...badge.split(";").filter(Boolean).map(s => {
        const [k, ...v] = s.split(":");
        return [k.trim(), v.join(":").trim()];
      }), ...shape.split(";").filter(Boolean).map(s => {
        const [k, ...v] = s.split(":");
        return [k.trim(), v.join(":").trim()];
      })])}
    >
      <Mark silhouette={silhouette} />
    </span>
  );
}

interface Props {
  status: QueryStatus;
  reason?: string | null;
}

export function StatusBanner({ status, reason }: Props) {
  const style = STATUS_STYLE[status];
  const chipStyles = Object.fromEntries(
    style.chip.split(";").filter(Boolean).map(s => {
      const [k, ...v] = s.split(":");
      return [k.trim(), v.join(":").trim()];
    })
  );

  return (
    <div className="min-w-0">
      <span
        className="animate-chip inline-flex items-center gap-2 border px-3 py-1.5 text-[13px] font-semibold tracking-[-0.01em]"
        style={{ ...chipStyles, borderRadius: "2px" }}
      >
        <StatusBadge status={status} />
        {style.label}
      </span>
      {reason && (
        <p className="animate-fade mt-2 max-w-prose text-sm leading-relaxed [animation-delay:120ms]" style={{ color: "var(--text-secondary)" }}>
          {reason}
        </p>
      )}
    </div>
  );
}
