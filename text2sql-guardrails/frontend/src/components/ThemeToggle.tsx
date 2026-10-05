import { useId, type MouseEvent } from "react";
import { apply, useTheme } from "../hooks/useTheme";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Sun/moon toggle. The new theme expands as a circle from the click point
 * (View Transitions API); browsers without it, or reduced motion, just swap. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  const mask = useId();

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const next = dark ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) return apply(next);

    const { clientX: x, clientY: y } = e;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(() => apply(next)).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: EASE, pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={`group flex h-7 w-7 items-center justify-center transition-colors duration-200 hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${className}`}
      style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px", color: "var(--text-secondary)" }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className="transition-transform duration-500 group-active:scale-90">
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          {/* The "bite" that turns the sun's disc into a crescent. */}
          <circle
            cx="12" cy="12" r="7" fill="black"
            style={{ transition: `transform 600ms ${EASE}`, transform: dark ? "translate(5px, -4px)" : "translate(14px, -14px)" }}
          />
        </mask>
        <circle
          cx="12" cy="12" fill="currentColor" mask={`url(#${mask})`}
          r={dark ? 8 : 4.5}
          style={{ transition: `r 600ms ${EASE}` }}
        />
        <g
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          style={{
            transformOrigin: "12px 12px",
            transition: `transform 600ms ${EASE}, opacity 300ms`,
            transform: dark ? "rotate(-45deg) scale(0.4)" : "rotate(0) scale(1)",
            opacity: dark ? 0 : 1,
          }}
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      </svg>
    </button>
  );
}
