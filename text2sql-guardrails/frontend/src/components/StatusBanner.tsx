import type { QueryStatus } from "../types/api";

/**
 * The five terminal states of a query, and the one place their appearance is
 * defined. Three rules constrain this table and none of them are cosmetic:
 *
 * 1. Green is reserved. It marks SUCCESS here and PASS in ConfidenceCard, and
 *    nothing else anywhere in the app -- no buttons, no accents. A refused or
 *    blocked query must never pick up a success-coloured element.
 * 2. Hue is never the only difference. A projector with poor colour
 *    reproduction can collapse amber into red, so every state also carries a
 *    distinct badge silhouette (circle / ring / square / filled square /
 *    diamond) and a distinct mark. Shape survives bad colour; hue does not.
 * 3. The text label always renders. The badge is reinforcement, not a
 *    substitute for saying which state this is.
 *
 * `tone` is the shared accent each state lends to the panels below it
 * (GuardrailBanner, ClarificationPanel, ErrorPanel) so a response reads as one
 * object rather than a stack of independently coloured cards.
 *
 * Note that BLOCKED and ERROR are deliberately far apart: BLOCKED is red
 * because a guardrail made a decision, ERROR is neutral slate because the
 * system merely fell over. Keeping red to mean "we stopped this on purpose"
 * is worth more than colouring every bad outcome the same.
 */
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
    chip: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
    badge: "bg-emerald-400 text-[#04150e]",
    silhouette: "disc",
  },
  refused: {
    label: "Refused — destructive operation",
    chip: "border-amber-400/35 bg-amber-400/10 text-amber-300",
    badge: "border border-amber-300/80 text-amber-200",
    silhouette: "square",
  },
  clarification: {
    label: "Needs clarification",
    chip: "border-sky-400/35 bg-sky-400/10 text-sky-300",
    badge: "border border-sky-300/80 text-sky-200",
    silhouette: "ring",
  },
  blocked: {
    label: "Blocked by guardrail",
    chip: "border-red-400/40 bg-red-500/15 text-red-300",
    badge: "bg-red-400 text-[#1a0407]",
    silhouette: "block",
  },
  error: {
    label: "Error",
    chip: "border-slate-300/25 bg-slate-300/10 text-slate-200",
    badge: "border border-slate-200/80 text-slate-100",
    silhouette: "diamond",
  },
};

/** The mark inside the badge. Drawn with borders and boxes rather than glyphs
 * or an icon font so it cannot be swapped for a tofu box or an emoji by
 * whatever fonts the demo machine happens to have. */
function Mark({ silhouette }: { silhouette: Silhouette }) {
  switch (silhouette) {
    // Check.
    case "disc":
      return (
        <span className="mt-[-1.5px] block h-[5px] w-[8px] rotate-[-45deg] border-b-[1.5px] border-l-[1.5px] border-current" />
      );
    // Question mark: a hook over a dot.
    case "ring":
      return (
        <span className="block text-[9px] font-bold leading-none">?</span>
      );
    // Cross.
    case "square":
      return (
        <span className="relative block h-[8px] w-[8px]">
          <span className="absolute top-1/2 left-0 block h-[1.5px] w-full -translate-y-1/2 rotate-45 bg-current" />
          <span className="absolute top-1/2 left-0 block h-[1.5px] w-full -translate-y-1/2 -rotate-45 bg-current" />
        </span>
      );
    // Bar: a no-entry sign, the only state whose mark is solid and horizontal.
    case "block":
      return <span className="block h-[1.5px] w-[8px] rounded-full bg-current" />;
    // Exclamation, counter-rotated so it stays upright inside the diamond.
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
      ? "rounded-full"
      : silhouette === "diamond"
        ? "rotate-45 rounded-[2px]"
        : "rounded-[3px]";

  return (
    <span
      aria-hidden
      className={`inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center ${shape} ${badge}`}
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
  return (
    <div className="min-w-0">
      <span
        className={`animate-chip inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold tracking-[-0.01em] ${style.chip}`}
      >
        <StatusBadge status={status} />
        {style.label}
      </span>
      {reason && (
        <p className="animate-fade mt-2 max-w-prose text-sm leading-relaxed text-white/55 [animation-delay:120ms]">
          {reason}
        </p>
      )}
    </div>
  );
}
